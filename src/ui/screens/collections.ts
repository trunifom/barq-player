/**
 * Sammlungen-Screen: Listen anlegen/umbenennen/löschen, Positionen sortieren, Mengen anpassen, Zusatzangaben
 * (Wort, Nutzen, Satz, Tags, Ablaufdatum) bearbeiten, suchen und filtern, getrennte Status-Badges,
 * Artikelstamm-Abgleich sowie Teilen, Import und Export (Datei, Link, Text, CSV, Backup).
 *
 * Sortieren geschieht über Hoch-/Runter-Schaltflächen (statt Ziehen), damit es mit einer Hand und mit
 * Bedienhilfen zuverlässig funktioniert. Abgelaufene Codes werden deutlich als „ABGELAUFEN“ markiert.
 */
import { AppError } from '../../domain/errors';
import { expiryInfo, localDateString, partitionByExpiry } from '../../domain/expiry';
import { collectTags, matchesQuery } from '../../domain/item-meta';
import type { Dispose, Route } from '../../app/routes';
import type { AppContext } from '../../app/container';
import type { BarcodeItem, Collection } from '../../domain/types';
import { decodeSharePayload } from '../../adapters/share/link-codec';
import type { LibraryEntry } from '../../application/library-service';
import { confirmDialog, formDialog, promptDialog } from '../components/dialog';
import { statusBadges } from '../components/badges';
import { downloadText, formatDateTime, h, setChildren } from '../components/dom';
import { openImportDialog } from '../components/import-dialog';
import { editItemDetails } from '../components/item-editor';
import { copyCollectionText, downloadBackup, safeFileName, shareCollectionFile, shareCollectionLink } from '../components/share-actions';
import { SYMBOLOGY_LABEL } from './scanner';

const validateName = (v: string): string | null => (v.trim() === '' ? 'Bitte einen Namen eingeben.' : v.trim().length > 100 ? 'Höchstens 100 Zeichen.' : null);

/**
 * Dateiname für die Bibliothek: nur Buchstaben, Ziffern, Unterstrich und Bindestrich; „index“ ist reserviert.
 * @param name - Sammlungsname.
 * @returns Dateiname mit Endung `.json`.
 */
export function libraryFileName(name: string): string {
  const base = safeFileName(name);
  return `${base === 'index' ? 'index_sammlung' : base}.json`;
}

/** Nach so vielen Tagen ohne Sicherung erscheint eine Erinnerung. */
export const BACKUP_REMINDER_DAYS = 14;

/**
 * Mountet den Sammlungen-Screen.
 * @param root - Wurzelelement.
 * @param ctx - App-Kontext.
 * @param route - Route (Parameter `id` öffnet direkt eine Sammlung, `import` öffnet den Import-Dialog für einen geteilten Link).
 * @returns Aufräumfunktion.
 */
