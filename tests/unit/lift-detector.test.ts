import { describe, expect, it, vi } from 'vitest';
import { LiftDetector, type MotionEventLike, type MotionTarget } from '../../src/adapters/sensors/lift-detector';
import { ManualScheduler } from '../helpers/scheduler';

class FakeWindow implements MotionTarget {
  readonly listeners = new Set<(e: MotionEventLike) => void>();
  addEventListener(_t: 'devicemotion', l: (e: MotionEventLike) => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: 'devicemotion', l: (e: MotionEventLike) => void): void {
    this.listeners.delete(l);
  }
  emit(x: number | null, y: number | null, z: number | null): void {
    for (const l of [...this.listeners]) l({ accelerationIncludingGravity: { x, y, z } });
  }
  emitEmpty(): void {
    for (const l of [...this.listeners]) l({ accelerationIncludingGravity: null });
  }
}

function setup(over: { permission?: () => Promise<'granted' | 'denied'>; target?: FakeWindow | undefined } = {}): { det: LiftDetector; win: FakeWindow; sched: ManualScheduler; triggers: string[]; clock: { t: number } } {
  const win = over.target ?? new FakeWindow();
  const sched = new ManualScheduler();
  const triggers: string[] = [];
  const clock = { t: 0 };
  const det = new LiftDetector({
    target: 'target' in over ? over.target : win,
    onTrigger: (r) => triggers.push(r),
    now: () => clock.t,
    timers: sched,
    sensorTimeoutMs: 2000,
    ...(over.permission ? { requestPermission: over.permission } : {})
  });
  return { det, win, sched, triggers, clock };
}

/** Sendet Ruhelage über die Einschwingzeit. */
function settle(s: ReturnType<typeof setup>): void {
  for (let t = 0; t <= 800; t += 40) {
    s.clock.t = t;
    s.win.emit(0, 0, 9.81);
    s.sched.advance(40);
  }
}

describe('LiftDetector', () => {
  it('nicht unterstützt ohne Ereignisquelle: enable false, arm wirkungslos', async () => {
    const s = setup({ target: undefined });
    expect(s.det.supported).toBe(false);
    expect(await s.det.enable()).toBe(false);
    s.det.arm();
    expect(s.det.armed).toBe(false);
  });

  it('ohne enable() ist arm() wirkungslos (standardmäßig aus)', () => {
    const s = setup();
    s.det.arm();
    expect(s.det.armed).toBe(false);
    expect(s.win.listeners.size).toBe(0);
  });

  it('enable ohne Berechtigungsanfrage (Android): sofort erlaubt', async () => {
    const s = setup();
    expect(await s.det.enable()).toBe(true);
  });

  it('Berechtigung (iOS-Stil): granted → true, denied/Fehler → false und bleibt aus', async () => {
    const granted = setup({ permission: () => Promise.resolve('granted') });
    expect(await granted.det.enable()).toBe(true);
    const denied = setup({ permission: () => Promise.resolve('denied') });
    expect(await denied.det.enable()).toBe(false);
    denied.det.arm();
    expect(denied.det.armed).toBe(false);
    const broken = setup({ permission: () => Promise.reject(new Error('keine Nutzeraktion')) });
    expect(await broken.det.enable()).toBe(false);
  });

  it('arm registriert den Listener, disarm entfernt ihn (idempotent)', async () => {
    const s = setup();
    await s.det.enable();
    s.det.arm();
    s.det.arm();
    expect(s.det.armed).toBe(true);
    expect(s.win.listeners.size).toBe(1);
    s.det.disarm();
    s.det.disarm();
    expect(s.win.listeners.size).toBe(0);
    expect(s.sched.pending).toBe(0);
  });

  it('Anheben nach der Ruhelage löst genau einmal „tilt/shake“ aus und schaltet unscharf (nur pausieren)', async () => {
    const s = setup();
    await s.det.enable();
    s.det.arm();
    settle(s);
    expect(s.triggers).toEqual([]);
    for (let i = 0; i < 3; i++) {
      s.clock.t += 20;
      s.win.emit(0, 0, 14);
    }
    expect(s.triggers).toEqual(['shake']);
    expect(s.det.armed).toBe(false);
    s.win.emit(0, 0, 14); // nach dem Auslösen kein Listener mehr
    expect(s.triggers).toEqual(['shake']);
  });

  it('nach erneutem arm() (bewusste Wiederaufnahme) wird eine neue Ruhelage gemessen', async () => {
    const s = setup();
    await s.det.enable();
    s.det.arm();
    settle(s);
    for (let i = 0; i < 3; i++) {
      s.clock.t += 20;
      s.win.emit(0, 0, 14);
    }
    s.det.arm();
    expect(s.det.armed).toBe(true);
    s.clock.t = 5000;
    for (let t = 0; t <= 800; t += 40) {
      s.clock.t += 40;
      s.win.emit(0, 0, 14); // andere Lage = neue Basis, löst nicht aus
    }
    for (let i = 0; i < 5; i++) {
      s.clock.t += 20;
      s.win.emit(0, 0, 14); // weiterhin ruhig in der neuen Lage
    }
    expect(s.triggers).toEqual(['shake']);
  });

  it('Sensorverlust: keine Daten für 2 s → sensor-lost (konservativ pausieren)', async () => {
    const s = setup();
    await s.det.enable();
    s.det.arm();
    s.sched.advance(1999);
    expect(s.triggers).toEqual([]);
    s.sched.advance(1);
    expect(s.triggers).toEqual(['sensor-lost']);
    expect(s.det.armed).toBe(false);
  });

  it('Messwerte halten den Watchdog wach; Ereignisse ohne Daten (null) tun das nicht', async () => {
    const s = setup();
    await s.det.enable();
    s.det.arm();
    for (let i = 0; i < 10; i++) {
      s.clock.t += 500;
      s.win.emit(0, 0, 9.81);
      s.sched.advance(500);
    }
    expect(s.triggers).toEqual([]);
    for (let i = 0; i < 10; i++) {
      s.win.emitEmpty();
      s.win.emit(null, 0, 9.81);
      s.sched.advance(300);
    }
    expect(s.triggers).toEqual(['sensor-lost']);
  });

  it('disable() schaltet alles ab; ein Timer feuert danach nie', async () => {
    const s = setup();
    await s.det.enable();
    s.det.arm();
    s.det.disable();
    s.sched.advance(10_000);
    expect(s.triggers).toEqual([]);
    s.det.arm();
    expect(s.det.armed).toBe(false);
  });

  it('der Adapter kann nur melden: onTrigger ist der einzige Ausgang (kein Fortsetzen/Bestätigen)', async () => {
    const onTrigger = vi.fn();
    const win = new FakeWindow();
    const det = new LiftDetector({ target: win, onTrigger, timers: new ManualScheduler() });
    await det.enable();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(det)).filter((n) => n !== 'constructor');
    expect(surface.some((n) => /resume|confirm|accept|book/i.test(n))).toBe(false);
  });
});
