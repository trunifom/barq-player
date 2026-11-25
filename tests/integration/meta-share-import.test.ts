import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, type ErrorCode } from '../../src/domain/errors';
import { BackupService } from '../../src/application/backup-service';
import { CollectionService } from '../../src/application/collection-service';
import { ImportService } from '../../src/application/import-service';
import { PlaybackController, type PlaybackRequest } from '../../src/application/playback-service';
import { SessionService } from '../../src/application/session-service';
import { buildShareFile, parseShareText } from '../../src/domain/share-format';
import { ManualScheduler } from '../helpers/scheduler';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

const A = '4006381333931';
const B = '5901234123457';
const TODAY = '2026-11-24';

function setup(): { col: CollectionService; backup: BackupService; imp: ImportService } {
  const db = freshDb();
  const deps = testDeps();
  return { col: new CollectionService(db, deps), backup: new BackupService(db, '0.2.0-test', deps), imp: new ImportService(db, '0.2.0-test', deps) };
}

function userMessageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AppError) return e.userMessage;
    throw e;
  }
  throw new Error('kein Fehler');
}

async function codeOf(p: Promise<unknown>): Promise<ErrorCode> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('Zusatzangaben speichern und ändern', () => {
  it('addItem speichert Wort, Nutzen, Satz, Tags und Ablaufdatum (deutsches Datum wird normalisiert)', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    const item = await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: ' Apfel ', purpose: 'Test', note: 'Ein Satz', tags: 'Obst, Aktion', expiresAt: '31.12.2026' });
    expect(item).toMatchObject({ label: 'Apfel', purpose: 'Test', note: 'Ein Satz', tags: ['Obst', 'Aktion'], expiresAt: '2026-12-31' });
    expect((await col.listItems(c.id))[0]).toMatchObject({ expiresAt: '2026-12-31' });
  });

  it('ohne Zusatzangaben entstehen keine leeren Felder', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    const item = await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual' });
    for (const k of ['label', 'purpose', 'note', 'tags', 'expiresAt']) expect(k in item).toBe(false);
  });

  it('ungültiges Datum oder zu langer Text verhindert das Speichern ALLER Einträge (mit Positionsangabe)', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    await expect(
      col.addItems(c.id, [
        { symbology: 'EAN13', value: A, source: 'manual' },
        { symbology: 'EAN13', value: B, source: 'manual', expiresAt: '2026-02-30' }
      ])
    ).rejects.toThrow(/Eintrag 2: Ablaufdatum/);
    expect(await col.countItems(c.id)).toBe(0);
    expect(await codeOf(col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'x'.repeat(101) }))).toBe('ERR_SYNTAX_INVALID');
  });

  it('beim Zusammenfassen gleicher Codes bleiben vorhandene Angaben, fehlende werden ergänzt', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'Alt', tags: ['a'] });
    const merged = await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'Neu', purpose: 'P', tags: ['b'], expiresAt: '2027-01-01' });
    expect(merged).toMatchObject({ label: 'Alt', purpose: 'P', tags: ['a', 'b'], expiresAt: '2027-01-01', quantity: 2 });
  });

  it('updateItemMeta ersetzt alle Angaben und entfernt nicht angegebene; Wert und Menge bleiben', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    const item = await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', quantity: 3, label: 'Alt', note: 'weg', expiresAt: '2026-01-01' });
    const updated = await col.updateItemMeta(item.id, { label: 'Neu', tags: ['x'] });
    expect(updated).toMatchObject({ label: 'Neu', tags: ['x'], value: A, quantity: 3 });
    expect('note' in updated).toBe(false);
    expect('expiresAt' in updated).toBe(false);
    expect((await col.listItems(c.id))[0]).toEqual(updated);
  });

  it('updateItemMeta: Fehler ändern nichts; unbekannte ID → ERR_NOT_FOUND', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    const item = await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'Bleibt' });
    expect(await codeOf(col.updateItemMeta(item.id, { expiresAt: 'bald' }))).toBe('ERR_SYNTAX_INVALID');
    expect((await col.listItems(c.id))[0]?.label).toBe('Bleibt');
    expect(await codeOf(col.updateItemMeta('gibt-es-nicht', {}))).toBe('ERR_NOT_FOUND');
  });

  it('setExpiry setzt und löscht das Datum für mehrere Einträge atomar', async () => {
    const { col } = setup();
    const c = await col.createCollection('L');
    const [i1, i2] = await col.addItems(c.id, [
      { symbology: 'EAN13', value: A, source: 'manual' },
      { symbology: 'EAN13', value: B, source: 'manual', expiresAt: '2026-01-01' }
    ]);
    expect(await col.setExpiry([i1!.id, i2!.id], '1.2.2027')).toBe(2);
    expect((await col.listItems(c.id)).map((i) => i.expiresAt)).toEqual(['2027-02-01', '2027-02-01']);
    expect(await col.setExpiry([i1!.id, i2!.id], null)).toBe(2);
    expect((await col.listItems(c.id)).map((i) => i.expiresAt)).toEqual([undefined, undefined]);
    expect(await col.setExpiry([], '2027-01-01')).toBe(0);
    expect(await codeOf(col.setExpiry([i1!.id], 'xx'))).toBe('ERR_SYNTAX_INVALID');
    expect(await codeOf(col.setExpiry([i1!.id], ''))).toBe('ERR_SYNTAX_INVALID');
  });
});

