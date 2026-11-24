import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Alle .ts-Dateien (ohne .d.ts) unter einem Ordner. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p.split('\\').join('/'));
  }
  return out;
}

/** Entfernt Kommentare (grob, aber für diese Prüfungen ausreichend; Strings mit `//` kommen im Code nicht vor). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

const SRC = tsFiles('src');
const TESTS = tsFiles('tests');
const read = (f: string): string => readFileSync(f, 'utf8');

describe('Q-04: TSDoc an allen exportierten Symbolen', () => {
  it('jeder Export (function, class, interface, type, const, enum) hat einen TSDoc-Kommentar direkt davor', () => {
    const missing: string[] = [];
    for (const file of SRC) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = /^export\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/.exec(line);
        if (!m) return;
        let j = i - 1;
        while (j >= 0 && (lines[j] ?? '').trim() === '') j--;
        const prev = (lines[j] ?? '').trim();
        if (!prev.endsWith('*/')) missing.push(`${file}:${i + 1} ${m[2]}`);
      });
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('jede Quelldatei beginnt mit einem Kommentar zu Zweck bzw. Regeln (Dateikopf)', () => {
    const noHeader = SRC.filter((f) => {
      const code = read(f).trimStart();
      return code.length > 0 && !code.startsWith('/**') && !code.startsWith('//') && !code.startsWith('import ');
    });
    expect(noHeader, noHeader.join('\n')).toEqual([]);
    // Dateien, die direkt mit `import` beginnen, brauchen den Zweck-Kommentar spätestens vor dem ersten Export
    const noPurpose = SRC.filter((f) => {
      const code = read(f);
      return !/\/\*\*[\s\S]*?\*\//.test(code) && !/^\s*\/\//.test(code) && code.trim().length > 80;
    });
    expect(noPurpose, noPurpose.join('\n')).toEqual([]);
  });
});

