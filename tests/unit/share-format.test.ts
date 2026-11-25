import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { buildShareFile, detectImportKind, itemsToPlainText, parseShareText, shareFilesFromBackupText, SHARE_FORMAT, validateShareFile } from '../../src/domain/share-format';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from '../../src/domain/backup-schema';
import type { BarcodeItem } from '../../src/domain/types';

const EAN = '4006381333931';
const META = { exportedAt: '2026-06-15T10:00:00.000Z', appVersion: '0.2.0' };

function item(over: Partial<BarcodeItem>): BarcodeItem {
  return {
    id: over.id ?? 'i1',
    collectionId: 'c1',
    position: 0,
    symbology: 'EAN13',
    value: EAN,
    quantity: 1,
    source: 'manual',
    capturedAt: '2026-01-01T00:00:00.000Z',
    syntaxStatus: 'valid',
    checksumStatus: 'valid',
    catalogStatus: 'unchecked',
    ...over
  };
}

function fail(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('buildShareFile / parseShareText', () => {
  it('Rundreise erhält Werte als String, Mengen und alle Zusatzangaben; IDs werden nicht exportiert', () => {
    const items = [
      item({ id: 'b', position: 1, symbology: 'QRCode', value: 'https://beispiel.test/x', label: 'Link' }),
      item({ id: 'a', position: 0, value: EAN, quantity: 3, label: 'Wort', purpose: 'Nutzen', note: 'Satz', tags: ['t1', 't2'], expiresAt: '2026-12-31' })
    ];
    const file = buildShareFile('Lager', items, META);
    expect(file.format).toBe(SHARE_FORMAT);
    expect(file.items.map((i) => i.value)).toEqual([EAN, 'https://beispiel.test/x']); // nach Position sortiert
    expect(JSON.stringify(file)).not.toContain('collectionId');
    const back = parseShareText(JSON.stringify(file));
    expect(back.collection.name).toBe('Lager');
    expect(back.items[0]).toEqual({ symbology: 'EAN13', value: EAN, quantity: 3, label: 'Wort', purpose: 'Nutzen', note: 'Satz', tags: ['t1', 't2'], expiresAt: '2026-12-31' });
    expect(back.items[1]).toEqual({ symbology: 'QRCode', value: 'https://beispiel.test/x', quantity: 1, label: 'Link' });
  });

  it('führende Nullen bleiben erhalten', () => {
    const zero = '0012345678905';
    const file = buildShareFile('Nullen', [item({ symbology: 'EAN13', value: zero })], META);
    expect(parseShareText(JSON.stringify(file)).items[0]?.value).toBe(zero);
  });

  it('akzeptiert BOM am Anfang', () => {
    const file = buildShareFile('X', [item({})], META);
    expect(parseShareText('﻿' + JSON.stringify(file)).items).toHaveLength(1);
  });
});

describe('validateShareFile – strenge Prüfung', () => {
  const base = (): Record<string, unknown> => ({ format: SHARE_FORMAT, schemaVersion: 1, exportedAt: '', appVersion: '', collection: { name: 'A' }, items: [{ symbology: 'EAN13', value: EAN, quantity: 1 }] });
  const mod = (fn: (o: Record<string, unknown>) => void): unknown => {
    const o = base();
    fn(o);
    return o;
  };

  it('gültige Datei wird akzeptiert', () => {
    expect(validateShareFile(base()).items).toHaveLength(1);
  });
  it.each([
    ['falsches Format', mod((o) => (o['format'] = 'x')), 'keine geteilte'],
    ['neuere Version', mod((o) => (o['schemaVersion'] = 99)), 'neueren'],
    ['keine Version', mod((o) => delete o['schemaVersion']), 'Versionsnummer'],
    ['kein Name', mod((o) => (o['collection'] = { name: ' ' })), 'keinen Namen'],
    ['Name zu lang', mod((o) => (o['collection'] = { name: 'x'.repeat(101) })), '100'],
    ['keine Liste', mod((o) => (o['items'] = 'x')), 'Liste'],
    ['unbekanntes Format', mod((o) => (o['items'] = [{ symbology: 'PDF417', value: '1' }])), 'Code 1: unbekanntes Format'],
    ['Prüfziffer falsch', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: '4006381333932' }])), 'Code 1'],
    ['Wert kein Text', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: 4006381333931 }])), 'Text'],
    ['Menge 0', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: EAN, quantity: 0 }])), 'Menge'],
    ['Menge zu groß', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: EAN, quantity: 10000 }])), 'Menge'],
    ['Datum ungültig', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: EAN, expiresAt: '2026-02-30' }])), 'Ablaufdatum'],
    ['Tags kein Array', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: EAN, tags: 'a' }])), 'tags'],
    ['Wort kein Text', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: EAN, label: 5 }])), 'label'],
    ['zweiter Code fehlerhaft nennt Position', mod((o) => (o['items'] = [{ symbology: 'EAN13', value: EAN }, { symbology: 'EAN8', value: '123' }])), 'Code 2']
  ])('lehnt ab: %s', (_name, input, part) => {
    const e = fail(() => validateShareFile(input));
    expect(e.code).toBe('ERR_IMPORT_SCHEMA_INVALID');
    expect(e.userMessage).toContain(part);
  });
  it('lehnt Nicht-Objekte und kaputtes JSON mit verständlicher Meldung ab', () => {
    expect(fail(() => validateShareFile(null)).code).toBe('ERR_IMPORT_SCHEMA_INVALID');
    expect(fail(() => parseShareText('{kaputt')).userMessage).toContain('kein gültiges JSON');
  });
});

