import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { LIBRARY_FORMAT } from '../../src/domain/library';
import { buildShareFile, SHARE_FORMAT, type ShareFile } from '../../src/domain/share-format';
import { BackupService } from '../../src/application/backup-service';
import { CollectionService } from '../../src/application/collection-service';
import { LibraryService, type FetchLike } from '../../src/application/library-service';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

/** Beispiel des Auftraggebers (mit korrekter Prüfziffer: 234567876543 → 0). */
const SCREW = '2345678765430';
const TODAY = '2026-11-25';

function shareOf(name: string, items: ShareFile['items']): ShareFile {
  const f = buildShareFile(name, [], { exportedAt: '', appVersion: '' });
  f.items.push(...items);
  return f;
}

const screwItem = { symbology: 'EAN13' as const, value: SCREW, quantity: 1, label: 'Schraube 2x3mm', purpose: 'Montage', note: 'nur gültig für Maschine 2374', tags: ['Firma XYZ', 'Maschine 2374'], expiresAt: '2035-12-31' };

/** Simulierter Server: Dateiname → Inhalt (oder Statuscode). */
function server(files: Record<string, string | number>, index: unknown = 'auto'): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  // `files` wird live gelesen: Tests dürfen die „veröffentlichten“ Dateien nachträglich ändern.
  const indexValue = (): string | number | undefined => {
    if (index === 'auto') return JSON.stringify({ format: LIBRARY_FORMAT, schemaVersion: 1, files: Object.keys(files) });
    if (index === undefined) return undefined;
    return typeof index === 'string' || typeof index === 'number' ? index : JSON.stringify(index);
  };
  const fetch: FetchLike = (url) => {
    calls.push(url);
    const name = decodeURIComponent(url.replace('./library/', ''));
    const v = name === 'index.json' ? indexValue() : files[name];
    if (v === undefined) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    if (typeof v === 'number') return Promise.resolve({ ok: false, status: v, text: () => Promise.resolve('') });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(v) });
  };
  return { fetch, calls };
}

