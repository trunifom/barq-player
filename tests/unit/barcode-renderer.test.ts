import { describe, expect, it } from 'vitest';
import { AppError, type ErrorCode } from '../../src/domain/errors';
import { BACKGROUND_COLOR, BAR_COLOR, MAX_LOOKAHEAD, RenderCache, renderSymbol, type RenderRequest, type RenderedSymbol } from '../../src/adapters/renderer/barcode-renderer';
import { quietZoneFor } from '../../src/domain/render-layout';
import { decodeSymbol } from '../helpers/decode';

// ---- Unabhängige Referenz-Encoder (GS1 General Specifications), nur im Test -------------------------------------
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const digit = (s: string, i: number): number => Number(s.charAt(i));

function referenceEan13(value: string): string {
  const parity = PARITY[digit(value, 0)] ?? '';
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (parity.charAt(i - 1) === 'L' ? L : G)[digit(value, i)];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[digit(value, i)];
  return bits + '101';
}

function referenceEan8(value: string): string {
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += L[digit(value, i)];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += R[digit(value, i)];
  return bits + '101';
}

/** Modulzeile (eine Pixelreihe in der Mitte) des gerenderten Symbols als 0/1-String ohne Ruhezonen. */
function centerRow(s: RenderedSymbol): string {
  const y = Math.floor(s.modulesHigh / 2);
  const q = s.quietZone;
  let bits = '';
  for (let x = q.left; x < s.modulesWide - q.right; x++) {
    bits += s.rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) ? '1' : '0';
  }
  return bits;
}

function codeOf(fn: () => unknown): ErrorCode {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error('kein Fehler geworfen');
}

const EAN13_VALUES = ['4006381333931', '5901234123457', '0000000000000', '2063701028009', '9780201379624'];

describe('Modulmuster entspricht der GS1-Referenz', () => {
  it.each(EAN13_VALUES)('EAN-13 %s', (value) => {
    const s = renderSymbol({ symbology: 'EAN13', value });
    expect(centerRow(s)).toBe(referenceEan13(value));
    expect(centerRow(s)).toHaveLength(95);
  });

  it.each(['73513537', '96385074', '00000000'])('EAN-8 %s', (value) => {
    const s = renderSymbol({ symbology: 'EAN8', value });
    expect(centerRow(s)).toBe(referenceEan8(value));
    expect(centerRow(s)).toHaveLength(67);
  });

  it('UPC-A ist identisch mit EAN-13 und führender 0', () => {
    const s = renderSymbol({ symbology: 'UPCA', value: '036000291452' });
    expect(centerRow(s)).toBe(referenceEan13('0036000291452'));
  });

  it('Code 128: Start B (211214) vorne, Stopp (2331112) hinten, Breite = Summe der Elemente', () => {
    const s = renderSymbol({ symbology: 'Code128', value: 'AB 12' });
    const bits = centerRow(s);
    expect(bits.startsWith('11010010000')).toBe(true); // Start B
    expect(bits.endsWith('1100011101011')).toBe(true); // Stopp + Abschlussbalken
    expect((bits.length - 13) % 11).toBe(0); // 11 Module je Zeichen + 13 für den Stopp
  });
});