describe('Voll-Backup als Sammlungen', () => {
  it('liefert je Sammlung eine Austauschdatei mit Zusatzangaben', () => {
    const backup = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.2.0',
      data: {
        collections: [
          { id: 'c1', name: 'A', createdAt: 'x', updatedAt: 'x' },
          { id: 'c2', name: 'B', createdAt: 'x', updatedAt: 'x' }
        ],
        items: [item({ id: 'i1', collectionId: 'c1', expiresAt: '2026-05-05', tags: ['x'] }), item({ id: 'i2', collectionId: 'c2', position: 0 })],
        templates: [],
        profiles: [],
        catalog: [],
        sessions: [],
        events: []
      }
    };
    const files = shareFilesFromBackupText(JSON.stringify(backup));
    expect(files.map((f) => [f.collection.name, f.items.length])).toEqual([['A', 1], ['B', 1]]);
    expect(files[0]?.items[0]?.expiresAt).toBe('2026-05-05');
  });
  it('ein ungültiges Backup wird verständlich abgelehnt', () => {
    expect(fail(() => shareFilesFromBackupText(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1 }))).code).toBe('ERR_IMPORT_SCHEMA_INVALID');
  });
});

describe('detectImportKind / itemsToPlainText', () => {
  it('erkennt die Art am Inhalt, nicht am Dateinamen', () => {
    expect(detectImportKind(JSON.stringify({ format: SHARE_FORMAT }))).toBe('collection');
    expect(detectImportKind(JSON.stringify({ format: BACKUP_FORMAT }))).toBe('backup');
    expect(detectImportKind('{"a":1}')).toBe('json-other');
    expect(detectImportKind('{kaputt')).toBe('json-other');
    expect(detectImportKind('4006381333931\n5901234123457')).toBe('text');
    expect(detectImportKind('Code;Menge\n4006381333931;2')).toBe('text');
  });
  it('Textliste enthält Name, Wert, Menge, Wort und Ablauf', () => {
    const text = itemsToPlainText('Lager', [item({ position: 1, value: EAN, quantity: 2, label: 'Stift', expiresAt: '2026-12-31' }), item({ id: 'x', position: 0, symbology: 'QRCode', value: 'hallo' })]);
    expect(text.split('\n')).toEqual(['Lager', 'hallo', `${EAN}  x2  Stift  bis 2026-12-31`]);
  });
});
