/**
 * Versioniertes JSON-Backup: Datenformat und strikte Vorabprüfung (rein, ohne Datenbank).
 *
 * Ein Import darf die vorhandenen Daten erst anfassen, wenn {@link validateBackup} die komplette
 * Datei akzeptiert hat. Unbekannte Zusatzfelder werden verworfen (es werden nur bekannte Felder
 * übernommen); Barcode-Werte werden nie verändert.
 */
import { AppError } from './errors';
import { isValidDateString } from './expiry';
import { isValidLibraryFileName } from './library';
import type {
  BarcodeItem,
  CatalogProduct,
  Collection,
  FaderProfile,
  LibraryLink,
  PlaybackEvent,
  SequenceDefinition,
  SequenceTemplate,
  SessionRecord
} from './types';

/** Kennung des Dateiformats. */
export const BACKUP_FORMAT = 'barq-player-backup';
/** Aktuelle Schemaversion des Backups. */
export const BACKUP_SCHEMA_VERSION = 1;
/** Maximale Zahl gemeldeter Probleme (Rest wird zusammengefasst). */
const MAX_ISSUES = 50;

/** Inhalt aller Tabellen. */
export interface BackupData {
  collections: Collection[];
  items: BarcodeItem[];
  templates: SequenceTemplate[];
  profiles: FaderProfile[];
  catalog: CatalogProduct[];
  sessions: SessionRecord[];
  events: PlaybackEvent[];
}

/** Backup-Datei. */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  data: BackupData;
}

/** Feldgenaues Problem (Pfad wie `data.items[3].quantity`). */
export interface BackupIssue {
  path: string;
  message: string;
}

/** Ergebnis der Prüfung. */
export type BackupValidation = { ok: true; backup: BackupFile } | { ok: false; issues: BackupIssue[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const SYMBOLOGIES = ['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'] as const;
const SEQ_SYMBOLOGIES = ['EAN13', 'EAN8', 'QRCode', 'Code128'] as const;
const SOURCES = ['camera', 'image', 'manual', 'import', 'sequence'] as const;
const SYNTAX = ['unchecked', 'valid', 'invalid'] as const;
const CHECKSUM = ['unchecked', 'valid', 'invalid', 'not-applicable'] as const;
const CATALOG = ['unchecked', 'known', 'unknown', 'inactive'] as const;
const EVENT_TYPES = ['displayed', 'blanked', 'paused', 'manual-confirmed', 'pos-accepted', 'pos-rejected', 'uncertain'] as const;
const EVIDENCE = ['player', 'operator', 'sensor', 'pos'] as const;
const MODES = ['manual', 'auto', 'batch'] as const;
const SESSION_STATUS = ['running', 'finished', 'aborted', 'error'] as const;
const CHECKSUM_MODES = ['gs1-mod10', 'none'] as const;

/** Sammelt Probleme und liest typgeprüfte Felder. */
class Reader {
  readonly issues: BackupIssue[] = [];
  private overflow = 0;

  add(path: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ path, message });
    else this.overflow++;
  }

  get extra(): number {
    return this.overflow;
  }

  str(o: Rec, key: string, path: string, opts: { nonEmpty?: boolean } = {}): string {
    const v = o[key];
    if (typeof v !== 'string' || (opts.nonEmpty === true && v === '')) {
      this.add(`${path}.${key}`, opts.nonEmpty === true ? 'muss ein nichtleerer Text sein' : 'muss ein Text sein');
      return '';
    }
    return v;
  }

  optStr(o: Rec, key: string, path: string): string | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string') {
      this.add(`${path}.${key}`, 'muss ein Text sein');
      return undefined;
    }
    return v;
  }

  optTags(o: Rec, key: string, path: string): string[] | undefined {
    const v = o[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((t: unknown) => typeof t !== 'string')) {
      this.add(`${path}.${key}`, 'muss eine Liste von Texten sein');
      return undefined;
    }
    return v as string[];
  }

  optDate(o: Rec, key: string, path: string): string | undefined {
    const v = this.optStr(o, key, path);
    if (v === undefined || v === '') return undefined;
    if (!isValidDateString(v)) {
      this.add(`${path}.${key}`, 'muss ein Datum im Format JJJJ-MM-TT sein');
      return undefined;
    }
    return v;
  }

  int(o: Rec, key: string, path: string, min: number): number {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
      this.add(`${path}.${key}`, `muss eine ganze Zahl ≥ ${min} sein`);
      return min;
    }
    return v;
  }

  num(o: Rec, key: string, path: string, min: number, strict: boolean): number {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || (strict ? v <= min : v < min)) {
      this.add(`${path}.${key}`, `muss eine Zahl ${strict ? '>' : '≥'} ${min} sein`);
      return min;
    }
    return v;
  }

  bool(o: Rec, key: string, path: string): boolean {
    const v = o[key];
    if (typeof v !== 'boolean') {
      this.add(`${path}.${key}`, 'muss true oder false sein');
      return false;
    }
    return v;
  }

  oneOf<T extends string>(o: Rec, key: string, path: string, allowed: readonly T[]): T {
    const v = o[key];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.add(`${path}.${key}`, `muss einer der Werte ${allowed.join(', ')} sein`);
      return allowed[0] as T;
    }
    return v as T;
  }

  list(o: Rec, key: string, path: string): Rec[] {
    const v = o[key];
    if (!Array.isArray(v)) {
      this.add(`${path}.${key}`, 'muss eine Liste sein');
      return [];
    }
    const out: Rec[] = [];
    v.forEach((entry: unknown, i) => {
      if (isRec(entry)) out.push(entry);
      else this.add(`${path}.${key}[${i}]`, 'muss ein Objekt sein');
    });
    return out;
  }
}

