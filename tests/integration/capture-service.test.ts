import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { DuplicateFilter } from '../../src/domain/duplicate-filter';
import { CaptureService, type CaptureOutcome } from '../../src/application/capture-service';
import { CollectionService } from '../../src/application/collection-service';
import type { DecodedCode, DecoderPort, FileScanResult, FrameResult } from '../../src/adapters/decoder/decoder-adapter';
import type { FeedbackPort } from '../../src/adapters/feedback/feedback-adapter';
import type { BarqDatabase } from '../../src/adapters/persistence/db';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

const code = (symbology: DecodedCode['symbology'], value: string): DecodedCode => ({ symbology, value, engine: 'native' });
const frame = (...codes: DecodedCode[]): FrameResult => ({ codes, rejected: [] });

class FakeDecoder implements DecoderPort {
  queue: Array<FrameResult | Error> = [];
  files: FileScanResult[] = [];
  gate: Promise<void> | null = null;
  decodeFrame = vi.fn(async (): Promise<FrameResult> => {
    if (this.gate) await this.gate;
    const next = this.queue.shift() ?? frame();
    if (next instanceof Error) throw next;
    return next;
  });
  scanFiles = vi.fn((): Promise<FileScanResult[]> => Promise.resolve(this.files));
}

interface Setup {
  db: BarqDatabase;
  svc: CaptureService;
  col: CollectionService;
  decoder: FakeDecoder;
  feedback: { saved: ReturnType<typeof vi.fn>; failed: ReturnType<typeof vi.fn> } & FeedbackPort;
  cid: string;
  clock: { t: number };
}

async function setup(opts: { uniqueOnly?: boolean; filter?: DuplicateFilter } = {}): Promise<Setup> {
  const db = freshDb();
  const col = new CollectionService(db, testDeps());
  const cid = (await col.createCollection('Lager')).id;
  const decoder = new FakeDecoder();
  const feedback = { saved: vi.fn(), failed: vi.fn() };
  const clock = { t: 0 };
  const svc = new CaptureService({
    collections: col,
    decoder,
    feedback,
    nowMs: () => clock.t,
    ...(opts.uniqueOnly === undefined ? {} : { uniqueOnly: opts.uniqueOnly }),
    ...(opts.filter ? { filter: opts.filter } : {})
  });
  return { db, svc, col, decoder, feedback, cid, clock };
}

const kinds = (o: CaptureOutcome[]): string[] => o.map((x) => x.kind);

