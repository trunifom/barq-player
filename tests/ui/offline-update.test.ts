// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { UpdatePolicy } from '../../src/offline/update-policy';
import { mountUpdateBanner, UPDATE_RECHECK_MS } from '../../src/ui/components/update-banner';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('UpdatePolicy', () => {
  function setup(live = false): { p: UpdatePolicy; live: { v: boolean }; applier: Mock<() => Promise<void>> } {
    const state = { v: live };
    const p = new UpdatePolicy({ isSessionLive: () => state.v });
    const applier = vi.fn<() => Promise<void>>(() => Promise.resolve());
    return { p, live: state, applier };
  }

  it('Startzustand: idle, nichts anwendbar', () => {
    const { p } = setup();
    expect(p.state).toEqual({ phase: 'idle', canApplyNow: false, error: null });
  });

  it('offline-ready wird nur aus idle gesetzt und überschreibt kein wartendes Update', () => {
    const { p } = setup();
    p.markOfflineReady();
    expect(p.state.phase).toBe('offline-ready');
    p.markUpdateAvailable();
    p.markOfflineReady();
    expect(p.state.phase).toBe('update-available');
  });

  it('Update verfügbar, aber ohne Applier nicht anwendbar; mit Applier und ohne Sitzung anwendbar', () => {
    const { p, applier } = setup();
    p.markUpdateAvailable();
    expect(p.state.canApplyNow).toBe(false);
    p.setApplier(applier);
    expect(p.state.canApplyNow).toBe(true);
  });

  it('WÄHREND einer Sitzung (läuft oder pausiert) wird NIE aktiviert', async () => {
    const { p, live, applier } = setup(true);
    p.setApplier(applier);
    p.markUpdateAvailable();
    expect(p.state.canApplyNow).toBe(false);
    expect(await p.apply()).toBe(false);
    expect(applier).not.toHaveBeenCalled();
    expect(p.state.phase).toBe('update-available');
    live.v = false; // Sitzung beendet
    expect(p.state.canApplyNow).toBe(true);
    expect(await p.apply()).toBe(true);
    expect(applier).toHaveBeenCalledTimes(1);
    expect(p.state.phase).toBe('applying');
  });

  it('Sitzung beginnt zwischen Anzeige und Klick: apply prüft erneut und lehnt ab', async () => {
    const { p, live, applier } = setup(false);
    p.setApplier(applier);
    p.markUpdateAvailable();
    expect(p.state.canApplyNow).toBe(true);
    live.v = true;
    expect(await p.apply()).toBe(false);
    expect(applier).not.toHaveBeenCalled();
  });

  it('ohne Update oder ohne Applier lehnt apply ab', async () => {
    const { p, applier } = setup();
    p.setApplier(applier);
    expect(await p.apply()).toBe(false);
    const q = setup().p;
    q.markUpdateAvailable();
    expect(await q.apply()).toBe(false);
  });

  it('Fehler bei der Aktivierung → phase error mit AppError', async () => {
    const { p } = setup();
    p.setApplier(() => Promise.reject(new Error('SW tot')));
    p.markUpdateAvailable();
    expect(await p.apply()).toBe(false);
    expect(p.state.phase).toBe('error');
    expect(p.state.error?.code).toBe('ERR_OFFLINE_SETUP_FAILED');
    expect(p.state.error?.details).toContain('SW tot');
  });

  it('markError übernimmt AppError unverändert; ein neues Update löscht den Fehler', () => {
    const { p } = setup();
    const e = new AppError('ERR_WASM_LOAD_FAILED');
    p.markError(e);
    expect(p.state.error).toBe(e);
    p.markUpdateAvailable();
    expect(p.state.error).toBeNull();
  });

  it('Beobachter werden bei Änderungen und refresh() informiert und können sich abmelden', () => {
    const { p } = setup();
    const seen: string[] = [];
    const off = p.subscribe((s) => seen.push(s.phase));
    p.markOfflineReady();
    p.refresh();
    off();
    p.markUpdateAvailable();
    expect(seen).toEqual(['offline-ready', 'offline-ready']);
  });
});

describe('Update-Hinweis', () => {
  function setup(live = false): { host: HTMLElement; p: UpdatePolicy; live: { v: boolean }; applier: Mock<() => Promise<void>>; errors: AppError[]; off: () => void } {
    const host = document.createElement('div');
    host.hidden = true;
    document.body.appendChild(host);
    const state = { v: live };
    const p = new UpdatePolicy({ isSessionLive: () => state.v });
    const applier = vi.fn<() => Promise<void>>(() => Promise.resolve());
    p.setApplier(applier);
    const errors: AppError[] = [];
    const off = mountUpdateBanner(host, p, (e) => errors.push(e));
    return { host, p, live: state, applier, errors, off };
  }

  it('ist unsichtbar, solange kein Update wartet', () => {
    const { host, p } = setup();
    expect(host.hidden).toBe(true);
    p.markOfflineReady();
    expect(host.hidden).toBe(true);
    expect(host.children).toHaveLength(0);
  });

  it('zeigt bei wartendem Update die Schaltfläche; Klick aktiviert', async () => {
    const { host, p, applier } = setup();
    p.markUpdateAvailable();
    expect(host.hidden).toBe(false);
    expect(host.querySelector('#update-text')?.textContent).toContain('neue Version');
    const btn = host.querySelector('#update-apply') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    btn.click();
    await Promise.resolve();
    expect(applier).toHaveBeenCalledTimes(1);
    expect((host.querySelector('#update-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector('#update-text')?.textContent).toContain('aktiviert');
  });

  it('bei laufender Sitzung ist die Schaltfläche gesperrt und der Text erklärt warum; nach Sitzungsende wird sie frei (Neuprüfung)', () => {
    vi.useFakeTimers();
    const { host, p, live, applier } = setup(true);
    p.markUpdateAvailable();
    const btn = (): HTMLButtonElement => host.querySelector('#update-apply') as HTMLButtonElement;
    expect(btn().disabled).toBe(true);
    expect(host.querySelector('#update-text')?.textContent).toContain('nach Ende der laufenden Fader-Sitzung');
    btn().click();
    expect(applier).not.toHaveBeenCalled();
    live.v = false;
    vi.advanceTimersByTime(UPDATE_RECHECK_MS);
    expect(btn().disabled).toBe(false);
  });

  it('meldet einen Einrichtungsfehler genau einmal', () => {
    const { p, errors } = setup();
    p.markError(new Error('x'));
    p.refresh();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('ERR_OFFLINE_SETUP_FAILED');
  });

  it('Entfernen stoppt Beobachter und Timer', () => {
    vi.useFakeTimers();
    const { p, off } = setup();
    p.markUpdateAvailable();
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });
});
