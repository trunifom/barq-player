/**
 * Reine Logik für Kamera-Einstellungen: Zoom (Wertebereich, Voreinstellungen, Pinch-Geste), Auflösungsstufen,
 * Fokus- und Belichtungsbereiche. Keine Browser-Abhängigkeiten – die Werte stammen aus `track.getCapabilities()`
 * und werden vom Kameraadapter angewendet.
 */

/** Wertebereich einer Kamerafähigkeit (wie `MediaSettingsRange`). */
export interface CapabilityRange {
  min: number;
  max: number;
  step: number;
}

/** Auflösungsstufen der Kamera (Wunschwerte, kein Muss). */
export type CameraResolution = 'standard' | 'high' | 'max';

/** Alle Stufen in Anzeigereihenfolge. */
export const CAMERA_RESOLUTIONS: readonly CameraResolution[] = ['standard', 'high', 'max'];

/** Beschriftung und Wunschgröße je Stufe. Höhere Stufen erkennen kleine Codes besser, brauchen aber mehr Rechenzeit. */
export const RESOLUTION_INFO: Readonly<Record<CameraResolution, { label: string; width: number; height: number }>> = Object.freeze({
  standard: { label: 'Standard (1280×720, schnell)', width: 1280, height: 720 },
  high: { label: 'Hoch (1920×1080)', width: 1920, height: 1080 },
  max: { label: 'Maximal (3840×2160, kleine Codes, langsamer)', width: 3840, height: 2160 }
});

/**
 * Liest einen Wertebereich aus einem rohen Fähigkeitsobjekt.
 * @param raw - Wert aus `getCapabilities()` (beliebig, unvertrauenswürdig).
 * @returns gültiger Bereich oder `null`, wenn die Fähigkeit fehlt oder unbrauchbar ist (z. B. min = max).
 */
export function parseRange(raw: unknown): CapabilityRange | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { min, max, step } = r;
  if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max, step: typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : (max - min) / 100 };
}

/**
 * Begrenzt einen Wert auf den Bereich und rastet ihn auf die Schrittweite ein.
 * @param value - gewünschter Wert.
 * @param range - Wertebereich.
 * @returns gültiger Wert innerhalb von `min`…`max`.
 */
export function clampToRange(value: number, range: CapabilityRange): number {
  if (!Number.isFinite(value)) return range.min;
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const snapped = range.min + Math.round((clamped - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(4))));
}

/**
 * Zoom-Voreinstellungen (1×, 2×, 3×, 5×, 8× und Maximum) innerhalb des Bereichs der Kamera.
 * @param range - Zoombereich.
 * @returns eindeutige, aufsteigende Werte.
 */
export function zoomPresets(range: CapabilityRange): number[] {
  const wanted = [1, 2, 3, 5, 8];
  const out = new Set<number>();
  for (const w of wanted) if (w >= range.min && w <= range.max) out.add(clampToRange(w, range));
  out.add(range.max);
  return [...out].sort((a, b) => a - b);
}

/**
 * Berechnet den neuen Zoom bei einer Zwei-Finger-Geste.
 * @param startZoom - Zoom bei Beginn der Geste.
 * @param startDistance - Fingerabstand bei Beginn (Pixel).
 * @param distance - aktueller Fingerabstand (Pixel).
 * @param range - Zoombereich.
 * @returns neuer, begrenzter Zoom; bei unbrauchbaren Abständen der Startwert.
 */
export function pinchZoom(startZoom: number, startDistance: number, distance: number, range: CapabilityRange): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampToRange(startZoom, range);
  return clampToRange(startZoom * (distance / startDistance), range);
}

/**
 * Formatiert einen Zoomwert für die Anzeige.
 * @param zoom - Zoomfaktor.
 * @returns z. B. `2,5×`.
 */
export function formatZoom(zoom: number): string {
  return `${(Math.round(zoom * 10) / 10).toLocaleString('de-CH', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}×`;
}

/** Fokusmodi, die die App anbietet. */
export type FocusMode = 'continuous' | 'single-shot' | 'manual';

/** Beschriftung der Fokusmodi. */
export const FOCUS_LABEL: Readonly<Record<FocusMode, string>> = Object.freeze({
  continuous: 'Automatisch (laufend)',
  'single-shot': 'Einmal scharfstellen',
  manual: 'Manuell (Entfernung)'
});

/**
 * Filtert die vom Gerät gemeldeten Fokusmodi auf die, die die App kennt.
 * @param raw - Wert aus `getCapabilities().focusMode`.
 * @returns unterstützte Modi in fester Reihenfolge.
 */
export function supportedFocusModes(raw: unknown): FocusMode[] {
  if (!Array.isArray(raw)) return [];
  return (['continuous', 'single-shot', 'manual'] as const).filter((m) => raw.includes(m));
}

/**
 * Berechnet den sichtbaren Ausschnitt bei digitalem Zoom (Fallback, wenn die Kamera keinen Zoom bietet).
 * @param width - Breite des Videobilds.
 * @param height - Höhe des Videobilds.
 * @param zoom - Zoomfaktor ≥ 1.
 * @returns zentrierter Ausschnitt in Bildpunkten (ganzzahlig, innerhalb des Bilds).
 */
export function digitalCrop(width: number, height: number, zoom: number): { x: number; y: number; width: number; height: number } {
  const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  const w = Math.max(1, Math.floor(width / z));
  const h = Math.max(1, Math.floor(height / z));
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
}
