/**
 * Import beliebiger Quellen: geteilte Sammlungen (`*.barq.json`, Link), Voll-Backups (als neue Sammlungen),
 * CSV-Dateien und einfache Textlisten (eine Zeile = ein Code).
 *
 * Vorgehen in zwei Schritten: {@link ImportService.inspect} prüft den Inhalt vollständig und liefert einen Plan
 * (nichts wird gespeichert); erst {@link ImportService.commitCollections} bzw. {@link ImportService.commitRows}
 * schreiben. Ein Import überschreibt nie vorhandene Daten – es entstehen immer neue Sammlungen bzw. zusätzliche Positionen.
 */
import { AppError } from '../domain/errors';
import { parseBulkInput } from '../domain/bulk-parser';
import { parseItemsCsv, type CsvRowError } from '../domain/csv-items';
import { isExpired } from '../domain/expiry';
import { detectImportKind, parseShareText, shareFilesFromBackupText, type ShareFile } from '../domain/share-format';
import type { Symbology } from '../domain/types';
import type { BarqDatabase } from '../adapters/persistence/db';
import { BackupService, type CsvImportReport } from './backup-service';
import { CollectionService, defaultDeps, type DuplicateRule, type ServiceDeps } from './collection-service';

/** Plan für JSON-Quellen: eine oder mehrere komplette Sammlungen. */
export interface CollectionsPlan {
  kind: 'collections';
  /** `share` = geteilte Sammlung, `backup` = Voll-Backup (nur die Sammlungen werden übernommen). */
  source: 'share' | 'backup';
  files: ShareFile[];
  totalItems: number;
  /** Anzahl bereits abgelaufener Codes (werden mitimportiert und als abgelaufen markiert). */
  expiredItems: number;
}

/** Plan für Tabellen/Listen: Codes werden einer Sammlung hinzugefügt. */
export interface RowsPlan {
  kind: 'rows';
  format: 'csv' | 'lines';
  text: string;
  /** Anzahl gültiger Zeilen bei Standardeinstellungen (CSV) bzw. nichtleere Zeilen (Liste). */
  rowCount: number;
  /** Fehler bei der Vorprüfung (CSV: mit erkannter Zuordnung). */
  errors: CsvRowError[];
  /** CSV ohne Symbologie-Spalte: Der Benutzer muss ein Standardformat wählen. */
  needsSymbology: boolean;
}

/** Ergebnis von {@link ImportService.inspect}. */
export type ImportPlan = CollectionsPlan | RowsPlan;

/** Ziel eines Zeilen-Imports. */
export type RowsTarget = { collectionId: string } | { newName: string };

/** Optionen des Zeilen-Imports. */
export interface RowsOptions {
  defaultSymbology: Symbology;
  /** `abort` (Standard): bei Fehlern nichts speichern; `skip-invalid`: gültige Zeilen speichern. */
  onError?: 'abort' | 'skip-invalid';
  duplicate?: DuplicateRule;
}

/** Bericht des Zeilen-Imports. */
export interface RowsReport extends CsvImportReport {
  /** ID der Zielsammlung (bei Abbruch ohne neue Sammlung `null`). */
  collectionId: string | null;
}

/** Dienst für den Import aus Dateien, Text und Links. */
export class ImportService {
  private readonly collections: CollectionService;
  private readonly backup: BackupService;

  /**
   * @param db - Datenbank.
   * @param appVersion - App-Version (für Folgedienste).
   * @param deps - ID- und Zeitquelle.
   */
  constructor(db: BarqDatabase, appVersion: string, deps: ServiceDeps = defaultDeps) {
    this.collections = new CollectionService(db, deps);
    this.backup = new BackupService(db, appVersion, deps);
  }

  /**
   * Prüft einen Text vollständig, ohne etwas zu speichern.
   * @param text - Dateiinhalt oder eingefügter Text.
   * @param today - heutiger Kalendertag (nur zur Zählung abgelaufener Codes).
   * @returns Importplan.
   * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID` (JSON unbrauchbar), `ERR_IMPORT_CSV_INVALID` (leer/nicht zuordenbar).
   */
  inspect(text: string, today: string): ImportPlan {
    if (text.trim() === '') {
      throw new AppError('ERR_IMPORT_CSV_INVALID', { details: 'leere Eingabe', userMessage: 'Die Datei bzw. der Text ist leer.' });
    }
    const kind = detectImportKind(text);
    if (kind === 'collection' || kind === 'backup') {
      const files = kind === 'collection' ? [parseShareText(text)] : shareFilesFromBackupText(text);
      const all = files.flatMap((f) => f.items);
      return { kind: 'collections', source: kind === 'collection' ? 'share' : 'backup', files, totalItems: all.length, expiredItems: all.filter((i) => isExpired(i.expiresAt, today)).length };
    }
    if (kind === 'json-other') {
      throw new AppError('ERR_IMPORT_SCHEMA_INVALID', { details: 'unbekanntes JSON', userMessage: 'Diese JSON-Datei ist keine BarQPlayer-Sammlung und kein BarQPlayer-Backup.' });
    }
    return this.inspectRows(text);
  }

