/**
 * Sicherer Sequenz-Generator: fester Präfix + variables Feld + optionaler fester Teil +
 * automatisch berechnete GS1-Prüfziffer (`{C}`).
 *
 * Sicherheitsregeln (AGENTS.md Regel 4):
 * - Gezählt wird ausschließlich das variable Nutzdatenfeld (BigInt-Arithmetik).
 * - Die Prüfziffer wird für jeden Wert neu berechnet, nie hochgezählt.
 * - Überlauf wird gemeldet und gestoppt: nie abschneiden, nie in feste Stellen überlaufen.
 */
import { AppError, type ErrorCode } from './errors';
import { appendCheckDigit, GTIN_BODY_LENGTH } from './checksum';
import type { SequenceChecksumMode, SequenceDefinition, SequenceSymbology } from './types';

/** Standard-Obergrenze der Positionen einer Sequenz. */
export const DEFAULT_MAX_SEQUENCE_ITEMS = 10_000;
/** Absolute Obergrenze (auch bei manuell erhöhtem `maxItems`). */
export const HARD_MAX_SEQUENCE_ITEMS = 100_000;
/** Maximale Feldbreite bei Nicht-EAN-Symbologien. */
const MAX_GENERIC_FIELD_WIDTH = 20;

/** Felder, auf die sich eine Prüfmeldung bezieht. */
export type SequenceField =
  | 'symbology'
  | 'prefix'
  | 'suffixBeforeCheckDigit'
  | 'variableWidth'
  | 'start'
  | 'end'
  | 'step'
  | 'checksumMode'
  | 'overflow'
  | 'maxItems';

/** Feldgenaue Prüfmeldung zu einer Sequenzdefinition. */
export interface SequenceIssue {
  field: SequenceField;
  severity: 'error' | 'warning';
  code: ErrorCode;
  /** Deutsche, feldgenaue Meldung. */
  message: string;
}

/** Vorschau einer Sequenz ohne alle Werte zu erzeugen. */
export interface SequencePreview {
  /** `true`, wenn keine Fehler (Warnungen sind erlaubt) vorliegen. */
  ok: boolean;
  issues: SequenceIssue[];
  /** Anzahl der Positionen, falls berechenbar. */
  count: number | null;
  /** Erste Werte (bis `sampleSize`). */
  first: string[];
  /** Letzte Werte (bis `sampleSize`). */
  last: string[];
}

/** Interner, geprüfter Rechenplan. */
interface Plan {
  start: bigint;
  step: bigint;
  count: number;
}

const isEan = (s: SequenceSymbology): s is 'EAN13' | 'EAN8' => s === 'EAN13' || s === 'EAN8';
const DIGITS = /^\d+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Prüft eine Definition vollständig und sammelt alle Probleme (kein Abbruch beim ersten).
 * @param def - zu prüfende Definition (auch aus untrusted JSON; Laufzeitprüfung aller Felder).
 * @returns Fehler und Warnungen sowie – wenn fehlerfrei – den Rechenplan.
 */
