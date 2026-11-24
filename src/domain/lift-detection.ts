/**
 * Konservative „Lift-to-Pause“-Analyse (Spezifikation 13.5): erkennt anhand von Beschleunigungsmesswerten
 * (inkl. Schwerkraft), ob das Telefon angehoben, verkippt oder bewegt wird.
 *
 * Sicherheitsregel: Die Analyse liefert nur ein Ereignis zum SICHEREN PAUSIEREN. Es gibt keinen Pfad zum
 * Fortsetzen oder Bestätigen; ein Bewegungssignal beweist keine Kassenbuchung.
 *
 * Verfahren: Nach `reset()` wird `settleMs` lang eine Ruhelage (mittlerer Schwerkraftvektor) gemessen, ohne auszulösen.
 * Danach löst die Analyse aus, wenn
 * - `tilt`: der Winkel zwischen aktuellem Vektor und Ruhelage ≥ `tiltDegrees` ist, oder
 * - `shake`: der Betrag um ≥ `deviationMs2` von der Ruhelage abweicht,
 * jeweils für mindestens `consecutive` aufeinanderfolgende Messwerte (gegen einzelne Ausreißer).
 */

/** Ein Messwert (m/s², inklusive Schwerkraft) mit monotoner Zeit in ms. */
export interface MotionSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

/** Einstellbare Schwellen (Standardwerte bewusst konservativ). */
export interface LiftOptions {
  /** Dauer der Ruhelagen-Messung in ms (Standard 800). */
  settleMs?: number;
  /** Kippwinkel in Grad (Standard 25). */
  tiltDegrees?: number;
  /** Betragsabweichung in m/s² (Standard 3). */
  deviationMs2?: number;
  /** Aufeinanderfolgende auffällige Messwerte (Standard 3). */
  consecutive?: number;
}

/** Grund der Auslösung. */
export type LiftReason = 'tilt' | 'shake';

/** Standardwerte. */
export const DEFAULT_LIFT_OPTIONS: Readonly<Required<LiftOptions>> = Object.freeze({ settleMs: 800, tiltDegrees: 25, deviationMs2: 3, consecutive: 3 });

const norm = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** Analyse von Messwerten auf „angehoben“. */
export class LiftAnalyzer {
  private readonly o: Required<LiftOptions>;
  private settleStart: number | null = null;
  private sum = { x: 0, y: 0, z: 0, n: 0 };
  private baseline: { x: number; y: number; z: number; norm: number } | null = null;
  private tiltStreak = 0;
  private shakeStreak = 0;
  private triggered = false;

  /** @param options - Schwellen (nicht angegebene Werte: Standard). */
  constructor(options: LiftOptions = {}) {
    this.o = { ...DEFAULT_LIFT_OPTIONS, ...options };
  }

  /** @returns `true`, sobald die Ruhelage feststeht (die Analyse also auslösen kann). */
  get settled(): boolean {
    return this.baseline !== null;
  }

  /** Beginnt neu: neue Ruhelagen-Messung, Auslösung wieder möglich. */
  reset(): void {
    this.settleStart = null;
    this.sum = { x: 0, y: 0, z: 0, n: 0 };
    this.baseline = null;
    this.tiltStreak = 0;
    this.shakeStreak = 0;
    this.triggered = false;
  }

  /**
   * Verarbeitet einen Messwert.
   * @param s - Messwert; nicht endliche Werte werden ignoriert.
   * @returns Auslösegrund genau EINMAL (danach `null` bis {@link reset}), sonst `null`.
   */
  push(s: MotionSample): LiftReason | null {
    if (this.triggered || ![s.x, s.y, s.z, s.t].every(Number.isFinite)) return null;
    this.settleStart ??= s.t;
    if (this.baseline === null) {
      if (s.t - this.settleStart < this.o.settleMs) {
        this.sum.x += s.x;
        this.sum.y += s.y;
        this.sum.z += s.z;
        this.sum.n++;
        return null;
      }
      const n = this.sum.n;
      const avg = n > 0 ? { x: this.sum.x / n, y: this.sum.y / n, z: this.sum.z / n } : { x: s.x, y: s.y, z: s.z };
      this.baseline = { ...avg, norm: norm(avg.x, avg.y, avg.z) };
    }
    const b = this.baseline;
    const mag = norm(s.x, s.y, s.z);
    const deviation = Math.abs(mag - b.norm);
    let angle = 0;
    if (mag > 0.5 && b.norm > 0.5) {
      const cos = Math.min(1, Math.max(-1, (s.x * b.x + s.y * b.y + s.z * b.z) / (mag * b.norm)));
      angle = (Math.acos(cos) * 180) / Math.PI;
    } else {
      angle = 180; // praktisch Schwerelosigkeit/Sensorausfall: als starke Veränderung werten
    }
    this.tiltStreak = angle >= this.o.tiltDegrees ? this.tiltStreak + 1 : 0;
    this.shakeStreak = deviation >= this.o.deviationMs2 ? this.shakeStreak + 1 : 0;
    if (this.tiltStreak >= this.o.consecutive) return this.fire('tilt');
    if (this.shakeStreak >= this.o.consecutive) return this.fire('shake');
    return null;
  }

  private fire(reason: LiftReason): LiftReason {
    this.triggered = true;
    return reason;
  }
}
