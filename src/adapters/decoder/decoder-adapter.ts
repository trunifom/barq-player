/**
 * Hybrid-Decoder: nativer Browser-`BarcodeDetector` (Android Chrome) mit nahtlosem Fallback auf `zxing-wasm`
 * (über das `barcode-detector`-ponyfill, dasselbe zxing-wasm 3.1.8).
 *
 * OFFLINE-REGEL (AGENTS.md Regel 1): Das WASM wird IMMER über `locateFile` lokal von `./wasm/zxing_reader.wasm`
 * geladen – nie von einem CDN. {@link locateZxingFile} liefert für `.wasm`-Dateien ausschließlich diesen Pfad.
 *
 * Ergebnisse laufen durch {@link interpretDetection}: Whitelist, einzige Normalisierung (UPC-A) und Validierung.
 * Ungültige Erkennungen gelangen nie in die App, sondern werden als `rejected` gemeldet.
 */
import { AppError, isAppError } from '../../domain/errors';
import { DEFAULT_WHITELIST, interpretDetection, toDetectorFormats } from '../../domain/detection';
import type { Symbology } from '../../domain/types';

/** Lokaler, relativer Pfad zur WASM-Datei (wird von `npm run copy:wasm` bereitgestellt und vom Service Worker vorgeladen). */
export const WASM_PATH = './wasm/zxing_reader.wasm';

/** Maximale Dateigröße beim Bildimport (Schutz vor Speicherproblemen). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * `locateFile`-Funktion für zxing-wasm: `.wasm`-Dateien kommen immer aus {@link WASM_PATH}.
 * @param path - angeforderter Dateiname.
 * @param prefix - von zxing vorgeschlagenes Präfix (Standard wäre ein CDN) – wird für `.wasm` ignoriert.
 * @returns lokaler Pfad.
 */
export function locateZxingFile(path: string, prefix: string): string {
  return path.endsWith('.wasm') ? WASM_PATH : prefix + path;
}

/** Eine rohe Erkennung eines `BarcodeDetector`. */
export interface DetectedLike {
  format: string;
  rawValue: string;
  boundingBox?: { x: number; y: number };
}

/** Quelle für die Erkennung (Video, Canvas, ImageBitmap, Blob …). */
export type DetectionSource = ImageBitmapSource | Blob;

/** Struktur eines `BarcodeDetector`. */
export interface DetectorLike {
  detect(source: DetectionSource): Promise<DetectedLike[]>;
}

/** Konstruktor eines `BarcodeDetector`. */
export interface DetectorCtor {
  new (options?: { formats?: string[] }): DetectorLike;
  getSupportedFormats?(): Promise<readonly string[]>;
}

/** Struktur des ponyfill-Moduls (soweit benötigt). */
export interface PonyfillModule {
  BarcodeDetector: DetectorCtor;
  prepareZXingModule(options: { overrides?: { locateFile?: (path: string, prefix: string) => string }; fireImmediately?: boolean }): unknown;
}

/** Eingesetzte Engine. */
export type DecoderEngine = 'native' | 'wasm';

/** Abhängigkeiten des Decoders (alle injizierbar). */
export interface DecoderDeps {
  /** Nativer Detektor (Standard: `globalThis.BarcodeDetector`, falls vorhanden). `null` erzwingt den WASM-Pfad. */
  native?: DetectorCtor | null;
  /** Lädt das ponyfill (Standard: dynamischer Import von `barcode-detector/ponyfill`). */
  loadPonyfill?: () => Promise<PonyfillModule>;
  /** Erlaubte Symbologien (Standard {@link DEFAULT_WHITELIST}). */
  whitelist?: readonly Symbology[];
}

/** Ein akzeptierter Code. */
export interface DecodedCode {
  symbology: Symbology;
  value: string;
  engine: DecoderEngine;
}

/** Eine verworfene Erkennung (ohne Inhalt, nur Grund). */
export interface RejectedDetection {
  format: string;
  reason: 'unknown-format' | 'format-not-allowed' | 'invalid-value';
  message: string;
}

/** Ergebnis einer Bildauswertung. */
export interface FrameResult {
  codes: DecodedCode[];
  rejected: RejectedDetection[];
}

/** Ergebnis je Datei beim Bildimport. */
export interface FileScanResult {
  fileName: string;
  /** `ok`: Codes gefunden; `no-codes`: lesbar, aber ohne Code; `error`: Datei nicht lesbar/zu groß. */
  status: 'ok' | 'no-codes' | 'error';
  codes: DecodedCode[];
  rejected: RejectedDetection[];
  error?: AppError;
}

