import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ROUTE, ROUTES, Router, formatRoute, parseRoute, type Route, type RouterWindow } from '../../src/app/routes';

describe('parseRoute / formatRoute', () => {
  it('liest Name und Parameter', () => {
    expect(parseRoute('#/player?collection=abc&calibration=1')).toEqual({ name: 'player', params: { collection: 'abc', calibration: '1' } });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings', params: {} });
    expect(parseRoute('#collections')).toEqual({ name: 'collections', params: {} });
  });

  it('unbekannte oder leere Adressen → Standardroute', () => {
    for (const h of ['', '#', '#/', '#/nope', '#/player/extra', 'player', '#/PLAYER', '#/../x']) expect(parseRoute(h)).toBe(DEFAULT_ROUTE);
  });

  it('Round-Trip inkl. Sonderzeichen in Parametern', () => {
    const r: Route = { name: 'player', params: { collection: 'a b&c=d' } };
    expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(formatRoute({ name: 'scanner', params: {} })).toBe('#/scanner');
  });

  it('Navigation enthält alle fünf Screens', () => {
    expect(ROUTES.map((r) => r.name)).toEqual(['scanner', 'collections', 'generator', 'player', 'settings']);
    expect(ROUTES.every((r) => r.label.length > 2)).toBe(true);
  });
});

/** Fenster-Attrappe, die hashchange asynchron wie ein Browser auslöst. */
function fakeWindow(initial = ''): RouterWindow & { fire(): void; listeners: Array<() => void> } {
  let hash = initial;
  const listeners: Array<() => void> = [];
  const win = {
    listeners,
    location: {
      get hash() {
        return hash;
      },
      set hash(v: string) {
        if (v !== hash) {
          hash = v;
          queueMicrotask(() => [...listeners].forEach((l) => l()));
        }
      }
    },
    addEventListener: (_t: 'hashchange', l: () => void) => void listeners.push(l),
    removeEventListener: (_t: 'hashchange', l: () => void) => void listeners.splice(listeners.indexOf(l), 1),
    fire: () => listeners.forEach((l) => l())
  };
  return win as unknown as RouterWindow & { fire(): void; listeners: Array<() => void> };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Router', () => {
  it('mountet beim Start die Standardroute und setzt den Hash', () => {
    const win = fakeWindow('');
    const mount = vi.fn((_route: Route) => () => undefined);
    const router = new Router(win, mount);
    router.start();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0]?.[0]).toMatchObject({ name: 'scanner' });
    expect(win.location.hash).toBe('#/scanner');
  });

  it('Navigation räumt den alten Screen auf, bevor der neue gemountet wird', async () => {
    const win = fakeWindow('#/scanner');
    const order: string[] = [];
    const router = new Router(win, (route) => {
      order.push(`mount-${route.name}`);
      return () => order.push(`dispose-${route.name}`);
    });
    router.start();
    router.navigate({ name: 'settings', params: {} });
    await tick();
    expect(order).toEqual(['mount-scanner', 'dispose-scanner', 'mount-settings']);
    expect(router.current.name).toBe('settings');
  });

  it('gleiche Route erneut öffnen baut den Screen neu auf', () => {
    const win = fakeWindow('#/scanner');
    const mount = vi.fn(() => () => undefined);
    const router = new Router(win, mount);
    router.start();
    router.navigate({ name: 'scanner', params: {} });
    expect(mount).toHaveBeenCalledTimes(2);
  });

  it('Guard kann das Verlassen verhindern: Hash wird zurückgesetzt, kein Wechsel', async () => {
    const win = fakeWindow('#/player');
    const mount = vi.fn(() => () => undefined);
    const onChange = vi.fn();
    const canLeave = vi.fn(() => false);
    const router = new Router(win, mount, canLeave, onChange);
    router.start();
    win.location.hash = '#/settings';
    await tick();
    await tick();
    expect(canLeave).toHaveBeenCalledTimes(1);
    expect(canLeave.mock.calls[0]).toMatchObject([{ name: 'player' }, { name: 'settings' }]);
    expect(win.location.hash).toBe('#/player');
    expect(mount).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('onChange meldet jede neue Route; stop entfernt den Listener und räumt auf', async () => {
    const win = fakeWindow('#/scanner');
    const dispose = vi.fn();
    const onChange = vi.fn();
    const router = new Router(win, () => dispose, () => true, onChange);
    router.start();
    router.start(); // zweiter Start ist wirkungslos
    expect(win.listeners).toHaveLength(1);
    router.stop();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(win.listeners).toHaveLength(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('Route mit Parametern erreicht den Screen', async () => {
    const win = fakeWindow('#/collections');
    const seen: Route[] = [];
    const router = new Router(win, (r) => {
      seen.push(r);
      return () => undefined;
    });
    router.start();
    router.navigate({ name: 'player', params: { collection: 'x' } });
    await tick();
    expect(seen.at(-1)).toEqual({ name: 'player', params: { collection: 'x' } });
  });
});
