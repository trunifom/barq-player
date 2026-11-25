// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { copyText, shareFile, shareJsonFile, shareText, type ShareNavigator } from '../../src/adapters/share/share-adapter';

const file = new File(['x'], 'a.json', { type: 'application/json' });
const abort = Object.assign(new Error('abort'), { name: 'AbortError' });

describe('shareFile', () => {
  it('teilt, wenn canShare zustimmt', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await shareFile({ share, canShare: () => true }, file, 'T')).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
  });
  it('unsupported ohne share/canShare oder wenn canShare ablehnt (kein share-Aufruf)', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await shareFile({}, file, 'T')).toBe('unsupported');
    expect(await shareFile({ share }, file, 'T')).toBe('unsupported');
    expect(await shareFile({ share, canShare: () => false }, file, 'T')).toBe('unsupported');
    expect(share).not.toHaveBeenCalled();
  });
  it('Abbruch des Dialogs ist kein Fehler, andere Fehler werden weitergereicht', async () => {
    expect(await shareFile({ share: () => Promise.reject(abort), canShare: () => true }, file, 'T')).toBe('cancelled');
    await expect(shareFile({ share: () => Promise.reject(new Error('boom')), canShare: () => true }, file, 'T')).rejects.toThrow('boom');
  });
});

describe('shareJsonFile', () => {
  it('versucht erst .json und weicht auf .txt aus, wenn json nicht teilbar ist', async () => {
    const names: string[] = [];
    const nav: ShareNavigator = {
      canShare: (d) => {
        const f = d.files?.[0];
        names.push(f?.name ?? '');
        return f?.type === 'text/plain';
      },
      share: () => Promise.resolve()
    };
    expect(await shareJsonFile(nav, 'sammlung.barq', '{}', 'T')).toBe('shared');
    expect(names).toEqual(['sammlung.barq.json', 'sammlung.barq.txt']);
  });
  it('unsupported, wenn keines von beiden geht', async () => {
    expect(await shareJsonFile({ canShare: () => false, share: () => Promise.resolve() }, 'x', '{}', 'T')).toBe('unsupported');
  });
});

describe('shareText / copyText', () => {
  it('shareText: shared, cancelled, unsupported', async () => {
    expect(await shareText({ share: () => Promise.resolve() }, { title: 't', url: 'u' })).toBe('shared');
    expect(await shareText({ share: () => Promise.reject(abort) }, { title: 't' })).toBe('cancelled');
    expect(await shareText({}, { title: 't' })).toBe('unsupported');
  });
  it('copyText: true bei Erfolg, false ohne Zwischenablage oder bei Ablehnung', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await copyText({ clipboard: { writeText } }, 'abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
    expect(await copyText({}, 'abc')).toBe(false);
    expect(await copyText({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, 'abc')).toBe(false);
  });
});
