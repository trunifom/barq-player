/**
 * Deterministische Fader-Zustandsmaschine (Spezifikation Kap. 11, 12, 17).
 *
 * Sicherheitsgrundsätze (AGENTS.md Regel 6):
 * - Es gibt keine Überblendung: Zwischen zwei Symbolen liegt immer ein leerer Zustand
 *   (`visibleEntry === null`); das Symbol ist AUSSCHLIESSLICH im Zustand `SHOWING` sichtbar.
 * - Pause, Fehler, Abbruch und Hintergrundwechsel blenden das Symbol sofort aus (synchron, vor jedem Timer).
 * - Eine Anzeige ist nie eine bestätigte Kassenbuchung: Die Maschine erzeugt niemals `pos-accepted`
 *   oder `pos-rejected`. Bestätigungen entstehen nur durch eine ausdrückliche Bedienentscheidung
 *   (`manual-confirmed`, Evidenz `operator`).
 * - Veraltete Timer werden über eine Generation-ID verworfen, auch wenn der Scheduler `clearTimeout` ignoriert.
 * - Die Ausgabeliste ist ein eingefrorener Snapshot; spätere Änderungen an der Quellliste wirken nicht.
 *
 * Die Maschine ist rein: Zeit kommt über einen injizierten {@link Scheduler}, es gibt keine DOM-/Browser-Abhängigkeit.
 */
import { AppError, toAppError, type ErrorCode } from './errors';
import type { EventEvidence, PlaybackEntry, PlaybackEvent, Symbology } from './types';

/** Zustände des Players. */
export type PlaybackState =
  | 'IDLE'
  | 'VALIDATING'
  | 'COUNTDOWN'
  | 'SHOWING'
  | 'BLANKING'
  | 'PAUSED'
  | 'WAITING_CONFIRMATION'
  | 'ERROR'
  | 'FINISHED';

/** Betriebsmodus: manuell bestätigt, automatisch (ohne Rückkanal) oder Kleinstapel. */
export type PlaybackMode = 'manual' | 'auto' | 'batch';

/** Wer/was hat pausiert. */
export type PauseSource = 'operator' | 'sensor' | 'background';

/** Abstraktion der Zeitsteuerung (in der App `setTimeout`, in Tests ein manueller Scheduler). */
export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Zeiten in Millisekunden. */
export interface PlaybackTiming {
  /** Anzeigedauer eines Symbols (> 0). */
  displayMs: number;
  /** Leerzeit vor einem ANDEREN Folgecode (>= 0). */
  blankMs: number;
  /** Leerzeit vor einem IDENTISCHEN Folgecode (>= 0). */
  identicalBlankMs: number;
  /** Startverzögerung vor der ersten Anzeige, auch nach dem Fortsetzen (>= 0). */
  startDelayMs: number;
}

/** Konfiguration einer Sitzung. */
export interface PlaybackConfig {
  sessionId: string;
  /** Ausgabeliste; wird kopiert und eingefroren. */
  entries: readonly PlaybackEntry[];
  mode: PlaybackMode;
  timing: PlaybackTiming;
  /** Pflicht bei `batch`: Anzahl Codes bis zur Bestätigung (ganze Zahl >= 1). */
  batchSize?: number;
  /** Startposition (0-basiert), Standard 0. */
  startIndex?: number;
  scheduler: Scheduler;
  /** Zeitquelle für Ereignisse (ISO-String); Standard: aktuelle Uhrzeit. */
  now?: () => string;
  /** Wird bei internen Fehlern (z. B. werfender Listener) gemeldet; nie still verschluckt. */
  onInternalError?: (error: unknown) => void;
}

/** Entscheidung der Bedienperson beim Fortsetzen nach Pause/Fehler. */
export type ResumeDecision =
  /** Kasse wurde abgeglichen: alles bis zur zuletzt angezeigten Position gilt als manuell bestätigt. */
  | { kind: 'reconciled' }
  /** Unklaren Bereich wiederholen (Warnung: Doppelbuchungen möglich). */
  | { kind: 'repeat' }
  /** Unklaren Bereich bewusst ohne Bestätigung überspringen und nach der zuletzt angezeigten Position weitermachen. */
  | { kind: 'skip' }
  /** Ab einer bestimmten Position (0-basiert) fortsetzen. */
  | { kind: 'from-position'; index: number };

/** Unklarer Übergabebereich (0-basiert, inklusive): angezeigt, aber nicht manuell bestätigt. */
export interface UncertainRange {
  from: number;
  to: number;
}

