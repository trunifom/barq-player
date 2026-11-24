import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';

/**
 * Endabnahme des Produktions-Builds (Offline-Härtung): baut die App in ein temporäres Verzeichnis und prüft
 * Precache, Manifest, Icons und lokale Ressourcen. Läuft ohne Netz.
 */
const out = mkdtempSync(join(tmpdir(), 'barq-build-'));
const warnings: string[] = [];
let sw = '';
let precache: string[] = [];

/** Alle Dateien (relativ, mit `/`) unter einem Ordner. */
function files(dir: string): string[] {
  const list: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) list.push(...files(p));
    else list.push(relative(out, p).split('\\').join('/'));
  }
  return list;
}

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

beforeAll(async () => {
  // Warnungen/Fehler des Builds einsammeln (Vite und Plugins melden über console.warn/console.error).
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => void warnings.push(args.join(' ')));
  const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void warnings.push(args.join(' ')));
  try {
    await build({ configFile: 'vite.config.ts', logLevel: 'warn', build: { outDir: out, emptyOutDir: true } });
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
  sw = readFileSync(join(out, 'sw.js'), 'utf8');
  // Workbox schreibt minifiziert `url:"x"`, im Vitest-Lauf (NODE_ENV=test) formatiert `"url": "x"`: beides erkennen.
  precache = [...sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1] ?? '');
}, 120_000);

afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('Produktions-Build', () => {
  it('baut ohne Warnungen und Fehler', () => {
    expect(warnings).toEqual([]);
  });

  it('erzeugt Service Worker und alle erwarteten Dateien', () => {
    for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'wasm/zxing_reader.wasm', 'icons/icon-192.svg', 'icons/icon-512.svg', 'icons/icon-maskable.svg']) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(files(out).some((f) => /^assets\/index-.*\.js$/.test(f))).toBe(true);
    expect(files(out).some((f) => /^assets\/index-.*\.css$/.test(f))).toBe(true);
  });
});

describe('Precache (F-14: Offline-Start)', () => {
  it('enthält die lokale WASM-Datei, die App-Shell, Manifest und alle Icons', () => {
    for (const f of ['wasm/zxing_reader.wasm', 'index.html', 'manifest.webmanifest', 'icons/icon-192.svg', 'icons/icon-512.svg', 'icons/icon-maskable.svg']) {
      expect(precache, f).toContain(f);
    }
  });

  it('enthält JS und CSS der App sowie den lazy geladenen Decoder-Code', () => {
    const assets = precache.filter((u) => u.startsWith('assets/'));
    expect(assets.some((u) => u.endsWith('.js'))).toBe(true);
    expect(assets.some((u) => u.endsWith('.css'))).toBe(true);
    expect(assets.some((u) => /ponyfill-.*\.js$/.test(u))).toBe(true); // dynamisch importiertes barcode-detector-ponyfill
  });

  it('JEDE ausgelieferte Datei (außer Service Worker und Workbox-Laufzeit) liegt im Precache', () => {
    const shipped = files(out).filter((f) => f !== 'sw.js' && !/^workbox-.*\.js$/.test(f) && !f.endsWith('.gitkeep'));
    const missing = shipped.filter((f) => !precache.includes(f));
    expect(missing).toEqual([]);
  });

  it('Precache enthält keine absoluten oder externen URLs', () => {
    expect(precache.length).toBeGreaterThan(8);
    for (const u of precache) expect(u).not.toMatch(/^(https?:)?\/\//);
  });

  it('Update-Policy: kein automatisches skipWaiting/clientsClaim (neue Version wartet auf Freigabe)', () => {
    const calls = [...sw.matchAll(/skipWaiting\(\)/g)].map((m) => m.index ?? 0);
    for (const i of calls) expect(sw.slice(Math.max(0, i - 160), i), 'skipWaiting nur innerhalb des SKIP_WAITING-Nachrichtenhandlers').toContain('SKIP_WAITING');
    expect(sw).toContain('SKIP_WAITING'); // Aktivierung nur auf ausdrückliche Nachricht der Seite
    expect(sw).not.toMatch(/clientsClaim|clients\.claim\(\)/);
  });

  it('Navigation fällt offline auf die App-Shell zurück (SPA)', () => {
    expect(sw).toMatch(/NavigationRoute/);
    expect(sw).toContain('index.html');
  });
});

describe('Manifest und Icons', () => {
  const manifest = (): Record<string, unknown> => JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;

  it('Pflichtfelder für die Installierbarkeit', () => {
    const m = manifest();
    expect(m['name']).toBeTruthy();
    expect(m['short_name']).toBe('BarQPlayer');
    expect(m['display']).toBe('standalone');
    expect(m['start_url']).toBe('./');
    expect(m['scope']).toBe('./');
    expect(m['lang']).toBe('de');
    expect(m['theme_color']).toBe('#111827');
    expect(m['background_color']).toBe('#ffffff');
  });

  it('Icons: 192 und 512 (any) sowie maskable; alle Dateien existieren, sind SVG und im Precache', () => {
    const icons = manifest()['icons'] as Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of icons) {
      expect(i.type).toBe('image/svg+xml');
      expect(existsSync(join(out, i.src)), i.src).toBe(true);
      expect(precache, i.src).toContain(i.src);
      const svg = readFileSync(join(out, i.src), 'utf8');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).not.toMatch(/<script|onload=|href="http/i);
    }
  });

  it('index.html: relative Pfade, Manifest verlinkt, keine externen Ressourcen, Light-only', () => {
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest" href="./manifest.webmanifest"');
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).toContain('name="viewport"');
    expect(html).toMatch(/<html lang="de"/);
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    expect(html).not.toMatch(/(src|href)="\/(?!\/)/); // keine absoluten Pfade, sonst Unterpfad-Hosting kaputt
  });
});

describe('Lokales WASM (AGENTS.md Regel 1)', () => {
  it('ausgelieferte WASM-Datei ist byte-identisch mit der zur installierten zxing-wasm-Version passenden Datei', () => {
    const shipped = join(out, 'wasm', 'zxing_reader.wasm');
    const fromLib = join('node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm');
    expect(existsSync(fromLib)).toBe(true);
    expect(sha(shipped)).toBe(sha(fromLib));
    expect(sha(join('public', 'wasm', 'zxing_reader.wasm'))).toBe(sha(fromLib));
  });

  it('zxing-wasm wird nur in EINER Version installiert (Bibliothek des ponyfills und lokales WASM passen zusammen)', () => {
    const own = JSON.parse(readFileSync(join('node_modules', 'zxing-wasm', 'package.json'), 'utf8')) as { version: string };
    const ponyfill = JSON.parse(readFileSync(join('node_modules', 'barcode-detector', 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(ponyfill.dependencies?.['zxing-wasm']).toBe(own.version);
    expect(existsSync(join('node_modules', 'barcode-detector', 'node_modules', 'zxing-wasm'))).toBe(false);
  });

  it('der App-Code verweist auf den lokalen WASM-Pfad', () => {
    const js = files(out)
      .filter((f) => f.startsWith('assets/') && f.endsWith('.js'))
      .map((f) => readFileSync(join(out, f), 'utf8'))
      .join('\n');
    expect(js).toContain('./wasm/zxing_reader.wasm');
  });
});
