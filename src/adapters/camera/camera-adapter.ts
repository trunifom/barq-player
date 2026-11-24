/**
 * Kamerazugriff (Rückkamera, Kamerawechsel, Taschenlampe) mit klarer Fehlerdiagnose.
 *
 * Die Browser-Schnittstellen werden strukturell typisiert und per Konstruktor injiziert, damit der Adapter
 * ohne echte Kamera testbar ist. `track.stop()` wird bei jedem Beenden und vor jedem Kamerawechsel aufgerufen
 * (Android kann nicht zwei Kameras gleichzeitig öffnen).
 */
import { AppError, isAppError } from '../../domain/errors';

/** Minimale Sicht auf `MediaStreamTrack`. */
export interface MediaTrackLike {
  readonly label?: string;
  stop(): void;
  getCapabilities?(): object;
  getSettings?(): object;
  applyConstraints?(constraints: MediaTrackConstraints): Promise<void>;
}

/** Minimale Sicht auf `MediaStream`. */
export interface MediaStreamLike {
  getTracks(): MediaTrackLike[];
  getVideoTracks(): MediaTrackLike[];
}

/** Minimale Sicht auf `navigator.mediaDevices`. */
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStreamLike>;
  enumerateDevices?(): Promise<ReadonlyArray<{ deviceId: string; kind: string; label: string }>>;
}

/** Umgebung des Adapters. */
export interface CameraEnvironment {
  mediaDevices: MediaDevicesLike | undefined;
  /** `window.isSecureContext` (HTTPS oder localhost). */
  isSecureContext: boolean;
}

/** Gewünschte Kamera. */
export interface CameraOptions {
  /** Bevorzugte Blickrichtung (Standard `environment` = Rückkamera). */
  facingMode?: 'environment' | 'user';
  /** Feste Kamera; überschreibt `facingMode`. */
  deviceId?: string;
  /** Gewünschte Auflösung (Wunsch, kein Muss). */
  idealWidth?: number;
  idealHeight?: number;
}

/** Laufende Kamerasitzung. */
export interface CameraSession {
  stream: MediaStreamLike;
  track: MediaTrackLike;
  /** Tatsächliche Blickrichtung laut Einstellungen, falls bekannt. */
  facingMode: string | undefined;
  deviceId: string | undefined;
  torchSupported: boolean;
}

/**
 * Liest die Umgebung aus dem Browser (nur im Browser sinnvoll).
 * @returns Umgebung mit `mediaDevices` (kann in unsicheren Kontexten `undefined` sein).
 */
export function browserCameraEnvironment(): CameraEnvironment {
  return {
    mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : false
  };
}

/**
 * Baut die `getUserMedia`-Constraints. Die Rückkamera wird per `ideal` gewünscht (nicht `exact`),
 * damit Geräte ohne Rückkamera (z. B. Laptops) trotzdem eine Kamera liefern.
 * @param options - Kamerawunsch.
 * @returns Constraints ohne Audio.
 */
export function buildConstraints(options: CameraOptions = {}): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: options.idealWidth ?? 1280 },
    height: { ideal: options.idealHeight ?? 720 }
  };
  if (options.deviceId) video.deviceId = { exact: options.deviceId };
  else video.facingMode = { ideal: options.facingMode ?? 'environment' };
  return { video, audio: false };
}

/**
 * Ordnet einen Browserfehler einem {@link AppError} zu.
 * @param error - gefangener Wert (meist `DOMException`).
 * @returns AppError mit konkreter Diagnose und Handlungsempfehlung.
 */
export function mapCameraError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  const details = error instanceof Error ? `${name}: ${error.message}` : String(error);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new AppError('ERR_CAMERA_PERMISSION_DENIED', { details, cause: error });
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new AppError('ERR_CAMERA_NOT_FOUND', { details, cause: error });
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new AppError('ERR_CAMERA_NOT_FOUND', {
        details,
        cause: error,
        userMessage: 'Die Kamera kann nicht gestartet werden (wird evtl. von einer anderen App verwendet).',
        recoveryHint: 'Andere Apps schließen, die die Kamera nutzen, und erneut versuchen – oder Foto-Import verwenden.'
      });
    default:
      return new AppError('ERR_UNKNOWN', { details, cause: error, userMessage: 'Die Kamera konnte nicht gestartet werden.' });
  }
}

/** Kameraadapter. */
export class CameraAdapter {
  private session: CameraSession | null = null;
  private lastOptions: CameraOptions = {};

  /** @param env - Browserumgebung (injizierbar für Tests). */
  constructor(private readonly env: CameraEnvironment = browserCameraEnvironment()) {}

  /** @returns aktuelle Sitzung oder `null`. */
  get current(): CameraSession | null {
    return this.session;
  }

