// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidLibraryFileName, parseLibraryIndex } from '../../src/domain/library';
import { parseShareText } from '../../src/domain/share-format';

/**
 * Gate vor der Veröffentlichung: Alles, was unter `public/library/` liegt, wird mit der App ausgeliefert.
 * Eine fehlerhafte Datei darf deshalb nie auf die Geräte gelangen – dieser Test bricht dann den Workflow ab.
 */
const dir = join('public', 'library');
const names = readdirSync(dir).filter((n) => n !== 'index.json' && !n.startsWith('.'));

describe('Gemeinsame Bibliothek (public/library)', () => {
  it('der Index ist gültig und stimmt mit den Dateien überein (npm run library ausführen, wenn nicht)', () => {
    const index = parseLibraryIndex(readFileSync(join(dir, 'index.json'), 'utf8'));
    expect([...index.files].sort()).toEqual([...names].sort());
  });

  it('alle Dateinamen sind zulässig', () => {
    for (const n of names) expect(isValidLibraryFileName(n), n).toBe(true);
  });

  it.each(names)('%s ist eine gültige geteilte Sammlung (alle Codes streng geprüft)', (name) => {
    const file = parseShareText(readFileSync(join(dir, name), 'utf8'));
    expect(file.collection.name.length).toBeGreaterThan(0);
  });
});
