/**
 * Gemeinsame Bibliothek: lädt `library/index.json` und die dort aufgeführten Sammlungsdateien von der **eigenen**
 * App-Adresse (derselben Herkunft wie die App – keine fremden Server), prüft sie vollständig und übernimmt sie bzw.
 * aktualisiert sie auf Wunsch.
 *
 * Grundsätze:
 * - Nichts wird automatisch überschrieben: {@link LibraryService.check} schreibt nie; erst {@link LibraryService.apply} speichert.
 * - Jede Datei wird einzeln streng geprüft; eine fehlerhafte Datei blockiert die übrigen nicht (Bericht in `problems`).
 * - Eine Aktualisierung einer lokal geänderten Sammlung ist erkennbar (`update-modified`) und wird von der Oberfläche
 *   nur nach ausdrücklicher Bestätigung ausgeführt.
 */
import { AppError } from '../domain/errors';
import { expiryInfo } from '../domain/expiry';
import { contentHash, libraryEntryStatus, parseLibraryIndex, type LibraryEntryStatus } from '../domain/library';
import { buildShareFile, parseShareText, type ShareFile } from '../domain/share-format';
import type { Collection, LibraryLink } from '../domain/types';
import type { BarqDatabase } from '../adapters/persistence/db';
import { CollectionService, defaultDeps, type ServiceDeps } from './collection-service';

/** Minimale Antwort einer HTTP-Abfrage (so testbar ohne Netzwerk). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Abfragefunktion (Standard: `fetch`). */
export type FetchLike = (url: string, init?: { cache?: 'no-store' | 'no-cache' }) => Promise<FetchResponseLike>;

/** Eine Sammlung der Bibliothek im Vergleich zum Gerät. */
export interface LibraryEntry {
  file: string;
  name: string;
  itemCount: number;
  /** Anzahl bereits abgelaufener Codes (Stand heute). */
  expiredCount: number;
  status: LibraryEntryStatus;
  remoteHash: string;
  /** Geprüfter Inhalt der veröffentlichten Datei. */
  share: ShareFile;
  /** Lokale Sammlung, falls schon übernommen. */
  localCollectionId?: string;
}

/** Eine fehlerhafte oder nicht ladbare Datei der Bibliothek. */
export interface LibraryProblem {
  file: string;
  message: string;
}

/** Ergebnis einer Prüfung. */
export interface LibraryCheck {
  entries: LibraryEntry[];
  problems: LibraryProblem[];
}

/** Ergebnis einer Übernahme. */
export interface LibraryApplyResult {
  collection: Collection;
  items: number;
  /** `true`: neue Sammlung angelegt, `false`: vorhandene aktualisiert. */
  created: boolean;
}

/** Dienst für die gemeinsame Bibliothek. */
export class LibraryService {
  private readonly collections: CollectionService;

  /**
   * @param db - Datenbank.
   * @param fetcher - Abfragefunktion (Standard `fetch`).
   * @param deps - ID- und Zeitquelle.
   * @param baseUrl - Ordner der Bibliothek relativ zur App (Standard `./library/`).
   */
  constructor(
    private readonly db: BarqDatabase,
    private readonly fetcher: FetchLike,
    private readonly deps: ServiceDeps = defaultDeps,
    private readonly baseUrl: string = './library/'
  ) {
    this.collections = new CollectionService(db, deps);
  }

  private unavailable(details: string, cause?: unknown): AppError {
    return new AppError('ERR_LIBRARY_UNAVAILABLE', { details, ...(cause === undefined ? {} : { cause }) });
  }

  /**
   * Lädt Index und Dateien und vergleicht sie mit den Sammlungen auf dem Gerät. Schreibt nichts.
   * @param today - heutiger Kalendertag (zur Zählung abgelaufener Codes).
   * @returns Einträge und Probleme. Eine nicht vorhandene Bibliothek (Index fehlt, HTTP 404) ergibt eine leere Liste.
   * @throws {AppError} `ERR_LIBRARY_UNAVAILABLE` (nicht erreichbar/Serverfehler), `ERR_IMPORT_SCHEMA_INVALID` (Index ungültig).
   */
  async check(today: string): Promise<LibraryCheck> {
    let indexText: string;
    try {
      const res = await this.fetcher(`${this.baseUrl}index.json`, { cache: 'no-store' });
      if (res.status === 404) return { entries: [], problems: [] };
      if (!res.ok) throw this.unavailable(`HTTP ${res.status} für index.json`);
      indexText = await res.text();
    } catch (error: unknown) {
      throw error instanceof AppError ? error : this.unavailable('index.json nicht ladbar', error);
    }
    const index = parseLibraryIndex(indexText);
    const local = await this.db.collections.toArray();
    const entries: LibraryEntry[] = [];
    const problems: LibraryProblem[] = [];
    for (const file of index.files) {
      try {
        const res = await this.fetcher(`${this.baseUrl}${encodeURIComponent(file)}`, { cache: 'no-store' });
        if (!res.ok) {
          problems.push({ file, message: res.status === 404 ? 'Die Datei steht im Index, wurde aber nicht gefunden.' : `Die Datei konnte nicht geladen werden (HTTP ${res.status}).` });
          continue;
        }
        const share = parseShareText(await res.text());
        const remoteHash = contentHash(share.items);
        const match = local.find((c) => c.library?.file === file);
        let status: LibraryEntryStatus = 'new';
        if (match?.library) {
          const items = await this.collections.listItems(match.id);
          status = libraryEntryStatus(remoteHash, { link: match.library, currentHash: contentHash(buildShareFile(match.name, items, { exportedAt: '', appVersion: '' }).items) });
        }
        entries.push({
          file,
          name: share.collection.name,
          itemCount: share.items.length,
          expiredCount: share.items.filter((i) => expiryInfo(i.expiresAt, today).state === 'expired').length,
          status,
          remoteHash,
          share,
          ...(match ? { localCollectionId: match.id } : {})
        });
      } catch (error: unknown) {
        problems.push({ file, message: error instanceof AppError ? error.userMessage : 'Die Datei konnte nicht gelesen werden.' });
      }
    }
    return { entries, problems };
  }

  /**
   * Übernimmt eine Bibliotheksdatei: legt eine neue Sammlung an (`new`) oder ersetzt den Inhalt der verknüpften
   * Sammlung (`update`, `update-modified`). Bei `current`/`modified` geschieht nichts Ungewolltes: es wird die
   * veröffentlichte Version erneut übernommen (die Oberfläche bietet das nur für `new`/`update*` an).
   * @param entry - Eintrag aus {@link check}.
   * @returns Sammlung, Anzahl Codes, ob neu angelegt.
   * @throws {AppError} `ERR_STORAGE_*`, `ERR_NOT_FOUND`.
   */
  async apply(entry: LibraryEntry): Promise<LibraryApplyResult> {
    const link: LibraryLink = { file: entry.file, hash: entry.remoteHash, importedAt: this.deps.now() };
    const existing = entry.localCollectionId ? await this.db.collections.get(entry.localCollectionId) : undefined;
    if (existing) {
      const r = await this.collections.replaceFromShare(existing.id, entry.share, link);
      return { ...r, created: false };
    }
    const r = await this.collections.importShare(entry.share, link);
    return { ...r, created: true };
  }
}
