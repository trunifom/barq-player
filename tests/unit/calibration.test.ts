import { describe, expect, it } from 'vitest';
import { evaluateCalibration, validateCalibrationInput, type CalibrationInput } from '../../src/domain/calibration';
import { validateProfile } from '../../src/domain/profiles';
import type { FaderProfile } from '../../src/domain/types';

const profile: FaderProfile = { id: 'p', name: 'Normaltest', displayMs: 500, blankMs: 150, identicalBlankMs: 400, startDelayMs: 3000 };
const input = (over: Partial<CalibrationInput> = {}): CalibrationInput => ({ profile, shown: 20, accepted: 20, extra: 0, errorDialogs: 0, ...over });

describe('validateCalibrationInput', () => {
  it('akzeptiert plausible Eingaben', () => {
    expect(validateCalibrationInput(input())).toEqual([]);
    expect(validateCalibrationInput(input({ accepted: 22, extra: 2 }))).toEqual([]);
  });

  it('lehnt Unsinn ab', () => {
    for (const bad of [{ accepted: -1 }, { accepted: 1.5 }, { extra: -1 }, { errorDialogs: Number.NaN }, { shown: 0 }, { accepted: 21, extra: 0 }]) {
      expect(validateCalibrationInput(input(bad)).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
});

describe('evaluateCalibration', () => {
  it('fehlerfrei → Betriebsprofil mit 25 % Reserve, gültiges Profil', () => {
    const r = evaluateCalibration(input(), 'neu');
    expect(r.verdict).toBe('stable');
    expect(r.recommended).toMatchObject({ id: 'neu', displayMs: 630, blankMs: 190, identicalBlankMs: 500, startDelayMs: 3000 });
    expect(r.recommended.name).toContain('kalibriert');
    expect(validateProfile(r.recommended)).toEqual([]);
    expect(r.explanation.join(' ')).toContain('Reserve');
  });

  it('fehlende Positionen → langsamer (×1,5)', () => {
    const r = evaluateCalibration(input({ accepted: 17 }), 'neu');
    expect(r.verdict).toBe('missing');
    expect(r.missing).toBe(3);
    expect(r.recommended).toMatchObject({ displayMs: 750, blankMs: 230, identicalBlankMs: 600 });
    expect(r.explanation.join(' ')).toContain('3 von 20');
  });

  it('zusätzliche Buchungen → kürzere Anzeige, Leerzeiten unverändert', () => {
    const r = evaluateCalibration(input({ accepted: 22, extra: 2 }), 'neu');
    expect(r.verdict).toBe('extra');
    expect(r.recommended).toMatchObject({ displayMs: 380, blankMs: 150, identicalBlankMs: 400 });
    expect(r.explanation.join(' ')).toContain('Doppelbuchungen');
  });

  it('fehlende UND zusätzliche → kein Vorschlag, wiederholen', () => {
    const r = evaluateCalibration(input({ accepted: 18, extra: 1 }), 'neu');
    expect(r.verdict).toBe('mixed');
    expect(r.recommended).toMatchObject({ displayMs: 500, blankMs: 150 });
    expect(r.recommended.name).toContain('unverändert');
  });

  it('Fehlerdialoge → ungültiger Test (unbekannte Artikel), Profil unverändert', () => {
    const r = evaluateCalibration(input({ accepted: 15, errorDialogs: 2 }), 'neu');
    expect(r.verdict).toBe('invalid-test');
    expect(r.recommended.displayMs).toBe(500);
    expect(r.explanation.join(' ')).toContain('unbekannte Artikel');
  });

  it('ungültige Eingaben → invalid-test mit Meldungen', () => {
    const r = evaluateCalibration(input({ accepted: -3 }), 'neu');
    expect(r.verdict).toBe('invalid-test');
    expect(r.explanation[0]).toContain('ganze Zahl');
  });

  it('Werte bleiben in sinnvollen Grenzen (Klammerung) und gerundet auf 10 ms', () => {
    const slow = evaluateCalibration(input({ accepted: 0, profile: { ...profile, displayMs: 4000, blankMs: 2500, identicalBlankMs: 4800 } }), 'x');
    expect(slow.recommended.displayMs).toBe(5000);
    expect(slow.recommended.blankMs).toBe(3000);
    expect(slow.recommended.identicalBlankMs).toBe(5000);
    const fast = evaluateCalibration(input({ accepted: 22, extra: 2, profile: { ...profile, displayMs: 120 } }), 'x');
    expect(fast.recommended.displayMs).toBe(100);
    for (const r of [slow, fast, evaluateCalibration(input(), 'x')]) {
      expect(r.recommended.displayMs % 10).toBe(0);
      expect(validateProfile(r.recommended)).toEqual([]);
    }
  });

  it('weist immer darauf hin, dass es Teststartpunkte sind (außer bei ungültigen Eingaben)', () => {
    for (const i of [input(), input({ accepted: 17 }), input({ accepted: 22, extra: 2 })]) {
      expect(evaluateCalibration(i, 'x').explanation.join(' ')).toContain('Teststartpunkte');
    }
  });
});