describe('Teilen: Export und Import einer Sammlung', () => {
  it('Rundreise: exportierte Sammlung wird auf einem anderen Gerät als NEUE Sammlung importiert', async () => {
    const a = setup();
    const c = await a.col.createCollection('Lager');
    await a.col.addItems(c.id, [
      { symbology: 'EAN13', value: A, source: 'manual', quantity: 2, label: 'Apfel', purpose: 'Test', note: 'Satz', tags: ['t'], expiresAt: '2026-12-31' },
      { symbology: 'QRCode', value: 'Hallo Welt', source: 'manual' }
    ]);
    const { json } = await a.backup.exportCollectionShare(c.id);
    const b = setup(); // „anderes Gerät“
    const plan = b.imp.inspect(json, TODAY);
    expect(plan.kind).toBe('collections');
    if (plan.kind !== 'collections') return;
    expect(plan).toMatchObject({ source: 'share', totalItems: 2, expiredItems: 0 });
    const result = await b.imp.commitCollections(plan.files);
    expect(result).toMatchObject({ collections: 1, items: 2, names: ['Lager'] });
    const [col] = await b.col.listCollections();
    const items = await b.col.listItems(col!.id);
    expect(items.map((i) => [i.symbology, i.value, i.quantity, i.source])).toEqual([['EAN13', A, 2, 'import'], ['QRCode', 'Hallo Welt', 1, 'import']]);
    expect(items[0]).toMatchObject({ label: 'Apfel', purpose: 'Test', note: 'Satz', tags: ['t'], expiresAt: '2026-12-31', checksumStatus: 'valid' });
  });

  it('Import überschreibt nichts: gleicher Name wird zu „Name (2)“, „Name (3)“ …', async () => {
    const { col, backup, imp } = setup();
    const c = await col.createCollection('Lager');
    await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual' });
    const { json } = await backup.exportCollectionShare(c.id);
    const plan = imp.inspect(json, TODAY);
    if (plan.kind !== 'collections') throw new Error('falscher Plan');
    await imp.commitCollections(plan.files);
    await imp.commitCollections(plan.files);
    expect((await col.listCollections()).map((x) => x.name).sort()).toEqual(['Lager', 'Lager (2)', 'Lager (3)']);
    expect(await col.countItems(c.id)).toBe(1); // Original unberührt
  });

  it('zählt abgelaufene Codes im Plan und importiert sie trotzdem (als abgelaufen erkennbar)', async () => {
    const { col, imp } = setup();
    const file = buildShareFile('Alt', [], { exportedAt: '', appVersion: '' });
    file.items.push({ symbology: 'EAN13', value: A, quantity: 1, expiresAt: '2026-01-01' }, { symbology: 'EAN13', value: B, quantity: 1, expiresAt: '2027-01-01' });
    const plan = imp.inspect(JSON.stringify(file), TODAY);
    if (plan.kind !== 'collections') throw new Error('falscher Plan');
    expect(plan.expiredItems).toBe(1);
    await imp.commitCollections(plan.files);
    const [c] = await col.listCollections();
    expect((await col.listItems(c!.id)).map((i) => i.expiresAt)).toEqual(['2026-01-01', '2027-01-01']);
  });

  it('ein fehlerhafter Code in der Datei verhindert den Import komplett (inspect wirft, nichts gespeichert)', async () => {
    const { col, imp } = setup();
    const file = buildShareFile('Kaputt', [], { exportedAt: '', appVersion: '' });
    file.items.push({ symbology: 'EAN13', value: A, quantity: 1 }, { symbology: 'EAN13', value: '4006381333930', quantity: 1 });
    expect(() => imp.inspect(JSON.stringify(file), TODAY)).toThrow(/Code 2/);
    expect(await col.listCollections()).toEqual([]);
  });

  it('exportCollectionText und unbekannte Sammlung', async () => {
    const { col, backup } = setup();
    const c = await col.createCollection('Liste');
    await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'Apfel' });
    expect((await backup.exportCollectionText(c.id)).text).toBe(`Liste\n${A}  Apfel`);
    expect(await codeOf(backup.exportCollectionShare('x'))).toBe('ERR_NOT_FOUND');
    expect(await codeOf(backup.exportCollectionText('x'))).toBe('ERR_NOT_FOUND');
    expect(parseShareText((await backup.exportCollectionShare(c.id, { compact: true })).json).items).toHaveLength(1);
    expect((await backup.exportCollectionShare(c.id, { compact: true })).json).not.toContain('\n');
  });
});