/** Unveränderlicher Blick auf den Maschinenzustand für die UI. */
export interface PlaybackSnapshot {
  readonly sessionId: string;
  readonly state: PlaybackState;
  readonly mode: PlaybackMode;
  readonly generation: number;
  readonly totalEntries: number;
  /** Aktuelle bzw. als Nächstes anzuzeigende Position (0-basiert). */
  readonly currentIndex: number | null;
  /** Das Symbol – nur im Zustand `SHOWING` nicht `null`. */
  readonly visibleEntry: PlaybackEntry | null;
  readonly lastDisplayedIndex: number | null;
  readonly highestDisplayedIndex: number | null;
  /** Zuletzt MANUELL bestätigte Position (Entscheidung der Bedienperson, kein Kassennachweis). */
  readonly lastConfirmedIndex: number | null;
  readonly uncertainRange: UncertainRange | null;
  /** `true`, wenn bereits angezeigte Positionen erneut angezeigt werden (mögliche Doppelbuchung). */
  readonly doubleBookingRisk: boolean;
  readonly errorCode: ErrorCode | null;
  readonly finishReason: 'completed' | 'aborted' | null;
  readonly pauseSource: PauseSource | null;
}

/** Listener für Zustandsänderungen. */
export type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

const SYMBOLOGIES: readonly Symbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'];

function invalid(details: string): AppError {
  return new AppError('ERR_PLAYBACK_FAILED', { details });
}

/** Zustandsmaschine für den Kassen-Fader. */
export class PlaybackMachine {
  private readonly entries: readonly PlaybackEntry[];
  private readonly scheduler: Scheduler;
  private readonly now: () => string;
  private readonly onInternalError: ((error: unknown) => void) | undefined;
  private readonly listeners = new Set<PlaybackListener>();
  private readonly log: PlaybackEvent[] = [];

  private state: PlaybackState = 'IDLE';
  private generation = 0;
  private timerHandle: unknown = null;
  private hasTimer = false;
  private currentIndex: number | null;
  private lastDisplayed: number | null = null;
  private highestDisplayed: number | null = null;
  private lastConfirmed: number | null = null;
  /** Erste Position, die noch nicht durch eine Bedienentscheidung geklärt ist. */
  private unresolvedFrom = 0;
  private displayedSinceConfirm = 0;
  private reshown = false;
  private errorCode: ErrorCode | null = null;
  private finishReason: 'completed' | 'aborted' | null = null;
  private pauseSource: PauseSource | null = null;
  private eventSeq = 0;
  private notifying = false;
  private dirty = false;

  /**
   * @param config - Sitzungskonfiguration.
   * @throws {AppError} `ERR_PLAYBACK_FAILED` bei ungültiger Konfiguration.
   */
  constructor(private readonly config: PlaybackConfig) {
    const { timing, mode } = config;
    if (typeof config.sessionId !== 'string' || config.sessionId === '') throw invalid('sessionId fehlt');
    if (!['manual', 'auto', 'batch'].includes(mode)) throw invalid(`Unbekannter Modus: ${String(mode)}`);
    if (!Number.isFinite(timing.displayMs) || timing.displayMs <= 0) throw invalid('displayMs muss > 0 sein');
    for (const key of ['blankMs', 'identicalBlankMs', 'startDelayMs'] as const) {
      const v = timing[key];
      if (!Number.isFinite(v) || v < 0) throw invalid(`${key} muss >= 0 sein`);
    }
    if (mode === 'batch' && (!Number.isInteger(config.batchSize) || (config.batchSize ?? 0) < 1)) {
      throw invalid('batchSize muss im Modus batch eine ganze Zahl >= 1 sein');
    }
    const start = config.startIndex ?? 0;
    if (!Number.isInteger(start) || start < 0 || start > config.entries.length) throw invalid('startIndex außerhalb der Liste');

    // Eingefrorener Snapshot: spätere Änderungen an der Quelle wirken nicht auf die laufende Sitzung.
    this.entries = Object.freeze(config.entries.map((e) => Object.freeze({ ...e })));
    this.scheduler = config.scheduler;
    this.now = config.now ?? ((): string => new Date().toISOString());
    this.onInternalError = config.onInternalError;
    this.currentIndex = start;
    this.unresolvedFrom = start;
  }

  // ---------------------------------------------------------------- Lesen