describe('Rückwärts-Test: gerendertes Symbol wird von zxing-wasm (lokal) korrekt gelesen', () => {
  it.each(EAN13_VALUES)('EAN-13 %s', async (value) => {
    const res = await decodeSymbol(renderSymbol({ symbology: 'EAN13', value }), ['EAN-13']);
    expect(res[0]?.text).toBe(value);
  });

  it('EAN-8, UPC-A', async () => {
    expect((await decodeSymbol(renderSymbol({ symbology: 'EAN8', value: '73513537' }), ['EAN-8']))[0]?.text).toBe('73513537');
    // Hinweis für den Decoder-Adapter (M5): zxing liefert UPC-A mit führender 0 als 13-stelligen Text; die Normalisierung muss explizit erfolgen.
    const upc = (await decodeSymbol(renderSymbol({ symbology: 'UPCA', value: '036000291452' }), ['UPC-A']))[0];
    expect(upc?.format).toBe('UPCA'); // zxing-Formatname ohne Bindestrich
    expect(upc?.text.endsWith('036000291452')).toBe(true);
  });

  it('Code 128 inkl. Leerzeichen und Zahlenfolgen', async () => {
    for (const value of ['AB 12', 'LOT-0001', '123456789012', 'x'.repeat(30)]) {
      expect((await decodeSymbol(renderSymbol({ symbology: 'Code128', value }), ['Code128']))[0]?.text).toBe(value);
    }
  });

  it.each(['L', 'M', 'Q', 'H'] as const)('QR-Code (Text) mit Fehlerkorrektur %s', async (eccLevel) => {
    const value = 'Hallo Lager 2063701028009';
    const res = await decodeSymbol(renderSymbol({ symbology: 'QRCode', value, eccLevel }), ['QRCode']);
    expect(res[0]?.text).toBe(value);
  });

  it('QR mit Umlauten, Emoji und Formelzeichen bleibt inhaltsgleich', async () => {
    for (const value of ['ÄÖÜ ß €', 'Kaffee ☕ 😀', '=1+1', 'https://example.org/?a=1&b=2']) {
      expect((await decodeSymbol(renderSymbol({ symbology: 'QRCode', value }), ['QRCode']))[0]?.text).toBe(value);
    }
  });

  it('gedrehter breiter Code 128 ist weiterhin lesbar', async () => {
    const value = 'LANGER-INHALT-0123456789-ABCDEFGHIJ-0123';
    const s = renderSymbol({ symbology: 'Code128', value, viewport: { width: 360, height: 800 }, devicePixelRatio: 2 });
    expect(s.rotated).toBe(true);
    expect((await decodeSymbol(s, ['Code128']))[0]?.text).toBe(value);
  });
});

describe('Ruhezonen und Farben', () => {
  const requests: RenderRequest[] = [
    { symbology: 'EAN13', value: '4006381333931' },
    { symbology: 'EAN8', value: '73513537' },
    { symbology: 'UPCA', value: '036000291452' },
    { symbology: 'Code128', value: 'AB 12' },
    { symbology: 'QRCode', value: 'hello' }
  ];

  it.each(requests)('$symbology: dunkle Module liegen nur innerhalb der Ruhezone', (req) => {
    const s = renderSymbol(req);
    const q = quietZoneFor(req.symbology);
    expect(s.quietZone).toEqual(q);
    expect(s.rects.length).toBeGreaterThan(0);
    for (const r of s.rects) {
      expect(r.x).toBeGreaterThanOrEqual(q.left);
      expect(r.y).toBeGreaterThanOrEqual(q.top);
      expect(r.x + r.w).toBeLessThanOrEqual(s.modulesWide - q.right);
      expect(r.y + r.h).toBeLessThanOrEqual(s.modulesHigh - q.bottom);
    }
    // Symbol berührt die Innenkanten der Ruhezone (keine zusätzliche Aufweitung/Verschiebung)
    expect(Math.min(...s.rects.map((r) => r.x))).toBe(q.left);
    expect(Math.max(...s.rects.map((r) => r.x + r.w))).toBe(s.modulesWide - q.right);
  });

  it('EAN-13: exakt 11 Module links und 7 rechts frei; Gesamtbreite 95 + 18', () => {
    const s = renderSymbol({ symbology: 'EAN13', value: '4006381333931' });
    expect(s.modulesWide).toBe(113);
    expect(Math.min(...s.rects.map((r) => r.x))).toBe(11);
    expect(Math.max(...s.rects.map((r) => r.x + r.w))).toBe(113 - 7);
  });

  it('QR: 4 Module rundum, quadratisch', () => {
    const s = renderSymbol({ symbology: 'QRCode', value: 'hello' });
    expect(s.modulesWide).toBe(s.modulesHigh);
    expect(s.modulesWide).toBe(21 + 8); // Version 1
    expect(Math.min(...s.rects.map((r) => r.y))).toBe(4);
    expect(Math.max(...s.rects.map((r) => r.y + r.h))).toBe(s.modulesHigh - 4);
  });

  it.each(requests)('$symbology: nur #000000 auf #FFFFFF, crispEdges, keine Effekte', (req) => {
    const { svg } = renderSymbol(req);
    expect(BAR_COLOR).toBe('#000000');
    expect(BACKGROUND_COLOR).toBe('#FFFFFF');
    expect(svg).toContain('shape-rendering="crispEdges"');
    const colors = [...svg.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(colors)).toEqual(new Set(['#FFFFFF', '#000000']));
    for (const forbidden of ['opacity', 'filter', 'transform', 'gradient', 'rgba', 'rgb(', 'stroke', 'gray', 'grey', 'blur']) {
      expect(svg.toLowerCase()).not.toContain(forbidden);
    }
    expect(svg).toContain('color-scheme:light only'); // immun gegen Dark-Mode-Invertierung
  });

  it('Rechtecke liegen auf ganzzahligen Modulkoordinaten', () => {
    for (const req of requests) {
      const s = renderSymbol(req);
      for (const r of s.rects) for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
      expect(Number.isInteger(s.modulesWide) && Number.isInteger(s.modulesHigh)).toBe(true);
    }
  });
});

