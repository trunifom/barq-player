/**
 * Routen und Hash-Router. Jede Route mountet einen Screen und erhält eine Aufräumfunktion zurück
 * (Kamera stoppen, Timer löschen). Ein Guard kann das Verlassen verhindern (laufende Fader-Sitzung).
 */

/** Namen der Screens. */
export type RouteName = 'scanner' | 'collections' | 'generator' | 'player' | 'settings';

/** Eine Route samt Parametern (`#/player?collection=ID`). */
export interface Route {
  name: RouteName;
  params: Readonly<Record<string, string>>;
}

/** Eintrag der Navigation. */
export interface RouteInfo {
  name: RouteName;
  label: string;
}

/** Reihenfolge der Navigationsleiste (daumenfreundlich unten). */
export const ROUTES: readonly RouteInfo[] = Object.freeze([
  { name: 'scanner', label: 'Erfassen' },
  { name: 'collections', label: 'Sammlungen' },
  { name: 'generator', label: 'Generator' },
  { name: 'player', label: 'Fader' },
  { name: 'settings', label: 'Einstellungen' }
] as RouteInfo[]);

const NAMES = new Set<string>(ROUTES.map((r) => r.name));

/** Standardroute beim Start oder bei unbekannter Adresse. */
export const DEFAULT_ROUTE: Route = Object.freeze({ name: 'scanner', params: Object.freeze({}) });

/**
 * Liest eine Route aus einem URL-Hash (`#/player?collection=x`).
 * @param hash - `location.hash`.
 * @returns Route; unbekannte oder leere Adressen ergeben {@link DEFAULT_ROUTE}.
 */
export function parseRoute(hash: string): Route {
  const m = /^#\/?([a-z]+)(?:\?(.*))?$/.exec(hash);
  const name = m?.[1];
  if (!name || !NAMES.has(name)) return DEFAULT_ROUTE;
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(m[2] ?? '')) params[k] = v;
  return { name: name as RouteName, params };
}

/**
 * Erzeugt den URL-Hash zu einer Route.
 * @param route - Route.
 * @returns z. B. `#/player?collection=x`.
 */
export function formatRoute(route: Route): string {
  const q = new URLSearchParams(route.params as Record<string, string>).toString();
  return `#/${route.name}${q ? `?${q}` : ''}`;
}

/** Aufräumfunktion eines Screens. */
export type Dispose = () => void;

/** Minimale Fensterschnittstelle des Routers. */
export interface RouterWindow {
  location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

/** Router auf Basis von `location.hash`. */
export class Router {
  private dispose: Dispose | null = null;
  private currentHash = '';
  private started = false;
  private readonly listener = (): void => this.onHashChange();

  /**
   * @param win - Fenster (Hash und `hashchange`).
   * @param mount - mountet den Screen einer Route und liefert dessen Aufräumfunktion.
   * @param canLeave - Guard: `false` verhindert den Wechsel (der alte Hash wird wiederhergestellt).
   * @param onChange - wird nach jedem erfolgreichen Wechsel aufgerufen (z. B. Navigationsleiste aktualisieren).
   */
  constructor(
    private readonly win: RouterWindow,
    private readonly mount: (route: Route) => Dispose,
    private readonly canLeave: (from: Route, to: Route) => boolean = () => true,
    private readonly onChange: (route: Route) => void = () => undefined
  ) {}

  /** @returns die aktuelle Route. */
  get current(): Route {
    return parseRoute(this.currentHash);
  }

  /** Startet den Router und mountet die aktuelle Route. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.win.addEventListener('hashchange', this.listener);
    this.show(this.win.location.hash);
  }

  /** Beendet den Router und räumt den aktuellen Screen auf. */
  stop(): void {
    this.win.removeEventListener('hashchange', this.listener);
    this.started = false;
    this.teardown();
  }

  /**
   * Wechselt die Route (setzt den Hash; das Mounten erfolgt über `hashchange`).
   * @param route - Zielroute.
   */
  navigate(route: Route): void {
    const target = formatRoute(route);
    if (target === this.currentHash) {
      this.show(target); // gleicher Hash löst kein hashchange aus: Screen neu aufbauen
      return;
    }
    this.win.location.hash = target;
  }

  private onHashChange(): void {
    const next = this.win.location.hash;
    if (next === this.currentHash) return;
    if (this.currentHash !== '' && !this.canLeave(parseRoute(this.currentHash), parseRoute(next))) {
      this.win.location.hash = this.currentHash; // zurücksetzen; löst erneut hashchange aus, das ignoriert wird
      return;
    }
    this.show(next);
  }

  private show(hash: string): void {
    this.teardown();
    const route = parseRoute(hash);
    this.currentHash = hash === '' || hash === '#' ? formatRoute(route) : hash;
    if (this.win.location.hash !== this.currentHash) this.win.location.hash = this.currentHash;
    this.dispose = this.mount(route);
    this.onChange(route);
  }

  private teardown(): void {
    const d = this.dispose;
    this.dispose = null;
    d?.();
  }
}
