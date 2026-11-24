/**
 * Rendering-Mathematik für Barcodes und QR-Codes (reine Fachlogik, ohne DOM und ohne Bibliotheken).
 *
 * Grundregeln (AGENTS.md Regel 5, Spezifikation Kap. 18):
 * - Volle Ruhezonen (in Modulbreiten „X“): EAN-13 11X links / 7X rechts, EAN-8 7X/7X, UPC-A 9X/9X,
 *   Code 128 10X/10X, QR 4X rundum.
 * - Ganzzahlige Pixel pro Modul (in GERÄTEpixeln): nie gestreckt, nie gestaucht, nie abgeschnitten.
 * - Lange 1D-Codes werden bei Bedarf um 90° gedreht dargestellt (nur als Empfehlung der Layout-Logik).
 */
import { AppError } from './errors';
import type { Symbology } from './types';

/** Ruhezone in Modulen. */
export interface QuietZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Vertikaler Rand bei 1D-Codes (in Modulen). Die Spezifikation legt nur die horizontalen Ruhezonen fest;
 * ein weißer Rand oben/unten verhindert, dass Bildschirmrand oder Rahmen die Balken berühren (ADR-21).
 */
export const LINEAR_VERTICAL_MARGIN = 4;

/** Mindestanzahl Gerätepixel pro Modul, ab der keine Drehung empfohlen wird (ADR-22). */
export const DEFAULT_MIN_MODULE_PX = 3;

/** Balkenhöhe in Modulen je 1D-Symbologie (nominell nach GS1-Größenvorgaben; ohne Klartext). */
export const DEFAULT_BAR_HEIGHT: Readonly<Record<'EAN13' | 'EAN8' | 'UPCA' | 'Code128', number>> = {
  EAN13: 69,
  EAN8: 65,
  UPCA: 69,
  Code128: 50
};

/**
 * Liefert, ob die Symbologie ein lineares (1D) Symbol ist.
 * @param symbology - Symbologie.
 * @returns `true` für EAN-13, EAN-8, UPC-A und Code 128.
 */
export function isLinearSymbology(symbology: Symbology): boolean {
  return symbology !== 'QRCode';
}

/**
 * Ruhezone der Symbologie in Modulen.
 * @param symbology - Symbologie.
 * @returns Ruhezone (links/rechts nach Norm; QR 4X rundum; 1D oben/unten {@link LINEAR_VERTICAL_MARGIN}).
 */
export function quietZoneFor(symbology: Symbology): QuietZone {
  const v = LINEAR_VERTICAL_MARGIN;
  switch (symbology) {
    case 'EAN13':
      return { left: 11, right: 7, top: v, bottom: v };
    case 'EAN8':
      return { left: 7, right: 7, top: v, bottom: v };
    case 'UPCA':
      return { left: 9, right: 9, top: v, bottom: v };
    case 'Code128':
      return { left: 10, right: 10, top: v, bottom: v };
    case 'QRCode':
      return { left: 4, right: 4, top: 4, bottom: 4 };
  }
}

/** Verfügbare Anzeigefläche in CSS-Pixeln. */
export interface Viewport {
  width: number;
  height: number;
}

/** Ergebnis der Skalierung. */
export interface ScaleResult {
  /** Gerätepixel pro Modul (ganzzahlig, mindestens 1). */
  modulePx: number;
  /** `false`, wenn selbst 1 Gerätepixel pro Modul nicht in die Fläche passt (nicht abschneiden – melden!). */
  fits: boolean;
}

function checkInputs(modulesWide: number, modulesHigh: number, viewport: Viewport, dpr: number): void {
  const bad = (m: string): AppError => new AppError('ERR_RENDER_FAILED', { details: m });
  if (!Number.isInteger(modulesWide) || modulesWide < 1 || !Number.isInteger(modulesHigh) || modulesHigh < 1) throw bad('Modulmaße müssen positive Ganzzahlen sein');
  if (!Number.isFinite(viewport.width) || viewport.width <= 0 || !Number.isFinite(viewport.height) || viewport.height <= 0) throw bad('Viewport muss positiv sein');
  if (!Number.isFinite(dpr) || dpr <= 0) throw bad('devicePixelRatio muss positiv sein');
}

/**
 * Größtes ganzzahliges Modulmaß (Gerätepixel), bei dem das Symbol samt Ruhezone ohne Abschneiden passt.
 * @param modulesWide - Breite in Modulen inkl. Ruhezone.
 * @param modulesHigh - Höhe in Modulen inkl. Ruhezone.
 * @param viewport - Fläche in CSS-Pixeln.
 * @param dpr - Gerätepixel pro CSS-Pixel.
 * @returns Modulmaß und Passung.
 * @throws {AppError} `ERR_RENDER_FAILED` bei ungültigen Eingaben.
 */
export function integerModulePx(modulesWide: number, modulesHigh: number, viewport: Viewport, dpr: number): ScaleResult {
  checkInputs(modulesWide, modulesHigh, viewport, dpr);
  const fit = Math.floor(Math.min((viewport.width * dpr) / modulesWide, (viewport.height * dpr) / modulesHigh));
  return fit >= 1 ? { modulePx: fit, fits: true } : { modulePx: 1, fits: false };
}

/** Empfehlung zur Drehung. */
export interface RotationAdvice {
  /** `true`: Symbol um 90° gedreht darstellen. */
  rotate: boolean;
  /** Modulmaß ohne Drehung. */
  modulePx: number;
  /** Modulmaß mit Drehung. */
  modulePxRotated: number;
}

/**
 * Empfiehlt eine 90°-Drehung für breite 1D-Codes: nur wenn das Modulmaß ungedreht unter `minModulePx`
 * Gerätepixeln läge UND die Drehung ein größeres Modulmaß erlaubt. QR-Codes werden nie gedreht.
 * @param linear - `true` für 1D-Symbologien.
 * @param modulesWide - Breite in Modulen inkl. Ruhezone (ungedreht).
 * @param modulesHigh - Höhe in Modulen inkl. Ruhezone (ungedreht).
 * @param viewport - Fläche in CSS-Pixeln.
 * @param dpr - Gerätepixel pro CSS-Pixel.
 * @param minModulePx - Schwelle (Standard {@link DEFAULT_MIN_MODULE_PX}).
 * @returns Empfehlung samt beider Modulmaße.
 * @throws {AppError} `ERR_RENDER_FAILED` bei ungültigen Eingaben.
 */
export function recommendRotation(
  linear: boolean,
  modulesWide: number,
  modulesHigh: number,
  viewport: Viewport,
  dpr: number,
  minModulePx: number = DEFAULT_MIN_MODULE_PX
): RotationAdvice {
  const plain = integerModulePx(modulesWide, modulesHigh, viewport, dpr);
  const turned = integerModulePx(modulesHigh, modulesWide, viewport, dpr);
  const rotate = linear && plain.modulePx < minModulePx && turned.fits && turned.modulePx > plain.modulePx;
  return { rotate, modulePx: plain.modulePx, modulePxRotated: turned.modulePx };
}
