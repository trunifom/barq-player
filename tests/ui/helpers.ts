import { vi } from 'vitest';
import { createAppContext, type AppContext, type AppEnvironment } from '../../src/app/container';
import type { StorageManagerLike } from '../../src/adapters/persistence/db';
import type { WakeLockApi } from '../../src/adapters/wakelock/wake-lock';
import type { MotionTarget } from '../../src/adapters/sensors/lift-detector';
import type { Dispose, Route } from '../../src/app/routes';
import type { CameraAdapter, CameraSession } from '../../src/adapters/camera/camera-adapter';
import type { DecodedCode, DecoderPort, FileScanResult, FrameResult, HybridDecoder } from '../../src/adapters/decoder/decoder-adapter';
import type { KeyValueStorage } from '../../src/application/settings-store';
import type { Symbology } from '../../src/domain/types';
import { ManualScheduler } from '../helpers/scheduler';
import { disposeDbs } from '../integration/helpers';

/** Ablaufsteuerung der asynchronen UI (IndexedDB, Promises). */
export async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Wartet, bis eine Bedingung erfüllt ist (max. `timeoutMs`). */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: Zeitüberschreitung');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Test-Decoder mit steuerbaren Ergebnissen. */
export class FakeDecoder implements DecoderPort {
  frames: Array<FrameResult | Error> = [];
  files: FileScanResult[] = [];
  engine: 'native' | 'wasm' | null = 'wasm';
  fallbackReason: string | null = null;
  decodeFrame = vi.fn(async (): Promise<FrameResult> => {
    const next = this.frames.shift() ?? { codes: [], rejected: [] };
    if (next instanceof Error) throw next;
    return next;
  });
  scanFiles = vi.fn((): Promise<FileScanResult[]> => Promise.resolve(this.files));
}

export const code = (symbology: Symbology, value: string): DecodedCode => ({ symbology, value, engine: 'native' });

/** Test-Kamera. */
export class FakeCamera {
  current: CameraSession | null = null;
  torchSupported = true;
  startError: unknown = null;
  start = vi.fn(async () => {
    if (this.startError) throw this.startError;
    const track = { stop: vi.fn() };
    this.current = { stream: { getTracks: () => [track], getVideoTracks: () => [track] }, track, facingMode: 'environment', deviceId: 'cam', torchSupported: this.torchSupported };
    return this.current;
  });
  stop = vi.fn(() => {
    this.current = null;
  });
  switchCamera = vi.fn(async () => this.start());
  setTorch = vi.fn(() => Promise.resolve());
}

export function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** Test-Umgebung für App-Kontext und Bootstrap. */
export interface TestEnv {
  env: AppEnvironment;
  sched: ManualScheduler;
  decoder: FakeDecoder;
  camera: FakeCamera;
  noticeTimers: ManualScheduler;
  liftSched: ManualScheduler;
  clock: { ms: number };
}

let counter = 0;

/**
 * Erzeugt eine vollständig kontrollierbare Umgebung (Zeit, Decoder, Kamera, Speicher).
 * @param over - optionale Überschreibungen (Einstellungsspeicher, Speicherverwaltung, Wake-Lock-API).
 */
export function testEnv(over: { storage?: KeyValueStorage | null; storageManager?: StorageManagerLike; wakeLockApi?: WakeLockApi; liftTarget?: MotionTarget } = {}): TestEnv {
  (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = () => Promise.resolve();
  const sched = new ManualScheduler();
  const noticeTimers = new ManualScheduler();
  const liftSched = new ManualScheduler();
  const decoder = new FakeDecoder();
  const camera = new FakeCamera();
  const clock = { ms: 0 };
  let n = 0;
  let t = 0;
  const env: AppEnvironment = {
    win: window,
    doc: document,
    dbName: `barq-ui-${++counter}-${Date.now()}`,
    storage: over.storage === undefined ? memoryStorage() : over.storage,
    overrides: {
      createDecoder: () => decoder as unknown as HybridDecoder,
      camera: camera as unknown as CameraAdapter,
      scheduler: sched,
      noticeTimers,
      newId: () => `id-${++n}`,
      nowIso: () => `2026-11-24T10:00:${String(++t % 60).padStart(2, '0')}.000Z`,
      nowMs: () => clock.ms,
      wakeLockApi: over.wakeLockApi,
      storageManager: over.storageManager,
      liftTimers: liftSched,
      liftNow: () => clock.ms,
      liftTarget: over.liftTarget // Standard in Tests: keine Bewegungssensoren (jsdom bietet DeviceMotionEvent an)
    }
  };
  return { env, sched, decoder, camera, noticeTimers, liftSched, clock };
}

export interface UiSetup {
  ctx: AppContext;
  root: HTMLElement;
  sched: ManualScheduler;
  decoder: FakeDecoder;
  camera: FakeCamera;
  noticeTimers: ManualScheduler;
  liftSched: ManualScheduler;
  clock: { ms: number };
  dispose: Dispose | null;
  mount(fn: (root: HTMLElement, ctx: AppContext, route: Route) => Dispose, route?: Route): void;
  unmount(): void;
}

/** Erzeugt Kontext und leeres Wurzelelement für Screen-Tests. */
export function setupUi(over: { storage?: KeyValueStorage | null; storageManager?: StorageManagerLike; liftTarget?: MotionTarget } = {}): UiSetup {
  const te = testEnv(over);
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const ctx = createAppContext(te.env);
  const setup: UiSetup = {
    ctx,
    root,
    sched: te.sched,
    decoder: te.decoder,
    camera: te.camera,
    noticeTimers: te.noticeTimers,
    liftSched: te.liftSched,
    clock: te.clock,
    dispose: null,
    mount(fn, route = { name: 'scanner', params: {} }) {
      setup.dispose = fn(root, ctx, route);
    },
    unmount() {
      setup.dispose?.();
      setup.dispose = null;
    }
  };
  return setup;
}

/** Aufräumen nach jedem Test. */
export async function teardownUi(setup: UiSetup | null): Promise<void> {
  setup?.unmount();
  setup?.ctx.notify.clear();
  await setup?.ctx.db.delete();
  await disposeDbs();
  document.body.replaceChildren();
  document.body.className = '';
}

/** Klickt ein Element per Selektor. */
export function click(root: ParentNode, selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Element nicht gefunden: ${selector}`);
  el.click();
}

/** Setzt einen Eingabewert und löst `input` und `change` aus. */
export function setValue(root: ParentNode, selector: string, value: string): void {
  const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  if (!el) throw new Error(`Element nicht gefunden: ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Setzt ein Kontrollkästchen. */
export function setChecked(root: ParentNode, selector: string, checked: boolean): void {
  const el = root.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`Element nicht gefunden: ${selector}`);
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Text eines Elements (leer, wenn nicht vorhanden). */
export function text(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

/** Bestätigt/bricht einen offenen Dialog ab (Buttons im Overlay). */
export async function answerDialog(label: string | RegExp, input?: string): Promise<void> {
  await waitFor(() => document.querySelector('.dialog') !== null);
  if (input !== undefined) {
    const el = document.querySelector<HTMLInputElement>('.dialog input');
    if (el) el.value = input;
  }
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')));
  if (!btn) throw new Error(`Dialog-Button nicht gefunden: ${String(label)}`);
  btn.click();
  await flush(3);
}

/** Legt Dateien an ein `<input type=file>` und löst `change` aus. */
export function chooseFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
