import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, parseBackupText, validateBackup } from '../../src/domain/backup-schema';
import { DEFAULT_PROFILES, validateProfile } from '../../src/domain/profiles';

/** Gültiges Backup als JSON-Rohobjekt (unvertrauenswürdige Form). */
function validRaw(): Record<string, unknown> {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-11-24T10:00:00.000Z',
    appVersion: '0.1.0',
    data: {
      collections: [{ id: 'c1', name: 'Lager', createdAt: 't', updatedAt: 't' }],
      items: [
        {
          id: 'i1', collectionId: 'c1', position: 0, symbology: 'EAN13', value: '0000000000000', quantity: 2, source: 'manual',
          capturedAt: 't', syntaxStatus: 'valid', checksumStatus: 'valid', catalogStatus: 'unchecked', label: 'x'
        },
        {
          id: 'i2', collectionId: 'c1', position: 1, symbology: 'QRCode', value: 'hallo', quantity: 1, source: 'camera',
          capturedAt: 't', syntaxStatus: 'valid', checksumStatus: 'not-applicable', catalogStatus: 'known', catalogSource: 'a.csv', catalogCheckedAt: 't'
        }
      ],
      templates: [
        {
          id: 't1', name: 'Vorlage', pattern: '2 063701 028{XX}{C}', createdAt: 't', updatedAt: 't',
          definition: {
            id: 'd1', symbology: 'EAN13', prefix: '2063701028', suffixBeforeCheckDigit: '', variableWidth: 2, start: '0', end: '96', step: '12',
            checksumMode: 'gs1-mod10', overflow: 'stop'
          }
        }
      ],
      profiles: [{ id: 'p1', name: 'Normal', displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 3000 }],
      catalog: [{ value: '0012', active: true, source: 'a.csv', importedAt: 't' }],
      sessions: [{ id: 's1', collectionId: 'c1', startedAt: 't', mode: 'auto', appVersion: '0.1.0', entryCount: 3, interleaved: false, status: 'finished' }],
      events: [{ id: 's1-1', sessionId: 's1', timestamp: 't', type: 'displayed', evidence: 'player', entryId: 'e1' }]
    }
  };
}

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function rows(d: Tables, table: string): Row[] {
  const list = d[table];
  if (!list) throw new Error(`Tabelle fehlt im Testaufbau: ${table}`);
  return list;
}

function definition(d: Tables): Row {
  return rows(d, 'templates')[0]?.['definition'] as Row;
}

function mutate(fn: (raw: Row, data: Tables) => void): unknown {
  const raw = validRaw();
  fn(raw, raw['data'] as Tables);
  return raw;
}