describe('Import von Backup, CSV und Listen', () => {
  it('ein Voll-Backup wird als neue Sammlungen übernommen, vorhandene Daten bleiben', async () => {
    const a = setup();
    const c1 = await a.col.createCollection('Eins');
    const c2 = await a.col.createCollection('Zwei');
    await a.col.addItem(c1.id, { symbology: 'EAN13', value: A, source: 'manual', expiresAt: '2026-05-05' });
    await a.col.addItem(c2.id, { symbology: 'EAN13', value: B, source: 'manual' });
    const backupJson = await a.backup.exportJson();
    const b = setup();
    await b.col.createCollection('Eins'); // Namenskonflikt
    const plan = b.imp.inspect(backupJson, TODAY);
    if (plan.kind !== 'collections') throw new Error('falscher Plan');
    expect(plan).toMatchObject({ source: 'backup', totalItems: 2, expiredItems: 1 });
    await b.imp.commitCollections(plan.files);
    expect((await b.col.listCollections()).map((x) => x.name).sort()).toEqual(['Eins', 'Eins (2)', 'Zwei']);
  });

  it('CSV mit allen Spalten (deutsche Namen) inkl. Ablaufdatum und Tags', async () => {
    const { col, imp } = setup();
    const csv = `Code;Format;Menge;Wort;Nutzen;Satz;Tags;Ablaufdatum\n${A};EAN-13;2;Apfel;Test;Ein Satz;"Obst, Aktion";31.12.2026\n${B};ean13;;Birne;;;;\n`;
    const plan = imp.inspect(csv, TODAY);
    expect(plan).toMatchObject({ kind: 'rows', format: 'csv', rowCount: 2, needsSymbology: false, errors: [] });
    if (plan.kind !== 'rows') return;
    const report = await imp.commitRows(plan, { newName: 'CSV-Import' }, { defaultSymbology: 'EAN13' });
    expect(report).toMatchObject({ imported: 2, aborted: false });
    const items = await col.listItems(report.collectionId!);
    expect(items[0]).toMatchObject({ value: A, quantity: 2, label: 'Apfel', purpose: 'Test', note: 'Ein Satz', tags: ['Obst', 'Aktion'], expiresAt: '2026-12-31' });
    expect(items[1]).toMatchObject({ value: B, quantity: 1, label: 'Birne' });
  });

  it('CSV mit ungültigem Datum: Abbruch ohne Import und ohne leere neue Sammlung; mit „überspringen“ werden gültige Zeilen importiert', async () => {
    const { col, imp } = setup();
    const csv = `Code,Format,Ablaufdatum\n${A},EAN13,2026-13-45\n${B},EAN13,2026-12-31\n`;
    const plan = imp.inspect(csv, TODAY);
    if (plan.kind !== 'rows') throw new Error('falscher Plan');
    expect(plan.errors[0]?.message).toContain('Zeile 2');
    const aborted = await imp.commitRows(plan, { newName: 'X' }, { defaultSymbology: 'EAN13' });
    expect(aborted).toMatchObject({ imported: 0, aborted: true, collectionId: null });
    expect(await col.listCollections()).toEqual([]);
    const skipped = await imp.commitRows(plan, { newName: 'X' }, { defaultSymbology: 'EAN13', onError: 'skip-invalid' });
    expect(skipped).toMatchObject({ imported: 1, aborted: false });
    expect((await col.listItems(skipped.collectionId!))[0]?.value).toBe(B);
  });

  it('CSV ohne Format-Spalte verlangt ein Standardformat; Import in eine vorhandene Sammlung fasst Mengen zusammen', async () => {
    const { col, imp } = setup();
    const c = await col.createCollection('Ziel');
    await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual' });
    const plan = imp.inspect(`EAN;Menge\n${A};4\n${B};1\n`, TODAY);
    expect(plan).toMatchObject({ kind: 'rows', needsSymbology: true, rowCount: 2 });
    if (plan.kind !== 'rows') return;
    const r = await imp.commitRows(plan, { collectionId: c.id }, { defaultSymbology: 'EAN13' });
    expect(r).toMatchObject({ imported: 2, collectionId: c.id });
    expect((await col.listItems(c.id)).map((i) => [i.value, i.quantity])).toEqual([[A, 5], [B, 1]]);
  });

  it('einfache Liste (ein Code pro Zeile): Format wählbar, Fehler zeilengenau, Abbruch räumt auf', async () => {
    const { col, imp } = setup();
    const plan = imp.inspect(`${A}\n\n${B}\n12345\n`, TODAY);
    expect(plan).toMatchObject({ kind: 'rows', format: 'lines', needsSymbology: true });
    if (plan.kind !== 'rows') return;
    const aborted = await imp.commitRows(plan, { newName: 'Liste' }, { defaultSymbology: 'EAN13' });
    expect(aborted.aborted).toBe(true);
    expect(aborted.errors.map((e) => e.line)).toEqual([4]);
    expect(await col.listCollections()).toEqual([]);
    const ok = await imp.commitRows(plan, { newName: 'Liste' }, { defaultSymbology: 'EAN13', onError: 'skip-invalid' });
    expect(ok.imported).toBe(2);
  });

  it('unbrauchbare Eingaben: leer, anderes JSON, Einzelwert-Text', async () => {
    const { imp } = setup();
    expect(userMessageOf(() => imp.inspect('  \n ', TODAY))).toContain('leer');
    expect(userMessageOf(() => imp.inspect('{"a":1}', TODAY))).toContain('keine BarQPlayer');
    expect(() => imp.inspect('{kaputt', TODAY)).toThrow(AppError);
    expect(imp.inspect(A, TODAY)).toMatchObject({ kind: 'rows', format: 'lines', rowCount: 1 });
  });
});

