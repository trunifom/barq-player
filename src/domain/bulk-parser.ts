/**
 * Parser und Validator für mehrzeilige manuelle/Bulk-Eingaben (eine Zeile = ein Code).
 *
 * Grundsatz: KEINE stille Autokorrektur. Ungültige Zeilen landen im Fehlerbericht und niemals
 * in den Ergebnissen. Die Symbologie wird explizit vorgegeben und nicht aus der Länge geraten.
 *
 * Normalisierungsregeln (bewusst minimal und dokumentiert):
 * - Ein BOM (U+FEFF) am Textanfang wird entfernt; Zeilenenden `\r\n`, `\n`, `\r` werden akzeptiert.
 * - Leere bzw. nur aus Leerraum bestehende Zeilen werden übersprungen (und gezählt).
 * - EAN-13/EAN-8/UPC-A: Darstellungsleerzeichen und Tabulatoren innerhalb der Zeile werden entfernt
 *   (z. B. `2 063701 028001`); danach müssen exakt die erwarteten Ziffern vorliegen und die Prüfziffer stimmen.
 * - Code 128: Leerraum am Zeilenanfang/-ende wird abgeschnitten, innere Leerzeichen bleiben; erlaubt sind
 *   druckbare ASCII-Zeichen (0x20–0x7E), 1–80 Zeichen.
 * - QR (Text): Inhalt bleibt unverändert (kein Trimmen); Steuerzeichen außer Tab sind verboten, max. 2000 UTF-8-Bytes.
 */
import { AppError, type ErrorCode } from './errors';
import { GTIN_BODY_LENGTH, validateGtin, type GtinSymbology } from './checksum';
import type { ChecksumStatus, Symbology, SyntaxStatus } from './types';

/** Maximale Zeilenzahl pro Eingabe. */
export const MAX_BULK_LINES = 10_000;
/** Maximale Länge eines QR-Textes in UTF-8-Bytes. */
export const MAX_QR_BYTES = 2000;
/** Maximale Länge eines Code-128-Inhalts. */
export const MAX_CODE128_LENGTH = 80;

/** Behandlung wiederholter Werte in der Liste. */
export type DuplicateMode = 'keep' | 'merge';

/** Optionen für {@link parseBulkInput}. */
export interface BulkParseOptions {
  /** Erwartete Symbologie aller Zeilen (explizit, nicht geraten). */
  symbology: Symbology;
  /** `keep` (Standard): jede Zeile bleibt ein Eintrag; `merge`: gleiche Werte werden zu einer Menge zusammengefasst. */
  duplicates?: DuplicateMode;
}

/** Gültig geparster Eintrag. */
export interface ParsedBulkEntry {
  /** 1-basierte Zeilennummer (bei `merge`: erste Fundstelle). */
  line: number;
  /** Ursprünglicher Zeilentext. */
  raw: string;
  /** Normalisierter Wert (immer String). */
  value: string;
  symbology: Symbology;
  quantity: number;
  syntaxStatus: SyntaxStatus;
  checksumStatus: ChecksumStatus;
}

/** Fehler zu einer einzelnen Zeile. */
export interface BulkLineError {
  line: number;
  raw: string;
  code: ErrorCode;
  /** Deutsche, zeilengenaue Meldung. */
  message: string;
}

/** Gesamtergebnis eines Parsings. */
export interface BulkParseResult {
  entries: ParsedBulkEntry[];
  errors: BulkLineError[];
  /** Anzahl übersprungener Leerzeilen. */
  skippedEmptyLines: number;
  /** `true`, wenn mindestens ein Eintrag und keine Fehler vorliegen. */
  ok: boolean;
}

/** UTF-8-Länge eines Strings ohne Browser-/Node-APIs. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Ergebnis der Validierung eines einzelnen Code-Werts. */
export type CodeValidation =
  | { ok: true; value: string; syntax: SyntaxStatus; checksum: ChecksumStatus }
  | { ok: false; code: ErrorCode; message: string };

function parseGtinLine(raw: string, symbology: GtinSymbology): CodeValidation {
  const value = raw.replace(/[ \t]/g, '');
  const result = validateGtin(value, symbology);
  if (result.syntax === 'valid' && result.checksum === 'valid') {
    return { ok: true, value, syntax: 'valid', checksum: 'valid' };
  }
  const total = GTIN_BODY_LENGTH[symbology] + 1;
  return {
    ok: false,
    code: result.errorCode ?? 'ERR_SYNTAX_INVALID',
    message: `${result.reason ?? `Ungültiger ${symbology}-Code.`} Erwartet: ${total} Ziffern. Der Code wurde nicht korrigiert.`
  };
}

