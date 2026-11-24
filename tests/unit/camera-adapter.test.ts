import { describe, expect, it, vi, type Mock } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  CameraAdapter,
  buildConstraints,
  mapCameraError,
  type CameraEnvironment,
  type MediaDevicesLike,
  type MediaStreamLike,
  type MediaTrackLike
} from '../../src/adapters/camera/camera-adapter';

function domError(name: string, message = 'x'): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

interface FakeTrack extends MediaTrackLike {
  stopped: boolean;
  stop: Mock<() => void>;
  applyConstraints: Mock<(c: MediaTrackConstraints) => Promise<void>>;
}

function makeTrack(opts: { facingMode?: string; deviceId?: string; torch?: boolean; stopThrows?: boolean } = {}): FakeTrack {
  const track: FakeTrack = {
    stopped: false,
    stop: vi.fn(() => {
      track.stopped = true;
      if (opts.stopThrows) throw new Error('stop kaputt');
    }),
    applyConstraints: vi.fn((_c: MediaTrackConstraints) => Promise.resolve()),
    getSettings: () => ({ facingMode: opts.facingMode, deviceId: opts.deviceId }),
    getCapabilities: () => (opts.torch ? { torch: true } : {})
  };
  return track;
}

function makeStream(tracks: FakeTrack[]): MediaStreamLike {
  return { getTracks: () => tracks, getVideoTracks: () => tracks };
}

function env(getUserMedia: MediaDevicesLike['getUserMedia'], extra: Partial<MediaDevicesLike> = {}, secure = true): CameraEnvironment {
  return { mediaDevices: { getUserMedia, ...extra }, isSecureContext: secure };
}

describe('buildConstraints', () => {
  it('Standard: Rückkamera per ideal (nicht exact), 1280×720 gewünscht, kein Audio', () => {
    expect(buildConstraints()).toEqual({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'environment' } },
      audio: false
    });
  });

  it('Frontkamera, feste Kamera (überschreibt facingMode) und Auflösung', () => {
    expect(buildConstraints({ facingMode: 'user' }).video).toMatchObject({ facingMode: { ideal: 'user' } });
    const fixed = buildConstraints({ deviceId: 'abc', facingMode: 'user', idealWidth: 640, idealHeight: 480 }).video as MediaTrackConstraints;
    expect(fixed.deviceId).toEqual({ exact: 'abc' });
    expect(fixed.facingMode).toBeUndefined();
    expect(fixed.width).toEqual({ ideal: 640 });
  });
});

describe('mapCameraError', () => {
  it.each([
    ['NotAllowedError', 'ERR_CAMERA_PERMISSION_DENIED'],
    ['PermissionDeniedError', 'ERR_CAMERA_PERMISSION_DENIED'],
    ['SecurityError', 'ERR_CAMERA_PERMISSION_DENIED'],
    ['NotFoundError', 'ERR_CAMERA_NOT_FOUND'],
    ['DevicesNotFoundError', 'ERR_CAMERA_NOT_FOUND'],
    ['OverconstrainedError', 'ERR_CAMERA_NOT_FOUND'],
    ['NotReadableError', 'ERR_CAMERA_NOT_FOUND'],
    ['AbortError', 'ERR_CAMERA_NOT_FOUND'],
    ['TypeError', 'ERR_UNKNOWN']
  ])('%s → %s', (name, code) => {
    expect(mapCameraError(domError(name)).code).toBe(code);
  });

  it('NotReadableError nennt die andere App als mögliche Ursache', () => {
    expect(mapCameraError(domError('NotReadableError')).userMessage).toContain('anderen App');
  });

  it('AppError bleibt unverändert; Nicht-Errors werden zu ERR_UNKNOWN', () => {
    const a = new AppError('ERR_DECODE_FAILED');
    expect(mapCameraError(a)).toBe(a);
    expect(mapCameraError('x').code).toBe('ERR_UNKNOWN');
    expect(mapCameraError(null).code).toBe('ERR_UNKNOWN');
  });
});

