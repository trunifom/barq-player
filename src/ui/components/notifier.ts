/**
 * Globales, zugängliches Hinweis- und Fehlerbanner (Toast-System).
 *
 * - Fehler gehen IMMER durch den {@link ErrorLogger} (Diagnose-Log ohne sensible Daten) und werden verständlich
 *   angezeigt: deutsche Meldung + Handlungsempfehlung + Fehlercode. Fehler bleiben stehen, bis sie geschlossen werden.
 * - Infos/Erfolge verschwinden nach einigen Sekunden.
 * - Barrierefrei: Container `aria-live`, Fehler mit `role="alert"`.
 */
import { AppError, type ErrorLogger, type LogContext } from '../../domain/errors';
import { h, setChildren } from './dom';

/** Art einer Meldung. */
export type NoticeKind = 'info' | 'success' | 'error';

/** Eine angezeigte Meldung. */
export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
  hint?: string;
  code?: string;
}

/** Zeitgeber für das automatische Ausblenden (injizierbar). */
export interface NoticeTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Anzahl gleichzeitig angezeigter Meldungen. */
export const MAX_VISIBLE_NOTICES = 4;
/** Anzeigedauer von Infos/Erfolgen in ms. */
export const AUTO_DISMISS_MS = 4000;

/** Hinweis- und Fehlerverwaltung. */
export class Notifier {
  private readonly list: Notice[] = [];
  private readonly handles = new Map<number, unknown>();
  private container: HTMLElement | null = null;
  private seq = 0;

  /**
   * @param logger - Diagnose-Log für Fehler.
   * @param timers - Zeitgeber (Standard: Browser).
   */
  constructor(
    private readonly logger: ErrorLogger,
    private readonly timers: NoticeTimers = { setTimeout: (cb, ms) => setTimeout(cb, ms), clearTimeout: (h2) => clearTimeout(h2 as ReturnType<typeof setTimeout>) }
  ) {}

  /** @returns aktuell sichtbare Meldungen (Kopie). */
  get items(): readonly Notice[] {
    return [...this.list];
  }

  /**
   * Bindet den Container, in dem die Meldungen erscheinen.
   * @param el - Container-Element.
   */
  mount(el: HTMLElement): void {
    this.container = el;
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'false');
    this.render();
  }

  /**
   * Meldet einen Fehler: protokollieren, anzeigen, normalisierten {@link AppError} zurückgeben.
   * @param error - beliebiger gefangener Wert.
   * @param context - nicht sensibler Zusatzkontext fürs Log.
   * @returns der normalisierte Fehler.
   */
  error(error: unknown, context: LogContext = {}): AppError {
    const appError = this.logger.logError(error, context);
    // Gleicher Fehler bereits sichtbar → nicht stapeln
    const dup = this.list.find((n) => n.kind === 'error' && n.code === appError.code && n.message === appError.userMessage);
    if (!dup) this.push({ kind: 'error', message: appError.userMessage, hint: appError.recoveryHint, code: appError.code });
    return appError;
  }

  /** @param message - kurze Information (verschwindet automatisch). */
  info(message: string): void {
    this.push({ kind: 'info', message });
  }

  /** @param message - Erfolgsmeldung (verschwindet automatisch). Nur nach tatsächlich abgeschlossenem Vorgang verwenden. */
  success(message: string): void {
    this.push({ kind: 'success', message });
  }

  /**
   * Schließt eine Meldung.
   * @param id - ID der Meldung.
   */
  dismiss(id: number): void {
    const i = this.list.findIndex((n) => n.id === id);
    if (i < 0) return;
    this.list.splice(i, 1);
    const handle = this.handles.get(id);
    if (handle !== undefined) this.timers.clearTimeout(handle);
    this.handles.delete(id);
    this.render();
  }

  /** Schließt alle Meldungen. */
  clear(): void {
    for (const n of [...this.list]) this.dismiss(n.id);
  }

  private push(n: Omit<Notice, 'id'>): void {
    const notice: Notice = { ...n, id: ++this.seq };
    this.list.push(notice);
    // Begrenzen: älteste Infos zuerst verdrängen, Fehler bleiben
    while (this.list.length > MAX_VISIBLE_NOTICES) {
      const victim = this.list.find((x) => x.kind !== 'error') ?? this.list[0];
      if (!victim) break;
      this.dismissSilently(victim.id);
    }
    if (notice.kind !== 'error') {
      this.handles.set(notice.id, this.timers.setTimeout(() => this.dismiss(notice.id), AUTO_DISMISS_MS));
    }
    this.render();
  }

  private dismissSilently(id: number): void {
    const i = this.list.findIndex((n) => n.id === id);
    if (i >= 0) this.list.splice(i, 1);
    const handle = this.handles.get(id);
    if (handle !== undefined) this.timers.clearTimeout(handle);
    this.handles.delete(id);
  }

  private render(): void {
    if (!this.container) return;
    setChildren(
      this.container,
      ...this.list.map((n) =>
        h(
          'div',
          { class: `notice notice--${n.kind}`, role: n.kind === 'error' ? 'alert' : 'status', 'data-notice-id': n.id },
          h('div', { class: 'notice__body' }, h('strong', { class: 'notice__message' }, n.message), n.hint ? h('span', { class: 'notice__hint' }, n.hint) : null, n.code ? h('code', { class: 'notice__code' }, n.code) : null),
          h('button', { type: 'button', class: 'notice__close', 'aria-label': 'Meldung schließen', onclick: () => this.dismiss(n.id) }, '×')
        )
      )
    );
  }
}
