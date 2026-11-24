/**
 * Update-Policy: Neue App-Versionen werden NIE automatisch oder erzwungen aktiviert (Spezifikation 19.4:
 * „Neue Version nicht mitten in einer Sitzung aktivieren“).
 *
 * Der Service Worker wird mit `registerType: 'prompt'` betrieben: eine neue Version wartet, bis diese Policy die
 * Aktivierung ausdrücklich freigibt. Die Freigabe erfolgt nur auf Wunsch der Bedienperson UND nur, wenn keine
 * Fader-Sitzung läuft oder pausiert ist (der Seiten-Reload würde sie beenden).
 */
import { AppError } from '../domain/errors';

/** Phase der Offline-/Update-Situation. */
export type UpdatePhase = 'idle' | 'offline-ready' | 'update-available' | 'applying' | 'error';

/** Zustand für die Anzeige. */
export interface UpdateState {
  phase: UpdatePhase;
  /** `true`, wenn die neue Version jetzt aktiviert werden darf (Update bereit, keine Sitzung aktiv). */
  canApplyNow: boolean;
  /** Fehler der Einrichtung bzw. Aktivierung (nur bei `phase = 'error'`). */
  error: AppError | null;
}

/** Abhängigkeiten der Policy. */
export interface UpdatePolicyDeps {
  /** `true`, solange eine Fader-Sitzung läuft oder pausiert ist. */
  isSessionLive(): boolean;
}

/** Aktivierungsfunktion des Service Workers (lädt die Seite neu). */
export type UpdateApplier = () => Promise<void>;

/** Verwaltet den Update-Zustand und entscheidet über die Aktivierung. */
export class UpdatePolicy {
  private phase: UpdatePhase = 'idle';
  private error: AppError | null = null;
  private applier: UpdateApplier | null = null;
  private readonly listeners = new Set<(state: UpdateState) => void>();

  /** @param deps - Zugriff auf den Sitzungszustand. */
  constructor(private readonly deps: UpdatePolicyDeps) {}

  /** @returns aktueller Zustand. */
  get state(): UpdateState {
    return {
      phase: this.phase,
      canApplyNow: this.phase === 'update-available' && this.applier !== null && !this.deps.isSessionLive(),
      error: this.error
    };
  }

  /**
   * Registriert einen Beobachter.
   * @param listener - wird bei jeder Zustandsänderung und bei {@link refresh} aufgerufen.
   * @returns Funktion zum Abmelden.
   */
  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Setzt die Aktivierungsfunktion des Service Workers.
   * @param applier - Funktion, die die wartende Version aktiviert und neu lädt.
   */
  setApplier(applier: UpdateApplier): void {
    this.applier = applier;
    this.emit();
  }

  /** Alle Dateien liegen im Cache: die App läuft offline. */
  markOfflineReady(): void {
    if (this.phase === 'idle') this.phase = 'offline-ready';
    this.emit();
  }

  /** Eine neue Version wartet auf Aktivierung. */
  markUpdateAvailable(): void {
    this.phase = 'update-available';
    this.error = null;
    this.emit();
  }

  /**
   * Meldet einen Fehler bei Einrichtung oder Aktivierung.
   * @param error - Ursache (wird zu `ERR_OFFLINE_SETUP_FAILED` normalisiert).
   */
  markError(error: unknown): void {
    this.error = error instanceof AppError ? error : new AppError('ERR_OFFLINE_SETUP_FAILED', { details: error instanceof Error ? `${error.name}: ${error.message}` : String(error), cause: error });
    this.phase = 'error';
    this.emit();
  }

  /** Bewertet den Zustand neu (z. B. nachdem eine Sitzung endete) und informiert Beobachter. */
  refresh(): void {
    this.emit();
  }

  /**
   * Aktiviert die wartende Version – nur wenn erlaubt.
   * Läuft oder pausiert eine Sitzung, wird NICHT aktiviert (die Sitzung bliebe sonst unbemerkt auf der Strecke).
   * @returns `true`, wenn die Aktivierung gestartet wurde; `false`, wenn sie abgelehnt wurde.
   */
  async apply(): Promise<boolean> {
    const applier = this.applier;
    if (!this.state.canApplyNow || !applier) return false;
    this.phase = 'applying';
    this.emit();
    try {
      await applier();
      return true;
    } catch (error: unknown) {
      this.markError(error);
      return false;
    }
  }

  private emit(): void {
    const s = this.state;
    for (const l of [...this.listeners]) l(s);
  }
}
