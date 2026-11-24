import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  HybridDecoder,
  MAX_IMAGE_BYTES,
  WASM_PATH,
  locateZxingFile,
  type DetectedLike,
  type DetectorCtor,
  type DetectorLike,
  type PonyfillModule
} from '../../src/adapters/decoder/decoder-adapter';

const EAN = '4006381333931';

/** Erzeugt einen Detektor-Konstruktor mit steuerbarem Verhalten. */
function makeCtor(detect: (src: unknown) => Promise<DetectedLike[]>, supported?: readonly string[] | Error): { ctor: DetectorCtor; created: Array<{ formats?: string[] }> } {
  const created: Array<{ formats?: string[] }> = [];
  class Fake implements DetectorLike {
    constructor(options?: { formats?: string[] }) {
      created.push(options ?? {});
    }
    detect(src: Parameters<DetectorLike['detect']>[0]): Promise<DetectedLike[]> {
      return detect(src);
    }
    static getSupportedFormats(): Promise<readonly string[]> {
      if (supported instanceof Error) return Promise.reject(supported);
      return Promise.resolve(supported ?? ['ean_13', 'ean_8', 'qr_code', 'code_128', 'upc_a']);
    }
  }
  return { ctor: Fake, created };
}

function makePonyfill(detect: (src: unknown) => Promise<DetectedLike[]>): { mod: PonyfillModule; prepare: ReturnType<typeof vi.fn>; created: Array<{ formats?: string[] }> } {
  const { ctor, created } = makeCtor(detect);
  const prepare = vi.fn();
  return { mod: { BarcodeDetector: ctor, prepareZXingModule: prepare as PonyfillModule['prepareZXingModule'] }, prepare, created };
}

const det = (format: string, rawValue: string, x = 0, y = 0): DetectedLike => ({ format, rawValue, boundingBox: { x, y } });
const blob = (size: number, name?: string): Blob & { name?: string } => Object.assign(new Blob([new Uint8Array(size)]), name === undefined ? {} : { name });

describe('Lokale WASM-Datei (kein CDN)', () => {
  it('locateFile liefert für .wasm immer den lokalen Pfad, egal welches CDN-Präfix zxing vorschlägt', () => {
    expect(WASM_PATH).toBe('./wasm/zxing_reader.wasm');
    expect(locateZxingFile('zxing_reader.wasm', 'https://fastly.jsdelivr.net/npm/zxing-wasm@3/dist/reader/')).toBe('./wasm/zxing_reader.wasm');
    expect(locateZxingFile('anything.wasm', '')).toBe(WASM_PATH);
    expect(locateZxingFile('helper.js', 'x/')).toBe('x/helper.js');
  });

  it('der WASM-Pfad ist relativ und enthält kein http', () => {
    expect(WASM_PATH.startsWith('./')).toBe(true);
    expect(WASM_PATH).not.toMatch(/https?:/);
  });

  it('WASM-Initialisierung übergibt locateFile und lädt sofort (fireImmediately)', async () => {
    const { mod, prepare } = makePonyfill(() => Promise.resolve([]));
    const d = new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(mod) });
    expect(await d.init()).toBe('wasm');
    expect(prepare).toHaveBeenCalledTimes(1);
    const arg = prepare.mock.calls[0]?.[0] as { overrides: { locateFile: (p: string, prefix: string) => string }; fireImmediately: boolean };
    expect(arg.fireImmediately).toBe(true);
    expect(arg.overrides.locateFile('zxing_reader.wasm', 'https://cdn.example/')).toBe('./wasm/zxing_reader.wasm');
  });
});