function analyze(def: SequenceDefinition): { issues: SequenceIssue[]; plan: Plan | null } {
  const issues: SequenceIssue[] = [];
  const err = (field: SequenceField, code: ErrorCode, message: string): void => {
    issues.push({ field, severity: 'error', code, message });
  };
  const warn = (field: SequenceField, code: ErrorCode, message: string): void => {
    issues.push({ field, severity: 'warning', code, message });
  };

  const symbologies: readonly string[] = ['EAN13', 'EAN8', 'QRCode', 'Code128'];
  if (!symbologies.includes(def.symbology)) {
    err('symbology', 'ERR_SEQUENCE_CONFIG_INVALID', 'Symbologie wird für Sequenzen nicht unterstützt.');
    return { issues, plan: null };
  }
  const ean = isEan(def.symbology);

  // Feste Teile
  if (typeof def.prefix !== 'string') err('prefix', 'ERR_SEQUENCE_CONFIG_INVALID', 'Fester Teil davor fehlt.');
  else if (ean && !/^\d*$/.test(def.prefix)) err('prefix', 'ERR_SEQUENCE_CONFIG_INVALID', 'Der feste Teil davor darf bei EAN nur Ziffern enthalten.');
  else if (!ean && CONTROL_CHARS.test(def.prefix)) err('prefix', 'ERR_SEQUENCE_CONFIG_INVALID', 'Der feste Teil davor enthält Steuerzeichen.');

  if (typeof def.suffixBeforeCheckDigit !== 'string') err('suffixBeforeCheckDigit', 'ERR_SEQUENCE_CONFIG_INVALID', 'Fester Teil danach fehlt.');
  else if (ean && !/^\d*$/.test(def.suffixBeforeCheckDigit)) err('suffixBeforeCheckDigit', 'ERR_SEQUENCE_CONFIG_INVALID', 'Der feste Teil danach darf bei EAN nur Ziffern enthalten.');
  else if (!ean && CONTROL_CHARS.test(def.suffixBeforeCheckDigit)) err('suffixBeforeCheckDigit', 'ERR_SEQUENCE_CONFIG_INVALID', 'Der feste Teil danach enthält Steuerzeichen.');

  // Feldbreite
  const width = def.variableWidth;
  const maxWidth = ean ? GTIN_BODY_LENGTH[def.symbology as 'EAN13' | 'EAN8'] : MAX_GENERIC_FIELD_WIDTH;
  let widthOk = true;
  if (!Number.isInteger(width) || width < 1 || width > maxWidth) {
    err('variableWidth', 'ERR_SEQUENCE_CONFIG_INVALID', `Die Feldbreite muss eine ganze Zahl zwischen 1 und ${maxWidth} sein.`);
    widthOk = false;
  }

  // Gesamtlänge bei EAN: Präfix + Feld + Suffix = Körperlänge (Prüfziffer kommt automatisch dazu)
  if (ean && widthOk && typeof def.prefix === 'string' && typeof def.suffixBeforeCheckDigit === 'string') {
    const bodyLen = GTIN_BODY_LENGTH[def.symbology as 'EAN13' | 'EAN8'];
    const have = def.prefix.length + width + def.suffixBeforeCheckDigit.length;
    if (have !== bodyLen) {
      err(
        'prefix',
        'ERR_SEQUENCE_CONFIG_INVALID',
        `${def.symbology} braucht ${bodyLen} Nutzdatenstellen vor der Prüfziffer, die Vorlage hat ${have} (${def.prefix.length} + ${width} + ${def.suffixBeforeCheckDigit.length}).`
      );
    }
  }

  // Prüfziffernmodus
  const expectedMode: SequenceChecksumMode = ean ? 'gs1-mod10' : 'none';
  if (def.checksumMode !== expectedMode) {
    err(
      'checksumMode',
      'ERR_SEQUENCE_CONFIG_INVALID',
      ean
        ? 'EAN-Sequenzen brauchen die automatische GS1-Prüfziffer (gs1-mod10).'
        : 'QR-Code und Code 128 haben keine automatische Prüfziffer (Modus none).'
    );
  }
  if (def.overflow !== 'stop') {
    err('overflow', 'ERR_SEQUENCE_CONFIG_INVALID', 'Als Überlaufregel ist nur „stoppen“ erlaubt.');
  }

  // Start / Ende / Schritt
  const parse = (field: SequenceField, label: string, raw: unknown): bigint | null => {
    if (typeof raw !== 'string' || !DIGITS.test(raw)) {
      err(field, 'ERR_SEQUENCE_CONFIG_INVALID', `${label} muss eine nichtnegative Ganzzahl aus Ziffern sein.`);
      return null;
    }
    return BigInt(raw);
  };
  const start = parse('start', 'Der Startwert', def.start);
  const end = parse('end', 'Der Endwert', def.end);
  const step = parse('step', 'Die Schrittweite', def.step);
  if (step !== null && step < 1n) err('step', 'ERR_SEQUENCE_CONFIG_INVALID', 'Die Schrittweite muss mindestens 1 sein.');

  const maxItems = def.maxItems ?? DEFAULT_MAX_SEQUENCE_ITEMS;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > HARD_MAX_SEQUENCE_ITEMS) {
    err('maxItems', 'ERR_SEQUENCE_CONFIG_INVALID', `Die Obergrenze muss eine ganze Zahl zwischen 1 und ${HARD_MAX_SEQUENCE_ITEMS} sein.`);
  }

  if (!widthOk || start === null || end === null || step === null || step < 1n) {
    return { issues, plan: null };
  }

  // Überlauf: Werte müssen in die Feldbreite passen (nie abschneiden!)
  const fieldMax = 10n ** BigInt(width) - 1n;
  if (start > fieldMax) err('start', 'ERR_SEQUENCE_OVERFLOW', `Der Startwert ${def.start} passt nicht in ein Feld mit ${width} Stellen (max. ${fieldMax}).`);
  if (end > fieldMax) err('end', 'ERR_SEQUENCE_OVERFLOW', `Der Endwert ${def.end} passt nicht in ein Feld mit ${width} Stellen (max. ${fieldMax}). Es wird nie abgeschnitten oder in feste Stellen übertragen.`);
  if (end < start) err('end', 'ERR_SEQUENCE_CONFIG_INVALID', 'Der Endwert darf nicht kleiner als der Startwert sein.');
  if (issues.some((i) => i.severity === 'error')) return { issues, plan: null };

  const countBig = (end - start) / step + 1n;
  if (countBig > BigInt(maxItems)) {
    err('end', 'ERR_SEQUENCE_LIMIT_EXCEEDED', `Die Reihe hätte ${countBig} Positionen; erlaubt sind höchstens ${maxItems}.`);
    return { issues, plan: null };
  }
  const count = Number(countBig);
  const lastValue = start + BigInt(count - 1) * step;
  if (lastValue !== end) {
    warn('end', 'ERR_SEQUENCE_CONFIG_INVALID', `Der Endwert liegt nicht auf dem Schrittraster; die Reihe endet bei ${lastValue.toString().padStart(width, '0')}.`);
  }
  if (count === 1) {
    warn('step', 'ERR_SEQUENCE_CONFIG_INVALID', 'Die Reihe enthält nur einen Wert (Schritt größer als der Bereich).');
  }
  return { issues, plan: { start, step, count } };
}

