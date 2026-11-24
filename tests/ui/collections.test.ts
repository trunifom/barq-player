// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountCollections } from '../../src/ui/screens/collections';
import { answerDialog, click, flush, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

let ui: UiSetup | null = null;
const downloads: Array<{ name: string; type: string }> = [];

beforeEach(() => {
  downloads.length = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    downloads.push({ name: '', type: b.type });
    return 'blob:test';
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const last = downloads.at(-1);
    if (last) last.name = this.getAttribute('download') ?? '';
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await teardownUi(ui);
  ui = null;
});

async function seed(u: UiSetup): Promise<string> {
  const c = await u.ctx.collections.createCollection('Lager A');
  await u.ctx.collections.addItems(c.id, [
    { symbology: 'EAN13', value: EAN_A, source: 'manual', quantity: 2, label: 'Stift' },
    { symbology: 'EAN13', value: EAN_B, source: 'manual' },
    { symbology: 'QRCode', value: '<b>fett</b>', source: 'manual' }
  ]);
  return c.id;
}

async function openList(u: UiSetup): Promise<void> {
  u.mount(mountCollections, { name: 'collections', params: {} });
  await waitFor(() => u.root.querySelector('#co-list, #co-empty') !== null);
}

async function openDetail(u: UiSetup, id: string): Promise<void> {
  u.mount(mountCollections, { name: 'collections', params: { id } });
  await waitFor(() => u.root.querySelector('#co-table, #co-items-empty') !== null);
}

const values = (u: UiSetup): string[] => [...u.root.querySelectorAll('#co-table tbody tr .value')].map((e) => e.textContent ?? '');

describe('Liste', () => {
  it('leer: Hinweis; mit Daten: Name, Anzahl, Aktionen', async () => {
    ui = setupUi();
    await openList(ui);
    expect(text(ui.root, '#co-empty')).toContain('Noch keine Sammlung');
    ui.unmount();
    await seed(ui);
    await openList(ui);
    expect(text(ui.root, '.collection-row')).toContain('Lager A');
    expect(text(ui.root, '.collection-row')).toContain('3 Position(en)');
    for (const a of ['data-open', 'data-rename', 'data-play', 'data-delete']) expect(ui.root.querySelector(`[${a}]`)).not.toBeNull();
  });

  it('Namen werden als Text dargestellt (kein Markup)', async () => {
    ui = setupUi();
    await ui.ctx.collections.createCollection('<img src=x onerror=alert(1)>');
    await openList(ui);
    expect(ui.root.querySelector('img')).toBeNull();
    expect(text(ui.root, '.collection-row')).toContain('<img src=x onerror=alert(1)>');
  });

  it('anlegen, umbenennen, löschen (mit Bestätigung)', async () => {
    ui = setupUi();
    await openList(ui);
    click(ui.root, '#co-new');
    await answerDialog('Anlegen', 'Neu');
    await waitFor(() => ui?.root.querySelector('.collection-row') !== null);
    expect(text(ui.root, '.collection-row')).toContain('Neu');
    click(ui.root, '[data-rename]');
    await answerDialog('Umbenennen', 'Umbenannt');
    await waitFor(() => text(ui?.root ?? document.body, '.collection-row').includes('Umbenannt'));
    click(ui.root, '[data-delete]');
    await answerDialog('Abbrechen'); // abbrechen → bleibt
    await flush(3);
    expect(ui.root.querySelector('.collection-row')).not.toBeNull();
    click(ui.root, '[data-delete]');
    await waitFor(() => document.querySelector('.dialog') !== null);
    expect(text(document.body, '.dialog')).toContain('kann nicht rückgängig gemacht werden');
    await answerDialog('Löschen');
    await waitFor(() => ui?.root.querySelector('#co-empty') !== null);
  });

  it('Abspielen navigiert mit Sammlungs-ID zum Fader', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openList(ui);
    click(ui.root, '[data-play]');
    expect(window.location.hash).toBe(`#/player?collection=${id}`);
  });

  it('Öffnen zeigt Details', async () => {
    ui = setupUi();
    await seed(ui);
    await openList(ui);
    click(ui.root, '[data-open]');
    await waitFor(() => ui?.root.querySelector('#co-table') !== null);
    expect(text(ui.root, '#co-name')).toBe('Lager A');
  });
});

