import { afterEach, describe, expect, it } from 'vitest';
import { CollectionService } from '../../src/application/collection-service';
import { BackupService } from '../../src/application/backup-service';
import { disposeDbs, freshDb, testDeps } from './helpers';

afterEach(disposeDbs);

describe('findItem', () => {
  it('findet exakt nach Symbologie und Wert, sonst undefined', async () => {
    const db = freshDb();
    const svc = new CollectionService(db, testDeps());
    const c = await svc.createCollection('A');
    const other = await svc.createCollection('B');
    await svc.addItem(c.id, { symbology: 'EAN13', value: '4006381333931', source: 'manual' });
    await svc.addItem(other.id, { symbology: 'EAN13', value: '5901234123457', source: 'manual' });
    expect((await svc.findItem(c.id, 'EAN13', '4006381333931'))?.value).toBe('4006381333931');
    expect(await svc.findItem(c.id, 'QRCode', '4006381333931')).toBeUndefined();
    expect(await svc.findItem(c.id, 'EAN13', '5901234123457')).toBeUndefined(); // andere Sammlung
    expect(await svc.findItem('zzz', 'EAN13', '4006381333931')).toBeUndefined();
  });
});

describe('mehrzeilige QR-Texte durchgängig', () => {
  const vcard = 'BEGIN:VCARD\r\nFN:Max Muster\r\nEND:VCARD';

  it('lassen sich speichern, exportieren und per CSV/JSON verlustfrei wieder einlesen', async () => {
    const db = freshDb();
    const deps = testDeps();
    const svc = new CollectionService(db, deps);
    const backup = new BackupService(db, 'x', deps);
    const c = await svc.createCollection('Kontakte');
    await svc.addItem(c.id, { symbology: 'QRCode', value: vcard, source: 'camera' });
    expect((await svc.listItems(c.id))[0]?.value).toBe(vcard);

    const csv = await backup.exportCollectionCsv(c.id);
    const target = await svc.createCollection('Ziel');
    expect((await backup.importCollectionCsv(target.id, csv)).errors).toEqual([]);
    expect((await svc.listItems(target.id))[0]?.value).toBe(vcard);

    const json = await backup.exportJson();
    const db2 = freshDb();
    await new BackupService(db2, 'x', testDeps()).importJson(json);
    expect((await db2.items.toArray()).map((i) => i.value)).toContain(vcard);
  });
});