describe('Skalierung: ganzzahlige Pixel pro Modul', () => {
  it('Standard ohne Viewport: 1 Pixel pro Modul', () => {
    const s = renderSymbol({ symbology: 'EAN13', value: '4006381333931' });
    expect([s.modulePx, s.widthPx, s.heightPx]).toEqual([1, 113, 77]);
  });

  it('feste pixelsPerModule', () => {
    const s = renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 5 });
    expect([s.modulePx, s.widthPx, s.heightPx]).toEqual([5, 565, 385]);
    expect(s.svg).toContain('width="565"');
  });

  it('Viewport 360×800 @3x: 9 Gerätepixel/Modul, Pixelmaße sind exakt Module × 9', () => {
    const s = renderSymbol({ symbology: 'EAN13', value: '4006381333931', viewport: { width: 360, height: 800 }, devicePixelRatio: 3 });
    expect(s.modulePx).toBe(9);
    expect(s.rotated).toBe(false);
    expect(s.widthPx).toBe(113 * 9);
    expect(s.cssWidth).toBe((113 * 9) / 3);
    expect(s.fits).toBe(true);
  });

  it('nicht ganzzahlige devicePixelRatio: Gerätepixel bleiben ganzzahlig', () => {
    const s = renderSymbol({ symbology: 'EAN13', value: '4006381333931', viewport: { width: 360, height: 800 }, devicePixelRatio: 2.625 });
    expect(s.modulePx).toBe(8);
    expect(Number.isInteger(s.widthPx)).toBe(true);
    expect(s.cssWidth * 2.625).toBeCloseTo(s.widthPx, 6);
  });

  it('passt nicht: fits=false, Symbol wird weder gestaucht noch abgeschnitten', () => {
    const s = renderSymbol({ symbology: 'Code128', value: 'x'.repeat(40), viewport: { width: 40, height: 40 }, devicePixelRatio: 1 });
    expect(s.fits).toBe(false);
    expect(s.modulePx).toBe(1);
    expect(s.widthPx).toBe(s.modulesWide);
  });

  it('pixelsPerModule + Viewport: fits meldet Überschreitung', () => {
    const fits = renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 3, viewport: { width: 360, height: 800 }, devicePixelRatio: 1 });
    const tooBig = renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 4, viewport: { width: 360, height: 800 }, devicePixelRatio: 1 });
    expect(fits.fits).toBe(true);
    expect(tooBig.fits).toBe(false);
  });

  it('ungültige Skalierungsparameter', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(codeOf(() => renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: bad }))).toBe('ERR_RENDER_FAILED');
    }
    expect(codeOf(() => renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 2, devicePixelRatio: 0 }))).toBe('ERR_RENDER_FAILED');
    expect(codeOf(() => renderSymbol({ symbology: 'EAN13', value: '4006381333931', barHeightModules: 5 }))).toBe('ERR_RENDER_FAILED');
    expect(codeOf(() => renderSymbol({ symbology: 'EAN13', value: '4006381333931', viewport: { width: 0, height: 10 } }))).toBe('ERR_RENDER_FAILED');
  });
});

