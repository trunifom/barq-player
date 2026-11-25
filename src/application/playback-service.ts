/**
 * Wiedergabe-Controller: bereitet eine Fader-Sitzung vor, startet die Zustandsmaschine und protokolliert sie.
 *
 * - Eingefrorener Snapshot: Die Ausgabeliste wird beim Start aus der Sammlung gebaut (Mengen → Wiederholungen,
 *   optional Smart-Interleaving); spätere Änderungen an der Sammlung wirken nicht auf die laufende Sitzung.
 * - Vorabprüfung: Jedes einzigartige Symbol wird vor dem Start probeweise gerendert; ein nicht darstellbarer Code
 *   verhindert den Start (statt mitten in der Sitzung zu scheitern).
 * - Protokoll: Sitzungskopf (inkl. App-Version) und Ereignisse werden fortlaufend in IndexedDB geschrieben.
 *   Schreibfehler werden gemeldet, blockieren aber nie das sofortige Ausblenden.
 * - Eine Anzeige ist nie eine Kassenbuchung: Es werden nur `displayed`, `blanked`, `paused`, `manual-confirmed`, `uncertain` erzeugt.
 */
import { AppError } from '../domain/errors';
import { localDateString, partitionByExpiry } from '../domain/expiry';
import { validateProfile } from '../domain/profiles';
import { buildCalibrationEntries, buildPlaybackEntries, entryKey, interleaveEntries } from '../domain/playback-entries';
import { PlaybackMachine, type PauseSource, type PlaybackMode, type PlaybackSnapshot, type Scheduler } from '../domain/playback-machine';
import type { InterleaveStats } from '../domain/interleaver';
import type { Viewport } from '../domain/render-layout';
import type { FaderProfile, PlaybackEntry, SessionRecord, SessionStatus } from '../domain/types';
import { renderSymbol } from '../adapters/renderer/barcode-renderer';
import type { WakeLockManager } from '../adapters/wakelock/wake-lock';
import type { CollectionService } from './collection-service';
import type { SessionService } from './session-service';

/** Anfrage zum Vorbereiten einer Sitzung. */
export interface PlaybackRequest {
  collectionId: string;
  profile: FaderProfile;
  mode: PlaybackMode;
  /** Pflicht bei `batch`. */
  batchSize?: number;
  interleave: boolean;
  /** Startposition (0-basiert). */
  startIndex?: number;
  /** Darstellungsfläche und Pixeldichte für die Vorabprüfung. */
  viewport: Viewport;
  devicePixelRatio: number;
  /** Kalibrierungslauf: genau 20 Testpositionen, Modus Automatik, kein Interleaving. */
  calibration?: boolean;
  /** `true`: abgelaufene Codes trotzdem abspielen (Standard: überspringen). */
  includeExpired?: boolean;
  /** Nur diese Positionen (Eintrags-IDs) abspielen; ohne Angabe die ganze Sammlung. Die Reihenfolge der Sammlung bleibt erhalten. */
  itemIds?: readonly string[];
}

/** Vorbereitete (noch nicht gestartete) Sitzung. */
export interface PreparedPlayback {
  request: PlaybackRequest;
  collectionName: string;
  entries: PlaybackEntry[];
  stats: InterleaveStats;
  /** Anzahl unterschiedlicher Symbole (so viele wurden vorab gerendert). */
  uniqueSymbols: number;
  /** Anzahl wegen abgelaufenem Ablaufdatum übersprungener Positionen (nicht Stückzahl). */
  skippedExpired: number;
}

/** Laufende Sitzung. */
export interface ActivePlayback {
  machine: PlaybackMachine;
  prepared: PreparedPlayback;
  session: SessionRecord;
}

/** Abhängigkeiten des Controllers. */
export interface PlaybackControllerDeps {
  collections: Pick<CollectionService, 'listItems' | 'listCollections'>;
  sessions: Pick<SessionService, 'saveSession' | 'setStatus' | 'appendEvents'>;
  scheduler: Scheduler;
  newId: () => string;
  nowIso: () => string;
  appVersion: string;
  wakeLock?: Pick<WakeLockManager, 'acquire' | 'release'>;
  /** Meldet Protokoll-Schreibfehler (die Wiedergabe läuft weiter). */
  onPersistError?: (error: unknown) => void;
}

/** Steuert höchstens eine aktive Sitzung. */
export class PlaybackController {
  private activePlayback: ActivePlayback | null = null;
  private persisted = 0;
  private lastStatus: SessionStatus | null = null;
  private chain: Promise<void> = Promise.resolve();

  /** @param deps - Collaborators. */
  constructor(private readonly deps: PlaybackControllerDeps) {}

