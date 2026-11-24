import { describe, expect, it, vi } from 'vitest';
import { FeedbackAdapter, type AudioContextLike, type OscillatorLike } from '../../src/adapters/feedback/feedback-adapter';

class FakeAudio implements AudioContextLike {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  readonly oscillators: OscillatorLike[] = [];
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  createOscillator(): OscillatorLike {
    const o: OscillatorLike = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.oscillators.push(o);
    return o;
  }
  createGain(): { gain: { value: number }; connect: () => void } {
    return { gain: { value: 1 }, connect: vi.fn() };
  }
}

function setup(over: { vibrate?: ((p: number | number[]) => boolean) | undefined; now?: () => number } = {}): { fb: FeedbackAdapter; audio: FakeAudio; errors: unknown[] } {
  const audio = new FakeAudio();
  const errors: unknown[] = [];
  const fb = new FeedbackAdapter({
    audioContextCtor: class {
      constructor() {
        return audio;
      }
    } as unknown as new () => AudioContextLike,
    vibrate: 'vibrate' in over ? over.vibrate : vi.fn(() => true),
    onError: (e) => errors.push(e),
    ...(over.now ? { now: over.now } : {})
  });
  return { fb, audio, errors };
}

describe('FeedbackAdapter', () => {
  it('ohne Entsperren kein Ton (Browser-Autoplay-Regel), Vibration funktioniert', () => {
    const vibrate = vi.fn(() => true);
    const { fb, audio } = setup({ vibrate });
    fb.saved();
    expect(audio.oscillators).toHaveLength(0);
    expect(fb.unlocked).toBe(false);
    expect(vibrate).toHaveBeenCalledWith(40);
  });

  it('unlock (aus Nutzeraktion) setzt den Kontext fort; danach piept saved() einmal hoch', async () => {
    const { fb, audio } = setup();
    expect(await fb.unlock()).toBe(true);
    expect(audio.resume).toHaveBeenCalledTimes(1);
    fb.saved();
    expect(audio.oscillators).toHaveLength(1);
    expect(audio.oscillators[0]?.frequency.value).toBe(880);
    expect(audio.oscillators[0]?.start).toHaveBeenCalled();
    expect(await fb.unlock()).toBe(true);
    expect(audio.resume).toHaveBeenCalledTimes(1); // läuft schon
  });

  it('failed(): zwei tiefe Töne und Vibrationsmuster', async () => {
    const vibrate = vi.fn(() => true);
    const { fb, audio } = setup({ vibrate });
    await fb.unlock();
    fb.failed();
    expect(audio.oscillators.map((o) => o.frequency.value)).toEqual([220, 180]);
    expect(vibrate).toHaveBeenCalledWith([80, 60, 80]);
  });

  it('Fehlersignal wird gedrosselt (kein Dauerpiepen)', async () => {
    let t = 0;
    const { fb, audio } = setup({ now: () => t });
    await fb.unlock();
    fb.failed();
    t = 300;
    fb.failed();
    expect(audio.oscillators).toHaveLength(2);
    t = 900;
    fb.failed();
    expect(audio.oscillators).toHaveLength(4);
  });

  it('Einstellungen schalten Ton und Vibration einzeln ab', async () => {
    const vibrate = vi.fn(() => true);
    const { fb, audio } = setup({ vibrate });
    await fb.unlock();
    fb.settings = { sound: false, vibration: false };
    fb.saved();
    expect(audio.oscillators).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('ohne AudioContext oder vibrate: kein Fehler', async () => {
    const fb = new FeedbackAdapter({ audioContextCtor: undefined, vibrate: undefined });
    expect(await fb.unlock()).toBe(false);
    expect(() => {
      fb.saved();
      fb.failed();
    }).not.toThrow();
  });

  it('Audiofehler werden gemeldet, nicht verschluckt, und werfen nicht', async () => {
    const { fb, audio, errors } = setup();
    await fb.unlock();
    audio.createOscillator = () => {
      throw new Error('Audio kaputt');
    };
    expect(() => fb.saved()).not.toThrow();
    expect(errors).toHaveLength(1);
  });

  it('Vibrationsfehler und resume-Fehler werden gemeldet', async () => {
    const a = setup({
      vibrate: () => {
        throw new Error('vibrate kaputt');
      }
    });
    expect(() => a.fb.saved()).not.toThrow();
    expect(a.errors).toHaveLength(1);
    const b = setup();
    b.audio.resume = vi.fn(() => Promise.reject(new Error('gesperrt')));
    expect(await b.fb.unlock()).toBe(false);
    expect(b.errors).toHaveLength(1);
  });
});
