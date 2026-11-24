import { describe, expect, it } from 'vitest';
import { countIdenticalTransitions, interleave } from '../../src/domain/interleaver';

interface Item {
  id: number;
  key: string;
}
const keyOf = (i: Item): string => i.key;
const mk = (keys: string): Item[] => [...keys].map((key, id) => ({ id, key }));
const keysOf = (items: readonly Item[]): string => items.map((i) => i.key).join('');

describe('countIdenticalTransitions', () => {
  it('zählt direkte identische Nachbarn', () => {
    expect(countIdenticalTransitions(mk(''), keyOf)).toBe(0);
    expect(countIdenticalTransitions(mk('A'), keyOf)).toBe(0);
    expect(countIdenticalTransitions(mk('AABA'), keyOf)).toBe(1);
    expect(countIdenticalTransitions(mk('AAAA'), keyOf)).toBe(3);
  });
});

describe('interleave', () => {
  it('leere und einelementige Liste', () => {
    expect(interleave([], keyOf).items).toEqual([]);
    const one = interleave(mk('A'), keyOf);
    expect(keysOf(one.items)).toBe('A');
    expect(one.stats).toMatchObject({ total: 1, identicalTransitionsBefore: 0, identicalTransitionsAfter: 0, reordered: false });
  });

  it('lässt Listen ohne identische Nachbarn unverändert (kein unnötiges Umsortieren)', () => {
    const r = interleave(mk('ABCA'), keyOf);
    expect(keysOf(r.items)).toBe('ABCA');
    expect(r.stats.reordered).toBe(false);
  });

  it('trennt identische Nachbarn: AAABBC → keine Wiederholung mehr, Statistik stimmt', () => {
    const r = interleave(mk('AAABBC'), keyOf);
    expect(countIdenticalTransitions(r.items, keyOf)).toBe(0);
    expect(keysOf(r.items)).toBe('ABABAC');
    expect(r.stats).toEqual({
      total: 6,
      identicalTransitionsBefore: 3,
      identicalTransitionsAfter: 0,
      avoidedTransitions: 3,
      reordered: true
    });
  });

  it('Gleichstand: der zuerst aufgetretene Wert gewinnt (AABB → ABAB)', () => {
    expect(keysOf(interleave(mk('AABB'), keyOf).items)).toBe('ABAB');
  });

  it('alle identisch: unvermeidbar, Reihenfolge bleibt, Statistik meldet Rest', () => {
    const r = interleave(mk('AAAA'), keyOf);
    expect(keysOf(r.items)).toBe('AAAA');
    expect(r.stats.identicalTransitionsAfter).toBe(3);
    expect(r.stats.avoidedTransitions).toBe(0);
  });

  it('zu häufiger Wert: vermeidet so viele wie möglich (AAAB → ABAA)', () => {
    const r = interleave(mk('AAAB'), keyOf);
    expect(keysOf(r.items)).toBe('ABAA');
    expect(r.stats.identicalTransitionsBefore).toBe(2);
    expect(r.stats.identicalTransitionsAfter).toBe(1);
    expect(r.stats.avoidedTransitions).toBe(1);
  });

  it('abgeschaltet: Reihenfolge bleibt, Statistik wird trotzdem geliefert', () => {
    const r = interleave(mk('AAABBC'), keyOf, { enabled: false });
    expect(keysOf(r.items)).toBe('AAABBC');
    expect(r.stats).toMatchObject({ identicalTransitionsBefore: 3, identicalTransitionsAfter: 3, avoidedTransitions: 0, reordered: false });
  });

  it('verändert die Eingabe nicht und ist deterministisch', () => {
    const input = mk('AAABBC');
    const copy = [...input];
    const a = interleave(input, keyOf);
    const b = interleave(input, keyOf);
    expect(input).toEqual(copy);
    expect(a.items).toEqual(b.items);
    expect(a.items).not.toBe(input);
  });

  it('erhält Multimenge und Originalreihenfolge innerhalb gleicher Werte', () => {
    const r = interleave(mk('AABABBCA'), keyOf);
    expect([...r.items].map((i) => i.id).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const k of ['A', 'B', 'C']) {
      const ids = r.items.filter((i) => i.key === k).map((i) => i.id);
      expect(ids).toEqual([...ids].sort((x, y) => x - y));
    }
  });

  it('Eigenschaftstest: nie schlechter als vorher; optimal, wenn Trennung möglich ist', () => {
    let seed = 42;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const n = 1 + rnd(30);
      const kinds = 1 + rnd(6);
      const items = mk(Array.from({ length: n }, () => String.fromCharCode(65 + rnd(kinds))).join(''));
      const r = interleave(items, keyOf);
      const counts = new Map<string, number>();
      items.forEach((i) => counts.set(i.key, (counts.get(i.key) ?? 0) + 1));
      const maxCount = Math.max(...counts.values());
      expect(r.items).toHaveLength(n);
      expect(r.stats.identicalTransitionsAfter).toBeLessThanOrEqual(r.stats.identicalTransitionsBefore);
      if (maxCount <= Math.ceil(n / 2)) expect(r.stats.identicalTransitionsAfter).toBe(0);
      else expect(r.stats.identicalTransitionsAfter).toBe(maxCount - (n - maxCount) - 1);
    }
  });

  it('der Schlüssel definiert Identität (z. B. Symbologie + Wert)', () => {
    const items = [
      { id: 0, key: 'EAN13:1' },
      { id: 1, key: 'QR:1' },
      { id: 2, key: 'EAN13:1' }
    ];
    expect(interleave(items, keyOf).stats.identicalTransitionsBefore).toBe(0);
  });
});