  /** @returns aktueller unveränderlicher Zustandsblick. */
  get snapshot(): PlaybackSnapshot {
    const idx = this.currentIndex;
    const entry = this.state === 'SHOWING' && idx !== null ? this.entries[idx] : undefined;
    const upcoming = this.state === 'COUNTDOWN' || this.state === 'BLANKING';
    const risk =
      this.highestDisplayed !== null &&
      idx !== null &&
      ((this.state === 'SHOWING' && this.reshown) || (upcoming && idx <= this.highestDisplayed));
    return Object.freeze({
      sessionId: this.config.sessionId,
      state: this.state,
      mode: this.config.mode,
      generation: this.generation,
      totalEntries: this.entries.length,
      currentIndex: idx,
      visibleEntry: entry ?? null,
      lastDisplayedIndex: this.lastDisplayed,
      highestDisplayedIndex: this.highestDisplayed,
      lastConfirmedIndex: this.lastConfirmed,
      uncertainRange: this.uncertainRange(),
      doubleBookingRisk: risk,
      errorCode: this.errorCode,
      finishReason: this.finishReason,
      pauseSource: this.pauseSource
    });
  }

  /** @returns Kopie des Ereignisprotokolls (chronologisch). */
  get events(): readonly PlaybackEvent[] {
    return [...this.log];
  }

  /** @returns die eingefrorene Ausgabeliste dieser Sitzung. */
  get frozenEntries(): readonly PlaybackEntry[] {
    return this.entries;
  }

  /**
   * Registriert einen Listener (wird nach jeder Zustandsänderung genau einmal aufgerufen).
   * @param listener - Callback.
   * @returns Funktion zum Abmelden.
   */
  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- Steuerung

  /**
   * Startet die Sitzung (nur aus `IDLE`). Ungültige Listen führen zu `ERROR`, nie zu einer Anzeige.
   * @returns `true`, wenn der Befehl angenommen wurde.
   */
  start(): boolean {
    if (this.state !== 'IDLE') return false;
    this.state = 'VALIDATING';
    const problem = this.validateEntries();
    if (problem) {
      this.enterError(invalid(problem));
    } else {
      this.beginAt(this.currentIndex ?? 0);
    }
    this.commit();
    return true;
  }

  /**
   * Pausiert und blendet das Symbol SOFORT aus (synchron). Auch für Hintergrundwechsel und Sensoren.
   * @param source - Auslöser.
   * @param detail - optionale Notiz ohne Barcode-Werte (z. B. „Kasse meldet Fehler“).
   * @returns `true`, wenn pausiert wurde (nur aus COUNTDOWN, SHOWING, BLANKING, WAITING_CONFIRMATION).
   */
  pause(source: PauseSource = 'operator', detail?: string): boolean {
    if (!['COUNTDOWN', 'SHOWING', 'BLANKING', 'WAITING_CONFIRMATION'].includes(this.state)) return false;
    this.hideNow();
    this.state = 'PAUSED';
    this.pauseSource = source;
    const evidence: EventEvidence = source === 'background' ? 'player' : source === 'sensor' ? 'sensor' : 'operator';
    this.record('paused', evidence, detail ?? `Pause (${source})`);
    this.recordUncertain();
    this.commit();
    return true;
  }

  /**
   * Meldet einen Laufzeitfehler: Symbol sofort ausblenden, Zustand `ERROR` mit sichtbarem Unsicherheitsbereich.
   * @param error - beliebiger Fehlerwert (wird zu {@link AppError} normalisiert).
   * @returns `true`, wenn der Zustand gewechselt wurde (nicht aus IDLE, FINISHED oder ERROR).
   */
  fail(error: unknown): boolean {
    if (['IDLE', 'FINISHED', 'ERROR'].includes(this.state)) return false;
    this.enterError(error);
    this.commit();
    return true;
  }

  /**
   * Bestätigt manuell (Entscheidung der Bedienperson) alle bisher angezeigten, unbestätigten Positionen.
   * Nur im Zustand `WAITING_CONFIRMATION`.
   * @returns `true`, wenn bestätigt wurde.
   */
  confirm(): boolean {
    if (this.state !== 'WAITING_CONFIRMATION') return false;
    this.confirmUpToLastDisplayed('Bestätigt durch Bedienperson');
    const next = (this.lastDisplayed ?? -1) + 1;
    this.displayedSinceConfirm = 0;
    if (next >= this.entries.length) this.finish('completed');
    else this.startBlanking(next);
    this.commit();
    return true;
  }

