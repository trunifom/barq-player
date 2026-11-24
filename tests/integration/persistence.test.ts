import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  BarqDatabase,
  DB_SCHEMA_VERSION,
  guardWrite,
  mapStorageError,
  requestPersistentStorage
} from '../../src/adapters/persistence/db';
import { disposeDbs, freshDb } from './helpers';

afterEach(disposeDbs);

describe('Datenbank', () => {
  it('öffnet Schema v1 mit allen Tabellen', async () => {
    const db = freshDb();
    await db.open();
    expect(DB_SCHEMA_VERSION).toBe(1);
    expect(db.verno).toBe(1);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['catalog', 'collections', 'events', 'items', 'profiles', 'sessions', 'templates']);
  });

  it('Daten (inkl. führender Nullen als String) überleben Schließen und Wiederöffnen', async () => {
    const db = freshDb();
    await db.items.add({
      id: 'i', collectionId: 'c', position: 0, symbology: 'EAN13', value: '0000000000000', quantity: 1, source: 'manual',
      capturedAt: 't', syntaxStatus: 'valid', checksumStatus: 'valid', catalogStatus: 'unchecked'
    });
    db.close();
    const again = new BarqDatabase(db.name);
    try {
      const item = await again.items.get('i');
      expect(item?.value).toBe('0000000000000');
      expect(typeof item?.value).toBe('string');
    } finally {
      again.close();
    }
  });

  it('Compound-Index [collectionId+position] ist abfragbar', async () => {
    const db = freshDb();
    await db.items.bulkAdd(
      [2, 0, 1].map((position) => ({
        id: `i${position}`, collectionId: 'c', position, symbology: 'QRCode' as const, value: `v${position}`, quantity: 1, source: 'manual' as const,
        capturedAt: 't', syntaxStatus: 'valid' as const, checksumStatus: 'not-applicable' as const, catalogStatus: 'unchecked' as const
      }))
    );
    const sorted = await db.items.where('[collectionId+position]').between(['c', 0], ['c', 99]).toArray();
    expect(sorted.map((i) => i.position)).toEqual([0, 1, 2]);
  });
});

describe('mapStorageError / guardWrite', () => {
  it('erkennt Quota-Fehler (direkt und verschachtelt)', () => {
    const quota = new Error('voll');
    quota.name = 'QuotaExceededError';
    expect(mapStorageError(quota).code).toBe('ERR_STORAGE_QUOTA_EXCEEDED');
    const wrapped = Object.assign(new Error('dexie'), { inner: quota });
    expect(mapStorageError(wrapped).code).toBe('ERR_STORAGE_QUOTA_EXCEEDED');
  });

  it('allgemeine Fehler und Nicht-Errors → ERR_STORAGE_WRITE_FAILED mit Ursache', () => {
    const cause = new TypeError('kaputt');
    const e = mapStorageError(cause);
    expect(e.code).toBe('ERR_STORAGE_WRITE_FAILED');
    expect(e.cause).toBe(cause);
    expect(e.details).toBe('TypeError: kaputt');
    expect(mapStorageError('text').details).toBe('text');
  });

  it('AppError bleibt unverändert', () => {
    const a = new AppError('ERR_NOT_FOUND');
    expect(mapStorageError(a)).toBe(a);
  });

  it('guardWrite reicht Ergebnisse durch und übersetzt Fehler', async () => {
    await expect(guardWrite(() => Promise.resolve(5))).resolves.toBe(5);
    await expect(guardWrite(() => Promise.reject(new Error('x')))).rejects.toMatchObject({ code: 'ERR_STORAGE_WRITE_FAILED' });
  });

  it('Dexie-Schreibfehler (doppelter Schlüssel) wird typisiert gemeldet', async () => {
    const db = freshDb();
    await db.collections.add({ id: 'c', name: 'x', createdAt: 't', updatedAt: 't' });
    await expect(guardWrite(() => db.collections.add({ id: 'c', name: 'y', createdAt: 't', updatedAt: 't' }))).rejects.toBeInstanceOf(AppError);
  });
});

describe('requestPersistentStorage', () => {
  it('ohne Storage-API: nicht unterstützt', async () => {
    expect(await requestPersistentStorage(undefined)).toMatchObject({ supported: false, persisted: false, usageBytes: null, quotaBytes: null, error: null });
  });

  it('bereits persistent: persist() wird nicht erneut aufgerufen', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const s = await requestPersistentStorage({ persisted: () => Promise.resolve(true), persist, estimate: () => Promise.resolve({ usage: 10, quota: 100 }) });
    expect(s).toMatchObject({ supported: true, persisted: true, usageBytes: 10, quotaBytes: 100, error: null });
    expect(persist).not.toHaveBeenCalled();
  });

  it('fragt an und meldet Gewährung bzw. Ablehnung (Ablehnung ist kein Fehler)', async () => {
    const granted = await requestPersistentStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) });
    expect(granted.persisted).toBe(true);
    const denied = await requestPersistentStorage({ persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) });
    expect(denied).toMatchObject({ persisted: false, error: null });
  });

  it('fehlende Methoden und fehlende Schätzwerte', async () => {
    expect(await requestPersistentStorage({})).toMatchObject({ supported: true, persisted: false, usageBytes: null });
    expect((await requestPersistentStorage({ estimate: () => Promise.resolve({}) })).quotaBytes).toBeNull();
  });

  it('Fehler werden gemeldet statt geworfen', async () => {
    const s = await requestPersistentStorage({ persist: () => Promise.reject(new Error('blockiert')) });
    expect(s.supported).toBe(true);
    expect(s.persisted).toBe(false);
    expect(s.error).toBeInstanceOf(AppError);
    expect(s.error?.details).toContain('blockiert');
  });
});
