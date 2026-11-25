/**
 * Erzeugt `public/library/index.json` aus den Dateien im Ordner `public/library/`.
 * Aufruf: `npm run library` (läuft automatisch bei `npm run build` und `npm run dev`).
 * Zulässige Dateinamen: Buchstaben, Ziffern, `_`, `-`, `.` und Endung `.json` (keine Unterordner).
 * Die inhaltliche Prüfung der Dateien übernimmt der Test `tests/build/library.test.ts` (Gate vor der Veröffentlichung).
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join('public', 'library');
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const valid = /^[\p{L}\p{N}_.-]{1,100}\.json$/u;
const files = [];
for (const name of readdirSync(dir)) {
  if (name === 'index.json' || name.startsWith('.')) continue;
  if (!valid.test(name) || name.includes('..')) {
    console.error(`Unzulässiger Dateiname in public/library: "${name}" (erlaubt: Buchstaben, Ziffern, _ - . und Endung .json)`);
    process.exit(1);
  }
  files.push(name);
}
files.sort((a, b) => a.localeCompare(b, 'de'));
const index = { format: 'barq-player-library', schemaVersion: 1, files };
writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Bibliotheksindex: ${files.length} Datei(en)`);
