// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { buildShareFile, parseShareText } from '../../src/domain/share-format';
import { buildShareLink, decodeSharePayload, encodeSharePayload, MAX_DECODED_BYTES, MAX_LINK_PAYLOAD, supportsCompression } from '../../src/adapters/share/link-codec';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof AppError) return `${e.code}|${e.userMessage}`;
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('Link-Codec', () => {
  it('Rundreise mit Umlauten, Emojis und führenden Nullen (komprimiert)', async () => {
    expect(supportsCompression()).toBe(true);
    const text = JSON.stringify({ name: 'Äpfel & Birnen 🍎', value: '0012345678905', note: 'Zeile\nzwei' });
    const payload = await encodeSharePayload(text);
    expect(payload.startsWith('g.')).toBe(true);
    expect(payload).toMatch(/^g\.[A-Za-z0-9_-]+$/); // URL-sicher, kein + / =
    expect(await decodeSharePayload(payload)).toBe(text);
  });

  it('komprimiert wiederholte Inhalte deutlich', async () => {
    const text = 'abcdef0123456789'.repeat(500);
    const payload = await encodeSharePayload(text);
    expect(payload.length).toBeLessThan(text.length / 5);
  });

  it('ein Link einer typischen Sammlung (20 Codes) passt in die Link-Grenze', async () => {
    const items = Array.from({ length: 20 }, (_v, i) => ({
      id: `i${i}`,
      collectionId: 'c',
      position: i,
      symbology: 'EAN13' as const,
      value: '4006381333931',
      quantity: 1,
      source: 'manual' as const,
      capturedAt: '',
      syntaxStatus: 'valid' as const,
      checksumStatus: 'valid' as const,
      catalogStatus: 'unchecked' as const,
      label: `Artikel ${i}`,
      expiresAt: '2026-12-31'
    }));
    const json = JSON.stringify(buildShareFile('Test', items, { exportedAt: '', appVersion: '' }));
    const payload = await encodeSharePayload(json);
    expect(payload.length).toBeLessThan(MAX_LINK_PAYLOAD);
    expect(parseShareText(await decodeSharePayload(payload)).items).toHaveLength(20);
  });

  it('beschädigte oder abgeschnittene Nutzlast ergibt eine verständliche Meldung', async () => {
    const payload = await encodeSharePayload('{"a":1}'.repeat(50));
    for (const bad of ['', 'x.abc', 'g.', 'g.!!!', payload.slice(0, payload.length - 10), 'r.%%%']) {
      const r = await codeOf(decodeSharePayload(bad));
      expect(r).toContain('ERR_IMPORT_SCHEMA_INVALID');
    }
    expect(await codeOf(decodeSharePayload(payload.slice(0, 12)))).toContain('beschädigt');
  });

  it('begrenzt die entpackte Größe (Schutz vor Dekompressionsbomben)', async () => {
    const huge = 'a'.repeat(MAX_DECODED_BYTES + 1000);
    const payload = await encodeSharePayload(huge);
    expect(payload.length).toBeLessThan(50_000); // sehr klein, aber riesig entpackt
    expect(await codeOf(decodeSharePayload(payload))).toContain('zu viele Daten');
  });

  it('baut Links mit Hash-Route und entfernt vorhandene Hashes', () => {
    expect(buildShareLink('https://x.test/app/', 'g.abc')).toBe('https://x.test/app/#/collections?import=g.abc');
    expect(buildShareLink('https://x.test/app/#/settings', 'g.abc')).toBe('https://x.test/app/#/collections?import=g.abc');
  });
});