  /**
   * Startet die Kamera (beendet vorher eine laufende Sitzung sauber).
   * @param options - Kamerawunsch.
   * @returns neue Sitzung.
   * @throws {AppError} `ERR_CAMERA_INSECURE_CONTEXT`, `ERR_CAMERA_PERMISSION_DENIED`, `ERR_CAMERA_NOT_FOUND`, …
   */
  async start(options: CameraOptions = {}): Promise<CameraSession> {
    this.stop();
    if (!this.env.isSecureContext) throw new AppError('ERR_CAMERA_INSECURE_CONTEXT', { details: 'isSecureContext=false' });
    const devices = this.env.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== 'function') {
      throw new AppError('ERR_CAMERA_NOT_FOUND', { details: 'navigator.mediaDevices.getUserMedia fehlt', userMessage: 'Dieser Browser bietet keinen Kamerazugriff.' });
    }
    let stream: MediaStreamLike;
    try {
      stream = await devices.getUserMedia(buildConstraints(options));
    } catch (error: unknown) {
      throw mapCameraError(error);
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      throw new AppError('ERR_CAMERA_NOT_FOUND', { details: 'Stream ohne Videospur' });
    }
    const settings = (track.getSettings?.() ?? {}) as { facingMode?: unknown; deviceId?: unknown };
    const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: unknown };
    this.lastOptions = options;
    this.session = {
      stream,
      track,
      facingMode: typeof settings.facingMode === 'string' ? settings.facingMode : undefined,
      deviceId: typeof settings.deviceId === 'string' ? settings.deviceId : undefined,
      torchSupported: capabilities.torch === true
    };
    return this.session;
  }

  /**
   * Beendet die Kamera: `track.stop()` für alle Spuren. Alle Spuren werden beendet, auch wenn eine einen Fehler wirft;
   * danach wird der erste Fehler gemeldet (nie still verschluckt).
   * @throws {AppError} `ERR_UNKNOWN`, wenn `track.stop()` fehlschlug (Sitzung ist trotzdem beendet).
   */
  stop(): void {
    const session = this.session;
    this.session = null;
    if (!session) return;
    let failure: unknown;
    for (const track of session.stream.getTracks()) {
      try {
        track.stop();
      } catch (error: unknown) {
        failure ??= error;
      }
    }
    if (failure !== undefined) {
      throw new AppError('ERR_UNKNOWN', { details: 'track.stop() fehlgeschlagen', cause: failure, userMessage: 'Die Kamera konnte nicht sauber beendet werden.' });
    }
  }

  /**
   * Listet die Videoeingänge (Beschriftungen sind erst nach erteilter Berechtigung gefüllt).
   * @returns Geräte; leer, wenn die Liste nicht verfügbar ist.
   */
  async listCameras(): Promise<Array<{ deviceId: string; label: string }>> {
    const devices = this.env.mediaDevices;
    if (!devices?.enumerateDevices) return [];
    try {
      return (await devices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    } catch (error: unknown) {
      throw mapCameraError(error);
    }
  }

  /**
   * Wechselt die Kamera: erst `track.stop()`, dann neue Kamera starten. Gibt es mehrere Geräte, wird das nächste
   * gewählt, sonst die Blickrichtung gewechselt. Schlägt der Wechsel fehl, wird versucht, die vorherige Kamera
   * wiederherzustellen; der ursprüngliche Fehler wird in jedem Fall gemeldet.
   * @returns neue Sitzung.
   * @throws {AppError} Fehler der neuen Kamera.
   */
  async switchCamera(): Promise<CameraSession> {
    const previous = this.session;
    const previousOptions = this.lastOptions;
    const cameras = await this.listCameras();
    let next: CameraOptions;
    if (cameras.length > 1) {
      const idx = cameras.findIndex((c) => c.deviceId === previous?.deviceId);
      const target = cameras[(idx + 1) % cameras.length];
      next = { ...previousOptions, deviceId: target?.deviceId as string };
    } else {
      const { deviceId: _ignored, ...rest } = previousOptions;
      next = { ...rest, facingMode: (previous?.facingMode ?? previousOptions.facingMode ?? 'environment') === 'environment' ? 'user' : 'environment' };
    }
    try {
      return await this.start(next);
    } catch (error: unknown) {
      let restoreFailure: unknown = null;
      try {
        await this.start(previousOptions);
      } catch (restoreError: unknown) {
        restoreFailure = restoreError; // Sitzung bleibt beendet; der Fehler wird unten im Detail mitgemeldet
      }
      if (restoreFailure !== null && isAppError(error)) {
        const why = restoreFailure instanceof Error ? restoreFailure.message : String(restoreFailure);
        throw new AppError(error.code, {
          details: `${error.details ?? error.message}; Wiederherstellung der vorherigen Kamera gescheitert: ${why}`,
          cause: error,
          userMessage: error.userMessage,
          recoveryHint: error.recoveryHint
        });
      }
      throw error;
    }
  }

  /** @returns `true`, wenn die aktuelle Kamera eine Taschenlampe bietet. */
  get torchSupported(): boolean {
    return this.session?.torchSupported ?? false;
  }

  /**
   * Schaltet die Taschenlampe.
   * @param on - an/aus.
   * @throws {AppError} `ERR_CAMERA_UNSUPPORTED`, wenn keine Kamera läuft oder die Hardware es nicht kann.
   */
  async setTorch(on: boolean): Promise<void> {
    const session = this.session;
    if (!session?.torchSupported || !session.track.applyConstraints) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: 'torch nicht verfügbar', userMessage: 'Die Taschenlampe wird von dieser Kamera nicht unterstützt.' });
    }
    try {
      await session.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    } catch (error: unknown) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: error instanceof Error ? `${error.name}: ${error.message}` : String(error), cause: error, userMessage: 'Die Taschenlampe konnte nicht geschaltet werden.' });
    }
  }
}
