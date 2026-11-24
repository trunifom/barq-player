/**
 * Sammlungen-Screen: Listen anlegen/umbenennen/löschen, Positionen sortieren, Mengen anpassen,
 * getrennte Status-Badges, Artikelstamm-Abgleich, CSV-/JSON-Export.
 *
 * Sortieren geschieht über Hoch-/Runter-Schaltflächen (statt Ziehen), damit es mit einer Hand und mit
 * Bedienhilfen zuverlässig funktioniert.
 */
import type { Dispose, Route } from '../../app/routes';
import type { AppContext } from '../../app/container';
import type { BarcodeItem, Collection } from '../../domain/types';
import { confirmDialog, promptDialog } from '../components/dialog';
import { statusBadges } from '../components/badges';
import { downloadText, formatDateTime, h, setChildren } from '../components/dom';
import { SYMBOLOGY_LABEL } from './scanner';

const validateName = (v: string): string | null => (v.trim() === '' ? 'Bitte einen Namen eingeben.' : v.trim().length > 100 ? 'Höchstens 100 Zeichen.' : null);

/** Dateiname-tauglicher Text. */
function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'sammlung';
}

/**
 * Mountet den Sammlungen-Screen.
 * @param root - Wurzelelement.
 * @param ctx - App-Kontext.
 * @param route - Route (optional Parameter `id` öffnet direkt eine Sammlung).
 * @returns Aufräumfunktion.
 */