describe('TypeScript-Strenge', () => {
  it('kein `any` im Code (src und tests)', () => {
    const found: string[] = [];
    for (const file of [...SRC, ...TESTS]) {
      const code = stripComments(read(file));
      code.split(/\r?\n/).forEach((line, i) => {
        if (/(:\s*|\bas\s+|<\s*|,\s*)any\b(?!\w)/.test(line) && !/'[^']*\bany\b[^']*'/.test(line)) found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('keine Compiler-Unterdrückung (@ts-ignore, @ts-nocheck, @ts-expect-error) in src', () => {
    const found = SRC.filter((f) => /@ts-(ignore|nocheck|expect-error)/.test(read(f)));
    expect(found).toEqual([]);
  });

  it('strict ist aktiv, ebenso noUnusedLocals/noUnusedParameters', () => {
    const tsconfig = read('tsconfig.json');
    expect(tsconfig).toMatch(/"strict":\s*true/);
    expect(tsconfig).toMatch(/"noUnusedLocals":\s*true/);
    expect(tsconfig).toMatch(/"noUnusedParameters":\s*true/);
  });
});

describe('Kein stilles Verschlucken von Fehlern (Error-Handling)', () => {
  it('kein komplett leerer catch-Block', () => {
    const empty: string[] = [];
    for (const file of SRC) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) empty.push(`${file}: ${m[0]}`);
    }
    expect(empty, empty.join('\n')).toEqual([]);
  });

  it('catch ohne Variable nur mit begründendem Kommentar', () => {
    const bad: string[] = [];
    for (const file of SRC) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/catch\s*\{/.test(line)) {
          const around = [lines[i], lines[i + 1], lines[i + 2]].join(' ');
          if (!/\/\/|\/\*/.test(around)) bad.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});

describe('Schichtentrennung (AGENTS.md Regel 2)', () => {
  const DOMAIN = SRC.filter((f) => f.startsWith('src/domain/'));

  it('es gibt Domain-Dateien', () => {
    expect(DOMAIN.length).toBeGreaterThan(10);
  });

  it('src/domain/ nutzt keine Browser-/DOM-/Kamera-/IndexedDB-/Timer-APIs', () => {
    const forbidden = /\b(window|document|navigator|localStorage|sessionStorage|indexedDB|HTMLElement|HTMLVideoElement|MediaStream|AudioContext|requestAnimationFrame|setTimeout|setInterval|clearTimeout|fetch|XMLHttpRequest|DeviceMotionEvent|Dexie)\b/;
    const found: string[] = [];
    for (const file of DOMAIN) {
      stripComments(read(file))
        .split(/\r?\n/)
        .forEach((line, i) => {
          // Erlaubt: die abstrakte Scheduler-Schnittstelle (Zeit wird injiziert) – Deklaration und Aufruf über `scheduler.`
          const checked = line.replace(/\bscheduler\.(setTimeout|clearTimeout)\b/g, '').replace(/^\s+(setTimeout|clearTimeout)\(.*\):\s*\w+;\s*$/, '');
          if (forbidden.test(checked)) found.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  it('src/domain/ importiert nur aus src/domain/', () => {
    const found: string[] = [];
    for (const file of DOMAIN) {
      for (const m of read(file).matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1] ?? '';
        if (!spec.startsWith('./')) found.push(`${file}: ${spec}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('adapters importieren weder application noch ui noch app', () => {
    const found: string[] = [];
    for (const file of SRC.filter((f) => f.startsWith('src/adapters/'))) {
      for (const m of read(file).matchAll(/from\s+'([^']+)'/g)) {
        if (/\.\.\/\.\.\/(application|ui|app|offline)\//.test(m[1] ?? '')) found.push(`${file}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('application importiert weder ui noch app', () => {
    const found: string[] = [];
    for (const file of SRC.filter((f) => f.startsWith('src/application/'))) {
      for (const m of read(file).matchAll(/from\s+'([^']+)'/g)) {
        if (/\.\.\/(ui|app)\//.test(m[1] ?? '')) found.push(`${file}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('ui importiert nicht aus app außer Typen/Routen (kein Rückgriff auf den Composition Root)', () => {
    const found: string[] = [];
    for (const file of SRC.filter((f) => f.startsWith('src/ui/'))) {
      for (const m of read(file).matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
        const spec = m[2] ?? '';
        if (/\.\.\/\.\.\/app\//.test(spec) && !m[1] && !/routes'$/.test(spec)) found.push(`${file}: ${spec}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('Sensor-Adapter kann nur pausieren: kein Zugriff auf resume/confirm in Lift-Dateien', () => {
    for (const f of ['src/adapters/sensors/lift-detector.ts', 'src/domain/lift-detection.ts']) {
      const code = stripComments(read(f));
      expect(code, f).not.toMatch(/\.(resume|confirm)\s*\(/);
      expect(code, f).not.toMatch(/pos-accepted|manual-confirmed/);
    }
  });
});

describe('Fachregeln im Code (AGENTS.md)', () => {
  it('Barcode-Werte sind String-Felder (Regel 3): BarcodeItem.value und PlaybackEntry.value', () => {
    const types = read('src/domain/types.ts');
    expect(types).toMatch(/interface BarcodeItem[\s\S]*?value:\s*string;/);
    expect(types).toMatch(/interface PlaybackEntry[\s\S]*?value:\s*string;/);
    expect(types).toMatch(/interface CatalogProduct[\s\S]*?value:\s*string;/);
  });

  it('die Zustandsmaschine erzeugt nie pos-accepted/pos-rejected (Regel 6)', () => {
    const code = stripComments(read('src/domain/playback-machine.ts'));
    expect(code).not.toMatch(/record\(\s*'pos-/);
  });

  it('Renderer: nur #000000 auf #FFFFFF und crispEdges (Regel 5)', () => {
    const code = read('src/adapters/renderer/barcode-renderer.ts');
    expect(code).toContain("BAR_COLOR = '#000000'");
    expect(code).toContain("BACKGROUND_COLOR = '#FFFFFF'");
    expect(code).toContain('shape-rendering="crispEdges"');
  });

  it('Fader-CSS: keine Übergänge/Animationen im Player', () => {
    const css = read('src/ui/styles/main.css');
    expect(css).toMatch(/\.player,\s*\.player \*\s*\{[^}]*transition:\s*none\s*!important/);
    expect(css).toMatch(/\.player,\s*\.player \*\s*\{[^}]*animation:\s*none\s*!important/);
  });
});

describe('Dokumentation (Vier-Säulen-Vollständigkeit)', () => {
  const docs = ['README.md', 'docs/PFLICHTENHEFT_STATUS.md', 'docs/SOFTWARE_DOKUMENTATION.md', 'docs/USER_GUIDE.md', 'docs/Barcode_Lager_App_Dokumentation.md', 'AGENTS.md'];

  it('alle Dokumente existieren und sind nicht leer', () => {
    for (const d of docs) {
      expect(existsSync(d), d).toBe(true);
      expect(read(d).length, d).toBeGreaterThan(500);
    }
  });

  it('README verlinkt alle Dokumente, und die Links zeigen auf existierende Dateien', () => {
    const readme = read('README.md');
    const links = [...readme.matchAll(/\]\((docs\/[^)#]+|AGENTS\.md)\)/g)].map((m) => m[1] ?? '');
    for (const need of ['docs/PFLICHTENHEFT_STATUS.md', 'docs/SOFTWARE_DOKUMENTATION.md', 'docs/USER_GUIDE.md', 'docs/Barcode_Lager_App_Dokumentation.md', 'AGENTS.md']) expect(links).toContain(need);
    for (const l of links) expect(existsSync(l), l).toBe(true);
  });

  it('Pflichtenheft enthält alle Muss-Anforderungen F-01 bis F-15 in einer wohlgeformten Tabelle', () => {
    const text = read('docs/PFLICHTENHEFT_STATUS.md');
    const rows = text.split(/\r?\n/).filter((l) => /^\| [A-Z]+\d?-?\d+[a-z]? \|/.test(l));
    const ids = rows.map((r) => (r.split('|')[1] ?? '').trim());
    for (let n = 1; n <= 15; n++) {
      const id = `F-${String(n).padStart(2, '0')}`;
      expect(ids.some((x) => x === id || x.startsWith(id)), id).toBe(true);
    }
    for (const r of rows) expect(r.split('|').length - 2, r.slice(0, 40)).toBe(8); // 8 Spalten
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('jede umgesetzte Zeile hat Datum, Uhrzeit, Commit-Nummer und echten Kurz-Hash', () => {
    const rows = read('docs/PFLICHTENHEFT_STATUS.md').split(/\r?\n/).filter((l) => /^\| (M0|F|S|Q)-?\d/.test(l) && l.includes('| Umgesetzt |'));
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      const cells = r.split('|').map((c) => c.trim());
      expect(cells[4], r.slice(0, 30)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(cells[5], r.slice(0, 30)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(cells[6], r.slice(0, 30)).toMatch(/^#\d{3} `[0-9a-f]{7}`$/);
    }
  });

  it('Changelog führt Commits fortlaufend nummeriert (#001, #002, …) mit Hash, Datum und Uhrzeit', () => {
    const heads = [...read('docs/PFLICHTENHEFT_STATUS.md').matchAll(/^### #(\d{3}) – `([0-9a-f]{7})` – (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/gm)];
    expect(heads.length).toBeGreaterThan(5);
    heads.forEach((m, i) => expect(Number(m[1])).toBe(i + 1));
  });

  it('Software-Dokumentation enthält die geforderten Kapitel', () => {
    const t = read('docs/SOFTWARE_DOKUMENTATION.md');
    for (const h of ['Modulübersicht', 'Datenmodell', 'Zustandsautomat', 'Error-Code-Katalog', 'Rendering', 'Offline-/WASM-Strategie', 'Testkonzept', 'ADR-Protokoll']) expect(t, h).toContain(h);
  });

  it('Benutzerhandbuch deckt die zehn geforderten Themen ab', () => {
    const t = read('docs/USER_GUIDE.md');
    for (const h of ['PWA auf Android installieren', 'Offline-Vorbereitung', 'Scannen im Lager', 'Sammlungen pflegen', 'Zahlenreihen und Präfix-Vorlagen', '2 063701 028{XX}{C}', 'Kassen-Fader', 'Fehlermeldung', 'Kalibrierung', 'Backup', 'CSV', 'Fehlerbehebung']) expect(t, h).toContain(h);
  });

  it('jeder Fehlercode des Katalogs ist in der Software-Dokumentation beschrieben', () => {
    const codes = [...read('src/domain/errors.ts').matchAll(/^\s+(ERR_[A-Z_]+):\s*\{/gm)].map((m) => m[1] ?? '');
    expect(codes.length).toBeGreaterThan(15);
    const doc = read('docs/SOFTWARE_DOKUMENTATION.md');
    for (const c of codes) expect(doc, c).toContain(c);
  });
});
