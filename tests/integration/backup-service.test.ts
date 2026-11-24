import { afterEach, describe, expect, it } from 'vitest';
import { AppError, type ErrorCode } from '../../src/domain/errors';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION } from '../../src/domain/backup-schema';
import { BackupService } from '../../src/application/backup-service';
import { CollectionService } from '../../src/application/collection-service';
import { SessionService } from '../../src/application/session-service';
import type { BarqDatabase } from '../../src/adapters/persistence/db';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

async function codeOf(p: Promise<unknown>): Promise<ErrorCode> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error('kein Fehler geworfen');
}

/** Befüllt eine DB mit allen Tabellen und liefert Services. */
async function populated(): Promise<{ db: BarqDatabase; col: CollectionService; backup: BackupService; sessions: SessionService; cid: string }> {
  const db = freshDb();
  const deps = testDeps();
  const col = new CollectionService(db, deps);
  const backup = new BackupService(db, '0.1.0-test', deps);
  const sessions = new SessionService(db);
  const c = await col.createCollection('Lager A');
  await col.addItems(c.id, [
    { symbology: 'EAN13', value: '0000000000000', source: 'manual', quantity: 2, label: 'Nullen' },
    { symbology: 'EAN13', value: EAN_A, source: 'camera' },
    { symbology: 'QRCode', value: '=HYPERLINK("x")', source: 'manual' }
  ]);
  await col.replaceCatalog([{ value: EAN_A, active: true, source: 'a.csv', importedAt: 't' }]);
  await col.checkAgainstCatalog(c.id);
  await col.listProfiles();
  await col.saveTemplate({
    id: 't1', name: 'Vorlage', pattern: '2 063701 028{XX}{C}', createdAt: 'c', updatedAt: 'u',
    definition: { id: 'd', symbology: 'EAN13', prefix: '2063701028', suffixBeforeCheckDigit: '', variableWidth: 2, start: '0', end: '96', step: '12', checksumMode: 'gs1-mod10', overflow: 'stop' }
  });
  await sessions.saveSession({ id: 's1', collectionId: c.id, startedAt: 't', mode: 'auto', appVersion: '0.1.0', entryCount: 4, interleaved: true, status: 'finished' });
  await sessions.appendEvents([
    { id: 's1-1', sessionId: 's1', timestamp: 't1', type: 'displayed', evidence: 'player', entryId: 'e1', detail: 'Position 1' },
    { id: 's1-2', sessionId: 's1', timestamp: 't1', type: 'blanked', evidence: 'player' }
  ]);
  return { db, col, backup, sessions, cid: c.id };
}

async function snapshotOf(db: BarqDatabase): Promise<Record<string, unknown[]>> {
  const sort = <T extends { id?: string; value?: string }>(rows: T[]): T[] => [...rows].sort((a, b) => (a.id ?? a.value ?? '').localeCompare(b.id ?? b.value ?? ''));
  return {
    collections: sort(await db.collections.toArray()),
    items: sort(await db.items.toArray()),
    templates: sort(await db.templates.toArray()),
    profiles: sort(await db.profiles.toArray()),
    catalog: sort(await db.catalog.toArray()),
    sessions: sort(await db.sessions.toArray()),
    events: sort(await db.events.toArray())
  };
}

