import { afterEach, describe, expect, it } from 'vitest';
import { AppError, type ErrorCode } from '../../src/domain/errors';
import { CollectionService } from '../../src/application/collection-service';
import { DEFAULT_PROFILES } from '../../src/domain/profiles';
import type { BarqDatabase } from '../../src/adapters/persistence/db';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

async function setup(): Promise<{ db: BarqDatabase; svc: CollectionService; cid: string }> {
  const db = freshDb();
  const svc = new CollectionService(db, testDeps());
  const c = await svc.createCollection('Lager');
  return { db, svc, cid: c.id };
}

async function codeOf(p: Promise<unknown>): Promise<ErrorCode> {
  try {
    await p;
  } catch (e: unknown) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  throw new Error('kein Fehler geworfen');
}

describe('Sammlungen', () => {
  it('anlegen, auflisten (zuletzt geänderte zuerst), umbenennen, löschen', async () => {
    const db = freshDb();
    const svc = new CollectionService(db, testDeps());
    const a = await svc.createCollection('  Alpha  ');
    const b = await svc.createCollection('Beta');
    expect(a.name).toBe('Alpha');
    expect((await svc.listCollections()).map((c) => c.name)).toEqual(['Beta', 'Alpha']);
    const renamed = await svc.renameCollection(a.id, 'Gamma');
    expect(renamed.name).toBe('Gamma');
    expect(renamed.updatedAt > a.updatedAt).toBe(true);
    expect((await svc.listCollections()).map((c) => c.name)).toEqual(['Gamma', 'Beta']);
    await svc.deleteCollection(b.id);
    expect((await svc.listCollections()).map((c) => c.name)).toEqual(['Gamma']);
  });

  it('validiert Namen', async () => {
    const { svc, cid } = await setup();
    for (const bad of ['', '   ', 'x'.repeat(101)]) {
      expect(await codeOf(svc.createCollection(bad))).toBe('ERR_SYNTAX_INVALID');
      expect(await codeOf(svc.renameCollection(cid, bad))).toBe('ERR_SYNTAX_INVALID');
    }
    expect((await svc.createCollection('x'.repeat(100))).name).toHaveLength(100);
  });

  it('unbekannte Sammlung → ERR_NOT_FOUND', async () => {
    const { svc } = await setup();
    expect(await codeOf(svc.renameCollection('zzz', 'x'))).toBe('ERR_NOT_FOUND');
    expect(await codeOf(svc.deleteCollection('zzz'))).toBe('ERR_NOT_FOUND');
    expect(await codeOf(svc.addItem('zzz', { symbology: 'QRCode', value: 'x', source: 'manual' }))).toBe('ERR_NOT_FOUND');
  });

  it('Löschen entfernt Einträge der Sammlung, nicht anderer Sammlungen', async () => {
    const { db, svc, cid } = await setup();
    const other = await svc.createCollection('Andere');
    await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual' });
    await svc.addItem(other.id, { symbology: 'EAN13', value: EAN_A, source: 'manual' });
    await svc.deleteCollection(cid);
    expect(await db.items.count()).toBe(1);
    expect((await svc.listItems(other.id))).toHaveLength(1);
  });
});

