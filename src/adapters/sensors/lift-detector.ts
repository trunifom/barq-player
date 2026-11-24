/**
 * Lift-to-Pause-Sensor (optional zuschaltbar, standardmäßig aus): hört auf `devicemotion` und meldet über
 * `onTrigger`, wenn das Telefon angehoben/bewegt wird oder der Sensor ausfällt.
 *
 * SICHERHEIT: Der Adapter kennt nur den Rückruf `onTrigger`, der in der App ausschließlich PAUSIERT (Symbol aus).
 * Er kann nie fortsetzen, bestätigen oder eine Buchung behaupten. Sensorverlust gilt als Auslöser (konservativ:
 * Spezifikation 13.5 „Sensorverlust pausiert“).
 */
import { LiftAnalyzer, type LiftOptions } from '../../domain/lift-detection';

/** Auslösegründe des Adapters. */
export type LiftTrigger = 'tilt' | 'shake' | 'sensor-lost';

/** Minimale Sicht auf ein `DeviceMotionEvent`. */
export interface MotionEventLike {
  accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
}

/** Minimale Ereignisquelle (`window`). */
export interface MotionTarget {
  addEventListener(type: 'devicemotion', listener: (event: MotionEventLike) => void): void;
  removeEventListener(type: 'devicemotion', listener: (event: MotionEventLike) => void): void;
}

/** Abhängigkeiten des Adapters. */
export interface LiftDetectorDeps {
  /** Ereignisquelle; `undefined` = nicht unterstützt. */
  target: MotionTarget | undefined;
  /** Rückruf bei Auslösung (in der App: nur pausieren). */
  onTrigger(reason: LiftTrigger): void;
  /** Berechtigungsanfrage (iOS: `DeviceMotionEvent.requestPermission`); Android braucht sie nicht. */
  requestPermission?: () => Promise<'granted' | 'denied'>;
  /** Monotone Zeit in ms. */
  now?: () => number;
  timers?: { setTimeout(cb: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  options?: LiftOptions;
  /** Ohne Messwerte so lange (ms) gilt der Sensor als ausgefallen (Standard 2000). */
  sensorTimeoutMs?: number;
}

/** Adapter für Lift-to-Pause. */
export class LiftDetector {
  private readonly analyzer: LiftAnalyzer;
  private readonly now: () => number;
  private readonly timers: NonNullable<LiftDetectorDeps['timers']>;
  private readonly timeoutMs: number;
  private enabled = false;
  private isArmed = false;
  private watchdog: unknown = null;
  private readonly listener = (event: MotionEventLike): void => this.onMotion(event);

  /** @param deps - Quelle, Rückruf und optionale Einstellungen. */
  constructor(private readonly deps: LiftDetectorDeps) {
    this.analyzer = new LiftAnalyzer(deps.options);
    this.now = deps.now ?? ((): number => performance.now());
    this.timers = deps.timers ?? { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.timeoutMs = deps.sensorTimeoutMs ?? 2000;
  }

  /** @returns `true`, wenn der Browser Bewegungssensoren anbietet. */
  get supported(): boolean {
    return this.deps.target !== undefined;
  }

  /** @returns `true`, wenn die Analyse gerade scharf geschaltet ist. */
  get armed(): boolean {
    return this.isArmed;
  }

  /**
   * Schaltet die Funktion frei (aus einer Nutzeraktion aufrufen; fragt ggf. die Berechtigung an).
   * @returns `true`, wenn Bewegungsdaten genutzt werden dürfen.
   */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    if (this.deps.requestPermission) {
      try {
        this.enabled = (await this.deps.requestPermission()) === 'granted';
      } catch {
        this.enabled = false; // Anfrage nicht aus einer Nutzeraktion oder abgelehnt: Funktion bleibt aus (kein Risiko)
      }
    } else {
      this.enabled = true;
    }
    return this.enabled;
  }

  /** Schaltet die Funktion ab (und scharf → unscharf). */
  disable(): void {
    this.disarm();
    this.enabled = false;
  }

  /**
   * Schaltet die Analyse scharf: neue Ruhelagen-Messung, Sensor-Überwachung. Wirkungslos, wenn nicht freigeschaltet.
   * Aufrufen, sobald das Telefon bereit liegt (nicht schon im Countdown).
   */
  arm(): void {
    const target = this.deps.target;
    if (!this.enabled || this.isArmed || !target) return;
    this.isArmed = true;
    this.analyzer.reset();
    target.addEventListener('devicemotion', this.listener);
    this.restartWatchdog();
  }

  /** Schaltet die Analyse unscharf (z. B. bei Pause, Fehler oder Ende). */
  disarm(): void {
    if (!this.isArmed) return;
    this.isArmed = false;
    this.deps.target?.removeEventListener('devicemotion', this.listener);
    this.clearWatchdog();
  }

  private onMotion(event: MotionEventLike): void {
    if (!this.isArmed) return;
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null || a.x === undefined || a.y === undefined || a.z === undefined) return; // keine Daten → Watchdog läuft weiter
    this.restartWatchdog();
    const reason = this.analyzer.push({ x: a.x, y: a.y, z: a.z, t: this.now() });
    if (reason) this.fire(reason);
  }

  private fire(reason: LiftTrigger): void {
    this.disarm(); // genau einmal auslösen; erneutes Scharfschalten erst nach bewusster Wiederaufnahme
    this.deps.onTrigger(reason);
  }

  private restartWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = this.timers.setTimeout(() => {
      this.watchdog = null;
      if (this.isArmed) this.fire('sensor-lost');
    }, this.timeoutMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) this.timers.clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}