function readDefinition(r: Reader, o: unknown, path: string): SequenceDefinition {
  const rec: Rec = isRec(o) ? o : {};
  if (!isRec(o)) r.add(path, 'muss ein Objekt sein');
  const overflow = rec['overflow'];
  if (overflow !== 'stop') r.add(`${path}.overflow`, 'muss „stop“ sein');
  const maxItems = rec['maxItems'];
  if (maxItems !== undefined && (typeof maxItems !== 'number' || !Number.isInteger(maxItems) || maxItems < 1)) {
    r.add(`${path}.maxItems`, 'muss eine ganze Zahl ≥ 1 sein');
  }
  return {
    id: r.str(rec, 'id', path, { nonEmpty: true }),
    symbology: r.oneOf(rec, 'symbology', path, SEQ_SYMBOLOGIES),
    prefix: r.str(rec, 'prefix', path),
    suffixBeforeCheckDigit: r.str(rec, 'suffixBeforeCheckDigit', path),
    variableWidth: r.int(rec, 'variableWidth', path, 1),
    start: r.str(rec, 'start', path),
    end: r.str(rec, 'end', path),
    step: r.str(rec, 'step', path),
    checksumMode: r.oneOf(rec, 'checksumMode', path, CHECKSUM_MODES),
    overflow: 'stop',
    ...(typeof maxItems === 'number' && Number.isInteger(maxItems) && maxItems >= 1 ? { maxItems } : {})
  };
}

function checkUnique(r: Reader, rows: readonly { id?: string; value?: string }[], path: string, key: 'id' | 'value'): void {
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const id = row[key] ?? '';
    if (id !== '' && seen.has(id)) r.add(`${path}[${i}].${key}`, `„${id}“ kommt doppelt vor`);
    seen.add(id);
  });
}

/**
 * Prüft eine bereits geparste Backup-Datei vollständig (Struktur, Typen, Aufzählungen, eindeutige IDs,
 * Verweise Eintrag → Sammlung und Ereignis → Sitzung, eindeutige Positionen je Sammlung).
 * @param input - beliebiger Wert (unvertrauenswürdig).
 * @returns bereinigte Datei oder die Liste der Probleme.
 */
