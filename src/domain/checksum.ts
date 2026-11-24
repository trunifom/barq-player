/**
 * GS1 Modulo-10 Prüfziffern für EAN-13 (12+1), EAN-8 (7+1) und UPC-A (11+1).
 * Reine Fachlogik ohne Browser-Abhängigkeiten.
 */
import { AppError, type ErrorCode } from './errors';
import type { ChecksumStatus, SyntaxStatus } from './types';

/** Symbologien mit GS1-Prüfziffer. */
export type GtinSymbology = 'EAN13' | 'EAN8' | 'UPCA';

/** Anzahl Nutzdatenstellen (ohne Prüfziffer) je Symbologie. */
export const GTIN_BODY_LENGTH: Readonly<Record<GtinSymbology, number>> = {
  EAN13: 12,
  EAN8: 7,
  UPCA: 11
};

/**
 * Berechnet die GS1-Modulo-10-Prüfziffer für einen Nummernkörper beliebiger Länge.
 * Die Gewichte 3,1,3,1,… werden von RECHTS (letzte Nutzdatenstelle = Gewicht 3) vergeben;
 * dadurch stimmt die Ausrichtung für alle GTIN-Längen.
 * @param body - nur Ziffern, mindestens eine.
 * @returns Prüfziffer als einstelliger String.
 * @throws {AppError} `ERR_SYNTAX_INVALID` bei leerem Körper oder Nicht-Ziffern.
 */
export function gs1CheckDigit(body: string): string {
  if (!/^\d+$/.test(body)) {
    throw new AppError('ERR_SYNTAX_INVALID', {
      details: 'Nummernkörper darf nur Ziffern enthalten und nicht leer sein',
      userMessage: 'Für die Prüfziffer sind nur Ziffern erlaubt.'
    });
  }
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Berechnet die Prüfziffer und prüft vorher die Körperlänge der Symbologie.
 * @param body - Nutzdatenstellen (EAN-13: 12, EAN-8: 7, UPC-A: 11).
 * @param symbology - Zielsymbologie.
 * @returns Prüfziffer als String.
 * @throws {AppError} `ERR_SYNTAX_INVALID` bei falscher Länge oder Zeichen.
 */
export function calculateCheckDigit(body: string, symbology: GtinSymbology): string {
  const expected = GTIN_BODY_LENGTH[symbology];
  if (body.length !== expected) {
    throw new AppError('ERR_SYNTAX_INVALID', {
      details: `${symbology} braucht ${expected} Nutzdatenstellen, erhalten: ${body.length}`,
      userMessage: `${symbology} braucht genau ${expected} Nutzdatenstellen vor der Prüfziffer (erhalten: ${body.length}).`
    });
  }
  return gs1CheckDigit(body);
}

/**
 * Hängt die berechnete Prüfziffer an einen Nummernkörper.
 * @param body - Nutzdatenstellen.
 * @param symbology - Zielsymbologie.
 * @returns vollständiger Code (Körper + Prüfziffer).
 * @throws {AppError} `ERR_SYNTAX_INVALID` bei falscher Länge oder Zeichen.
 */
export function appendCheckDigit(body: string, symbology: GtinSymbology): string {
  return body + calculateCheckDigit(body, symbology);
}

/** Ergebnis einer Prüfung eines vollständigen GTIN-Codes (Syntax und Prüfziffer getrennt). */
export interface GtinValidation {
  syntax: SyntaxStatus;
  checksum: ChecksumStatus;
  /** Nur gesetzt, wenn die Prüfziffer falsch ist. */
  expectedCheckDigit?: string;
  /** Maschinenlesbarer Fehlercode, falls ungültig. */
  errorCode?: ErrorCode;
  /** Deutsche Begründung, falls ungültig. */
  reason?: string;
}

/**
 * Prüft einen vollständigen Code (inkl. Prüfziffer) ohne ihn zu verändern oder zu korrigieren.
 * @param value - vollständiger Code als String.
 * @param symbology - erwartete Symbologie (wird NICHT aus der Länge geraten).
 * @returns Syntax- und Prüfziffernstatus.
 */
export function validateGtin(value: string, symbology: GtinSymbology): GtinValidation {
  const total = GTIN_BODY_LENGTH[symbology] + 1;
  if (!/^\d+$/.test(value)) {
    return {
      syntax: 'invalid',
      checksum: 'unchecked',
      errorCode: 'ERR_SYNTAX_INVALID',
      reason: 'Nur Ziffern sind erlaubt.'
    };
  }
  if (value.length !== total) {
    return {
      syntax: 'invalid',
      checksum: 'unchecked',
      errorCode: 'ERR_SYNTAX_INVALID',
      reason: `${symbology} braucht genau ${total} Ziffern (erhalten: ${value.length}).`
    };
  }
  const expected = gs1CheckDigit(value.slice(0, -1));
  if (expected !== value.slice(-1)) {
    return {
      syntax: 'valid',
      checksum: 'invalid',
      expectedCheckDigit: expected,
      errorCode: 'ERR_CHECKSUM_INVALID',
      reason: `Prüfziffer falsch (erwartet ${expected}, vorhanden ${value.slice(-1)}).`
    };
  }
  return { syntax: 'valid', checksum: 'valid' };
}

/**
 * Kurzform von {@link validateGtin}.
 * @param value - vollständiger Code.
 * @param symbology - erwartete Symbologie.
 * @returns `true`, wenn Syntax und Prüfziffer stimmen.
 */
export function isValidGtin(value: string, symbology: GtinSymbology): boolean {
  const result = validateGtin(value, symbology);
  return result.syntax === 'valid' && result.checksum === 'valid';
}
