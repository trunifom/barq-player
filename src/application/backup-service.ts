/**
 * Backup und Austausch: versionierter JSON-Voll-Export, strikt vorvalidierter Import (Replace-All, atomar)
 * sowie CSV-Export/-Import von Sammlungen und Artikelstamm.
 *
 * Datensicherheit: Ein ungültiger Import verändert nie vorhandene Daten – erst nach vollständig bestandener
 * Prüfung beginnt die Transaktion, und bei einem Fehler darin rollt Dexie alles zurück.
 */
import { AppError } from '../domain/errors';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, parseBackupText, type BackupFile } from '../domain/backup-schema';
import { itemsToCsv, parseCatalogCsv, parseItemsCsv, type CsvMapping, type CsvRowError } from '../domain/csv-items';
import type { Symbology } from '../domain/types';
import { guardWrite, type BarqDatabase } from '../adapters/persistence/db';
import { CollectionService, defaultDeps, type DuplicateRule, type ServiceDeps } from './collection-service';

/** Zählung importierter Datensätze je Tabelle. */
export interface ImportSummary {
  collections: number;
  items: number;
  templates: number;
  profiles: number;
  catalog: number;
  sessions: number;
  events: number;
}

/** Optionen für den CSV-Import von Einträgen. */
export interface CsvImportOptions {
  /** Manuelle Spaltenzuordnung; ohne Angabe aus der Kopfzeile. */
  mapping?: CsvMapping;
  /** Symbologie für Zeilen ohne Symbologie-Angabe. */
  defaultSymbology?: Symbology;
  /** `abort` (Standard): bei Fehlern wird nichts importiert; `skip-invalid`: gültige Zeilen werden importiert. */
  onError?: 'abort' | 'skip-invalid';
  /** Duplikatregel (Standard `merge`). */
  duplicate?: DuplicateRule;
}

/** Bericht eines CSV-Imports. */
export interface CsvImportReport {
  /** Anzahl gespeicherter Zeilen (0 bei Abbruch). */
  imported: number;
  /** `true`, wenn wegen Fehlern nichts importiert wurde. */
  aborted: boolean;
  /** Fehlerbericht pro Zeile. */
  errors: CsvRowError[];
}

/** Dienst für Sicherung, Wiederherstellung und CSV-Austausch. */
export class BackupService {
  private readonly collections: CollectionService;

  /**
   * @param db - Datenbank.
   * @param appVersion - App-Version für den Export.
   * @param deps - ID- und Zeitquelle.
   */
  constructor(
    private readonly db: BarqDatabase,
    private readonly appVersion: string,
    private readonly deps: ServiceDeps = defaultDeps
  ) {
    this.collections = new CollectionService(db, deps);
  }

  /**
   * Erzeugt ein vollständiges Backup (konsistenter Lesezugriff über alle Tabellen).
   * @returns Backup-Objekt.
   * @throws {AppError} `ERR_STORAGE_WRITE_FAILED` bei Lesefehlern.
   */
  async createBackup(): Promise<BackupFile> {
    const db = this.db;
    return guardWrite(() =>
      db.transaction('r', [db.collections, db.items, db.templates, db.profiles, db.catalog, db.sessions, db.events], async () => ({
        format: BACKUP_FORMAT,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: this.deps.now(),
        appVersion: this.appVersion,
        data: {
          collections: await db.collections.toArray(),
          items: await db.items.toArray(),
          templates: await db.templates.toArray(),
          profiles: await db.profiles.toArray(),
          catalog: await db.catalog.toArray(),
          sessions: await db.sessions.toArray(),
          events: await db.events.toArray()
        }
      }))
    );
  }

  /**
   * Exportiert das Backup als JSON-Text (eingerückt, gut lesbar).
   * @returns JSON.
   */
  async exportJson(): Promise<string> {
    return JSON.stringify(await this.createBackup(), null, 2);
  }