describe('JSON-Backup', () => {
  it('Export enthält Format, Version, Zeitpunkt, App-Version und alle Tabellen', async () => {
    const { backup } = await populated();
    const file = await backup.createBackup();
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(file.appVersion).toBe('0.1.0-test');
    expect(file.exportedAt).toMatch(/^2026-11-24T/);
    expect(file.data.collections).toHaveLength(1);
    expect(file.data.items).toHaveLength(3);
    expect(file.data.catalog).toHaveLength(1);
    expect(file.data.sessions).toHaveLength(1);
    expect(file.data.events).toHaveLength(2);
    expect(file.data.profiles.length).toBeGreaterThan(0);
    expect(file.data.templates).toHaveLength(1);
  });

  it('Export → Import in eine frische Datenbank ist verlustfrei (praktischer Restore-Test)', async () => {
    const { db, backup } = await populated();
    const json = await backup.exportJson();
    const target = freshDb();
    const summary = await new BackupService(target, 'x', testDeps()).importJson(json);
    expect(summary).toMatchObject({ collections: 1, items: 3, templates: 1, catalog: 1, sessions: 1, events: 2 });
    expect(await snapshotOf(target)).toEqual(await snapshotOf(db));
    const zero = await target.items.where('value').equals('0000000000000').first();
    expect(zero?.value).toBe('0000000000000');
  });

  it('Import ersetzt vorhandene Daten vollständig', async () => {
    const { backup } = await populated();
    const json = await backup.exportJson();
    const target = freshDb();
    const tcol = new CollectionService(target, testDeps());
    const old = await tcol.createCollection('Alt');
    await tcol.addItem(old.id, { symbology: 'EAN13', value: EAN_B, source: 'manual' });
    await new BackupService(target, 'x', testDeps()).importJson(json);
    expect((await tcol.listCollections()).map((c) => c.name)).toEqual(['Lager A']);
    expect(await target.items.where('value').equals(EAN_B).count()).toBe(0);
  });

  it.each([
    ['kein JSON', 'das ist kein json'],
    ['leer', ''],
    ['falsches Format', JSON.stringify({ format: 'x' })],
    ['neuere Version', JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 99 })],
    ['Schemafehler', JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: 1, exportedAt: 't', appVersion: 'v', data: { collections: 'x' } })]
  ])('ungültige Datei (%s) verändert vorhandene Daten nicht', async (_n, text) => {
    const { db, backup } = await populated();
    const before = await snapshotOf(db);
    expect(await codeOf(backup.importJson(text))).toBe('ERR_IMPORT_SCHEMA_INVALID');
    expect(await snapshotOf(db)).toEqual(before);
  });

  it('Referenzfehler im Backup (Eintrag → unbekannte Sammlung) wird vor dem Schreiben erkannt', async () => {
    const { db, backup } = await populated();
    const file = JSON.parse(await backup.exportJson()) as { data: { items: Array<Record<string, unknown>> } };
    file.data.items[0]!['collectionId'] = 'gibt-es-nicht';
    const before = await snapshotOf(db);
    expect(await codeOf(backup.importJson(JSON.stringify(file)))).toBe('ERR_IMPORT_SCHEMA_INVALID');
    expect(await snapshotOf(db)).toEqual(before);
  });

  it('Fehler MITTEN im Schreiben rollt die gesamte Transaktion zurück (keine halbe Wiederherstellung)', async () => {
    const { db, backup } = await populated();
    const json = await backup.exportJson();
    const before = await snapshotOf(db);
    const original = db.events.bulkAdd.bind(db.events);
    db.events.bulkAdd = (() => Promise.reject(new Error('Schreibfehler'))) as unknown as typeof db.events.bulkAdd;
    expect(await codeOf(backup.importJson(json))).toBe('ERR_STORAGE_WRITE_FAILED');
    db.events.bulkAdd = original;
    expect(await snapshotOf(db)).toEqual(before);
  });

  it('leere Datenbank exportiert und importiert sich', async () => {
    const db = freshDb();
    const svc = new BackupService(db, 'x', testDeps());
    const json = await svc.exportJson();
    const summary = await svc.importJson(json);
    expect(Object.values(summary).every((n) => n === 0)).toBe(true);
  });
});

describe('CSV-Austausch Sammlung', () => {
  it('Export → Import in andere Sammlung erhält Werte (führende Nullen, Formelschutz, Mengen, Labels)', async () => {
    const { col, backup, cid } = await populated();
    const csv = await backup.exportCollectionCsv(cid);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    const target = await col.createCollection('Ziel');
    const report = await backup.importCollectionCsv(target.id, csv);
    expect(report).toEqual({ imported: 3, aborted: false, errors: [] });
    const items = await col.listItems(target.id);
    expect(items.map((i) => [i.symbology, i.value, i.quantity, i.label, i.source])).toEqual([
      ['EAN13', '0000000000000', 2, 'Nullen', 'import'],
      ['EAN13', EAN_A, 1, undefined, 'import'],
      ['QRCode', '=HYPERLINK("x")', 1, undefined, 'import']
    ]);
  });

  it('Fehler im Standard (abort): nichts wird importiert, Bericht pro Zeile', async () => {
    const { db, col, backup } = await populated();
    const target = await col.createCollection('Ziel');
    const csv = `symbology,value\nEAN13,${EAN_A}\nEAN13,4006381333930\nEAN13,${EAN_B}\n`;
    const report = await backup.importCollectionCsv(target.id, csv);
    expect(report.aborted).toBe(true);
    expect(report.imported).toBe(0);
    expect(report.errors.map((e) => [e.line, e.code])).toEqual([[3, 'ERR_CHECKSUM_INVALID']]);
    expect(await db.items.where('collectionId').equals(target.id).count()).toBe(0);
  });

  it('skip-invalid importiert gültige Zeilen und meldet die fehlerhaften', async () => {
    const { col, backup } = await populated();
    const target = await col.createCollection('Ziel');
    const csv = `symbology,value\nEAN13,${EAN_A}\nEAN13,4006381333930\nEAN13,${EAN_B}\n`;
    const report = await backup.importCollectionCsv(target.id, csv, { onError: 'skip-invalid' });
    expect(report).toMatchObject({ imported: 2, aborted: false });
    expect(report.errors).toHaveLength(1);
    expect((await col.listItems(target.id)).map((i) => i.value)).toEqual([EAN_A, EAN_B]);
  });

  it('Standardsymbologie und Semikolon-CSV ohne Symbologiespalte; Duplikate werden gemäß Regel behandelt', async () => {
    const { col, backup } = await populated();
    const target = await col.createCollection('Ziel');
    const csv = `Code;Menge\n${EAN_A};2\n${EAN_A};3\n`;
    const merged = await backup.importCollectionCsv(target.id, csv, { defaultSymbology: 'EAN13' });
    expect(merged.imported).toBe(2);
    expect((await col.listItems(target.id)).map((i) => i.quantity)).toEqual([5]);
    const other = await col.createCollection('Ziel2');
    await backup.importCollectionCsv(other.id, csv, { defaultSymbology: 'EAN13', duplicate: 'append' });
    expect((await col.listItems(other.id)).map((i) => i.quantity)).toEqual([2, 3]);
  });

  it('strukturelle Fehler und unbekannte Sammlung', async () => {
    const { col, backup } = await populated();
    const target = await col.createCollection('Ziel');
    expect(await codeOf(backup.importCollectionCsv(target.id, ''))).toBe('ERR_IMPORT_CSV_INVALID');
    expect(await codeOf(backup.importCollectionCsv(target.id, 'a,b\n1,2\n'))).toBe('ERR_IMPORT_CSV_INVALID');
    expect(await codeOf(backup.importCollectionCsv('zzz', `value\n${EAN_A}\n`, { defaultSymbology: 'EAN13' }))).toBe('ERR_NOT_FOUND');
    expect(await codeOf(backup.exportCollectionCsv('zzz'))).toBe('ERR_NOT_FOUND');
  });

  it('nur Kopfzeile: nichts zu importieren', async () => {
    const { col, backup } = await populated();
    const target = await col.createCollection('Ziel');
    expect(await backup.importCollectionCsv(target.id, 'symbology,value\n')).toEqual({ imported: 0, aborted: false, errors: [] });
  });
});

