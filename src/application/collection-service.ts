/**
 * Anwendungsdienst für Sammlungen, Einträge, Vorlagen, Profile und Artikelstamm.
 *
 * Alle Werte werden vor dem Schreiben mit der Domain-Logik validiert; Mehrfachschreibvorgänge laufen
 * atomar in einer Transaktion. „Gespeichert“ gilt erst, wenn die Methode erfolgreich zurückkehrt.
 */
import { AppError } from '../domain/errors';
import { validateCodeValue } from '../domain/bulk-parser';
import { MAX_QUANTITY } from '../domain/csv-items';
import { fillMissingMeta, normalizeItemMeta, type ItemMeta, type ItemMetaInput } from '../domain/item-meta';
import type { ShareFile } from '../domain/share-format';
import { DEFAULT_PROFILES, validateProfile } from '../domain/profiles';
import type {
  BarcodeItem,
  CatalogProduct,
  CatalogStatus,
  Collection,
  FaderProfile,
  ItemSource,
  LibraryLink,
  SequenceTemplate,
  Symbology
} from '../domain/types';
import { guardWrite, type BarqDatabase } from '../adapters/persistence/db';

/** Abhängigkeiten (injizierbar für Tests). */
export interface ServiceDeps {
  newId: () => string;
  now: () => string;
}

/** Standardabhängigkeiten: UUID und ISO-Zeit. */
export const defaultDeps: ServiceDeps = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString()
};

/** Eingabe für einen neuen Eintrag. */
export interface NewItemInput {
  symbology: Symbology;
  value: string;
  source: ItemSource;
  quantity?: number;
  /** Wort / Bezeichnung. */
  label?: string | undefined;
  /** Nutzen. */
  purpose?: string | undefined;
  /** Satz / Notiz. */
  note?: string | undefined;
  /** Tags (Liste oder Text mit Trennzeichen). */
  tags?: readonly string[] | string | undefined;
  /** Ablaufdatum (`JJJJ-MM-TT` oder `TT.MM.JJJJ`). */
  expiresAt?: string | undefined;
}

/** Ergebnis des Imports einer geteilten Sammlung. */
export interface ShareImportResult {
  collection: Collection;
  items: number;
}

/** Duplikatregel beim Hinzufügen: `merge` erhöht die Menge, `append` legt eine neue Position an. */
export type DuplicateRule = 'merge' | 'append';

/** Zusammenfassung eines Artikelstamm-Abgleichs. */
export interface CatalogCheckSummary {
  known: number;
  unknown: number;
  inactive: number;
  /** `true`, wenn kein Artikelstamm vorhanden war (Einträge bleiben `unchecked`). */
  catalogEmpty: boolean;
}

const MAX_NAME_LENGTH = 100;

function badInput(message: string): AppError {
  return new AppError('ERR_SYNTAX_INVALID', { details: message, userMessage: message });
}

function cleanName(name: string): string {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n === '') throw badInput('Der Name darf nicht leer sein.');
  if (n.length > MAX_NAME_LENGTH) throw badInput(`Der Name darf höchstens ${MAX_NAME_LENGTH} Zeichen haben.`);
  return n;
}

function checkQuantity(q: number): number {
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) throw badInput(`Die Menge muss eine ganze Zahl von 1 bis ${MAX_QUANTITY} sein.`);
  return q;
}

/** Dienst für alle Sammlungs-bezogenen Vorgänge. */
export class CollectionService {
  /**
   * @param db - Datenbank.
   * @param deps - ID- und Zeitquelle.
   */
  constructor(
    private readonly db: BarqDatabase,
    private readonly deps: ServiceDeps = defaultDeps
  ) {}

  // ------------------------------------------------------------ Sammlungen

  /**
   * Legt eine Sammlung an.
   * @param name - Name (1–100 Zeichen, getrimmt).
   * @returns gespeicherte Sammlung.
   * @throws {AppError} `ERR_SYNTAX_INVALID` bei ungültigem Namen, `ERR_STORAGE_*` bei Schreibfehlern.
   */
  async createCollection(name: string): Promise<Collection> {
    const now = this.deps.now();
    const collection: Collection = { id: this.deps.newId(), name: cleanName(name), createdAt: now, updatedAt: now };
    await guardWrite(() => this.db.collections.add(collection));
    return collection;
  }