/** Baut den Wert an Position `index` (0-basiert) – Prüfziffer wird immer neu berechnet. */
function valueAt(def: SequenceDefinition, plan: Plan, index: number): string {
  const n = plan.start + BigInt(index) * plan.step;
  const field = n.toString().padStart(def.variableWidth, '0');
  const body = def.prefix + field + def.suffixBeforeCheckDigit;
  return isEan(def.symbology) ? appendCheckDigit(body, def.symbology) : body;
}

/**
 * Prüft eine Sequenzdefinition feldgenau, ohne Werte zu erzeugen.
 * @param def - Definition.
 * @returns alle Fehler und Warnungen (leer = völlig unproblematisch).
 */
export function validateSequenceDefinition(def: SequenceDefinition): SequenceIssue[] {
  return analyze(def).issues;
}

/**
 * Erzeugt eine Vorschau mit erster/letzter Werten und Anzahl für die UI.
 * @param def - Definition.
 * @param sampleSize - Zahl der gezeigten ersten/letzten Werte (Standard 3).
 * @returns Vorschau; bei Fehlern `ok=false` und leere Beispiele.
 */
export function previewSequence(def: SequenceDefinition, sampleSize = 3): SequencePreview {
  const { issues, plan } = analyze(def);
  if (!plan) return { ok: false, issues, count: null, first: [], last: [] };
  const n = Math.max(1, Math.min(sampleSize, plan.count));
  const first: string[] = [];
  const last: string[] = [];
  for (let i = 0; i < n; i++) first.push(valueAt(def, plan, i));
  for (let i = plan.count - n; i < plan.count; i++) last.push(valueAt(def, plan, i));
  return { ok: true, issues, count: plan.count, first, last };
}

/**
 * Erzeugt die Sequenz lazy. Die Definition wird SOFORT geprüft (nicht erst beim ersten `next()`).
 * @param def - Definition.
 * @returns Iterator über vollständige Codes (bei EAN inkl. Prüfziffer).
 * @throws {AppError} mit dem Code der ersten Fehlermeldung (z. B. `ERR_SEQUENCE_OVERFLOW`).
 */
export function generateSequence(def: SequenceDefinition): Generator<string, void, undefined> {
  const { issues, plan } = analyze(def);
  const firstError = issues.find((i) => i.severity === 'error');
  if (firstError || !plan) {
    throw new AppError(firstError?.code ?? 'ERR_SEQUENCE_CONFIG_INVALID', {
      details: `${firstError?.field ?? 'definition'}: ${firstError?.message ?? 'ungültig'}`,
      userMessage: firstError?.message
    });
  }
  const okPlan = plan;
  function* iterate(): Generator<string, void, undefined> {
    for (let i = 0; i < okPlan.count; i++) yield valueAt(def, okPlan, i);
  }
  return iterate();
}