function parseCode128Line(raw: string): CodeValidation {
  const value = raw.trim();
  if (value.length > MAX_CODE128_LENGTH) {
    return { ok: false, code: 'ERR_SYNTAX_INVALID', message: `Code 128 erlaubt höchstens ${MAX_CODE128_LENGTH} Zeichen (erhalten: ${value.length}).` };
  }
  if (!/^[\x20-\x7e]+$/.test(value)) {
    return { ok: false, code: 'ERR_SYNTAX_INVALID', message: 'Code 128 erlaubt nur druckbare ASCII-Zeichen (keine Umlaute oder Sonderzeichen).' };
  }
  return { ok: true, value, syntax: 'valid', checksum: 'not-applicable' };
}

function parseQrLine(raw: string, multiline: boolean): CodeValidation {
  // Mehrzeilige QR-Texte (z. B. vCard, WLAN) sind nur bei Einzelwerten erlaubt (LF/CR), nie in Bulk-Zeilen.
  // eslint-disable-next-line no-control-regex
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u0008\u000a-\u001f\u007f]/;
  if (forbidden.test(raw)) {
    return { ok: false, code: 'ERR_SYNTAX_INVALID', message: 'Der QR-Text enthält Steuerzeichen.' };
  }
  const bytes = utf8Length(raw);
  if (bytes > MAX_QR_BYTES) {
    return { ok: false, code: 'ERR_SYNTAX_INVALID', message: `Der QR-Text ist zu lang (${bytes} Bytes, erlaubt ${MAX_QR_BYTES}).` };
  }
  return { ok: true, value: raw, syntax: 'valid', checksum: 'not-applicable' };
}

/**
 * Validiert und normalisiert EINEN Code-Wert nach den Regeln seiner Symbologie (siehe Dateikopf).
 * @param raw - Rohwert (eine Zeile).
 * @param symbology - erwartete Symbologie.
 * @param options - `multiline: true` erlaubt bei QR Zeilenumbrüche im Text (Einzelwerte, nicht Bulk-Zeilen).
 * @returns normalisierter Wert samt Status oder zeilentauglicher Fehler (nie eine stille Korrektur).
 */
export function validateCodeValue(raw: string, symbology: Symbology, options: { multiline?: boolean } = {}): CodeValidation {
  if (raw.trim() === '') return { ok: false, code: 'ERR_SYNTAX_INVALID', message: 'Der Wert ist leer.' };
  if (symbology === 'EAN13' || symbology === 'EAN8' || symbology === 'UPCA') return parseGtinLine(raw, symbology);
  if (symbology === 'Code128') return parseCode128Line(raw);
  return parseQrLine(raw, options.multiline === true);
}

/**
 * Parst und validiert eine mehrzeilige Eingabe.
 * @param text - Rohtext (eine Zeile = ein Code).
 * @param options - Symbologie und Duplikatbehandlung.
 * @returns gültige Einträge, zeilengenaue Fehler und Zähler.
 * @throws {AppError} `ERR_BULK_INPUT_INVALID`, wenn der Text kein String ist oder mehr als {@link MAX_BULK_LINES} Zeilen hat.
 */
export function parseBulkInput(text: string, options: BulkParseOptions): BulkParseResult {
  if (typeof text !== 'string') {
    throw new AppError('ERR_BULK_INPUT_INVALID', { details: 'Eingabe ist kein String' });
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = source.split(/\r\n|\n|\r/);
  if (lines.length > MAX_BULK_LINES) {
    throw new AppError('ERR_BULK_INPUT_INVALID', {
      details: `${lines.length} Zeilen > ${MAX_BULK_LINES}`,
      userMessage: `Die Liste hat ${lines.length} Zeilen; erlaubt sind höchstens ${MAX_BULK_LINES}.`
    });
  }

  const { symbology } = options;
  const entries: ParsedBulkEntry[] = [];
  const errors: BulkLineError[] = [];
  const indexByValue = new Map<string, number>();
  let skippedEmptyLines = 0;

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') {
      skippedEmptyLines++;
      return;
    }
    const outcome = validateCodeValue(raw, symbology);

    if (!outcome.ok) {
      errors.push({ line, raw, code: outcome.code, message: `Zeile ${line}: ${outcome.message}` });
      return;
    }
    if (options.duplicates === 'merge') {
      const existing = indexByValue.get(outcome.value);
      const entry = existing === undefined ? undefined : entries[existing];
      if (entry) {
        entry.quantity += 1;
        return;
      }
      indexByValue.set(outcome.value, entries.length);
    }
    entries.push({
      line,
      raw,
      value: outcome.value,
      symbology,
      quantity: 1,
      syntaxStatus: outcome.syntax,
      checksumStatus: outcome.checksum
    });
  });

  return { entries, errors, skippedEmptyLines, ok: entries.length > 0 && errors.length === 0 };
}