export function mountCollections(root: HTMLElement, ctx: AppContext, route: Route): Dispose {
  let alive = true;
  let openId: string | null = route.params['id'] ?? null;
  // Filter bleiben beim Neuladen der Detailansicht erhalten
  let query = '';
  let tagFilter = '';
  let onlyExpired = false;
  const view = h('div', { class: 'collections' });
  setChildren(root, h('section', { class: 'screen', 'aria-labelledby': 'co-title' }, h('h1', { id: 'co-title' }, 'Sammlungen'), view));

  const today = (): string => localDateString(new Date(ctx.nowIso()));

  const fail = (source: string) => (error: unknown): void => {
    ctx.notify.error(error, { source });
  };

  const backupReminder = (): HTMLElement | null => {
    const last = ctx.settings.get().lastBackupAt;
    const days = last === null ? Infinity : (new Date(ctx.nowIso()).getTime() - new Date(last).getTime()) / 86_400_000;
    if (days < BACKUP_REMINDER_DAYS) return null;
    return h(
      'div',
      { class: 'notice-inline', id: 'co-backup-reminder', role: 'status' },
      last === null ? 'Es gibt noch keine Sicherung. ' : `Die letzte Sicherung ist über ${BACKUP_REMINDER_DAYS} Tage alt. `,
      h('button', { type: 'button', class: 'btn', id: 'co-backup-now', onclick: () => void downloadBackup(ctx).then(() => showList()) }, 'Jetzt sichern')
    );
  };

  // ------------------------------------------------------------------ Gemeinsame Bibliothek
  const libraryBox = h('section', { class: 'card', id: 'co-library', 'aria-labelledby': 'co-lib-title' });
  const statusText: Record<LibraryEntry['status'], string> = {
    new: 'Neu',
    current: 'Aktuell',
    update: 'Neue Version verfügbar',
    'update-modified': 'Neue Version – lokal geändert (Aktualisieren überschreibt Ihre Änderungen)',
    modified: 'Lokal geändert'
  };
  const statusTone: Record<LibraryEntry['status'], string> = { new: 'warn', current: 'ok', update: 'warn', 'update-modified': 'warn', modified: 'neutral' };

  const applyEntries = async (entries: readonly LibraryEntry[]): Promise<void> => {
    try {
      for (const e of entries) {
        if (e.status === 'update-modified') {
          const ok = await confirmDialog({
            title: 'Lokale Änderungen überschreiben?',
            message: `Die Sammlung „${e.name}“ wurde auf diesem Gerät geändert. Beim Aktualisieren gehen diese Änderungen verloren und die veröffentlichte Version wird übernommen.`,
            confirmLabel: 'Überschreiben',
            danger: true
          });
          if (!ok) continue;
        }
        await ctx.library.apply(e);
      }
      ctx.notify.success('Bibliothek aktualisiert.');
    } catch (error: unknown) {
      fail('library-apply')(error);
    }
    if (alive) await showList();
  };

  const loadLibrary = async (): Promise<void> => {
    setChildren(libraryBox, h('h2', { id: 'co-lib-title' }, 'Gemeinsame Bibliothek'), h('p', { class: 'hint', role: 'status', id: 'co-lib-status' }, 'Bibliothek wird geprüft …'));
    try {
      const check = await ctx.library.check(today());
      if (!alive) return;
      const actionable = check.entries.filter((e) => e.status === 'new' || e.status === 'update');
      setChildren(
        libraryBox,
        h('h2', { id: 'co-lib-title' }, 'Gemeinsame Bibliothek'),
        check.entries.length === 0 && check.problems.length === 0
          ? h('p', { class: 'hint', id: 'co-lib-empty' }, 'Es ist noch keine gemeinsame Bibliothek veröffentlicht. Öffnen Sie eine Sammlung und wählen Sie „In Bibliothek veröffentlichen“, um Ihre Codes mit allen zu teilen, die diese App-Adresse nutzen.')
          : h('p', { class: 'hint' }, 'Diese Sammlungen werden zusammen mit der App veröffentlicht. Jeder, der die App-Adresse öffnet, kann sie übernehmen – ohne Codes neu zu erfassen.'),
        check.entries.length > 0
          ? h(
              'ul',
              { class: 'plain-list', id: 'co-lib-list' },
              ...check.entries.map((e) =>
                h(
                  'li',
                  { class: 'library-row', 'data-library': e.file },
                  h('strong', null, e.name),
                  h('span', { class: 'hint' }, ` ${e.itemCount} Code(s)${e.expiredCount > 0 ? `, davon ${e.expiredCount} abgelaufen` : ''} · `),
                  h('span', { class: `badge badge--${statusTone[e.status]}`, 'data-status': e.status }, statusText[e.status]),
                  e.status === 'new' || e.status === 'update' || e.status === 'update-modified'
                    ? h('button', { type: 'button', class: 'btn', 'data-library-apply': e.file, onclick: () => void applyEntries([e]) }, e.status === 'new' ? 'Übernehmen' : 'Aktualisieren')
                    : null
                )
              )
            )
          : null,
        actionable.length > 1 ? h('button', { type: 'button', class: 'btn btn--primary', id: 'co-lib-all', onclick: () => void applyEntries(actionable) }, `Alle ${actionable.length} übernehmen bzw. aktualisieren`) : null,
        check.problems.length > 0 ? h('ul', { class: 'errors', id: 'co-lib-problems' }, ...check.problems.map((pr) => h('li', null, `${pr.file}: ${pr.message}`))) : null,
        h('button', { type: 'button', class: 'btn', id: 'co-lib-refresh', onclick: () => void loadLibrary() }, 'Auf Updates prüfen')
      );
    } catch (error: unknown) {
      if (!alive) return;
      const message = error instanceof AppError ? error.userMessage : 'Die Bibliothek konnte nicht geprüft werden.';
      setChildren(
        libraryBox,
        h('h2', { id: 'co-lib-title' }, 'Gemeinsame Bibliothek'),
        h('p', { class: 'hint', id: 'co-lib-error' }, `${message} Bereits übernommene Sammlungen bleiben nutzbar.`),
        h('button', { type: 'button', class: 'btn', id: 'co-lib-refresh', onclick: () => void loadLibrary() }, 'Erneut prüfen')
      );
      // Offline ist ein erwarteter Zustand und wird nicht als Fehler protokolliert.
      if (!(error instanceof AppError && error.code === 'ERR_LIBRARY_UNAVAILABLE')) ctx.logger.logError(error, { source: 'library-check' });
    }
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
          c.library ? h('span', { class: 'badge badge--neutral', 'data-badge': 'library', title: `Aus der gemeinsamen Bibliothek: ${c.library.file}` }, 'Bibliothek') : null,
          h('span', { class: 'hint' }, `${counts[i] ?? 0} Position(en) · geändert ${formatDateTime(c.updatedAt)}`),
          h(
            'div',
            { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn', 'data-rename': c.id, onclick: () => void rename(c) }, 'Umbenennen'),
            h('button', { type: 'button', class: 'btn', 'data-play': c.id, onclick: () => ctx.navigate({ name: 'player', params: { collection: c.id } }) }, 'Abspielen'),
            h('button', { type: 'button', class: 'btn', 'data-share': c.id, onclick: () => void shareCollectionFile(ctx, c.id) }, 'Teilen'),
            h('button', { type: 'button', class: 'btn btn--danger', 'data-delete': c.id, onclick: () => void remove(c) }, 'Löschen')
          )
        )
      );
      setChildren(
        view,
        cols.length > 0 ? backupReminder() : null,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', id: 'co-new', onclick: () => void create() }, 'Neue Sammlung'),
          h('button', { type: 'button', class: 'btn', id: 'co-import', onclick: () => void runImport() }, 'Importieren')
        ),
        cols.length === 0 ? h('p', { class: 'hint', id: 'co-empty' }, 'Noch keine Sammlung vorhanden.') : h('ul', { class: 'plain-list', id: 'co-list' }, ...rows),
        libraryBox
      );
      void loadLibrary();
    } catch (error: unknown) {
      fail('collections-list')(error);
    }
  };

  const runImport = async (initial?: { text: string; name: string }): Promise<void> => {
    const imported = await openImportDialog(ctx, initial);
    if (!alive || !imported) return;
    if (openId) await showDetail(openId);
    else await showList();
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
      const now = today();
      const split = partitionByExpiry(items, now);
      const soon = items.filter((i) => expiryInfo(i.expiresAt, now).state === 'soon').length;
      const tags = collectTags(items);
      if (tagFilter !== '' && !tags.includes(tagFilter)) tagFilter = '';
      const visible = items.filter((i) => matchesQuery(i, query) && (tagFilter === '' || (i.tags ?? []).includes(tagFilter)) && (!onlyExpired || expiryInfo(i.expiresAt, now).state === 'expired'));

      const editDetails = (item: BarcodeItem): void => {
        void editItemDetails(ctx, item)
          .then((saved) => (saved ? reload() : undefined))
          .catch(fail('collections-details'));
      };

      const rowFor = (item: BarcodeItem): HTMLElement => {
        const index = items.indexOf(item);
        const expired = expiryInfo(item.expiresAt, now).state === 'expired';
        return h(
          'tr',
          { 'data-item': item.id, class: expired ? 'row--expired' : null },
          h('td', { class: 'num' }, item.position + 1),
          h('td', null, SYMBOLOGY_LABEL[item.symbology]),
          h(
            'td',
            null,
            h('code', { class: 'value', title: item.value }, item.value.length > 60 ? `${item.value.slice(0, 60)}…` : item.value),
            item.label ? h('div', { class: 'item-label' }, item.label) : null,
            item.purpose ? h('div', { class: 'hint item-purpose' }, `Nutzen: ${item.purpose}`) : null,
            item.note ? h('div', { class: 'hint item-note' }, item.note) : null,
            item.tags && item.tags.length > 0 ? h('div', { class: 'tags' }, ...item.tags.map((t) => h('button', { type: 'button', class: 'tag', 'data-tag': t, title: 'Nach diesem Tag filtern', onclick: () => setTagFilter(t) }, `#${t}`))) : null
          ),
          h(
            'td',
            { class: 'qty' },
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Menge verringern', 'data-qty-down': item.id, disabled: item.quantity <= 1, onclick: () => act(() => ctx.collections.changeQuantity(item.id, -1), 'collections-qty') }, '−'),
            h('output', { 'aria-label': 'Menge', class: 'qty__value' }, item.quantity),
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Menge erhöhen', 'data-qty-up': item.id, onclick: () => act(() => ctx.collections.changeQuantity(item.id, +1), 'collections-qty') }, '+')
          ),
          h('td', null, statusBadges(item, now)),
          h(
            'td',
            { class: 'actions' },
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Details bearbeiten', title: 'Wort, Nutzen, Satz, Tags, Ablaufdatum', 'data-edit': item.id, onclick: () => editDetails(item) }, '✎'),
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Nach oben', 'data-up': item.id, disabled: index === 0, onclick: () => act(() => ctx.collections.moveItem(item.id, index - 1), 'collections-move') }, '↑'),
            h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Nach unten', 'data-down': item.id, disabled: index === items.length - 1, onclick: () => act(() => ctx.collections.moveItem(item.id, index + 1), 'collections-move') }, '↓'),
            h('button', { type: 'button', class: 'btn btn--icon btn--danger', 'aria-label': 'Position entfernen', 'data-remove': item.id, onclick: () => act(() => ctx.collections.removeItem(item.id), 'collections-remove') }, '✕')
          )
        );
      };

      const setTagFilter = (t: string): void => {
        tagFilter = tagFilter === t ? '' : t;
        void showDetail(id);
      };

      const searchBox = h('input', { type: 'search', id: 'co-search', class: 'input', value: query, placeholder: 'Suchen (Code, Wort, Nutzen, Satz, Tag)', 'aria-label': 'Suchen' });
      searchBox.addEventListener('input', () => {
        query = searchBox.value;
        void showDetail(id).then(() => {
          const box = document.querySelector<HTMLInputElement>('#co-search');
          box?.focus();
          box?.setSelectionRange(box.value.length, box.value.length);
        });
      });
      const tagSelect = h('select', { id: 'co-tag', class: 'input', 'aria-label': 'Nach Tag filtern' }, h('option', { value: '' }, 'Alle Tags'), ...tags.map((t) => h('option', { value: t, selected: t === tagFilter }, `#${t}`)));
      tagSelect.addEventListener('change', () => {
        tagFilter = tagSelect.value;
        void showDetail(id);
      });
      const expiredBox = h('input', { type: 'checkbox', id: 'co-expired-only', checked: onlyExpired });
      expiredBox.addEventListener('change', () => {
        onlyExpired = expiredBox.checked;
        void showDetail(id);
      });
      const filtered = visible.length !== items.length;

      setChildren(
        view,
        h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'btn', id: 'co-back', onclick: () => void showList() }, '← Alle Sammlungen'), h('h2', { id: 'co-name' }, col.name), h('button', { type: 'button', class: 'btn', onclick: () => void rename(col) }, 'Umbenennen')),
        h('p', { class: 'hint', id: 'co-summary' }, `${items.length} Position(en), ${total} Stück insgesamt.`),
        split.expired.length > 0 || soon > 0
          ? h(
              'p',
              { class: split.expired.length > 0 ? 'field__error' : 'hint', id: 'co-expiry-summary', role: 'status' },
              [split.expired.length > 0 ? `${split.expired.length} Position(en) ABGELAUFEN (werden im Fader übersprungen)` : '', soon > 0 ? `${soon} Position(en) laufen innerhalb von 7 Tagen ab` : ''].filter((t) => t !== '').join(' · ') + '.'
            )
          : null,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn--primary', id: 'co-play', disabled: items.length === 0, onclick: () => ctx.navigate({ name: 'player', params: { collection: id } }) }, 'Abspielen'),
          h('button', { type: 'button', class: 'btn', id: 'co-catalog', onclick: () => void checkCatalog(id) }, 'Mit Artikelstamm abgleichen'),
          h('button', { type: 'button', class: 'btn', id: 'co-expiry', disabled: visible.length === 0, onclick: () => void setExpiryDialog(visible, filtered) }, filtered ? 'Ablaufdatum für Auswahl setzen' : 'Ablaufdatum für alle setzen')
        ),
        h(
          'div',
          { class: 'btn-row', role: 'group', 'aria-label': 'Teilen und Exportieren' },
          h('button', { type: 'button', class: 'btn', id: 'co-share', onclick: () => void shareCollectionFile(ctx, id) }, 'Teilen (Datei)'),
          h('button', { type: 'button', class: 'btn', id: 'co-link', onclick: () => void shareCollectionLink(ctx, id) }, 'Teilen (Link)'),
          h('button', { type: 'button', class: 'btn', id: 'co-text', onclick: () => void copyCollectionText(ctx, id) }, 'Als Text kopieren'),
          h('button', { type: 'button', class: 'btn', id: 'co-csv', onclick: () => void exportCsv(id, col.name) }, 'CSV exportieren'),
          h('button', { type: 'button', class: 'btn', id: 'co-publish', onclick: () => void publishToLibrary(id, col.name) }, 'In Bibliothek veröffentlichen'),
          col.library ? h('button', { type: 'button', class: 'btn', id: 'co-detach', title: 'Die Sammlung bleibt als eigene Kopie erhalten und wird nicht mehr aus der Bibliothek aktualisiert', onclick: () => void detach(id) }, 'Von Bibliothek lösen') : null,
          h('button', { type: 'button', class: 'btn', id: 'co-import', onclick: () => void runImport() }, 'Importieren'),
          h('button', { type: 'button', class: 'btn', id: 'co-json', onclick: () => void downloadBackup(ctx) }, 'Backup (JSON)')
        ),
        items.length > 0 ? h('div', { class: 'filters' }, searchBox, tagSelect, h('label', { class: 'check', for: 'co-expired-only' }, expiredBox, 'Nur abgelaufene')) : null,
        items.length === 0
          ? h('p', { class: 'hint', id: 'co-items-empty' }, 'Diese Sammlung ist leer. Erfassen Sie Codes unter „Erfassen“, importieren Sie eine Datei oder erzeugen Sie eine Zahlenreihe im Generator.')
          : visible.length === 0
            ? h('p', { class: 'hint', id: 'co-no-match' }, 'Keine Position passt zu Suche und Filter.')
            : h(
                'div',
                { class: 'table-wrap' },
                h(
                  'table',
                  { class: 'table', id: 'co-table' },
                  h('caption', { class: 'sr-only' }, `Positionen der Sammlung ${col.name}`),
                  h('thead', null, h('tr', null, ...['Nr.', 'Format', 'Wert', 'Menge', 'Status', 'Aktionen'].map((t) => h('th', { scope: 'col' }, t)))),
                  h('tbody', null, ...visible.map(rowFor))
                )
              )
      );
    } catch (error: unknown) {
      fail('collections-detail')(error);
    }
  };

  const setExpiryDialog = async (targets: readonly BarcodeItem[], filtered: boolean): Promise<void> => {
    const date = h('input', { id: 'ex-date', class: 'input', type: 'date' });
    const body = h(
      'div',
      null,
      h('p', null, filtered ? `Das Datum wird für die ${targets.length} angezeigten Position(en) gesetzt.` : `Das Datum wird für alle ${targets.length} Position(en) gesetzt.`),
      h('div', { class: 'field' }, h('label', { for: 'ex-date' }, 'Ablaufdatum'), date, h('p', { class: 'hint' }, 'Leer lassen, um das Ablaufdatum zu entfernen.'))
    );
    const ok = await formDialog({
      title: 'Ablaufdatum setzen',
      body,
      focus: date,
      onSubmit: async () => {
        try {
          await ctx.collections.setExpiry(
            targets.map((t) => t.id),
            date.value.trim() === '' ? null : date.value
          );
          return null;
        } catch (error: unknown) {
          if (error instanceof AppError) return error.userMessage;
          throw error;
        }
      }
    });
    if (ok && openId) await showDetail(openId);
  };

  const detach = async (id: string): Promise<void> => {
    try {
      await ctx.collections.detachLibrary(id);
      ctx.notify.success('Die Sammlung ist jetzt eine eigene Kopie und wird nicht mehr aktualisiert.');
      await showDetail(id);
    } catch (error: unknown) {
      fail('collections-detach')(error);
    }
  };

  const publishToLibrary = async (id: string, name: string): Promise<void> => {
    try {
      const { json } = await ctx.backup.exportCollectionShare(id);
      const fileName = libraryFileName(name);
      downloadText(fileName, json, 'application/json');
      await confirmDialog({
        title: 'In Bibliothek veröffentlichen',
        confirmLabel: 'Verstanden',
        cancelLabel: 'Schließen',
        message: h(
          'div',
          { id: 'co-publish-steps' },
          h('p', null, `Die Datei „${fileName}“ wurde heruntergeladen. So erreicht sie alle, die diese App nutzen:`),
          h(
            'ol',
            null,
            h('li', null, 'Öffnen Sie Ihr Repository auf GitHub und dort den Ordner „public/library“.'),
            h('li', null, 'Wählen Sie „Add file → Upload files“, legen Sie die Datei hinein und bestätigen Sie mit „Commit changes“. Eine Datei mit gleichem Namen wird dabei ersetzt (= Aktualisierung).'),
            h('li', null, 'Nach ein bis zwei Minuten (Lauf „Veröffentlichen“ unter „Actions“) erscheint die Sammlung bei allen unter „Sammlungen → Gemeinsame Bibliothek“ zum Übernehmen.')
          ),
          h('p', { class: 'field__error', id: 'co-publish-warning' }, 'Achtung: Die Bibliothek ist öffentlich lesbar. Jeder, der die App-Adresse kennt, kann diese Codes samt Wort, Nutzen, Notiz und Tags lesen. Veröffentlichen Sie nichts Vertrauliches.')
        )
      });
    } catch (error: unknown) {
      fail('collections-publish')(error);
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

  // ------------------------------------------------------------------ Start
  const linked = route.params['import'];
  if (linked) {
    // Link sofort aus der Adresszeile entfernen, damit ein Neuladen den Dialog nicht erneut öffnet
    history.replaceState(null, '', `${location.pathname}${location.search}#/collections`);
    void showList().then(async () => {
      try {
        await runImport({ text: await decodeSharePayload(linked), name: 'Link' });
      } catch (error: unknown) {
        fail('collections-link')(error);
      }
    });
  } else {
    void (openId ? showDetail(openId) : showList());
  }
  return () => {
    alive = false;
  };
}
