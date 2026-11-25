import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { collectTags, fillMissingMeta, matchesQuery, META_LIMITS, normalizeItemMeta, parseTags } from '../../src/domain/item-meta';

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof AppError) {
      expect(e.code).toBe('ERR_SYNTAX_INVALID');
      return e.userMessage;
    }
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('parseTags', () => {
  it('trennt an Komma, Semikolon, Pipe und Zeilenumbruch, entfernt # und Duplikate', () => {
    expect(parseTags('Obst, #Aktion; obst | Bio\n  Frisch  ,,')).toEqual(['Obst', 'Aktion', 'Bio', 'Frisch']);
  });
  it('leerer Text ergibt keine Tags', () => {
    expect(parseTags('  , ; ')).toEqual([]);
  });
  it('Groß-/Kleinschreibung: die erste Schreibweise gewinnt', () => {
    expect(parseTags('Äpfel, äpfel')).toEqual(['Äpfel']);
  });
});

describe('normalizeItemMeta', () => {
  it('leere Eingabe ergibt ein leeres Objekt (keine undefined-Felder)', () => {
    const m = normalizeItemMeta({ label: '  ', purpose: '', note: undefined, tags: '', expiresAt: '' });
    expect(m).toEqual({});
    expect(Object.keys(m)).toHaveLength(0);
  });
  it('trimmt Texte und normalisiert das Datum', () => {
    expect(normalizeItemMeta({ label: ' Apfel ', purpose: 'Test', note: 'Ein Satz.', tags: ['a', 'B'], expiresAt: '31.12.2026' })).toEqual({
      label: 'Apfel',
      purpose: 'Test',
      note: 'Ein Satz.',
      tags: ['a', 'B'],
      expiresAt: '2026-12-31'
    });
  });
  it('lehnt zu lange Texte mit Feldnamen und Längen ab, ohne zu kürzen', () => {
    expect(message(() => normalizeItemMeta({ label: 'x'.repeat(META_LIMITS.label + 1) }))).toContain('Wort');
    expect(message(() => normalizeItemMeta({ purpose: 'x'.repeat(META_LIMITS.purpose + 1) }))).toContain('Nutzen');
    expect(message(() => normalizeItemMeta({ note: 'x'.repeat(META_LIMITS.note + 1) }))).toContain('Satz');
    expect(normalizeItemMeta({ note: 'x'.repeat(META_LIMITS.note) }).note).toHaveLength(META_LIMITS.note);
  });
  it('begrenzt Anzahl und Länge der Tags', () => {
    const many = Array.from({ length: META_LIMITS.tags + 1 }, (_v, i) => `t${i}`);
    expect(message(() => normalizeItemMeta({ tags: many }))).toContain('Tags');
    expect(message(() => normalizeItemMeta({ tags: ['x'.repeat(META_LIMITS.tag + 1)] }))).toContain('zu lang');
    expect(normalizeItemMeta({ tags: many.slice(0, META_LIMITS.tags) }).tags).toHaveLength(META_LIMITS.tags);
  });
  it('lehnt ein ungültiges Datum mit Hinweis ab', () => {
    expect(message(() => normalizeItemMeta({ expiresAt: '31.02.2026' }))).toContain('ungültig');
    expect(message(() => normalizeItemMeta({ expiresAt: 'bald' }))).toContain('Ablaufdatum');
  });
});

describe('fillMissingMeta', () => {
  it('lässt vorhandene Angaben unverändert und ergänzt nur Fehlendes', () => {
    expect(fillMissingMeta({ label: 'Alt', tags: ['a'] }, { label: 'Neu', purpose: 'P', tags: ['A', 'b'], expiresAt: '2026-01-01' })).toEqual({
      label: 'Alt',
      purpose: 'P',
      tags: ['a', 'b'],
      expiresAt: '2026-01-01'
    });
  });
});

describe('matchesQuery / collectTags', () => {
  const item = { value: '4006381333931', label: 'Bio-Äpfel', purpose: 'Kassentest', note: 'Aktion KW 12', tags: ['Obst'] };
  it('findet in Wert, Wort, Nutzen, Satz und Tags ohne Rücksicht auf Schreibweise', () => {
    for (const q of ['400638', 'äpfel', 'KASSEN', 'kw 12', 'obst', '']) expect(matchesQuery(item, q)).toBe(true);
    expect(matchesQuery(item, 'birne')).toBe(false);
  });
  it('sammelt alle Tags eindeutig und sortiert', () => {
    expect(collectTags([{ tags: ['b', 'A'] }, { tags: ['a'] }, {}])).toEqual(['A', 'b']);
  });
});
