/**
 * Kamerazugriff (Rückkamera, Kamerawechsel, Taschenlampe) mit klarer Fehlerdiagnose.
 *
 * Die Browser-Schnittstellen werden strukturell typisiert und per Konstruktor injiziert, damit der Adapter
 * ohne echte Kamera testbar ist. `track.stop()` wird bei jedem Beenden und vor jedem Kamerawechsel aufgerufen
 * (Android kann nicht zwei Kameras gleichzeitig öffnen).
 */
import { clampToRange, parseRange, supportedFocusModes, type CapabilityRange, type FocusMode } from '../../domain/camera-controls';
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

/** Minimale Sicht auf `ImageCapture` (hochauflösende Fotos). */
export interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}

/** Umgebung des Adapters. */
export interface CameraEnvironment {
  /** Erzeugt einen `ImageCapture` für die Videospur; `undefined`, wenn der Browser ihn nicht kennt. */
  createImageCapture?: ((track: MediaTrackLike) => ImageCaptureLike) | undefined;
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
  /** Zoombereich der Kamera (Faktor), `null` ohne Hardware-Zoom. */
  zoom: CapabilityRange | null;
  /** Unterstützte Fokusmodi (leer, wenn die Kamera keine Fokussteuerung anbietet). */
  focusModes: FocusMode[];
  /** Bereich der manuellen Fokusentfernung, `null` ohne Unterstützung. */
  focusDistance: CapabilityRange | null;
  /** Bereich der Belichtungskorrektur (EV), `null` ohne Unterstützung. */
  exposure: CapabilityRange | null;
  /** Tatsächliche Auflösung laut Einstellungen, falls bekannt. */
  width: number | undefined;
  height: number | undefined;
}

/**
 * Liest die Umgebung aus dem Browser (nur im Browser sinnvoll).
 * @returns Umgebung mit `mediaDevices` (kann in unsicheren Kontexten `undefined` sein).
 */
