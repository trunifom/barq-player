import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { PlaybackController, type PlaybackRequest } from '../../src/application/playback-service';
import { CollectionService } from '../../src/application/collection-service';
import { SessionService } from '../../src/application/session-service';
import { DEFAULT_PROFILES } from '../../src/domain/profiles';
import type { BarqDatabase } from '../../src/adapters/persistence/db';
import { ManualScheduler } from '../helpers/scheduler';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';
const PROFILE = { id: 'p', name: 'Test', displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 1000 };

interface Setup {
  db: BarqDatabase;
  col: CollectionService;
  ctrl: PlaybackController;
  sched: ManualScheduler;
  errors: unknown[];
  wake: { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  sessions: SessionService;
}

function setup(): Setup {
  const db = freshDb();
  const deps = testDeps();
  const col = new CollectionService(db, deps);
  const sessions = new SessionService(db);
  const sched = new ManualScheduler();
  const errors: unknown[] = [];
  const wake = { acquire: vi.fn(() => Promise.resolve(true)), release: vi.fn(() => Promise.resolve()) };
  let n = 0;
  const ctrl = new PlaybackController({
    collections: col,
    sessions,
    scheduler: sched,
    newId: () => `sess-${++n}`,
    nowIso: () => '2026-11-24T10:00:00.000Z',
    appVersion: '0.1.0-test',
    wakeLock: wake,
    onPersistError: (e) => errors.push(e)
  });
  return { db, col, ctrl, sched, errors, wake, sessions };
}

const request = (cid: string, over: Partial<PlaybackRequest> = {}): PlaybackRequest => ({
  collectionId: cid,
  profile: PROFILE,
  mode: 'auto',
  interleave: false,
  viewport: { width: 360, height: 800 },
  devicePixelRatio: 3,
  ...over
});

async function filled(s: Setup, items: Array<[string, number]> = [[EAN_A, 1], [EAN_B, 1]]): Promise<string> {
  const c = await s.col.createCollection('Lager');
  await s.col.addItems(c.id, items.map(([value, quantity]) => ({ symbology: 'EAN13' as const, value, source: 'manual' as const, quantity })));
  return c.id;
}

describe('prepare', () => {
  it('baut die Ausgabeliste aus Mengen und liefert Statistik; Interleaving optional', async () => {
    const s = setup();
    const cid = await filled(s, [[EAN_A, 3], [EAN_B, 2]]);
    const plain = await s.ctrl.prepare(request(cid));
    expect(plain.entries.map((e) => e.value)).toEqual([EAN_A, EAN_A, EAN_A, EAN_B, EAN_B]);
    expect(plain.collectionName).toBe('Lager');
    expect(plain.uniqueSymbols).toBe(2);
    expect(plain.stats.reordered).toBe(false);
    const mixed = await s.ctrl.prepare(request(cid, { interleave: true }));
    expect(mixed.entries.map((e) => e.value)).toEqual([EAN_A, EAN_B, EAN_A, EAN_B, EAN_A]);
    expect(mixed.stats).toMatchObject({ identicalTransitionsBefore: 3, identicalTransitionsAfter: 0, avoidedTransitions: 3 });
  });

  it('ungültiges Profil (Leerzeit < 20 ms: kein sicherer leerer Frame) verhindert die Vorbereitung', async () => {
    const s = setup();
    const cid = await filled(s);
    await expect(s.ctrl.prepare(request(cid, { profile: { ...PROFILE, blankMs: 0 } }))).rejects.toMatchObject({ code: 'ERR_PLAYBACK_FAILED' });
    await expect(s.ctrl.prepare(request(cid, { profile: { ...PROFILE, identicalBlankMs: 10 } }))).rejects.toMatchObject({ code: 'ERR_PLAYBACK_FAILED' });
    await expect(s.ctrl.prepare(request(cid, { profile: { ...PROFILE, displayMs: 0 } }))).rejects.toMatchObject({ code: 'ERR_PLAYBACK_FAILED' });
    await expect(s.ctrl.prepare(request(cid, { profile: { ...PROFILE, blankMs: 20, identicalBlankMs: 20 } }))).resolves.toBeDefined();
  });

  it('Kalibrierung: genau 20 Positionen, ohne Interleaving', async () => {
    const s = setup();
    const cid = await filled(s, [[EAN_A, 2], [EAN_B, 1]]);
    const p = await s.ctrl.prepare(request(cid, { calibration: true, interleave: true }));
    expect(p.entries).toHaveLength(20);
    expect(p.stats.reordered).toBe(false);
  });

  it('unbekannte oder leere Sammlung', async () => {
    const s = setup();
    await expect(s.ctrl.prepare(request('zzz'))).rejects.toMatchObject({ code: 'ERR_NOT_FOUND' });
    const empty = await s.col.createCollection('Leer');
    await expect(s.ctrl.prepare(request(empty.id))).rejects.toMatchObject({ code: 'ERR_PLAYBACK_FAILED' });
  });

  it('Vorabprüfung: nicht darstellbarer Code verhindert den Start und nennt die Position', async () => {
    const s = setup();
    const c = await s.col.createCollection('x');
    await s.col.addItems(c.id, [
      { symbology: 'QRCode', value: 'ok', source: 'manual' },
      { symbology: 'QRCode', value: 'x'.repeat(1990), source: 'manual' }
    ]);
    // Auf 150×150 Pixeln passt der kleine QR (29 Module), der große (185 Module) aber nicht mit 1 Pixel pro Modul
    await expect(s.ctrl.prepare(request(c.id, { viewport: { width: 150, height: 150 }, devicePixelRatio: 1 }))).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.userMessage.startsWith('Position 2:')
    );
  });

  it('Vorabprüfung: Symbol, das auf die Fläche nicht passt, verhindert den Start', async () => {
    const s = setup();
    const cid = await filled(s);
    await expect(s.ctrl.prepare(request(cid, { viewport: { width: 50, height: 50 }, devicePixelRatio: 1 }))).rejects.toMatchObject({ code: 'ERR_RENDER_FAILED' });
  });
});

