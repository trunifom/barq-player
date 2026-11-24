/**
 * Versionierte IndexedDB-Datenbank (Dexie) für BarQPlayer.
 *
 * Schemaversionen (Änderungen NUR durch neue `version(n)`-Blöcke mit `upgrade`, nie rückwirkend):
 * - v1: collections, items, templates, profiles, catalog, sessions, events
 *
 * Schreibzugriffe laufen über {@link guardWrite}: Fehler werden typisiert (Quota/Schreibfehler),
 * nie verschluckt. Eine Anwendungsbestätigung („gespeichert“) darf erst nach erfolgreichem Rückgabewert erfolgen.
 */
import Dexie, { type EntityTable } from 'dexie';
import { AppError, isAppError } from '../../domain/errors';
import type {
  BarcodeItem,
  CatalogProduct,
  Collection,
  FaderProfile,
  PlaybackEvent,
  SequenceTemplate,
  SessionRecord
} from '../../domain/types';

/** Standardname der Datenbank. */
export const DB_NAME = 'barq-player';
/** Aktuelle Dexie-Schemaversion (siehe Dateikopf). */
export const DB_SCHEMA_VERSION = 1;

/** Die BarQPlayer-Datenbank mit typisierten Tabellen. */
export class BarqDatabase extends Dexie {
  collections!: EntityTable<Collection, 'id'>;
  items!: EntityTable<BarcodeItem, 'id'>;
  templates!: EntityTable<SequenceTemplate, 'id'>;
  profiles!: EntityTable<FaderProfile, 'id'>;
  catalog!: EntityTable<CatalogProduct, 'value'>;
  sessions!: EntityTable<SessionRecord, 'id'>;
  events!: EntityTable<PlaybackEvent, 'id'>;

  /**
   * @param name - Datenbankname (Tests verwenden eindeutige Namen).
   */
  constructor(name: string = DB_NAME) {
    super(name);
    this.version(DB_SCHEMA_VERSION).stores({
      collections: 'id, name, updatedAt',
      items: 'id, collectionId, [collectionId+position], value',
      templates: 'id, name',
      profiles: 'id',
      catalog: 'value',
      sessions: 'id, collectionId, startedAt',
      events: 'id, sessionId, timestamp'
    });
  }
}

/**
 * Erzeugt eine Datenbankinstanz.
 * @param name - optionaler Datenbankname.
 * @returns neue Instanz (noch nicht geöffnet; Dexie öffnet automatisch beim ersten Zugriff).
 */
export function createDatabase(name?: string): BarqDatabase {
  return new BarqDatabase(name);
}

/**
 * Übersetzt Speicherfehler in einen {@link AppError} (`ERR_STORAGE_QUOTA_EXCEEDED` bzw. `ERR_STORAGE_WRITE_FAILED`).
 * @param error - gefangener Wert.
 * @returns AppError; vorhandene AppErrors bleiben unverändert.
 */
export function mapStorageError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const names: string[] = [];
  let cursor: unknown = error;
  for (let depth = 0; depth < 4 && cursor instanceof Error; depth++) {
    names.push(cursor.name);
    cursor = (cursor as Error & { inner?: unknown }).inner;
  }
  const details = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const code = names.includes('QuotaExceededError') ? 'ERR_STORAGE_QUOTA_EXCEEDED' : 'ERR_STORAGE_WRITE_FAILED';
  return new AppError(code, { details, cause: error });
}

/**
 * Führt einen Datenbankvorgang aus und übersetzt Fehler typisiert.
 * @param operation - asynchroner Vorgang (z. B. eine Dexie-Transaktion).
 * @returns Ergebnis des Vorgangs.
 * @throws {AppError} `ERR_STORAGE_*`, nie ein roher Dexie-Fehler.
 */
export async function guardWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw mapStorageError(error);
  }
}

/** Minimale Sicht auf `navigator.storage` (injizierbar für Tests). */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/** Zustand des Browser-Speichers für die Anzeige. */
export interface PersistenceStatus {
  /** `false`, wenn der Browser keine Storage-API anbietet. */
  supported: boolean;
  /** `true`, wenn der Speicher als persistent gilt (nicht automatisch löschbar). */
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Fehler bei der Anfrage (z. B. Ablehnung durch den Browser ist KEIN Fehler, sondern `persisted=false`). */
  error: AppError | null;
}

function defaultStorage(): StorageManagerLike | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

/**
 * Fragt persistenten Speicher an (`navigator.storage.persist()`) und liefert Status samt Schätzung.
 * Persistenter Speicher ersetzt kein Backup (Spezifikation 20).
 * @param storage - Storage-Manager; Standard `navigator.storage`.
 * @returns Status; Fehler stehen in `error`, die Funktion wirft nie.
 */
export async function requestPersistentStorage(storage: StorageManagerLike | undefined = defaultStorage()): Promise<PersistenceStatus> {
  const status: PersistenceStatus = { supported: false, persisted: false, usageBytes: null, quotaBytes: null, error: null };
  if (!storage) return status;
  status.supported = true;
  try {
    if (storage.persisted) status.persisted = await storage.persisted();
    if (!status.persisted && storage.persist) status.persisted = await storage.persist();
    if (storage.estimate) {
      const est = await storage.estimate();
      status.usageBytes = est.usage ?? null;
      status.quotaBytes = est.quota ?? null;
    }
  } catch (error: unknown) {
    status.error = new AppError('ERR_UNKNOWN', {
      details: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      cause: error,
      userMessage: 'Der Speicherstatus konnte nicht ermittelt werden.'
    });
  }
  return status;
}
