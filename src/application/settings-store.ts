/**
 * Kleine Bedieneinstellungen (zuletzt gewählte Sammlung/Profil, Modus, Schalter) in `localStorage`.
 *
 * Nur Komfort: Zugriffe sind abgesichert (Privatmodus, gesperrter Speicher, kaputtes JSON); Fehler führen nie zum
 * Abbruch, sondern zu Standardwerten bzw. zum Weiterarbeiten im Arbeitsspeicher. Sachdaten gehören in IndexedDB.
 */
import { DEFAULT_WHITELIST } from '../domain/detection';
import type { PlaybackMode } from '../domain/playback-machine';
import type { Symbology } from '../domain/types';

/** Einstellungen der App. */
export interface AppSettings {
  /** Zuletzt gewählte Sammlung (Scanner/Player). */
  collectionId: string | null;
  /** Zuletzt gewähltes Scannerprofil. */
  profileId: string | null;
  mode: PlaybackMode;
  /** Codes bis zur Bestätigung im Kleinstapel-Modus. */
  batchSize: number;
  /** Smart-Interleaving einschalten. */
  interleave: boolean;
  /** Beim Scannen nur eindeutige Codes erfassen. */
  uniqueOnly: boolean;
  /** Beim Scannen freigegebene Formate (Whitelist). */
  formats: Symbology[];
  sound: boolean;
  vibration: boolean;
  /** Lift-to-Pause-Sensor (Meilenstein 7) zuschalten. */
  liftToPause: boolean;
}

/** Standardwerte. */
const ALL_FORMATS: readonly Symbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'];

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  collectionId: null,
  profileId: null,
  mode: 'manual',
  batchSize: 5,
  interleave: false,
  uniqueOnly: false,
  formats: [...DEFAULT_WHITELIST],
  sound: true,
  vibration: true,
  liftToPause: false
});

/** Minimale Speicherschnittstelle. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Speicherschlüssel (mit Versionsnummer für spätere Migration). */
export const SETTINGS_KEY = 'barq-player.settings.v1';

/** Gültige, eindeutige Formate in fester Reihenfolge; leere/ungültige Liste → Standard. */
function sanitizeFormats(v: unknown, fallback: readonly Symbology[]): Symbology[] {
  if (!Array.isArray(v)) return [...fallback];
  const picked = ALL_FORMATS.filter((f) => v.includes(f));
  return picked.length > 0 ? picked : [...fallback];
}

/**
 * Prüft unvertrauenswürdige Daten feldweise; ungültige Felder fallen auf den Standard zurück.
 * @param raw - beliebiger Wert (z. B. geparstes JSON).
 * @returns gültige Einstellungen.
 */
export function sanitizeSettings(raw: unknown): AppSettings {
  const r: Record<string, unknown> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v.length <= 200 ? v : null);
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const mode = r['mode'];
  const batch = r['batchSize'];
  return {
    collectionId: str(r['collectionId']),
    profileId: str(r['profileId']),
    mode: mode === 'manual' || mode === 'auto' || mode === 'batch' ? mode : d.mode,
    batchSize: typeof batch === 'number' && Number.isInteger(batch) && batch >= 1 && batch <= 100 ? batch : d.batchSize,
    interleave: bool(r['interleave'], d.interleave),
    uniqueOnly: bool(r['uniqueOnly'], d.uniqueOnly),
    formats: sanitizeFormats(r['formats'], d.formats),
    sound: bool(r['sound'], d.sound),
    vibration: bool(r['vibration'], d.vibration),
    liftToPause: bool(r['liftToPause'], d.liftToPause)
  };
}

/** Kopie inkl. Formatliste (keine geteilten Arrays). */
function cloneSettings(s: AppSettings): AppSettings {
  return { ...s, formats: [...s.formats] };
}

/** Speicher für {@link AppSettings}. */
export class SettingsStore {
  private current: AppSettings;
  /** Letzter Speicherfehler (z. B. Privatmodus); `null`, wenn alles gespeichert werden konnte. */
  lastError: unknown = null;

  /**
   * @param storage - Speicher (Standard `localStorage`, falls zugreifbar); `null` = nur Arbeitsspeicher.
   * @param onError - meldet Lese-/Schreibfehler (nicht fatal).
   */
  constructor(
    private readonly storage: KeyValueStorage | null = defaultStorage(),
    private readonly onError?: (error: unknown) => void
  ) {
    this.current = this.load();
  }

  private load(): AppSettings {
    if (!this.storage) return cloneSettings(DEFAULT_SETTINGS);
    try {
      const text = this.storage.getItem(SETTINGS_KEY);
      return text === null ? cloneSettings(DEFAULT_SETTINGS) : sanitizeSettings(JSON.parse(text));
    } catch (error: unknown) {
      this.report(error);
      return cloneSettings(DEFAULT_SETTINGS);
    }
  }

  /** @returns Kopie der aktuellen Einstellungen. */
  get(): AppSettings {
    return cloneSettings(this.current);
  }

  /**
   * Ändert Einstellungen (mit Prüfung) und speichert sie, soweit möglich.
   * @param patch - zu ändernde Felder.
   * @returns neue Einstellungen.
   */
  update(patch: Partial<AppSettings>): AppSettings {
    this.current = sanitizeSettings({ ...this.current, ...patch });
    this.persist();
    return this.get();
  }

  /** Setzt alles auf Standardwerte zurück. */
  reset(): AppSettings {
    this.current = cloneSettings(DEFAULT_SETTINGS);
    this.persist();
    return this.get();
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.current));
      this.lastError = null;
    } catch (error: unknown) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    this.lastError = error;
    this.onError?.(error);
  }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Zugriff auf localStorage selbst kann werfen (gesperrte Website-Daten)
  }
}
