import { describe, expect, it, vi } from 'vitest';
import { installLifecycle, type Listenable, type LifecycleDeps } from '../../src/app/lifecycle';

class FakeTarget implements Listenable {
  readonly map = new Map<string, Set<(e: Event) => void>>();
  addEventListener(type: string, l: (e: Event) => void): void {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)?.add(l);
  }
  removeEventListener(type: string, l: (e: Event) => void): void {
    this.map.get(type)?.delete(l);
  }
  emit(type: string, event: object = {}): void {
    for (const l of [...(this.map.get(type) ?? [])]) l(event as Event);
  }
  count(): number {
    return [...this.map.values()].reduce((n, s) => n + s.size, 0);
  }
}

function setup(): { win: FakeTarget; doc: FakeTarget & { visibilityState: string }; calls: string[]; deps: LifecycleDeps; off: () => void } {
  const win = new FakeTarget();
  const doc = Object.assign(new FakeTarget(), { visibilityState: 'visible' });
  const calls: string[] = [];
  const deps: LifecycleDeps = {
    win,
    doc,
    failActive: vi.fn(() => {
      calls.push('fail');
      return true;
    }),
    pauseActive: vi.fn((source: string) => {
      calls.push(`pause:${source}`);
      return true;
    }),
    report: vi.fn(() => {
      calls.push('report');
    }),
    reacquireWakeLock: vi.fn(() => {
      calls.push('wake');
      return Promise.resolve(true);
    })
  };
  return { win, doc, calls, deps, off: installLifecycle(deps) };
}

describe('Globale Fehlerabsicherung', () => {
  it('window.error: ZUERST Symbol ausblenden (failActive), DANN melden', () => {
    const { win, calls } = setup();
    win.emit('error', { error: new TypeError('kaputt') });
    expect(calls).toEqual(['fail', 'report']);
  });

  it('unhandledrejection mit Grund und ohne Grund', () => {
    const { win, calls, deps } = setup();
    win.emit('unhandledrejection', { reason: new Error('abgelehnt') });
    win.emit('unhandledrejection', {});
    expect(calls).toEqual(['fail', 'report', 'fail', 'report']);
    expect((deps.report as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toBeInstanceOf(Error);
    expect((deps.report as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({ source: 'unhandledrejection' });
  });

  it('Fehlerereignis nur mit Nachricht wird zu Error; ResizeObserver-Rauschen wird ignoriert', () => {
    const { win, calls, deps } = setup();
    win.emit('error', { message: 'Script error.' });
    expect((deps.report as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBeInstanceOf(Error);
    calls.length = 0;
    win.emit('error', { message: 'ResizeObserver loop completed with undelivered notifications.' });
    expect(calls).toEqual([]);
  });

  it('echte Fehler mit ResizeObserver im Text, aber mit Error-Objekt, werden NICHT ignoriert', () => {
    const { win, calls } = setup();
    win.emit('error', { error: new Error('ResizeObserver loop'), message: 'ResizeObserver loop' });
    expect(calls).toEqual(['fail', 'report']);
  });
});

describe('Sichtbarkeit und Hintergrund', () => {
  it('hidden → sofort pausieren (Quelle background), kein Wake-Lock-Aufruf', () => {
    const { doc, calls } = setup();
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    expect(calls).toEqual(['pause:background']);
  });

  it('visible → Wake Lock erneut anfordern; Fehler dabei werden gemeldet', async () => {
    const { doc, calls, deps } = setup();
    doc.emit('visibilitychange');
    expect(calls).toEqual(['wake']);
    (deps.reacquireWakeLock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('NotAllowed'));
    doc.emit('visibilitychange');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toContain('report');
  });

  it('pagehide und freeze pausieren ebenfalls', () => {
    const { win, doc, calls } = setup();
    win.emit('pagehide');
    doc.emit('freeze');
    expect(calls).toEqual(['pause:background', 'pause:background']);
  });

  it('Detail der Pause nennt den Grund, ohne Barcode-Inhalte', () => {
    const { doc, deps } = setup();
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    expect((deps.pauseActive as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['background', 'Seite in den Hintergrund gewechselt']);
  });
});

describe('Aufräumen', () => {
  it('Deinstallation entfernt alle Handler', () => {
    const { win, doc, off } = setup();
    expect(win.count() + doc.count()).toBe(5);
    off();
    expect(win.count() + doc.count()).toBe(0);
  });
});
