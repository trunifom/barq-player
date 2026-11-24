/**
 * Zentrales, typisiertes Fehlerkonzept (reine Fachschicht, keine Browser-APIs).
 *
 * Jeder Fehler trägt einen eindeutigen {@link ErrorCode}, eine technische
 * Beschreibung (`details`/`cause`), eine deutsche Benutzermeldung und eine
 * konkrete Handlungsempfehlung. Fehler werden nie still verschluckt: Aufrufer
 * behandeln sie typisiert und protokollieren sie über den {@link ErrorLogger}.
 */

/** Alle bekannten Fehlercodes der Anwendung (Katalog siehe `docs/SOFTWARE_DOKUMENTATION.md`). */
export type ErrorCode =
  | 'ERR_SYNTAX_INVALID'
  | 'ERR_CHECKSUM_INVALID'
  | 'ERR_SEQUENCE_CONFIG_INVALID'
  | 'ERR_SEQUENCE_OVERFLOW'
  | 'ERR_SEQUENCE_LIMIT_EXCEEDED'
  | 'ERR_BULK_INPUT_INVALID'
  | 'ERR_CAMERA_PERMISSION_DENIED'
  | 'ERR_CAMERA_NOT_FOUND'
  | 'ERR_CAMERA_INSECURE_CONTEXT'
  | 'ERR_CAMERA_UNSUPPORTED'
  | 'ERR_WASM_LOAD_FAILED'
  | 'ERR_DECODE_FAILED'
  | 'ERR_STORAGE_WRITE_FAILED'
  | 'ERR_STORAGE_QUOTA_EXCEEDED'
  | 'ERR_IMPORT_SCHEMA_INVALID'
  | 'ERR_IMPORT_CSV_INVALID'
  | 'ERR_NOT_FOUND'
  | 'ERR_RENDER_FAILED'
  | 'ERR_PLAYBACK_FAILED'
  | 'ERR_UNKNOWN';

/** Standardtexte je Fehlercode. */
interface ErrorCatalogEntry {
  readonly userMessage: string;
  readonly recoveryHint: string;
}