describe('CSV-Austausch Artikelstamm', () => {
  it('importiert, ersetzt und ermöglicht den Abgleich', async () => {
    const { col, backup, cid } = await populated();
    const report = await backup.importCatalogCsv(`EAN,Aktiv\n${EAN_A},nein\n${EAN_B},ja\n`, 'stamm.csv');
    expect(report).toEqual({ imported: 2, aborted: false, errors: [] });
    expect(await col.catalogSize()).toBe(2);
    const summary = await col.checkAgainstCatalog(cid);
    expect(summary.inactive).toBe(1);
    expect(summary.unknown).toBe(2); // Nullen und QR sind nicht im Stamm
    const item = (await col.listItems(cid)).find((i) => i.value === EAN_A);
    expect(item?.catalogSource).toBe('stamm.csv');
  });

  it('Fehler: abort lässt den alten Stamm unangetastet, skip-invalid übernimmt gültige', async () => {
    const { col, backup } = await populated();
    const csv = 'EAN,Aktiv\n1,ja\n1,ja\n2,vielleicht\n3,nein\n';
    const aborted = await backup.importCatalogCsv(csv, 's.csv');
    expect(aborted).toMatchObject({ imported: 0, aborted: true });
    expect(aborted.errors).toHaveLength(2);
    expect(await col.catalogSize()).toBe(1); // alter Stand aus populated()
    const skipped = await backup.importCatalogCsv(csv, 's.csv', 'skip-invalid');
    expect(skipped).toMatchObject({ imported: 2, aborted: false });
    expect(await col.catalogSize()).toBe(2);
  });
});

describe('SessionService', () => {
  it('speichert Sitzungen und Ereignisse, sortiert und idempotent', async () => {
    const { sessions } = await populated();
    await sessions.saveSession({ id: 's0', collectionId: 'c', startedAt: 'a-früher', mode: 'manual', appVersion: 'v', entryCount: 1, interleaved: false, status: 'running' });
    expect((await sessions.listSessions()).map((s) => s.id)).toEqual(['s1', 's0']);
    expect(await sessions.setStatus('s0', 'aborted')).toBe(true);
    expect(await sessions.setStatus('zzz', 'error')).toBe(false);
    expect((await sessions.listSessions()).find((s) => s.id === 's0')?.status).toBe('aborted');

    await sessions.appendEvents([{ id: 's1-10', sessionId: 's1', timestamp: 't1', type: 'paused', evidence: 'operator' }]);
    await sessions.appendEvents([{ id: 's1-10', sessionId: 's1', timestamp: 't1', type: 'paused', evidence: 'operator' }]); // idempotent
    await sessions.appendEvents([]);
    expect((await sessions.listEvents('s1')).map((e) => e.id)).toEqual(['s1-1', 's1-2', 's1-10']);
    expect(await sessions.listEvents('leer')).toEqual([]);
  });
});