describe('Einträge hinzufügen', () => {
  it('speichert gültige Codes als Strings mit getrennten Statusfeldern', async () => {
    const { svc, cid } = await setup();
    const item = await svc.addItem(cid, { symbology: 'EAN13', value: '0000000000000', source: 'camera', label: '  Stift ' });
    expect(item).toMatchObject({
      value: '0000000000000', position: 0, quantity: 1, source: 'camera', syntaxStatus: 'valid', checksumStatus: 'valid',
      catalogStatus: 'unchecked', label: 'Stift'
    });
    const qr = await svc.addItem(cid, { symbology: 'QRCode', value: ' https://x.example/a b ', source: 'manual' });
    expect(qr.value).toBe(' https://x.example/a b ');
    expect(qr.checksumStatus).toBe('not-applicable');
    expect((await svc.listItems(cid)).map((i) => i.position)).toEqual([0, 1]);
  });

  it('lehnt ungültige Werte ab und speichert nichts (keine stille Korrektur)', async () => {
    const { db, svc, cid } = await setup();
    expect(await codeOf(svc.addItem(cid, { symbology: 'EAN13', value: '4006381333930', source: 'manual' }))).toBe('ERR_CHECKSUM_INVALID');
    expect(await codeOf(svc.addItem(cid, { symbology: 'EAN13', value: '123', source: 'manual' }))).toBe('ERR_SYNTAX_INVALID');
    expect(await codeOf(svc.addItem(cid, { symbology: 'QRCode', value: '', source: 'manual' }))).toBe('ERR_SYNTAX_INVALID');
    expect(await db.items.count()).toBe(0);
  });

  it('Duplikatregel merge (Standard) erhöht die Menge, append legt neue Position an', async () => {
    const { svc, cid } = await setup();
    await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'camera' });
    const merged = await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'camera', quantity: 2 });
    expect(merged.quantity).toBe(3);
    expect(await svc.listItems(cid)).toHaveLength(1);
    await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'camera' }, 'append');
    expect((await svc.listItems(cid)).map((i) => [i.position, i.quantity])).toEqual([[0, 3], [1, 1]]);
  });

  it('gleicher Wert in anderer Symbologie ist kein Duplikat', async () => {
    const { svc, cid } = await setup();
    await svc.addItem(cid, { symbology: 'Code128', value: '12345', source: 'manual' });
    await svc.addItem(cid, { symbology: 'QRCode', value: '12345', source: 'manual' });
    expect(await svc.listItems(cid)).toHaveLength(2);
  });

  it('addItems ist atomar: ein ungültiger Eintrag verhindert alles und nennt die Eingabeposition', async () => {
    const { db, svc, cid } = await setup();
    const before = (await db.collections.get(cid))?.updatedAt;
    let message = '';
    try {
      await svc.addItems(cid, [
        { symbology: 'EAN13', value: EAN_A, source: 'import' },
        { symbology: 'EAN13', value: EAN_B, source: 'import' },
        { symbology: 'EAN13', value: '4006381333930', source: 'import' }
      ]);
    } catch (e: unknown) {
      message = (e as AppError).userMessage;
    }
    expect(message).toContain('Eintrag 3');
    expect(await db.items.count()).toBe(0);
    expect((await db.collections.get(cid))?.updatedAt).toBe(before);
  });

  it('addItems fasst Duplikate innerhalb der Eingabe zusammen und liefert Ergebnisse in Eingabereihenfolge', async () => {
    const { svc, cid } = await setup();
    const res = await svc.addItems(cid, [
      { symbology: 'EAN13', value: EAN_A, source: 'import' },
      { symbology: 'EAN13', value: EAN_B, source: 'import' },
      { symbology: 'EAN13', value: EAN_A, source: 'import', quantity: 4 }
    ]);
    expect(res).toHaveLength(3);
    expect(res[0]?.id).toBe(res[2]?.id);
    expect(res[2]?.quantity).toBe(5);
    expect((await svc.listItems(cid)).map((i) => [i.value, i.quantity])).toEqual([[EAN_A, 5], [EAN_B, 1]]);
  });

  it('Menge: Grenzen 1..9999, auch beim Zusammenführen', async () => {
    const { svc, cid } = await setup();
    for (const q of [0, -1, 1.5, 10_000, Number.NaN]) {
      expect(await codeOf(svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual', quantity: q }))).toBe('ERR_SYNTAX_INVALID');
    }
    await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual', quantity: 9999 });
    expect(await codeOf(svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual' }))).toBe('ERR_SYNTAX_INVALID');
    expect((await svc.listItems(cid))[0]?.quantity).toBe(9999);
  });

  it('leere Eingabeliste ändert nichts', async () => {
    const { svc, cid } = await setup();
    expect(await svc.addItems(cid, [])).toEqual([]);
  });

  it('aktualisiert die Änderungszeit der Sammlung', async () => {
    const { db, svc, cid } = await setup();
    const before = (await db.collections.get(cid))?.updatedAt ?? '';
    await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual' });
    expect(((await db.collections.get(cid))?.updatedAt ?? '') > before).toBe(true);
  });
});

describe('Mengen, Entfernen, Reihenfolge', () => {
  async function three(): Promise<{ svc: CollectionService; cid: string; ids: string[] }> {
    const { svc, cid } = await setup();
    const items = await svc.addItems(cid, [
      { symbology: 'QRCode', value: 'a', source: 'manual' },
      { symbology: 'QRCode', value: 'b', source: 'manual' },
      { symbology: 'QRCode', value: 'c', source: 'manual' }
    ]);
    return { svc, cid, ids: items.map((i) => i.id) };
  }

  it('setQuantity und changeQuantity (+/−) mit Grenzen', async () => {
    const { svc, ids } = await three();
    const id = ids[0] ?? '';
    expect((await svc.setQuantity(id, 5)).quantity).toBe(5);
    expect((await svc.changeQuantity(id, 1)).quantity).toBe(6);
    expect((await svc.changeQuantity(id, -5)).quantity).toBe(1);
    expect(await codeOf(svc.changeQuantity(id, -1))).toBe('ERR_SYNTAX_INVALID'); // nicht unter 1
    expect(await codeOf(svc.changeQuantity(id, 0.5))).toBe('ERR_SYNTAX_INVALID');
    expect(await codeOf(svc.setQuantity(id, 10_000))).toBe('ERR_SYNTAX_INVALID');
    expect(await codeOf(svc.setQuantity('zzz', 2))).toBe('ERR_NOT_FOUND');
  });

  it('removeItem nummeriert lückenlos neu', async () => {
    const { svc, cid, ids } = await three();
    await svc.removeItem(ids[0] ?? '');
    expect((await svc.listItems(cid)).map((i) => [i.value, i.position])).toEqual([['b', 0], ['c', 1]]);
    expect(await codeOf(svc.removeItem('zzz'))).toBe('ERR_NOT_FOUND');
  });

  it.each([
    [0, 2, ['b', 'c', 'a']],
    [2, 0, ['c', 'a', 'b']],
    [1, 1, ['a', 'b', 'c']],
    [0, 1, ['b', 'a', 'c']]
  ])('moveItem von %i nach %i', async (from, to, expected) => {
    const { svc, cid, ids } = await three();
    await svc.moveItem(ids[from] ?? '', to);
    const list = await svc.listItems(cid);
    expect(list.map((i) => i.value)).toEqual(expected);
    expect(list.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it('moveItem: ungültige Zielposition und unbekannter Eintrag', async () => {
    const { svc, ids } = await three();
    for (const bad of [-1, 3, 1.5]) expect(await codeOf(svc.moveItem(ids[0] ?? '', bad))).toBe('ERR_SYNTAX_INVALID');
    expect(await codeOf(svc.moveItem('zzz', 0))).toBe('ERR_NOT_FOUND');
  });
});

describe('Artikelstamm', () => {
  const meta = { source: 'artikel.csv', importedAt: 't' };

  it('replaceCatalog ersetzt komplett; Duplikate und leere Kennungen werden abgelehnt', async () => {
    const { svc } = await setup();
    await svc.replaceCatalog([{ value: '1', active: true, ...meta }, { value: '2', active: true, ...meta }]);
    expect(await svc.catalogSize()).toBe(2);
    await svc.replaceCatalog([{ value: '3', active: true, ...meta }]);
    expect(await svc.catalogSize()).toBe(1);
    expect(await codeOf(svc.replaceCatalog([{ value: '1', active: true, ...meta }, { value: '1', active: false, ...meta }]))).toBe('ERR_SYNTAX_INVALID');
    expect(await codeOf(svc.replaceCatalog([{ value: '', active: true, ...meta }]))).toBe('ERR_SYNTAX_INVALID');
    expect(await svc.catalogSize()).toBe(1); // unverändert
  });

  it('Abgleich setzt known/inactive/unknown samt Quelle und Datum', async () => {
    const { svc, cid } = await setup();
    const third = '0000000000000';
    await svc.addItems(cid, [
      { symbology: 'EAN13', value: EAN_A, source: 'manual' },
      { symbology: 'EAN13', value: EAN_B, source: 'manual' },
      { symbology: 'EAN13', value: third, source: 'manual' }
    ]);
    await svc.replaceCatalog([
      { value: EAN_A, active: true, source: 'artikel.csv', importedAt: 't0' },
      { value: EAN_B, active: false, source: 'artikel.csv', importedAt: 't0' }
    ]);
    const summary = await svc.checkAgainstCatalog(cid);
    expect(summary).toEqual({ known: 1, inactive: 1, unknown: 1, catalogEmpty: false });
    const items = await svc.listItems(cid);
    expect(items.map((i) => i.catalogStatus)).toEqual(['known', 'inactive', 'unknown']);
    expect(items[0]?.catalogSource).toBe('artikel.csv');
    expect(items[0]?.catalogCheckedAt).toBeTruthy();
    expect(items[2]?.catalogSource).toContain('kein Treffer');
    // Prüfziffer-/Syntaxstatus bleiben unberührt (getrennte Aussagen)
    expect(items.every((i) => i.syntaxStatus === 'valid' && i.checksumStatus === 'valid')).toBe(true);
  });

  it('ohne Artikelstamm bleibt alles unchecked', async () => {
    const { svc, cid } = await setup();
    await svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual' });
    expect(await svc.checkAgainstCatalog(cid)).toEqual({ known: 0, unknown: 0, inactive: 0, catalogEmpty: true });
    expect((await svc.listItems(cid))[0]?.catalogStatus).toBe('unchecked');
  });

  it('unbekannte Sammlung → ERR_NOT_FOUND', async () => {
    const { svc } = await setup();
    expect(await codeOf(svc.checkAgainstCatalog('zzz'))).toBe('ERR_NOT_FOUND');
  });
});

describe('Vorlagen und Profile', () => {
  it('Vorlagen speichern, auflisten, löschen; Name wird geprüft', async () => {
    const { svc } = await setup();
    const definition = {
      id: 'd', symbology: 'EAN13' as const, prefix: '2063701028', suffixBeforeCheckDigit: '', variableWidth: 2, start: '0', end: '96', step: '12',
      checksumMode: 'gs1-mod10' as const, overflow: 'stop' as const
    };
    const t = await svc.saveTemplate({ id: 't1', name: ' Z ', pattern: '2 063701 028{XX}{C}', definition, createdAt: 'c', updatedAt: 'u' });
    expect(t.name).toBe('Z');
    await svc.saveTemplate({ id: 't2', name: 'A', pattern: 'p', definition, createdAt: 'c', updatedAt: 'u' });
    expect((await svc.listTemplates()).map((x) => x.name)).toEqual(['A', 'Z']);
    expect(await codeOf(svc.saveTemplate({ id: 't3', name: '', pattern: 'p', definition, createdAt: 'c', updatedAt: 'u' }))).toBe('ERR_SYNTAX_INVALID');
    await svc.deleteTemplate('t1');
    expect((await svc.listTemplates()).map((x) => x.id)).toEqual(['t2']);
  });

  it('Standardprofile werden beim ersten Aufruf angelegt und nach dem Löschen eines Profils nicht neu angelegt', async () => {
    const { svc } = await setup();
    const first = await svc.listProfiles();
    expect(first.map((p) => p.name)).toEqual(['Langsam', 'Identische Codes', 'Normaltest', 'Schnelltest']);
    expect(first).toHaveLength(DEFAULT_PROFILES.length);
    await svc.deleteProfile('profile-fast');
    expect((await svc.listProfiles()).map((p) => p.id)).not.toContain('profile-fast');
  });

  it('saveProfile prüft Werte und speichert eigene Profile', async () => {
    const { svc } = await setup();
    const own = { id: 'own', name: 'Kasse 2', displayMs: 400, blankMs: 120, identicalBlankMs: 500, startDelayMs: 2000 };
    await svc.saveProfile(own);
    expect((await svc.listProfiles()).some((p) => p.id === 'own')).toBe(true);
    expect(await codeOf(svc.saveProfile({ ...own, displayMs: 0 }))).toBe('ERR_SYNTAX_INVALID');
  });
});

describe('Schreibfehler', () => {
  it('Fehler beim Schreiben → ERR_STORAGE_WRITE_FAILED, Transaktion rollt zurück (nichts halb gespeichert)', async () => {
    const { db, svc, cid } = await setup();
    const before = (await db.collections.get(cid))?.updatedAt;
    const original = db.items.bulkPut.bind(db.items);
    db.items.bulkPut = (() => Promise.reject(new Error('Platte kaputt'))) as unknown as typeof db.items.bulkPut;
    expect(await codeOf(svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual' }))).toBe('ERR_STORAGE_WRITE_FAILED');
    db.items.bulkPut = original;
    expect(await db.items.count()).toBe(0);
    expect((await db.collections.get(cid))?.updatedAt).toBe(before);
  });

  it('Speicher voll → ERR_STORAGE_QUOTA_EXCEEDED', async () => {
    const { db, svc, cid } = await setup();
    const quota = new Error('voll');
    quota.name = 'QuotaExceededError';
    db.items.bulkPut = (() => Promise.reject(quota)) as unknown as typeof db.items.bulkPut;
    expect(await codeOf(svc.addItem(cid, { symbology: 'EAN13', value: EAN_A, source: 'manual' }))).toBe('ERR_STORAGE_QUOTA_EXCEEDED');
  });
});