/**
 * Erzeugt die komplette Sequenz als Array (begrenzt durch `maxItems`).
 * @param def - Definition.
 * @returns alle Codes.
 * @throws {AppError} siehe {@link generateSequence}.
 */
export function generateSequenceList(def: SequenceDefinition): string[] {
  return [...generateSequence(def)];
}

/**
 * Rechnet eine gewünschte Anzahl in einen Endwert um (für UIs mit „Anzahl“ statt „Ende“).
 * @param start - Startwert (Dezimalstring).
 * @param step - Schrittweite (Dezimalstring).
 * @param count - Anzahl Positionen (>= 1).
 * @param variableWidth - Breite des variablen Feldes.
 * @returns Endwert als Dezimalstring (ohne Auffüllung).
 * @throws {AppError} `ERR_SEQUENCE_OVERFLOW`, wenn der Endwert nicht mehr ins Feld passt;
 *   `ERR_SEQUENCE_CONFIG_INVALID` bei ungültigen Eingaben.
 */
export function endFromCount(start: string, step: string, count: number, variableWidth: number): string {
  if (!DIGITS.test(start) || !DIGITS.test(step) || !Number.isInteger(count) || count < 1 || !Number.isInteger(variableWidth) || variableWidth < 1) {
    throw new AppError('ERR_SEQUENCE_CONFIG_INVALID', { details: 'endFromCount: ungültige Eingaben' });
  }
  const stepBig = BigInt(step);
  if (stepBig < 1n) throw new AppError('ERR_SEQUENCE_CONFIG_INVALID', { details: 'endFromCount: Schritt < 1', userMessage: 'Die Schrittweite muss mindestens 1 sein.' });
  const end = BigInt(start) + BigInt(count - 1) * stepBig;
  if (end > 10n ** BigInt(variableWidth) - 1n) {
    throw new AppError('ERR_SEQUENCE_OVERFLOW', {
      details: `Endwert ${end} passt nicht in ${variableWidth} Stellen`,
      userMessage: `${count} Positionen mit Schritt ${step} passen nicht in ein Feld mit ${variableWidth} Stellen (Endwert wäre ${end}).`
    });
  }
  return end.toString();
}

/** Aus einer Schablone abgeleitete Teile einer {@link SequenceDefinition}. */
export interface ParsedTemplate {
  prefix: string;
  suffixBeforeCheckDigit: string;
  variableWidth: number;
  checksumMode: SequenceChecksumMode;
}

/**
 * Parst eine Schablone wie `2 063701 028{XX}{C}`:
 * `{X…}` = variables Feld (Breite = Anzahl X), optionales `{C}` am Ende = automatische Prüfziffer.
 * Bei EAN werden Darstellungsleerzeichen in den festen Teilen entfernt; bei QR/Code 128 bleiben sie erhalten.
 * @param pattern - Schablonentext.
 * @param symbology - Zielsymbologie.
 * @returns Teile für die Definition.
 * @throws {AppError} `ERR_SEQUENCE_CONFIG_INVALID` bei Syntaxfehlern.
 */
export function parseSequenceTemplate(pattern: string, symbology: SequenceSymbology): ParsedTemplate {
  const m = /^([^{}]*)\{(X+)\}([^{}]*?)(\{C\})?$/.exec(pattern);
  if (!m) {
    throw new AppError('ERR_SEQUENCE_CONFIG_INVALID', {
      details: 'Schablone muss genau ein {XX}-Feld und optional {C} am Ende enthalten',
      userMessage: 'Die Schablone muss genau ein Feld wie {XX} und optional {C} am Ende enthalten, z. B. 2 063701 028{XX}{C}.'
    });
  }
  const ean = isEan(symbology);
  if (m[4] !== undefined && !ean) {
    throw new AppError('ERR_SEQUENCE_CONFIG_INVALID', {
      details: '{C} nur bei EAN',
      userMessage: '{C} (Prüfziffer) ist nur bei EAN-13 und EAN-8 möglich.'
    });
  }
  const clean = (s: string): string => (ean ? s.replace(/[ \t]/g, '') : s);
  return {
    prefix: clean(m[1] ?? ''),
    suffixBeforeCheckDigit: clean(m[3] ?? ''),
    variableWidth: (m[2] ?? '').length,
    checksumMode: ean ? 'gs1-mod10' : 'none'
  };
}