export function validateBackup(input: unknown): BackupValidation {
  const r = new Reader();
  if (!isRec(input)) return { ok: false, issues: [{ path: '$', message: 'Die Datei muss ein JSON-Objekt sein' }] };
  if (input['format'] !== BACKUP_FORMAT) {
    return { ok: false, issues: [{ path: 'format', message: `muss „${BACKUP_FORMAT}“ sein (keine BarQPlayer-Sicherung)` }] };
  }
  const version = input['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, issues: [{ path: 'schemaVersion', message: 'muss eine ganze Zahl ≥ 1 sein' }] };
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [{ path: 'schemaVersion', message: `Version ${version} stammt von einer neueren App (unterstützt bis ${BACKUP_SCHEMA_VERSION}). Bitte App aktualisieren.` }]
    };
  }
  const exportedAt = r.str(input, 'exportedAt', '$');
  const appVersion = r.str(input, 'appVersion', '$');
  const dataRaw = input['data'];
  if (!isRec(dataRaw)) {
    r.add('data', 'muss ein Objekt sein');
    return { ok: false, issues: r.issues };
  }

  const collections: Collection[] = r.list(dataRaw, 'collections', 'data').map((o, i) => {
    const p = `data.collections[${i}]`;
    const libRaw = o['library'];
    let library: LibraryLink | undefined;
    if (libRaw !== undefined) {
      if (!isRec(libRaw)) r.add(`${p}.library`, 'muss ein Objekt sein');
      else {
        const file = r.str(libRaw, 'file', `${p}.library`, { nonEmpty: true });
        if (file !== '' && !isValidLibraryFileName(file)) r.add(`${p}.library.file`, 'ist kein zulässiger Bibliotheks-Dateiname');
        library = { file, hash: r.str(libRaw, 'hash', `${p}.library`), importedAt: r.str(libRaw, 'importedAt', `${p}.library`) };
      }
    }
    return {
      id: r.str(o, 'id', p, { nonEmpty: true }),
      name: r.str(o, 'name', p, { nonEmpty: true }),
      createdAt: r.str(o, 'createdAt', p),
      updatedAt: r.str(o, 'updatedAt', p),
      ...(library === undefined ? {} : { library })
    };
  });

  const items: BarcodeItem[] = r.list(dataRaw, 'items', 'data').map((o, i) => {
    const p = `data.items[${i}]`;
    const catalogSource = r.optStr(o, 'catalogSource', p);
    const catalogCheckedAt = r.optStr(o, 'catalogCheckedAt', p);
    const label = r.optStr(o, 'label', p);
    const purpose = r.optStr(o, 'purpose', p);
    const note = r.optStr(o, 'note', p);
    const tags = r.optTags(o, 'tags', p);
    const expiresAt = r.optDate(o, 'expiresAt', p);
    return {
      id: r.str(o, 'id', p, { nonEmpty: true }),
      collectionId: r.str(o, 'collectionId', p, { nonEmpty: true }),
      position: r.int(o, 'position', p, 0),
      symbology: r.oneOf(o, 'symbology', p, SYMBOLOGIES),
      value: r.str(o, 'value', p, { nonEmpty: true }),
      quantity: r.int(o, 'quantity', p, 1),
      source: r.oneOf(o, 'source', p, SOURCES),
      capturedAt: r.str(o, 'capturedAt', p),
      syntaxStatus: r.oneOf(o, 'syntaxStatus', p, SYNTAX),
      checksumStatus: r.oneOf(o, 'checksumStatus', p, CHECKSUM),
      catalogStatus: r.oneOf(o, 'catalogStatus', p, CATALOG),
      ...(catalogSource === undefined ? {} : { catalogSource }),
      ...(catalogCheckedAt === undefined ? {} : { catalogCheckedAt }),
      ...(label === undefined ? {} : { label }),
      ...(purpose === undefined ? {} : { purpose }),
      ...(note === undefined ? {} : { note }),
      ...(tags === undefined || tags.length === 0 ? {} : { tags }),
      ...(expiresAt === undefined ? {} : { expiresAt })
    };
  });

  const templates: SequenceTemplate[] = r.list(dataRaw, 'templates', 'data').map((o, i) => {
    const p = `data.templates[${i}]`;
    return {
      id: r.str(o, 'id', p, { nonEmpty: true }),
      name: r.str(o, 'name', p, { nonEmpty: true }),
      pattern: r.str(o, 'pattern', p),
      definition: readDefinition(r, o['definition'], `${p}.definition`),
      createdAt: r.str(o, 'createdAt', p),
      updatedAt: r.str(o, 'updatedAt', p)
    };
  });

  const profiles: FaderProfile[] = r.list(dataRaw, 'profiles', 'data').map((o, i) => {
    const p = `data.profiles[${i}]`;
    const notes = r.optStr(o, 'notes', p);
    return {
      id: r.str(o, 'id', p, { nonEmpty: true }),
      name: r.str(o, 'name', p, { nonEmpty: true }),
      displayMs: r.num(o, 'displayMs', p, 0, true),
      blankMs: r.num(o, 'blankMs', p, 0, false),
      identicalBlankMs: r.num(o, 'identicalBlankMs', p, 0, false),
      startDelayMs: r.num(o, 'startDelayMs', p, 0, false),
      ...(notes === undefined ? {} : { notes })
    };
  });

  const catalog: CatalogProduct[] = r.list(dataRaw, 'catalog', 'data').map((o, i) => {
    const p = `data.catalog[${i}]`;
    const label = r.optStr(o, 'label', p);
    return {
      value: r.str(o, 'value', p, { nonEmpty: true }),
      active: r.bool(o, 'active', p),
      source: r.str(o, 'source', p),
      importedAt: r.str(o, 'importedAt', p),
      ...(label === undefined ? {} : { label })
    };
  });

  const sessions: SessionRecord[] = r.list(dataRaw, 'sessions', 'data').map((o, i) => {
    const p = `data.sessions[${i}]`;
    const profileId = r.optStr(o, 'profileId', p);
    let timing: SessionRecord['timing'];
    if (o['timing'] !== undefined) {
      const t = o['timing'];
      if (!isRec(t)) r.add(`${p}.timing`, 'muss ein Objekt sein');
      else timing = { displayMs: r.num(t, 'displayMs', `${p}.timing`, 0, false), blankMs: r.num(t, 'blankMs', `${p}.timing`, 0, false), identicalBlankMs: r.num(t, 'identicalBlankMs', `${p}.timing`, 0, false), startDelayMs: r.num(t, 'startDelayMs', `${p}.timing`, 0, false) };
    }
    if (typeof o['interleaved'] !== 'boolean') r.add(`${p}.interleaved`, 'muss true oder false sein');
    return {
      id: r.str(o, 'id', p, { nonEmpty: true }),
      collectionId: r.str(o, 'collectionId', p),
      startedAt: r.str(o, 'startedAt', p),
      mode: r.oneOf(o, 'mode', p, MODES),
      appVersion: r.str(o, 'appVersion', p),
      entryCount: r.int(o, 'entryCount', p, 0),
      interleaved: o['interleaved'] === true,
      status: r.oneOf(o, 'status', p, SESSION_STATUS),
      ...(profileId === undefined ? {} : { profileId }),
      ...(timing === undefined ? {} : { timing })
    };
  });

  const events: PlaybackEvent[] = r.list(dataRaw, 'events', 'data').map((o, i) => {
    const p = `data.events[${i}]`;
    const entryId = r.optStr(o, 'entryId', p);
    const detail = r.optStr(o, 'detail', p);
    return {
      id: r.str(o, 'id', p, { nonEmpty: true }),
      sessionId: r.str(o, 'sessionId', p, { nonEmpty: true }),
      timestamp: r.str(o, 'timestamp', p),
      type: r.oneOf(o, 'type', p, EVENT_TYPES),
      evidence: r.oneOf(o, 'evidence', p, EVIDENCE),
      ...(entryId === undefined ? {} : { entryId }),
      ...(detail === undefined ? {} : { detail })
    };
  });

  // Eindeutigkeit und Verweise
  checkUnique(r, collections, 'data.collections', 'id');
  checkUnique(r, items, 'data.items', 'id');
  checkUnique(r, templates, 'data.templates', 'id');
  checkUnique(r, profiles, 'data.profiles', 'id');
  checkUnique(r, catalog, 'data.catalog', 'value');
  checkUnique(r, sessions, 'data.sessions', 'id');
  checkUnique(r, events, 'data.events', 'id');
  const collectionIds = new Set(collections.map((c) => c.id));
  const positions = new Set<string>();
  items.forEach((it, i) => {
    if (it.collectionId !== '' && !collectionIds.has(it.collectionId)) {
      r.add(`data.items[${i}].collectionId`, `verweist auf unbekannte Sammlung „${it.collectionId}“`);
    }
    const key = `${it.collectionId}\u0000${it.position}`;
    if (positions.has(key)) r.add(`data.items[${i}].position`, `Position ${it.position} ist in der Sammlung doppelt vergeben`);
    positions.add(key);
  });
  const sessionIds = new Set(sessions.map((s) => s.id));
  events.forEach((ev, i) => {
    if (ev.sessionId !== '' && !sessionIds.has(ev.sessionId)) {
      r.add(`data.events[${i}].sessionId`, `verweist auf unbekannte Sitzung „${ev.sessionId}“`);
    }
  });

  if (r.issues.length > 0) {
    if (r.extra > 0) r.issues.push({ path: '…', message: `${r.extra} weitere Probleme nicht aufgeführt` });
    return { ok: false, issues: r.issues };
  }
  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      schemaVersion: version,
      exportedAt,
      appVersion,
      data: { collections, items, templates, profiles, catalog, sessions, events }
    }
  };
}

/**
 * Parst JSON-Text und prüft ihn vollständig.
 * @param text - Dateiinhalt.
 * @returns geprüftes Backup.
 * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID` bei ungültigem JSON oder Schemaproblemen
 *   (die ersten Probleme stehen mit Pfad in `userMessage`/`details`).
 */
export function parseBackupText(text: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error: unknown) {
    throw new AppError('ERR_IMPORT_SCHEMA_INVALID', {
      details: 'Kein gültiges JSON',
      cause: error,
      userMessage: 'Die Datei ist kein gültiges JSON und kann nicht importiert werden.'
    });
  }
  const result = validateBackup(json);
  if (!result.ok) {
    const listed = result.issues.slice(0, 5).map((i) => `${i.path}: ${i.message}`);
    const more = result.issues.length > 5 ? ` (+${result.issues.length - 5} weitere)` : '';
    throw new AppError('ERR_IMPORT_SCHEMA_INVALID', {
      details: result.issues.map((i) => `${i.path}: ${i.message}`).join('; '),
      userMessage: `Die Sicherung ist ungültig: ${listed.join('; ')}${more}`
    });
  }
  return result.backup;
}
