/**
 * Update-Hinweis in der Shell: erscheint nur, wenn eine neue Version wartet oder die Einrichtung scheiterte.
 * Die Aktivierung ist eine ausdrückliche Entscheidung und bei laufender Fader-Sitzung gesperrt.
 */
import type { UpdatePolicy, UpdateState } from '../../offline/update-policy';
import { h, setChildren } from './dom';

/** Prüfintervall in ms, solange ein Update wartet (erkennt das Ende einer Sitzung). */
export const UPDATE_RECHECK_MS = 1000;

/**
 * Bindet den Update-Hinweis an ein Container-Element.
 * @param host - Container (leer = nichts anzeigen).
 * @param policy - Update-Policy.
 * @param onError - zeigt einen Einrichtungsfehler an (z. B. über den Notifier).
 * @returns Funktion zum Entfernen (Beobachter und Timer).
 */
export function mountUpdateBanner(host: HTMLElement, policy: UpdatePolicy, onError: (error: NonNullable<UpdateState['error']>) => void): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let reportedError: unknown = null;

  const render = (s: UpdateState): void => {
    if (s.phase === 'error' && s.error && reportedError !== s.error) {
      reportedError = s.error;
      onError(s.error);
    }
    if (s.phase !== 'update-available' && s.phase !== 'applying') {
      setChildren(host);
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const button = h('button', { type: 'button', class: 'btn btn--primary', id: 'update-apply', disabled: !s.canApplyNow || s.phase === 'applying', onclick: () => void policy.apply() }, s.phase === 'applying' ? 'Wird aktualisiert …' : 'Jetzt aktualisieren');
    setChildren(
      host,
      h(
        'div',
        { class: 'update-banner', role: 'status' },
        h('span', { id: 'update-text' }, s.canApplyNow ? 'Eine neue Version von BarQPlayer ist verfügbar.' : s.phase === 'applying' ? 'Die neue Version wird aktiviert.' : 'Eine neue Version ist verfügbar. Sie wird erst nach Ende der laufenden Fader-Sitzung aktiviert.'),
        button
      )
    );
  };

  const unsubscribe = policy.subscribe((s) => {
    render(s);
    if (s.phase === 'update-available' && timer === null) timer = setInterval(() => policy.refresh(), UPDATE_RECHECK_MS);
    if (s.phase !== 'update-available' && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });
  render(policy.state);
  return () => {
    unsubscribe();
    if (timer !== null) clearInterval(timer);
  };
}