/** Schnittstelle, die der Capture-Service benötigt. */
export interface DecoderPort {
  decodeFrame(source: DetectionSource): Promise<FrameResult>;
  scanFiles(files: ReadonlyArray<Blob & { name?: string }>): Promise<FileScanResult[]>;
}

function nativeFromGlobal(): DetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

async function defaultLoadPonyfill(): Promise<PonyfillModule> {
  return (await import('barcode-detector/ponyfill')) as unknown as PonyfillModule;
}

/** Hybrid-Decoder (nativ → WASM). */
export class HybridDecoder implements DecoderPort {
  private detector: DetectorLike | null = null;
  private activeEngine: DecoderEngine | null = null;
  private initPromise: Promise<DecoderEngine> | null = null;
  private wasmFallback: Promise<DetectorLike> | null = null;
  private readonly whitelist: readonly Symbology[];
  private readonly formats: string[];
  private readonly native: DetectorCtor | null;
  private readonly loadPonyfill: () => Promise<PonyfillModule>;
  /** Grund, warum auf WASM gewechselt wurde (für die Diagnoseanzeige). */
  fallbackReason: string | null = null;

  /** @param deps - optionale Abhängigkeiten. */
  constructor(deps: DecoderDeps = {}) {
    this.whitelist = deps.whitelist ?? DEFAULT_WHITELIST;
    this.formats = toDetectorFormats(this.whitelist);
    this.native = deps.native === undefined ? nativeFromGlobal() : deps.native;
    this.loadPonyfill = deps.loadPonyfill ?? defaultLoadPonyfill;
  }

  /** @returns aktive Engine oder `null`, solange nicht initialisiert. */
  get engine(): DecoderEngine | null {
    return this.activeEngine;
  }

