import { describe, expect, it, vi } from 'vitest';
import { WakeLockManager, type WakeLockApi, type WakeLockSentinelLike } from '../../src/adapters/wakelock/wake-lock';

function makeSentinel(): { s: WakeLockSentinelLike; release: ReturnType<typeof vi.fn>; fireRelease: () => void } {
  let listener: (() => void) | undefined;
  const release = vi.fn(() => Promise.resolve());
  return {
    s: { release, addEventListener: (_t, l) => (listener = l) },
    release,
    fireRelease: () => listener?.()
  };
}

describe('WakeLockManager', () => {
  it('ohne API: nicht unterstützt, kein Fehler', async () => {
    const m = new WakeLockManager(undefined);
    expect(m.supported).toBe(false);
    expect(await m.acquire()).toBe(false);
    expect(m.active).toBe(false);
    await expect(m.release()).resolves.toBeUndefined();
    expect(await m.reacquireIfNeeded()).toBe(false);
  });

  it('acquire fordert die Sperre an; zweites acquire erzeugt keine zweite', async () => {
    const sent = makeSentinel();
    const api: WakeLockApi = { request: vi.fn(() => Promise.resolve(sent.s)) };
    const m = new WakeLockManager(api);
    expect(await m.acquire()).toBe(true);
    expect(await m.acquire()).toBe(true);
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(m.active).toBe(true);
  });

  it('gleichzeitige acquire-Aufrufe teilen sich eine Anforderung', async () => {
    const sent = makeSentinel();
    const api: WakeLockApi = { request: vi.fn(() => Promise.resolve(sent.s)) };
    const m = new WakeLockManager(api);
    await Promise.all([m.acquire(), m.acquire(), m.reacquireIfNeeded()]);
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it('Browser gibt bei Hintergrundwechsel frei → reacquireIfNeeded fordert erneut an', async () => {
    const first = makeSentinel();
    const second = makeSentinel();
    const queue = [first.s, second.s];
    const api: WakeLockApi = { request: vi.fn(() => Promise.resolve(queue.shift() as WakeLockSentinelLike)) };
    const m = new WakeLockManager(api);
    await m.acquire();
    first.fireRelease();
    expect(m.active).toBe(false);
    expect(await m.reacquireIfNeeded()).toBe(true);
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  it('nach release() wird nicht erneut angefordert', async () => {
    const sent = makeSentinel();
    const api: WakeLockApi = { request: vi.fn(() => Promise.resolve(sent.s)) };
    const m = new WakeLockManager(api);
    await m.acquire();
    await m.release();
    expect(sent.release).toHaveBeenCalledTimes(1);
    expect(m.active).toBe(false);
    expect(await m.reacquireIfNeeded()).toBe(false);
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it('Anforderungsfehler (z. B. Energiesparmodus) werden gemeldet und liefern false', async () => {
    const errors: unknown[] = [];
    const api: WakeLockApi = { request: () => Promise.reject(new Error('NotAllowedError')) };
    const m = new WakeLockManager(api, (e) => errors.push(e));
    expect(await m.acquire()).toBe(false);
    expect(errors).toHaveLength(1);
    expect(m.active).toBe(false);
  });

  it('Freigabefehler werden gemeldet', async () => {
    const errors: unknown[] = [];
    const sent = makeSentinel();
    sent.release.mockRejectedValueOnce(new Error('weg'));
    const m = new WakeLockManager({ request: () => Promise.resolve(sent.s) }, (e) => errors.push(e));
    await m.acquire();
    await m.release();
    expect(errors).toHaveLength(1);
  });

  it('release während die Anforderung noch läuft: Sperre wird sofort wieder losgelassen', async () => {
    const sent = makeSentinel();
    let resolve: (s: WakeLockSentinelLike) => void = () => undefined;
    const api: WakeLockApi = { request: () => new Promise((r) => (resolve = r)) };
    const m = new WakeLockManager(api);
    const pending = m.acquire();
    await m.release();
    resolve(sent.s);
    expect(await pending).toBe(false);
    expect(sent.release).toHaveBeenCalledTimes(1);
    expect(m.active).toBe(false);
  });
});
