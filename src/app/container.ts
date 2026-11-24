/**
 * Composition Root: erzeugt alle Dienste und Adapter und verdrahtet sie zum {@link AppContext}.
 * Screens erhalten nur den Kontext und kennen keine Konstruktoren; Tests können einzelne Teile überschreiben.
 */
import { ErrorLogger } from '../domain/errors';
import type { Symbology } from '../domain/types';
import type { Scheduler } from '../domain/playback-machine';
import { createDatabase, type BarqDatabase, type StorageManagerLike } from '../adapters/persistence/db';
import { CameraAdapter } from '../adapters/camera/camera-adapter';
import { HybridDecoder } from '../adapters/decoder/decoder-adapter';
import { FeedbackAdapter } from '../adapters/feedback/feedback-adapter';
import { RenderCache } from '../adapters/renderer/barcode-renderer';
import { WakeLockManager, type WakeLockApi } from '../adapters/wakelock/wake-lock';
import { BackupService } from '../application/backup-service';
import { CaptureService } from '../application/capture-service';
import { CollectionService } from '../application/collection-service';
import { PlaybackController } from '../application/playback-service';
import { SessionService } from '../application/session-service';
import { SettingsStore, type KeyValueStorage } from '../application/settings-store';
import { Notifier, type NoticeTimers } from '../ui/components/notifier';
import { formatRoute, type Route } from './routes';
import { APP_VERSION } from './version';

/** Alles, was ein Screen braucht. */
export interface AppContext {
  readonly appVersion: string;
  readonly db: BarqDatabase;
  readonly collections: CollectionService;
  readonly backup: BackupService;
  readonly sessions: SessionService;
  readonly playback: PlaybackController;
  readonly camera: CameraAdapter;
  readonly feedback: FeedbackAdapter;
  readonly wakeLock: WakeLockManager;
  readonly logger: ErrorLogger;
  readonly notify: Notifier;
  readonly settings: SettingsStore;
  readonly renderCache: RenderCache;
  /** Browser-Speicherverwaltung (`navigator.storage`), falls vorhanden. */
  readonly storageManager: StorageManagerLike | undefined;
  /** Aktueller Decoder (wird bei geänderter Format-Whitelist ersetzt). */
  getDecoder(): HybridDecoder;
  /** Aktueller Capture-Service (passend zu Whitelist, „nur eindeutige Codes“ und Feedback-Einstellungen). */
  getCapture(): CaptureService;
  /** Baut Decoder und Capture-Service nach geänderten Einstellungen neu auf. */
  reconfigureCapture(): void;
  /** Wechselt den Screen. */
  navigate(route: Route): void;
  /** Monotone Zeit in ms. */
  nowMs(): number;
  /** ISO-Zeit. */
  nowIso(): string;
  /** Ermittelt die Darstellungsfläche und Pixeldichte für den Fader. */
  displayMetrics(): { width: number; height: number; devicePixelRatio: number };
}

/** Überschreibbare Teile (für Tests). */
export interface AppOverrides {
  createDecoder?: (whitelist: readonly Symbology[]) => HybridDecoder;
  camera?: CameraAdapter;
  wakeLockApi?: WakeLockApi | undefined;
  storageManager?: StorageManagerLike | undefined;
  scheduler?: Scheduler;
  noticeTimers?: NoticeTimers;
  newId?: () => string;
  nowIso?: () => string;
  nowMs?: () => number;
}

/** Umgebung der App. */
export interface AppEnvironment {
  win: Window;
  doc: Document;
  dbName?: string;
  /** Speicher für Einstellungen; `null` = nur Arbeitsspeicher. Standard `localStorage`. */
  storage?: KeyValueStorage | null;
  overrides?: AppOverrides;
}

/**
 * Erzeugt den App-Kontext.
 * @param env - Fenster, Dokument und optionale Überschreibungen.
 * @returns verdrahteter Kontext.
 */
export function createAppContext(env: AppEnvironment): AppContext {
  const o = env.overrides ?? {};
  const logger = new ErrorLogger(200);
  const notify = new Notifier(logger, o.noticeTimers);
  const db = createDatabase(env.dbName);
  const newId = o.newId ?? ((): string => crypto.randomUUID());
  const nowIso = o.nowIso ?? ((): string => new Date().toISOString());
  const nowMs = o.nowMs ?? ((): number => performance.now());
  const deps = { newId, now: nowIso };

  const collections = new CollectionService(db, deps);
  const sessions = new SessionService(db);
  const backup = new BackupService(db, APP_VERSION, deps);
  const settings = new SettingsStore(env.storage === undefined ? undefined : env.storage, () => {
    logger.log('warn', 'Einstellungen konnten nicht gelesen oder gespeichert werden (Browser-Speicher gesperrt?)');
  });
  const feedback = new FeedbackAdapter({ onError: (e) => logger.logError(e, { source: 'feedback' }) });
  const wakeLock = new WakeLockManager(
    'wakeLockApi' in o ? o.wakeLockApi : (env.win.navigator as { wakeLock?: WakeLockApi }).wakeLock,
    (e) => logger.logError(e, { source: 'wakelock' })
  );
  const scheduler: Scheduler = o.scheduler ?? {
    setTimeout: (cb, ms) => env.win.setTimeout(cb, ms),
    clearTimeout: (handle) => env.win.clearTimeout(handle as number)
  };
  const playback = new PlaybackController({
    collections,
    sessions,
    scheduler,
    newId,
    nowIso,
    appVersion: APP_VERSION,
    wakeLock,
    onPersistError: (e) => notify.error(e, { source: 'playback-log' })
  });
  const camera = o.camera ?? new CameraAdapter();
  const renderCache = new RenderCache();
  const createDecoder = o.createDecoder ?? ((whitelist: readonly Symbology[]): HybridDecoder => new HybridDecoder({ whitelist }));

  let decoder: HybridDecoder;
  let capture: CaptureService;
  const reconfigureCapture = (): void => {
    const s = settings.get();
    decoder = createDecoder(s.formats);
    capture = new CaptureService({ collections, decoder, feedback, nowMs, uniqueOnly: s.uniqueOnly });
    feedback.settings = { sound: s.sound, vibration: s.vibration };
  };
  reconfigureCapture();

  return {
    appVersion: APP_VERSION,
    db,
    collections,
    backup,
    sessions,
    playback,
    camera,
    feedback,
    wakeLock,
    logger,
    notify,
    settings,
    renderCache,
    storageManager: 'storageManager' in o ? o.storageManager : (env.win.navigator as { storage?: StorageManagerLike }).storage,
    getDecoder: () => decoder,
    getCapture: () => capture,
    reconfigureCapture,
    navigate: (route) => {
      env.win.location.hash = formatRoute(route);
    },
    nowMs,
    nowIso,
    displayMetrics: () => ({
      width: Math.max(1, env.win.innerWidth),
      height: Math.max(1, env.win.innerHeight),
      devicePixelRatio: env.win.devicePixelRatio > 0 ? env.win.devicePixelRatio : 1
    })
  };
}
