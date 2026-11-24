import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  PlaybackMachine,
  type PlaybackConfig,
  type PlaybackMode,
  type PlaybackSnapshot,
  type PlaybackTiming,
  type Scheduler
} from '../../src/domain/playback-machine';
import type { PlaybackEntry } from '../../src/domain/types';

/** Manueller Scheduler; mit `honorClear=false` bleiben „gelöschte“ Timer scharf (Race-Condition-Simulation). */
class ManualScheduler implements Scheduler {
  now = 0;
  readonly allCallbacks: Array<() => void> = [];
  private readonly timers = new Map<number, { at: number; cb: () => void }>();
  private seq = 0;
  constructor(private readonly honorClear = true) {}

  setTimeout(cb: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, cb });
    this.allCallbacks.push(cb);
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (this.honorClear) this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].cb();
    }
    this.now = target;
  }

  get pending(): number {
    return this.timers.size;
  }
}

const TIMING: PlaybackTiming = { displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 1000 };

function entries(values: string[]): PlaybackEntry[] {
  return values.map((value, i) => ({ id: `e${i + 1}`, sourceItemId: `i${i + 1}`, repetition: 0, value, symbology: 'EAN13' as const }));
}

interface Setup {
  m: PlaybackMachine;
  s: ManualScheduler;
  snaps: PlaybackSnapshot[];
  internalErrors: unknown[];
}

function setup(
  values: string[],
  opts: { mode?: PlaybackMode; timing?: Partial<PlaybackTiming>; honorClear?: boolean; batchSize?: number; startIndex?: number } = {}
): Setup {
  const s = new ManualScheduler(opts.honorClear ?? true);
  const internalErrors: unknown[] = [];
  const config: PlaybackConfig = {
    sessionId: 'S1',
    entries: entries(values),
    mode: opts.mode ?? 'auto',
    timing: { ...TIMING, ...opts.timing },
    scheduler: s,
    now: () => '2026-11-24T10:00:00.000Z',
    onInternalError: (e) => internalErrors.push(e),
    ...(opts.batchSize === undefined ? {} : { batchSize: opts.batchSize }),
    ...(opts.startIndex === undefined ? {} : { startIndex: opts.startIndex })
  };
  const m = new PlaybackMachine(config);
  const snaps: PlaybackSnapshot[] = [];
  m.subscribe((x) => snaps.push(x));
  return { m, s, snaps, internalErrors };
}

const types = (m: PlaybackMachine): string[] => m.events.map((e) => e.type);
const shown = (m: PlaybackMachine): string[] => m.events.filter((e) => e.type === 'displayed').map((e) => e.entryId ?? '');

afterEach(() => {
  vi.useRealTimers();
});

describe('Konfiguration', () => {
  const base = (over: Partial<PlaybackConfig>): PlaybackConfig => ({
    sessionId: 'S',
    entries: entries(['1']),
    mode: 'auto',
    timing: TIMING,
    scheduler: new ManualScheduler(),
    ...over
  });

  it.each([
    ['leere sessionId', { sessionId: '' }],
    ['unbekannter Modus', { mode: 'turbo' as unknown as PlaybackMode }],
    ['displayMs 0', { timing: { ...TIMING, displayMs: 0 } }],
    ['displayMs NaN', { timing: { ...TIMING, displayMs: Number.NaN } }],
    ['blankMs negativ', { timing: { ...TIMING, blankMs: -1 } }],
    ['identicalBlankMs negativ', { timing: { ...TIMING, identicalBlankMs: -1 } }],
    ['startDelayMs unendlich', { timing: { ...TIMING, startDelayMs: Infinity } }],
    ['batch ohne batchSize', { mode: 'batch' as const }],
    ['batchSize 0', { mode: 'batch' as const, batchSize: 0 }],
    ['batchSize 1.5', { mode: 'batch' as const, batchSize: 1.5 }],
    ['startIndex negativ', { startIndex: -1 }],
    ['startIndex zu groß', { startIndex: 2 }]
  ])('lehnt ungültige Konfiguration ab: %s', (_name, over) => {
    expect(() => new PlaybackMachine(base(over))).toThrow(AppError);
  });

  it('akzeptiert startDelay 0 und blank 0', () => {
    expect(() => new PlaybackMachine(base({ timing: { ...TIMING, startDelayMs: 0, blankMs: 0, identicalBlankMs: 0 } }))).not.toThrow();
  });
});

