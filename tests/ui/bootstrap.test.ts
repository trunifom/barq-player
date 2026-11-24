// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap, type RunningApp } from '../../src/app/bootstrap';
import { APP_VERSION } from '../../src/app/version';
import { click, flush, setValue, testEnv, waitFor, type TestEnv } from './helpers';

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

let app: RunningApp | null = null;
let te: TestEnv | null = null;

afterEach(async () => {
  app?.dispose();
  await app?.ctx.db.delete();
  app = null;
  te = null;
  document.body.replaceChildren();
  document.body.className = '';
  window.location.hash = '';
});

function start(): RunningApp {
  document.body.replaceChildren();
  window.location.hash = '';
  const host = document.createElement('div');
  host.id = 'app';
  document.body.appendChild(host);
  te = testEnv();
  app = bootstrap(host, te.env);
  return app;
}

const navTo = async (hash: string): Promise<void> => {
  window.location.hash = hash;
  await flush(3);
};

const current = (): string | null => document.querySelector('.app__nav-link[aria-current="page"]')?.getAttribute('data-route') ?? null;

describe('App-Shell', () => {
  it('Version stimmt mit package.json überein', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('baut Kopfzeile, Hauptbereich, Navigation (5 Links) und Meldungsbereich auf; Start auf „Erfassen“', async () => {
    start();
    await flush(4);
    expect(document.querySelector('header .app__title')?.textContent).toBe('BarQPlayer');
    expect(document.querySelectorAll('.app__nav-link')).toHaveLength(5);
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Hauptnavigation');
    expect(document.querySelector('#toasts')?.getAttribute('aria-live')).toBe('polite');
    expect(window.location.hash).toBe('#/scanner');
    expect(current()).toBe('scanner');
    expect(document.querySelector('#sc-title')?.textContent).toBe('Erfassen');
    expect(document.activeElement?.id).toBe('screen'); // Fokus für Screenreader/Tastatur
  });

  it('Navigation wechselt Screens und räumt den alten auf (Kamera aus)', async () => {
    const a = start();
    await flush(4);
    te?.camera.start();
    await navTo('#/collections');
    expect(current()).toBe('collections');
    expect(document.querySelector('#co-title')).not.toBeNull();
    expect(document.querySelector('#sc-title')).toBeNull();
    await navTo('#/generator');
    expect(document.querySelector('#g-title')).not.toBeNull();
    await navTo('#/settings');
    expect(document.querySelector('#st-title')).not.toBeNull();
    await navTo('#/player');
    expect(document.querySelector('#pl-title')).not.toBeNull();
    expect(a.router.current.name).toBe('player');
  });

  it('unbekannte Adresse fällt auf die Standardroute zurück', async () => {
    start();
    await flush(2);
    await navTo('#/gibts-nicht');
    expect(current()).toBe('scanner');
  });

  it('Screen-Mount-Fehler zeigen ein Fehlerbanner statt eines leeren Bildschirms', async () => {
    const a = start();
    await flush(2);
    a.ctx.collections.listCollections = () => {
      throw new Error('kaputt');
    };
    await navTo('#/collections');
    await flush(4);
    expect(a.ctx.notify.items.some((n) => n.kind === 'error')).toBe(true);
  });
});

describe('Fader-Sitzung und App-Lebenszyklus', () => {
  async function liveSession(a: RunningApp): Promise<void> {
    const c = await a.ctx.collections.createCollection('Lager');
    await a.ctx.collections.addItems(c.id, [
      { symbology: 'EAN13', value: EAN_A, source: 'manual' },
      { symbology: 'EAN13', value: EAN_B, source: 'manual' }
    ]);
    await navTo(`#/player?collection=${c.id}`);
    await waitFor(() => document.querySelector('#pl-start-btn') !== null && document.querySelectorAll('#pl-profile option').length > 0);
    setValue(document.body, '#pl-mode', 'auto');
    click(document.body, '#pl-start-btn');
    await waitFor(() => document.querySelector('.player') !== null);
    te?.sched.advance(3000);
  }

  const stageChildren = (): number => document.querySelector('#stage')?.children.length ?? -1;

  it('während der Sitzung ist die Navigation verborgen (Klasse is-playing) und das Symbol sichtbar', async () => {
    const a = start();
    await flush(2);
    await liveSession(a);
    expect(document.body.classList.contains('is-playing')).toBe(true);
    expect(stageChildren()).toBe(1);
  });

  it('Navigation weg vom Fader ist gesperrt: sofort pausiert (Symbol aus), Hash zurückgesetzt, Hinweis angezeigt', async () => {
    const a = start();
    await flush(2);
    await liveSession(a);
    await navTo('#/settings');
    await flush(4);
    expect(window.location.hash.startsWith('#/player')).toBe(true);
    expect(document.querySelector('#st-title')).toBeNull();
    expect(a.ctx.playback.active?.machine.snapshot.state).toBe('PAUSED');
    expect(stageChildren()).toBe(0);
    expect(a.ctx.notify.items.some((n) => n.message.includes('Fader-Sitzung zuerst abbrechen'))).toBe(true);
  });

  it('Tab-/App-Wechsel (visibilitychange hidden) pausiert sofort und blendet aus', async () => {
    const a = start();
    await flush(2);
    await liveSession(a);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(a.ctx.playback.active?.machine.snapshot).toMatchObject({ state: 'PAUSED', pauseSource: 'background', visibleEntry: null });
    expect(stageChildren()).toBe(0);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  it('Seite wird ausgeblendet (pagehide) → Pause', async () => {
    const a = start();
    await flush(2);
    await liveSession(a);
    window.dispatchEvent(new Event('pagehide'));
    expect(a.ctx.playback.active?.machine.snapshot.state).toBe('PAUSED');
  });

  it('unbehandelter Laufzeitfehler: Sitzung geht sofort in ERROR (Symbol aus) UND der Fehler wird angezeigt und protokolliert', async () => {
    const a = start();
    await flush(2);
    await liveSession(a);
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('irgendwas kaputt'), message: 'irgendwas kaputt' }));
    expect(a.ctx.playback.active?.machine.snapshot.state).toBe('ERROR');
    expect(stageChildren()).toBe(0);
    expect(a.ctx.notify.items.some((n) => n.kind === 'error')).toBe(true);
    expect(a.ctx.logger.entries.some((e) => e.level === 'error' && e.context['source'] === 'window.error')).toBe(true);
    expect(document.querySelector('#player-status')?.textContent).toContain('Fehler');
  });

  it('unhandledrejection verhält sich genauso', async () => {
    const a = start();
    await flush(2);
    await liveSession(a);
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('abgelehnt') }));
    expect(a.ctx.playback.active?.machine.snapshot.state).toBe('ERROR');
    expect(stageChildren()).toBe(0);
    expect(a.ctx.logger.entries.some((e) => e.context['source'] === 'unhandledrejection')).toBe(true);
  });

  it('Fehler ohne laufende Sitzung werden trotzdem angezeigt und protokolliert', async () => {
    const a = start();
    await flush(2);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('x'), message: 'x' }));
    expect(a.ctx.notify.items.some((n) => n.kind === 'error')).toBe(true);
  });

  it('dispose entfernt die globalen Handler (kein Einfluss mehr)', async () => {
    const a = start();
    await flush(2);
    const n0 = a.ctx.notify.items.length;
    a.dispose();
    // Vitest meldet Fehlerereignisse ohne jeden Listener selbst als unbehandelt; ein neutraler Listener verhindert dieses Testartefakt.
    const neutral = (e: Event): void => e.preventDefault();
    window.addEventListener('error', neutral);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('nach dispose'), message: 'x', cancelable: true }));
    window.removeEventListener('error', neutral);
    expect(a.ctx.notify.items.length).toBe(n0);
  });
});
