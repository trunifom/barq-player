import { readFileSync } from 'node:fs';
import { prepareZXingModule, readBarcodes, type ReadResult } from 'zxing-wasm/reader';
import type { RenderedSymbol } from '../../src/adapters/renderer/barcode-renderer';

let prepared = false;

/** Initialisiert zxing-wasm ausschließlich mit der lokalen WASM-Datei (kein CDN, kein Netz). */
function prepare(): void {
  if (prepared) return;
  const wasm = readFileSync('public/wasm/zxing_reader.wasm');
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer } });
  prepared = true;
}

/**
 * Rastert ein gerendertes Symbol (nur Rechtecke, reines Schwarz auf Weiß) und liest es mit zxing-wasm zurück.
 * @param symbol - Ergebnis von `renderSymbol`.
 * @param formats - erlaubte zxing-Formate.
 * @param scale - Pixel pro Modul im Testbild.
 */
export async function decodeSymbol(symbol: RenderedSymbol, formats: string[], scale = 4): Promise<ReadResult[]> {
  prepare();
  const w = symbol.modulesWide * scale;
  const h = symbol.modulesHigh * scale;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const r of symbol.rects) {
    for (let y = r.y * scale; y < (r.y + r.h) * scale; y++) {
      for (let x = r.x * scale; x < (r.x + r.w) * scale; x++) {
        const i = (y * w + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return readBarcodes({ data, width: w, height: h, colorSpace: 'srgb' } as ImageData, { formats: formats as never, tryHarder: true });
}

/** Rastergrafik (Graustufen-RGBA) für Erkennungstests. */
export interface Raster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Setzt mehrere Symbole nebeneinander auf ein weißes Bild (z. B. „ein Foto mit mehreren Codes“).
 * @param symbols - gerenderte Symbole.
 * @param scale - Pixel pro Modul.
 * @param gapModules - weißer Abstand zwischen den Symbolen in Modulen.
 */
export function rasterizeSymbols(symbols: RenderedSymbol[], scale = 4, gapModules = 8): Raster {
  const width = (symbols.reduce((sum, s) => sum + s.modulesWide, 0) + gapModules * (symbols.length + 1)) * scale;
  const height = (Math.max(...symbols.map((s) => s.modulesHigh)) + 2 * gapModules) * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let offsetX = gapModules * scale;
  for (const s of symbols) {
    for (const r of s.rects) {
      for (let y = r.y * scale; y < (r.y + r.h) * scale; y++) {
        for (let x = r.x * scale; x < (r.x + r.w) * scale; x++) {
          const i = ((y + gapModules * scale) * width + (x + offsetX)) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
    offsetX += (s.modulesWide + gapModules) * scale;
  }
  return { data, width, height };
}
