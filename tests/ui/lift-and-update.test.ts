// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, type RunningApp } from '../../src/app/bootstrap';
import type { MotionEventLike, MotionTarget } from '../../src/adapters/sensors/lift-detector';
import { mountPlayer } from '../../src/ui/screens/player';
import { mountSettings } from '../../src/ui/screens/settings';
import { click, flush, setChecked, setValue, setupUi, teardownUi, testEnv, text, waitFor, type UiSetup } from './helpers';

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

class FakeMotion implements MotionTarget {
  readonly listeners = new Set<(e: MotionEventLike) => void>();
  addEventListener(_t: 'devicemotion', l: (e: MotionEventLike) => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: 'devicemotion', l: (e: MotionEventLike) => void): void {
    this.listeners.delete(l);
  }
  emit(x: number, y: number, z: number): void {
    for (const l of [...this.listeners]) l({ accelerationIncludingGravity: { x, y, z } });
  }
}

let ui: UiSetup | null = null;
let app: RunningApp | null = null;

afterEach(async () => {
  await teardownUi(ui);
  ui = null;
  app?.dispose();
  await app?.ctx.db.delete();
  app = null;
  document.body.replaceChildren();
  document.body.className = '';
  window.location.hash = '';
});

async function seed(u: UiSetup): Promise<string> {
  const c = await u.ctx.collections.createCollection('Lager');
  await u.ctx.collections.addItems(c.id, [
    { symbology: 'EAN13', value: EAN_A, source: 'manual' },
    { symbology: 'EAN13', value: EAN_B, source: 'manual' }
  ]);
  return c.id;
}

describe('Einstellungen: Lift-to-Pause', () => {
  it('ohne Bewegungssensoren: Schalter gesperrt, Erklärung', async () => {
    ui = setupUi();
    ui.mount(mountSettings, { name: 'settings', params: {} });
    await flush(4);
    expect((ui.root.querySelector('#st-lift') as HTMLInputElement).disabled).toBe(true);
    expect(text(ui.root, '#st-lift-info')).toContain('keine Bewegungssensoren');
  });

  it('mit Sensoren: ein-/ausschalten wird gespeichert; standardmäßig aus', async () => {
    ui = setupUi({ liftTarget: new FakeMotion() });
    ui.mount(mountSettings, { name: 'settings', params: {} });
    await flush(4);
    const box = ui.root.querySelector('#st-lift') as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
    expect(ui.ctx.settings.get().liftToPause).toBe(false);
    expect(text(ui.root, '#st-lift-info')).toContain('nur pausieren');
    setChecked(ui.root, '#st-lift', true);
    await waitFor(() => ui?.ctx.settings.get().liftToPause === true);
    setChecked(ui.root, '#st-lift', false);
    await waitFor(() => ui?.ctx.settings.get().liftToPause === false);
  });
});