export function browserCameraEnvironment(): CameraEnvironment {
  const ImageCaptureCtor = (globalThis as { ImageCapture?: new (track: unknown) => ImageCaptureLike }).ImageCapture;
  return {
    createImageCapture: ImageCaptureCtor ? (track) => new ImageCaptureCtor(track) : undefined,
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
    const settings = (track.getSettings?.() ?? {}) as { facingMode?: unknown; deviceId?: unknown; width?: unknown; height?: unknown };
    const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: unknown; zoom?: unknown; focusMode?: unknown; focusDistance?: unknown; exposureCompensation?: unknown };
    this.lastOptions = options;
    this.session = {
      stream,
      track,
      facingMode: typeof settings.facingMode === 'string' ? settings.facingMode : undefined,
      deviceId: typeof settings.deviceId === 'string' ? settings.deviceId : undefined,
      torchSupported: capabilities.torch === true,
      zoom: parseRange(capabilities.zoom),
      focusModes: supportedFocusModes(capabilities.focusMode),
      focusDistance: parseRange(capabilities.focusDistance),
      exposure: parseRange(capabilities.exposureCompensation),
      width: typeof settings.width === 'number' ? settings.width : undefined,
      height: typeof settings.height === 'number' ? settings.height : undefined
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

  private async applyAdvanced(constraint: Record<string, unknown>, what: string): Promise<void> {
    const session = this.session;
    if (!session?.track.applyConstraints) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: `${what}: keine Kamera`, userMessage: `${what} ist nicht verfügbar (Kamera nicht gestartet).` });
    }
    try {
      await session.track.applyConstraints({ advanced: [constraint as MediaTrackConstraintSet] });
    } catch (error: unknown) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: error instanceof Error ? `${error.name}: ${error.message}` : String(error), cause: error, userMessage: `${what} konnte nicht eingestellt werden.` });
    }
  }

  /**
   * Stellt den Hardware-Zoom ein (der Wert wird auf den Bereich der Kamera begrenzt).
   * @param value - gewünschter Zoomfaktor.
   * @returns tatsächlich angewendeter Faktor.
   * @throws {AppError} `ERR_CAMERA_UNSUPPORTED`, wenn die Kamera keinen Zoom bietet oder die Einstellung scheitert.
   */
  async setZoom(value: number): Promise<number> {
    const range = this.session?.zoom;
    if (!range) throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: 'zoom nicht verfügbar', userMessage: 'Diese Kamera bietet keinen Zoom.' });
    const applied = clampToRange(value, range);
    await this.applyAdvanced({ zoom: applied }, 'Der Zoom');
    return applied;
  }

  /**
   * Stellt den Fokusmodus ein.
   * @param mode - `continuous`, `single-shot` oder `manual`.
   * @throws {AppError} `ERR_CAMERA_UNSUPPORTED`, wenn der Modus nicht angeboten wird oder die Einstellung scheitert.
   */
  async setFocusMode(mode: FocusMode): Promise<void> {
    if (!this.session?.focusModes.includes(mode)) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: `focusMode ${mode} nicht verfügbar`, userMessage: 'Dieser Fokusmodus wird von der Kamera nicht unterstützt.' });
    }
    await this.applyAdvanced({ focusMode: mode }, 'Der Fokus');
  }

  /**
   * Stellt die manuelle Fokusentfernung ein (setzt den Modus auf manuell).
   * @param value - Entfernungswert im Bereich der Kamera.
   * @returns angewendeter Wert.
   * @throws {AppError} `ERR_CAMERA_UNSUPPORTED`, wenn nicht unterstützt.
   */
  async setFocusDistance(value: number): Promise<number> {
    const range = this.session?.focusDistance;
    if (!range || !this.session?.focusModes.includes('manual')) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: 'focusDistance nicht verfügbar', userMessage: 'Die Kamera erlaubt keine manuelle Fokusentfernung.' });
    }
    const applied = clampToRange(value, range);
    await this.applyAdvanced({ focusMode: 'manual', focusDistance: applied }, 'Der Fokus');
    return applied;
  }

  /**
   * Stellt die Belichtungskorrektur ein (heller/dunkler).
   * @param value - Wert im Bereich der Kamera (EV).
   * @returns angewendeter Wert.
   * @throws {AppError} `ERR_CAMERA_UNSUPPORTED`, wenn nicht unterstützt.
   */
  async setExposure(value: number): Promise<number> {
    const range = this.session?.exposure;
    if (!range) throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: 'exposureCompensation nicht verfügbar', userMessage: 'Die Kamera erlaubt keine Belichtungskorrektur.' });
    const applied = clampToRange(value, range);
    await this.applyAdvanced({ exposureCompensation: applied }, 'Die Belichtung');
    return applied;
  }

  /** @returns `true`, wenn der Browser hochauflösende Fotos (`ImageCapture`) anbietet. */
  get photoSupported(): boolean {
    return typeof this.env.createImageCapture === 'function';
  }

  /**
   * Nimmt ein hochauflösendes Foto mit der laufenden Kamera auf (deutlich schärfer und größer als ein Videobild).
   * @returns Bilddatei.
   * @throws {AppError} `ERR_CAMERA_UNSUPPORTED`, wenn keine Kamera läuft, der Browser `ImageCapture` nicht kennt oder die Aufnahme scheitert.
   */
  async takePhoto(): Promise<Blob> {
    const session = this.session;
    const create = this.env.createImageCapture;
    if (!session || !create) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: 'ImageCapture nicht verfügbar', userMessage: 'Dieses Gerät bzw. dieser Browser kann kein hochauflösendes Foto aufnehmen. Nutzen Sie „Mit Kamera-App fotografieren“.' });
    }
    try {
      return await create(session.track).takePhoto();
    } catch (error: unknown) {
      throw new AppError('ERR_CAMERA_UNSUPPORTED', { details: error instanceof Error ? `${error.name}: ${error.message}` : String(error), cause: error, userMessage: 'Das Foto konnte nicht aufgenommen werden.' });
    }
  }
}
