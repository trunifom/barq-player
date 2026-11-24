/**
 * Optischer Renderer für EAN-13, EAN-8, UPC-A, Code 128 und QR-Code.
 *
 * Vorgehen: bwip-js liefert über `raw()` nur die Modulmuster (Balkenbreiten bzw. QR-Matrix). Das SVG wird hier
 * selbst aus GANZZAHLIGEN Modulkoordinaten erzeugt. Dadurch gilt garantiert:
 * - reines Schwarz `#000000` auf reinem Weiß `#FFFFFF` (keine Antialiasing-Graustufen, keine Dark-Mode-Umkehr),
 * - `shape-rendering="crispEdges"`, ganzzahlige Gerätepixel pro Modul (kein Strecken/Stauchen),
 * - formatgerechte Ruhezonen (siehe `render-layout.ts`),
 * - optionale 90°-Drehung breiter 1D-Codes (Geometrie wird gedreht, nicht per CSS-Transform).
 *
 * Kein Klartext unter dem Symbol: Bedienelemente und Beschriftung haben im Symbolbereich nichts verloren.
 */
import bwipjs from 'bwip-js/browser';
import { AppError } from '../../domain/errors';
import { validateCodeValue } from '../../domain/bulk-parser';
import {
  DEFAULT_BAR_HEIGHT,
  DEFAULT_MIN_MODULE_PX,
  integerModulePx,
  isLinearSymbology,
  quietZoneFor,
  recommendRotation,
  type QuietZone,
  type Viewport
} from '../../domain/render-layout';
import type { Symbology } from '../../domain/types';

/** Vordergrundfarbe (nie veränderbar). */
export const BAR_COLOR = '#000000';
/** Hintergrundfarbe (nie veränderbar). */
export const BACKGROUND_COLOR = '#FFFFFF';

/** QR-Fehlerkorrekturstufen. */
export type QrEccLevel = 'L' | 'M' | 'Q' | 'H';

/** Anfrage an den Renderer. */
export interface RenderRequest {
  symbology: Symbology;
  /** Inhalt (wird vor dem Rendern wie beim Speichern validiert). */
  value: string;
  /** QR-Fehlerkorrektur, Standard `M`. */
  eccLevel?: QrEccLevel;
  /** Verfügbare Fläche in CSS-Pixeln; ohne Angabe wird nur die Geometrie mit `pixelsPerModule` bzw. 1 berechnet. */
  viewport?: Viewport;
  /** Gerätepixel pro CSS-Pixel (Standard 1). */
  devicePixelRatio?: number;
  /** Feste ganzzahlige Gerätepixel pro Modul (überschreibt die automatische Skalierung). */
  pixelsPerModule?: number;
  /** Automatische 90°-Drehung breiter 1D-Codes erlauben (Standard `true`). */
  allowRotation?: boolean;
  /** Schwelle für die Drehung in Gerätepixeln pro Modul (Standard 3). */
  minModulePx?: number;
  /** Balkenhöhe in Modulen (1D), Standard je Symbologie. */
  barHeightModules?: number;
}

/** Rechteck in Modulkoordinaten (ganzzahlig, Ursprung oben links). */
export interface ModuleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ergebnis des Renderns. */
export interface RenderedSymbol {
  symbology: Symbology;
  value: string;
  /** Vollständiges SVG (Hintergrund + schwarze Pfade). */
  svg: string;
  /** Alle dunklen Rechtecke (nach Drehung), Grundlage für Tests und Rasterung. */
  rects: readonly ModuleRect[];
  modulesWide: number;
  modulesHigh: number;
  quietZone: QuietZone;
  /** Gerätepixel pro Modul (ganzzahlig). */
  modulePx: number;
  devicePixelRatio: number;
  /** Breite/Höhe in Gerätepixeln (immer ganzzahlig = modules × modulePx). */
  widthPx: number;
  heightPx: number;
  /** Breite/Höhe in CSS-Pixeln (= Gerätepixel / dpr). */
  cssWidth: number;
  cssHeight: number;
  /** `true`, wenn um 90° gedreht dargestellt. */
  rotated: boolean;
  /** `false`, wenn das Symbol in der angegebenen Fläche nicht einmal mit 1 Gerätepixel pro Modul passt. */
  fits: boolean;
}

const LABELS: Readonly<Record<Symbology, string>> = {
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  UPCA: 'UPC-A',
  Code128: 'Code 128',
  QRCode: 'QR-Code'
};

const BWIP_ID: Readonly<Record<Symbology, string>> = {
  EAN13: 'ean13',
  EAN8: 'ean8',
  UPCA: 'upca',
  Code128: 'code128',
  QRCode: 'qrcode'
};

function renderError(details: string, userMessage?: string, cause?: unknown): AppError {
  return new AppError('ERR_RENDER_FAILED', { details, cause, ...(userMessage === undefined ? {} : { userMessage }) });
}

/** Maskiert Text für XML-Attribute. */
function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