function issuesOf(input: unknown): string[] {
  const r = validateBackup(input);
  if (r.ok) return [];
  return r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe('validateBackup', () => {
  it('akzeptiert ein gültiges Backup unverändert (inkl. führender Nullen)', () => {
    const r = validateBackup(validRaw());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.data.items[0]?.value).toBe('0000000000000');
      expect(r.backup.data.templates[0]?.definition.overflow).toBe('stop');
      expect(r.backup.data.items).toHaveLength(2);
      expect(r.backup.data.catalog[0]?.value).toBe('0012');
    }
  });

  it('leere Tabellen sind gültig', () => {
    const raw = validRaw();
    raw['data'] = { collections: [], items: [], templates: [], profiles: [], catalog: [], sessions: [], events: [] };
    expect(validateBackup(raw).ok).toBe(true);
  });

  it('verwirft unbekannte Zusatzfelder (nur bekannte Felder werden übernommen)', () => {
    const r = validateBackup(mutate((_, d) => { rows(d, 'items')[0]!['evil'] = '<script>'; rows(d, 'collections')[0]!['x'] = 1; }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.stringify(r.backup)).not.toContain('evil');
      expect(Object.keys(r.backup.data.collections[0] ?? {})).not.toContain('x');
    }
  });

  it.each([
    ['kein Objekt', null],
    ['Array', []],
    ['String', 'x'],
    ['Zahl', 5]
  ])('lehnt %s ab', (_n, input) => {
    expect(validateBackup(input).ok).toBe(false);
  });

  it('lehnt falsches Format, fehlende/zu neue/ungültige Schemaversion ab', () => {
    expect(issuesOf(mutate((r) => { r['format'] = 'andere'; }))[0]).toContain('format');
    expect(issuesOf(mutate((r) => { delete r['schemaVersion']; }))[0]).toContain('schemaVersion');
    expect(issuesOf(mutate((r) => { r['schemaVersion'] = 0; }))[0]).toContain('schemaVersion');
    expect(issuesOf(mutate((r) => { r['schemaVersion'] = 1.5; }))[0]).toContain('schemaVersion');
    expect(issuesOf(mutate((r) => { r['schemaVersion'] = BACKUP_SCHEMA_VERSION + 1; }))[0]).toContain('neueren App');
  });

  it('data fehlt oder ist kein Objekt', () => {
    expect(issuesOf(mutate((r) => { delete r['data']; }))).toEqual(['data: muss ein Objekt sein']);
    expect(issuesOf(mutate((r) => { r['data'] = []; }))).toEqual(['data: muss ein Objekt sein']);
  });

  it('fehlende Tabelle wird gemeldet', () => {
    expect(issuesOf(mutate((_, d) => { delete d['events']; }))).toEqual(['data.events: muss eine Liste sein']);
  });

  it('Eintragsfehler mit genauem Pfad', () => {
    const issues = issuesOf(
      mutate((_, d) => {
        const it0 = rows(d, 'items')[0]!;
        it0['symbology'] = 'DATAMATRIX';
        it0['quantity'] = 0;
        it0['value'] = '';
        it0['position'] = -1;
        it0['source'] = 'cloud';
        it0['syntaxStatus'] = 'ok';
        it0['label'] = 5;
      })
    );
    for (const key of ['symbology', 'quantity', 'value', 'position', 'source', 'syntaxStatus', 'label']) {
      expect(issues.some((i) => i.startsWith(`data.items[0].${key}:`))).toBe(true);
    }
  });

  it('quantity als Zahl-String/Dezimalzahl wird abgelehnt (keine stille Umwandlung)', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'items')[0]!['quantity'] = '2'; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'items')[0]!['quantity'] = 1.5; })).length).toBe(1);
  });

  it('value als Zahl wird abgelehnt (führende Nullen!)', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'items')[0]!['value'] = 12; })).length).toBe(1);
  });

  it('doppelte IDs, Positionen und Katalogkennungen', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'items')[1]!['id'] = 'i1'; })).some((i) => i.includes('items[1].id'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { rows(d, 'items')[1]!['position'] = 0; })).some((i) => i.includes('items[1].position'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { rows(d, 'collections').push({ id: 'c1', name: 'x', createdAt: 't', updatedAt: 't' }); })).some((i) => i.includes('collections[1].id'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { rows(d, 'catalog').push({ value: '0012', active: false, source: 's', importedAt: 't' }); })).some((i) => i.includes('catalog[1].value'))).toBe(true);
  });

  it('gleiche Position in verschiedenen Sammlungen ist erlaubt', () => {
    expect(
      validateBackup(
        mutate((_, d) => {
          rows(d, 'collections').push({ id: 'c2', name: 'Zwei', createdAt: 't', updatedAt: 't' });
          rows(d, 'items').push({ ...rows(d, 'items')[0], id: 'i3', collectionId: 'c2' });
        })
      ).ok
    ).toBe(true);
  });

  it('Verweise: Eintrag → Sammlung, Ereignis → Sitzung', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'items')[0]!['collectionId'] = 'zzz'; })).some((i) => i.includes('unbekannte Sammlung'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { rows(d, 'events')[0]!['sessionId'] = 'zzz'; })).some((i) => i.includes('unbekannte Sitzung'))).toBe(true);
  });

  it('Sitzung darf auf gelöschte Sammlung verweisen', () => {
    expect(validateBackup(mutate((_, d) => { rows(d, 'sessions')[0]!['collectionId'] = 'gelöscht'; })).ok).toBe(true);
  });

  it('Vorlage: Definition muss Objekt sein, overflow=stop, gültige Aufzählungen', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'templates')[0]!['definition'] = 'x'; })).some((i) => i.includes('definition'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { definition(d).overflow = 'wrap'; })).some((i) => i.includes('overflow'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { definition(d).checksumMode = 'crc'; })).some((i) => i.includes('checksumMode'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { definition(d).start = 5; })).some((i) => i.includes('start'))).toBe(true);
    expect(issuesOf(mutate((_, d) => { definition(d).maxItems = 0; })).some((i) => i.includes('maxItems'))).toBe(true);
  });

  it('Profile: Zahlenbereiche', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'profiles')[0]!['displayMs'] = 0; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'profiles')[0]!['blankMs'] = -1; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'profiles')[0]!['startDelayMs'] = null; })).length).toBe(1);
  });

  it('Katalog, Sitzung, Ereignis: Typen', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'catalog')[0]!['active'] = 'ja'; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'sessions')[0]!['interleaved'] = 'nein'; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'sessions')[0]!['status'] = 'weg'; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'events')[0]!['type'] = 'booked'; })).length).toBe(1);
    expect(issuesOf(mutate((_, d) => { rows(d, 'events')[0]!['evidence'] = 'magic'; })).length).toBe(1);
  });

  it('Listeneinträge, die keine Objekte sind, werden gemeldet', () => {
    expect(issuesOf(mutate((_, d) => { rows(d, 'items').push('x' as unknown as Row); })).some((i) => i.includes('items[2]'))).toBe(true);
  });

  it('begrenzt die Problemliste und fasst den Rest zusammen', () => {
    const raw = mutate((_, d) => {
      d['items'] = Array.from({ length: 40 }, (_x, i) => ({ id: `x${i}`, collectionId: 'c1', position: i, symbology: 'bad', value: '', quantity: 0 }));
    });
    const r = validateBackup(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeLessThanOrEqual(51);
      expect(r.issues.at(-1)?.message).toContain('weitere Probleme');
    }
  });
});

