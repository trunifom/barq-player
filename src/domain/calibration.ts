/**
 * Auswertung des 20er-Kassen-Kalibrierungslaufs (Spezifikation 15.3/15.4, 23.5).
 *
 * Ablauf: Die App zeigt 20 Testcodes mit einem Profil; die Bedienperson meldet danach, was die Kasse tatsächlich
 * angenommen hat. Die Empfehlung ist ein TESTSTARTPUNKT (Heuristik), keine Garantie: Gemessen wird nur, was die
 * Bedienperson eingibt; Reserve gegenüber der schnellsten gerade noch fehlerfreien Einstellung bleibt Pflicht.
 */
import type { FaderProfile } from './types';

/** Anzahl der Testpositionen (siehe auch `CALIBRATION_ENTRY_COUNT`). */
export const CALIBRATION_SHOWN = 20;

/** Eingaben der Bedienperson nach dem Lauf. */
export interface CalibrationInput {
  /** Das getestete Profil. */
  profile: FaderProfile;
  /** Angezeigte Positionen (normalerweise 20). */
  shown: number;
  /** Von der Kasse angenommene Positionen. */
  accepted: number;
  /** Unerwartete zusätzliche Buchungen (Doppelbuchungen). */
  extra: number;
  /** Anzahl Fehlerdialoge an der Kasse. */
  errorDialogs: number;
}

/** Ergebnisart. */
export type CalibrationVerdict = 'stable' | 'missing' | 'extra' | 'mixed' | 'invalid-test';

/** Auswertung samt Vorschlag. */
export interface CalibrationResult {
  verdict: CalibrationVerdict;
  /** Fehlende Positionen (`shown − accepted`, nie negativ). */
  missing: number;
  /** Vorgeschlagenes Profil (bei `mixed`/`invalid-test` unverändert, aber mit neuer ID). */
  recommended: FaderProfile;
  /** Deutsche Erläuterung in Stichpunkten. */
  explanation: string[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round10 = (v: number): number => Math.round(v / 10) * 10;

/**
 * Prüft die Eingaben auf Plausibilität.
 * @param input - Eingaben.
 * @returns Liste deutscher Fehlermeldungen (leer = gültig).
 */
export function validateCalibrationInput(input: CalibrationInput): string[] {
  const problems: string[] = [];
  const int = (v: unknown, label: string, min: number, max: number): void => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) problems.push(`${label} muss eine ganze Zahl von ${min} bis ${max} sein.`);
  };
  int(input.shown, 'Die Zahl angezeigter Positionen', 1, 1000);
  int(input.accepted, 'Die Zahl angenommener Positionen', 0, 1000);
  int(input.extra, 'Die Zahl zusätzlicher Buchungen', 0, 1000);
  int(input.errorDialogs, 'Die Zahl der Fehlerdialoge', 0, 1000);
  if (problems.length === 0 && input.accepted > input.shown + input.extra) {
    problems.push('Die Kasse kann nicht mehr Positionen angenommen haben als angezeigt plus zusätzlich gebucht wurden.');
  }
  return problems;
}

function scaled(p: FaderProfile, display: number, blank: number, identical: number, id: string, name: string, notes: string): FaderProfile {
  return {
    id,
    name,
    displayMs: clamp(round10(p.displayMs * display), 100, 5000),
    blankMs: clamp(round10(p.blankMs * blank), 50, 3000),
    identicalBlankMs: clamp(round10(p.identicalBlankMs * identical), 50, 5000),
    startDelayMs: p.startDelayMs,
    notes
  };
}

/**
 * Wertet einen Kalibrierungslauf aus und schlägt ein Profil vor.
 * - Fehlerfrei: Betriebsprofil mit 25 % Reserve.
 * - Fehlende Positionen: langsamer (Anzeige und Leerzeiten ×1,5).
 * - Zusätzliche Buchungen: kürzere Anzeige (×0,75), sonst unverändert.
 * - Fehlende UND zusätzliche Positionen oder Fehlerdialoge: kein Vorschlag, Lauf mit freigegebenen Testartikeln wiederholen.
 * @param input - Eingaben der Bedienperson.
 * @param newId - ID für das vorgeschlagene Profil.
 * @returns Ergebnis (bei ungültigen Eingaben wird der Fehler wie `invalid-test` erläutert).
 */
