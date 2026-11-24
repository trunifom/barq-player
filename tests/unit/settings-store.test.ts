import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SettingsStore, sanitizeSettings, type KeyValueStorage } from '../../src/application/settings-store';

function memory(initial?: string): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SETTINGS_KEY, initial);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('sanitizeSettings', () => {
  it('Standardwerte bei Unsinn', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}]) expect(sanitizeSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it('übernimmt gültige Felder und verwirft ungültige einzeln', () => {
    const s = sanitizeSettings({ collectionId: 'c1', profileId: '', mode: 'turbo', batchSize: 0, interleave: 'ja', uniqueOnly: true, formats: ['QRCode', 'UPCA', 'foo', 'QRCode'], sound: false, vibration: 1, liftToPause: true });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, collectionId: 'c1', uniqueOnly: true, formats: ['QRCode', 'UPCA'], sound: false, liftToPause: true });
  });

  it('batchSize: nur ganze Zahlen 1..100', () => {
    expect(sanitizeSettings({ batchSize: 7 }).batchSize).toBe(7);
    for (const bad of [0, 101, 1.5, '5', Number.NaN]) expect(sanitizeSettings({ batchSize: bad }).batchSize).toBe(DEFAULT_SETTINGS.batchSize);
  });

  it('Formate: feste Reihenfolge, Duplikate/Unbekanntes entfernt, leer → Standard', () => {
    expect(sanitizeSettings({ formats: ['UPCA', 'EAN13'] }).formats).toEqual(['EAN13', 'UPCA']);
    for (const bad of [[], ['x'], 'EAN13', null, 5]) expect(sanitizeSettings({ formats: bad }).formats).toEqual(['EAN13', 'EAN8', 'QRCode', 'Code128']);
  });

  it('Standardformate sind unabhängig von der geteilten Konstante veränderbar (Kopie)', () => {
    const a = sanitizeSettings({});
    a.formats.push('UPCA');
    expect(sanitizeSettings({}).formats).not.toContain('UPCA');
  });

  it('Modi und überlange IDs', () => {
    for (const m of ['manual', 'auto', 'batch'] as const) expect(sanitizeSettings({ mode: m }).mode).toBe(m);
    expect(sanitizeSettings({ collectionId: 'x'.repeat(201) }).collectionId).toBeNull();
  });
});

describe('SettingsStore', () => {
  it('lädt gespeicherte Werte, speichert Änderungen und gibt Kopien heraus', () => {
    const storage = memory(JSON.stringify({ mode: 'auto', collectionId: 'c9' }));
    const store = new SettingsStore(storage);
    expect(store.get()).toMatchObject({ mode: 'auto', collectionId: 'c9' });
    store.update({ interleave: true, batchSize: 8 });
    expect(JSON.parse(storage.data.get(SETTINGS_KEY) ?? '{}')).toMatchObject({ mode: 'auto', interleave: true, batchSize: 8 });
    const copy = store.get();
    copy.mode = 'manual';
    expect(store.get().mode).toBe('auto');
  });

  it('prüft Änderungen (ungültige Werte werden zu Standard)', () => {
    const store = new SettingsStore(memory());
    store.update({ batchSize: 999 });
    expect(store.get().batchSize).toBe(DEFAULT_SETTINGS.batchSize);
  });

  it('kaputtes JSON → Standardwerte und Fehler wird gemeldet', () => {
    const onError = vi.fn();
    const store = new SettingsStore(memory('{kaputt'), onError);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.lastError).not.toBeNull();
  });

  it('Schreibfehler (Privatmodus/voll): weiterarbeiten im Arbeitsspeicher, Fehler gemeldet', () => {
    const onError = vi.fn();
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      }
    };
    const store = new SettingsStore(storage, onError);
    store.update({ sound: false });
    expect(store.get().sound).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(store.lastError).not.toBeNull();
  });

  it('Lesefehler des Speichers selbst', () => {
    const onError = vi.fn();
    const storage: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined
    };
    expect(new SettingsStore(storage, onError).get()).toEqual(DEFAULT_SETTINGS);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ohne Speicher (null) nur im Arbeitsspeicher; reset stellt Standard her', () => {
    const store = new SettingsStore(null);
    store.update({ mode: 'batch' });
    expect(store.get().mode).toBe('batch');
    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
  });

  it('erfolgreiches Speichern löscht den letzten Fehler', () => {
    let fail = true;
    const storage: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        if (fail) throw new Error('x');
      }
    };
    const store = new SettingsStore(storage);
    store.update({ sound: false });
    expect(store.lastError).not.toBeNull();
    fail = false;
    store.update({ sound: true });
    expect(store.lastError).toBeNull();
  });
});
