import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HybridDecoder, type PonyfillModule } from '../../src/adapters/decoder/decoder-adapter';
import { renderSymbol } from '../../src/adapters/renderer/barcode-renderer';
import { rasterizeSymbols } from '../helpers/decode';

/**
 * Ende-zu-Ende mit dem ECHTEN barcode-detector-ponyfill und dem LOKALEN zxing_reader.wasm (kein Netz).
 * Node hat keine Browser-Klassen, die das ponyfill prüft; sie werden hier minimal bereitgestellt.
 */
class TestImageData {
  readonly colorSpace = 'srgb';
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number
  ) {}
}
class TestRect {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly width = 0,
    readonly height = 0
  ) {}
}

let ponyfill: PonyfillModule;

beforeAll(async () => {
  vi.stubGlobal('ImageData', TestImageData);
  vi.stubGlobal('DOMRectReadOnly', TestRect);
  const wasm = readFileSync('public/wasm/zxing_reader.wasm');
  const binary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
  const real = (await import('barcode-detector/ponyfill')) as unknown as PonyfillModule;
  ponyfill = {
    BarcodeDetector: real.BarcodeDetector,
    // Node kann ./wasm/... nicht relativ zur Seite laden: die Datei wird direkt aus public/wasm bereitgestellt (weiterhin lokal).
    prepareZXingModule: (o) => real.prepareZXingModule({ ...o, overrides: { ...o.overrides, wasmBinary: binary } as never })
  };
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function image(values: Array<Parameters<typeof renderSymbol>[0]>): TestImageData {
  const r = rasterizeSymbols(values.map((v) => renderSymbol({ ...v, pixelsPerModule: 1 })), 4);
  return new TestImageData(r.data, r.width, r.height);
}

describe('HybridDecoder mit echtem ponyfill und lokalem WASM', () => {
  const decoder = (): HybridDecoder => new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(ponyfill) });

  it('wählt WASM und liest EAN-13, EAN-8, Code 128 und QR', async () => {
    const d = decoder();
    expect(await d.init()).toBe('wasm');
    const cases: Array<[Parameters<typeof renderSymbol>[0], string]> = [
      [{ symbology: 'EAN13', value: '4006381333931' }, '4006381333931'],
      [{ symbology: 'EAN13', value: '0000000000000' }, '0000000000000'],
      [{ symbology: 'EAN8', value: '73513537' }, '73513537'],
      [{ symbology: 'Code128', value: 'LOT-0001 AB' }, 'LOT-0001 AB'],
      [{ symbology: 'QRCode', value: 'Hallo Lager ÄÖÜ' }, 'Hallo Lager ÄÖÜ']
    ];
    for (const [req, expected] of cases) {
      const r = await d.decodeFrame(image([req]) as unknown as ImageData);
      expect(r.codes.map((c) => c.value), req.symbology).toEqual([expected]);
      expect(r.codes[0]?.symbology).toBe(req.symbology);
      expect(r.codes[0]?.engine).toBe('wasm');
      expect(r.rejected).toEqual([]);
    }
  });

  it('mehrere Codes in einem Bild werden einzeln geliefert (links → rechts)', async () => {
    const d = decoder();
    const r = await d.decodeFrame(
      image([
        { symbology: 'EAN13', value: '4006381333931' },
        { symbology: 'QRCode', value: 'zweiter' },
        { symbology: 'EAN8', value: '73513537' }
      ]) as unknown as ImageData
    );
    expect(r.codes.map((c) => c.value).sort()).toEqual(['4006381333931', '73513537', 'zweiter'].sort());
    expect(r.codes).toHaveLength(3);
  });

  it('UPC-A: derselbe Strichcode ist ein gültiger EAN-13 mit führender 0; nur mit reiner UPC-A-Whitelist entsteht UPC-A (12 Ziffern)', async () => {
    const upc = image([{ symbology: 'UPCA', value: '036000291452' }]) as unknown as ImageData;
    const standard = await new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(ponyfill) }).decodeFrame(upc);
    expect(standard.codes.map((c) => [c.symbology, c.value])).toEqual([['EAN13', '0036000291452']]);
    const upcOnly = new HybridDecoder({ native: null, whitelist: ['UPCA'], loadPonyfill: () => Promise.resolve(ponyfill) });
    const r = await upcOnly.decodeFrame(upc);
    expect(r.codes.map((c) => [c.symbology, c.value])).toEqual([['UPCA', '036000291452']]);
  });

  it('Bild ohne Code liefert ein leeres Ergebnis (kein Fehler)', async () => {
    const white = new TestImageData(new Uint8ClampedArray(200 * 200 * 4).fill(255), 200, 200);
    expect(await decoder().decodeFrame(white as unknown as ImageData)).toEqual({ codes: [], rejected: [] });
  });
});