describe('Validierung beim Start', () => {
  it('leere Liste → ERROR, nie eine Anzeige', () => {
    const { m } = setup([]);
    expect(m.start()).toBe(true);
    expect(m.snapshot.state).toBe('ERROR');
    expect(m.snapshot.errorCode).toBe('ERR_PLAYBACK_FAILED');
    expect(m.snapshot.visibleEntry).toBeNull();
    expect(shown(m)).toEqual([]);
    expect(m.resume({ kind: 'reconciled' })).toBe(false);
  });

  it('Eintrag ohne Wert / doppelte ID / unbekannte Symbologie → ERROR', () => {
    for (const bad of [
      [{ id: 'a', sourceItemId: 'x', repetition: 0, value: '', symbology: 'EAN13' as const }],
      [
        { id: 'a', sourceItemId: 'x', repetition: 0, value: '1', symbology: 'EAN13' as const },
        { id: 'a', sourceItemId: 'x', repetition: 1, value: '1', symbology: 'EAN13' as const }
      ],
      [{ id: 'a', sourceItemId: 'x', repetition: 0, value: '1', symbology: 'DATAMATRIX' as unknown as 'EAN13' }]
    ]) {
      const s = new ManualScheduler();
      const m = new PlaybackMachine({ sessionId: 'S', entries: bad, mode: 'auto', timing: TIMING, scheduler: s });
      m.start();
      expect(m.snapshot.state).toBe('ERROR');
      expect(s.pending).toBe(0);
    }
  });

  it('start nur einmal aus IDLE', () => {
    const { m } = setup(['1']);
    expect(m.start()).toBe(true);
    expect(m.start()).toBe(false);
  });
});