describe('Detail', () => {
  it('Tabelle mit Positionen, Mengen, getrennten Status-Badges; Werte als Text', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    expect(text(ui.root, '#co-summary')).toBe('3 Position(en), 4 Stück insgesamt.');
    expect(values(ui)).toEqual([EAN_A, EAN_B, '<b>fett</b>']);
    expect(ui.root.querySelector('#co-table b')).toBeNull();
    const badges = [...ui.root.querySelectorAll('#co-table tbody tr:first-child .badge')].map((b) => b.textContent);
    expect(badges).toEqual(['Syntax: gültig', 'Prüfziffer: gültig', 'Artikelstamm: ungeprüft']);
    expect(text(ui.root, '#co-table tbody tr:first-child')).toContain('Stift');
    expect(ui.root.querySelector('caption')?.textContent).toContain('Lager A');
    expect(ui.root.querySelectorAll('#co-table th[scope="col"]')).toHaveLength(6);
  });

  it('Menge + / − (nicht unter 1)', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    const item = (await ui.ctx.collections.listItems(id))[1]!;
    expect((ui.root.querySelector(`[data-qty-down="${item.id}"]`) as HTMLButtonElement).disabled).toBe(true);
    click(ui.root, `[data-qty-up="${item.id}"]`);
    await waitFor(() => text(ui?.root ?? document.body, `[data-item="${item.id}"] output`) === '2');
    click(ui.root, `[data-qty-down="${item.id}"]`);
    await waitFor(() => text(ui?.root ?? document.body, `[data-item="${item.id}"] output`) === '1');
    expect((await ui.ctx.collections.listItems(id))[1]?.quantity).toBe(1);
  });

  it('Reihenfolge ändern mit ↑/↓; erste/letzte Zeile hat gesperrte Richtung', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    const items = await ui.ctx.collections.listItems(id);
    expect((ui.root.querySelector(`[data-up="${items[0]!.id}"]`) as HTMLButtonElement).disabled).toBe(true);
    expect((ui.root.querySelector(`[data-down="${items[2]!.id}"]`) as HTMLButtonElement).disabled).toBe(true);
    click(ui.root, `[data-down="${items[0]!.id}"]`);
    await waitFor(() => values(ui!)[0] === EAN_B);
    expect(values(ui)).toEqual([EAN_B, EAN_A, '<b>fett</b>']);
    click(ui.root, `[data-up="${items[2]!.id}"]`);
    await waitFor(() => values(ui!)[1] === '<b>fett</b>');
  });

  it('Position entfernen (lückenlos neu nummeriert)', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    const items = await ui.ctx.collections.listItems(id);
    click(ui.root, `[data-remove="${items[0]!.id}"]`);
    await waitFor(() => values(ui!).length === 2);
    expect([...ui.root.querySelectorAll('#co-table tbody tr td.num')].map((e) => e.textContent)).toEqual(['1', '2']);
  });

  it('leere Sammlung: Hinweis und Abspielen gesperrt', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('Leer');
    await openDetail(ui, c.id);
    expect(text(ui.root, '#co-items-empty')).toContain('leer');
    expect((ui.root.querySelector('#co-play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Artikelstamm-Abgleich: ohne Stamm Hinweis, mit Stamm Statusbadges mit Quelle', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    click(ui.root, '#co-catalog');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.message.includes('noch kein Artikelstamm')) === true);
    await ui.ctx.collections.replaceCatalog([{ value: EAN_A, active: true, source: 'stamm.csv', importedAt: 't' }, { value: EAN_B, active: false, source: 'stamm.csv', importedAt: 't' }]);
    click(ui.root, '#co-catalog');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    await waitFor(() => text(ui?.root ?? document.body, '#co-table tbody tr:first-child').includes('bekannt'));
    const row2 = text(ui.root, '#co-table tbody tr:nth-child(2)');
    expect(row2).toContain('inaktiv');
    expect(row2).toContain('Prüfziffer: gültig'); // getrennte Aussagen
    expect(ui.root.querySelector('#co-table tbody tr:first-child [data-badge="catalog"]')?.getAttribute('title')).toContain('stamm.csv');
  });

  it('CSV- und JSON-Export lösen Downloads aus', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    click(ui.root, '#co-csv');
    await waitFor(() => downloads.length === 1);
    expect(downloads[0]).toEqual({ name: 'Lager_A.csv', type: 'text/csv;charset=utf-8' });
    click(ui.root, '#co-json');
    await waitFor(() => downloads.length === 2);
    expect(downloads[1]?.name).toMatch(/^barqplayer-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[1]?.type).toBe('application/json');
  });

  it('Fehler (z. B. Menge über Grenze) erscheinen als Banner mit Code', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    const items = await ui.ctx.collections.listItems(id);
    await ui.ctx.collections.setQuantity(items[0]!.id, 9999);
    await openDetail(ui, id);
    click(ui.root, `[data-qty-up="${items[0]!.id}"]`);
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items[0]?.code).toBe('ERR_SYNTAX_INVALID');
  });

  it('zurück zur Liste; gelöschte Sammlung wird erkannt', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    click(ui.root, '#co-back');
    await waitFor(() => ui?.root.querySelector('#co-list') !== null);
    await ui.ctx.collections.deleteCollection(id);
    ui.unmount();
    ui.mount(mountCollections, { name: 'collections', params: { id } });
    await waitFor(() => ui?.root.querySelector('#co-empty') !== null);
    expect(ui.ctx.notify.items.some((n) => n.message.includes('existiert nicht mehr'))).toBe(true);
  });
});
