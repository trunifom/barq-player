import { BarqDatabase } from '../../src/adapters/persistence/db';
import type { ServiceDeps } from '../../src/application/collection-service';

let counter = 0;
const opened: BarqDatabase[] = [];

/** Erzeugt eine frische, eindeutig benannte Test-Datenbank. */
export function freshDb(): BarqDatabase {
  const db = new BarqDatabase(`barq-test-${++counter}-${Date.now()}`);
  opened.push(db);
  return db;
}

/** Löscht alle in dieser Datei geöffneten Test-Datenbanken. */
export async function disposeDbs(): Promise<void> {
  while (opened.length > 0) {
    const db = opened.pop();
    if (db) await db.delete();
  }
}

/** Deterministische IDs (`id-1`, `id-2`, …) und Zeit (`t-1`, `t-2`, …). */
export function testDeps(): ServiceDeps {
  let id = 0;
  let t = 0;
  return { newId: () => `id-${++id}`, now: () => `2026-11-24T10:00:${String(++t).padStart(2, '0')}.000Z` };
}