  /**
   * Stellt ein Backup wieder her (ersetzt ALLE Daten). Die Datei wird vollständig vorab geprüft;
   * bei Fehlern bleiben die vorhandenen Daten unverändert.
   * @param text - JSON-Inhalt.
   * @returns Anzahl wiederhergestellter Datensätze.
   * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID` (Datei ungültig, nichts verändert) oder `ERR_STORAGE_*` (Transaktion zurückgerollt).
   */
  async importJson(text: string): Promise<ImportSummary> {
    const backup = parseBackupText(text); // wirft, bevor die Datenbank berührt wird
    const d = backup.data;
    const db = this.db;
    await guardWrite(() =>
      db.transaction('rw', [db.collections, db.items, db.templates, db.profiles, db.catalog, db.sessions, db.events], async () => {
        await Promise.all([db.collections.clear(), db.items.clear(), db.templates.clear(), db.profiles.clear(), db.catalog.clear(), db.sessions.clear(), db.events.clear()]);
        await db.collections.bulkAdd(d.collections);
        await db.items.bulkAdd(d.items);
        await db.templates.bulkAdd(d.templates);
        await db.profiles.bulkAdd(d.profiles);
        await db.catalog.bulkAdd(d.catalog);
        await db.sessions.bulkAdd(d.sessions);
        await db.events.bulkAdd(d.events);
      })
    );
    return {
      collections: d.collections.length,
      items: d.items.length,
      templates: d.templates.length,
      profiles: d.profiles.length,
      catalog: d.catalog.length,
      sessions: d.sessions.length,
      events: d.events.length
    };
  }

  /**
   * Exportiert eine Sammlung als CSV (Formelschutz aktiv, Werte als Text).
   * @param collectionId - Sammlung.
   * @returns CSV-Text.
   * @throws {AppError} `ERR_NOT_FOUND`.
   */
  async exportCollectionCsv(collectionId: string): Promise<string> {
    const collection = await this.db.collections.get(collectionId);
    if (!collection) throw new AppError('ERR_NOT_FOUND', { details: `Sammlung ${collectionId}`, userMessage: 'Die Sammlung existiert nicht (mehr).' });
    return itemsToCsv(await this.collections.listItems(collectionId), collection.name);
  }

  /**
   * Importiert Einträge aus CSV in eine Sammlung (führende Nullen bleiben erhalten, Fehlerbericht pro Zeile).
   * @param collectionId - Zielsammlung.
   * @param text - CSV mit Kopfzeile.
   * @param options - Zuordnung, Standardformat, Fehler- und Duplikatregel.
   * @returns Importbericht.
   * @throws {AppError} `ERR_IMPORT_CSV_INVALID` bei strukturellen Fehlern (leere Datei, fehlende Zuordnung), `ERR_NOT_FOUND`, `ERR_STORAGE_*`.
   */
  async importCollectionCsv(collectionId: string, text: string, options: CsvImportOptions = {}): Promise<CsvImportReport> {
    const parsed = parseItemsCsv(text, {
      ...(options.mapping === undefined ? {} : { mapping: options.mapping }),
      ...(options.defaultSymbology === undefined ? {} : { defaultSymbology: options.defaultSymbology })
    });
    if (parsed.errors.length > 0 && (options.onError ?? 'abort') === 'abort') {
      return { imported: 0, aborted: true, errors: parsed.errors };
    }
    if (parsed.rows.length === 0) return { imported: 0, aborted: false, errors: parsed.errors };
    await this.collections.addItems(
      collectionId,
      parsed.rows.map((r) => ({ symbology: r.symbology, value: r.value, quantity: r.quantity, source: 'import' as const, ...(r.label === undefined ? {} : { label: r.label }) })),
      options.duplicate ?? 'merge'
    );
    return { imported: parsed.rows.length, aborted: false, errors: parsed.errors };
  }

  /**
   * Importiert einen Artikelstamm aus CSV und ersetzt den vorhandenen (atomar).
   * @param text - CSV mit Kopfzeile (Kennung, optional aktiv/Bezeichnung).
   * @param source - Quellenbezeichnung (z. B. Dateiname) für die Anzeige.
   * @param onError - `abort` (Standard) oder `skip-invalid`.
   * @returns Anzahl importierter Produkte und Fehlerbericht.
   * @throws {AppError} `ERR_IMPORT_CSV_INVALID`, `ERR_STORAGE_*`.
   */
  async importCatalogCsv(text: string, source: string, onError: 'abort' | 'skip-invalid' = 'abort'): Promise<CsvImportReport> {
    const { products, errors } = parseCatalogCsv(text, { source, importedAt: this.deps.now() });
    if (errors.length > 0 && onError === 'abort') return { imported: 0, aborted: true, errors };
    await this.collections.replaceCatalog(products);
    return { imported: products.length, aborted: false, errors };
  }
}