describe('90°-Drehung breiter 1D-Codes', () => {
  const wide: RenderRequest = { symbology: 'Code128', value: 'LANGER-INHALT-0123456789-ABCDEFGHIJ-0123', viewport: { width: 360, height: 800 }, devicePixelRatio: 2 };

  it('wird bei breitem Code im Hochformat empfohlen und angewendet (Geometrie gedreht, Pixelmaße vertauscht)', () => {
    const plain = renderSymbol({ ...wide, allowRotation: false });
    const turned = renderSymbol(wide);
    expect(plain.rotated).toBe(false);
    expect(turned.rotated).toBe(true);
    expect(turned.modulesWide).toBe(plain.modulesHigh);
    expect(turned.modulesHigh).toBe(plain.modulesWide);
    expect(turned.modulePx).toBeGreaterThan(plain.modulePx);
    expect(turned.modulePx).toBeGreaterThanOrEqual(3);
    expect(turned.svg).not.toContain('transform'); // keine CSS/SVG-Transformation
    for (const r of turned.rects) for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
  });

  it('Ruhezonen bleiben nach der Drehung erhalten (10X am Anfang/Ende der Längsrichtung)', () => {
    const s = renderSymbol(wide);
    expect(Math.min(...s.rects.map((r) => r.y))).toBe(10);
    expect(Math.max(...s.rects.map((r) => r.y + r.h))).toBe(s.modulesHigh - 10);
  });

  it('Gedrehte Balken sind horizontale Streifen über die volle Symbolbreite', () => {
    const s = renderSymbol(wide);
    const q = quietZoneFor('Code128');
    for (const r of s.rects) {
      expect(r.x).toBe(q.top); // vorher oben
      expect(r.w).toBe(50); // Balkenhöhe wird zur Breite
    }
  });

  it('QR und kurze Codes werden nie gedreht', () => {
    expect(renderSymbol({ symbology: 'QRCode', value: 'x'.repeat(300), viewport: { width: 360, height: 800 }, devicePixelRatio: 2 }).rotated).toBe(false);
    expect(renderSymbol({ symbology: 'EAN13', value: '4006381333931', viewport: { width: 360, height: 800 }, devicePixelRatio: 2 }).rotated).toBe(false);
  });
});

describe('Validierung und Fehler', () => {
  it('ungültige Werte werden vor dem Rendern abgelehnt (keine stille Korrektur)', () => {
    expect(codeOf(() => renderSymbol({ symbology: 'EAN13', value: '4006381333930' }))).toBe('ERR_CHECKSUM_INVALID');
    expect(codeOf(() => renderSymbol({ symbology: 'EAN13', value: '123' }))).toBe('ERR_SYNTAX_INVALID');
    expect(codeOf(() => renderSymbol({ symbology: 'EAN8', value: '4006381333931' }))).toBe('ERR_SYNTAX_INVALID');
    expect(codeOf(() => renderSymbol({ symbology: 'Code128', value: 'Müller' }))).toBe('ERR_SYNTAX_INVALID');
    expect(codeOf(() => renderSymbol({ symbology: 'QRCode', value: '' }))).toBe('ERR_SYNTAX_INVALID');
  });

  it('ungültige Fehlerkorrektur', () => {
    expect(codeOf(() => renderSymbol({ symbology: 'QRCode', value: 'x', eccLevel: 'X' as unknown as 'L' }))).toBe('ERR_RENDER_FAILED');
  });

  it('zu langer QR-Inhalt für Stufe H → ERR_RENDER_FAILED, mit niedrigerer Stufe möglich', () => {
    const value = 'a'.repeat(1500);
    expect(codeOf(() => renderSymbol({ symbology: 'QRCode', value, eccLevel: 'H' }))).toBe('ERR_RENDER_FAILED');
    expect(renderSymbol({ symbology: 'QRCode', value, eccLevel: 'L' }).modulesWide).toBeGreaterThan(100);
  });

  it('höhere Fehlerkorrektur erzeugt ein größeres oder gleich großes Symbol', () => {
    const size = (e: 'L' | 'M' | 'Q' | 'H'): number => renderSymbol({ symbology: 'QRCode', value: 'Hallo Welt 1234567890', eccLevel: e }).modulesWide;
    expect(size('L')).toBeLessThanOrEqual(size('M'));
    expect(size('M')).toBeLessThanOrEqual(size('Q'));
    expect(size('Q')).toBeLessThanOrEqual(size('H'));
    expect(size('L')).toBeLessThan(size('H'));
  });

  it('Standard-ECC ist M', () => {
    const v = 'Hallo Welt 1234567890';
    expect(renderSymbol({ symbology: 'QRCode', value: v }).svg).toBe(renderSymbol({ symbology: 'QRCode', value: v, eccLevel: 'M' }).svg);
  });

  it('SVG maskiert Sonderzeichen im aria-label (wohlgeformtes XML)', () => {
    const { svg } = renderSymbol({ symbology: 'QRCode', value: '<script>"&\'</script>' });
    expect(svg).toContain('&lt;script&gt;&quot;&amp;&apos;&lt;/script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('Rendering ist deterministisch', () => {
    const a = renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 3 });
    const b = renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 3 });
    expect(a.svg).toBe(b.svg);
  });
});

