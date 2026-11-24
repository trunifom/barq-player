/**
 * Smart-Duplikat-Interleaver (abschaltbar).
 *
 * Scanner unterdrücken identische Symbole nach dem Lesen oft für eine Weile („Timeout Between Decodes,
 * Same Symbol“, Spezifikation 11.4). Der Interleaver ordnet die Ausgabeliste deshalb so um, dass
 * identische Codes möglichst nicht direkt hintereinander folgen.
 *
 * Verfahren: Greedy nach größter Restmenge (Max-Frequency-Round-Robin). In jedem Schritt wird aus den
 * Gruppen, die NICHT dem zuletzt gewählten Wert entsprechen, die mit den meisten Restelementen gewählt;
 * bei Gleichstand gewinnt der zuerst aufgetretene Wert. Innerhalb eines Werts bleibt die Originalreihenfolge.
 * Ist eine Trennung unmöglich (ein Wert kommt zu häufig vor), bleiben unvermeidbare Nachbarn bestehen
 * und werden in der Statistik ausgewiesen.
 *
 * Eine Liste ohne identische Nachbarn bleibt unverändert (kein unnötiges Umsortieren).
 */

/** Statistik eines Interleaving-Laufs. */
export interface InterleaveStats {
  /** Anzahl der Elemente. */
  total: number;
  /** Identische direkte Nachbarn in der Originalliste. */
  identicalTransitionsBefore: number;
  /** Identische direkte Nachbarn nach dem Interleaving. */
  identicalTransitionsAfter: number;
  /** Vermiedene identische Übergänge (`before − after`). */
  avoidedTransitions: number;
  /** `true`, wenn tatsächlich umsortiert wurde. */
  reordered: boolean;
}

/** Ergebnis von {@link interleave}. */
export interface InterleaveResult<T> {
  /** Neue Liste (Eingabe wird nie verändert). */
  items: T[];
  stats: InterleaveStats;
}

/** Optionen für {@link interleave}. */
export interface InterleaveOptions {
  /** `false` schaltet das Interleaving ab (Reihenfolge bleibt, Statistik wird trotzdem geliefert). Standard `true`. */
  enabled?: boolean;
}

/**
 * Zählt direkte Nachbarn mit gleichem Schlüssel.
 * @param items - Liste.
 * @param keyOf - liefert den Vergleichsschlüssel (z. B. Symbologie + Wert).
 * @returns Anzahl identischer Übergänge.
 */
export function countIdenticalTransitions<T>(items: readonly T[], keyOf: (item: T) => string): number {
  let count = 0;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev !== undefined && cur !== undefined && keyOf(prev) === keyOf(cur)) count++;
  }
  return count;
}

/**
 * Ordnet eine Liste so um, dass identische Elemente möglichst nicht direkt aufeinander folgen.
 * @param items - Eingabeliste (bleibt unverändert).
 * @param keyOf - Schlüssel, der „identisch“ definiert (z. B. `${symbology}:${value}`).
 * @param options - `enabled: false` deaktiviert das Umsortieren.
 * @returns neue Liste und Statistik.
 */
export function interleave<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  options: InterleaveOptions = {}
): InterleaveResult<T> {
  const before = countIdenticalTransitions(items, keyOf);
  const unchanged = (): InterleaveResult<T> => ({
    items: [...items],
    stats: {
      total: items.length,
      identicalTransitionsBefore: before,
      identicalTransitionsAfter: before,
      avoidedTransitions: 0,
      reordered: false
    }
  });
  if (options.enabled === false || before === 0) return unchanged();

  // Gruppen in Reihenfolge des ersten Auftretens; je Gruppe eine Warteschlange in Originalreihenfolge.
  const order: string[] = [];
  const queues = new Map<string, { items: T[]; next: number }>();
  for (const item of items) {
    const key = keyOf(item);
    let q = queues.get(key);
    if (!q) {
      q = { items: [], next: 0 };
      queues.set(key, q);
      order.push(key);
    }
    q.items.push(item);
  }

  const result: T[] = [];
  let lastKey: string | null = null;
  for (let step = 0; step < items.length; step++) {
    let bestKey: string | null = null;
    let bestRemaining = 0;
    for (const key of order) {
      if (key === lastKey) continue;
      const q = queues.get(key);
      if (!q) continue;
      const remaining = q.items.length - q.next;
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestKey = key;
      }
    }
    // Unvermeidbar: nur noch der zuletzt gewählte Wert ist übrig.
    bestKey ??= lastKey;
    const queue = bestKey === null ? undefined : queues.get(bestKey);
    const picked = queue?.items[queue.next];
    if (queue === undefined || picked === undefined) break; // kann bei konsistenter Eingabe nicht eintreten
    queue.next++;
    result.push(picked);
    lastKey = bestKey;
  }

  const after = countIdenticalTransitions(result, keyOf);
  return {
    items: result,
    stats: {
      total: items.length,
      identicalTransitionsBefore: before,
      identicalTransitionsAfter: after,
      avoidedTransitions: before - after,
      reordered: true
    }
  };
}
