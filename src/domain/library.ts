/**
 * Gemeinsame Bibliothek: Sammlungen, die als Dateien (`library/*.barq.json`) zusammen mit der App veröffentlicht werden.
 * Wer die App-Adresse öffnet, kann sie übernehmen und bekommt dieselben Codes samt Wort, Nutzen, Satz, Tags und Ablaufdatum.
 *
 * Diese Datei enthält nur reine Logik: Index-Prüfung, Inhalts-Fingerabdruck und Statusbestimmung.
 */
import { AppError } from './errors';
import type { ShareItem } from './share-format';
import type { LibraryLink } from './types';

/** Kennung des Bibliotheksindexes. */
export const LIBRARY_FORMAT = 'barq-player-library';
/** Aktuelle Schemaversion des Indexes. */
export const LIBRARY_SCHEMA_VERSION = 1;
/** Höchstzahl Dateien im Index (Schutz vor unbrauchbaren Indexen). */
export const MAX_LIBRARY_FILES = 200;

/** Index der Bibliothek (`library/index.json`). */
export interface LibraryIndex {
  format: typeof LIBRARY_FORMAT;
  schemaVersion: number;
  /** Dateinamen der Sammlungen (relativ zu `library/`). */
  files: string[];
}

/** Erlaubte Dateinamen: nur Buchstaben, Ziffern, `_`, `-`, `.` – keine Pfade (kein `..`, kein `/`). */
const FILE_NAME = /^[\p{L}\p{N}_.-]{1,100}\.json$/u;

/**
 * Prüft, ob ein Dateiname für die Bibliothek zulässig ist (verhindert Pfadtricks wie `../x.json`).
 * @param name - Dateiname.
 * @returns `true`, wenn zulässig.
 */
export function isValidLibraryFileName(name: string): boolean {
  return FILE_NAME.test(name) && !name.includes('..') && name !== 'index.json';
}

function indexError(message: string, cause?: unknown): AppError {
  return new AppError('ERR_IMPORT_SCHEMA_INVALID', { details: message, ...(cause === undefined ? {} : { cause }), userMessage: message });
}

/**
 * Liest und prüft den Bibliotheksindex.
 * @param text - Inhalt von `library/index.json`.
 * @returns geprüfter Index (doppelte Dateinamen entfallen).
 * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID` bei ungültigem JSON, falschem Format oder unzulässigen Dateinamen.
 */
export function parseLibraryIndex(text: string): LibraryIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error: unknown) {
    throw indexError('Der Bibliotheksindex ist kein gültiges JSON.', error);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw indexError('Der Bibliotheksindex hat ein ungültiges Format.');
  const rec = parsed as Record<string, unknown>;
  if (rec['format'] !== LIBRARY_FORMAT) throw indexError('Das ist kein BarQPlayer-Bibliotheksindex.');
  const version = rec['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw indexError('Der Bibliotheksindex hat keine gültige Versionsnummer.');
  if (version > LIBRARY_SCHEMA_VERSION) throw indexError('Die Bibliothek stammt von einer neueren App-Version. Bitte die App aktualisieren.');
  const files = rec['files'];
  if (!Array.isArray(files)) throw indexError('Der Bibliotheksindex enthält keine Dateiliste.');
  if (files.length > MAX_LIBRARY_FILES) throw indexError(`Der Bibliotheksindex enthält mehr als ${MAX_LIBRARY_FILES} Dateien.`);
  const out: string[] = [];
  for (const f of files) {
    if (typeof f !== 'string' || !isValidLibraryFileName(f)) throw indexError(`Unzulässiger Dateiname im Bibliotheksindex: „${String(f).slice(0, 40)}“.`);
    if (!out.includes(f)) out.push(f);
  }
  return { format: LIBRARY_FORMAT, schemaVersion: version, files: out };
}

/**
 * Fingerabdruck (cyrb53, 53 Bit) einer Zeichenkette – nur zur Änderungserkennung, kein Sicherheitsmerkmal.
 * @param text - Eingabe.
 * @returns 14-stelliger Hexwert.
 */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Fingerabdruck des Inhalts einer Sammlung: Reihenfolge, Werte, Mengen und alle Zusatzangaben zählen,
 * Name, Zeitstempel und App-Version nicht.
 * @param items - Codes im Austauschformat (oder gleichwertig).
 * @returns Fingerabdruck.
 */
export function contentHash(items: readonly ShareItem[]): string {
  const canonical = items.map((i) => [i.symbology, i.value, i.quantity, i.label ?? '', i.purpose ?? '', i.note ?? '', (i.tags ?? []).join('\u0001'), i.expiresAt ?? '']);
  return fingerprint(JSON.stringify(canonical));
}

/** Status einer Bibliotheksdatei im Vergleich zum Gerät. */
export type LibraryEntryStatus = 'new' | 'current' | 'update' | 'update-modified' | 'modified';

/**
 * Bestimmt den Status einer Bibliotheksdatei.
 * @param remoteHash - Fingerabdruck der veröffentlichten Datei.
 * @param local - lokale Verknüpfung samt Fingerabdruck des aktuellen lokalen Inhalts; `null`, wenn noch nicht übernommen.
 * @returns `new` (noch nicht übernommen), `current` (identisch), `update` (neue Version, lokal unverändert),
 * `update-modified` (neue Version, aber lokal geändert – Aktualisieren überschreibt die Änderungen) oder
 * `modified` (nur lokal geändert, keine neue Version).
 */
export function libraryEntryStatus(remoteHash: string, local: { link: LibraryLink; currentHash: string } | null): LibraryEntryStatus {
  if (local === null) return 'new';
  const localChanged = local.currentHash !== local.link.hash;
  const remoteChanged = remoteHash !== local.link.hash;
  if (remoteChanged) return localChanged ? 'update-modified' : 'update';
  return localChanged ? 'modified' : 'current';
}