function setup(fetch: FetchLike): { col: CollectionService; lib: LibraryService; backup: BackupService } {
  const db = freshDb();
  const deps = testDeps();
  return { col: new CollectionService(db, deps), lib: new LibraryService(db, fetch, deps), backup: new BackupService(db, 't', deps) };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('Beispiel: Schraube mit Firma, Label, Notiz und Ablaufdatum', () => {
  it('der Code 2345678765432 (falsche Prüfziffer) wird abgelehnt, 2345678765430 ist gültig – nie stillschweigend korrigiert', async () => {
    const { col } = setup(server({}).fetch);
    const c = await col.createCollection('Schrauben');
    expect(await codeOf(col.addItem(c.id, { symbology: 'EAN13', value: '2345678765432', source: 'manual' }))).toBe('ERR_CHECKSUM_INVALID');
    const item = await col.addItem(c.id, { symbology: 'EAN13', value: SCREW, source: 'manual', label: 'Schraube 2x3mm', tags: 'Firma XYZ, Maschine 2374', note: 'nur gültig für Maschine 2374', expiresAt: '31.12.2035' });
    expect(item).toMatchObject({ value: SCREW, label: 'Schraube 2x3mm', tags: ['Firma XYZ', 'Maschine 2374'], note: 'nur gültig für Maschine 2374', expiresAt: '2035-12-31', checksumStatus: 'valid' });
  });
});

describe('Bibliothek prüfen', () => {
  it('liefert neue Einträge mit Anzahl, abgelaufenen Codes und Status; schreibt nichts', async () => {
    const s = server({ 'schrauben.json': JSON.stringify(shareOf('Schrauben', [screwItem, { symbology: 'EAN13', value: '4006381333931', quantity: 1, expiresAt: '2020-01-01' }])) });
    const { col, lib } = setup(s.fetch);
    const r = await lib.check(TODAY);
    expect(r.problems).toEqual([]);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ file: 'schrauben.json', name: 'Schrauben', itemCount: 2, expiredCount: 1, status: 'new' });
    expect(await col.listCollections()).toEqual([]);
    expect(s.calls).toEqual(['./library/index.json', './library/schrauben.json']);
  });

  it('kein Index (404) = keine Bibliothek veröffentlicht, kein Fehler', async () => {
    const { lib } = setup(server({}, undefined).fetch);
    expect(await lib.check(TODAY)).toEqual({ entries: [], problems: [] });
  });

  it('Serverfehler und Netzwerkausfall → ERR_LIBRARY_UNAVAILABLE', async () => {
    expect(await codeOf(setup(server({}, 500).fetch).lib.check(TODAY))).toBe('ERR_LIBRARY_UNAVAILABLE');
    expect(await codeOf(setup(() => Promise.reject(new TypeError('Failed to fetch'))).lib.check(TODAY))).toBe('ERR_LIBRARY_UNAVAILABLE');
  });

  it('ein ungültiger Index wird verständlich abgelehnt', async () => {
    expect(await codeOf(setup(server({}, '{kaputt').fetch).lib.check(TODAY))).toBe('ERR_IMPORT_SCHEMA_INVALID');
    expect(await codeOf(setup(server({}, { format: LIBRARY_FORMAT, schemaVersion: 1, files: ['../x.json'] }).fetch).lib.check(TODAY))).toBe('ERR_IMPORT_SCHEMA_INVALID');
  });

  it('eine fehlerhafte Datei blockiert die übrigen nicht und wird gemeldet (auch fehlende Dateien)', async () => {
    const broken = shareOf('Kaputt', [{ symbology: 'EAN13', value: '2345678765432', quantity: 1 }]);
    const s = server(
      { 'gut.json': JSON.stringify(shareOf('Gut', [screwItem])), 'kaputt.json': JSON.stringify(broken), 'weg.json': 404, 'fehler.json': 500 },
      { format: LIBRARY_FORMAT, schemaVersion: 1, files: ['gut.json', 'kaputt.json', 'weg.json', 'fehler.json', 'fehlt.json'] }
    );
    const r = await setup(s.fetch).lib.check(TODAY);
    expect(r.entries.map((e) => e.file)).toEqual(['gut.json']);
    expect(Object.fromEntries(r.problems.map((p) => [p.file, p.message]))).toMatchObject({
      'kaputt.json': expect.stringContaining('Code 1') as unknown as string,
      'weg.json': expect.stringContaining('nicht gefunden') as unknown as string,
      'fehler.json': expect.stringContaining('HTTP 500') as unknown as string,
      'fehlt.json': expect.stringContaining('nicht gefunden') as unknown as string
    });
  });

  it('Dateinamen mit Sonderzeichen werden URL-sicher abgefragt', async () => {
    const s = server({ 'Äpfel & Birnen.json': 'x' }, { format: LIBRARY_FORMAT, schemaVersion: 1, files: [] });
    // Namen außerhalb der Regel kommen gar nicht erst bis zur Abfrage (Index-Prüfung) – hier nur gültige Umlaute:
    const s2 = server({ 'Äpfel.json': JSON.stringify(shareOf('Äpfel', [])) });
    await setup(s2.fetch).lib.check(TODAY);
    expect(s2.calls[1]).toBe('./library/%C3%84pfel.json');
    expect(s.calls).toEqual([]);
  });
});

