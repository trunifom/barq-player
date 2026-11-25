/**
 * Bedienfeld für die Kamera: Zoom (Schieber, −/+, Voreinstellungen, Zwei-Finger-Geste), Auflösung, Fokus und Belichtung.
 *
 * - Hardware-Zoom, wenn die Kamera ihn bietet. Sonst **digitaler Zoom**: Das Bild wird vergrößert dargestellt und nur der
 *   sichtbare Ausschnitt wird ausgewertet (hilft beim Zielen und blendet störende Nachbarcodes aus; mehr Details
 *   entstehen dadurch nicht – dafür dient die höhere Auflösung bzw. das hochauflösende Foto).
 * - Nicht unterstützte Regler werden ausgeblendet, nie als funktionierend vorgetäuscht.
 * - Alle Hardware-Aufrufe sind serialisiert, damit schnelles Schieben die Kamera nicht mit Anfragen überflutet.
 */
import { CAMERA_RESOLUTIONS, FOCUS_LABEL, RESOLUTION_INFO, clampToRange, digitalCrop, formatZoom, pinchZoom, zoomPresets, type CameraResolution, type CapabilityRange, type FocusMode } from '../../domain/camera-controls';
import type { DetectionSource } from '../../adapters/decoder/decoder-adapter';
import type { CameraSession } from '../../adapters/camera/camera-adapter';
import type { AppContext } from '../../app/container';
import { h, setChildren } from './dom';

/** Bereich des digitalen Zoom (Rückfall ohne Hardware-Zoom). */
export const DIGITAL_ZOOM_RANGE: CapabilityRange = Object.freeze({ min: 1, max: 4, step: 0.1 });

/** Rückruf-Schnittstelle zum Scanner-Screen. */
export interface CameraControlsHooks {
  /** Startet die Kamera mit den aktuellen Einstellungen neu (z. B. nach Änderung der Auflösung). */
  restartCamera(): void;
}

/** Bedienfeld. */
export interface CameraControls {
  element: HTMLElement;
  /** Meldet eine neue (oder beendete) Kamerasitzung. */
  onSession(session: CameraSession | null): void;
  /** Bildquelle für die Erkennung: das Video oder – bei digitalem Zoom – der sichtbare Ausschnitt. */
  frameSource(): DetectionSource;
}

/**
 * Erzeugt das Bedienfeld.
 * @param ctx - App-Kontext (Kamera, Einstellungen, Meldungen).
 * @param video - Videoelement der Kamera.
 * @param pinchTarget - Element, auf dem die Zwei-Finger-Geste erkannt wird (Kamerabild).
 * @param hooks - Rückrufe zum Scanner.
 * @returns Bedienfeld.
 */