  /** @returns die aktive Sitzung oder `null`. */
  get active(): ActivePlayback | null {
    return this.activePlayback;
  }

  /** @returns `true`, solange eine Sitzung läuft oder pausiert ist (nicht beendet). */
  get isLive(): boolean {
    const a = this.activePlayback;
    return a !== null && a.machine.snapshot.state !== 'FINISHED' && a.machine.snapshot.state !== 'IDLE';
  }

  /**
   * Baut die Ausgabeliste und prüft vorab, dass jedes Symbol darstellbar ist.
   * @param request - Sitzungswunsch.
   * @returns vorbereitete Sitzung samt Interleaving-Statistik.
   * @throws {AppError} `ERR_NOT_FOUND`, `ERR_PLAYBACK_FAILED` (leer/zu groß), `ERR_RENDER_FAILED` o. Ä. mit Positionsangabe.
   */
  async prepare(request: PlaybackRequest): Promise<PreparedPlayback> {
    const profileProblems = validateProfile(request.profile);
    if (profileProblems.length > 0) {
      throw new AppError('ERR_PLAYBACK_FAILED', { details: profileProblems.join(' '), userMessage: `Das Scannerprofil ist ungültig: ${profileProblems.join(' ')}` });
    }
    const collection = (await this.deps.collections.listCollections()).find((c) => c.id === request.collectionId);
    if (!collection) throw new AppError('ERR_NOT_FOUND', { details: `Sammlung ${request.collectionId}`, userMessage: 'Die Sammlung existiert nicht (mehr).' });
    let allItems = await this.deps.collections.listItems(request.collectionId);
    if (request.itemIds !== undefined && request.calibration !== true) {
      const wanted = new Set(request.itemIds);
      allItems = allItems.filter((i) => wanted.has(i.id));
      if (allItems.length === 0) {
        throw new AppError('ERR_PLAYBACK_FAILED', { details: 'Auswahl leer', userMessage: 'Es ist kein Code ausgewählt. Wählen Sie mindestens einen Code zum Abspielen aus.' });
      }
    }
    let items = allItems;
    let skippedExpired = 0;
    if (request.calibration !== true && request.includeExpired !== true) {
      const today = localDateString(new Date(this.deps.nowIso()));
      const split = partitionByExpiry(allItems, today);
      items = split.valid;
      skippedExpired = split.expired.length;
      if (items.length === 0 && skippedExpired > 0) {
        throw new AppError('ERR_PLAYBACK_FAILED', {
          details: `alle ${skippedExpired} Positionen abgelaufen`,
          userMessage: `Alle ${skippedExpired} Codes dieser Sammlung sind abgelaufen. Aktualisieren Sie die Ablaufdaten oder spielen Sie abgelaufene Codes bewusst trotzdem ab.`
        });
      }
    }
    let entries: PlaybackEntry[];
    let stats: InterleaveStats;
    if (request.calibration === true) {
      entries = buildCalibrationEntries(items);
      stats = { total: entries.length, identicalTransitionsBefore: 0, identicalTransitionsAfter: 0, avoidedTransitions: 0, reordered: false };
    } else {
      const built = interleaveEntries(buildPlaybackEntries(items), request.interleave);
      entries = built.entries;
      stats = built.stats;
    }
    // Vorabprüfung: jedes einzigartige Symbol einmal rendern
    const seen = new Map<string, number>();
    entries.forEach((e, i) => {
      const key = entryKey(e);
      if (seen.has(key)) return;
      seen.set(key, i);
      try {
        const rendered = renderSymbol({ symbology: e.symbology, value: e.value, viewport: request.viewport, devicePixelRatio: request.devicePixelRatio });
        if (!rendered.fits) {
          throw new AppError('ERR_RENDER_FAILED', { details: 'passt nicht auf den Bildschirm', userMessage: 'Der Code passt auf diesem Bildschirm nicht in ausreichender Größe dar.' });
        }
      } catch (error: unknown) {
        const base = error instanceof AppError ? error : new AppError('ERR_RENDER_FAILED', { details: String(error), cause: error });
        throw new AppError(base.code, { details: `Position ${i + 1}: ${base.details ?? base.message}`, cause: base, userMessage: `Position ${i + 1}: ${base.userMessage}` });
      }
    });
    return { request, collectionName: collection.name, entries, stats, uniqueSymbols: seen.size, skippedExpired };
  }