  /**
   * Setzt nach Pause oder Fehler fort. Es wird immer zuerst ein klarer Startzustand (Countdown, leer) hergestellt;
   * verpasste Positionen werden nie automatisch nachgeholt.
   * @param decision - Entscheidung der Bedienperson.
   * @returns `true`, wenn fortgesetzt wurde (nur aus `PAUSED`/`ERROR`, bei gültiger Position).
   */
  resume(decision: ResumeDecision): boolean {
    if (this.state !== 'PAUSED' && this.state !== 'ERROR') return false;
    if (this.validateEntries() !== null) return false; // ungültige Liste (z. B. leer) lässt sich nie fortsetzen
    const total = this.entries.length;
    let next: number;
    switch (decision.kind) {
      case 'reconciled':
        this.confirmUpToLastDisplayed('Abgeglichen (Bedienperson)');
        next = (this.lastDisplayed ?? -1) + 1;
        break;
      case 'repeat':
        next = this.unresolvedFrom;
        this.record('uncertain', 'operator', `Wiederholung ab Position ${next + 1}: Doppelbuchungen möglich`);
        break;
      case 'skip':
        if (this.lastDisplayed !== null && this.lastDisplayed >= this.unresolvedFrom) {
          this.record('uncertain', 'operator', `Bereich ${this.unresolvedFrom + 1}–${this.lastDisplayed + 1} ohne Bestätigung übersprungen`);
        }
        next = (this.lastDisplayed ?? -1) + 1;
        this.unresolvedFrom = next;
        break;
      case 'from-position':
        if (!Number.isInteger(decision.index) || decision.index < 0 || decision.index > total) return false;
        next = decision.index;
        this.record('uncertain', 'operator', `Fortsetzung ab Position ${next + 1}`);
        break;
    }
    this.errorCode = null;
    this.pauseSource = null;
    this.displayedSinceConfirm = 0;
    this.generation++; // alte Timer endgültig ungültig
    this.beginAt(next);
    this.commit();
    return true;
  }

  /**
   * Bricht die Sitzung ab (Symbol sofort aus). Der Unsicherheitsbereich bleibt im Protokoll erhalten.
   * @returns `true`, wenn abgebrochen wurde (nicht aus IDLE/FINISHED).
   */
  abort(): boolean {
    if (this.state === 'IDLE' || this.state === 'FINISHED') return false;
    this.hideNow();
    this.recordUncertain();
    this.finish('aborted');
    this.commit();
    return true;
  }

  // ---------------------------------------------------------------- Interna: Übergänge

  private validateEntries(): string | null {
    if (this.entries.length === 0) return 'Die Ausgabeliste ist leer';
    const ids = new Set<string>();
    for (const e of this.entries) {
      if (typeof e.value !== 'string' || e.value === '') return 'Eintrag ohne Wert';
      if (!SYMBOLOGIES.includes(e.symbology)) return 'Eintrag mit unbekannter Symbologie';
      if (ids.has(e.id)) return 'Doppelte Eintrags-ID';
      ids.add(e.id);
    }
    return null;
  }

  private beginAt(index: number): void {
    this.currentIndex = index;
    if (index >= this.entries.length) {
      this.finish('completed');
    } else if (this.config.timing.startDelayMs > 0) {
      this.state = 'COUNTDOWN';
      this.schedule(this.config.timing.startDelayMs, () => {
        this.show(index);
      });
    } else {
      this.show(index);
    }
  }

  private show(index: number): void {
    const entry = this.entries[index];
    if (!entry) throw invalid('Position existiert nicht');
    this.reshown = this.highestDisplayed !== null && index <= this.highestDisplayed;
    this.state = 'SHOWING';
    this.currentIndex = index;
    this.lastDisplayed = index;
    this.highestDisplayed = Math.max(this.highestDisplayed ?? index, index);
    this.displayedSinceConfirm++;
    this.record('displayed', 'player', `Position ${index + 1}${this.reshown ? ' (erneut)' : ''}`, entry.id);
    this.schedule(this.config.timing.displayMs, () => {
      this.onDisplayEnd();
    });
  }

  private onDisplayEnd(): void {
    const index = this.currentIndex ?? 0;
    this.record('blanked', 'player', 'Symbol ausgeblendet', this.entries[index]?.id);
    const isLast = index >= this.entries.length - 1;
    const { mode, batchSize } = this.config;
    if (mode === 'manual') {
      this.state = 'WAITING_CONFIRMATION';
    } else if (mode === 'batch') {
      if (isLast || this.displayedSinceConfirm >= (batchSize ?? 1)) this.state = 'WAITING_CONFIRMATION';
      else this.startBlanking(index + 1);
    } else if (isLast) {
      this.finish('completed');
    } else {
      this.startBlanking(index + 1);
    }
  }