describe('Fader: Lift-to-Pause pausiert nur', () => {
  async function startWithLift(u: UiSetup, motion: FakeMotion): Promise<void> {
    const cid = await seed(u);
    u.ctx.settings.update({ liftToPause: true, mode: 'auto' });
    await u.ctx.lift.enable();
    u.mount(mountPlayer, { name: 'player', params: { collection: cid } });
    await waitFor(() => u.root.querySelector('#pl-start-btn') !== null && u.root.querySelectorAll('#pl-profile option').length > 0);
    click(u.root, '#pl-start-btn');
    await waitFor(() => u.root.querySelector('.player') !== null);
    expect(motion.listeners.size).toBe(0); // im Countdown nicht scharf
  }

  const stateOf = (u: UiSetup): string => (u.root.querySelector('.player') as HTMLElement).dataset['state'] ?? '';
  const stage = (u: UiSetup): HTMLElement => u.root.querySelector('#stage') as HTMLElement;

  it('scharf erst bei Anzeige (nicht im Countdown); Anheben → Pause (Quelle sensor), Bühne sofort leer, danach unscharf', async () => {
    const motion = new FakeMotion();
    ui = setupUi({ liftTarget: motion });
    await startWithLift(ui, motion);
    ui.sched.advance(3000);
    expect(stateOf(ui)).toBe('SHOWING');
    expect(ui.ctx.lift.armed).toBe(true);
    for (let t = 0; t <= 800; t += 40) {
      ui.clock.ms = t;
      motion.emit(0, 0, 9.81);
    }
    expect(stateOf(ui)).toBe('SHOWING'); // Ruhe löst nicht aus
    for (let i = 0; i < 3; i++) {
      ui.clock.ms += 20;
      motion.emit(0, 0, 14);
    }
    expect(stateOf(ui)).toBe('PAUSED');
    expect(stage(ui).children).toHaveLength(0);
    expect(ui.ctx.playback.active?.machine.snapshot.pauseSource).toBe('sensor');
    expect(ui.ctx.lift.armed).toBe(false);
    expect(motion.listeners.size).toBe(0);
    // niemals automatisch fortsetzen oder bestätigen
    ui.sched.advance(60_000);
    ui.liftSched.advance(60_000);
    expect(stateOf(ui)).toBe('PAUSED');
    const events = ui.ctx.playback.active?.machine.events ?? [];
    expect(events.some((e) => e.type === 'manual-confirmed')).toBe(false);
    expect(events.find((e) => e.type === 'paused')?.evidence).toBe('sensor');
    expect(text(ui.root, '#player-status')).toContain('Sensor');
  });

  it('nach bewusster Wiederaufnahme (Countdown) wird erst wieder bei Anzeige scharf geschaltet', async () => {
    const motion = new FakeMotion();
    ui = setupUi({ liftTarget: motion });
    await startWithLift(ui, motion);
    ui.sched.advance(3000);
    ui.ctx.playback.pauseActive('sensor', 'Test');
    click(ui.root, '#btn-reconciled');
    expect(stateOf(ui)).toBe('COUNTDOWN');
    expect(ui.ctx.lift.armed).toBe(false);
    ui.sched.advance(3000);
    expect(ui.ctx.lift.armed).toBe(true);
  });

  it('Sensorverlust während der Anzeige → Pause', async () => {
    const motion = new FakeMotion();
    ui = setupUi({ liftTarget: motion });
    await startWithLift(ui, motion);
    ui.sched.advance(3000);
    expect(ui.ctx.lift.armed).toBe(true);
    ui.liftSched.advance(2000); // keine Messwerte
    expect(stateOf(ui)).toBe('PAUSED');
    expect(ui.ctx.playback.active?.machine.snapshot.pauseSource).toBe('sensor');
  });

  it('ohne Freigabe in den Einstellungen bleibt der Sensor aus', async () => {
    const motion = new FakeMotion();
    ui = setupUi({ liftTarget: motion });
    const cid = await seed(ui);
    ui.ctx.settings.update({ mode: 'auto' }); // liftToPause bleibt false
    ui.mount(mountPlayer, { name: 'player', params: { collection: cid } });
    await waitFor(() => ui?.root.querySelector('#pl-start-btn') !== null && (ui?.root.querySelectorAll('#pl-profile option').length ?? 0) > 0);
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('.player') !== null);
    ui.sched.advance(3000);
    expect(ui.ctx.lift.armed).toBe(false);
    expect(motion.listeners.size).toBe(0);
  });

  it('Verlassen des Screens schaltet den Sensor ab', async () => {
    const motion = new FakeMotion();
    ui = setupUi({ liftTarget: motion });
    await startWithLift(ui, motion);
    ui.sched.advance(3000);
    ui.unmount();
    expect(ui.ctx.lift.armed).toBe(false);
  });
});

describe('Update-Hinweis in der App', () => {
  function start(): RunningApp {
    document.body.replaceChildren();
    window.location.hash = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const te = testEnv();
    app = bootstrap(host, te.env);
    return app;
  }

  it('offline-ready wird erst gemeldet, wenn der Service Worker es bestätigt', async () => {
    const a = start();
    await flush(3);
    expect(a.ctx.notify.items.some((n) => n.message.includes('offline nutzbar'))).toBe(false);
    a.ctx.updates.markOfflineReady();
    expect(a.ctx.notify.items.some((n) => n.kind === 'success' && n.message.includes('offline nutzbar'))).toBe(true);
    a.ctx.updates.markOfflineReady();
    expect(a.ctx.notify.items.filter((n) => n.message.includes('offline nutzbar'))).toHaveLength(1);
  });

  it('neue Version: Hinweis oben; Aktivierung nur mit Klick und nie während einer Sitzung', async () => {
    const a = start();
    await flush(3);
    const applier = vi.fn<() => Promise<void>>(() => Promise.resolve());
    a.ctx.updates.setApplier(applier);
    a.ctx.updates.markUpdateAvailable();
    const host = document.querySelector('#update-host') as HTMLElement;
    expect(host.hidden).toBe(false);
    expect((document.querySelector('#update-apply') as HTMLButtonElement).disabled).toBe(false);
    expect(applier).not.toHaveBeenCalled(); // nie automatisch

    // Sitzung starten → gesperrt
    const c = await a.ctx.collections.createCollection('Lager');
    await a.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: EAN_A, source: 'manual' });
    window.location.hash = `#/player?collection=${c.id}`;
    await waitFor(() => document.querySelector('#pl-start-btn') !== null && document.querySelectorAll('#pl-profile option').length > 0);
    setValue(document.body, '#pl-mode', 'auto');
    click(document.body, '#pl-start-btn');
    await waitFor(() => document.querySelector('.player') !== null);
    a.ctx.updates.refresh();
    expect((document.querySelector('#update-apply') as HTMLButtonElement).disabled).toBe(true);
    (document.querySelector('#update-apply') as HTMLButtonElement).click();
    expect(applier).not.toHaveBeenCalled();
    expect(document.querySelector('#update-text')?.textContent).toContain('nach Ende der laufenden Fader-Sitzung');
  });

  it('Einrichtungsfehler des Service Workers erscheinen als Fehlerbanner mit Code', async () => {
    const a = start();
    await flush(3);
    a.ctx.updates.markError(new Error('SW-Registrierung fehlgeschlagen'));
    const n = a.ctx.notify.items.find((x) => x.kind === 'error');
    expect(n?.code).toBe('ERR_OFFLINE_SETUP_FAILED');
    expect(n?.hint).toContain('HTTPS');
  });
});