  /**
   * Startet die vorbereitete Sitzung: Sitzungskopf speichern (scheitert das, startet nichts), Zustandsmaschine
   * anlegen, Protokollierung verdrahten, Wake Lock anfordern, `start()`.
   * @param prepared - Ergebnis von {@link prepare}.
   * @returns aktive Sitzung.
   * @throws {AppError} `ERR_PLAYBACK_FAILED`, wenn bereits eine Sitzung live ist; `ERR_STORAGE_*` beim Speichern des Kopfes.
   */
  async begin(prepared: PreparedPlayback): Promise<ActivePlayback> {
    if (this.isLive) throw new AppError('ERR_PLAYBACK_FAILED', { details: 'Es läuft bereits eine Sitzung', userMessage: 'Es läuft bereits eine Wiedergabe-Sitzung.' });
    const { request } = prepared;
    const session: SessionRecord = {
      id: this.deps.newId(),
      collectionId: request.collectionId,
      startedAt: this.deps.nowIso(),
      mode: request.mode,
      appVersion: this.deps.appVersion,
      ...(request.profile.id ? { profileId: request.profile.id } : {}),
      timing: {
        displayMs: request.profile.displayMs,
        blankMs: request.profile.blankMs,
        identicalBlankMs: request.profile.identicalBlankMs,
        startDelayMs: request.profile.startDelayMs
      },
      entryCount: prepared.entries.length,
      interleaved: request.interleave && prepared.stats.reordered,
      status: 'running'
    };
    await this.deps.sessions.saveSession(session);
    const machine = new PlaybackMachine({
      sessionId: session.id,
      entries: prepared.entries,
      mode: request.mode,
      timing: {
        displayMs: request.profile.displayMs,
        blankMs: request.profile.blankMs,
        identicalBlankMs: request.profile.identicalBlankMs,
        startDelayMs: request.profile.startDelayMs
      },
      scheduler: this.deps.scheduler,
      now: this.deps.nowIso,
      onInternalError: (e) => this.deps.onPersistError?.(e),
      ...(request.batchSize === undefined ? {} : { batchSize: request.batchSize }),
      ...(request.startIndex === undefined ? {} : { startIndex: request.startIndex })
    });
    this.activePlayback = { machine, prepared, session };
    this.persisted = 0;
    this.lastStatus = 'running';
    machine.subscribe((snap) => {
      this.onSnapshot(machine, session.id, snap);
    });
    if (this.deps.wakeLock) void this.deps.wakeLock.acquire();
    machine.start();
    return this.activePlayback;
  }

  /** Schreibt neue Ereignisse und Statusänderungen (sequenziell, damit die Reihenfolge erhalten bleibt). */
  private onSnapshot(machine: PlaybackMachine, sessionId: string, snap: PlaybackSnapshot): void {
    const events = machine.events;
    if (events.length > this.persisted) {
      const fresh = events.slice(this.persisted);
      this.persisted = events.length;
      this.enqueue(() => this.deps.sessions.appendEvents(fresh));
    }
    const status: SessionStatus =
      snap.state === 'FINISHED' ? (snap.finishReason === 'aborted' ? 'aborted' : 'finished') : snap.state === 'ERROR' ? 'error' : 'running';
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.enqueue(async () => {
        await this.deps.sessions.setStatus(sessionId, status);
      });
    }
    if (snap.state === 'FINISHED' && this.deps.wakeLock) void this.deps.wakeLock.release();
  }

  private enqueue(job: () => Promise<unknown>): void {
    this.chain = this.chain
      .then(job)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.deps.onPersistError?.(error);
      });
  }

  /** @returns Promise, das erfüllt ist, sobald alle ausstehenden Protokoll-Schreibvorgänge abgeschlossen sind. */
  flush(): Promise<void> {
    return this.chain;
  }

  /**
   * Pausiert die aktive Sitzung sofort (Symbol aus).
   * @param source - Auslöser.
   * @param detail - optionale Notiz.
   * @returns `true`, wenn pausiert wurde.
   */
  pauseActive(source: PauseSource = 'operator', detail?: string): boolean {
    return this.activePlayback?.machine.pause(source, detail) ?? false;
  }

  /**
   * Setzt die aktive Sitzung bei einem Laufzeitfehler in `ERROR` (Symbol aus).
   * @param error - Fehlerwert.
   * @returns `true`, wenn der Zustand gewechselt wurde.
   */
  failActive(error: unknown): boolean {
    return this.activePlayback?.machine.fail(error) ?? false;
  }

  /** @returns `true`, wenn die aktive Sitzung abgebrochen wurde. */
  abortActive(): boolean {
    return this.activePlayback?.machine.abort() ?? false;
  }

  /** Verwirft eine beendete Sitzung (aus der Anzeige entfernen). Eine laufende Sitzung wird nicht verworfen. */
  clearFinished(): void {
    if (this.activePlayback && !this.isLive) this.activePlayback = null;
  }
}
