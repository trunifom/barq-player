import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Projekt-Baseline (Meilenstein 0)', () => {
  it('liefert zxing_reader.wasm lokal aus (kein CDN, AGENTS.md Regel 1)', () => {
    const p = 'public/wasm/zxing_reader.wasm';
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBeGreaterThan(100_000);
  });
});