  /**
   * Wählt die Engine: nativ, wenn vorhanden und ALLE Whitelist-Formate unterstützt werden, sonst WASM
   * (Modul wird sofort geladen, damit ein fehlendes WASM früh auffällt). Mehrfachaufrufe teilen sich eine Initialisierung.
   * @returns gewählte Engine.
   * @throws {AppError} `ERR_WASM_LOAD_FAILED`, wenn weder nativ noch WASM verfügbar ist.
   */
  init(): Promise<DecoderEngine> {
    this.initPromise ??= this.doInit().catch((error: unknown) => {
      this.initPromise = null; // erneuter Versuch bei späterem Aufruf möglich
      throw error;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<DecoderEngine> {
    if (this.native) {
      try {
        const supported = (await this.native.getSupportedFormats?.()) ?? [];
        const missing = this.formats.filter((f) => !supported.includes(f));
        if (missing.length === 0) {
          this.detector = new this.native({ formats: this.formats });
          this.activeEngine = 'native';
          return 'native';
        }
        this.fallbackReason = `Nativer Detektor unterstützt nicht: ${missing.join(', ')}`;
      } catch (error: unknown) {
        this.fallbackReason = `Nativer Detektor nicht nutzbar: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else {
      this.fallbackReason = 'Kein nativer BarcodeDetector vorhanden';
    }
    return this.initWasm();
  }

  /** Lädt das ponyfill und erzeugt einen WASM-Detektor (lokales WASM, sofort geladen). */
  private async createWasmDetector(): Promise<DetectorLike> {
    try {
      const mod = await this.loadPonyfill();
      // locateFile erzwingt den lokalen Pfad; ohne diese Zeile würde zxing-wasm ein CDN verwenden.
      await mod.prepareZXingModule({ overrides: { locateFile: locateZxingFile }, fireImmediately: true });
      return new mod.BarcodeDetector({ formats: this.formats });
    } catch (error: unknown) {
      throw new AppError('ERR_WASM_LOAD_FAILED', {
        details: `${WASM_PATH}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
        cause: error
      });
    }
  }

  private async initWasm(): Promise<DecoderEngine> {
    this.detector = await this.createWasmDetector();
    this.activeEngine = 'wasm';
    return 'wasm';
  }

  /**
   * Erkennung mit Laufzeit-Fallback. Wirft der native Detektor, ist unklar, ob die Engine oder das Bild schuld ist
   * (z. B. beschädigtes Bild): Das Bild wird einmal mit WASM wiederholt. Gelingt das, gilt der native Detektor als
   * defekt und es wird dauerhaft auf WASM gewechselt; scheitert auch WASM, war das Bild unlesbar und die Engine bleibt.
   */
  private async detect(source: DetectionSource): Promise<DetectedLike[]> {
    await this.init();
    const active = this.detector;
    if (!active) throw new AppError('ERR_WASM_LOAD_FAILED', { details: 'Kein Detektor initialisiert' });
    try {
      return await active.detect(source);
    } catch (error: unknown) {
      if (this.activeEngine !== 'native') throw this.decodeError(error);
      const nativeReason = error instanceof Error ? error.message : String(error);
      this.wasmFallback ??= this.createWasmDetector().catch((e: unknown) => {
        this.wasmFallback = null;
        throw e;
      });
      const wasm = await this.wasmFallback;
      try {
        const result = await wasm.detect(source);
        this.detector = wasm;
        this.activeEngine = 'wasm';
        this.fallbackReason = `Nativer Detektor fehlgeschlagen: ${nativeReason}`;
        return result;
      } catch (retryError: unknown) {
        throw this.decodeError(retryError);
      }
    }
  }

  private decodeError(error: unknown): AppError {
    if (isAppError(error)) return error;
    return new AppError('ERR_DECODE_FAILED', { details: error instanceof Error ? `${error.name}: ${error.message}` : String(error), cause: error });
  }

  /** Wertet Roherkennungen aus (Whitelist, Normalisierung, Validierung, stabile Reihenfolge oben→unten, links→rechts). */
  private interpret(raw: DetectedLike[]): FrameResult {
    const engine = this.activeEngine ?? 'wasm';
    const sorted = [...raw].sort((a, b) => (a.boundingBox?.y ?? 0) - (b.boundingBox?.y ?? 0) || (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0));
    const codes: DecodedCode[] = [];
    const rejected: RejectedDetection[] = [];
    for (const d of sorted) {
      const r = interpretDetection(d.format, d.rawValue, this.whitelist);
      if (r.ok) codes.push({ symbology: r.symbology, value: r.value, engine });
      else rejected.push({ format: d.format, reason: r.reason, message: r.message });
    }
    return { codes, rejected };
  }

  /**
   * Wertet ein Live-Bild aus (Video, Canvas, ImageBitmap …).
   * @param source - Bildquelle.
   * @returns akzeptierte und verworfene Erkennungen.
   * @throws {AppError} `ERR_WASM_LOAD_FAILED` oder `ERR_DECODE_FAILED`.
   */
  async decodeFrame(source: DetectionSource): Promise<FrameResult> {
    return this.interpret(await this.detect(source));
  }

  /**
   * Wertet eine Bilddatei aus (mehrere Codes pro Bild möglich).
   * @param file - Bilddatei.
   * @returns akzeptierte und verworfene Erkennungen.
   * @throws {AppError} `ERR_DECODE_FAILED` (zu groß/nicht lesbar), `ERR_WASM_LOAD_FAILED`.
   */
  async decodeFile(file: Blob): Promise<FrameResult> {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError('ERR_DECODE_FAILED', { details: `${file.size} Bytes > ${MAX_IMAGE_BYTES}`, userMessage: 'Das Bild ist zu groß (maximal 25 MB).' });
    }
    return this.interpret(await this.detect(file));
  }

  /**
   * Wertet mehrere Bilddateien nacheinander aus (schont den Speicher). Nicht lesbare Bilder werden als solche gemeldet,
   * brechen aber die übrigen nicht ab. Ein fehlendes WASM (`ERR_WASM_LOAD_FAILED`) betrifft alle Dateien und wird geworfen.
   * @param files - Dateien.
   * @returns Ergebnis je Datei in Eingabereihenfolge.
   * @throws {AppError} `ERR_WASM_LOAD_FAILED`.
   */
  async scanFiles(files: ReadonlyArray<Blob & { name?: string }>): Promise<FileScanResult[]> {
    const results: FileScanResult[] = [];
    for (const [i, file] of files.entries()) {
      const fileName = file.name ?? `Bild ${i + 1}`;
      try {
        const { codes, rejected } = await this.decodeFile(file);
        results.push({ fileName, status: codes.length > 0 ? 'ok' : 'no-codes', codes, rejected });
      } catch (error: unknown) {
        const appError = this.decodeError(error);
        if (appError.code === 'ERR_WASM_LOAD_FAILED') throw appError;
        results.push({ fileName, status: 'error', codes: [], rejected: [], error: appError });
      }
    }
    return results;
  }
}
