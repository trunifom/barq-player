import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  DEFAULT_BAR_HEIGHT,
  DEFAULT_MIN_MODULE_PX,
  LINEAR_VERTICAL_MARGIN,
  integerModulePx,
  isLinearSymbology,
  quietZoneFor,
  recommendRotation
} from '../../src/domain/render-layout';

describe('Ruhezonen (AGENTS.md Regel 5)', () => {
  it.each([
    ['EAN13', 11, 7],
    ['EAN8', 7, 7],
    ['UPCA', 9, 9],
    ['Code128', 10, 10]
  ] as const)('%s: links %i / rechts %i Module', (sym, left, right) => {
    const q = quietZoneFor(sym);
    expect([q.left, q.right]).toEqual([left, right]);
    expect(q.top).toBe(LINEAR_VERTICAL_MARGIN);
    expect(q.bottom).toBe(LINEAR_VERTICAL_MARGIN);
  });

  it('QR: 4 Module rundum', () => {
    expect(quietZoneFor('QRCode')).toEqual({ left: 4, right: 4, top: 4, bottom: 4 });
  });

  it('linear vs. Matrix', () => {
    expect(['EAN13', 'EAN8', 'UPCA', 'Code128'].every((s) => isLinearSymbology(s as 'EAN13'))).toBe(true);
    expect(isLinearSymbology('QRCode')).toBe(false);
  });

  it('Balkenhöhen sind für alle 1D-Symbologien definiert', () => {
    expect(Object.keys(DEFAULT_BAR_HEIGHT).sort()).toEqual(['Code128', 'EAN13', 'EAN8', 'UPCA']);
    expect(Object.values(DEFAULT_BAR_HEIGHT).every((h) => Number.isInteger(h) && h >= 10)).toBe(true);
  });
});

describe('integerModulePx', () => {
  it('rundet nach unten auf ganze Gerätepixel', () => {
    // 113 Module in 1080 Gerätepixeln → 9,56 → 9
    expect(integerModulePx(113, 77, { width: 360, height: 800 }, 3)).toEqual({ modulePx: 9, fits: true });
    expect(integerModulePx(100, 100, { width: 100, height: 100 }, 1)).toEqual({ modulePx: 1, fits: true });
  });

  it('begrenzt durch die kleinere Dimension', () => {
    expect(integerModulePx(10, 100, { width: 1000, height: 500 }, 1)).toEqual({ modulePx: 5, fits: true });
  });

  it('berücksichtigt nicht ganzzahlige devicePixelRatio', () => {
    // 360 × 2,625 = 945 Gerätepixel → 945/113 = 8,36 → 8
    expect(integerModulePx(113, 77, { width: 360, height: 800 }, 2.625).modulePx).toBe(8);
  });

  it('passt nicht: 1 Pixel pro Modul und fits=false (nie abschneiden/stauchen)', () => {
    expect(integerModulePx(500, 60, { width: 100, height: 100 }, 1)).toEqual({ modulePx: 1, fits: false });
  });

  it('wirft bei ungültigen Eingaben', () => {
    for (const args of [
      [0, 10, { width: 1, height: 1 }, 1],
      [10, 1.5, { width: 1, height: 1 }, 1],
      [10, 10, { width: 0, height: 1 }, 1],
      [10, 10, { width: 1, height: Number.NaN }, 1],
      [10, 10, { width: 1, height: 1 }, 0],
      [10, 10, { width: 1, height: 1 }, Infinity]
    ] as const) {
      expect(() => integerModulePx(args[0], args[1], args[2], args[3])).toThrow(AppError);
    }
  });
});

describe('recommendRotation', () => {
  const portrait = { width: 360, height: 800 };

  it('EAN-13 passt hochkant gut → keine Drehung', () => {
    const r = recommendRotation(true, 113, 77, portrait, 3);
    expect(r.rotate).toBe(false);
    expect(r.modulePx).toBe(9);
  });

  it('sehr breiter Code 128 hochkant < 3 Pixel/Modul → Drehung, wenn dadurch größer', () => {
    const r = recommendRotation(true, 495, 58, portrait, 2);
    expect(r.modulePx).toBe(1);
    expect(r.modulePxRotated).toBe(3);
    expect(r.rotate).toBe(true);
  });

  it('QR wird nie gedreht', () => {
    expect(recommendRotation(false, 495, 58, portrait, 2).rotate).toBe(false);
  });

  it('keine Drehung, wenn sie nichts verbessert oder nicht passt', () => {
    // quadratische Fläche: gedreht gleich groß
    expect(recommendRotation(true, 400, 60, { width: 400, height: 400 }, 1).rotate).toBe(false);
    // gedreht passt gar nicht
    expect(recommendRotation(true, 900, 900, { width: 100, height: 100 }, 1).rotate).toBe(false);
  });

  it('Schwelle ist einstellbar; Standard 3', () => {
    expect(DEFAULT_MIN_MODULE_PX).toBe(3);
    // 113 Module in 360 px → 3 px/Modul: bei Schwelle 3 keine, bei Schwelle 4 Drehung (gedreht 4 px/Modul)
    expect(recommendRotation(true, 113, 77, { width: 360, height: 800 }, 1).rotate).toBe(false);
    expect(recommendRotation(true, 113, 77, { width: 360, height: 800 }, 1, 4).rotate).toBe(true);
  });
});