/** Fehlerkatalog: deutsche Standardmeldung und Handlungsempfehlung je Code. */
export const ERROR_CATALOG: Readonly<Record<ErrorCode, ErrorCatalogEntry>> = {
  ERR_SYNTAX_INVALID: {
    userMessage: 'Der Code hat ein ungültiges Format (Länge oder Zeichen).',
    recoveryHint: 'Eingabe prüfen. Der Code wird nie automatisch korrigiert.'
  },
  ERR_CHECKSUM_INVALID: {
    userMessage: 'Die Prüfziffer des Codes ist nicht korrekt.',
    recoveryHint: 'Ziffern kontrollieren oder den Code erneut scannen. Eine Korrektur muss ausdrücklich bestätigt werden.'
  },
  ERR_SEQUENCE_CONFIG_INVALID: {
    userMessage: 'Die Zahlenreihen-Vorlage ist ungültig.',
    recoveryHint: 'Fester Teil, Feldbreite, Start, Ende und Schritt prüfen.'
  },
  ERR_SEQUENCE_OVERFLOW: {
    userMessage: 'Die Zahlenreihe passt nicht in das variable Feld (Überlauf).',
    recoveryHint: 'Feldbreite vergrößern, Endwert senken oder Schrittweite verringern. Es wird nie abgeschnitten.'
  },
  ERR_SEQUENCE_LIMIT_EXCEEDED: {
    userMessage: 'Die Zahlenreihe enthält zu viele Positionen.',
    recoveryHint: 'Bereich verkleinern oder Schrittweite erhöhen.'
  },
  ERR_BULK_INPUT_INVALID: {
    userMessage: 'Die Eingabeliste ist ungültig oder zu groß.',
    recoveryHint: 'Liste in kleinere Teile aufteilen und Fehlermeldungen pro Zeile beachten.'
  },
  ERR_CAMERA_PERMISSION_DENIED: {
    userMessage: 'Der Kamerazugriff wurde verweigert.',
    recoveryHint: 'Kameraberechtigung in den Browser-/Android-Einstellungen erlauben oder Foto-Import nutzen.'
  },
  ERR_CAMERA_NOT_FOUND: {
    userMessage: 'Es wurde keine passende Kamera gefunden.',
    recoveryHint: 'Gerät prüfen oder Codes über Foto-Import bzw. manuelle Eingabe erfassen.'
  },
  ERR_CAMERA_INSECURE_CONTEXT: {
    userMessage: 'Die Kamera ist nur über HTTPS oder localhost verfügbar.',
    recoveryHint: 'App über eine HTTPS-Adresse öffnen bzw. als PWA installieren.'
  },
  ERR_CAMERA_UNSUPPORTED: {
    userMessage: 'Diese Funktion wird von der Kamera dieses Geräts nicht unterstützt.',
    recoveryHint: 'Ohne die Funktion weiterarbeiten (z. B. ohne Taschenlampe).'
  },
  ERR_WASM_LOAD_FAILED: {
    userMessage: 'Die lokale Decoder-Datei (WASM) konnte nicht geladen werden.',
    recoveryHint: 'App einmal online neu laden, damit alle Offline-Dateien vorhanden sind.'
  },
  ERR_DECODE_FAILED: {
    userMessage: 'Das Bild konnte nicht gelesen werden.',
    recoveryHint: 'Schärferes, besser beleuchtetes Bild verwenden.'
  },
  ERR_STORAGE_WRITE_FAILED: {
    userMessage: 'Die Daten konnten nicht gespeichert werden.',
    recoveryHint: 'Speicherplatz prüfen und ein JSON-Backup erstellen. Eintrag ist NICHT gespeichert.'
  },
  ERR_STORAGE_QUOTA_EXCEEDED: {
    userMessage: 'Der Browser-Speicher ist voll.',
    recoveryHint: 'Alte Sammlungen exportieren und löschen.'
  },
  ERR_IMPORT_SCHEMA_INVALID: {
    userMessage: 'Die Importdatei hat ein ungültiges Format.',
    recoveryHint: 'Datei prüfen. Vorhandene Daten wurden nicht verändert.'
  },
  ERR_IMPORT_CSV_INVALID: {
    userMessage: 'Die CSV-Datei enthält fehlerhafte Zeilen.',
    recoveryHint: 'Fehlerbericht pro Zeile beachten und Datei korrigieren.'
  },
  ERR_NOT_FOUND: {
    userMessage: 'Der gesuchte Eintrag existiert nicht (mehr).',
    recoveryHint: 'Liste neu laden und die Aktion wiederholen.'
  },
  ERR_RENDER_FAILED: {
    userMessage: 'Der Code konnte nicht dargestellt werden.',
    recoveryHint: 'Wert, Format und Fehlerkorrektur prüfen; bei langen Texten Fehlerkorrektur senken.'
  },
  ERR_PLAYBACK_FAILED: {
    userMessage: 'Bei der Wiedergabe ist ein Fehler aufgetreten. Das Symbol wurde ausgeblendet.',
    recoveryHint: 'Kasse und letzte Position abgleichen, bevor die Sitzung fortgesetzt wird.'
  },
  ERR_UNKNOWN: {
    userMessage: 'Ein unerwarteter Fehler ist aufgetreten.',
    recoveryHint: 'Aktion wiederholen; bei erneutem Auftreten das Diagnose-Log prüfen.'
  }
};

/** Optionale Angaben beim Erzeugen eines {@link AppError}. */
export interface AppErrorOptions {
  /** Technische Beschreibung (für Entwickler/Diagnose). */
  details?: string;
  /** Ursprungsfehler. */
  cause?: unknown;
  /** Überschreibt die Standard-Benutzermeldung (z. B. feldgenau). */
  userMessage?: string;
  /** Überschreibt die Standard-Handlungsempfehlung. */
  recoveryHint?: string;
}

/** Einheitliche Fehlerklasse der Anwendung. */
export class AppError extends Error {
  /** Eindeutiger Fehlercode. */
  readonly code: ErrorCode;
  /** Technische Beschreibung oder `undefined`. */
  readonly details: string | undefined;
  /** Benutzerfreundliche deutsche Meldung. */
  readonly userMessage: string;
  /** Konkrete Handlungsempfehlung. */
  readonly recoveryHint: string;

  /**
   * @param code - Fehlercode aus dem Katalog.
   * @param options - Details, Ursache und optionale Textüberschreibungen.
   */
  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const entry = ERROR_CATALOG[code];
    super(options.details ? `${code}: ${options.details}` : code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.userMessage = options.userMessage ?? entry.userMessage;
    this.recoveryHint = options.recoveryHint ?? entry.recoveryHint;
  }
}