  private startBlanking(nextIndex: number): void {
    this.state = 'BLANKING';
    this.currentIndex = nextIndex;
    const prev = this.entries[nextIndex - 1];
    const next = this.entries[nextIndex];
    const identical = prev !== undefined && next !== undefined && prev.value === next.value && prev.symbology === next.symbology;
    const { blankMs, identicalBlankMs } = this.config.timing;
    this.schedule(identical ? identicalBlankMs : blankMs, () => {
      this.show(nextIndex);
    });
  }

  private finish(reason: 'completed' | 'aborted'): void {
    this.cancelTimer();
    this.state = 'FINISHED';
    this.finishReason = reason;
  }

  private enterError(error: unknown): void {
    const appError = toAppError(error, 'ERR_PLAYBACK_FAILED');
    this.hideNow();
    this.errorCode = appError.code;
    this.state = 'ERROR';
    this.record('uncertain', 'player', `Fehler ${appError.code}`);
    this.recordUncertain();
  }

  /** Blendet SOFORT aus: Generation erhöhen (verwirft späte Timer), Timer löschen, ggf. `blanked` protokollieren. */
  private hideNow(): void {
    if (this.state === 'SHOWING') {
      this.record('blanked', 'player', 'Symbol sofort ausgeblendet', this.entries[this.currentIndex ?? -1]?.id);
    }
    this.cancelTimer();
  }

  private cancelTimer(): void {
    this.generation++;
    if (this.hasTimer) {
      this.scheduler.clearTimeout(this.timerHandle);
      this.hasTimer = false;
      this.timerHandle = null;
    }
  }

  private schedule(delayMs: number, action: () => void): void {
    const generation = this.generation;
    this.hasTimer = true;
    this.timerHandle = this.scheduler.setTimeout(() => {
      if (generation !== this.generation) return; // veralteter Timer
      this.hasTimer = false;
      this.timerHandle = null;
      try {
        action();
      } catch (error: unknown) {
        this.enterError(error);
      }
      this.commit();
    }, delayMs);
  }

  // ---------------------------------------------------------------- Interna: Protokoll & Bestätigung

  private uncertainRange(): UncertainRange | null {
    if (this.highestDisplayed === null || this.highestDisplayed < this.unresolvedFrom) return null;
    return { from: this.unresolvedFrom, to: this.highestDisplayed };
  }

  private confirmUpToLastDisplayed(detail: string): void {
    const last = this.lastDisplayed;
    if (last === null) return;
    for (let i = this.unresolvedFrom; i <= last; i++) {
      this.record('manual-confirmed', 'operator', detail, this.entries[i]?.id);
    }
    this.lastConfirmed = last;
    this.unresolvedFrom = Math.max(this.unresolvedFrom, last + 1);
  }

  private recordUncertain(): void {
    const range = this.uncertainRange();
    if (range) {
      this.record('uncertain', 'player', `Unklarer Übergabebereich: Positionen ${range.from + 1}–${range.to + 1} angezeigt, nicht bestätigt`);
    }
  }

  private record(type: PlaybackEvent['type'], evidence: EventEvidence, detail: string, entryId?: string): void {
    const event: PlaybackEvent = {
      id: `${this.config.sessionId}-${++this.eventSeq}`,
      sessionId: this.config.sessionId,
      timestamp: this.now(),
      type,
      evidence,
      detail,
      ...(entryId === undefined ? {} : { entryId })
    };
    this.log.push(event);
  }

  /** Benachrichtigt Listener genau einmal pro Operation; ein werfender Listener führt zu sicherem `ERROR`. */
  private commit(): void {
    if (this.notifying) {
      this.dirty = true;
      return;
    }
    this.notifying = true;
    try {
      let rounds = 0;
      do {
        this.dirty = false;
        const snap = this.snapshot;
        for (const listener of [...this.listeners]) {
          try {
            listener(snap);
          } catch (error: unknown) {
            this.onInternalError?.(error);
            if (!['IDLE', 'FINISHED', 'ERROR'].includes(this.state)) {
              this.enterError(error); // Unklar, ob die UI das Symbol ausgeblendet hat → sicher ausblenden
              this.dirty = true;
            }
          }
        }
        rounds++;
      } while (this.dirty && rounds < 3);
    } finally {
      this.notifying = false;
    }
  }
}
