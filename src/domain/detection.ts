/**
 * Auswertung von Decoder-Ergebnissen (Format-Zuordnung, Whitelist, Normalisierung, Validierung).
 * Reine Logik: kennt weder Kamera noch Bibliothek, nur Formatnamen und Strings.
 *
 * Grundsätze: Das Format kommt aus dem Decoder-Ergebnis (nicht aus der Textlänge geraten); der Inhalt wird
 * nie verändert, außer durch die einzige dokumentierte Normalisierung (UPC-A, siehe unten); jedes Ergebnis
 * wird wie beim Speichern validiert, sodass nie ein ungültiger Code in die App gelangt.
 */
import { validateCodeValue } from './bulk-parser';
import type { ErrorCode } from './errors';
import type { Symbology } from './types';

/** Formatnamen der Shape Detection API (`BarcodeDetector`) und des ponyfills. */
export type DetectorFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'qr_code' | 'code_128';

/** Standard-Whitelist: EAN-13, EAN-8, QR (Text) und Code 128 (UPC-A ist optional zuschaltbar). */
export const DEFAULT_WHITELIST: readonly Symbology[] = Object.freeze(['EAN13', 'EAN8', 'QRCode', 'Code128'] as Symbology[]);

const TO_SYMBOLOGY: Readonly<Record<DetectorFormat, Symbology>> = {
  ean_13: 'EAN13',
  ean_8: 'EAN8',
  upc_a: 'UPCA',
  qr_code: 'QRCode',
  code_128: 'Code128'
};

const TO_FORMAT: Readonly<Record<Symbology, DetectorFormat>> = {
  EAN13: 'ean_13',
  EAN8: 'ean_8',
  UPCA: 'upc_a',
  QRCode: 'qr_code',
  Code128: 'code_128'
};

/**
 * Formatnamen für den Detektor (nur whitelisted Symbologien).
 * @param whitelist - erlaubte Symbologien.
 * @returns Detektor-Formatnamen in Whitelist-Reihenfolge ohne Duplikate.
 */
export function toDetectorFormats(whitelist: readonly Symbology[]): DetectorFormat[] {
  return [...new Set(whitelist.map((s) => TO_FORMAT[s]))];
}

/**
 * Wandelt einen Detektor-Formatnamen in eine Symbologie.
 * @param format - Formatname (z. B. `ean_13`).
 * @returns Symbologie oder `null`, wenn unbekannt.
 */
export function symbologyFromDetectorFormat(format: string): Symbology | null {
  return Object.prototype.hasOwnProperty.call(TO_SYMBOLOGY, format) ? TO_SYMBOLOGY[format as DetectorFormat] : null;
}

/** Ergebnis der Auswertung einer Erkennung. */
export type Interpretation =
  | { ok: true; symbology: Symbology; value: string }
  | { ok: false; reason: 'unknown-format' | 'format-not-allowed' | 'invalid-value'; code?: ErrorCode; message: string };

/**
 * Bewertet eine einzelne Erkennung.
 *
 * Einzige Normalisierung: Meldet ein Decoder `upc_a` mit 13 Ziffern und führender `0` (so liefert zxing UPC-A),
 * wird die führende `0` entfernt, damit der gespeicherte UPC-A-Wert 12-stellig ist.
 * @param format - Detektor-Formatname.
 * @param rawValue - decodierter Text.
 * @param whitelist - erlaubte Symbologien.
 * @returns gültige Symbologie samt Wert oder Ablehnungsgrund (nie ein stilles Korrigieren).
 */
export function interpretDetection(format: string, rawValue: string, whitelist: readonly Symbology[]): Interpretation {
  const symbology = symbologyFromDetectorFormat(format);
  if (!symbology) return { ok: false, reason: 'unknown-format', message: `Unbekanntes Format „${format}“.` };
  if (!whitelist.includes(symbology)) return { ok: false, reason: 'format-not-allowed', message: `Format ${symbology} ist nicht freigegeben.` };
  const value = symbology === 'UPCA' && /^0\d{12}$/.test(rawValue) ? rawValue.slice(1) : rawValue;
  const check = validateCodeValue(value, symbology, { multiline: true });
  if (!check.ok) return { ok: false, reason: 'invalid-value', code: check.code, message: check.message };
  return { ok: true, symbology, value: check.value };
}
