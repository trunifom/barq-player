/**
 * Abbildung von CSV-Zeilen auf Code-Einträge und Artikelstamm-Einträge inklusive Spaltenzuordnung
 * und zeilengenauem Fehlerbericht. Werte werden nie still korrigiert (z. B. durch Excel verlorene
 * führende Nullen führen zu einem Fehler mit Hinweis).
 */
import { AppError, type ErrorCode } from './errors';
import { parseCsv, serializeCsv, unprotectFormula, type CsvDelimiter, type CsvRow } from './csv';
import { validateCodeValue } from './bulk-parser';
import type { BarcodeItem, CatalogProduct, Symbology } from './types';

/** Zielfelder der Spaltenzuordnung für Code-Listen. */
export type CsvItemField = 'value' | 'symbology' | 'quantity' | 'label';

/** Zuordnung Feld → Spaltenindex (0-basiert). */
export type CsvMapping = Partial<Record<CsvItemField, number>>;

/** Maximale Menge je Position. */
export const MAX_QUANTITY = 9999;

/** Gültige Zeile aus einer CSV-Datei. */
export interface CsvItemRow {
  line: number;
  symbology: Symbology;
  value: string;
  quantity: number;
  checksumStatus: BarcodeItem['checksumStatus'];
  label?: string;
}

/** Fehler zu einer CSV-Zeile. */
export interface CsvRowError {
  line: number;
  code: ErrorCode;
  message: string;
}

/** Ergebnis der Zeilenabbildung. */
export interface CsvItemsResult {
  rows: CsvItemRow[];
  errors: CsvRowError[];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s_\-.]/g, '');

const FIELD_ALIASES: Record<CsvItemField, readonly string[]> = {
  value: ['value', 'wert', 'code', 'barcode', 'ean', 'gtin', 'inhalt', 'artikelnummer'],
  symbology: ['symbology', 'symbologie', 'format', 'typ', 'type'],
  quantity: ['quantity', 'menge', 'anzahl', 'qty'],
  label: ['label', 'bezeichnung', 'name', 'beschreibung', 'artikel']
};

/**
 * Schlägt anhand der Kopfzeile eine Spaltenzuordnung vor (deutsche und englische Namen).
 * @param headers - Kopfzeilenzellen.
 * @returns Zuordnung; nicht erkannte Felder fehlen.
 */