describe('begin und Protokoll', () => {
  it('startet, schreibt Sitzungskopf (mit App-Version) und fortlaufend Ereignisse und Status', async () => {
    const s = setup();
    const cid = await filled(s);
    const prepared = await s.ctrl.prepare(request(cid, { profile: { ...PROFILE, startDelayMs: 0 } }));
    const active = await s.ctrl.begin(prepared);
    expect(active.machine.snapshot.state).toBe('SHOWING');
    expect(s.wake.acquire).toHaveBeenCalledTimes(1);
    s.sched.advance(10_000);
    await s.ctrl.flush();
    expect(s.errors).toEqual([]);
    const [session] = await s.sessions.listSessions();
    expect(session).toMatchObject({ id: 'sess-1', appVersion: '0.1.0-test', entryCount: 2, mode: 'auto', status: 'finished', profileId: 'p', interleaved: false });
    const events = await s.sessions.listEvents('sess-1');
    expect(events.map((e) => e.type)).toEqual(['displayed', 'blanked', 'displayed', 'blanked']);
    expect(s.wake.release).toHaveBeenCalledTimes(1);
    expect(s.ctrl.isLive).toBe(false);
  });

  it('Ereignisse enthalten nie pos-accepted/pos-rejected; manuelle Bestätigung nur mit Evidenz operator', async () => {
    const s = setup();
    const cid = await filled(s);
    const active = await s.ctrl.begin(await s.ctrl.prepare(request(cid, { mode: 'manual', profile: { ...PROFILE, startDelayMs: 0 } })));
    s.sched.advance(500);
    active.machine.confirm();
    s.sched.advance(150 + 500);
    active.machine.confirm();
    await s.ctrl.flush();
    const events = await s.sessions.listEvents('sess-1');
    expect(events.some((e) => e.type === 'pos-accepted' || e.type === 'pos-rejected')).toBe(false);
    const confirmed = events.filter((e) => e.type === 'manual-confirmed');
    expect(confirmed).toHaveLength(2);
    expect(confirmed.every((e) => e.evidence === 'operator')).toBe(true);
  });

  it('Pause blendet sofort aus; Status bleibt running; Abbruch setzt aborted', async () => {
    const s = setup();
    const cid = await filled(s);
    const active = await s.ctrl.begin(await s.ctrl.prepare(request(cid, { profile: { ...PROFILE, startDelayMs: 0 } })));
    expect(s.ctrl.pauseActive('background')).toBe(true);
    expect(active.machine.snapshot.visibleEntry).toBeNull();
    expect(s.ctrl.isLive).toBe(true);
    expect(s.ctrl.abortActive()).toBe(true);
    await s.ctrl.flush();
    expect((await s.sessions.listSessions())[0]?.status).toBe('aborted');
    const types = (await s.sessions.listEvents('sess-1')).map((e) => e.type);
    expect(types).toEqual(['displayed', 'blanked', 'paused', 'uncertain', 'uncertain']);
  });

  it('failActive: ERROR wird protokolliert (Status error)', async () => {
    const s = setup();
    const cid = await filled(s);
    await s.ctrl.begin(await s.ctrl.prepare(request(cid, { profile: { ...PROFILE, startDelayMs: 0 } })));
    expect(s.ctrl.failActive(new Error('x'))).toBe(true);
    await s.ctrl.flush();
    expect((await s.sessions.listSessions())[0]?.status).toBe('error');
    expect(s.ctrl.isLive).toBe(true); // wiederaufnehmbar
  });

  it('nach Fehler und Fortsetzung wechselt der Status zurück auf running', async () => {
    const s = setup();
    const cid = await filled(s);
    const active = await s.ctrl.begin(await s.ctrl.prepare(request(cid, { profile: { ...PROFILE, startDelayMs: 0 } })));
    s.ctrl.failActive(new Error('x'));
    active.machine.resume({ kind: 'reconciled' });
    await s.ctrl.flush();
    expect((await s.sessions.listSessions())[0]?.status).toBe('running');
  });

  it('nur eine Sitzung gleichzeitig; nach Ende ist eine neue möglich', async () => {
    const s = setup();
    const cid = await filled(s);
    const p = await s.ctrl.prepare(request(cid, { profile: { ...PROFILE, startDelayMs: 0 } }));
    await s.ctrl.begin(p);
    await expect(s.ctrl.begin(p)).rejects.toMatchObject({ code: 'ERR_PLAYBACK_FAILED' });
    s.sched.advance(10_000);
    s.ctrl.clearFinished();
    expect(s.ctrl.active).toBeNull();
    await expect(s.ctrl.begin(p)).resolves.toBeDefined();
  });

  it('clearFinished verwirft keine laufende Sitzung', async () => {
    const s = setup();
    const cid = await filled(s);
    await s.ctrl.begin(await s.ctrl.prepare(request(cid)));
    s.ctrl.clearFinished();
    expect(s.ctrl.active).not.toBeNull();
  });

  it('Schreibfehler beim Sitzungskopf verhindert den Start (nichts wird angezeigt)', async () => {
    const s = setup();
    const cid = await filled(s);
    const p = await s.ctrl.prepare(request(cid));
    s.db.sessions.put = (() => Promise.reject(new Error('Platte voll'))) as unknown as typeof s.db.sessions.put;
    await expect(s.ctrl.begin(p)).rejects.toMatchObject({ code: 'ERR_STORAGE_WRITE_FAILED' });
    expect(s.ctrl.active).toBeNull();
    expect(s.sched.pending).toBe(0);
  });

  it('Protokoll-Schreibfehler während der Sitzung werden gemeldet, die Anzeige läuft weiter', async () => {
    const s = setup();
    const cid = await filled(s);
    const active = await s.ctrl.begin(await s.ctrl.prepare(request(cid, { profile: { ...PROFILE, startDelayMs: 0 } })));
    s.db.events.bulkPut = (() => Promise.reject(new Error('Schreibfehler'))) as unknown as typeof s.db.events.bulkPut;
    s.sched.advance(500);
    await s.ctrl.flush();
    expect(s.errors.length).toBeGreaterThan(0);
    expect(active.machine.snapshot.state).not.toBe('ERROR');
  });

  it('pauseActive/failActive/abortActive ohne Sitzung sind No-ops', () => {
    const s = setup();
    expect(s.ctrl.pauseActive()).toBe(false);
    expect(s.ctrl.failActive('x')).toBe(false);
    expect(s.ctrl.abortActive()).toBe(false);
  });

  it('Startposition und Standardprofile funktionieren', async () => {
    const s = setup();
    const cid = await filled(s, [[EAN_A, 1], [EAN_B, 1]]);
    const profile = DEFAULT_PROFILES[1];
    if (!profile) throw new Error('Testaufbau');
    const p = await s.ctrl.prepare(request(cid, { profile: { ...profile, startDelayMs: 0 }, startIndex: 1 }));
    const active = await s.ctrl.begin(p);
    expect(active.machine.snapshot.visibleEntry?.value).toBe(EAN_B);
  });
});