describe('Engine-Wahl', () => {
  it('nativ, wenn vorhanden und alle Whitelist-Formate unterstützt werden', async () => {
    const { ctor, created } = makeCtor(() => Promise.resolve([]));
    const loadPonyfill = vi.fn();
    const d = new HybridDecoder({ native: ctor, loadPonyfill });
    expect(d.engine).toBeNull();
    expect(await d.init()).toBe('native');
    expect(d.engine).toBe('native');
    expect(created[0]?.formats).toEqual(['ean_13', 'ean_8', 'qr_code', 'code_128']);
    expect(loadPonyfill).not.toHaveBeenCalled();
    expect(d.fallbackReason).toBeNull();
  });

  it('WASM, wenn der native Detektor ein Whitelist-Format nicht unterstützt', async () => {
    const { ctor } = makeCtor(() => Promise.resolve([]), ['ean_13', 'qr_code']);
    const { mod } = makePonyfill(() => Promise.resolve([]));
    const d = new HybridDecoder({ native: ctor, loadPonyfill: () => Promise.resolve(mod) });
    expect(await d.init()).toBe('wasm');
    expect(d.fallbackReason).toContain('ean_8');
  });

  it('WASM, wenn getSupportedFormats scheitert oder kein nativer Detektor existiert', async () => {
    const { ctor } = makeCtor(() => Promise.resolve([]), new Error('Play Services fehlen'));
    const a = new HybridDecoder({ native: ctor, loadPonyfill: () => Promise.resolve(makePonyfill(() => Promise.resolve([])).mod) });
    expect(await a.init()).toBe('wasm');
    expect(a.fallbackReason).toContain('Play Services');
    const b = new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(makePonyfill(() => Promise.resolve([])).mod) });
    expect(await b.init()).toBe('wasm');
    expect(b.fallbackReason).toContain('Kein nativer');
  });

  it('gleichzeitige init-Aufrufe teilen sich eine Initialisierung', async () => {
    const { mod, prepare } = makePonyfill(() => Promise.resolve([]));
    const d = new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(mod) });
    await Promise.all([d.init(), d.init(), d.init()]);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('WASM lässt sich nicht laden → ERR_WASM_LOAD_FAILED; späterer Versuch ist möglich', async () => {
    let fail = true;
    const { mod } = makePonyfill(() => Promise.resolve([]));
    const d = new HybridDecoder({
      native: null,
      loadPonyfill: () => (fail ? Promise.reject(new Error('404 zxing_reader.wasm')) : Promise.resolve(mod))
    });
    await expect(d.init()).rejects.toMatchObject({ code: 'ERR_WASM_LOAD_FAILED' });
    await expect(d.init()).rejects.toMatchObject({ code: 'ERR_WASM_LOAD_FAILED' });
    fail = false;
    expect(await d.init()).toBe('wasm');
  });

  it('prepareZXingModule wirft (z. B. Bibliothek/WASM passen nicht zusammen) → ERR_WASM_LOAD_FAILED mit Pfad', async () => {
    const { mod, prepare } = makePonyfill(() => Promise.resolve([]));
    prepare.mockRejectedValueOnce(new Error('LinkError: WebAssembly.instantiate'));
    const d = new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(mod) });
    try {
      await d.init();
      throw new Error('hätte werfen müssen');
    } catch (e: unknown) {
      expect((e as AppError).code).toBe('ERR_WASM_LOAD_FAILED');
      expect((e as AppError).details).toContain(WASM_PATH);
    }
  });
});

describe('decodeFrame', () => {
  it('akzeptiert gültige Codes, verwirft ungültige und zählt sie; ordnet oben→unten, links→rechts', async () => {
    const { ctor } = makeCtor(() =>
      Promise.resolve([det('qr_code', 'unten', 0, 200), det('ean_13', '4006381333930', 10, 50), det('ean_13', EAN, 300, 0), det('code_128', 'AB 12', 5, 0), det('data_matrix', 'x', 0, 0)])
    );
    const d = new HybridDecoder({ native: ctor });
    const r = await d.decodeFrame(blob(10));
    expect(r.codes.map((c) => [c.symbology, c.value, c.engine])).toEqual([
      ['Code128', 'AB 12', 'native'],
      ['EAN13', EAN, 'native'],
      ['QRCode', 'unten', 'native']
    ]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['invalid-value', 'unknown-format']);
    expect(JSON.stringify(r.rejected)).not.toContain('4006381333930'); // Verwerfungen enthalten keine Inhalte
  });

  it('respektiert die Whitelist (UPC-A optional) inkl. Normalisierung', async () => {
    const { ctor } = makeCtor(() => Promise.resolve([det('upc_a', '0036000291452'), det('ean_8', '73513537')]));
    const upcOnly = new HybridDecoder({ native: ctor, whitelist: ['UPCA'] });
    const r = await upcOnly.decodeFrame(blob(1));
    expect(r.codes.map((c) => c.value)).toEqual(['036000291452']);
    expect(r.rejected.map((x) => x.reason)).toEqual(['format-not-allowed']);
  });

  it('leeres Ergebnis ist kein Fehler', async () => {
    const d = new HybridDecoder({ native: makeCtor(() => Promise.resolve([])).ctor });
    expect(await d.decodeFrame(blob(1))).toEqual({ codes: [], rejected: [] });
  });

  it('Laufzeit-Fallback: wirft der native Detektor, wird einmalig auf WASM gewechselt und das Bild dort ausgewertet', async () => {
    const native = makeCtor(() => Promise.reject(new Error('GMS Absturz')));
    const wasm = makePonyfill(() => Promise.resolve([det('ean_13', EAN)]));
    const d = new HybridDecoder({ native: native.ctor, loadPonyfill: () => Promise.resolve(wasm.mod) });
    const first = await d.decodeFrame(blob(1));
    expect(first.codes).toEqual([{ symbology: 'EAN13', value: EAN, engine: 'wasm' }]);
    expect(d.engine).toBe('wasm');
    expect(d.fallbackReason).toContain('GMS Absturz');
    await d.decodeFrame(blob(1));
    expect(wasm.prepare).toHaveBeenCalledTimes(1); // kein erneuter Wechsel
  });

  it('WASM-Fehler bei der Erkennung → ERR_DECODE_FAILED mit Ursache', async () => {
    const wasm = makePonyfill(() => Promise.reject(new TypeError('kaputtes Bild')));
    const d = new HybridDecoder({ native: null, loadPonyfill: () => Promise.resolve(wasm.mod) });
    await expect(d.decodeFrame(blob(1))).rejects.toMatchObject({ code: 'ERR_DECODE_FAILED' });
  });

  it('auch der Fallback scheitert → ERR_DECODE_FAILED, kein Endlosversuch', async () => {
    const native = makeCtor(() => Promise.reject(new Error('nativ kaputt')));
    const wasm = makePonyfill(() => Promise.reject(new Error('wasm kaputt')));
    const d = new HybridDecoder({ native: native.ctor, loadPonyfill: () => Promise.resolve(wasm.mod) });
    await expect(d.decodeFrame(blob(1))).rejects.toMatchObject({ code: 'ERR_DECODE_FAILED' });
    expect(d.engine).toBe('native'); // beide scheitern → Bild unlesbar, Engine unverändert
  });

  it('Fallback, dessen WASM nicht lädt → ERR_WASM_LOAD_FAILED', async () => {
    const native = makeCtor(() => Promise.reject(new Error('nativ kaputt')));
    const d = new HybridDecoder({ native: native.ctor, loadPonyfill: () => Promise.reject(new Error('offline')) });
    await expect(d.decodeFrame(blob(1))).rejects.toMatchObject({ code: 'ERR_WASM_LOAD_FAILED' });
  });
});