/**
 * Type Guard für {@link AppError}.
 * @param value - beliebiger Wert (z. B. aus einem `catch`).
 * @returns `true`, wenn der Wert ein AppError ist.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Wandelt einen beliebigen gefangenen Wert in einen {@link AppError}.
 * Vorhandene AppErrors bleiben unverändert; alles andere wird mit Ursache umhüllt.
 * @param value - gefangener Wert (`unknown`).
 * @param fallback - Code für unbekannte Fehler (Standard `ERR_UNKNOWN`).
 * @returns ein AppError, nie `undefined`.
 */
export function toAppError(value: unknown, fallback: ErrorCode = 'ERR_UNKNOWN'): AppError {
  if (isAppError(value)) return value;
  const details = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return new AppError(fallback, { details, cause: value });
}

/** Schweregrad eines Diagnose-Eintrags. */
export type LogLevel = 'info' | 'warn' | 'error';

/** Erlaubte Kontextwerte im Diagnose-Log (nur Primitive). */
export type LogContext = Readonly<Record<string, string | number | boolean | null>>;

/** Ein Eintrag im Diagnose-Log. */
export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly code: ErrorCode | 'INFO';
  readonly message: string;
  readonly context: LogContext;
}

/** Kontextschluessel, deren Werte nie ins Diagnose-Log gelangen (Datenschutz). */
const SENSITIVE_KEY = /^(value|values|raw|content|text|payload|token|barcode|code128|qr)$/i;

/**
 * Entfernt sensible Werte aus einem Log-Kontext.
 * @param context - Rohkontext.
 * @returns Kontext, in dem sensible Schlüssel durch `[redacted]` ersetzt sind.
 */
export function sanitizeContext(context: LogContext): LogContext {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(context)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : val;
  }
  return out;
}

/** Listener für neue Log-Einträge (z. B. UI-Fehlerbanner). */
export type LogListener = (entry: LogEntry) => void;

/**
 * Interner Diagnose-Log als Ringpuffer ohne sensible Daten.
 * Ins Log gelangen Fehlercode, Standardmeldung und bereinigter Kontext, aber nie
 * Barcode-Werte oder `details` (die können Nutzdaten enthalten).
 */
export class ErrorLogger {
  private readonly buffer: LogEntry[] = [];
  private readonly listeners = new Set<LogListener>();

  /**
   * @param capacity - maximale Zahl gehaltener Einträge (älteste fallen heraus).
   * @param now - Zeitquelle; injizierbar für Tests.
   */
  constructor(
    private readonly capacity = 200,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new AppError('ERR_UNKNOWN', { details: 'ErrorLogger-Kapazität muss eine positive Ganzzahl sein' });
    }
  }

  /**
   * Protokolliert einen gefangenen Fehler.
   * @param error - beliebiger Fehlerwert (wird zu {@link AppError} normalisiert).
   * @param context - zusätzlicher, nicht sensibler Kontext.
   * @returns der normalisierte AppError (zur Anzeige in der UI).
   */
  logError(error: unknown, context: LogContext = {}): AppError {
    const appError = toAppError(error);
    this.push({
      timestamp: this.now(),
      level: 'error',
      code: appError.code,
      message: ERROR_CATALOG[appError.code].userMessage,
      context: sanitizeContext({
        ...context,
        causeName: appError.cause instanceof Error ? appError.cause.name : null
      })
    });
    return appError;
  }

  /**
   * Protokolliert eine Information oder Warnung.
   * @param level - `info` oder `warn`.
   * @param message - Text ohne sensible Daten.
   * @param context - nicht sensibler Kontext.
   */
  log(level: 'info' | 'warn', message: string, context: LogContext = {}): void {
    this.push({ timestamp: this.now(), level, code: 'INFO', message, context: sanitizeContext(context) });
  }

  /** @returns Kopie aller Einträge, älteste zuerst. */
  get entries(): readonly LogEntry[] {
    return [...this.buffer];
  }

  /**
   * Registriert einen Listener für neue Einträge.
   * @param listener - wird bei jedem neuen Eintrag aufgerufen.
   * @returns Funktion zum Abmelden.
   */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Leert den Log. */
  clear(): void {
    this.buffer.length = 0;
  }

  private push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (listenerError: unknown) {
        // Ein defekter Listener darf das Logging nicht blockieren; Fehler wird intern markiert.
        this.buffer.push({
          timestamp: entry.timestamp,
          level: 'warn',
          code: 'INFO',
          message: 'Log-Listener hat einen Fehler geworfen',
          context: { causeName: listenerError instanceof Error ? listenerError.name : null }
        });
        if (this.buffer.length > this.capacity) this.buffer.shift();
      }
    }
  }
}