export function createCameraControls(ctx: AppContext, video: HTMLVideoElement, pinchTarget: HTMLElement, hooks: CameraControlsHooks): CameraControls {
  let session: CameraSession | null = null;
  let zoom = 1;
  let busy = false;
  let wanted: number | undefined;
  let canvas: HTMLCanvasElement | null = null;

  const zoomLabel = h('output', { id: 'sc-zoom-value', 'aria-live': 'polite' }, '1×');
  const zoomRange = h('input', { id: 'sc-zoom', class: 'input', type: 'range', min: 1, max: 4, step: 0.1, value: 1, 'aria-label': 'Zoom', disabled: true });
  const zoomDown = h('button', { type: 'button', class: 'btn btn--icon', id: 'sc-zoom-out', 'aria-label': 'Weniger zoomen', disabled: true }, '−');
  const zoomUp = h('button', { type: 'button', class: 'btn btn--icon', id: 'sc-zoom-in', 'aria-label': 'Mehr zoomen', disabled: true }, '+');
  const presets = h('div', { class: 'btn-row', id: 'sc-zoom-presets', role: 'group', 'aria-label': 'Zoom-Voreinstellungen' });
  const zoomInfo = h('p', { class: 'hint', id: 'sc-zoom-info' });

  const resolution = h('select', { id: 'sc-res', class: 'input', 'aria-label': 'Kameraauflösung' }, ...CAMERA_RESOLUTIONS.map((r) => h('option', { value: r, selected: r === ctx.settings.get().cameraResolution }, RESOLUTION_INFO[r].label)));
  const resolutionInfo = h('p', { class: 'hint', id: 'sc-res-info' });

  const focusMode = h('select', { id: 'sc-focus-mode', class: 'input', 'aria-label': 'Fokusmodus' });
  const focusNow = h('button', { type: 'button', class: 'btn', id: 'sc-focus-now' }, 'Jetzt scharfstellen');
  const focusDistance = h('input', { id: 'sc-focus-distance', class: 'input', type: 'range', min: 0, max: 1, step: 0.05, value: 0.5, 'aria-label': 'Fokusentfernung' });
  const focusDistanceField = h('div', { class: 'field', id: 'sc-focus-distance-field', hidden: true }, h('label', { for: 'sc-focus-distance' }, 'Fokusentfernung (links nah, rechts weit)'), focusDistance);
  const focusBox = h('div', { class: 'field', id: 'sc-focus-box', hidden: true }, h('label', { for: 'sc-focus-mode' }, 'Fokus'), focusMode, focusNow);

  const exposure = h('input', { id: 'sc-exposure', class: 'input', type: 'range', min: -2, max: 2, step: 0.5, value: 0, 'aria-label': 'Helligkeit (Belichtungskorrektur)' });
  const exposureValue = h('output', { id: 'sc-exposure-value' }, '0');
  const exposureBox = h('div', { class: 'field', id: 'sc-exposure-box', hidden: true }, h('label', { for: 'sc-exposure' }, 'Helligkeit (Belichtungskorrektur): ', exposureValue), exposure);

  const range = (): CapabilityRange | null => (session ? (session.zoom ?? DIGITAL_ZOOM_RANGE) : null);
  const digital = (): boolean => session !== null && session.zoom === null;

  const report = (source: string) => (error: unknown): void => {
    ctx.notify.error(error, { source });
  };

  const renderPresets = (): void => {
    const r = range();
    setChildren(
      presets,
      ...(r ? zoomPresets(r) : []).map((p) =>
        h('button', { type: 'button', class: 'btn', 'data-zoom': p, 'aria-pressed': String(Math.abs(p - zoom) < 0.05), onclick: () => requestZoom(p) }, formatZoom(p))
      )
    );
  };

  const renderZoom = (): void => {
    const r = range();
    zoomLabel.textContent = formatZoom(zoom);
    zoomRange.disabled = zoomDown.disabled = zoomUp.disabled = r === null;
    if (r) {
      zoomRange.min = String(r.min);
      zoomRange.max = String(r.max);
      zoomRange.step = String(r.step);
      zoomRange.value = String(zoom);
    }
    video.style.transform = digital() && zoom > 1 ? `scale(${zoom})` : '';
    zoomInfo.textContent = !session ? 'Starten Sie die Kamera, um zu zoomen.' : digital() ? 'Diese Kamera bietet keinen Hardware-Zoom: Es wird digital gezoomt (Ausschnitt). Für kleine Codes die Auflösung erhöhen oder „Hochauflösendes Foto“ nutzen.' : 'Hardware-Zoom aktiv. Bei kleinen Codes lieber zoomen, als zu nah heranzugehen (dort wird das Bild unscharf).';
    renderPresets();
  };

  /** Wendet den Zoom an (serialisiert: während einer Anfrage zählt nur der neueste Wunsch). */
  const requestZoom = (value: number): void => {
    wanted = value;
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        while (wanted !== undefined) {
          const target = wanted;
          wanted = undefined;
          const r = range();
          if (!r || !session) break;
          const clamped = clampToRange(target, r);
          zoom = digital() ? clamped : await ctx.camera.setZoom(clamped);
          ctx.settings.update({ cameraZoom: zoom });
          renderZoom();
        }
      } catch (error: unknown) {
        report('camera-zoom')(error);
      } finally {
        busy = false;
      }
    })();
  };

  zoomRange.addEventListener('input', () => requestZoom(Number(zoomRange.value)));
  zoomDown.addEventListener('click', () => requestZoom(zoom - Math.max(0.5, (range()?.step ?? 0.1) * 5)));
  zoomUp.addEventListener('click', () => requestZoom(zoom + Math.max(0.5, (range()?.step ?? 0.1) * 5)));

  // Zwei-Finger-Geste (Pinch) auf dem Kamerabild
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStart: { distance: number; zoom: number } | null = null;
  const distance = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  pinchTarget.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) pinchStart = { distance: distance(), zoom };
  });
  pinchTarget.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = range();
    if (pointers.size === 2 && pinchStart && r) requestZoom(pinchZoom(pinchStart.zoom, pinchStart.distance, distance(), r));
  });
  const endPointer = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
  };
  pinchTarget.addEventListener('pointerup', endPointer);
  pinchTarget.addEventListener('pointercancel', endPointer);

  // Auflösung
  const renderResolution = (): void => {
    resolutionInfo.textContent = session?.width && session.height ? `Aktuelle Auflösung: ${session.width}×${session.height}. Höhere Stufen lesen kleine Codes besser, verbrauchen aber mehr Akku und Rechenzeit.` : 'Höhere Stufen lesen kleine Codes besser, verbrauchen aber mehr Akku und Rechenzeit. Die Kamera wählt die nächstmögliche Auflösung.';
  };
  resolution.addEventListener('change', () => {
    ctx.settings.update({ cameraResolution: resolution.value as CameraResolution });
    if (session) hooks.restartCamera();
  });

  // Fokus
  const focusModeOptions = (modes: FocusMode[]): void => {
    setChildren(focusMode, ...modes.map((m) => h('option', { value: m }, FOCUS_LABEL[m])));
  };
  focusMode.addEventListener('change', () => {
    const mode = focusMode.value as FocusMode;
    focusDistanceField.hidden = mode !== 'manual';
    const job = mode === 'manual' ? ctx.camera.setFocusDistance(Number(focusDistance.value)).then(() => undefined) : ctx.camera.setFocusMode(mode);
    job.catch(report('camera-focus'));
  });
  focusDistance.addEventListener('input', () => {
    void ctx.camera.setFocusDistance(Number(focusDistance.value)).catch(report('camera-focus'));
  });
  focusNow.addEventListener('click', () => {
    // Autofokus neu anstoßen: einmaliger Fokus, danach zurück in den gewählten Modus
    void (async () => {
      try {
        const modes = session?.focusModes ?? [];
        if (modes.includes('single-shot')) {
          await ctx.camera.setFocusMode('single-shot');
          if (modes.includes('continuous') && focusMode.value === 'continuous') await ctx.camera.setFocusMode('continuous');
        } else if (modes.includes('continuous')) {
          await ctx.camera.setFocusMode('continuous');
        }
      } catch (error: unknown) {
        report('camera-focus')(error);
      }
    })();
  });

  // Belichtung
  exposure.addEventListener('input', () => {
    void ctx.camera
      .setExposure(Number(exposure.value))
      .then((v) => {
        exposureValue.textContent = String(v);
      })
      .catch(report('camera-exposure'));
  });

  const onSession = (next: CameraSession | null): void => {
    session = next;
    pointers.clear();
    pinchStart = null;
    wanted = undefined;
    const saved = ctx.settings.get().cameraZoom;
    const r = range();
    zoom = r ? clampToRange(saved, r) : 1;
    renderZoom();
    renderResolution();
    focusBox.hidden = !next || next.focusModes.length === 0;
    if (next && next.focusModes.length > 0) {
      focusModeOptions(next.focusModes);
      focusMode.value = next.focusModes.includes('continuous') ? 'continuous' : (next.focusModes[0] as FocusMode);
      focusDistanceField.hidden = true;
      if (next.focusDistance) {
        focusDistance.min = String(next.focusDistance.min);
        focusDistance.max = String(next.focusDistance.max);
        focusDistance.step = String(next.focusDistance.step);
        focusDistance.value = String((next.focusDistance.min + next.focusDistance.max) / 2);
      }
    }
    exposureBox.hidden = !next || next.exposure === null;
    if (next?.exposure) {
      exposure.min = String(next.exposure.min);
      exposure.max = String(next.exposure.max);
      exposure.step = String(next.exposure.step);
      exposure.value = '0';
      exposureValue.textContent = '0';
    }
    // gespeicherten Zoom wiederherstellen (Hardware-Zoom muss auf die neue Kamerasitzung angewendet werden)
    if (next?.zoom && zoom > next.zoom.min) requestZoom(zoom);
  };

  const frameSource = (): DetectionSource => {
    if (!digital() || zoom <= 1 || video.videoWidth <= 0 || video.videoHeight <= 0) return video;
    const crop = digitalCrop(video.videoWidth, video.videoHeight, zoom);
    canvas ??= document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const g = canvas.getContext('2d');
    if (!g) return video; // Canvas nicht verfügbar → ganzes Bild auswerten
    g.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return canvas;
  };

  const element = h(
    'div',
    { class: 'camera-controls', id: 'sc-camera-controls' },
    h('div', { class: 'field' }, h('label', { for: 'sc-zoom' }, 'Zoom: ', zoomLabel), h('div', { class: 'inline' }, zoomDown, zoomRange, zoomUp), presets, zoomInfo),
    h('div', { class: 'field' }, h('label', { for: 'sc-res' }, 'Auflösung'), resolution, resolutionInfo),
    focusBox,
    focusDistanceField,
    exposureBox
  );
  renderZoom();
  renderResolution();
  return { element, onSession, frameSource };
}