export function mountCollections(root: HTMLElement, ctx: AppContext, route: Route): Dispose {
  let alive = true;
  let openId: string | null = route.params['id'] ?? null;
  const view = h('div', { class: 'collections' });
  setChildren(root, h('section', { class: 'screen', 'aria-labelledby': 'co-title' }, h('h1', { id: 'co-title' }, 'Sammlungen'), view));

  const fail = (source: string) => (error: unknown): void => {
    ctx.notify.error(error, { source });
  };

  // ------------------------------------------------------------------ Liste
  const showList = async (): Promise<void> => {
    openId = null;
    try {
      const cols = await ctx.collections.listCollections();
      const counts = await Promise.all(cols.map((c) => ctx.collections.countItems(c.id)));
      if (!alive) return;
      const rows = cols.map((c, i) =>
        h(
          'li',
          { class: 'card collection-row' },
          h('button', { type: 'button', class: 'link-btn', 'data-open': c.id, onclick: () => void showDetail(c.id) }, h('strong', null, c.name)),
          h('span', { class: 'hint' }, `${counts[i] ?? 0} Position(en) · geändert ${formatDateTime(c.updatedAt)}`),
          h(
            'div',
            { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn', 'data-rename': c.id, onclick: () => void rename(c) }, 'Umbenennen'),
            h('button', { type: 'button', class: 'btn', 'data-play': c.id, onclick: () => ctx.navigate({ name: 'player', params: { collection: c.id } }) }, 'Abspielen'),
            h('button', { type: 'button', class: 'btn btn--danger', 'data-delete': c.id, onclick: () => void remove(c) }, 'Löschen')
          )
        )
      );
      setChildren(
        view,
        h('button', { type: 'button', class: 'btn btn--primary', id: 'co-new', onclick: () => void create() }, 'Neue Sammlung'),
        cols.length === 0 ? h('p', { class: 'hint', id: 'co-empty' }, 'Noch keine Sammlung vorhanden.') : h('ul', { class: 'plain-list', id: 'co-list' }, ...rows)
      );
    } catch (error: unknown) {
      fail('collections-list')(error);
    }
  };

  const create = async (): Promise<void> => {
    const name = await promptDialog({ title: 'Neue Sammlung', label: 'Name', confirmLabel: 'Anlegen', validate: validateName });
    if (name === null) return;
    try {
      await ctx.collections.createCollection(name);
      ctx.notify.success('Sammlung angelegt.');
      await showList();
    } catch (error: unknown) {
      fail('collections-create')(error);
    }
  };

  const rename = async (c: Collection): Promise<void> => {
    const name = await promptDialog({ title: 'Sammlung umbenennen', label: 'Neuer Name', initial: c.name, confirmLabel: 'Umbenennen', validate: validateName });
    if (name === null) return;
    try {
      await ctx.collections.renameCollection(c.id, name);
      if (openId === c.id) await showDetail(c.id);
      else await showList();
    } catch (error: unknown) {
      fail('collections-rename')(error);
    }
  };

  const remove = async (c: Collection): Promise<void> => {
    const ok = await confirmDialog({ title: 'Sammlung löschen?', message: `„${c.name}“ und alle enthaltenen Positionen werden gelöscht. Das kann nicht rückgängig gemacht werden (erstellen Sie vorher ein Backup).`, confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    try {
      await ctx.collections.deleteCollection(c.id);
      ctx.notify.success('Sammlung gelöscht.');
      await showList();
    } catch (error: unknown) {
      fail('collections-delete')(error);
    }
  };

  // ------------------------------------------------------------------ Detail
  const showDetail = async (id: string): Promise<void> => {
    openId = id;
    try {
      const col = (await ctx.collections.listCollections()).find((c) => c.id === id);
      if (!col) {
        ctx.notify.info('Die Sammlung existiert nicht mehr.');
        await showList();
        return;
      }
      const items = await ctx.collections.listItems(id);
      if (!alive) return;
      const reload = (): Promise<void> => showDetail(id);
      const act = (job: () => Promise<unknown>, source: string): void => {
        void job().then(reload).catch(fail(source));
      };
      const total = items.reduce((n, i) => n + i.quantity, 0);

      const rowFor = (item: BarcodeItem, index: number): HTMLElement =>
        h(
          'tr',
          { 'data-item': item.id },
          h('td', { class: 'num' }, item.position + 1),
          h('td', null, SYMBOLOGY_LABEL[item.symbology]),
          h('td', null, h('code', { class: 'value', title: item.value }, item.value.length > 60 ? `${item.value.slice(0, 60)}…` : item.value), item.label ? h('div', { class: 'hint' }, item.label) : null),
          h(
            'td',
            { class: 'qty' },
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Menge verringern', 'data-qty-down': item.id, disabled: item.quantity <= 1, onclick: () => act(() => ctx.collections.changeQuantity(item.id, -1), 'collections-qty') }, '−'),
            h('output', { 'aria-label': 'Menge', class: 'qty__value' }, item.quantity),
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Menge erhöhen', 'data-qty-up': item.id, onclick: () => act(() => ctx.collections.changeQuantity(item.id, +1), 'collections-qty') }, '+')
          ),
          h('td', null, statusBadges(item)),
          h(
            'td',
            { class: 'actions' },
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Nach oben', 'data-up': item.id, disabled: index === 0, onclick: () => act(() => ctx.collections.moveItem(item.id, index - 1), 'collections-move') }, '↑'),
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Nach unten', 'data-down': item.id, disabled: index === items.length - 1, onclick: () => act(() => ctx.collections.moveItem(item.id, index + 1), 'collections-move') }, '↓'),
            h('button', { type: 'button', class: 'btn btn--icon btn--danger', 'aria-label': 'Position entfernen', 'data-remove': item.id, onclick: () => act(() => ctx.collections.removeItem(item.id), 'collections-remove') }, '✕')
          )
        );

      setChildren(
        view,
        h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn', id: 'co-back', onclick: () => void showList() }, '← Alle Sammlungen'), h('h2', { id: 'co-name' }, col.name), h('button', { type: 'button', class: 'btn', onclick: () => void rename(col) }, 'Umbenennen')),
        h('p', { class: 'hint', id: 'co-summary' }, `${items.length} Position(en), ${total} Stück insgesamt.`),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', id: 'co-play', disabled: items.length === 0, onclick: () => ctx.navigate({ name: 'player', params: { collection: id } }) }, 'Abspielen'),
          h('button', { type: 'button', class: 'btn', id: 'co-catalog', onclick: () => void checkCatalog(id) }, 'Mit Artikelstamm abgleichen'),
          h('button', { type: 'button', class: 'btn', id: 'co-csv', onclick: () => void exportCsv(id, col.name) }, 'CSV exportieren'),
          h('button', { type: 'button', class: 'btn', id: 'co-json', onclick: () => void exportJson() }, 'Backup (JSON)')
        ),
        items.length === 0
          ? h('p', { class: 'hint', id: 'co-items-empty' }, 'Diese Sammlung ist leer. Erfassen Sie Codes unter „Erfassen“ oder erzeugen Sie eine Zahlenreihe im Generator.')
          : h(
              'div',
              { class: 'table-wrap' },
              h(
                'table',
                { class: 'table', id: 'co-table' },
                h('caption', { class: 'sr-only' }, `Positionen der Sammlung ${col.name}`),
                h('thead', null, h('tr', null, ...['Nr.', 'Format', 'Wert', 'Menge', 'Status', 'Aktionen'].map((t) => h('th', { scope: 'col' }, t)))),
                h('tbody', null, ...items.map(rowFor))
              )
            )
      );
    } catch (error: unknown) {
      fail('collections-detail')(error);
    }
  };

  const checkCatalog = async (id: string): Promise<void> => {
    try {
      const r = await ctx.collections.checkAgainstCatalog(id);
      if (r.catalogEmpty) ctx.notify.info('Es ist noch kein Artikelstamm importiert (Einstellungen → Artikelstamm).');
      else ctx.notify.success(`Abgleich: ${r.known} bekannt, ${r.inactive} inaktiv, ${r.unknown} unbekannt (Stand des importierten Artikelstamms).`);
      await showDetail(id);
    } catch (error: unknown) {
      fail('collections-catalog')(error);
    }
  };

  const exportCsv = async (id: string, name: string): Promise<void> => {
    try {
      downloadText(`${safeFileName(name)}.csv`, await ctx.backup.exportCollectionCsv(id), 'text/csv;charset=utf-8');
    } catch (error: unknown) {
      fail('collections-csv')(error);
    }
  };

  const exportJson = async (): Promise<void> => {
    try {
      downloadText(`barqplayer-backup-${ctx.nowIso().slice(0, 10)}.json`, await ctx.backup.exportJson(), 'application/json');
    } catch (error: unknown) {
      fail('collections-json')(error);
    }
  };

  void (openId ? showDetail(openId) : showList());
  return () => {
    alive = false;
  };
}