describe('Bildimport (scanFiles)', () => {
  it('meldet je Datei ok / keine Codes / nicht lesbar; mehrere Codes pro Bild einzeln', async () => {
    let call = 0;
    const { ctor } = makeCtor(() => {
      call++;
      if (call === 1) return Promise.resolve([det('ean_13', EAN, 0, 0), det('qr_code', 'zwei', 100, 0)]);
      if (call === 2) return Promise.resolve([]);
      return Promise.reject(new Error('kein Bild'));
    });
    const wasm = makePonyfill(() => Promise.reject(new Error('auch WASM kann das Bild nicht lesen')));
    const d = new HybridDecoder({ native: ctor, loadPonyfill: () => Promise.resolve(wasm.mod) });
    const res = await d.scanFiles([blob(5, 'a.jpg'), blob(5, 'b.jpg'), blob(5)]);
    expect(res.map((r) => [r.fileName, r.status, r.codes.length])).toEqual([
      ['a.jpg', 'ok', 2],
      ['b.jpg', 'no-codes', 0],
      ['Bild 3', 'error', 0]
    ]);
    expect(res[2]?.error?.code).toBe('ERR_DECODE_FAILED');
    expect(d.engine).toBe('native'); // ein unlesbares Bild degradiert die Engine nicht
  });

  it('zu große Datei → error, die übrigen laufen weiter', async () => {
    const { ctor } = makeCtor(() => Promise.resolve([det('ean_13', EAN)]));
    const d = new HybridDecoder({ native: ctor });
    const res = await d.scanFiles([blob(MAX_IMAGE_BYTES + 1, 'riesig.png'), blob(5, 'ok.png')]);
    expect(res.map((r) => r.status)).toEqual(['error', 'ok']);
    expect(res[0]?.error?.userMessage).toContain('zu groß');
  });

  it('genau MAX_IMAGE_BYTES ist erlaubt', async () => {
    const d = new HybridDecoder({ native: makeCtor(() => Promise.resolve([])).ctor });
    expect((await d.scanFiles([blob(MAX_IMAGE_BYTES)]))[0]?.status).toBe('no-codes');
  });

  it('fehlendes WASM betrifft alle Dateien und wird geworfen', async () => {
    const d = new HybridDecoder({ native: null, loadPonyfill: () => Promise.reject(new Error('404')) });
    await expect(d.scanFiles([blob(5, 'a.jpg')])).rejects.toMatchObject({ code: 'ERR_WASM_LOAD_FAILED' });
  });

  it('leere Dateiliste', async () => {
    const d = new HybridDecoder({ native: makeCtor(() => Promise.resolve([])).ctor });
    expect(await d.scanFiles([])).toEqual([]);
  });

  it('Dateien werden nacheinander ausgewertet (kein paralleler Speicherbedarf)', async () => {
    let running = 0;
    let maxRunning = 0;
    const { ctor } = makeCtor(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return [];
    });
    await new HybridDecoder({ native: ctor }).scanFiles([blob(1), blob(1), blob(1)]);
    expect(maxRunning).toBe(1);
  });
});
