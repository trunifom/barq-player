/**
 * Aufbau der Ausgabeliste einer Wiedergabesitzung aus den Einträgen einer Sammlung.
 * Reine Logik: Mengen werden zu Wiederholungen, optional wird Smart-Interleaving angewendet.
 */
import { AppError } from './errors';
import { interleave, type InterleaveStats } from './interleaver';
import type { BarcodeItem, PlaybackEntry } from './types';

/** Obergrenze der Positionen einer Sitzung (Schutz vor unbrauchbar langen Läufen). */
export const MAX_PLAYBACK_ENTRIES = 5000;

/**
 * Identitätsschlüssel zweier Ausgabepositionen (identische Symbole direkt hintereinander sind kritisch).
 * @param entry - Position.
 * @returns `Symbologie\0Wert`.
 */
export function entryKey(entry: Pick<PlaybackEntry, 'symbology' | 'value'>): string {
  return `${entry.symbology}\u0000${entry.value}`;
}

/**
 * Erzeugt die Ausgabeliste: nach Position sortiert, jede Menge als `quantity` Wiederholungen
 * (`repetition` 0-basiert, ID `<itemId>#<n>`).
 * @param items - Einträge einer Sammlung.
 * @returns Liste der Positionen.
 * @throws {AppError} `ERR_PLAYBACK_FAILED`, wenn die Liste leer ist oder {@link MAX_PLAYBACK_ENTRIES} überschreitet.
 */
export function buildPlaybackEntries(items: readonly BarcodeItem[]): PlaybackEntry[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const total = sorted.reduce((sum, i) => sum + i.quantity, 0);
  if (sorted.length === 0 || total === 0) {
    throw new AppError('ERR_PLAYBACK_FAILED', { details: 'Sammlung ist leer', userMessage: 'Die Sammlung enthält keine Codes zum Abspielen.' });
  }
  if (total > MAX_PLAYBACK_ENTRIES) {
    throw new AppError('ERR_PLAYBACK_FAILED', {
      details: `${total} Positionen > ${MAX_PLAYBACK_ENTRIES}`,
      userMessage: `Die Sammlung ergibt ${total} Positionen; erlaubt sind höchstens ${MAX_PLAYBACK_ENTRIES} pro Sitzung. Bitte aufteilen.`
    });
  }
  const entries: PlaybackEntry[] = [];
  for (const item of sorted) {
    for (let rep = 0; rep < item.quantity; rep++) {
      entries.push({ id: `${item.id}#${rep + 1}`, sourceItemId: item.id, repetition: rep, value: item.value, symbology: item.symbology });
    }
  }
  return entries;
}

/**
 * Wendet das Smart-Interleaving auf eine Ausgabeliste an.
 * @param entries - Liste.
 * @param enabled - `false` lässt die Reihenfolge unverändert.
 * @returns neue Liste und Statistik.
 */
export function interleaveEntries(entries: readonly PlaybackEntry[], enabled: boolean): { entries: PlaybackEntry[]; stats: InterleaveStats } {
  const result = interleave(entries, entryKey, { enabled });
  return { entries: result.items, stats: result.stats };
}

/** Anzahl der Testpositionen der Kassen-Kalibrierung. */
export const CALIBRATION_ENTRY_COUNT = 20;

/**
 * Baut die Testliste der Kalibrierung: die Positionen der Sammlung werden der Reihe nach (inkl. Mengen) und bei Bedarf
 * zyklisch wiederholt, bis genau {@link CALIBRATION_ENTRY_COUNT} Positionen vorliegen. Ohne Interleaving, damit auch
 * identische Folgecodes (Mengen > 1) getestet werden.
 * @param items - Einträge der Testsammlung.
 * @returns genau 20 Positionen mit eindeutigen IDs.
 * @throws {AppError} `ERR_PLAYBACK_FAILED`, wenn die Sammlung leer ist.
 */
export function buildCalibrationEntries(items: readonly BarcodeItem[]): PlaybackEntry[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const expanded: PlaybackEntry[] = [];
  for (const item of sorted) {
    for (let rep = 0; rep < item.quantity && expanded.length < CALIBRATION_ENTRY_COUNT; rep++) {
      expanded.push({ id: '', sourceItemId: item.id, repetition: rep, value: item.value, symbology: item.symbology });
    }
  }
  if (expanded.length === 0) {
    throw new AppError('ERR_PLAYBACK_FAILED', { details: 'Testsammlung ist leer', userMessage: 'Die Testsammlung enthält keine Codes.' });
  }
  const out: PlaybackEntry[] = [];
  for (let i = 0; i < CALIBRATION_ENTRY_COUNT; i++) {
    const base = expanded[i % expanded.length];
    if (!base) break;
    out.push({ ...base, id: `cal-${i + 1}`, repetition: Math.floor(i / expanded.length) + base.repetition });
  }
  return out;
}