describe('parseBackupText', () => {
  it('liefert das geprüfte Backup', () => {
    expect(parseBackupText(JSON.stringify(validRaw())).data.items).toHaveLength(2);
  });

  it('ungültiges JSON → ERR_IMPORT_SCHEMA_INVALID', () => {
    for (const bad of ['', '{', 'nicht json', '{"a":']) {
      try {
        parseBackupText(bad);
        throw new Error('hätte werfen müssen');
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('ERR_IMPORT_SCHEMA_INVALID');
      }
    }
  });

  it('Schemafehler: Meldung nennt Pfade, details alle Probleme', () => {
    const raw = mutate((_, d) => { rows(d, 'items')[0]!['quantity'] = 0; });
    try {
      parseBackupText(JSON.stringify(raw));
      throw new Error('hätte werfen müssen');
    } catch (e: unknown) {
      const err = e as AppError;
      expect(err.code).toBe('ERR_IMPORT_SCHEMA_INVALID');
      expect(err.userMessage).toContain('data.items[0].quantity');
      expect(err.details).toContain('data.items[0].quantity');
    }
  });
});

describe('Profile', () => {
  it('Standardprofile sind gültig, eindeutig und eingefroren', () => {
    expect(DEFAULT_PROFILES.map((p) => p.name)).toEqual(['Langsam', 'Normaltest', 'Schnelltest', 'Identische Codes']);
    expect(new Set(DEFAULT_PROFILES.map((p) => p.id)).size).toBe(4);
    for (const p of DEFAULT_PROFILES) {
      expect(validateProfile(p)).toEqual([]);
      expect(Object.isFrozen(p)).toBe(true);
      expect(p.identicalBlankMs).toBeGreaterThanOrEqual(p.blankMs);
    }
    expect(DEFAULT_PROFILES[1]).toMatchObject({ displayMs: 500, blankMs: 150 });
  });

  it('validateProfile meldet Probleme', () => {
    const ok = { id: 'x', name: 'n', displayMs: 1, blankMs: 0, identicalBlankMs: 0, startDelayMs: 0 };
    expect(validateProfile(ok)).toEqual([]);
    expect(validateProfile({ ...ok, id: '' })).toHaveLength(1);
    expect(validateProfile({ ...ok, name: '  ' })).toHaveLength(1);
    expect(validateProfile({ ...ok, displayMs: 0 })).toHaveLength(1);
    expect(validateProfile({ ...ok, blankMs: -1 })).toHaveLength(1);
    expect(validateProfile({ ...ok, identicalBlankMs: Number.NaN })).toHaveLength(1);
    expect(validateProfile({ ...ok, startDelayMs: 700_000 })).toHaveLength(1);
  });
});
