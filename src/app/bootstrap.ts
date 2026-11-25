/**
 * App-Start: baut die Shell (Kopfzeile, Hauptbereich, Navigation, Meldungsbereich), verdrahtet Router und Lebenszyklus.
 * Als eigene Funktion (statt in `main.ts`), damit sie in Tests mit jsdom und Überschreibungen laufen kann.
 */
import { requestPersistentStorage } from '../adapters/persistence/db';
import { AppError } from '../domain/errors';
import { localDateString } from '../domain/expiry';
import { h, setChildren } from '../ui/components/dom';
import { mountUpdateBanner } from '../ui/components/update-banner';
import { mountCollections } from '../ui/screens/collections';
import { mountGenerator } from '../ui/screens/generator';
import { mountPlayer } from '../ui/screens/player';
import { mountScanner } from '../ui/screens/scanner';
import { mountSettings } from '../ui/screens/settings';
import { createAppContext, type AppContext, type AppEnvironment } from './container';
import { installLifecycle } from './lifecycle';
import { ROUTES, Router, type Dispose, type Route, type RouteName } from './routes';

/** Ergebnis des App-Starts. */
export interface RunningApp {
  ctx: AppContext;
  router: Router;
  /** Fährt die App herunter (Handler entfernen, Screen aufräumen). */
  dispose(): void;
}

type ScreenMount = (root: HTMLElement, ctx: AppContext, route: Route) => Dispose;

const SCREENS: Readonly<Record<RouteName, ScreenMount>> = {
  scanner: mountScanner,
  collections: mountCollections,
  generator: mountGenerator,
  player: mountPlayer,
  settings: mountSettings
};

/**
 * Startet die App.
 * @param host - Wurzelelement (`#app`).
 * @param env - Fenster, Dokument und optionale Überschreibungen.
 * @returns laufende App.
 */
export function bootstrap(host: HTMLElement, env: AppEnvironment): RunningApp {
  const ctx = createAppContext(env);
  const main = h('main', { id: 'screen', class: 'app__main', tabindex: '-1' });
  const toasts = h('div', { id: 'toasts', class: 'toasts' });
  const updateHost = h('div', { id: 'update-host', hidden: true });
  const navButtons = new Map<RouteName, HTMLElement>();
  const nav = h(
    'nav',
    { class: 'app__nav', 'aria-label': 'Hauptnavigation' },
    ...ROUTES.map((r) => {
      const a = h('a', { href: `#/${r.name}`, class: 'app__nav-link', 'data-route': r.name }, r.label);
      navButtons.set(r.name, a);
      return a;
    })
  );
  setChildren(host, h('header', { class: 'app__header' }, h('span', { class: 'app__title' }, 'BarQPlayer')), updateHost, main, nav, toasts);
  ctx.notify.mount(toasts);

  const mountScreen = (route: Route): Dispose => {
    try {
      return SCREENS[route.name](main, ctx, route);
    } catch (error: unknown) {
      ctx.notify.error(error, { source: `mount-${route.name}` });
      setChildren(main, h('p', { class: 'field__error', role: 'alert' }, 'Dieser Bereich konnte nicht geladen werden.'));
      return () => undefined;
    }
  };

  const router = new Router(
    env.win,
    mountScreen,
    (from) => {
      // Eine laufende Fader-Sitzung darf nicht durch Navigation verlassen werden: sicher pausieren und bleiben.
      if (from.name === 'player' && ctx.playback.isLive) {
        ctx.playback.pauseActive('operator', 'Navigation');
        ctx.notify.info('Bitte die Fader-Sitzung zuerst abbrechen oder beenden.');
        return false;
      }
      return true;
    },
    (route) => {
      for (const [name, el] of navButtons) {
        if (name === route.name) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
      }
      main.focus({ preventScroll: true });
    }
  );

  const uninstall = installLifecycle({
    win: env.win,
    doc: env.doc,
    failActive: (e) => ctx.playback.failActive(e),
    pauseActive: (source, detail) => ctx.playback.pauseActive(source, detail),
    report: (e, c) => void ctx.notify.error(e, c),
    reacquireWakeLock: () => ctx.wakeLock.reacquireIfNeeded()
  });

  const unmountBanner = mountUpdateBanner(updateHost, ctx.updates, (error) => void ctx.notify.error(error, { source: 'offline-setup' }));
  let offlineAnnounced = false;
  const unsubscribeUpdates = ctx.updates.subscribe((s) => {
    // Erst melden, wenn der Service Worker den Precache tatsächlich abgeschlossen hat.
    if (s.phase === 'offline-ready' && !offlineAnnounced) {
      offlineAnnounced = true;
      ctx.notify.success('Die App ist jetzt offline nutzbar.');
    }
  });
  if (ctx.settings.get().liftToPause) void ctx.lift.enable();

  router.start();
  // Persistenten Speicher still anfragen; das Ergebnis zeigt „Einstellungen → Speicher“.
  void requestPersistentStorage(ctx.storageManager).then((s) => {
    if (s.error) ctx.logger.logError(s.error, { source: 'persist' });
  });

  // Gemeinsame Bibliothek beim Start still prüfen (nur Hinweis, nichts wird ohne Zustimmung übernommen).
  void ctx.library
    .check(localDateString(new Date(ctx.nowIso())))
    .then((check) => {
      const open = check.entries.filter((e) => e.status === 'new' || e.status === 'update' || e.status === 'update-modified').length;
      if (open > 0) ctx.notify.info(`Gemeinsame Bibliothek: ${open} neue oder aktualisierte Sammlung(en) – unter „Sammlungen“ übernehmen.`);
    })
    .catch((error: unknown) => {
      // Offline ist normal und bleibt still; andere Fehler gehören ins Diagnose-Log.
      if (!(error instanceof AppError && error.code === 'ERR_LIBRARY_UNAVAILABLE')) ctx.logger.logError(error, { source: 'library-startup' });
    });

  return {
    ctx,
    router,
    dispose: () => {
      uninstall();
      unmountBanner();
      unsubscribeUpdates();
      ctx.lift.disable();
      router.stop();
      ctx.camera.stop();
    }
  };
}
