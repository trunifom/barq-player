/**
 * Standard-Scannerprofile (Spezifikation 15.3) und Profilprüfung.
 * Die Werte sind TESTSTARTPUNKTE, keine garantierten Einstellungen: erst die Kalibrierung an der
 * realen Kasse liefert belastbare Zeiten.
 */
import type { FaderProfile } from './types';

/** Zeitwerte der mitgelieferten Profile (ms). Startverzögerung überall 3000. */
export const DEFAULT_PROFILES: readonly FaderProfile[] = Object.freeze([
  { id: 'profile-slow', name: 'Langsam', displayMs: 1000, blankMs: 300, identicalBlankMs: 600, startDelayMs: 3000, notes: 'Grundfunktion prüfen' },
  { id: 'profile-normal', name: 'Normaltest', displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 3000, notes: 'Nutzerbeobachtung vorsichtig aufgreifen' },
  { id: 'profile-fast', name: 'Schnelltest', displayMs: 300, blankMs: 100, identicalBlankMs: 300, startDelayMs: 3000, notes: 'Nur nach fehlerfreien Vergleichstests' },
  { id: 'profile-identical', name: 'Identische Codes', displayMs: 500, blankMs: 150, identicalBlankMs: 800, startDelayMs: 3000, notes: 'Wiederholsperre des Scanners kalibrieren' }
].map((p) => Object.freeze(p)));

/** Mindest-Leerzeit in ms: mindestens ein Bildschirmbild (60 Hz ≈ 16,7 ms), damit zwischen zwei Symbolen sicher ein leerer Frame liegt. */
export const MIN_BLANK_MS = 20;

/**
 * Prüft ein Profil auf sinnvolle Werte.
 * @param profile - zu prüfendes Profil.
 * @returns Liste deutscher Fehlermeldungen (leer = gültig).
 */
export function validateProfile(profile: FaderProfile): string[] {
  const problems: string[] = [];
  if (typeof profile.id !== 'string' || profile.id === '') problems.push('Die Profil-ID fehlt.');
  if (typeof profile.name !== 'string' || profile.name.trim() === '') problems.push('Der Profilname fehlt.');
  const num = (v: unknown, label: string, min: number, strict: boolean): void => {
    if (typeof v !== 'number' || !Number.isFinite(v) || (strict ? v <= min : v < min)) {
      problems.push(`${label} muss eine Zahl ${strict ? '>' : '≥'} ${min} sein.`);
    } else if (v > 600_000) {
      problems.push(`${label} ist unrealistisch groß (max. 600000 ms).`);
    }
  };
  num(profile.displayMs, 'Die Anzeigezeit', 0, true);
  num(profile.blankMs, 'Die Leerzeit', MIN_BLANK_MS, false);
  num(profile.identicalBlankMs, 'Die Leerzeit für identische Codes', MIN_BLANK_MS, false);
  num(profile.startDelayMs, 'Die Startverzögerung', 0, false);
  return problems;
}
