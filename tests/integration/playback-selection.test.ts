import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { BackupService } from '../../src/application/backup-service';
import { CollectionService } from '../../src/application/collection-service';
import { PlaybackController, type PlaybackRequest } from '../../src/application/playback-service';
import { SessionService } from '../../src/application/session-service';
import { ManualScheduler } from '../helpers/scheduler';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

const A = '4006381333931';
const B = '5901234123457';
const C = '9780201379624';
const PROFILE = { id: 'p', name: 'Test', displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 1000 };

function setup() {
  const db = freshDb();
  const deps = testDeps();
  const col = new CollectionService(db, deps);
  const sessions = new SessionService(db);
  let n = 0;
  const ctrl = new PlaybackController({
    collections: col,
    sessions,
    scheduler: new ManualScheduler(),
    newId: () => `sess-${++n}`,
    nowIso: () => '2026-11-24T10:00:00.000Z',
    appVersion: 't',
    wakeLock: { acquire: vi.fn(() => Promise.resolve(true)), release: vi.fn(() => Promise.resolve()) }
  });
  return { db, col, ctrl, sessions, backup: new BackupService(db, 't', deps) };
}

const req = (cid: string, over: Partial<PlaybackRequest> = {}): PlaybackRequest => ({ collectionId: cid, profile: PROFILE, mode: 'auto', interleave: false, viewport: { width: 360, height: 800 }, devicePixelRatio: 3, ...over });

async function seed(col: CollectionService): Promise<{ id: string; ids: string[] }> {
  const c = await col.createCollection('L');
  const items = await col.addItems(c.id, [
    { symbology: 'EAN13', value: A, source: 'manual', quantity: 2 },
    { symbology: 'EAN13', value: B, source: 'manual' },
    { symbology: 'EAN13', value: C, source: 'manual', expiresAt: '2020-01-01' }
  ]);
  return { id: c.id, ids: items.map((i) => i.id) };
}

describe('Auswahl der abzuspielenden Codes', () => {
  it('spielt nur die gewählten Positionen, in der Reihenfolge der Sammlung (unabhängig von der Reihenfolge der IDs)', async () => {
    const { col, ctrl } = setup();
    const { id, ids } = await seed(col);
    const p = await ctrl.prepare(req(id, { itemIds: [ids[1] as string, ids[0] as string] }));
    expect(p.entries.map((e) => e.value)).toEqual([A, A, B]);
  });

  it('die Auswahl wirkt vor der Ablauf-Prüfung: ein gewählter abgelaufener Code wird übersprungen und gezählt', async () => {
    const { col, ctrl } = setup();
    const { id, ids } = await seed(col);
    const p = await ctrl.prepare(req(id, { itemIds: [ids[1] as string, ids[2] as string] }));
    expect(p.entries.map((e) => e.value)).toEqual([B]);
    expect(p.skippedExpired).toBe(1);
    expect((await ctrl.prepare(req(id, { itemIds: [ids[2] as string], includeExpired: true }))).entries.map((e) => e.value)).toEqual([C]);
  });

  it('leere oder unbekannte Auswahl → klare Meldung statt leerer Sitzung', async () => {
    const { col, ctrl } = setup();
    const { id } = await seed(col);
    for (const itemIds of [[], ['gibt-es-nicht']]) {
      const e = await ctrl.prepare(req(id, { itemIds })).catch((error: unknown) => error);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).userMessage).toContain('kein Code ausgewählt');
    }
  });

  it('ohne Auswahl läuft die ganze Sammlung; die Kalibrierung ignoriert eine Auswahl', async () => {
    const { col, ctrl } = setup();
    const { id, ids } = await seed(col);
    expect((await ctrl.prepare(req(id))).entries).toHaveLength(3); // A×2, B (C abgelaufen)
    expect((await ctrl.prepare(req(id, { calibration: true, itemIds: [ids[1] as string] }))).entries).toHaveLength(20);
  });
});

describe('Zeiten im Sitzungsprotokoll', () => {
  it('die tatsächlich verwendeten Zeiten werden gespeichert (auch wenn sie vom Profil abweichen) und überstehen ein Backup', async () => {
    const { col, ctrl, sessions, backup, db } = setup();
    const { id } = await seed(col);
    const prepared = await ctrl.prepare(req(id, { profile: { ...PROFILE, displayMs: 1234, blankMs: 321 } }));
    const active = await ctrl.begin(prepared);
    expect(active.session.timing).toEqual({ displayMs: 1234, blankMs: 321, identicalBlankMs: 400, startDelayMs: 1000 });
    expect((await db.sessions.toArray())[0]?.timing?.displayMs).toBe(1234);
    expect(sessions).toBeDefined();
    const json = await backup.exportJson();
    await backup.importJson(json);
    expect((await db.sessions.toArray())[0]?.timing).toEqual({ displayMs: 1234, blankMs: 321, identicalBlankMs: 400, startDelayMs: 1000 });
    const broken = JSON.parse(json) as { data: { sessions: Array<Record<string, unknown>> } };
    broken.data.sessions[0]!['timing'] = { displayMs: 'schnell' };
    const e = await backup.importJson(JSON.stringify(broken)).catch((error: unknown) => error);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('ERR_IMPORT_SCHEMA_INVALID');
  });

  it('ältere Sitzungen ohne Zeiten bleiben gültig', async () => {
    const { backup, db } = setup();
    await db.sessions.add({ id: 's', collectionId: 'c', startedAt: 't', mode: 'auto', appVersion: '0.1.0', entryCount: 1, interleaved: false, status: 'finished' });
    const json = await backup.exportJson();
    await backup.importJson(json);
    expect((await db.sessions.toArray())[0]?.timing).toBeUndefined();
  });
});
