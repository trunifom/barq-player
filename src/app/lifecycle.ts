/**
 * Globale Absicherung und Seiten-Lebenszyklus.
 *
 * - Unbehandelte Fehler (`error`, `unhandledrejection`): ZUERST wird eine laufende Fader-Sitzung in `ERROR` versetzt
 *   (Symbol sofort aus, Unsicherheitsbereich sichtbar), DANN wird der Fehler protokolliert und angezeigt.
 * - Sichtbarkeitswechsel (Tab-Wechsel, Bildschirm aus, App im Hintergrund): laufende Sitzung pausiert sofort
 *   (Symbol aus, verhindert Doppelscans); bei Rückkehr wird der Wake Lock erneut angefordert.
 */
import type { PauseSource } from '../domain/playback-machine';

/** Minimaler Ereignisempfänger. */
export interface Listenable {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** Abhängigkeiten der Lebenszyklus-Verdrahtung. */
export interface LifecycleDeps {
  win: Listenable;
  doc: Listenable & { readonly visibilityState: string };
  /** Setzt eine aktive Sitzung bei einem Laufzeitfehler in ERROR (Symbol aus). */
  failActive(error: unknown): boolean;
  /** Pausiert eine aktive Sitzung sofort. */
  pauseActive(source: PauseSource, detail?: string): boolean;
  /** Meldet einen Fehler (Log + Anzeige). */
  report(error: unknown, context?: Record<string, string | number | boolean | null>): void;
  /** Wake Lock nach Rückkehr erneut anfordern. */
  reacquireWakeLock(): Promise<boolean>;
}

/** Browser-interne, harmlose Meldung, die nicht als Anwendungsfehler gelten soll. */
const BENIGN = /ResizeObserver loop/i;

/**
 * Installiert globale Fehler- und Sichtbarkeitshandler.
 * @param deps - Abhängigkeiten.
 * @returns Funktion zum Entfernen aller Handler.
 */
export function installLifecycle(deps: LifecycleDeps): () => void {
  const fatal = (error: unknown, kind: string): void => {
    // Reihenfolge ist sicherheitsrelevant: erst ausblenden, dann melden.
    deps.failActive(error);
    deps.report(error, { source: kind });
  };

  const onError = (raw: Event): void => {
    const event = raw as Partial<ErrorEvent>;
    if (event.error === undefined && typeof event.message === 'string' && BENIGN.test(event.message)) return;
    fatal(event.error ?? new Error(event.message ?? 'Unbekannter Fehler'), 'window.error');
  };
  const onRejection = (raw: Event): void => {
    const event = raw as Partial<PromiseRejectionEvent>;
    fatal(event.reason ?? new Error('Unbehandelte Promise-Ablehnung'), 'unhandledrejection');
  };
  const onVisibility = (): void => {
    if (deps.doc.visibilityState === 'hidden') deps.pauseActive('background', 'Seite in den Hintergrund gewechselt');
    else {
      deps.reacquireWakeLock().catch((e: unknown) => {
        deps.report(e, { source: 'wakelock' });
      });
    }
  };
  const onHide = (): void => {
    deps.pauseActive('background', 'Seite wird ausgeblendet');
  };

  deps.win.addEventListener('error', onError);
  deps.win.addEventListener('unhandledrejection', onRejection);
  deps.win.addEventListener('pagehide', onHide);
  deps.doc.addEventListener('visibilitychange', onVisibility);
  deps.doc.addEventListener('freeze', onHide);
  return () => {
    deps.win.removeEventListener('error', onError);
    deps.win.removeEventListener('unhandledrejection', onRejection);
    deps.win.removeEventListener('pagehide', onHide);
    deps.doc.removeEventListener('visibilitychange', onVisibility);
    deps.doc.removeEventListener('freeze', onHide);
  };
}
