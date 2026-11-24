/**
 * Unterscheidung zwischen technischem Duplikat und fachlicher Wiederholung beim Live-Scannen
 * (Spezifikation 10.2).
 *
 * - Technisches Duplikat: Derselbe vorgehaltene Code erscheint in vielen aufeinanderfolgenden Videobildern
 *   → wird nur EINMAL erfasst (Debounce).
 * - Fachliche Wiederholung: Der Code verschwindet aus dem Bild (mindestens `absenceMs`) und wird erneut
 *   vorgehalten → wird erneut erfasst.
 *
 * Die Zeit kommt als monotone Millisekundenzahl vom Aufrufer (`performance.now()`), nie von einer Systemuhr.
 */
import { AppError } from './errors';

/** Einstellungen des Filters. */
export interface DuplicateFilterOptions {
  /** So lange (ms) muss ein Code NICHT gesehen worden sein, bevor ein erneutes Erscheinen als Wiederholung zählt. Standard 1200. */
  absenceMs?: number;
  /** Mindestanzahl aufeinanderfolgender Bilder mit demselben Code, bevor er akzeptiert wird (Schutz vor Fehllesungen). Standard 1. */
  minFrames?: number;
}

interface Track {
  lastSeen: number;
  consecutive: number;
  accepted: boolean;
}

/** Filter pro Scan-Sitzung. */
export class DuplicateFilter {
  private readonly absenceMs: number;
  private readonly minFrames: number;
  private readonly tracks = new Map<string, Track>();
  private lastFrameKeys = new Set<string>();
  private lastAt = Number.NEGATIVE_INFINITY;

  /**
   * @param options - Zeit- und Stabilitätsparameter.
   * @throws {AppError} `ERR_SYNTAX_INVALID` bei ungültigen Parametern.
   */
  constructor(options: DuplicateFilterOptions = {}) {
    this.absenceMs = options.absenceMs ?? 1200;
    this.minFrames = options.minFrames ?? 1;
    if (!Number.isFinite(this.absenceMs) || this.absenceMs < 0) throw new AppError('ERR_SYNTAX_INVALID', { details: 'absenceMs muss >= 0 sein' });
    if (!Number.isInteger(this.minFrames) || this.minFrames < 1) throw new AppError('ERR_SYNTAX_INVALID', { details: 'minFrames muss eine ganze Zahl >= 1 sein' });
  }

  /**
   * Meldet die in EINEM Videobild sichtbaren Codes (leere Liste, wenn keiner sichtbar war).
   * @param keys - eindeutige Schlüssel der sichtbaren Codes (z. B. `Symbologie:Wert`).
   * @param at - monotone Zeit in ms (darf nicht rückwärts laufen).
   * @returns Schlüssel, die JETZT als neue Erfassung gelten (je Vorhaltevorgang höchstens einmal).
   * @throws {AppError} `ERR_SYNTAX_INVALID`, wenn die Zeit rückwärts läuft oder nicht endlich ist.
   */
  observe(keys: readonly string[], at: number): string[] {
    if (!Number.isFinite(at) || at < this.lastAt) throw new AppError('ERR_SYNTAX_INVALID', { details: 'Zeit muss endlich und monoton steigend sein' });
    this.lastAt = at;
    const visible = new Set(keys);
    const accept: string[] = [];

    for (const key of visible) {
      let track = this.tracks.get(key);
      if (!track || at - track.lastSeen >= this.absenceMs) {
        // neu oder nach ausreichender Abwesenheit wieder aufgetaucht → neuer Vorhaltevorgang
        track = { lastSeen: at, consecutive: 0, accepted: false };
        this.tracks.set(key, track);
      }
      track.consecutive = this.lastFrameKeys.has(key) ? track.consecutive + 1 : 1;
      track.lastSeen = at;
      if (!track.accepted && track.consecutive >= this.minFrames) {
        track.accepted = true;
        accept.push(key);
      }
    }
    // Codes, die in diesem Bild fehlen, verlieren ihre Serie (die Abwesenheitszeit läuft weiter)
    for (const [key, track] of this.tracks) {
      if (!visible.has(key)) {
        track.consecutive = 0;
        if (at - track.lastSeen >= this.absenceMs) this.tracks.delete(key);
      }
    }
    this.lastFrameKeys = visible;
    return accept;
  }

  /**
   * Nimmt die Akzeptanz eines Codes zurück (z. B. weil das Speichern fehlschlug): Solange der Code weiter
   * vorgehalten wird, gilt er im nächsten Bild erneut als neue Erfassung.
   * @param key - Schlüssel des Codes.
   */
  release(key: string): void {
    const track = this.tracks.get(key);
    if (track) track.accepted = false;
  }

  /** Setzt den Filter zurück (z. B. beim Kamerawechsel oder Sammlungswechsel). */
  reset(): void {
    this.tracks.clear();
    this.lastFrameKeys = new Set();
    this.lastAt = Number.NEGATIVE_INFINITY;
  }
}