/** Zahl ohne überflüssige Nachkommastellen (max. 4). */
function num(n: number): string {
  return String(Math.round(n * 10_000) / 10_000);
}

/** Modulmuster eines Symbols vor Ruhezone und Skalierung. */
interface Pattern {
  /** Breite/Höhe des Symbols ohne Ruhezone, in Modulen. */
  width: number;
  height: number;
  /** Dunkle Rechtecke relativ zur linken oberen Ecke des Symbols (ohne Ruhezone). */
  rects: ModuleRect[];
}

/** Lineares Muster aus abwechselnden Balken-/Lückenbreiten (beginnt mit einem Balken). */
function linearPattern(sbs: readonly number[], barHeight: number): Pattern {
  const rects: ModuleRect[] = [];
  let x = 0;
  sbs.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, y: 0, w, h: barHeight });
    x += w;
  });
  return { width: x, height: barHeight, rects };
}

/** QR-Muster: zusammenhängende dunkle Module je Zeile werden zu einem Rechteck verschmolzen. */
function matrixPattern(pixs: readonly number[], cols: number, rows: number): Pattern {
  const rects: ModuleRect[] = [];
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      if (pixs[y * cols + x] === 1) {
        const start = x;
        while (x < cols && pixs[y * cols + x] === 1) x++;
        rects.push({ x: start, y, w: x - start, h: 1 });
      } else x++;
    }
  }
  return { width: cols, height: rows, rects };
}

/** Holt das Modulmuster von bwip-js. */
function encode(request: RenderRequest, normalizedValue: string, barHeight: number): Pattern {
  const { symbology } = request;
  let text = normalizedValue;
  // EAN/UPC: bwip-js berechnet die Prüfziffer selbst aus dem Nummernkörper (gleiche GS1-Formel wie die Domain);
  // der Wert wurde vorher validiert, die Prüfziffer ist also identisch zur gespeicherten.
  if (symbology === 'EAN13' || symbology === 'EAN8' || symbology === 'UPCA') text = normalizedValue.slice(0, -1);
  const options = symbology === 'QRCode' ? `eclevel=${request.eccLevel ?? 'M'}` : '';
  let raw;
  try {
    raw = bwipjs.raw(BWIP_ID[symbology], text, options);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw renderError(`bwip-js: ${reason}`, `Der ${LABELS[symbology]}-Inhalt kann so nicht dargestellt werden (zu lang für die gewählte Fehlerkorrektur oder ungeeignete Zeichen).`, error);
  }
  const first = raw[0];
  if (!first) throw renderError('bwip-js lieferte kein Ergebnis');
  if ('pixs' in first) return matrixPattern(first.pixs, first.pixx, first.pixy);
  return linearPattern(first.sbs, barHeight);
}

/**
 * Rendert ein Symbol als SVG (synchron, ohne DOM).
 * @param request - Symbologie, Inhalt und Anzeigeparameter.
 * @returns Geometrie und SVG.
 * @throws {AppError} Validierungsfehler des Werts (`ERR_SYNTAX_INVALID`/`ERR_CHECKSUM_INVALID`) oder `ERR_RENDER_FAILED`.
 */
export function renderSymbol(request: RenderRequest): RenderedSymbol {
  const { symbology } = request;
  const check = validateCodeValue(request.value, symbology);
  if (!check.ok) throw new AppError(check.code, { details: check.message, userMessage: check.message });
  const value = check.value;
  if (request.eccLevel !== undefined && !['L', 'M', 'Q', 'H'].includes(request.eccLevel)) {
    throw renderError(`Ungültige Fehlerkorrektur: ${String(request.eccLevel)}`);
  }
  const barHeight = request.barHeightModules ?? (symbology === 'QRCode' ? 0 : DEFAULT_BAR_HEIGHT[symbology]);
  if (symbology !== 'QRCode' && (!Number.isInteger(barHeight) || barHeight < 10)) throw renderError('barHeightModules muss eine ganze Zahl ≥ 10 sein');

  const pattern = encode(request, value, barHeight);
  const quiet = quietZoneFor(symbology);
  const modulesWide = pattern.width + quiet.left + quiet.right;
  const modulesHigh = pattern.height + quiet.top + quiet.bottom;
  const dpr = request.devicePixelRatio ?? 1;

  // Skalierung und Drehung (alles in ganzen Gerätepixeln pro Modul)
  let rotated = false;
  let modulePx: number;
  let fits = true;
  if (request.pixelsPerModule !== undefined) {
    if (!Number.isInteger(request.pixelsPerModule) || request.pixelsPerModule < 1) throw renderError('pixelsPerModule muss eine ganze Zahl ≥ 1 sein');
    modulePx = request.pixelsPerModule;
    if (!Number.isFinite(dpr) || dpr <= 0) throw renderError('devicePixelRatio muss positiv sein');
    if (request.viewport) {
      const sw = integerModulePx(modulesWide, modulesHigh, request.viewport, dpr);
      fits = modulePx <= sw.modulePx && sw.fits;
    }
  } else if (request.viewport) {
    const advice = recommendRotation(isLinearSymbology(symbology), modulesWide, modulesHigh, request.viewport, dpr, request.minModulePx ?? DEFAULT_MIN_MODULE_PX);
    rotated = advice.rotate && request.allowRotation !== false;
    const scale = integerModulePx(rotated ? modulesHigh : modulesWide, rotated ? modulesWide : modulesHigh, request.viewport, dpr);
    modulePx = scale.modulePx;
    fits = scale.fits;
  } else {
    modulePx = 1;
  }

  // Dunkle Rechtecke samt Ruhezone, bei Drehung um 90° im Uhrzeigersinn
  const base = pattern.rects.map((r) => ({ x: r.x + quiet.left, y: r.y + quiet.top, w: r.w, h: r.h }));
  const rects: ModuleRect[] = rotated ? base.map((r) => ({ x: modulesHigh - r.y - r.h, y: r.x, w: r.h, h: r.w })) : base;
  const w = rotated ? modulesHigh : modulesWide;
  const h = rotated ? modulesWide : modulesHigh;

  const widthPx = w * modulePx;
  const heightPx = h * modulePx;
  const cssWidth = widthPx / dpr;
  const cssHeight = heightPx / dpr;
  const path = rects.map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`).join('');
  const label = escapeXml(`${LABELS[symbology]} ${value}`);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${num(cssWidth)}" height="${num(cssHeight)}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${label}" style="forced-color-adjust:none;color-scheme:light only">` +
    `<rect width="${w}" height="${h}" fill="${BACKGROUND_COLOR}"/>` +
    `<path fill="${BAR_COLOR}" d="${path}"/></svg>`;

  return { symbology, value, svg, rects, modulesWide: w, modulesHigh: h, quietZone: quiet, modulePx, devicePixelRatio: dpr, widthPx, heightPx, cssWidth, cssHeight, rotated, fits };
}

