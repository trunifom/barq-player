import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { contentHash, fingerprint, isValidLibraryFileName, libraryEntryStatus, LIBRARY_FORMAT, MAX_LIBRARY_FILES, parseLibraryIndex } from '../../src/domain/library';
import type { ShareItem } from '../../src/domain/share-format';
import { validateBackup } from '../../src/domain/backup-schema';

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AppError) {
      expect(e.code).toBe('ERR_IMPORT_SCHEMA_INVALID');
      return e.userMessage;
    }
    throw e;
  }
  throw new Error('kein Fehler');
}

const idx = (files: unknown, extra: Record<string, unknown> = {}): string => JSON.stringify({ format: LIBRARY_FORMAT, schemaVersion: 1, files, ...extra });

describe('isValidLibraryFileName', () => {
  it('erlaubt einfache Namen mit Umlauten', () => {
    for (const n of ['schrauben.json', 'Maschine_2374.barq.json', 'Äpfel-Birnen.json', 'a.json']) expect(isValidLibraryFileName(n), n).toBe(true);
  });
  it('lehnt Pfade, Sonderzeichen, falsche Endung und den Index selbst ab', () => {
    for (const n of ['../x.json', 'a/b.json', 'a\\b.json', '..json', 'x.txt', 'x', '.json', 'index.json', 'a b.json', 'a%2e.json', 'x'.repeat(101) + '.json']) expect(isValidLibraryFileName(n), n).toBe(false);
  });
});

describe('parseLibraryIndex', () => {
  it('liest einen gültigen Index und entfernt doppelte Dateien', () => {
    expect(parseLibraryIndex(idx(['a.json', 'b.json', 'a.json'])).files).toEqual(['a.json', 'b.json']);
    expect(parseLibraryIndex('﻿' + idx([])).files).toEqual([]);
  });
  it('lehnt Unbrauchbares mit verständlicher Meldung ab', () => {
    expect(msg(() => parseLibraryIndex('{kaputt'))).toContain('kein gültiges JSON');
    expect(msg(() => parseLibraryIndex('[]'))).toContain('ungültiges Format');
    expect(msg(() => parseLibraryIndex(JSON.stringify({ format: 'x', files: [] })))).toContain('kein BarQPlayer');
    expect(msg(() => parseLibraryIndex(JSON.stringify({ format: LIBRARY_FORMAT, files: [] })))).toContain('Versionsnummer');
    expect(msg(() => parseLibraryIndex(idx([], { schemaVersion: 9 })))).toContain('neueren');
    expect(msg(() => parseLibraryIndex(idx('x')))).toContain('Dateiliste');
  });
  it('lehnt Pfadtricks im Dateinamen ab (Schutz vor Zugriff außerhalb der Bibliothek)', () => {
    expect(msg(() => parseLibraryIndex(idx(['../geheim.json'])))).toContain('Unzulässiger Dateiname');
    expect(msg(() => parseLibraryIndex(idx(['https://fremd.test/x.json'])))).toContain('Unzulässiger Dateiname');
    expect(msg(() => parseLibraryIndex(idx([42])))).toContain('Unzulässiger Dateiname');
  });
  it('begrenzt die Dateizahl', () => {
    const many = Array.from({ length: MAX_LIBRARY_FILES + 1 }, (_v, i) => `f${i}.json`);
    expect(msg(() => parseLibraryIndex(idx(many)))).toContain('mehr als');
  });
});

describe('fingerprint / contentHash', () => {
  const item = (over: Partial<ShareItem> = {}): ShareItem => ({ symbology: 'EAN13', value: '2345678765430', quantity: 1, ...over });

  it('ist deterministisch, 14-stellig hexadezimal und unterscheidet Eingaben', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{14}$/);
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'));
    expect(fingerprint('')).toMatch(/^[0-9a-f]{14}$/);
  });
  it('jede inhaltliche Änderung ändert den Fingerabdruck', () => {
    const base = contentHash([item({ label: 'Schraube 2x3mm', purpose: 'Montage', note: 'nur Maschine 2374', tags: ['Firma XYZ'], expiresAt: '2035-12-31' })]);
    const variants: Array<Partial<ShareItem>> = [
      { label: 'Schraube 2x4mm' },
      { purpose: 'Reparatur' },
      { note: 'nur Maschine 2375' },
      { tags: ['Firma ABC'] },
      { tags: ['Firma XYZ', 'x'] },
      { expiresAt: '2035-12-30' },
      { quantity: 2 },
      { value: '4006381333931' },
      { symbology: 'Code128' }
    ];
    for (const v of variants) {
      expect(contentHash([item({ label: 'Schraube 2x3mm', purpose: 'Montage', note: 'nur Maschine 2374', tags: ['Firma XYZ'], expiresAt: '2035-12-31', ...v })]), JSON.stringify(v)).not.toBe(base);
    }
  });
  it('die Reihenfolge der Codes zählt; Tags-Grenzen sind eindeutig', () => {
    const a = item({ value: '4006381333931' });
    const b = item({ value: '5901234123457' });
    expect(contentHash([a, b])).not.toBe(contentHash([b, a]));
    expect(contentHash([item({ tags: ['a', 'b'] })])).not.toBe(contentHash([item({ tags: ['a b'] })]));
  });
  it('fehlende und leere Angaben sind gleichwertig', () => {
    expect(contentHash([item()])).toBe(contentHash([item({ label: undefined })]));
  });
});

describe('libraryEntryStatus', () => {
  const link = { file: 'a.json', hash: 'H1', importedAt: 't' };
  it.each([
    ['H1', null, 'new'],
    ['H1', { link, currentHash: 'H1' }, 'current'],
    ['H2', { link, currentHash: 'H1' }, 'update'],
    ['H2', { link, currentHash: 'LOKAL' }, 'update-modified'],
    ['H1', { link, currentHash: 'LOKAL' }, 'modified']
  ] as const)('remote %s, lokal %j → %s', (remote, local, expected) => {
    expect(libraryEntryStatus(remote, local)).toBe(expected);
  });
});

describe('Backup mit Bibliotheksverknüpfung', () => {
  const backup = (library: unknown): unknown => ({
    format: 'barq-player-backup',
    schemaVersion: 1,
    exportedAt: '',
    appVersion: '',
    data: { collections: [{ id: 'c', name: 'A', createdAt: '', updatedAt: '', library }], items: [], templates: [], profiles: [], catalog: [], sessions: [], events: [] }
  });
  it('wird erhalten, wenn gültig', () => {
    const r = validateBackup(backup({ file: 'a.json', hash: 'h', importedAt: 't' }));
    expect(r.ok && r.backup.data.collections[0]?.library).toEqual({ file: 'a.json', hash: 'h', importedAt: 't' });
  });
  it('ein unzulässiger Dateiname oder falscher Typ wird mit Pfad gemeldet', () => {
    const bad = validateBackup(backup({ file: '../x.json', hash: 'h', importedAt: 't' }));
    expect(!bad.ok && bad.issues[0]?.path).toBe('data.collections[0].library.file');
    const bad2 = validateBackup(backup('x'));
    expect(!bad2.ok && bad2.issues[0]?.path).toBe('data.collections[0].library');
  });
});
