/**
 * Installation als App: merkt sich das `beforeinstallprompt`-Ereignis von Chrome (Android), damit die Einstellungen
 * einen „App installieren“-Knopf anbieten können. Ohne Ereignis (z. B. bereits installiert, iOS, anderer Browser)
 * bleibt der Knopf aus und die Anleitung im Benutzerhandbuch gilt.
 */

/** Chrome-Ereignis zur Installation (nicht in den Standard-Typen enthalten). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Ereignisquelle (Fenster). */
export interface InstallTarget {
  addEventListener(type: 'beforeinstallprompt' | 'appinstalled', listener: (event: Event) => void): void;
}

/** Zustand der Installation. */
export type InstallState = 'unavailable' | 'available' | 'installed';

/** Verwaltet die Installationsaufforderung. */
export class InstallPrompt {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed: boolean;
  private readonly listeners = new Set<() => void>();

  /**
   * @param target - Fenster (oder Testersatz).
   * @param isStandalone - `true`, wenn die App bereits als installierte App läuft.
   */
  constructor(target: InstallTarget, isStandalone: () => boolean = () => false) {
    this.installed = isStandalone();
    target.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); // eigenen Knopf statt der automatischen Leiste verwenden
      this.deferred = event as BeforeInstallPromptEvent;
      this.emit();
    });
    target.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferred = null;
      this.emit();
    });
  }

  /** @returns aktueller Zustand. */
  get state(): InstallState {
    return this.installed ? 'installed' : this.deferred ? 'available' : 'unavailable';
  }

  /**
   * Zeigt den Installationsdialog des Browsers (nur aus einer Nutzeraktion heraus).
   * @returns Ergebnis; `unavailable`, wenn der Browser kein Ereignis geliefert hat.
   */
  async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const event = this.deferred;
    if (!event) return 'unavailable';
    this.deferred = null; // das Ereignis kann nur einmal verwendet werden
    this.emit();
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  }

  /**
   * Meldet Änderungen des Zustands.
   * @param listener - Rückruf.
   * @returns Funktion zum Abmelden.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
