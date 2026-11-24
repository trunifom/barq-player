import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import {
  CALIBRATION_ENTRY_COUNT,
  MAX_PLAYBACK_ENTRIES,
  buildCalibrationEntries,
  buildPlaybackEntries,
  entryKey,
  interleaveEntries
} from '../../src/domain/playback-entries';
import type { BarcodeItem } from '../../src/domain/types';

const item = (id: string, position: number, value: string, quantity = 1, symbology: BarcodeItem['symbology'] = 'EAN13'): BarcodeItem => ({
  id, collectionId: 'c', position, symbology, value, quantity, source: 'manual', capturedAt: 't',
  syntaxStatus: 'valid', checksumStatus: 'valid', catalogStatus: 'unchecked'
});

describe('buildPlaybackEntries', () => {
  it('sortiert nach Position und wiederholt nach Menge (IDs eindeutig, Wiederholung 0-basiert)', () => {
    const e = buildPlaybackEntries([item('b', 1, '2', 2), item('a', 0, '1', 1), item('c', 2, '3', 3)]);
    expect(e.map((x) => x.value)).toEqual(['1', '2', '2', '3', '3', '3']);
    expect(e.map((x) => x.id)).toEqual(['a#1', 'b#1', 'b#2', 'c#1', 'c#2', 'c#3']);
    expect(e.map((x) => x.repetition)).toEqual([0, 0, 1, 0, 1, 2]);
    expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
    expect(e[1]).toMatchObject({ sourceItemId: 'b', symbology: 'EAN13' });
  });

  it('Werte bleiben Strings mit führenden Nullen', () => {
    expect(buildPlaybackEntries([item('a', 0, '0000000000000')])[0]?.value).toBe('0000000000000');
  });

  it('leere Liste → Fehler', () => {
    expect(() => buildPlaybackEntries([])).toThrow(AppError);
  });

  it('Obergrenze: genau MAX erlaubt, MAX+1 abgelehnt', () => {
    expect(buildPlaybackEntries([item('a', 0, '1', MAX_PLAYBACK_ENTRIES)])).toHaveLength(MAX_PLAYBACK_ENTRIES);
    expect(() => buildPlaybackEntries([item('a', 0, '1', MAX_PLAYBACK_ENTRIES + 1)])).toThrow(AppError);
  });

  it('verändert die Eingabe nicht', () => {
    const items = [item('b', 1, '2'), item('a', 0, '1')];
    buildPlaybackEntries(items);
    expect(items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('interleaveEntries', () => {
  it('trennt identische Nachbarn und liefert Statistik; abschaltbar', () => {
    const e = buildPlaybackEntries([item('a', 0, '1', 3), item('b', 1, '2', 2)]);
    const on = interleaveEntries(e, true);
    expect(on.stats.identicalTransitionsAfter).toBe(0);
    expect(on.stats.avoidedTransitions).toBe(3);
    expect(on.entries.map((x) => x.value)).toEqual(['1', '2', '1', '2', '1']);
    const off = interleaveEntries(e, false);
    expect(off.entries.map((x) => x.value)).toEqual(['1', '1', '1', '2', '2']);
    expect(off.stats.reordered).toBe(false);
  });

  it('entryKey unterscheidet Symbologien', () => {
    expect(entryKey({ symbology: 'EAN13', value: '1' })).not.toBe(entryKey({ symbology: 'QRCode', value: '1' }));
  });
});

describe('buildCalibrationEntries', () => {
  it('liefert genau 20 Positionen mit eindeutigen IDs; wiederholt zyklisch bei zu wenigen', () => {
    const e = buildCalibrationEntries([item('a', 0, '1'), item('b', 1, '2'), item('c', 2, '3')]);
    expect(CALIBRATION_ENTRY_COUNT).toBe(20);
    expect(e).toHaveLength(20);
    expect(new Set(e.map((x) => x.id)).size).toBe(20);
    expect(e.slice(0, 4).map((x) => x.value)).toEqual(['1', '2', '3', '1']);
    expect(e.every((x) => x.id.startsWith('cal-'))).toBe(true);
  });

  it('nutzt Mengen (identische Folgecodes werden getestet) und kürzt bei zu vielen', () => {
    const e = buildCalibrationEntries([item('a', 0, '1', 2), item('b', 1, '2', 50)]);
    expect(e.slice(0, 4).map((x) => x.value)).toEqual(['1', '1', '2', '2']);
    expect(e).toHaveLength(20);
  });

  it('eine einzelne Position mit Menge 1 wird 20-mal wiederholt', () => {
    const e = buildCalibrationEntries([item('a', 0, '1')]);
    expect(e.every((x) => x.value === '1')).toBe(true);
    expect(e).toHaveLength(20);
  });

  it('leere Sammlung → Fehler', () => {
    expect(() => buildCalibrationEntries([])).toThrow(AppError);
  });
});
