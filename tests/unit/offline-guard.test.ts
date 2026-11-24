import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Alle .ts/.css/.html-Dateien unter einem Ordner. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|css|html)$/.test(name)) out.push(p);
  }
  return out;
}

describe('Offline-Regel (AGENTS.md Regel 1): keine externen Ressourcen zur Laufzeit', () => {
  const files = [...walk('src'), 'index.html'];

  it('es gibt Quelldateien zu prüfen', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('keine CDN-Hosts im Quellcode', () => {
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/jsdelivr|unpkg|cdnjs|googleapis|gstatic|cloudflare|fastly/i);
    }
  });

  it('keine absoluten http(s)-URLs außer dem SVG-Namespace', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8').replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
      expect(text, f).not.toMatch(/https?:\/\//);
    }
  });

  it('das lokale WASM existiert und ist die einzige im Decoder referenzierte WASM-Datei', () => {
    const decoder = readFileSync('src/adapters/decoder/decoder-adapter.ts', 'utf8');
    expect(decoder).toContain("'./wasm/zxing_reader.wasm'");
    expect(decoder).toContain('locateFile');
    expect(statSync('public/wasm/zxing_reader.wasm').size).toBeGreaterThan(100_000);
  });
});