describe('CameraAdapter.start', () => {
  it('startet die Rückkamera und liefert Sitzungsdaten', async () => {
    const track = makeTrack({ facingMode: 'environment', deviceId: 'cam1', torch: true });
    const gum = vi.fn(() => Promise.resolve(makeStream([track])));
    const cam = new CameraAdapter(env(gum));
    const s = await cam.start();
    expect(gum).toHaveBeenCalledWith(buildConstraints());
    expect(s).toMatchObject({ facingMode: 'environment', deviceId: 'cam1', torchSupported: true });
    expect(cam.current).toBe(s);
    expect(cam.torchSupported).toBe(true);
  });

  it('kein HTTPS → ERR_CAMERA_INSECURE_CONTEXT (ohne getUserMedia aufzurufen)', async () => {
    const gum = vi.fn();
    const cam = new CameraAdapter(env(gum as never, {}, false));
    await expect(cam.start()).rejects.toMatchObject({ code: 'ERR_CAMERA_INSECURE_CONTEXT' });
    expect(gum).not.toHaveBeenCalled();
  });

  it('keine mediaDevices-API → ERR_CAMERA_NOT_FOUND', async () => {
    const cam = new CameraAdapter({ mediaDevices: undefined, isSecureContext: true });
    await expect(cam.start()).rejects.toMatchObject({ code: 'ERR_CAMERA_NOT_FOUND' });
  });

  it('Berechtigung verweigert / Gerät nicht gefunden', async () => {
    const denied = new CameraAdapter(env(() => Promise.reject(domError('NotAllowedError'))));
    await expect(denied.start()).rejects.toMatchObject({ code: 'ERR_CAMERA_PERMISSION_DENIED' });
    const missing = new CameraAdapter(env(() => Promise.reject(domError('NotFoundError'))));
    await expect(missing.start()).rejects.toMatchObject({ code: 'ERR_CAMERA_NOT_FOUND' });
    expect(denied.current).toBeNull();
  });

  it('Stream ohne Videospur wird sauber beendet und gemeldet', async () => {
    const audioOnly: MediaStreamLike = { getTracks: () => [makeTrack()], getVideoTracks: () => [] };
    const t = audioOnly.getTracks()[0] as FakeTrack;
    const cam = new CameraAdapter(env(() => Promise.resolve({ getTracks: () => [t], getVideoTracks: () => [] })));
    await expect(cam.start()).rejects.toMatchObject({ code: 'ERR_CAMERA_NOT_FOUND' });
    expect(t.stop).toHaveBeenCalled();
  });

  it('beendet vor einem Neustart die laufende Sitzung (track.stop)', async () => {
    const t1 = makeTrack();
    const t2 = makeTrack();
    const streams = [makeStream([t1]), makeStream([t2])];
    const cam = new CameraAdapter(env(() => Promise.resolve(streams.shift() as MediaStreamLike)));
    await cam.start();
    await cam.start();
    expect(t1.stopped).toBe(true);
    expect(t2.stopped).toBe(false);
  });
});

