// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { InstallPrompt, type InstallTarget } from '../../src/offline/install-prompt';

function target(): { t: InstallTarget; fire: (type: string, ev?: Event) => void } {
  const handlers = new Map<string, (e: Event) => void>();
  return { t: { addEventListener: (type, l) => void handlers.set(type, l) }, fire: (type, ev = new Event(type)) => handlers.get(type)?.(ev) };
}

function promptEvent(outcome: 'accepted' | 'dismissed'): Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> } {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(() => Promise.resolve()), userChoice: Promise.resolve({ outcome }) });
}

describe('InstallPrompt', () => {
  it('startet als unavailable und wird available, sobald Chrome das Ereignis liefert (Standardleiste unterdrückt)', () => {
    const { t, fire } = target();
    const p = new InstallPrompt(t);
    const listener = vi.fn();
    p.subscribe(listener);
    expect(p.state).toBe('unavailable');
    const ev = promptEvent('accepted');
    fire('beforeinstallprompt', ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(p.state).toBe('available');
    expect(listener).toHaveBeenCalled();
  });
  it('prompt() zeigt den Dialog genau einmal und meldet das Ergebnis', async () => {
    const { t, fire } = target();
    const p = new InstallPrompt(t);
    const ev = promptEvent('accepted');
    fire('beforeinstallprompt', ev);
    expect(await p.prompt()).toBe('accepted');
    expect(ev.prompt).toHaveBeenCalledOnce();
    expect(p.state).toBe('unavailable');
    expect(await p.prompt()).toBe('unavailable');
  });
  it('dismissed wird weitergegeben', async () => {
    const { t, fire } = target();
    const p = new InstallPrompt(t);
    fire('beforeinstallprompt', promptEvent('dismissed'));
    expect(await p.prompt()).toBe('dismissed');
  });
  it('appinstalled und Standalone-Start ergeben installed', () => {
    const a = target();
    const p = new InstallPrompt(a.t);
    a.fire('beforeinstallprompt', promptEvent('accepted'));
    a.fire('appinstalled');
    expect(p.state).toBe('installed');
    expect(new InstallPrompt(target().t, () => true).state).toBe('installed');
  });
  it('subscribe liefert eine Abmeldefunktion', () => {
    const { t, fire } = target();
    const p = new InstallPrompt(t);
    const l = vi.fn();
    p.subscribe(l)();
    fire('beforeinstallprompt', promptEvent('accepted'));
    expect(l).not.toHaveBeenCalled();
  });
});
