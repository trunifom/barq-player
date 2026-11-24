import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { DuplicateFilter } from '../../src/domain/duplicate-filter';

describe('DuplicateFilter – technisches Duplikat vs. fachliche Wiederholung', () => {
  it('dauerhaft sichtbarer Code wird nur einmal akzeptiert', () => {
    const f = new DuplicateFilter();
    expect(f.observe(['A'], 0)).toEqual(['A']);
    for (let t = 100; t <= 10_000; t += 100) expect(f.observe(['A'], t)).toEqual([]);
  });

  it('verschwindet der Code ≥ absenceMs und erscheint erneut, wird er erneut akzeptiert (fachliche Wiederholung)', () => {
    const f = new DuplicateFilter({ absenceMs: 1000 });
    expect(f.observe(['A'], 0)).toEqual(['A']);
    expect(f.observe(['A'], 200)).toEqual([]);
    expect(f.observe([], 400)).toEqual([]);
    expect(f.observe([], 1200)).toEqual([]);
    expect(f.observe(['A'], 1300)).toEqual(['A']);
    expect(f.observe(['A'], 1400)).toEqual([]);
  });

  it('kurzes Flackern (Abwesenheit < absenceMs) zählt als derselbe Vorhaltevorgang', () => {
    const f = new DuplicateFilter({ absenceMs: 1200 });
    expect(f.observe(['A'], 0)).toEqual(['A']);
    expect(f.observe([], 300)).toEqual([]);
    expect(f.observe(['A'], 600)).toEqual([]);
    expect(f.observe([], 900)).toEqual([]);
    expect(f.observe(['A'], 1100)).toEqual([]);
  });

  it('ein Bildabstand von genau absenceMs gilt als Abwesenheit', () => {
    const f = new DuplicateFilter({ absenceMs: 500 });
    f.observe(['A'], 0);
    expect(f.observe(['A'], 500)).toEqual(['A']);
  });

  it('mehrere Codes gleichzeitig werden unabhängig behandelt', () => {
    const f = new DuplicateFilter();
    expect(f.observe(['A', 'B'], 0).sort()).toEqual(['A', 'B']);
    expect(f.observe(['A', 'B', 'C'], 100)).toEqual(['C']);
    expect(f.observe(['B'], 200)).toEqual([]);
  });

  it('doppelte Schlüssel im selben Bild zählen einmal', () => {
    expect(new DuplicateFilter().observe(['A', 'A', 'A'], 0)).toEqual(['A']);
  });

  it('wechselnde Codes: A → B → A (A war weg, aber < absenceMs) wird nicht erneut akzeptiert', () => {
    const f = new DuplicateFilter({ absenceMs: 1200 });
    expect(f.observe(['A'], 0)).toEqual(['A']);
    expect(f.observe(['B'], 300)).toEqual(['B']);
    expect(f.observe(['A'], 600)).toEqual([]);
  });

  it('minFrames=3 verlangt aufeinanderfolgende Bilder; Lücken setzen die Serie zurück', () => {
    const f = new DuplicateFilter({ minFrames: 3, absenceMs: 10_000 });
    expect(f.observe(['A'], 0)).toEqual([]);
    expect(f.observe(['A'], 100)).toEqual([]);
    expect(f.observe([], 200)).toEqual([]); // Serie unterbrochen
    expect(f.observe(['A'], 300)).toEqual([]);
    expect(f.observe(['A'], 400)).toEqual([]);
    expect(f.observe(['A'], 500)).toEqual(['A']);
    expect(f.observe(['A'], 600)).toEqual([]);
  });

  it('release: nach fehlgeschlagenem Speichern wird der noch vorgehaltene Code erneut akzeptiert', () => {
    const f = new DuplicateFilter();
    expect(f.observe(['A'], 0)).toEqual(['A']);
    f.release('A');
    expect(f.observe(['A'], 100)).toEqual(['A']);
    expect(f.observe(['A'], 200)).toEqual([]);
    expect(() => f.release('unbekannt')).not.toThrow();
  });

  it('reset vergisst alles (auch die Zeit)', () => {
    const f = new DuplicateFilter();
    f.observe(['A'], 5000);
    f.reset();
    expect(f.observe(['A'], 0)).toEqual(['A']);
  });

  it('Zeit muss endlich und monoton sein; gleiche Zeit ist erlaubt', () => {
    const f = new DuplicateFilter();
    f.observe(['A'], 100);
    expect(() => f.observe(['A'], 99)).toThrow(AppError);
    expect(() => f.observe(['A'], Number.NaN)).toThrow(AppError);
    expect(() => f.observe(['A'], Infinity)).toThrow(AppError);
    expect(() => f.observe(['B'], 100)).not.toThrow();
  });

  it('prüft Parameter', () => {
    for (const o of [{ absenceMs: -1 }, { absenceMs: Number.NaN }, { minFrames: 0 }, { minFrames: 1.5 }]) {
      expect(() => new DuplicateFilter(o)).toThrow(AppError);
    }
    expect(() => new DuplicateFilter({ absenceMs: 0 })).not.toThrow();
  });

  it('leere Bilder am Anfang sind unkritisch; alte Spuren werden entfernt', () => {
    const f = new DuplicateFilter({ absenceMs: 100 });
    expect(f.observe([], 0)).toEqual([]);
    for (let i = 0; i < 1000; i++) f.observe([`K${i}`], i * 200);
    expect(f.observe(['K0'], 1_000_000)).toEqual(['K0']);
  });
});