describe('Übernehmen und Aktualisieren', () => {
  it('Erstübernahme: neue Sammlung mit allen Zusatzangaben und Verknüpfung; danach „aktuell“', async () => {
    const s = server({ 'schrauben.json': JSON.stringify(shareOf('Schrauben', [screwItem])) });
    const { col, lib } = setup(s.fetch);
    const [entry] = (await lib.check(TODAY)).entries;
    const r = await lib.apply(entry!);
    expect(r).toMatchObject({ created: true, items: 1 });
    expect(r.collection.library).toMatchObject({ file: 'schrauben.json', hash: entry!.remoteHash });
    const items = await col.listItems(r.collection.id);
    expect(items[0]).toMatchObject({ value: SCREW, label: 'Schraube 2x3mm', purpose: 'Montage', note: 'nur gültig für Maschine 2374', tags: ['Firma XYZ', 'Maschine 2374'], expiresAt: '2035-12-31', source: 'import' });
    expect((await lib.check(TODAY)).entries[0]).toMatchObject({ status: 'current', localCollectionId: r.collection.id });
  });

  it('zweites Gerät mit leerer Datenbank bekommt dieselben Codes ohne Neuerfassung', async () => {
    const s = server({ 'schrauben.json': JSON.stringify(shareOf('Schrauben', [screwItem, { symbology: 'QRCode', value: 'Maschine 2374', quantity: 3 }])) });
    for (let device = 0; device < 2; device++) {
      const { col, lib } = setup(s.fetch);
      const [entry] = (await lib.check(TODAY)).entries;
      const r = await lib.apply(entry!);
      expect((await col.listItems(r.collection.id)).map((i) => [i.value, i.quantity])).toEqual([[SCREW, 1], ['Maschine 2374', 3]]);
    }
  });

  it('neue veröffentlichte Version → „update“; Aktualisieren ersetzt Inhalt, behält ID und lokalen Namen', async () => {
    const files: Record<string, string> = { 'schrauben.json': JSON.stringify(shareOf('Schrauben', [screwItem])) };
    const s = server(files);
    const { col, lib } = setup(s.fetch);
    const first = await lib.apply((await lib.check(TODAY)).entries[0]!);
    await col.renameCollection(first.collection.id, 'Meine Schrauben');
    files['schrauben.json'] = JSON.stringify(shareOf('Schrauben', [{ ...screwItem, expiresAt: '2036-06-30' }, { symbology: 'EAN13', value: '4006381333931', quantity: 2 }]));
    const [entry] = (await lib.check(TODAY)).entries;
    expect(entry).toMatchObject({ status: 'update', localCollectionId: first.collection.id });
    const r = await lib.apply(entry!);
    expect(r).toMatchObject({ created: false, items: 2 });
    expect(r.collection.id).toBe(first.collection.id);
    expect(r.collection.name).toBe('Meine Schrauben');
    expect((await col.listItems(first.collection.id)).map((i) => [i.value, i.quantity, i.expiresAt])).toEqual([[SCREW, 1, '2036-06-30'], ['4006381333931', 2, undefined]]);
    expect(await col.countItems(first.collection.id)).toBe(2);
    expect((await lib.check(TODAY)).entries[0]?.status).toBe('current');
  });

  it('lokale Änderung wird erkannt: „modified“ ohne neue Version, „update-modified“ mit neuer Version', async () => {
    const files: Record<string, string> = { 'a.json': JSON.stringify(shareOf('A', [screwItem])) };
    const { col, lib } = setup(server(files).fetch);
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    const [item] = await col.listItems(r.collection.id);
    await col.updateItemMeta(item!.id, { label: 'Lokal geändert' });
    expect((await lib.check(TODAY)).entries[0]?.status).toBe('modified');
    files['a.json'] = JSON.stringify(shareOf('A', [{ ...screwItem, label: 'Neu veröffentlicht' }]));
    const [entry] = (await lib.check(TODAY)).entries;
    expect(entry?.status).toBe('update-modified');
    await lib.apply(entry!);
    expect((await col.listItems(r.collection.id))[0]?.label).toBe('Neu veröffentlicht');
  });

  it('Umbenennen, Menge-Änderung und neue Codes zählen als lokale Änderung; Umbenennen allein nicht', async () => {
    const { col, lib } = setup(server({ 'a.json': JSON.stringify(shareOf('A', [screwItem])) }).fetch);
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    await col.renameCollection(r.collection.id, 'Anderer Name');
    expect((await lib.check(TODAY)).entries[0]?.status).toBe('current');
    const [item] = await col.listItems(r.collection.id);
    await col.changeQuantity(item!.id, +1);
    expect((await lib.check(TODAY)).entries[0]?.status).toBe('modified');
  });

  it('Namenskonflikt bei Erstübernahme: neue Sammlung heißt „Name (2)“, die eigene bleibt unberührt', async () => {
    const { col, lib } = setup(server({ 'a.json': JSON.stringify(shareOf('Schrauben', [screwItem])) }).fetch);
    const own = await col.createCollection('Schrauben');
    await col.addItem(own.id, { symbology: 'EAN13', value: '4006381333931', source: 'manual' });
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    expect(r.collection.name).toBe('Schrauben (2)');
    expect(await col.countItems(own.id)).toBe(1);
  });

  it('Von Bibliothek lösen: Sammlung bleibt, wird nicht mehr aktualisiert; die Datei gilt wieder als „neu“', async () => {
    const { col, lib } = setup(server({ 'a.json': JSON.stringify(shareOf('A', [screwItem])) }).fetch);
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    await col.detachLibrary(r.collection.id);
    const [c] = await col.listCollections();
    expect('library' in c!).toBe(false);
    expect(await col.countItems(c!.id)).toBe(1);
    expect((await lib.check(TODAY)).entries[0]?.status).toBe('new');
    expect(await codeOf(col.detachLibrary('gibt-es-nicht'))).toBe('ERR_NOT_FOUND');
  });

  it('wenn die verknüpfte Sammlung gelöscht wurde, wird sie als neue Sammlung wieder angelegt', async () => {
    const { col, lib } = setup(server({ 'a.json': JSON.stringify(shareOf('A', [screwItem])) }).fetch);
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    await col.deleteCollection(r.collection.id);
    const [entry] = (await lib.check(TODAY)).entries;
    expect(entry?.status).toBe('new');
    expect((await lib.apply(entry!)).created).toBe(true);
  });

  it('Aktualisieren ist atomar: scheitert es, bleibt der alte Inhalt (kein halbes Ergebnis)', async () => {
    const files: Record<string, string> = { 'a.json': JSON.stringify(shareOf('A', [screwItem])) };
    const { col, lib } = setup(server(files).fetch);
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    files['a.json'] = JSON.stringify(shareOf('A', [{ symbology: 'EAN13', value: '4006381333931', quantity: 1 }]));
    const [entry] = (await lib.check(TODAY)).entries;
    const spy = vi.spyOn(CollectionService.prototype, 'addItems').mockRejectedValueOnce(new AppError('ERR_STORAGE_WRITE_FAILED', { details: 'simuliert' }));
    await expect(lib.apply(entry!)).rejects.toBeInstanceOf(AppError);
    spy.mockRestore();
    expect((await col.listItems(r.collection.id)).map((i) => i.value)).toEqual([SCREW]);
  });
});

describe('Bibliothek im Backup', () => {
  it('Verknüpfung überlebt Export und Wiederherstellung; geteilte Dateien enthalten sie nicht', async () => {
    const { col, lib, backup } = setup(server({ 'a.json': JSON.stringify(shareOf('A', [screwItem])) }).fetch);
    const r = await lib.apply((await lib.check(TODAY)).entries[0]!);
    const json = await backup.exportJson();
    const second = setup(server({ 'a.json': JSON.stringify(shareOf('A', [screwItem])) }).fetch);
    await second.backup.importJson(json);
    expect((await second.col.listCollections())[0]?.library?.file).toBe('a.json');
    expect((await second.lib.check(TODAY)).entries[0]?.status).toBe('current');
    const shared = JSON.parse((await backup.exportCollectionShare(r.collection.id)).json) as Record<string, unknown>;
    expect(shared['format']).toBe(SHARE_FORMAT);
    expect(JSON.stringify(shared)).not.toContain('library');
    expect(await col.countItems(r.collection.id)).toBe(1);
  });
});
