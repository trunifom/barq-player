import { describe, expect, it, vi, type Mock } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { clampToRange, digitalCrop, formatZoom, parseRange, pinchZoom, supportedFocusModes, zoomPresets, RESOLUTION_INFO, CAMERA_RESOLUTIONS } from '../../src/domain/camera-controls';
import { CameraAdapter, type MediaStreamLike, type MediaTrackLike } from '../../src/adapters/camera/camera-adapter';

describe('parseRange', () => {
  it('liest gültige Bereiche und ergänzt eine Schrittweite', () => {
    expect(parseRange({ min: 1, max: 8, step: 0.1 })).toEqual({ min: 1, max: 8, step: 0.1 });
    expect(parseRange({ min: 0, max: 10 })).toEqual({ min: 0, max: 10, step: 0.1 });
    expect(parseRange({ min: 0, max: 10, step: 0 })?.step).toBe(0.1);
  });
  it('lehnt fehlende, feste und unsinnige Bereiche ab', () => {
    for (const bad of [undefined, null, 5, 'x', {}, { min: 1, max: 1 }, { min: 3, max: 2 }, { min: 'a', max: 2 }, { min: 0, max: Number.NaN }]) expect(parseRange(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('clampToRange', () => {
  const r = { min: 1, max: 5, step: 0.5 };
  it('begrenzt und rastet ein', () => {
    expect(clampToRange(0, r)).toBe(1);
    expect(clampToRange(9, r)).toBe(5);
    expect(clampToRange(2.3, r)).toBe(2.5);
    expect(clampToRange(2.2, r)).toBe(2);
  });
  it('unbrauchbare Werte ergeben das Minimum', () => {
    expect(clampToRange(Number.NaN, r)).toBe(1);
    expect(clampToRange(Number.POSITIVE_INFINITY, r)).toBe(1);
  });
  it('liefert nie Werte außerhalb des Bereichs (auch bei krummen Schritten)', () => {
    const odd = { min: 0, max: 1, step: 0.3 };
    for (let v = -1; v <= 2; v += 0.07) {
      const c = clampToRange(v, odd);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('zoomPresets', () => {
  it('nur Werte im Bereich, aufsteigend, mit Maximum', () => {
    expect(zoomPresets({ min: 1, max: 8, step: 0.1 })).toEqual([1, 2, 3, 5, 8]);
    expect(zoomPresets({ min: 1, max: 4, step: 0.1 })).toEqual([1, 2, 3, 4]);
    expect(zoomPresets({ min: 1, max: 2.5, step: 0.1 })).toEqual([1, 2, 2.5]);
    expect(zoomPresets({ min: 2, max: 10, step: 1 })).toEqual([2, 3, 5, 8, 10]);
  });
});

describe('pinchZoom', () => {
  const r = { min: 1, max: 8, step: 0.1 };
  it('Finger auseinander = hineinzoomen, zusammen = herauszoomen, begrenzt', () => {
    expect(pinchZoom(2, 100, 200, r)).toBe(4);
    expect(pinchZoom(4, 200, 100, r)).toBe(2);
    expect(pinchZoom(4, 100, 1000, r)).toBe(8);
    expect(pinchZoom(2, 100, 10, r)).toBe(1);
  });
  it('unbrauchbare Abstände lassen den Zoom unverändert', () => {
    expect(pinchZoom(3, 0, 100, r)).toBe(3);
    expect(pinchZoom(3, 100, 0, r)).toBe(3);
    expect(pinchZoom(3, Number.NaN, 100, r)).toBe(3);
  });
});

describe('formatZoom / supportedFocusModes / digitalCrop', () => {
  it('formatiert Zoomfaktoren', () => {
    expect(formatZoom(1)).toMatch(/^1×$/);
    expect(formatZoom(2.54)).toMatch(/^2[,.]5×$/);
  });
  it('filtert Fokusmodi auf bekannte in fester Reihenfolge', () => {
    expect(supportedFocusModes(['manual', 'none', 'continuous'])).toEqual(['continuous', 'manual']);
    expect(supportedFocusModes(undefined)).toEqual([]);
    expect(supportedFocusModes('continuous')).toEqual([]);
  });
  it('digitaler Ausschnitt ist zentriert, ganzzahlig und im Bild', () => {
    expect(digitalCrop(1280, 720, 2)).toEqual({ x: 320, y: 180, width: 640, height: 360 });
    expect(digitalCrop(1000, 500, 1)).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    expect(digitalCrop(1000, 500, 0.5)).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    const c = digitalCrop(101, 53, 3.3);
    expect(c.x + c.width).toBeLessThanOrEqual(101);
    expect(c.y + c.height).toBeLessThanOrEqual(53);
    expect(Number.isInteger(c.x) && Number.isInteger(c.width)).toBe(true);
  });
  it('Auflösungsstufen sind aufsteigend', () => {
    const px = CAMERA_RESOLUTIONS.map((r) => RESOLUTION_INFO[r].width * RESOLUTION_INFO[r].height);
    expect([...px].sort((a, b) => a - b)).toEqual(px);
  });
});

// ---------------------------------------------------------------------------------------------- Adapter

interface FakeTrack extends Omit<MediaTrackLike, 'applyConstraints'> {
  applyConstraints: Mock<(constraints: MediaTrackConstraints) => Promise<void>>;
}

function setup(caps: Record<string, unknown>, extra: { photo?: () => Promise<Blob>; settings?: Record<string, unknown> } = {}): { cam: CameraAdapter; track: FakeTrack } {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => caps,
    getSettings: () => ({ facingMode: 'environment', deviceId: 'd1', width: 1920, height: 1080, ...extra.settings }),
    applyConstraints: vi.fn((_constraints: MediaTrackConstraints) => Promise.resolve())
  };
  const stream: MediaStreamLike = { getTracks: () => [track], getVideoTracks: () => [track] };
  const cam = new CameraAdapter({
    isSecureContext: true,
    mediaDevices: { getUserMedia: () => Promise.resolve(stream) },
    createImageCapture: extra.photo ? () => ({ takePhoto: extra.photo as () => Promise<Blob> }) : undefined
  });
  return { cam, track };
}

const FULL = { torch: true, zoom: { min: 1, max: 8, step: 0.1 }, focusMode: ['continuous', 'manual'], focusDistance: { min: 0.1, max: 2, step: 0.05 }, exposureCompensation: { min: -2, max: 2, step: 0.5 } };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof AppError) return `${e.code}|${e.userMessage}`;
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('CameraAdapter: Fähigkeiten', () => {
  it('liest Zoom, Fokus, Belichtung und Auflösung aus der Kamera', async () => {
    const { cam } = setup(FULL);
    const s = await cam.start();
    expect(s.zoom).toEqual({ min: 1, max: 8, step: 0.1 });
    expect(s.focusModes).toEqual(['continuous', 'manual']);
    expect(s.focusDistance).toEqual({ min: 0.1, max: 2, step: 0.05 });
    expect(s.exposure).toEqual({ min: -2, max: 2, step: 0.5 });
    expect([s.width, s.height]).toEqual([1920, 1080]);
  });
  it('Kamera ohne Fähigkeiten: alles null/leer (Regler werden ausgeblendet)', async () => {
    const { cam } = setup({});
    const s = await cam.start();
    expect([s.zoom, s.focusModes, s.focusDistance, s.exposure]).toEqual([null, [], null, null]);
  });
});

describe('CameraAdapter: Einstellungen anwenden', () => {
  it('setZoom begrenzt auf den Bereich und ruft applyConstraints mit advanced-Zoom auf', async () => {
    const { cam, track } = setup(FULL);
    await cam.start();
    expect(await cam.setZoom(3.04)).toBe(3);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 3 }] });
    expect(await cam.setZoom(99)).toBe(8);
    expect(await cam.setZoom(0)).toBe(1);
  });
  it('setZoom ohne Hardware-Zoom oder ohne Kamera → verständlicher Fehler, kein applyConstraints', async () => {
    const { cam, track } = setup({});
    await cam.start();
    expect(await code(cam.setZoom(2))).toContain('ERR_CAMERA_UNSUPPORTED|Diese Kamera bietet keinen Zoom');
    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(await code(new CameraAdapter({ isSecureContext: true, mediaDevices: undefined }).setZoom(2))).toContain('ERR_CAMERA_UNSUPPORTED');
  });
  it('Fehler der Hardware werden als ERR_CAMERA_UNSUPPORTED mit Ursache gemeldet', async () => {
    const { cam, track } = setup(FULL);
    await cam.start();
    track.applyConstraints.mockRejectedValueOnce(new DOMException('weg', 'OverconstrainedError'));
    expect(await code(cam.setZoom(2))).toContain('Der Zoom konnte nicht eingestellt werden');
  });
  it('Fokusmodus: nur angebotene Modi; manuelle Entfernung setzt den Modus mit', async () => {
    const { cam, track } = setup(FULL);
    await cam.start();
    await cam.setFocusMode('continuous');
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ focusMode: 'continuous' }] });
    expect(await code(cam.setFocusMode('single-shot'))).toContain('ERR_CAMERA_UNSUPPORTED');
    expect(await cam.setFocusDistance(5)).toBe(2);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ focusMode: 'manual', focusDistance: 2 }] });
  });
  it('manueller Fokus ohne Unterstützung wird abgelehnt', async () => {
    const { cam } = setup({ focusMode: ['continuous'], focusDistance: { min: 0, max: 1, step: 0.1 } });
    await cam.start();
    expect(await code(cam.setFocusDistance(0.5))).toContain('ERR_CAMERA_UNSUPPORTED');
  });
  it('Belichtungskorrektur wird begrenzt und angewendet; ohne Unterstützung Fehler', async () => {
    const { cam, track } = setup(FULL);
    await cam.start();
    expect(await cam.setExposure(-5)).toBe(-2);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ exposureCompensation: -2 }] });
    const none = setup({});
    await none.cam.start();
    expect(await code(none.cam.setExposure(1))).toContain('ERR_CAMERA_UNSUPPORTED');
  });
});

describe('CameraAdapter: hochauflösendes Foto', () => {
  it('liefert das Foto der Kamera', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
    const { cam } = setup(FULL, { photo: () => Promise.resolve(blob) });
    await cam.start();
    expect(cam.photoSupported).toBe(true);
    expect(await cam.takePhoto()).toBe(blob);
  });
  it('ohne ImageCapture oder ohne Kamera: Hinweis auf die Kamera-App; Aufnahmefehler werden gemeldet', async () => {
    const a = setup(FULL);
    await a.cam.start();
    expect(a.cam.photoSupported).toBe(false);
    expect(await code(a.cam.takePhoto())).toContain('Mit Kamera-App fotografieren');
    const b = setup(FULL, { photo: () => Promise.reject(new Error('kaputt')) });
    await b.cam.start();
    expect(await code(b.cam.takePhoto())).toContain('Das Foto konnte nicht aufgenommen werden');
    const c = setup(FULL, { photo: () => Promise.resolve(new Blob()) });
    expect(await code(c.cam.takePhoto())).toContain('ERR_CAMERA_UNSUPPORTED'); // Kamera nicht gestartet
  });
});