export function suggestCsvMapping(headers: readonly string[]): CsvMapping {
  const mapping: CsvMapping = {};
  const used = new Set<number>();
  for (const field of Object.keys(FIELD_ALIASES) as CsvItemField[]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && FIELD_ALIASES[field].includes(norm(h)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

/**
 * Wandelt einen Symbologie-Text in den internen Typ.
 * @param text - z. B. `EAN-13`, `qr`, `Code 128`.
 * @returns Symbologie oder `null`, wenn unbekannt.
 */
export function parseSymbologyName(text: string): Symbology | null {
  switch (norm(text)) {
    case 'ean13':
      return 'EAN13';
    case 'ean8':
      return 'EAN8';
    case 'qr':
    case 'qrcode':
      return 'QRCode';
    case 'code128':
      return 'Code128';
    case 'upca':
    case 'upc':
      return 'UPCA';
    default:
      return null;
  }
}

function rowError(line: number, code: ErrorCode, message: string): CsvRowError {
  return { line, code, message: `Zeile ${line}: ${message}` };
}

/** Wandelt einen Mengentext in eine Zahl (leer = 1). */
function parseQuantity(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return 1;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_QUANTITY ? n : null;
}

/** Optionen für {@link mapCsvItems}. */
export interface MapCsvItemsOptions {
  /** Symbologie für Zeilen ohne Symbologie-Spalte bzw. mit leerer Zelle. */
  defaultSymbology?: Symbology;
}

/**
 * Bildet Datenzeilen (ohne Kopfzeile) auf Code-Einträge ab; jede Zeile wird einzeln validiert.
 * @param rows - Datenzeilen.
 * @param mapping - Spaltenzuordnung (mindestens `value`).
 * @param options - Standardsymbologie.
 * @returns gültige Zeilen und zeilengenaue Fehler (ungültige Zeilen erscheinen nie in `rows`).
 * @throws {AppError} `ERR_IMPORT_CSV_INVALID`, wenn `value` nicht zugeordnet ist oder weder Symbologie-Spalte noch Standard vorhanden ist.
 */
export function mapCsvItems(rows: readonly CsvRow[], mapping: CsvMapping, options: MapCsvItemsOptions = {}): CsvItemsResult {
  if (mapping.value === undefined) {
    throw new AppError('ERR_IMPORT_CSV_INVALID', { details: 'Keine Spalte für den Wert zugeordnet', userMessage: 'Es ist keine Spalte für den Code-Wert zugeordnet.' });
  }
  if (mapping.symbology === undefined && options.defaultSymbology === undefined) {
    throw new AppError('ERR_IMPORT_CSV_INVALID', {
      details: 'Weder Symbologie-Spalte noch Standardsymbologie',
      userMessage: 'Bitte eine Symbologie-Spalte zuordnen oder ein Standardformat wählen.'
    });
  }
  const out: CsvItemRow[] = [];
  const errors: CsvRowError[] = [];
  const cell = (r: CsvRow, idx: number | undefined): string => (idx === undefined ? '' : unprotectFormula(r.cells[idx] ?? ''));

  for (const r of rows) {
    if (r.cells.every((c) => c.trim() === '')) continue;
    const symText = cell(r, mapping.symbology).trim();
    let symbology: Symbology | null;
    if (symText === '') symbology = options.defaultSymbology ?? null;
    else symbology = parseSymbologyName(symText);
    if (!symbology) {
      errors.push(rowError(r.line, 'ERR_IMPORT_CSV_INVALID', symText === '' ? 'Symbologie fehlt.' : `Unbekannte Symbologie „${symText}“.`));
      continue;
    }
    const raw = cell(r, mapping.value);
    const check = validateCodeValue(raw, symbology, { multiline: true });
    if (!check.ok) {
      const hint = check.code === 'ERR_SYNTAX_INVALID' && /^\d+$/.test(raw.trim()) && (symbology === 'EAN13' || symbology === 'EAN8' || symbology === 'UPCA')
        ? ' Hinweis: Tabellenprogramme entfernen führende Nullen; Spalte als Text importieren.'
        : '';
      errors.push(rowError(r.line, check.code, `${check.message}${hint}`));
      continue;
    }
    const quantity = parseQuantity(cell(r, mapping.quantity));
    if (quantity === null) {
      errors.push(rowError(r.line, 'ERR_IMPORT_CSV_INVALID', `Ungültige Menge „${cell(r, mapping.quantity)}“ (erlaubt: 1–${MAX_QUANTITY}).`));
      continue;
    }
    const label = cell(r, mapping.label).trim();
    out.push({
      line: r.line,
      symbology,
      value: check.value,
      quantity,
      checksumStatus: check.checksum,
      ...(label === '' ? {} : { label })
    });
  }
  return { rows: out, errors };
}

/** Ergebnis von {@link parseItemsCsv}. */
export interface ParsedItemsCsv extends CsvItemsResult {
  headers: string[];
  mapping: CsvMapping;
  delimiter: CsvDelimiter;
}

/** Optionen für {@link parseItemsCsv}. */
export interface ParseItemsCsvOptions extends MapCsvItemsOptions {
  /** Manuelle Zuordnung; ohne Angabe wird sie aus der Kopfzeile abgeleitet. */
  mapping?: CsvMapping;
}

/**
 * Komfortfunktion: CSV-Text einlesen, Kopfzeile auswerten, Zeilen abbilden.
 * @param text - CSV-Text mit Kopfzeile.
 * @param options - Zuordnung und Standardsymbologie.
 * @returns Kopfzeile, verwendete Zuordnung und Ergebnis.
 * @throws {AppError} `ERR_IMPORT_CSV_INVALID` bei leerer Datei oder fehlender Zuordnung.
 */
export function parseItemsCsv(text: string, options: ParseItemsCsvOptions = {}): ParsedItemsCsv {
  const parsed = parseCsv(text);
  const [headerRow, ...data] = parsed.rows;
  if (!headerRow) {
    throw new AppError('ERR_IMPORT_CSV_INVALID', { details: 'Datei ist leer', userMessage: 'Die CSV-Datei ist leer.' });
  }
  const mapping = options.mapping ?? suggestCsvMapping(headerRow.cells);
  const result = mapCsvItems(data, mapping, options.defaultSymbology === undefined ? {} : { defaultSymbology: options.defaultSymbology });
  return { ...result, headers: headerRow.cells, mapping, delimiter: parsed.delimiter };
}

/**
 * Exportiert Einträge einer Sammlung als CSV (Kopfzeile + eine Zeile je Eintrag, nach Position sortiert).
 * @param items - Einträge.
 * @param collectionName - Name der Sammlung (erste Spalte).
 * @returns CSV-Text (Formelschutz aktiv).
 */
export function itemsToCsv(items: readonly BarcodeItem[], collectionName: string): string {
  const header = ['collection', 'position', 'symbology', 'value', 'quantity', 'label', 'source', 'syntaxStatus', 'checksumStatus', 'catalogStatus'];
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const rows = sorted.map((i) => [
    collectionName,
    String(i.position + 1),
    i.symbology,
    i.value,
    String(i.quantity),
    i.label ?? '',
    i.source,
    i.syntaxStatus,
    i.checksumStatus,
    i.catalogStatus
  ]);
  return serializeCsv([header, ...rows]);
}

/** Ergebnis des Artikelstamm-CSV-Imports. */
export interface CatalogCsvResult {
  products: CatalogProduct[];
  errors: CsvRowError[];
}

const ACTIVE_TRUE = ['1', 'true', 'ja', 'yes', 'aktiv', 'active', 'j', 'y'];
const ACTIVE_FALSE = ['0', 'false', 'nein', 'no', 'inaktiv', 'inactive', 'n'];

/**
 * Liest einen Artikelstamm aus CSV (Spalten: Kennung, optional aktiv, optional Bezeichnung).
 * Kennungen bleiben Strings; doppelte Kennungen sind Fehler.
 * @param text - CSV mit Kopfzeile.
 * @param meta - Quelle und Importzeitpunkt (Aktualitätsdatum, siehe Spezifikation 12.4).
 * @returns Produkte und zeilengenaue Fehler.
 * @throws {AppError} `ERR_IMPORT_CSV_INVALID`, wenn Datei leer oder keine Kennungsspalte erkennbar ist.
 */
export function parseCatalogCsv(text: string, meta: { source: string; importedAt: string }): CatalogCsvResult {
  const parsed = parseCsv(text);
  const [headerRow, ...data] = parsed.rows;
  if (!headerRow) throw new AppError('ERR_IMPORT_CSV_INVALID', { details: 'Datei ist leer', userMessage: 'Die CSV-Datei ist leer.' });
  const find = (aliases: string[]): number => headerRow.cells.findIndex((h) => aliases.includes(norm(h)));
  const valueIdx = find(['value', 'wert', 'code', 'ean', 'gtin', 'barcode', 'kennung', 'artikelnummer']);
  if (valueIdx < 0) {
    throw new AppError('ERR_IMPORT_CSV_INVALID', {
      details: 'Keine Kennungsspalte',
      userMessage: 'Es wurde keine Spalte für die Artikelkennung erkannt (z. B. „EAN“, „GTIN“, „Code“).'
    });
  }
  const activeIdx = find(['active', 'aktiv', 'status']);
  const labelIdx = find(['label', 'bezeichnung', 'name', 'beschreibung', 'artikel']);
  const products: CatalogProduct[] = [];
  const errors: CsvRowError[] = [];
  const seen = new Set<string>();
  for (const r of data) {
    if (r.cells.every((c) => c.trim() === '')) continue;
    const value = unprotectFormula(r.cells[valueIdx] ?? '').trim();
    if (value === '') {
      errors.push(rowError(r.line, 'ERR_IMPORT_CSV_INVALID', 'Kennung fehlt.'));
      continue;
    }
    if (seen.has(value)) {
      errors.push(rowError(r.line, 'ERR_IMPORT_CSV_INVALID', `Kennung ${value} kommt doppelt vor.`));
      continue;
    }
    let active = true;
    if (activeIdx >= 0) {
      const a = norm(r.cells[activeIdx] ?? '');
      if (a === '') active = true;
      else if (ACTIVE_TRUE.includes(a)) active = true;
      else if (ACTIVE_FALSE.includes(a)) active = false;
      else {
        errors.push(rowError(r.line, 'ERR_IMPORT_CSV_INVALID', `Unbekannter Aktiv-Status „${r.cells[activeIdx] ?? ''}“.`));
        continue;
      }
    }
    seen.add(value);
    const label = labelIdx >= 0 ? unprotectFormula(r.cells[labelIdx] ?? '').trim() : '';
    products.push({ value, active, source: meta.source, importedAt: meta.importedAt, ...(label === '' ? {} : { label }) });
  }
  return { products, errors };
}
