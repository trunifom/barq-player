import { describe, expect, it } from 'vitest';
import { describeExpiry, expiryInfo, formatDateDe, isExpired, isValidDateString, localDateString, parseDateInput, partitionByExpiry } from '../../src/domain/expiry';

describe('isValidDateString', () => {
  it('akzeptiert echte Kalendertage', () => {
    for (const d of ['2026-01-31', '2024-02-29', '2026-12-31']) expect(isValidDateString(d)).toBe(true);
  });
  it('lehnt unmögliche und falsch formatierte Daten ab', () => {
    for (const d of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '', 'heute', '1800-01-01']) expect(isValidDateString(d)).toBe(false);
  });
});

describe('parseDateInput', () => {
  it('liest ISO und deutsche Schreibweisen', () => {
    expect(parseDateInput('2026-03-05')).toBe('2026-03-05');
    expect(parseDateInput('05.03.2026')).toBe('2026-03-05');
    expect(parseDateInput('5.3.2026')).toBe('2026-03-05');
    expect(parseDateInput(' 31/12/2026 ')).toBe('2026-12-31');
  });
  it('lehnt Unsinn und zweistellige Jahre ab', () => {
    for (const d of ['31.02.2026', '5.3.26', 'morgen', '2026/03/05', '']) expect(parseDateInput(d)).toBeNull();
  });
});

describe('localDateString / formatDateDe', () => {
  it('nutzt den Kalendertag der Ortszeit', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
  it('formatiert deutsch', () => {
    expect(formatDateDe('2026-03-05')).toBe('05.03.2026');
    expect(formatDateDe('kaputt')).toBe('kaputt');
  });
});

describe('expiryInfo', () => {
  const today = '2026-06-15';
  it('ohne Datum: none', () => {
    expect(expiryInfo(undefined, today)).toEqual({ state: 'none', daysLeft: null });
    expect(expiryInfo('', today)).toEqual({ state: 'none', daysLeft: null });
  });
  it('gültig bis einschließlich des Ablauftags', () => {
    expect(expiryInfo('2026-06-15', today)).toEqual({ state: 'soon', daysLeft: 0 });
    expect(isExpired('2026-06-15', today)).toBe(false);
  });
  it('abgelaufen ab dem Folgetag', () => {
    expect(expiryInfo('2026-06-14', today)).toEqual({ state: 'expired', daysLeft: -1 });
    expect(isExpired('2026-06-14', today)).toBe(true);
  });
  it('Warnschwelle 7 Tage', () => {
    expect(expiryInfo('2026-06-22', today).state).toBe('soon');
    expect(expiryInfo('2026-06-23', today).state).toBe('valid');
    expect(expiryInfo('2026-06-23', today, 10).state).toBe('soon');
  });
  it('rechnet über Monats- und Jahresgrenzen und Schaltjahre', () => {
    expect(expiryInfo('2027-01-01', '2026-12-31').daysLeft).toBe(1);
    expect(expiryInfo('2024-03-01', '2024-02-28').daysLeft).toBe(2);
    expect(expiryInfo('2025-03-01', '2025-02-28').daysLeft).toBe(1);
  });
  it('ein ungültiges Datum zählt vorsichtshalber als abgelaufen', () => {
    expect(expiryInfo('2026-02-31', today).state).toBe('expired');
  });
});

describe('partitionByExpiry / describeExpiry', () => {
  it('trennt gültige und abgelaufene Einträge unter Beibehaltung der Reihenfolge', () => {
    const items = [{ id: 'a' }, { id: 'b', expiresAt: '2026-01-01' }, { id: 'c', expiresAt: '2026-12-31' }, { id: 'd', expiresAt: '2026-06-15' }];
    const { valid, expired } = partitionByExpiry(items, '2026-06-15');
    expect(valid.map((i) => i.id)).toEqual(['a', 'c', 'd']);
    expect(expired.map((i) => i.id)).toEqual(['b']);
  });
  it('beschreibt alle Zustände', () => {
    const today = '2026-06-15';
    expect(describeExpiry(expiryInfo('2026-06-01', today), '2026-06-01')).toBe('abgelaufen am 01.06.2026');
    expect(describeExpiry(expiryInfo('2026-06-15', today), '2026-06-15')).toBe('läuft heute ab (15.06.2026)');
    expect(describeExpiry(expiryInfo('2026-06-16', today), '2026-06-16')).toBe('läuft morgen ab (16.06.2026)');
    expect(describeExpiry(expiryInfo('2026-06-20', today), '2026-06-20')).toBe('läuft in 5 Tagen ab (20.06.2026)');
    expect(describeExpiry(expiryInfo('2026-09-01', today), '2026-09-01')).toBe('gültig bis 01.09.2026');
  });
});