/** Obergrenze der Vorausberechnung (aktuelles Symbol + 2 Folgesymbole). */
export const MAX_LOOKAHEAD = 2;

/** Schlüssel für gleichwertige Anfragen. */
function cacheKey(r: RenderRequest): string {
  const vp = r.viewport ? `${r.viewport.width}x${r.viewport.height}` : '-';
  return [r.symbology, r.value, r.eccLevel ?? 'M', vp, r.devicePixelRatio ?? 1, r.pixelsPerModule ?? 'auto', r.allowRotation ?? true, r.minModulePx ?? '', r.barHeightModules ?? ''].join('\u0000');
}

/**
 * Kleiner LRU-Cache für die nächsten ein bis zwei Symbole einer laufenden Sitzung
 * (keine Vorberechnung riesiger Listen, Spezifikation 17).
 */
export class RenderCache {
  private readonly map = new Map<string, RenderedSymbol>();

  /**
   * @param maxEntries - maximale Zahl gehaltener Symbole (Standard `MAX_LOOKAHEAD + 1`).
   * @throws {AppError} `ERR_RENDER_FAILED`, wenn `maxEntries` keine positive Ganzzahl ist.
   */
  constructor(private readonly maxEntries: number = MAX_LOOKAHEAD + 1) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw renderError('maxEntries muss eine positive Ganzzahl sein');
  }

  /** @returns Anzahl gehaltener Symbole. */
  get size(): number {
    return this.map.size;
  }

  /**
   * Liefert das Symbol aus dem Cache oder rendert es und merkt es sich.
   * @param request - Renderanfrage.
   * @returns gerendertes Symbol.
   * @throws {AppError} siehe {@link renderSymbol}.
   */
  get(request: RenderRequest): RenderedSymbol {
    const key = cacheKey(request);
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit); // als zuletzt genutzt markieren
      return hit;
    }
    const symbol = renderSymbol(request);
    this.map.set(key, symbol);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
    return symbol;
  }

  /**
   * Bereitet höchstens {@link MAX_LOOKAHEAD} Folgesymbole vor; Fehler eines Folgesymbols werden NICHT verschluckt,
   * sondern gesammelt zurückgegeben (die Anzeige des aktuellen Symbols darf davon nicht abhängen).
   * @param upcoming - die nächsten Anfragen in Reihenfolge (weitere als `MAX_LOOKAHEAD` werden ignoriert).
   * @returns Fehler je Position (leer = alles vorbereitet).
   */
  prefetch(upcoming: readonly RenderRequest[]): Array<{ offset: number; error: AppError }> {
    const errors: Array<{ offset: number; error: AppError }> = [];
    upcoming.slice(0, MAX_LOOKAHEAD).forEach((req, offset) => {
      try {
        this.get(req);
      } catch (error: unknown) {
        errors.push({ offset: offset + 1, error: error instanceof AppError ? error : renderError('prefetch', undefined, error) });
      }
    });
    return errors;
  }

  /** Leert den Cache (z. B. bei Sitzungsende oder geänderter Fläche). */
  clear(): void {
    this.map.clear();
  }
}
