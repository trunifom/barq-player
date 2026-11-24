/**
 * Akustische und haptische Rückmeldung (Web Audio Piepton, Vibration).
 *
 * Browser erlauben Audio erst nach einer Nutzerinteraktion: {@link FeedbackAdapter.unlock} muss aus einem
 * Tipp-/Klick-Handler aufgerufen werden (z. B. „Kamera starten“). Rückmeldungen sind nur Komfort –
 * ein Fehler dabei darf nie eine Erfassung verhindern, wird aber über `onError` gemeldet (nicht verschluckt).
 */

/** Minimale Sicht auf einen Oszillator. */
export interface OscillatorLike {
  type: string;
  frequency: { value: number };
  connect(node: unknown): unknown;
  start(when?: number): void;
  stop(when?: number): void;
}

/** Minimale Sicht auf einen Gain-Knoten. */
export interface GainLike {
  gain: { value: number };
  connect(node: unknown): unknown;
}

/** Minimale Sicht auf einen `AudioContext`. */
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

/** Schnittstelle für den Capture-Service. */
export interface FeedbackPort {
  /** Erfolgreich in IndexedDB gespeichert. */
  saved(): void;
  /** Fehler (nicht gespeichert). */
  failed(): void;
}

/** Abhängigkeiten. */
export interface FeedbackDeps {
  audioContextCtor?: (new () => AudioContextLike) | undefined;
  vibrate?: ((pattern: number | number[]) => boolean) | undefined;
  /** Zeitquelle in ms für die Drosselung (Standard `Date.now`). */
  now?: () => number;
  /** Meldet interne Fehler (Audio/Vibration). */
  onError?: (error: unknown) => void;
  /** Mindestabstand zwischen Fehlersignalen in ms (verhindert Dauerpiepen bei wiederholtem Fehler). Standard 800. */
  failedThrottleMs?: number;
}

/** Einstellbare Kanäle. */
export interface FeedbackSettings {
  sound: boolean;
  vibration: boolean;
}

/** Rückmeldung per Ton und Vibration. */
export class FeedbackAdapter implements FeedbackPort {
  private ctx: AudioContextLike | null = null;
  private lastFailed = Number.NEGATIVE_INFINITY;
  settings: FeedbackSettings = { sound: true, vibration: true };
  private readonly deps: FeedbackDeps;

  /** @param deps - Audio-/Vibrationsfunktionen (Standard: Browser). */
  constructor(deps: FeedbackDeps = {}) {
    const g = globalThis as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike; navigator?: { vibrate?: (p: number | number[]) => boolean } };
    this.deps = {
      audioContextCtor: 'audioContextCtor' in deps ? deps.audioContextCtor : (g.AudioContext ?? g.webkitAudioContext),
      vibrate: 'vibrate' in deps ? deps.vibrate : g.navigator?.vibrate?.bind(g.navigator),
      now: deps.now ?? ((): number => Date.now()),
      ...(deps.onError ? { onError: deps.onError } : {}),
      failedThrottleMs: deps.failedThrottleMs ?? 800
    };
  }

  /** @returns `true`, wenn der Audiokontext läuft. */
  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Entsperrt Audio (aus einer Nutzeraktion aufrufen).
   * @returns `true`, wenn Audio nun nutzbar ist.
   */
  async unlock(): Promise<boolean> {
    const Ctor = this.deps.audioContextCtor;
    if (!Ctor) return false;
    try {
      this.ctx ??= new Ctor();
      if (this.ctx.state !== 'running') await this.ctx.resume();
    } catch (error: unknown) {
      this.report(error);
      return false;
    }
    return this.unlocked;
  }

  /** Kurzer hoher Ton + kurzes Vibrieren: erfolgreich gespeichert. */
  saved(): void {
    this.tone([{ freq: 880, ms: 80 }]);
    this.buzz(40);
  }

  /** Zwei tiefe Töne + Vibrationsmuster: Fehler (gedrosselt). */
  failed(): void {
    const now = (this.deps.now ?? Date.now)();
    if (now - this.lastFailed < (this.deps.failedThrottleMs ?? 800)) return;
    this.lastFailed = now;
    this.tone([{ freq: 220, ms: 120 }, { freq: 180, ms: 160 }]);
    this.buzz([80, 60, 80]);
  }

  private tone(parts: Array<{ freq: number; ms: number }>): void {
    if (!this.settings.sound || !this.ctx || !this.unlocked) return;
    try {
      let t = this.ctx.currentTime;
      for (const p of parts) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = p.freq;
        gain.gain.value = 0.2;
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + p.ms / 1000);
        t += p.ms / 1000 + 0.04;
      }
    } catch (error: unknown) {
      this.report(error);
    }
  }

  private buzz(pattern: number | number[]): void {
    if (!this.settings.vibration || !this.deps.vibrate) return;
    try {
      this.deps.vibrate(pattern);
    } catch (error: unknown) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    this.deps.onError?.(error);
  }
}
