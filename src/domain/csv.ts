/**
 * CSV-Lesen und -Schreiben (RFC 4180) mit Schutz vor Tabellenformel-Injection.
 *
 * Alle Zellen bleiben Strings, damit führende Nullen erhalten bleiben (nie Zahlenumwandlung).
 *
 * Formelschutz (OWASP „CSV Injection“): Zellen, die mit `=`, `+`, `-`, `@`, Tab oder CR beginnen
 * (ggf. nach führenden Apostrophen), erhalten beim Schreiben ein zusätzliches `'` vorweg; beim Lesen
 * von Zellen mit {@link unprotectFormula} wird genau dieses eine `'` wieder entfernt. Dadurch ist der
 * Round-Trip verlustfrei, und Excel/Calc interpretieren exportierte Werte nie als Formel.
 */
import { AppError } from './errors';

/** Maximale Zeilenzahl beim Einlesen. */
export const MAX_CSV_ROWS = 100_000;

/** Unterstützte Trennzeichen. */
export type CsvDelimiter = ',' | ';' | '\t';

/** Eine eingelesene CSV-Zeile mit Startzeile im Quelltext. */
export interface CsvRow {
  /** 1-basierte Zeilennummer, in der der Datensatz beginnt. */
  line: number;
  cells: string[];
}

/** Ergebnis von {@link parseCsv}. */
export interface CsvParseResult {
  rows: CsvRow[];
  delimiter: CsvDelimiter;
  /** Übersprungene komplett leere Zeilen. */
  skippedBlankLines: number;
}

const DANGEROUS_START = /^'*[=+\-@\t\r]/;
const PROTECTED_START = /^'+[=+\-@\t\r]/;

/**
 * Schützt eine Zelle vor Formelinterpretation (siehe Dateikopf).
 * @param cell - Rohwert.
 * @returns Zelle, ggf. mit vorangestelltem `'`.
 */
export function protectFormula(cell: string): string {
  return DANGEROUS_START.test(cell) ? `'${cell}` : cell;
}

/**
 * Macht {@link protectFormula} rückgängig (entfernt genau ein führendes `'`, falls es geschützt wurde).
 * @param cell - gelesene Zelle.
 * @returns ursprünglicher Wert.
 */
export function unprotectFormula(cell: string): string {
  return PROTECTED_START.test(cell) ? cell.slice(1) : cell;
}

/**
 * Erkennt das Trennzeichen anhand der ersten nichtleeren Zeile (Anführungszeichen werden beachtet).
 * @param text - CSV-Text.
 * @returns häufigstes Trennzeichen, bei Gleichstand/keinem `,`.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of source) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === '\n' || ch === '\r') {
        if (counts[','] + counts[';'] + counts['\t'] > 0) break;
      } else if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++;
    }
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * Liest CSV-Text. Leere Zeilen werden übersprungen, Zeilenumbrüche in Anführungszeichen bleiben erhalten.
 * @param text - CSV-Text (BOM wird entfernt).
 * @param delimiter - Trennzeichen; ohne Angabe automatisch erkannt.
 * @returns Zeilen (alle Zellen als Strings), erkanntes Trennzeichen, Zähler.
 * @throws {AppError} `ERR_IMPORT_CSV_INVALID` bei offenem Anführungszeichen, Zeichen nach einem
 *   schließenden Anführungszeichen oder zu vielen Zeilen.
 */
export function parseCsv(text: string, delimiter?: CsvDelimiter): CsvParseResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = delimiter ?? detectDelimiter(src);
  const rows: CsvRow[] = [];
  let skipped = 0;

  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let afterQuote = false; // direkt nach schließendem Anführungszeichen
  let line = 1;
  let rowLine = 1;
  let rowHasContent = false;

  const fail = (message: string, atLine: number): AppError =>
    new AppError('ERR_IMPORT_CSV_INVALID', { details: `Zeile ${atLine}: ${message}`, userMessage: `CSV Zeile ${atLine}: ${message}` });

  const endCell = (): void => {
    cells.push(cell);
    cell = '';
    afterQuote = false;
  };
  const endRow = (): void => {
    endCell();
    if (cells.length === 1 && cells[0] === '' && !rowHasContent) {
      skipped++;
    } else {
      if (rows.length >= MAX_CSV_ROWS) {
        throw new AppError('ERR_IMPORT_CSV_INVALID', {
          details: `mehr als ${MAX_CSV_ROWS} Zeilen`,
          userMessage: `Die CSV-Datei hat mehr als ${MAX_CSV_ROWS} Zeilen.`
        });
      }
      rows.push({ line: rowLine, cells });
    }
    cells = [];
    rowHasContent = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell !== '' || afterQuote) throw fail('Anführungszeichen mitten in einem Feld', line);
      inQuotes = true;
      rowHasContent = true;
    } else if (ch === delim) {
      rowHasContent = true;
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src.charAt(i + 1) === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      if (afterQuote) throw fail('Zeichen nach dem schließenden Anführungszeichen', line);
      cell += ch;
      rowHasContent = true;
    }
  }
  if (inQuotes) throw fail('Anführungszeichen wurde nicht geschlossen', rowLine);
  if (cell !== '' || cells.length > 0 || afterQuote || rowHasContent) endRow();

  return { rows, delimiter: delim, skippedBlankLines: skipped };
}

/**
 * Schreibt Zeilen als CSV (CRLF, Formelschutz, Anführungszeichen nur wo nötig).
 * @param rows - Zeilen aus Strings.
 * @param delimiter - Trennzeichen (Standard `,`).
 * @returns CSV-Text mit abschließendem Zeilenende.
 */
export function serializeCsv(rows: readonly (readonly string[])[], delimiter: CsvDelimiter = ','): string {
  const quoteNeeded = (c: string): boolean => c.includes('"') || c.includes(delimiter) || c.includes('\n') || c.includes('\r') || c !== c.trim();
  return rows
    .map((row) =>
      row
        .map((raw) => {
          const c = protectFormula(raw);
          return quoteNeeded(c) ? `"${c.replace(/"/g, '""')}"` : c;
        })
        .join(delimiter)
    )
    .map((l) => `${l}\r\n`)
    .join('');
}