describe('CameraAdapter.stop', () => {
  it('beendet alle Spuren und leert die Sitzung; zweites stop ist ein No-op', async () => {
    const t = makeTrack();
    const cam = new CameraAdapter(env(() => Promise.resolve(makeStream([t]))));
    await cam.start();
    cam.stop();
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(cam.current).toBeNull();
    expect(cam.torchSupported).toBe(false);
    expect(() => cam.stop()).not.toThrow();
    expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('beendet auch die übrigen Spuren, wenn eine wirft, und meldet danach den Fehler', async () => {
    const bad = makeTrack({ stopThrows: true });
    const good = makeTrack();
    const cam = new CameraAdapter(env(() => Promise.resolve(makeStream([bad, good]))));
    await cam.start();
    expect(() => cam.stop()).toThrow(AppError);
    expect(good.stopped).toBe(true);
    expect(cam.current).toBeNull();
  });
});

describe('Kamerawechsel', () => {
  it('mit mehreren Geräten: erst stop, dann die nächste Kamera (zyklisch)', async () => {
    const order: string[] = [];
    const t1 = makeTrack({ deviceId: 'a', facingMode: 'environment' });
    const t2 = makeTrack({ deviceId: 'b', facingMode: 'user' });
    t1.stop.mockImplementation(() => {
      order.push('stop-a');
    });
    const gum = vi.fn((c: MediaStreamConstraints) => {
      order.push(`start-${(c.video as MediaTrackConstraints).deviceId ? JSON.stringify((c.video as MediaTrackConstraints).deviceId) : 'default'}`);
      return Promise.resolve(makeStream([order.length === 1 ? t1 : t2]));
    });
    const cam = new CameraAdapter(
      env(gum, {
        enumerateDevices: () =>
          Promise.resolve([
            { deviceId: 'a', kind: 'videoinput', label: 'Rück' },
            { deviceId: 'b', kind: 'videoinput', label: 'Front' },
            { deviceId: 'm', kind: 'audioinput', label: 'Mikro' }
          ])
      })
    );
    await cam.start();
    const s = await cam.switchCamera();
    expect(order).toEqual(['start-default', 'stop-a', 'start-{"exact":"b"}']);
    expect(s.deviceId).toBe('b');
    // zyklisch zurück zu a
    gum.mockImplementationOnce(() => Promise.resolve(makeStream([makeTrack({ deviceId: 'a' })])));
    await cam.switchCamera();
    expect(gum).toHaveBeenLastCalledWith(buildConstraints({ deviceId: 'a' }));
  });

  it('mit nur einem Gerät: Blickrichtung wechseln', async () => {
    const gum = vi.fn((_c: MediaStreamConstraints) => Promise.resolve(makeStream([makeTrack({ facingMode: 'environment' })])));
    const cam = new CameraAdapter(env(gum));
    await cam.start();
    await cam.switchCamera();
    expect((gum.mock.calls[1]?.[0].video as MediaTrackConstraints).facingMode).toEqual({ ideal: 'user' });
  });

  it('schlägt der Wechsel fehl: vorherige Kamera wird wiederhergestellt, ursprünglicher Fehler gemeldet', async () => {
    let n = 0;
    const gum = vi.fn(() => {
      n++;
      if (n === 2) return Promise.reject(domError('NotAllowedError'));
      return Promise.resolve(makeStream([makeTrack({ facingMode: 'environment' })]));
    });
    const cam = new CameraAdapter(env(gum));
    await cam.start();
    await expect(cam.switchCamera()).rejects.toMatchObject({ code: 'ERR_CAMERA_PERMISSION_DENIED' });
    expect(gum).toHaveBeenCalledTimes(3);
    expect(cam.current).not.toBeNull(); // wiederhergestellt
  });

  it('scheitert auch die Wiederherstellung: Sitzung bleibt beendet, ursprünglicher Fehler wird gemeldet', async () => {
    let n = 0;
    const gum = vi.fn(() => {
      n++;
      if (n === 1) return Promise.resolve(makeStream([makeTrack()]));
      return Promise.reject(domError(n === 2 ? 'NotReadableError' : 'NotFoundError'));
    });
    const cam = new CameraAdapter(env(gum));
    await cam.start();
    await expect(cam.switchCamera()).rejects.toMatchObject({
      code: 'ERR_CAMERA_NOT_FOUND',
      userMessage: expect.stringContaining('anderen App'),
      details: expect.stringContaining('Wiederherstellung der vorherigen Kamera gescheitert') // der zweite Fehler geht nicht verloren
    });
    expect(cam.current).toBeNull();
  });

  it('listCameras: ohne enumerateDevices leer; Fehler werden gemeldet', async () => {
    expect(await new CameraAdapter(env(() => Promise.reject(new Error('x')))).listCameras()).toEqual([]);
    const cam = new CameraAdapter(env(() => Promise.reject(new Error('x')), { enumerateDevices: () => Promise.reject(domError('NotAllowedError')) }));
    await expect(cam.listCameras()).rejects.toMatchObject({ code: 'ERR_CAMERA_PERMISSION_DENIED' });
  });
});

describe('Taschenlampe', () => {
  it('schaltet über applyConstraints({advanced:[{torch}]})', async () => {
    const t = makeTrack({ torch: true });
    const cam = new CameraAdapter(env(() => Promise.resolve(makeStream([t]))));
    await cam.start();
    await cam.setTorch(true);
    expect(t.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    await cam.setTorch(false);
    expect(t.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it('ohne Hardware-Unterstützung oder ohne Kamera → ERR_CAMERA_UNSUPPORTED', async () => {
    const t = makeTrack({ torch: false });
    const cam = new CameraAdapter(env(() => Promise.resolve(makeStream([t]))));
    await expect(cam.setTorch(true)).rejects.toMatchObject({ code: 'ERR_CAMERA_UNSUPPORTED' });
    await cam.start();
    expect(cam.torchSupported).toBe(false);
    await expect(cam.setTorch(true)).rejects.toMatchObject({ code: 'ERR_CAMERA_UNSUPPORTED' });
    expect(t.applyConstraints).not.toHaveBeenCalled();
  });

  it('Fehler beim Schalten werden typisiert gemeldet', async () => {
    const t = makeTrack({ torch: true });
    t.applyConstraints.mockRejectedValueOnce(domError('OverconstrainedError'));
    const cam = new CameraAdapter(env(() => Promise.resolve(makeStream([t]))));
    await cam.start();
    await expect(cam.setTorch(true)).rejects.toMatchObject({ code: 'ERR_CAMERA_UNSUPPORTED' });
  });
});