describe('RenderCache (Lookahead)', () => {
  const req = (v: string): RenderRequest => ({ symbology: 'QRCode', value: v });

  it('liefert identische Objekte für gleiche Anfragen (Cache-Treffer)', () => {
    const c = new RenderCache();
    const a = c.get(req('a'));
    expect(c.get(req('a'))).toBe(a);
    expect(c.size).toBe(1);
  });

  it('unterscheidet Anfragen mit verschiedener Fläche/Skalierung', () => {
    const c = new RenderCache();
    const a = c.get({ symbology: 'EAN13', value: '4006381333931', viewport: { width: 360, height: 800 }, devicePixelRatio: 3 });
    const b = c.get({ symbology: 'EAN13', value: '4006381333931', viewport: { width: 400, height: 800 }, devicePixelRatio: 3 });
    expect(a).not.toBe(b);
  });

  it('hält höchstens aktuelles + 2 Symbole (LRU)', () => {
    const c = new RenderCache();
    expect(MAX_LOOKAHEAD).toBe(2);
    const first = c.get(req('1'));
    c.get(req('2'));
    c.get(req('3'));
    c.get(req('1')); // 1 als zuletzt genutzt markieren
    c.get(req('4')); // verdrängt 2
    expect(c.size).toBe(3);
    expect(c.get(req('1'))).toBe(first);
  });

  it('prefetch bereitet nie mehr als 2 Folgesymbole vor, auch bei riesiger Liste', () => {
    const c = new RenderCache(10);
    const errors = c.prefetch(Array.from({ length: 5000 }, (_, i) => req(`v${i}`)));
    expect(errors).toEqual([]);
    expect(c.size).toBe(2);
  });

  it('prefetch meldet Fehler eines Folgesymbols, statt sie zu verschlucken oder zu werfen', () => {
    const c = new RenderCache();
    const errors = c.prefetch([req('ok'), { symbology: 'EAN13', value: '4006381333930' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.offset).toBe(2);
    expect(errors[0]?.error.code).toBe('ERR_CHECKSUM_INVALID');
    expect(c.size).toBe(1);
  });

  it('get wirft Renderfehler weiterhin (aktuelles Symbol darf nie still ausfallen)', () => {
    expect(() => new RenderCache().get({ symbology: 'EAN13', value: 'x' })).toThrow(AppError);
  });

  it('clear leert; Konstruktor prüft maxEntries', () => {
    const c = new RenderCache();
    c.get(req('a'));
    c.clear();
    expect(c.size).toBe(0);
    for (const bad of [0, -1, 1.5]) expect(() => new RenderCache(bad)).toThrow(AppError);
  });
});
