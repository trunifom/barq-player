/**
 * Einstiegspunkt: startet die App und registriert (nur im Produktionsbuild) den Service Worker.
 * Alle Logik liegt in `app/bootstrap.ts`, damit sie ohne Browser-Einstieg testbar ist.
 */
import './ui/styles/main.css';
import { bootstrap } from './app/bootstrap';

const host = document.querySelector<HTMLDivElement>('#app');
if (host) {
  const app = bootstrap(host, { win: window, doc: document });
  // Service Worker nur im Produktionsbuild registrieren; das Modul nutzt ein virtuelles Plugin-Modul und wird deshalb dynamisch geladen.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    import('./offline/service-worker')
      .then((m) => m.registerServiceWorker(app.ctx.updates))
      .catch((error: unknown) => app.ctx.updates.markError(error));
  }
}