  private inspectRows(text: string): RowsPlan {
    const firstLine = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
    const looksLikeCsv = /[;,\t]/.test(firstLine) && /[a-zA-ZäöüÄÖÜ]/.test(firstLine.replace(/\d/g, ''));
    if (looksLikeCsv) {
      try {
        const parsed = parseItemsCsv(text, { defaultSymbology: 'EAN13' });
        if (parsed.mapping.value !== undefined) {
          const needsSymbology = parsed.mapping.symbology === undefined;
          // Ohne Symbologie-Spalte sind Fehler der Vorprüfung (Standardformat geraten) noch nicht aussagekräftig.
          return { kind: 'rows', format: 'csv', text, rowCount: parsed.rows.length + parsed.errors.length, errors: needsSymbology ? [] : parsed.errors, needsSymbology };
        }
      } catch (error: unknown) {
        if (!(error instanceof AppError) || error.code !== 'ERR_IMPORT_CSV_INVALID') throw error;
        // keine erkennbare Wertspalte → als einfache Liste behandeln
      }
    }
    const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
    return { kind: 'rows', format: 'lines', text, rowCount: lines.length, errors: [], needsSymbology: true };
  }

  /**
   * Importiert komplette Sammlungen als neue Sammlungen (nacheinander; bei einem Fehler bleiben bereits
   * importierte Sammlungen bestehen, die fehlerhafte wird zurückgerollt).
   * @param files - geprüfte Dateien.
   * @returns Anzahl neuer Sammlungen und Codes.
   * @throws {AppError} `ERR_STORAGE_*`.
   */
  async commitCollections(files: readonly ShareFile[]): Promise<{ collections: number; items: number; names: string[] }> {
    let items = 0;
    const names: string[] = [];
    for (const f of files) {
      const r = await this.collections.importShare(f);
      items += r.items;
      names.push(r.collection.name);
    }
    return { collections: files.length, items, names };
  }

  /**
   * Importiert eine Tabelle oder Liste in eine neue oder vorhandene Sammlung.
   * @param plan - Plan aus {@link inspect}.
   * @param target - Zielsammlung oder Name einer neuen Sammlung.
   * @param options - Standardformat, Fehler- und Duplikatregel.
   * @returns Bericht.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_IMPORT_CSV_INVALID`, `ERR_STORAGE_*`.
   */
  async commitRows(plan: RowsPlan, target: RowsTarget, options: RowsOptions): Promise<RowsReport> {
    const onError = options.onError ?? 'abort';
    const duplicate = options.duplicate ?? 'merge';
    // Vorab prüfen, damit bei Abbruch keine leere neue Sammlung entsteht.
    let preErrors: CsvRowError[];
    if (plan.format === 'csv') {
      preErrors = parseItemsCsv(plan.text, { defaultSymbology: options.defaultSymbology }).errors;
    } else {
      const r = parseBulkInput(plan.text, { symbology: options.defaultSymbology, duplicates: 'keep' });
      preErrors = r.errors.map((e) => ({ line: e.line, code: e.code, message: e.message }));
    }
    if (preErrors.length > 0 && onError === 'abort') return { imported: 0, aborted: true, errors: preErrors, collectionId: null };

    const created = 'newName' in target ? await this.collections.createCollection(await this.collections.uniqueCollectionName(target.newName)) : null;
    const collectionId = created?.id ?? (target as { collectionId: string }).collectionId;
    try {
      if (plan.format === 'csv') {
        const report = await this.backup.importCollectionCsv(collectionId, plan.text, { defaultSymbology: options.defaultSymbology, onError, duplicate });
        return { ...report, collectionId };
      }
      const parsed = parseBulkInput(plan.text, { symbology: options.defaultSymbology, duplicates: duplicate === 'merge' ? 'merge' : 'keep' });
      if (parsed.entries.length > 0) {
        await this.collections.addItems(collectionId, parsed.entries.map((e) => ({ symbology: e.symbology, value: e.value, quantity: e.quantity, source: 'import' as const })), duplicate);
      }
      return { imported: parsed.entries.length, aborted: false, errors: preErrors, collectionId };
    } catch (error: unknown) {
      if (created) await this.collections.deleteCollection(created.id).catch(() => undefined);
      throw error;
    }
  }
}