describe('Live-Erfassung', () => {
  it('speichert einen neuen Code und bestätigt erst NACH dem erfolgreichen Schreiben', async () => {
    const s = await setup();
    let countAtFeedback = -1;
    s.feedback.saved.mockImplementation(() => {
      void s.db.items.count().then((n) => (countAtFeedback = n));
    });
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const r = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(r.skipped).toBe(false);
    expect(kinds(r.outcomes)).toEqual(['saved']);
    const out = r.outcomes[0];
    expect(out?.kind === 'saved' && out.merged).toBe(false);
    expect(out?.kind === 'saved' && out.item).toMatchObject({ value: EAN_A, source: 'camera', quantity: 1 });
    expect(s.feedback.saved).toHaveBeenCalledTimes(1);
    await new Promise((res) => setTimeout(res, 0));
    expect(countAtFeedback).toBe(1); // zum Zeitpunkt der Bestätigung war bereits gespeichert
    expect(s.feedback.failed).not.toHaveBeenCalled();
  });

  it('technisches Duplikat: dauerhaft vorgehaltener Code wird nur einmal erfasst', async () => {
    const s = await setup();
    for (let i = 0; i < 20; i++) {
      s.clock.t = i * 100;
      s.decoder.queue.push(frame(code('EAN13', EAN_A)));
      await s.svc.processFrame(s.cid, {} as ImageBitmap);
    }
    const items = await s.col.listItems(s.cid);
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(1);
    expect(s.feedback.saved).toHaveBeenCalledTimes(1);
  });

  it('fachliche Wiederholung: Code verschwindet und wird erneut vorgehalten → Menge + 1', async () => {
    const s = await setup();
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    await s.svc.processFrame(s.cid, {} as ImageBitmap);
    s.clock.t = 300;
    s.decoder.queue.push(frame());
    await s.svc.processFrame(s.cid, {} as ImageBitmap);
    s.clock.t = 2000;
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const r = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    const out = r.outcomes[0];
    expect(out?.kind === 'saved' && out.merged).toBe(true);
    expect((await s.col.listItems(s.cid))[0]?.quantity).toBe(2);
  });

  it('Modus „nur eindeutige Codes“: Wiederholung wird ignoriert und nicht bestätigt', async () => {
    const s = await setup({ uniqueOnly: true });
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    await s.svc.processFrame(s.cid, {} as ImageBitmap);
    s.clock.t = 300;
    s.decoder.queue.push(frame());
    await s.svc.processFrame(s.cid, {} as ImageBitmap);
    s.clock.t = 2000;
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const r = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(r.outcomes).toEqual([{ kind: 'ignored', reason: 'unique-only-duplicate', symbology: 'EAN13', value: EAN_A }]);
    expect((await s.col.listItems(s.cid))[0]?.quantity).toBe(1);
    expect(s.feedback.saved).toHaveBeenCalledTimes(1);
  });

  it('mehrere Codes im selben Bild werden einzeln gespeichert', async () => {
    const s = await setup();
    s.decoder.queue.push(frame(code('EAN13', EAN_A), code('QRCode', 'Notiz'), code('EAN13', EAN_A)));
    const r = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(kinds(r.outcomes)).toEqual(['saved', 'saved']);
    expect((await s.col.listItems(s.cid)).map((i) => i.value)).toEqual([EAN_A, 'Notiz']);
  });

  it('QR-Inhalte werden nur eingeordnet, nie ausgeführt: riskante Schemata werden gekennzeichnet', async () => {
    const s = await setup();
    s.decoder.queue.push(frame(code('QRCode', 'javascript:alert(1)'), code('QRCode', 'https://example.org')));
    const r = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    const [a, b] = r.outcomes;
    expect(a?.kind === 'saved' && a.qr).toMatchObject({ kind: 'url', scheme: 'javascript', risky: true });
    expect(b?.kind === 'saved' && b.qr).toMatchObject({ kind: 'url', risky: false });
    expect((await s.col.listItems(s.cid)).map((i) => i.value)).toContain('javascript:alert(1)');
  });

  it('verworfene Erkennungen werden gezählt', async () => {
    const s = await setup();
    s.decoder.queue.push({ codes: [], rejected: [{ format: 'ean_13', reason: 'invalid-value', message: 'x' }] });
    expect((await s.svc.processFrame(s.cid, {} as ImageBitmap)).rejected).toBe(1);
  });
});

describe('Fehlerfälle', () => {
  it('Schreibfehler: Fehlerergebnis, KEINE Erfolgsbestätigung, Fehlersignal; beim nächsten Bild erneuter Versuch', async () => {
    const s = await setup();
    const original = s.db.items.bulkPut.bind(s.db.items);
    s.db.items.bulkPut = (() => Promise.reject(new Error('Platte voll'))) as unknown as typeof s.db.items.bulkPut;
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const first = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(first.outcomes[0]).toMatchObject({ kind: 'error', symbology: 'EAN13' });
    const err = first.outcomes[0];
    expect(err?.kind === 'error' && err.error.code).toBe('ERR_STORAGE_WRITE_FAILED');
    expect(s.feedback.saved).not.toHaveBeenCalled();
    expect(s.feedback.failed).toHaveBeenCalledTimes(1);
    expect(await s.db.items.count()).toBe(0);

    s.db.items.bulkPut = original; // Problem behoben, Code wird weiter vorgehalten
    s.clock.t = 100;
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const second = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(kinds(second.outcomes)).toEqual(['saved']);
    expect(s.feedback.saved).toHaveBeenCalledTimes(1);
  });

  it('unbekannte Sammlung → error-Ergebnis ERR_NOT_FOUND', async () => {
    const s = await setup();
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const r = await s.svc.processFrame('gibt-es-nicht', {} as ImageBitmap);
    const out = r.outcomes[0];
    expect(out?.kind === 'error' && out.error.code).toBe('ERR_NOT_FOUND');
  });

  it('Decoderfehler: Fehlerergebnis und Fehlersignal; der Service bleibt benutzbar', async () => {
    const s = await setup();
    s.decoder.queue.push(new AppError('ERR_WASM_LOAD_FAILED'));
    const r = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    const out = r.outcomes[0];
    expect(out?.kind === 'error' && out.error.code).toBe('ERR_WASM_LOAD_FAILED');
    expect(s.feedback.failed).toHaveBeenCalledTimes(1);
    expect(s.svc.isBusy).toBe(false);
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    expect(kinds((await s.svc.processFrame(s.cid, {} as ImageBitmap)).outcomes)).toEqual(['saved']);
  });

  it('unbekannte Decoderfehler werden zu ERR_DECODE_FAILED', async () => {
    const s = await setup();
    s.decoder.queue.push(new TypeError('komisch'));
    const out = (await s.svc.processFrame(s.cid, {} as ImageBitmap)).outcomes[0];
    expect(out?.kind === 'error' && out.error.code).toBe('ERR_DECODE_FAILED');
  });

  it('überlappende Bilder werden übersprungen (keine Auswertungs-Staus)', async () => {
    const s = await setup();
    let release: () => void = () => undefined;
    s.decoder.gate = new Promise<void>((res) => {
      release = res;
    });
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    const running = s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(s.svc.isBusy).toBe(true);
    const skipped = await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect(skipped).toEqual({ skipped: true, outcomes: [], rejected: 0 });
    expect(s.decoder.decodeFrame).toHaveBeenCalledTimes(1);
    release();
    expect(kinds((await running).outcomes)).toEqual(['saved']);
    expect(s.svc.isBusy).toBe(false);
  });

  it('ohne Feedback-Port funktioniert alles weiter', async () => {
    const db = freshDb();
    const col = new CollectionService(db, testDeps());
    const cid = (await col.createCollection('x')).id;
    const decoder = new FakeDecoder();
    decoder.queue.push(frame(code('EAN13', EAN_A)));
    const svc = new CaptureService({ collections: col, decoder, nowMs: () => 0 });
    expect(kinds((await svc.processFrame(cid, {} as ImageBitmap)).outcomes)).toEqual(['saved']);
  });

  it('resetSession erlaubt sofortige erneute Erfassung desselben Codes (z. B. nach Kamerawechsel)', async () => {
    const s = await setup();
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    await s.svc.processFrame(s.cid, {} as ImageBitmap);
    s.svc.resetSession();
    s.clock.t = 50;
    s.decoder.queue.push(frame(code('EAN13', EAN_A)));
    await s.svc.processFrame(s.cid, {} as ImageBitmap);
    expect((await s.col.listItems(s.cid))[0]?.quantity).toBe(2);
  });
});

