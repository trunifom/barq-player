/**
 * Bildschirm-Wachhaltung (Screen Wake Lock API) für den Fader.
 *
 * Browser geben den Wake Lock automatisch frei, wenn die Seite in den Hintergrund wechselt. Der Manager merkt sich den
 * Wunsch (`wanted`) und fordert die Sperre bei Rückkehr erneut an ({@link WakeLockManager.reacquireIfNeeded}).
 * Ist die API nicht vorhanden, ist das kein Fehler: `supported` ist dann `false` und die UI weist darauf hin.
 */

/** Minimale Sicht auf einen `WakeLockSentinel`. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** Minimale Sicht auf `navigator.wakeLock`. */
export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** Verwaltung der Wake-Lock-Sperre. */
export class WakeLockManager {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private pending: Promise<boolean> | null = null;

  /**
   * @param api - Wake-Lock-API (Standard `navigator.wakeLock`, falls vorhanden).
   * @param onError - meldet Fehler beim Anfordern/Freigeben (nie verschluckt).
   */
  constructor(
    private readonly api: WakeLockApi | undefined = typeof navigator !== 'undefined' ? (navigator as { wakeLock?: WakeLockApi }).wakeLock : undefined,
    private readonly onError?: (error: unknown) => void
  ) {}

  /** @returns `true`, wenn der Browser die API anbietet. */
  get supported(): boolean {
    return this.api !== undefined;
  }

  /** @returns `true`, solange die Sperre gehalten wird. */
  get active(): boolean {
    return this.sentinel !== null;
  }

  /**
   * Fordert die Sperre an und merkt sich den Wunsch.
   * @returns `true`, wenn die Sperre jetzt aktiv ist.
   */
  acquire(): Promise<boolean> {
    this.wanted = true;
    return this.request();
  }

  /** Gibt die Sperre frei und vergisst den Wunsch. */
  async release(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (!s) return;
    try {
      await s.release();
    } catch (error: unknown) {
      this.onError?.(error);
    }
  }

  /**
   * Fordert die Sperre erneut an, falls gewünscht, aber (z. B. nach einem Hintergrundwechsel) nicht mehr aktiv.
   * @returns `true`, wenn die Sperre nach dem Aufruf aktiv ist.
   */
  reacquireIfNeeded(): Promise<boolean> {
    return this.wanted && !this.sentinel ? this.request() : Promise.resolve(this.active);
  }

  private request(): Promise<boolean> {
    if (!this.api) return Promise.resolve(false);
    if (this.sentinel) return Promise.resolve(true);
    this.pending ??= this.api
      .request('screen')
      .then((s) => {
        if (!this.wanted) {
          // In der Zwischenzeit freigegeben: sofort wieder loslassen
          void s.release().catch((e: unknown) => this.onError?.(e));
          return false;
        }
        this.sentinel = s;
        s.addEventListener('release', () => {
          if (this.sentinel === s) this.sentinel = null;
        });
        return true;
      })
      .catch((error: unknown) => {
        this.onError?.(error);
        return false;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
}