describe('Backup und CSV-Export enthalten Zusatzangaben', () => {
  it('JSON-Backup-Rundreise erhält Zusatzangaben und lehnt ein ungültiges Datum ab', async () => {
    const a = setup();
    const c = await a.col.createCollection('L');
    await a.col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'W', purpose: 'N', note: 'S', tags: ['t'], expiresAt: '2026-12-31' });
    const json = await a.backup.exportJson();
    const b = setup();
    await b.backup.importJson(json);
    const [col] = await b.col.listCollections();
    expect((await b.col.listItems(col!.id))[0]).toMatchObject({ label: 'W', purpose: 'N', note: 'S', tags: ['t'], expiresAt: '2026-12-31' });
    const broken = JSON.parse(json) as { data: { items: Array<Record<string, unknown>> } };
    broken.data.items[0]!['expiresAt'] = '2026-02-30';
    expect(await codeOf(b.backup.importJson(JSON.stringify(broken)))).toBe('ERR_IMPORT_SCHEMA_INVALID');
  });

  it('CSV-Export enthält die neuen Spalten und ist wieder importierbar', async () => {
    const a = setup();
    const c = await a.col.createCollection('L');
    await a.col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'W', purpose: 'N', note: 'S', tags: ['t1', 't2'], expiresAt: '2026-12-31' });
    const csv = await a.backup.exportCollectionCsv(c.id);
    expect(csv.split('\n')[0]).toContain('label,purpose,note,tags,expiresAt');
    const b = setup();
    const plan = b.imp.inspect(csv, TODAY);
    if (plan.kind !== 'rows') throw new Error('falscher Plan');
    const r = await b.imp.commitRows(plan, { newName: 'Zurück' }, { defaultSymbology: 'EAN13' });
    expect((await b.col.listItems(r.collectionId!))[0]).toMatchObject({ label: 'W', purpose: 'N', note: 'S', tags: ['t1', 't2'], expiresAt: '2026-12-31' });
  });
});