describe('Bildimport', () => {
  const scan = (name: string, status: FileScanResult['status'], codes: DecodedCode[]): FileScanResult => ({ fileName: name, status, codes, rejected: [] });

  it('scanImages reicht die Ergebnisse unverändert durch (Auswahl erfolgt in der UI)', async () => {
    const s = await setup();
    s.decoder.files = [scan('a.jpg', 'ok', [code('EAN13', EAN_A), code('QRCode', 'x')]), scan('b.jpg', 'no-codes', []), scan('c.jpg', 'error', [])];
    const res = await s.svc.scanImages([new Blob(['a'])]);
    expect(res.map((r) => r.status)).toEqual(['ok', 'no-codes', 'error']);
    expect(await s.db.items.count()).toBe(0); // erkennen speichert nichts
  });

  it('saveDetected speichert ausgewählte Codes atomar mit Quelle image und Herkunft als Bezeichnung', async () => {
    const s = await setup();
    const items = await s.svc.saveDetected(s.cid, [
      { symbology: 'EAN13', value: EAN_A, origin: 'a.jpg' },
      { symbology: 'EAN13', value: EAN_B, origin: 'a.jpg' },
      { symbology: 'EAN13', value: EAN_A, origin: 'b.jpg' }
    ]);
    expect(items).toHaveLength(3);
    const stored = await s.col.listItems(s.cid);
    expect(stored.map((i) => [i.value, i.quantity, i.source, i.label])).toEqual([[EAN_A, 2, 'image', 'a.jpg'], [EAN_B, 1, 'image', 'a.jpg']]);
    expect(s.feedback.saved).toHaveBeenCalledTimes(1);
  });

  it('saveDetected: ein ungültiger Code verhindert alles, kein Erfolgssignal, Fehler wird geworfen', async () => {
    const s = await setup();
    await expect(
      s.svc.saveDetected(s.cid, [
        { symbology: 'EAN13', value: EAN_A },
        { symbology: 'EAN13', value: '4006381333930' }
      ])
    ).rejects.toMatchObject({ code: 'ERR_CHECKSUM_INVALID' });
    expect(await s.db.items.count()).toBe(0);
    expect(s.feedback.saved).not.toHaveBeenCalled();
    expect(s.feedback.failed).toHaveBeenCalledTimes(1);
  });

  it('saveDetected mit leerer Auswahl speichert nichts und gibt kein Erfolgssignal', async () => {
    const s = await setup();
    expect(await s.svc.saveDetected(s.cid, [])).toEqual([]);
    expect(s.feedback.saved).not.toHaveBeenCalled();
  });
});