export function evaluateCalibration(input: CalibrationInput, newId: string): CalibrationResult {
  const problems = validateCalibrationInput(input);
  const base = input.profile;
  const keep = (notes: string): FaderProfile => ({ ...base, id: newId, name: `${base.name} (unverändert)`, notes });
  if (problems.length > 0) {
    return { verdict: 'invalid-test', missing: 0, recommended: keep('Ungültige Eingaben'), explanation: problems };
  }
  const missing = Math.max(0, input.shown - input.accepted);
  const hint = 'Die Werte sind Teststartpunkte, keine Garantie. Wiederholen Sie wichtige Einstellungen mehrfach.';

  if (input.errorDialogs > 0) {
    return {
      verdict: 'invalid-test',
      missing,
      recommended: keep('Test mit Fehlerdialogen'),
      explanation: [
        `Die Kasse zeigte ${input.errorDialogs} Fehlerdialog(e). Das deutet auf unbekannte Artikel hin, nicht auf die Zeiteinstellung.`,
        'Bitte den Lauf mit freigegebenen, der Kasse bekannten Testartikeln wiederholen.',
        hint
      ]
    };
  }
  if (missing === 0 && input.extra === 0) {
    const rec = scaled(base, 1.25, 1.25, 1.25, newId, `${base.name} (kalibriert)`, `Fehlerfreier 20er-Lauf, mit 25 % Reserve (Basis: ${base.name})`);
    return {
      verdict: 'stable',
      missing,
      recommended: rec,
      explanation: [
        'Alle Positionen wurden ohne Fehler angenommen.',
        `Vorschlag als Betriebsprofil mit 25 % Reserve: Anzeige ${rec.displayMs} ms, Leerzeit ${rec.blankMs} ms, identische Codes ${rec.identicalBlankMs} ms.`,
        'Schneller nur nach weiteren fehlerfreien Läufen und mit Reserve einsetzen.',
        hint
      ]
    };
  }
  if (missing > 0 && input.extra > 0) {
    return {
      verdict: 'mixed',
      missing,
      recommended: keep('Uneinheitliches Ergebnis'),
      explanation: [
        `Es fehlten ${missing} Position(en) und es gab ${input.extra} zusätzliche Buchung(en).`,
        'Das Ergebnis ist uneinheitlich; bitte den Lauf wiederholen und Kasse sowie Scanner-Einstellungen prüfen.',
        hint
      ]
    };
  }
  if (missing > 0) {
    const rec = scaled(base, 1.5, 1.5, 1.5, newId, `${base.name} (langsamer)`, `${missing} fehlende Position(en) im 20er-Lauf (Basis: ${base.name})`);
    return {
      verdict: 'missing',
      missing,
      recommended: rec,
      explanation: [
        `Es fehlten ${missing} von ${input.shown} Positionen.`,
        `Vorschlag: langsamer testen (Anzeige ${rec.displayMs} ms, Leerzeit ${rec.blankMs} ms, identische Codes ${rec.identicalBlankMs} ms).`,
        'Bei fehlenden identischen Folgecodes zuerst die Leerzeit für identische Codes erhöhen.',
        hint
      ]
    };
  }
  const rec = scaled(base, 0.75, 1, 1, newId, `${base.name} (kürzere Anzeige)`, `${input.extra} zusätzliche Buchung(en) im 20er-Lauf (Basis: ${base.name})`);
  return {
    verdict: 'extra',
    missing,
    recommended: rec,
    explanation: [
      `Es gab ${input.extra} zusätzliche Buchung(en): ein Code wurde offenbar mehrfach gelesen.`,
      `Vorschlag: kürzere Anzeige (${rec.displayMs} ms). Prüfen Sie, ob Doppelbuchungen aus der Kasse korrigiert werden müssen.`,
      hint
    ]
  };
}