describe('Automatik – Ablauf und Zeiten', () => {
  it('Countdown → Anzeige → Blank → Anzeige → Ende, exakt nach Profil', () => {
    const { m, s } = setup(['1', '2']);
    expect(m.snapshot.state).toBe('IDLE');
    m.start();
    expect(m.snapshot.state).toBe('COUNTDOWN');
    expect(m.snapshot.visibleEntry).toBeNull();
    s.advance(999);
    expect(m.snapshot.state).toBe('COUNTDOWN');
    s.advance(1);
    expect(m.snapshot.state).toBe('SHOWING');
    expect(m.snapshot.visibleEntry?.id).toBe('e1');
    s.advance(499);
    expect(m.snapshot.state).toBe('SHOWING');
    s.advance(1);
    expect(m.snapshot.state).toBe('BLANKING');
    expect(m.snapshot.visibleEntry).toBeNull();
    s.advance(149);
    expect(m.snapshot.state).toBe('BLANKING');
    s.advance(1);
    expect(m.snapshot.visibleEntry?.id).toBe('e2');
    s.advance(500);
    expect(m.snapshot.state).toBe('FINISHED');
    expect(m.snapshot.finishReason).toBe('completed');
    expect(m.snapshot.visibleEntry).toBeNull();
    expect(s.pending).toBe(0);
  });

  it('Startverzögerung 0 zeigt sofort', () => {
    const { m } = setup(['1'], { timing: { startDelayMs: 0 } });
    m.start();
    expect(m.snapshot.state).toBe('SHOWING');
  });

  it('getrennte Blank-Zeiten: identischer Folgecode wartet länger', () => {
    const { m, s } = setup(['A', 'A', 'B'], { timing: { startDelayMs: 0 } });
    m.start(); // t=0 e1
    s.advance(500); // blank (identisch) bis t=900
    expect(m.snapshot.state).toBe('BLANKING');
    s.advance(399);
    expect(m.snapshot.state).toBe('BLANKING');
    s.advance(1); // t=900 e2
    expect(m.snapshot.visibleEntry?.id).toBe('e2');
    s.advance(500); // blank (verschieden) 150
    s.advance(149);
    expect(m.snapshot.state).toBe('BLANKING');
    s.advance(1);
    expect(m.snapshot.visibleEntry?.id).toBe('e3');
  });

  it('identische Folgeartikel nur bei gleicher Symbologie und gleichem Wert', () => {
    const s = new ManualScheduler();
    const list: PlaybackEntry[] = [
      { id: 'a', sourceItemId: 'a', repetition: 0, value: '1', symbology: 'EAN13' },
      { id: 'b', sourceItemId: 'b', repetition: 0, value: '1', symbology: 'QRCode' }
    ];
    const m = new PlaybackMachine({ sessionId: 'S', entries: list, mode: 'auto', timing: { ...TIMING, startDelayMs: 0 }, scheduler: s });
    m.start();
    s.advance(500 + 150); // normale Blankzeit reicht
    expect(m.snapshot.visibleEntry?.id).toBe('b');
  });

  it('nie Überblendung: zwischen zwei Symbolen liegt immer ein leerer Zustand; Symbol nur in SHOWING', () => {
    const { m, s, snaps } = setup(['A', 'A', 'B', 'C'], { timing: { startDelayMs: 0 } });
    m.start();
    s.advance(10_000);
    for (const snap of snaps) {
      expect(snap.visibleEntry !== null).toBe(snap.state === 'SHOWING');
    }
    for (let i = 1; i < snaps.length; i++) {
      const a = snaps[i - 1];
      const b = snaps[i];
      if (a?.state === 'SHOWING' && b?.state === 'SHOWING') expect(b.visibleEntry?.id).toBe(a.visibleEntry?.id);
    }
    expect(shown(m)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('Ereignisprotokoll: displayed/blanked abwechselnd, Quelle player, IDs und Zeitstempel', () => {
    const { m, s } = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    m.start();
    s.advance(2000);
    expect(types(m)).toEqual(['displayed', 'blanked', 'displayed', 'blanked']);
    expect(m.events.every((e) => e.evidence === 'player' && e.sessionId === 'S1')).toBe(true);
    expect(m.events.map((e) => e.id)).toEqual(['S1-1', 'S1-2', 'S1-3', 'S1-4']);
    expect(m.events[0]?.timestamp).toBe('2026-11-24T10:00:00.000Z');
  });

  it('Einzel-Element-Liste', () => {
    const { m, s } = setup(['A'], { timing: { startDelayMs: 0 } });
    m.start();
    s.advance(500);
    expect(m.snapshot.state).toBe('FINISHED');
  });

  it('startIndex setzt mitten in der Liste ein; startIndex = Länge endet sofort', () => {
    const a = setup(['A', 'B', 'C'], { timing: { startDelayMs: 0 }, startIndex: 2 });
    a.m.start();
    expect(a.m.snapshot.visibleEntry?.id).toBe('e3');
    const b = setup(['A'], { startIndex: 1 });
    b.m.start();
    expect(b.m.snapshot.state).toBe('FINISHED');
  });
});

describe('F-15: Anzeige ist nie eine Buchung', () => {
  it('Automatik erzeugt nie manual-confirmed oder pos-*; unklarer Bereich bleibt am Ende sichtbar', () => {
    const { m, s } = setup(['A', 'B', 'C'], { timing: { startDelayMs: 0 } });
    m.start();
    s.advance(10_000);
    const t = new Set(types(m));
    expect(t.has('manual-confirmed')).toBe(false);
    expect(t.has('pos-accepted')).toBe(false);
    expect(t.has('pos-rejected')).toBe(false);
    expect(m.snapshot.lastConfirmedIndex).toBeNull();
    expect(m.snapshot.uncertainRange).toEqual({ from: 0, to: 2 });
  });
});

describe('Pause – sofortiges Ausblenden in jeder Phase', () => {
  const phases: Array<[string, (x: Setup) => void]> = [
    ['COUNTDOWN', () => undefined],
    ['SHOWING', (x) => x.s.advance(1000 + 100)],
    ['BLANKING', (x) => x.s.advance(1000 + 500 + 10)]
  ];

  it.each(phases)('Pause in %s: sofort leer, danach keinerlei neue Ausgabe (Scheduler löscht)', (name, advance) => {
    const x = setup(['A', 'B', 'C']);
    x.m.start();
    advance(x);
    expect(x.m.snapshot.state).toBe(name);
    const eventsBefore = x.m.events.length;
    expect(x.m.pause('operator')).toBe(true);
    expect(x.m.snapshot.state).toBe('PAUSED');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    x.s.advance(60_000);
    expect(x.m.snapshot.visibleEntry).toBeNull();
    expect(x.m.snapshot.state).toBe('PAUSED');
    expect(shown(x.m).length).toBeLessThanOrEqual(2);
    expect(x.m.events.filter((e) => e.type === 'displayed').length).toBe(x.m.events.slice(0, eventsBefore).filter((e) => e.type === 'displayed').length);
  });

  it.each(phases)('Pause in %s: späte Timer bei Scheduler, der clearTimeout ignoriert, bleiben wirkungslos', (name, advance) => {
    const x = setup(['A', 'B', 'C'], { honorClear: false });
    x.m.start();
    advance(x);
    expect(x.m.snapshot.state).toBe(name);
    x.m.pause('operator');
    const before = x.m.events.length;
    const genBefore = x.m.snapshot.generation;
    x.s.advance(60_000); // alle „gelöschten“ Timer feuern trotzdem
    for (const cb of [...x.s.allCallbacks]) cb(); // und nochmals manuell
    expect(x.m.snapshot.state).toBe('PAUSED');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    expect(x.m.events).toHaveLength(before);
    expect(x.m.snapshot.generation).toBe(genBefore);
  });

  it('Pause in WAITING_CONFIRMATION (manuell)', () => {
    const x = setup(['A', 'B'], { mode: 'manual', timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(500);
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION');
    expect(x.m.pause('operator')).toBe(true);
    expect(x.m.snapshot.state).toBe('PAUSED');
  });

  it('Pause während SHOWING: Reihenfolge blanked → paused → uncertain, Bereich 0..0, Quelle operator', () => {
    const x = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(100);
    x.m.pause('operator', 'Kasse meldet Fehler');
    expect(types(x.m)).toEqual(['displayed', 'blanked', 'paused', 'uncertain']);
    expect(x.m.events[2]?.evidence).toBe('operator');
    expect(x.m.events[2]?.detail).toBe('Kasse meldet Fehler');
    expect(x.m.snapshot.uncertainRange).toEqual({ from: 0, to: 0 });
    expect(x.m.snapshot.pauseSource).toBe('operator');
  });

  it('Hintergrundwechsel (Tab-Wechsel) pausiert mit Evidenz player; Sensor mit Evidenz sensor', () => {
    const a = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    a.m.start();
    a.m.pause('background');
    expect(a.m.events.find((e) => e.type === 'paused')?.evidence).toBe('player');
    expect(a.m.snapshot.pauseSource).toBe('background');
    const b = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    b.m.start();
    b.m.pause('sensor');
    expect(b.m.events.find((e) => e.type === 'paused')?.evidence).toBe('sensor');
  });

  it('Pause ist nur in aktiven Zuständen möglich und idempotent', () => {
    const x = setup(['A']);
    expect(x.m.pause()).toBe(false); // IDLE
    x.m.start();
    expect(x.m.pause()).toBe(true);
    expect(x.m.pause()).toBe(false); // schon PAUSED
    x.m.abort();
    expect(x.m.pause()).toBe(false); // FINISHED
  });

  it('Pause vor der ersten Anzeige hat keinen unklaren Bereich', () => {
    const x = setup(['A']);
    x.m.start();
    x.m.pause();
    expect(x.m.snapshot.uncertainRange).toBeNull();
    expect(types(x.m)).toEqual(['paused']);
  });
});

describe('Fortsetzen nach Pause', () => {
  function pausedAfterThree(): Setup {
    const x = setup(['A', 'B', 'C', 'D', 'E'], { timing: { startDelayMs: 100 } });
    x.m.start();
    // e1 @100..600, blank, e2 @750..1250, blank, e3 @1400..
    x.s.advance(1500);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e3');
    x.m.pause('operator');
    return x;
  }

  it('abgeglichen: bestätigt manuell alles bis zur letzten Anzeige, holt nichts nach, startet mit Countdown', () => {
    const x = pausedAfterThree();
    expect(x.m.snapshot.uncertainRange).toEqual({ from: 0, to: 2 });
    expect(x.m.resume({ kind: 'reconciled' })).toBe(true);
    expect(x.m.snapshot.state).toBe('COUNTDOWN');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    const confirmed = x.m.events.filter((e) => e.type === 'manual-confirmed');
    expect(confirmed.map((e) => e.entryId)).toEqual(['e1', 'e2', 'e3']);
    expect(confirmed.every((e) => e.evidence === 'operator')).toBe(true);
    expect(x.m.snapshot.lastConfirmedIndex).toBe(2);
    expect(x.m.snapshot.uncertainRange).toBeNull();
    x.s.advance(100);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e4'); // nicht e3 und nichts übersprungen
    expect(x.m.snapshot.doubleBookingRisk).toBe(false);
  });

  it('wiederholen: setzt bei der ersten unbestätigten Position an und warnt vor Doppelbuchung', () => {
    const x = pausedAfterThree();
    expect(x.m.resume({ kind: 'repeat' })).toBe(true);
    expect(x.m.snapshot.doubleBookingRisk).toBe(true); // schon im Countdown sichtbar
    x.s.advance(100);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e1');
    expect(x.m.snapshot.doubleBookingRisk).toBe(true);
    expect(x.m.snapshot.uncertainRange).toEqual({ from: 0, to: 2 });
    expect(x.m.events.some((e) => e.type === 'displayed' && e.detail?.includes('erneut'))).toBe(true);
  });

  it('überspringen: macht ohne Bestätigung nach der letzten Anzeige weiter und protokolliert', () => {
    const x = pausedAfterThree();
    expect(x.m.resume({ kind: 'skip' })).toBe(true);
    x.s.advance(100);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e4');
    expect(x.m.events.some((e) => e.type === 'manual-confirmed')).toBe(false);
    expect(x.m.events.some((e) => e.type === 'uncertain' && e.evidence === 'operator' && e.detail?.includes('übersprungen'))).toBe(true);
    expect(x.m.snapshot.lastConfirmedIndex).toBeNull();
  });

  it('ab Position: gültige Position, ungültige wird abgelehnt (Zustand bleibt PAUSED)', () => {
    const x = pausedAfterThree();
    for (const bad of [-1, 6, 1.5, Number.NaN]) {
      expect(x.m.resume({ kind: 'from-position', index: bad })).toBe(false);
      expect(x.m.snapshot.state).toBe('PAUSED');
    }
    expect(x.m.resume({ kind: 'from-position', index: 4 })).toBe(true);
    x.s.advance(100);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e5');
    expect(x.m.snapshot.doubleBookingRisk).toBe(false);
  });

  it('ab Position = Listenende beendet die Sitzung', () => {
    const x = pausedAfterThree();
    expect(x.m.resume({ kind: 'from-position', index: 5 })).toBe(true);
    expect(x.m.snapshot.state).toBe('FINISHED');
  });

  it('abgeglichen, wenn zuletzt die letzte Position lief: beendet', () => {
    const x = setup(['A'], { timing: { startDelayMs: 0 } });
    x.m.start();
    x.m.pause();
    x.m.resume({ kind: 'reconciled' });
    expect(x.m.snapshot.state).toBe('FINISHED');
  });

  it('resume nur aus PAUSED/ERROR', () => {
    const x = setup(['A', 'B']);
    expect(x.m.resume({ kind: 'repeat' })).toBe(false); // IDLE
    x.m.start();
    expect(x.m.resume({ kind: 'repeat' })).toBe(false); // COUNTDOWN
  });

  it('Generation steigt bei jeder Unterbrechung strikt; alte Timer nach Pause→Resume wirken nicht (Scheduler ignoriert clear)', () => {
    const x = setup(['A', 'B', 'C'], { honorClear: false, timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(100);
    const g0 = x.m.snapshot.generation;
    x.m.pause();
    const g1 = x.m.snapshot.generation;
    x.m.resume({ kind: 'repeat' });
    const g2 = x.m.snapshot.generation;
    expect(g1).toBeGreaterThan(g0);
    expect(g2).toBeGreaterThan(g1);
    // Der Timer von vor der Pause (Anzeigeende bei t=500) darf die neue Anzeige nicht vorzeitig beenden:
    expect(x.m.snapshot.state).toBe('SHOWING');
    x.s.advance(450); // t=550: alter Timer feuert, neuer läuft noch bis t=600
    expect(x.m.snapshot.state).toBe('SHOWING');
    x.s.advance(100);
    expect(x.m.snapshot.state).toBe('BLANKING');
  });
});

describe('Manueller Modus', () => {
  it('zeigt eine Position, blendet aus, wartet auf Bestätigung; Bestätigung ist Entscheidung der Bedienperson', () => {
    const x = setup(['A', 'B'], { mode: 'manual', timing: { startDelayMs: 0 } });
    x.m.start();
    expect(x.m.snapshot.visibleEntry?.id).toBe('e1');
    x.s.advance(500);
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    x.s.advance(60_000);
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION'); // läuft nie von selbst weiter
    expect(x.m.confirm()).toBe(true);
    expect(x.m.snapshot.state).toBe('BLANKING');
    expect(x.m.snapshot.lastConfirmedIndex).toBe(0);
    expect(x.m.events.filter((e) => e.type === 'manual-confirmed').map((e) => e.evidence)).toEqual(['operator']);
    x.s.advance(150);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e2');
    x.s.advance(500);
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION');
    x.m.confirm();
    expect(x.m.snapshot.state).toBe('FINISHED');
    expect(x.m.snapshot.finishReason).toBe('completed');
    expect(x.m.snapshot.uncertainRange).toBeNull();
  });

  it('identische Folgecodes: auch nach Bestätigung gilt die längere Leerzeit', () => {
    const x = setup(['A', 'A'], { mode: 'manual', timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(500);
    x.m.confirm();
    x.s.advance(399);
    expect(x.m.snapshot.state).toBe('BLANKING');
    x.s.advance(1);
    expect(x.m.snapshot.visibleEntry?.id).toBe('e2');
  });

  it('confirm außerhalb von WAITING_CONFIRMATION wird abgelehnt', () => {
    const x = setup(['A', 'B'], { mode: 'manual', timing: { startDelayMs: 0 } });
    expect(x.m.confirm()).toBe(false);
    x.m.start();
    expect(x.m.confirm()).toBe(false); // SHOWING
    x.m.pause();
    expect(x.m.confirm()).toBe(false);
  });
});

describe('Kleinstapel', () => {
  it('pausiert nach N Codes zur Bestätigung, auch für den Rest am Listenende', () => {
    const x = setup(['A', 'B', 'C', 'D', 'E'], { mode: 'batch', batchSize: 2, timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(500 + 150 + 500); // e1, blank, e2 → danach warten
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION');
    expect(shown(x.m)).toEqual(['e1', 'e2']);
    x.s.advance(60_000);
    expect(shown(x.m)).toEqual(['e1', 'e2']);
    x.m.confirm();
    expect(x.m.events.filter((e) => e.type === 'manual-confirmed').map((e) => e.entryId)).toEqual(['e1', 'e2']);
    x.s.advance(150 + 500 + 150 + 500);
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION');
    expect(shown(x.m)).toEqual(['e1', 'e2', 'e3', 'e4']);
    x.m.confirm();
    x.s.advance(150 + 500);
    expect(x.m.snapshot.state).toBe('WAITING_CONFIRMATION'); // Restbatch (1 Code)
    x.m.confirm();
    expect(x.m.snapshot.state).toBe('FINISHED');
    expect(x.m.snapshot.lastConfirmedIndex).toBe(4);
  });

  it('Pause im Stapel: unklarer Bereich nur seit der letzten Bestätigung', () => {
    const x = setup(['A', 'B', 'C', 'D'], { mode: 'batch', batchSize: 2, timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(1150);
    x.m.confirm();
    x.s.advance(150 + 100); // e3 läuft
    x.m.pause();
    expect(x.m.snapshot.uncertainRange).toEqual({ from: 2, to: 2 });
    expect(x.m.snapshot.lastConfirmedIndex).toBe(1);
  });
});

describe('Fehler (ERROR)', () => {
  it('fail während SHOWING blendet sofort aus und setzt Fehlercode + Unsicherheitsbereich', () => {
    const x = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    x.m.start();
    expect(x.m.fail(new Error('boom'))).toBe(true);
    expect(x.m.snapshot.state).toBe('ERROR');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    expect(x.m.snapshot.errorCode).toBe('ERR_PLAYBACK_FAILED');
    expect(x.m.snapshot.uncertainRange).toEqual({ from: 0, to: 0 });
    expect(types(x.m)).toEqual(['displayed', 'blanked', 'uncertain', 'uncertain']);
    x.s.advance(60_000);
    expect(x.m.snapshot.visibleEntry).toBeNull();
    expect(x.s.pending).toBe(0);
  });

  it('AppError-Code bleibt erhalten; Details mit Barcode-Werten gelangen nicht ins Protokoll', () => {
    const x = setup(['4006381333931'], { timing: { startDelayMs: 0 } });
    x.m.start();
    x.m.fail(new AppError('ERR_WASM_LOAD_FAILED', { details: 'Wert 4006381333931 kaputt' }));
    expect(x.m.snapshot.errorCode).toBe('ERR_WASM_LOAD_FAILED');
    expect(JSON.stringify(x.m.events)).not.toContain('4006381333931');
  });

  it('fail nur in aktiven Zuständen; zweimal fail ist ein No-op', () => {
    const x = setup(['A']);
    expect(x.m.fail('x')).toBe(false); // IDLE
    x.m.start();
    expect(x.m.fail('x')).toBe(true);
    expect(x.m.fail('y')).toBe(false);
  });

  it('aus ERROR kann nach Entscheidung der Bedienperson fortgesetzt werden', () => {
    const x = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    x.m.start();
    x.s.advance(100);
    x.m.fail('x');
    expect(x.m.resume({ kind: 'reconciled' })).toBe(true);
    expect(x.m.snapshot.errorCode).toBeNull();
    expect(x.m.snapshot.visibleEntry?.id).toBe('e2');
  });

  it('fail aus PAUSED und WAITING_CONFIRMATION', () => {
    const a = setup(['A', 'B']);
    a.m.start();
    a.m.pause();
    expect(a.m.fail('x')).toBe(true);
    expect(a.m.snapshot.state).toBe('ERROR');
    const b = setup(['A', 'B'], { mode: 'manual', timing: { startDelayMs: 0 } });
    b.m.start();
    b.s.advance(500);
    expect(b.m.fail('x')).toBe(true);
  });

  it('werfender Listener (z. B. UI-Renderfehler) führt zu sicherem ERROR und wird gemeldet', () => {
    const x = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    let calls = 0;
    x.m.subscribe((snap) => {
      calls++;
      if (snap.state === 'SHOWING') throw new TypeError('render kaputt');
    });
    x.m.start();
    expect(x.m.snapshot.state).toBe('ERROR');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    expect(x.internalErrors).toHaveLength(1);
    expect(x.internalErrors[0]).toBeInstanceOf(TypeError);
    expect(calls).toBeGreaterThanOrEqual(2); // ERROR-Zustand wurde nachgemeldet
    expect(x.snaps.at(-1)?.state).toBe('ERROR');
  });

  it('Listener, der auch im ERROR wirft, erzeugt keine Endlosschleife', () => {
    const x = setup(['A'], { timing: { startDelayMs: 0 } });
    x.m.subscribe(() => {
      throw new Error('immer kaputt');
    });
    expect(() => x.m.start()).not.toThrow();
    expect(x.m.snapshot.state).toBe('ERROR');
  });
});

describe('Abbruch', () => {
  it('abort: sofort leer, FINISHED(aborted), Unsicherheitsbereich im Protokoll, keine späteren Ereignisse', () => {
    const x = setup(['A', 'B'], { timing: { startDelayMs: 0 }, honorClear: false });
    x.m.start();
    x.s.advance(100);
    expect(x.m.abort()).toBe(true);
    expect(x.m.snapshot.state).toBe('FINISHED');
    expect(x.m.snapshot.finishReason).toBe('aborted');
    expect(x.m.snapshot.visibleEntry).toBeNull();
    const n = x.m.events.length;
    x.s.advance(60_000);
    expect(x.m.events).toHaveLength(n);
    expect(types(x.m)).toContain('uncertain');
    expect(x.m.abort()).toBe(false);
  });

  it('abort in IDLE ist ein No-op', () => {
    expect(setup(['A']).m.abort()).toBe(false);
  });
});

describe('Eingefrorener Sitzungs-Snapshot', () => {
  it('spätere Änderungen an der Quellliste beeinflussen die Wiedergabe nicht', () => {
    const list = entries(['A', 'B']);
    const s = new ManualScheduler();
    const m = new PlaybackMachine({ sessionId: 'S', entries: list, mode: 'auto', timing: { ...TIMING, startDelayMs: 0 }, scheduler: s });
    const first = list[0];
    if (!first) throw new Error('Testaufbau');
    first.value = 'MANIPULIERT';
    list.reverse();
    list.push({ id: 'neu', sourceItemId: 'x', repetition: 0, value: 'Z', symbology: 'EAN13' });
    m.start();
    expect(m.snapshot.visibleEntry?.value).toBe('A');
    s.advance(650);
    expect(m.snapshot.visibleEntry?.value).toBe('B');
    s.advance(500);
    expect(m.snapshot.state).toBe('FINISHED');
    expect(m.snapshot.totalEntries).toBe(2);
  });

  it('Einträge und Liste sind eingefroren', () => {
    const { m } = setup(['A']);
    expect(Object.isFrozen(m.frozenEntries)).toBe(true);
    expect(Object.isFrozen(m.frozenEntries[0])).toBe(true);
    expect(Object.isFrozen(m.snapshot)).toBe(true);
  });
});

describe('Listener', () => {
  it('genau eine Benachrichtigung pro Operation; Abmelden funktioniert', () => {
    const x = setup(['A', 'B'], { timing: { startDelayMs: 0 } });
    const seen: string[] = [];
    const off = x.m.subscribe((snap) => seen.push(snap.state));
    x.snaps.length = 0;
    x.m.start();
    expect(x.snaps.map((s) => s.state)).toEqual(['SHOWING']);
    x.s.advance(500);
    expect(x.snaps.map((s) => s.state)).toEqual(['SHOWING', 'BLANKING']);
    off();
    x.s.advance(150);
    expect(seen).toEqual(['SHOWING', 'BLANKING']);
  });
});

describe('Integration mit echten (Fake-)Timern', () => {
  it('läuft mit vi.useFakeTimers und setTimeout-Scheduler', () => {
    vi.useFakeTimers();
    const sched: Scheduler = {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => {
        clearTimeout(h as ReturnType<typeof setTimeout>);
      }
    };
    const m = new PlaybackMachine({
      sessionId: 'F',
      entries: entries(['A', 'B']),
      mode: 'auto',
      timing: { displayMs: 300, blankMs: 100, identicalBlankMs: 300, startDelayMs: 200 },
      scheduler: sched
    });
    m.start();
    vi.advanceTimersByTime(200);
    expect(m.snapshot.visibleEntry?.id).toBe('e1');
    m.pause();
    vi.advanceTimersByTime(10_000);
    expect(m.snapshot.visibleEntry).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    m.resume({ kind: 'reconciled' });
    vi.advanceTimersByTime(200);
    expect(m.snapshot.visibleEntry?.id).toBe('e2');
    vi.advanceTimersByTime(300);
    expect(m.snapshot.state).toBe('FINISHED');
  });
});