describe('Fader überspringt abgelaufene Codes', () => {
  const PROFILE = { id: 'p', name: 'Test', displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 1000 };

  function player(): { col: CollectionService; ctrl: PlaybackController } {
    const db = freshDb();
    const col = new CollectionService(db, testDeps());
    let n = 0;
    const ctrl = new PlaybackController({
      collections: col,
      sessions: new SessionService(db),
      scheduler: new ManualScheduler(),
      newId: () => `sess-${++n}`,
      nowIso: () => '2026-11-24T10:00:00.000Z',
      appVersion: 'test',
      wakeLock: { acquire: vi.fn(() => Promise.resolve(true)), release: vi.fn(() => Promise.resolve()) }
    });
    return { col, ctrl };
  }
  const req = (cid: string, over: Partial<PlaybackRequest> = {}): PlaybackRequest => ({ collectionId: cid, profile: PROFILE, mode: 'auto', interleave: false, viewport: { width: 360, height: 800 }, devicePixelRatio: 3, ...over });

  it('überspringt abgelaufene Positionen (auch nur am Ablaufdatum selbst nicht) und meldet die Anzahl', async () => {
    const { col, ctrl } = player();
    const c = await col.createCollection('L');
    await col.addItems(c.id, [
      { symbology: 'EAN13', value: A, source: 'manual', expiresAt: '2026-11-23' }, // gestern → abgelaufen
      { symbology: 'EAN13', value: B, source: 'manual', expiresAt: '2026-11-24' }, // heute → noch gültig
      { symbology: 'QRCode', value: 'ohne Datum', source: 'manual' }
    ]);
    const p = await ctrl.prepare(req(c.id));
    expect(p.entries.map((e) => e.value)).toEqual([B, 'ohne Datum']);
    expect(p.skippedExpired).toBe(1);
  });

  it('includeExpired spielt alles ab; Kalibrierung ignoriert das Ablaufdatum', async () => {
    const { col, ctrl } = player();
    const c = await col.createCollection('L');
    await col.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', expiresAt: '2020-01-01' });
    expect((await ctrl.prepare(req(c.id, { includeExpired: true }))).skippedExpired).toBe(0);
    expect((await ctrl.prepare(req(c.id, { calibration: true }))).entries).toHaveLength(20);
  });

  it('sind alle Codes abgelaufen, gibt es eine klare Meldung statt einer leeren Sitzung', async () => {
    const { col, ctrl } = player();
    const c = await col.createCollection('L');
    await col.addItems(c.id, [
      { symbology: 'EAN13', value: A, source: 'manual', expiresAt: '2020-01-01' },
      { symbology: 'EAN13', value: B, source: 'manual', expiresAt: '2020-01-02' }
    ]);
    const e = await ctrl.prepare(req(c.id)).catch((error: unknown) => error);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).userMessage).toContain('Alle 2 Codes dieser Sammlung sind abgelaufen');
  });
});