  /**
   * Benennt eine Sammlung um.
   * @param id - Sammlungs-ID.
   * @param name - neuer Name.
   * @returns aktualisierte Sammlung.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_SYNTAX_INVALID`, `ERR_STORAGE_*`.
   */
  async renameCollection(id: string, name: string): Promise<Collection> {
    const clean = cleanName(name);
    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, async () => {
        const existing = await this.requireCollection(id);
        const updated: Collection = { ...existing, name: clean, updatedAt: this.deps.now() };
        await this.db.collections.put(updated);
        return updated;
      })
    );
  }

  /**
   * Löscht eine Sammlung samt ihrer Einträge (Sitzungsprotokolle bleiben erhalten).
   * @param id - Sammlungs-ID.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_STORAGE_*`.
   */
  async deleteCollection(id: string): Promise<void> {
    await guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        await this.requireCollection(id);
        await this.db.items.where('collectionId').equals(id).delete();
        await this.db.collections.delete(id);
      })
    );
  }

  /** @returns alle Sammlungen, zuletzt geänderte zuerst. */
  async listCollections(): Promise<Collection[]> {
    const all = await this.db.collections.toArray();
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------ Einträge

  /**
   * Fügt einen Eintrag hinzu (validiert Syntax und Prüfziffer; ungültige Werte werden abgelehnt, nie korrigiert).
   * @param collectionId - Zielsammlung.
   * @param input - Eintragsdaten.
   * @param rule - Duplikatregel (Standard `merge`).
   * @returns gespeicherter (bzw. mengenmäßig erhöhter) Eintrag.
   * @throws {AppError} `ERR_NOT_FOUND`, Validierungsfehler mit Code (`ERR_SYNTAX_INVALID`/`ERR_CHECKSUM_INVALID`), `ERR_STORAGE_*`.
   */
  async addItem(collectionId: string, input: NewItemInput, rule: DuplicateRule = 'merge'): Promise<BarcodeItem> {
    const [item] = await this.addItems(collectionId, [input], rule);
    if (!item) throw new AppError('ERR_UNKNOWN', { details: 'addItems lieferte kein Ergebnis' });
    return item;
  }

  /**
   * Fügt mehrere Einträge atomar hinzu: Ist ein Eintrag ungültig, wird NICHTS gespeichert.
   * @param collectionId - Zielsammlung.
   * @param inputs - Einträge.
   * @param rule - Duplikatregel; bei `merge` werden auch Duplikate innerhalb der Eingabe zusammengefasst.
   * @returns Einträge in Eingabereihenfolge (zusammengeführte Duplikate verweisen auf denselben Datensatz).
   * @throws {AppError} wie {@link addItem}; Fehlermeldung nennt die Eingabeposition.
   */
  async addItems(collectionId: string, inputs: readonly NewItemInput[], rule: DuplicateRule = 'merge'): Promise<BarcodeItem[]> {
    // 1) Alles vorab prüfen (keine Teilschreibvorgänge)
    const prepared = inputs.map((input, i) => {
      const check = validateCodeValue(input.value, input.symbology, { multiline: true });
      if (!check.ok) {
        throw new AppError(check.code, { details: `Eintrag ${i + 1}: ${check.message}`, userMessage: `Eintrag ${i + 1}: ${check.message}` });
      }
      let meta: ItemMeta;
      try {
        meta = normalizeItemMeta({ label: input.label, purpose: input.purpose, note: input.note, tags: input.tags, expiresAt: input.expiresAt });
      } catch (error: unknown) {
        const message = `Eintrag ${i + 1}: ${error instanceof AppError ? error.userMessage : 'ungültige Zusatzangaben'}`;
        throw new AppError('ERR_SYNTAX_INVALID', { details: message, cause: error, userMessage: message });
      }
      return { input, value: check.value, checksum: check.checksum, quantity: checkQuantity(input.quantity ?? 1), meta };
    });

    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        const collection = await this.requireCollection(collectionId);
        const existing = await this.db.items.where('collectionId').equals(collectionId).toArray();
        const byKey = new Map<string, BarcodeItem>();
        let nextPosition = 0;
        for (const it of existing) {
          nextPosition = Math.max(nextPosition, it.position + 1);
          const key = `${it.symbology}\u0000${it.value}`;
          if (!byKey.has(key)) byKey.set(key, it);
        }
        const now = this.deps.now();
        const touched = new Map<string, BarcodeItem>();
        const result: BarcodeItem[] = [];
        for (const p of prepared) {
          const key = `${p.input.symbology}\u0000${p.value}`;
          const found = rule === 'merge' ? byKey.get(key) : undefined;
          if (found) {
            const merged: BarcodeItem = { ...found, ...fillMissingMeta(found, p.meta), quantity: checkQuantity(found.quantity + p.quantity) };
            byKey.set(key, merged);
            touched.set(merged.id, merged);
            result.push(merged);
          } else {
            const item: BarcodeItem = {
              id: this.deps.newId(),
              collectionId,
              position: nextPosition++,
              symbology: p.input.symbology,
              value: p.value,
              quantity: p.quantity,
              source: p.input.source,
              capturedAt: now,
              syntaxStatus: 'valid',
              checksumStatus: p.checksum,
              catalogStatus: 'unchecked',
              ...p.meta
            };
            if (rule === 'merge') byKey.set(key, item);
            touched.set(item.id, item);
            result.push(item);
          }
        }
        await this.db.items.bulkPut([...touched.values()]);
        await this.db.collections.put({ ...collection, updatedAt: now });
        // Ergebnis auf den zuletzt geschriebenen Stand abbilden
        return result.map((r) => touched.get(r.id) ?? r);
      })
    );
  }

  /**
   * Sucht einen Eintrag gleicher Symbologie und gleichen Werts in einer Sammlung.
   * @param collectionId - Sammlung.
   * @param symbology - Symbologie.
   * @param value - Wert (exakter Stringvergleich).
   * @returns Eintrag oder `undefined`.
   */
  async findItem(collectionId: string, symbology: Symbology, value: string): Promise<BarcodeItem | undefined> {
    return this.db.items
      .where('collectionId')
      .equals(collectionId)
      .filter((i) => i.symbology === symbology && i.value === value)
      .first();
  }

  /**
   * Zählt die Positionen einer Sammlung.
   * @param collectionId - Sammlung.
   * @returns Anzahl der Positionen (nicht der Mengen).
   */
  async countItems(collectionId: string): Promise<number> {
    return this.db.items.where('collectionId').equals(collectionId).count();
  }

  /** @returns Einträge einer Sammlung nach Position sortiert. */
  async listItems(collectionId: string): Promise<BarcodeItem[]> {
    const items = await this.db.items.where('collectionId').equals(collectionId).toArray();
    return items.sort((a, b) => a.position - b.position);
  }

  /**
   * Setzt die Menge eines Eintrags.
   * @param itemId - Eintrags-ID.
   * @param quantity - 1 bis 9999.
   * @returns aktualisierter Eintrag.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_SYNTAX_INVALID`, `ERR_STORAGE_*`.
   */
  async setQuantity(itemId: string, quantity: number): Promise<BarcodeItem> {
    const q = checkQuantity(quantity);
    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        const item = await this.requireItem(itemId);
        const updated: BarcodeItem = { ...item, quantity: q };
        await this.db.items.put(updated);
        await this.touchCollection(item.collectionId);
        return updated;
      })
    );
  }

  /**
   * Ändert die Menge um `delta` (z. B. +1 / −1). Die Menge bleibt zwischen 1 und 9999; zum Entfernen dient {@link removeItem}.
   * @param itemId - Eintrags-ID.
   * @param delta - Änderung (ganze Zahl).
   * @returns aktualisierter Eintrag.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_SYNTAX_INVALID` (Grenze über-/unterschritten), `ERR_STORAGE_*`.
   */
  async changeQuantity(itemId: string, delta: number): Promise<BarcodeItem> {
    if (!Number.isInteger(delta)) throw badInput('Die Mengenänderung muss eine ganze Zahl sein.');
    const item = await this.requireItem(itemId);
    return this.setQuantity(itemId, item.quantity + delta);
  }

  /**
   * Entfernt einen Eintrag und nummeriert die Positionen lückenlos neu.
   * @param itemId - Eintrags-ID.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_STORAGE_*`.
   */
  async removeItem(itemId: string): Promise<void> {
    await guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        const item = await this.requireItem(itemId);
        await this.db.items.delete(itemId);
        await this.renumber(item.collectionId);
        await this.touchCollection(item.collectionId);
      })
    );
  }

  /**
   * Verschiebt einen Eintrag an eine neue Position (0-basiert); die übrigen rücken nach.
   * @param itemId - Eintrags-ID.
   * @param toPosition - Zielposition (0 … Anzahl−1).
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_SYNTAX_INVALID` (Zielposition ungültig), `ERR_STORAGE_*`.
   */
  async moveItem(itemId: string, toPosition: number): Promise<void> {
    await guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        const item = await this.requireItem(itemId);
        const items = (await this.db.items.where('collectionId').equals(item.collectionId).toArray()).sort((a, b) => a.position - b.position);
        if (!Number.isInteger(toPosition) || toPosition < 0 || toPosition >= items.length) {
          throw badInput(`Die Zielposition muss zwischen 1 und ${items.length} liegen.`);
        }
        const from = items.findIndex((i) => i.id === itemId);
        const [moved] = items.splice(from, 1);
        if (!moved) throw new AppError('ERR_NOT_FOUND', { details: itemId });
        items.splice(toPosition, 0, moved);
        await this.db.items.bulkPut(items.map((it, idx) => ({ ...it, position: idx })));
        await this.touchCollection(item.collectionId);
      })
    );
  }

  /**
   * Ersetzt die Zusatzangaben (Wort, Nutzen, Satz, Tags, Ablaufdatum) eines Eintrags vollständig:
   * nicht angegebene Felder werden entfernt. Wert, Format und Menge bleiben unverändert.
   * @param itemId - Eintrags-ID.
   * @param input - neue Angaben (leer = entfernen).
   * @returns aktualisierter Eintrag.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_SYNTAX_INVALID` (zu lang, ungültiges Datum), `ERR_STORAGE_*`.
   */
  async updateItemMeta(itemId: string, input: ItemMetaInput): Promise<BarcodeItem> {
    const meta = normalizeItemMeta(input);
    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        const item = await this.requireItem(itemId);
        const updated: BarcodeItem = { ...item };
        delete updated.label;
        delete updated.purpose;
        delete updated.note;
        delete updated.tags;
        delete updated.expiresAt;
        Object.assign(updated, meta);
        await this.db.items.put(updated);
        await this.touchCollection(item.collectionId);
        return updated;
      })
    );
  }

  /**
   * Setzt oder löscht das Ablaufdatum mehrerer Einträge gleichzeitig (atomar).
   * @param itemIds - betroffene Einträge.
   * @param expiresAt - Datum (`JJJJ-MM-TT` oder `TT.MM.JJJJ`) oder `null`, um das Datum zu entfernen.
   * @returns Anzahl geänderter Einträge.
   * @throws {AppError} `ERR_SYNTAX_INVALID` bei ungültigem Datum, `ERR_STORAGE_*`.
   */
  async setExpiry(itemIds: readonly string[], expiresAt: string | null): Promise<number> {
    const date = expiresAt === null ? undefined : normalizeItemMeta({ expiresAt }).expiresAt;
    if (expiresAt !== null && date === undefined) throw badInput('Bitte ein Datum angeben.');
    if (itemIds.length === 0) return 0;
    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        const items = (await this.db.items.bulkGet([...itemIds])).filter((i): i is BarcodeItem => i !== undefined);
        const updated = items.map((item) => {
          const next: BarcodeItem = { ...item };
          if (date === undefined) delete next.expiresAt;
          else next.expiresAt = date;
          return next;
        });
        await this.db.items.bulkPut(updated);
        for (const id of new Set(updated.map((i) => i.collectionId))) await this.touchCollection(id);
        return updated.length;
      })
    );
  }

  /**
   * Liefert einen noch nicht vergebenen Sammlungsnamen (`Name`, `Name (2)`, `Name (3)` …).
   * @param wanted - Wunschname.
   * @returns freier Name innerhalb der 100-Zeichen-Grenze.
   */
  async uniqueCollectionName(wanted: string): Promise<string> {
    const base = cleanName(wanted);
    const used = new Set((await this.db.collections.toArray()).map((c) => c.name.toLocaleLowerCase('de')));
    if (!used.has(base.toLocaleLowerCase('de'))) return base;
    for (let n = 2; n < 1000; n++) {
      const suffix = ` (${n})`;
      const candidate = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
      if (!used.has(candidate.toLocaleLowerCase('de'))) return candidate;
    }
    throw badInput('Es konnte kein freier Sammlungsname gefunden werden.');
  }

  /**
   * Importiert eine geteilte Sammlung als NEUE Sammlung (vorhandene Daten bleiben unberührt; bei Namensgleichheit
   * wird ` (2)` angehängt). Scheitert das Speichern der Codes, wird die neue Sammlung wieder entfernt.
   * @param file - geprüfte Austauschdatei.
   * @param library - optional: Verknüpfung mit einer Bibliotheksdatei (für spätere Updates).
   * @returns neue Sammlung und Anzahl Codes.
   * @throws {AppError} `ERR_SYNTAX_INVALID`/`ERR_CHECKSUM_INVALID` (kann bei geprüften Dateien nicht vorkommen), `ERR_STORAGE_*`.
   */
  async importShare(file: ShareFile, library?: LibraryLink): Promise<ShareImportResult> {
    let collection = await this.createCollection(await this.uniqueCollectionName(file.collection.name));
    try {
      if (library) {
        collection = { ...collection, library };
        await guardWrite(() => this.db.collections.put(collection));
      }
      await this.addItems(
        collection.id,
        file.items.map((i) => ({ ...i, source: 'import' as const })),
        'append'
      );
    } catch (error: unknown) {
      // Aufräumen: keine halb importierte Sammlung zurücklassen; der ursprüngliche Fehler bleibt maßgeblich.
      await this.deleteCollection(collection.id).catch(() => undefined);
      throw error;
    }
    return { collection, items: file.items.length };
  }

  /**
   * Ersetzt den Inhalt einer Bibliotheks-Sammlung durch die veröffentlichte Version (atomar: alles oder nichts).
   * Die Sammlung behält ID und lokalen Namen; lokale Änderungen an den Codes gehen verloren.
   * @param collectionId - lokale Sammlung.
   * @param file - geprüfte Austauschdatei.
   * @param library - neue Verknüpfung (Fingerabdruck der übernommenen Version).
   * @returns aktualisierte Sammlung und Anzahl Codes.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_STORAGE_*`.
   */
  async replaceFromShare(collectionId: string, file: ShareFile, library: LibraryLink): Promise<ShareImportResult> {
    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, async () => {
        await this.requireCollection(collectionId);
        await this.db.items.where('collectionId').equals(collectionId).delete();
        await this.addItems(
          collectionId,
          file.items.map((i) => ({ ...i, source: 'import' as const })),
          'append'
        );
        const updated: Collection = { ...(await this.requireCollection(collectionId)), library };
        await this.db.collections.put(updated);
        return { collection: updated, items: file.items.length };
      })
    );
  }

  /**
   * Löst eine Sammlung von der Bibliothek: Sie bleibt als eigene Sammlung erhalten und wird nicht mehr aktualisiert.
   * @param collectionId - Sammlung.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_STORAGE_*`.
   */
  async detachLibrary(collectionId: string): Promise<void> {
    await guardWrite(() =>
      this.db.transaction('rw', this.db.collections, async () => {
        const c = await this.requireCollection(collectionId);
        const next: Collection = { ...c };
        delete next.library;
        await this.db.collections.put(next);
      })
    );
  }

  // ------------------------------------------------------------ Artikelstamm

  /**
   * Ersetzt den gesamten Artikelstamm (importierter Stand mit Quelle und Datum).
   * @param products - neue Produkte (Kennungen müssen eindeutig sein).
   * @throws {AppError} `ERR_SYNTAX_INVALID` bei Duplikaten/leeren Kennungen, `ERR_STORAGE_*`.
   */
  async replaceCatalog(products: readonly CatalogProduct[]): Promise<void> {
    const seen = new Set<string>();
    for (const p of products) {
      if (typeof p.value !== 'string' || p.value === '') throw badInput('Ein Artikelstamm-Eintrag hat keine Kennung.');
      if (seen.has(p.value)) throw badInput(`Die Kennung ${p.value} kommt im Artikelstamm doppelt vor.`);
      seen.add(p.value);
    }
    await guardWrite(() =>
      this.db.transaction('rw', this.db.catalog, async () => {
        await this.db.catalog.clear();
        await this.db.catalog.bulkAdd([...products]);
      })
    );
  }

  /** @returns Anzahl der Artikelstamm-Einträge. */
  async catalogSize(): Promise<number> {
    return this.db.catalog.count();
  }

  /**
   * Gleicht die Einträge einer Sammlung mit dem importierten Artikelstamm ab
   * (`known` / `inactive` / `unknown`, mit Quelle und Datum). Ohne Artikelstamm bleibt alles `unchecked`.
   * Das Ergebnis gilt nur für den importierten Stand, nicht für den späteren Kassenzustand.
   * @param collectionId - Sammlung.
   * @returns Zusammenfassung.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_STORAGE_*`.
   */
  async checkAgainstCatalog(collectionId: string): Promise<CatalogCheckSummary> {
    return guardWrite(() =>
      this.db.transaction('rw', this.db.collections, this.db.items, this.db.catalog, async () => {
        await this.requireCollection(collectionId);
        const summary: CatalogCheckSummary = { known: 0, unknown: 0, inactive: 0, catalogEmpty: false };
        if ((await this.db.catalog.count()) === 0) return { ...summary, catalogEmpty: true };
        const items = await this.db.items.where('collectionId').equals(collectionId).toArray();
        const now = this.deps.now();
        const updated: BarcodeItem[] = [];
        for (const item of items) {
          const product = await this.db.catalog.get(item.value);
          const status: CatalogStatus = !product ? 'unknown' : product.active ? 'known' : 'inactive';
          summary[status as 'known' | 'unknown' | 'inactive']++;
          updated.push({ ...item, catalogStatus: status, catalogCheckedAt: now, catalogSource: product?.source ?? 'Artikelstamm (kein Treffer)' });
        }
        await this.db.items.bulkPut(updated);
        return summary;
      })
    );
  }

  // ------------------------------------------------------------ Vorlagen & Profile

  /**
   * Speichert (legt an oder überschreibt) eine Sequenzvorlage.
   * @param template - Vorlage.
   * @throws {AppError} `ERR_SYNTAX_INVALID` bei leerem Namen, `ERR_STORAGE_*`.
   */
  async saveTemplate(template: SequenceTemplate): Promise<SequenceTemplate> {
    const saved: SequenceTemplate = { ...template, name: cleanName(template.name), updatedAt: this.deps.now() };
    await guardWrite(() => this.db.templates.put(saved));
    return saved;
  }

  /** @returns alle Vorlagen nach Name. */
  async listTemplates(): Promise<SequenceTemplate[]> {
    return (await this.db.templates.toArray()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Löscht eine Vorlage.
   * @param id - Vorlagen-ID.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async deleteTemplate(id: string): Promise<void> {
    await guardWrite(() => this.db.templates.delete(id));
  }

  /**
   * Speichert ein Scannerprofil nach Prüfung der Werte.
   * @param profile - Profil.
   * @throws {AppError} `ERR_SYNTAX_INVALID` mit den Problemen, `ERR_STORAGE_*`.
   */
  async saveProfile(profile: FaderProfile): Promise<FaderProfile> {
    const problems = validateProfile(profile);
    if (problems.length > 0) throw badInput(problems.join(' '));
    await guardWrite(() => this.db.profiles.put({ ...profile }));
    return profile;
  }

  /**
   * Liefert alle Profile; legt beim ersten Aufruf (leere Tabelle) die Standardprofile an.
   * @returns Profile nach Anzeigezeit (absteigend), dann Name.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async listProfiles(): Promise<FaderProfile[]> {
    if ((await this.db.profiles.count()) === 0) {
      await guardWrite(() => this.db.profiles.bulkPut(DEFAULT_PROFILES.map((p) => ({ ...p }))));
    }
    return (await this.db.profiles.toArray()).sort((a, b) => b.displayMs - a.displayMs || a.name.localeCompare(b.name));
  }

  /**
   * Löscht ein Profil.
   * @param id - Profil-ID.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async deleteProfile(id: string): Promise<void> {
    await guardWrite(() => this.db.profiles.delete(id));
  }

  // ------------------------------------------------------------ Interna

  private async requireCollection(id: string): Promise<Collection> {
    const c = await this.db.collections.get(id);
    if (!c) throw new AppError('ERR_NOT_FOUND', { details: `Sammlung ${id}`, userMessage: 'Die Sammlung existiert nicht (mehr).' });
    return c;
  }

  private async requireItem(id: string): Promise<BarcodeItem> {
    const i = await this.db.items.get(id);
    if (!i) throw new AppError('ERR_NOT_FOUND', { details: `Eintrag ${id}`, userMessage: 'Der Eintrag existiert nicht (mehr).' });
    return i;
  }

  private async touchCollection(id: string): Promise<void> {
    const c = await this.db.collections.get(id);
    if (c) await this.db.collections.put({ ...c, updatedAt: this.deps.now() });
  }

  private async renumber(collectionId: string): Promise<void> {
    const items = (await this.db.items.where('collectionId').equals(collectionId).toArray()).sort((a, b) => a.position - b.position);
    const changed = items.map((it, idx) => ({ ...it, position: idx })).filter((it, idx) => it.position !== items[idx]?.position);
    if (changed.length > 0) await this.db.items.bulkPut(changed);
  }
}
