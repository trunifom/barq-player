/**
 * Ablaufdatum von Codes (reine Logik, ohne Browser-Abhängigkeiten).
 *
 * Ein Ablaufdatum ist ein Kalendertag im Format `JJJJ-MM-TT` (ohne Uhrzeit und Zeitzone). Ein Code gilt
 * **bis einschließlich** diesem Tag als gültig und ab dem Folgetag als abgelaufen. „Heute“ wird immer vom Aufrufer
 * als Kalendertag der Ortszeit übergeben, damit die Logik deterministisch testbar bleibt.
 */

/** Zustand eines Codes in Bezug auf sein Ablaufdatum. */
export type ExpiryState = 'none' | 'valid' | 'soon' | 'expired';

/** Anzahl Tage vor Ablauf, ab der ein Code als „läuft bald ab“ gilt. */
export const EXPIRY_WARN_DAYS = 7;

/** Auswertung eines Ablaufdatums. */
export interface ExpiryInfo {
  state: ExpiryState;
  /** Verbleibende Tage (0 = läuft heute ab, negativ = seit so vielen Tagen abgelaufen); `null` ohne Datum. */
  daysLeft: number | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Prüft, ob ein Text ein echter Kalendertag im Format `JJJJ-MM-TT` ist (z. B. kein 31.02.).
 * @param text - Prüftext.
 * @returns `true` bei gültigem Datum.
 */
export function isValidDateString(text: string): boolean {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2999) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Liest ein Datum aus Benutzereingaben oder Dateien: `JJJJ-MM-TT`, `TT.MM.JJJJ`, `T.M.JJJJ`, `TT/MM/JJJJ`.
 * Zweistellige Jahre werden bewusst abgelehnt (mehrdeutig).
 * @param text - Eingabe.
 * @returns normalisiertes `JJJJ-MM-TT` oder `null`, wenn kein gültiges Datum erkennbar ist.
 */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  if (isValidDateString(t)) return t;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (!m) return null;
  const iso = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return isValidDateString(iso) ? iso : null;
}

/**
 * Kalendertag der Ortszeit als `JJJJ-MM-TT`.
 * @param date - Zeitpunkt.
 * @returns Tag in der Ortszeit des Geräts.
 */
export function localDateString(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formatiert ein Datum für die Anzeige (`TT.MM.JJJJ`).
 * @param iso - `JJJJ-MM-TT`.
 * @returns lesbarer Text; bei ungültigem Wert der Originaltext.
 */
export function formatDateDe(iso: string): string {
  const m = ISO_DATE.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Tage seit der Epoche (UTC-Mitternacht) eines gültigen `JJJJ-MM-TT`. */
function dayNumber(iso: string): number {
  const m = ISO_DATE.exec(iso);
  return Math.round(Date.UTC(Number(m?.[1]), Number(m?.[2]) - 1, Number(m?.[3])) / 86_400_000);
}

/**
 * Wertet ein Ablaufdatum aus.
 * @param expiresAt - Ablaufdatum (`JJJJ-MM-TT`) oder `undefined`.
 * @param today - heutiger Kalendertag (`JJJJ-MM-TT`).
 * @param warnDays - Warnschwelle in Tagen (Standard {@link EXPIRY_WARN_DAYS}).
 * @returns Zustand und verbleibende Tage. Ein ungültiges Datum zählt vorsichtshalber als abgelaufen.
 */
export function expiryInfo(expiresAt: string | undefined, today: string, warnDays: number = EXPIRY_WARN_DAYS): ExpiryInfo {
  if (expiresAt === undefined || expiresAt === '') return { state: 'none', daysLeft: null };
  if (!isValidDateString(expiresAt) || !isValidDateString(today)) return { state: 'expired', daysLeft: null };
  const daysLeft = dayNumber(expiresAt) - dayNumber(today);
  if (daysLeft < 0) return { state: 'expired', daysLeft };
  return { state: daysLeft <= warnDays ? 'soon' : 'valid', daysLeft };
}

/**
 * Prüft, ob ein Code abgelaufen ist.
 * @param expiresAt - Ablaufdatum oder `undefined`.
 * @param today - heutiger Kalendertag.
 * @returns `true`, wenn das Ablaufdatum vor heute liegt.
 */
export function isExpired(expiresAt: string | undefined, today: string): boolean {
  return expiryInfo(expiresAt, today).state === 'expired';
}

/**
 * Teilt Einträge in gültige (inkl. ohne Datum) und abgelaufene.
 * @param items - Einträge mit optionalem Ablaufdatum.
 * @param today - heutiger Kalendertag.
 * @returns beide Gruppen in ursprünglicher Reihenfolge.
 */
export function partitionByExpiry<T extends { expiresAt?: string | undefined }>(items: readonly T[], today: string): { valid: T[]; expired: T[] } {
  const valid: T[] = [];
  const expired: T[] = [];
  for (const item of items) (isExpired(item.expiresAt, today) ? expired : valid).push(item);
  return { valid, expired };
}

/**
 * Beschreibt den Ablaufzustand in einem kurzen deutschen Satz.
 * @param info - Auswertung.
 * @param expiresAt - Ablaufdatum.
 * @returns z. B. „abgelaufen am 01.02.2026“ oder „läuft in 3 Tagen ab“.
 */
export function describeExpiry(info: ExpiryInfo, expiresAt: string): string {
  const date = formatDateDe(expiresAt);
  switch (info.state) {
    case 'none':
      return 'ohne Ablaufdatum';
    case 'expired':
      return `abgelaufen am ${date}`;
    case 'soon':
      return info.daysLeft === 0 ? `läuft heute ab (${date})` : info.daysLeft === 1 ? `läuft morgen ab (${date})` : `läuft in ${info.daysLeft} Tagen ab (${date})`;
    default:
      return `gültig bis ${date}`;
  }
}
