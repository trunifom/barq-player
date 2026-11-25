// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, type RunningApp } from '../../src/app/bootstrap';
import { LIBRARY_FORMAT } from '../../src/domain/library';
import { buildShareFile, parseShareText, type ShareFile } from '../../src/domain/share-format';
import type { FetchLike } from '../../src/application/library-service';
import { libraryFileName, mountCollections } from '../../src/ui/screens/collections';
import { answerDialog, click, flush, setupUi, teardownUi, testEnv, text, waitFor, type UiSetup } from './helpers';

const SCREW = '2345678765430';
const BOLT = '4006381333931';

let ui: UiSetup | null = null;
let app: RunningApp | null = null;
const downloads: Array<{ name: string; content: string }> = [];

/** Veröffentlichte Dateien (live veränderbar) und simulierter Server. */
const published: Record<string, string> = {};
let offline = false;

const fetchStub: FetchLike = (url) => {
  if (offline) return Promise.reject(new TypeError('Failed to fetch'));
  const name = decodeURIComponent(url.replace('./library/', ''));
  const body = name === 'index.json' ? JSON.stringify({ format: LIBRARY_FORMAT, schemaVersion: 1, files: Object.keys(published) }) : published[name];
  if (body === undefined) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
};

function publish(file: string, name: string, items: ShareFile['items']): void {
  const f = buildShareFile(name, [], { exportedAt: '', appVersion: '' });
  f.items.push(...items);
  published[file] = JSON.stringify(f);
}

const screw: ShareFile['items'][number] = { symbology: 'EAN13', value: SCREW, quantity: 1, label: 'Schraube 2x3mm', purpose: 'Montage', note: 'nur gültig für Maschine 2374', tags: ['Firma XYZ', 'Maschine 2374'], expiresAt: '2035-12-31' };

beforeEach(() => {
  for (const k of Object.keys(published)) delete published[k];
  offline = false;
  downloads.length = 0;
  let pending = '';
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
    void b.text().then((t) => {
      pending = t;
    });
    return 'blob:test';
  };
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const name = this.getAttribute('download') ?? '';
    // Inhalt wird asynchron gelesen; kurz warten, bis `pending` gesetzt ist
    void Promise.resolve().then(() => flush(2)).then(() => downloads.push({ name, content: pending }));
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  app?.dispose();
  await app?.ctx.db.delete();
  app = null;
  await teardownUi(ui);
  ui = null;
  document.body.replaceChildren();
  window.location.hash = '';
});

async function openList(u: UiSetup): Promise<void> {
  u.mount(mountCollections, { name: 'collections', params: {} });
  await waitFor(() => u.root.querySelector('#co-library #co-lib-status') === null && u.root.querySelector('#co-library') !== null);
}

describe('Gemeinsame Bibliothek in der Sammlungsliste', () => {
  it('keine veröffentlichte Bibliothek: freundlicher Hinweis mit Anleitung, kein Fehler', async () => {
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    expect(text(ui.root, '#co-lib-empty')).toContain('In Bibliothek veröffentlichen');
    expect(ui.ctx.logger.entries).toEqual([]);
  });

  it('neue Sammlung: Übernehmen legt sie samt Zusatzangaben an, markiert sie als „Bibliothek“ und zeigt danach „Aktuell“', async () => {
    publish('schrauben.json', 'Schrauben', [screw, { symbology: 'EAN13', value: BOLT, quantity: 2, expiresAt: '2020-01-01' }]);
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    const row = ui.root.querySelector('[data-library="schrauben.json"]') as HTMLElement;
    expect(row.textContent).toContain('Schrauben');
    expect(row.textContent).toContain('2 Code(s), davon 1 abgelaufen');
    expect(row.querySelector('[data-status]')?.textContent).toBe('Neu');
    click(ui.root, '[data-library-apply="schrauben.json"]');
    await waitFor(() => ui?.root.querySelector('.collection-row [data-badge="library"]') !== null);
    await waitFor(() => ui?.root.querySelector('[data-library="schrauben.json"] [data-status="current"]') !== null);
    expect(ui.root.querySelector('[data-library-apply]')).toBeNull();
    const [c] = await ui.ctx.collections.listCollections();
    expect((await ui.ctx.collections.listItems(c!.id))[0]).toMatchObject({ value: SCREW, label: 'Schraube 2x3mm', purpose: 'Montage', tags: ['Firma XYZ', 'Maschine 2374'], expiresAt: '2035-12-31' });
  });

  it('mehrere neue Sammlungen: „Alle übernehmen“', async () => {
    publish('a.json', 'Alpha', [screw]);
    publish('b.json', 'Beta', [{ symbology: 'EAN13', value: BOLT, quantity: 1 }]);
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    expect(text(ui.root, '#co-lib-all')).toBe('Alle 2 übernehmen bzw. aktualisieren');
    click(ui.root, '#co-lib-all');
    await waitFor(() => ui?.root.querySelectorAll('.collection-row').length === 2);
    expect((await ui.ctx.collections.listCollections()).map((c) => c.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('neue Version: „Aktualisieren“ ohne Rückfrage, wenn lokal nichts geändert wurde', async () => {
    publish('a.json', 'Alpha', [screw]);
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    click(ui.root, '[data-library-apply]');
    await waitFor(() => ui?.root.querySelector('[data-status="current"]') !== null);
    publish('a.json', 'Alpha', [{ ...screw, expiresAt: '2036-01-01' }]);
    click(ui.root, '#co-lib-refresh');
    await waitFor(() => ui?.root.querySelector('[data-status="update"]') !== null);
    expect(text(ui.root, '[data-library-apply]')).toBe('Aktualisieren');
    click(ui.root, '[data-library-apply]');
    await waitFor(() => ui?.root.querySelector('[data-status="current"]') !== null);
    const [c] = await ui.ctx.collections.listCollections();
    expect((await ui.ctx.collections.listItems(c!.id))[0]?.expiresAt).toBe('2036-01-01');
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('neue Version bei lokaler Änderung: Rückfrage; Abbrechen ändert nichts, Überschreiben übernimmt die Version', async () => {
    publish('a.json', 'Alpha', [screw]);
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    click(ui.root, '[data-library-apply]');
    await waitFor(() => ui?.root.querySelector('[data-status="current"]') !== null);
    const [c] = await ui.ctx.collections.listCollections();
    const [item] = await ui.ctx.collections.listItems(c!.id);
    await ui.ctx.collections.updateItemMeta(item!.id, { label: 'Mein eigenes Label' });
    publish('a.json', 'Alpha', [{ ...screw, label: 'Neues Label' }]);
    click(ui.root, '#co-lib-refresh');
    await waitFor(() => ui?.root.querySelector('[data-status="update-modified"]') !== null);
    expect(text(ui.root, '[data-status="update-modified"]')).toContain('lokal geändert');
    click(ui.root, '[data-library-apply]');
    await waitFor(() => document.querySelector('.dialog') !== null);
    expect(text(document.body, '.dialog')).toContain('gehen diese Änderungen verloren');
    await answerDialog('Abbrechen');
    await flush(6);
    expect((await ui.ctx.collections.listItems(c!.id))[0]?.label).toBe('Mein eigenes Label');
    await waitFor(() => ui?.root.querySelector('[data-library-apply]') !== null);
    click(ui.root, '[data-library-apply]');
    await answerDialog('Überschreiben');
    await waitFor(() => ui?.root.querySelector('[data-status="current"]') !== null);
    expect((await ui.ctx.collections.listItems(c!.id))[0]?.label).toBe('Neues Label');
  });

  it('offline: Hinweis, kein Absturz, kein Fehler im Protokoll; vorhandene Sammlungen bleiben', async () => {
    offline = true;
    ui = setupUi({ fetch: fetchStub });
    const c = await ui.ctx.collections.createCollection('Lokal');
    await openList(ui);
    expect(text(ui.root, '#co-lib-error')).toContain('Bibliothek konnte nicht geladen werden');
    expect(text(ui.root, '#co-lib-error')).toContain('bleiben nutzbar');
    expect(ui.root.querySelector('.collection-row')).not.toBeNull();
    expect(ui.ctx.logger.entries).toEqual([]);
    offline = false;
    publish('a.json', 'Alpha', [screw]);
    click(ui.root, '#co-lib-refresh');
    await waitFor(() => ui?.root.querySelector('[data-library="a.json"]') !== null);
    expect(c.id).toBeTruthy();
  });

  it('eine fehlerhafte Datei wird gemeldet, die guten bleiben übernehmbar', async () => {
    publish('gut.json', 'Gut', [screw]);
    publish('kaputt.json', 'Kaputt', [{ symbology: 'EAN13', value: '2345678765432', quantity: 1 }]);
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    expect(text(ui.root, '#co-lib-problems')).toContain('kaputt.json');
    expect(text(ui.root, '#co-lib-problems')).toContain('Code 1');
    expect(ui.root.querySelector('[data-library="gut.json"]')).not.toBeNull();
    expect(ui.root.querySelector('[data-library="kaputt.json"]')).toBeNull();
  });

  it('Namen aus der Bibliothek werden nie als Markup interpretiert', async () => {
    publish('x.json', '<img src=x onerror=alert(1)>', [screw]);
    ui = setupUi({ fetch: fetchStub });
    await openList(ui);
    expect(ui.root.querySelector('#co-library img')).toBeNull();
    expect(text(ui.root, '#co-library')).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('Veröffentlichen und Lösen', () => {
  async function openDetail(u: UiSetup, id: string): Promise<void> {
    u.mount(mountCollections, { name: 'collections', params: { id } });
    await waitFor(() => u.root.querySelector('#co-table') !== null);
  }

  it('Datei wird heruntergeladen, Anleitung und Warnung (öffentlich!) erscheinen', async () => {
    ui = setupUi({ fetch: fetchStub });
    const c = await ui.ctx.collections.createCollection('Schrauben M3');
    await ui.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: SCREW, source: 'manual', label: 'Schraube 2x3mm', tags: 'Firma XYZ', expiresAt: '31.12.2035' });
    await openDetail(ui, c.id);
    click(ui.root, '#co-publish');
    await waitFor(() => downloads.length > 0);
    expect(downloads[0]?.name).toBe('Schrauben_M3.json');
    const file = parseShareText(downloads[0]?.content ?? '');
    expect(file.collection.name).toBe('Schrauben M3');
    expect(file.items[0]).toMatchObject({ value: SCREW, label: 'Schraube 2x3mm', tags: ['Firma XYZ'], expiresAt: '2035-12-31' });
    await waitFor(() => document.querySelector('#co-publish-steps') !== null);
    expect(text(document.body, '#co-publish-steps')).toContain('public/library');
    expect(text(document.body, '#co-publish-steps')).toContain('Commit changes');
    expect(text(document.body, '#co-publish-warning')).toContain('öffentlich lesbar');
    await answerDialog('Schließen');
  });

  it('libraryFileName: zulässige Namen, „index“ ist reserviert', () => {
    expect(libraryFileName('Schrauben M3 / Maschine 2374')).toBe('Schrauben_M3_Maschine_2374.json');
    expect(libraryFileName('index')).toBe('index_sammlung.json');
    expect(libraryFileName('Äpfel')).toBe('Äpfel.json');
  });

  it('„Von Bibliothek lösen“ erscheint nur bei Bibliotheks-Sammlungen und macht sie zur eigenen Kopie', async () => {
    publish('a.json', 'Alpha', [screw]);
    ui = setupUi({ fetch: fetchStub });
    const own = await ui.ctx.collections.createCollection('Eigene');
    await ui.ctx.collections.addItem(own.id, { symbology: 'EAN13', value: BOLT, source: 'manual' });
    await openDetail(ui, own.id);
    expect(ui.root.querySelector('#co-detach')).toBeNull();
    ui.unmount();
    await openList(ui);
    click(ui.root, '[data-library-apply]');
    await waitFor(() => ui?.root.querySelector('.collection-row [data-badge="library"]') !== null);
    const lib = (await ui.ctx.collections.listCollections()).find((c) => c.library);
    ui.unmount();
    await openDetail(ui, lib!.id);
    click(ui.root, '#co-detach');
    await waitFor(() => ui?.root.querySelector('#co-detach') === null);
    expect((await ui.ctx.collections.listCollections()).some((c) => c.library)).toBe(false);
  });
});

describe('Hinweis beim App-Start', () => {
  function start(fetch: FetchLike): RunningApp {
    document.body.replaceChildren();
    window.location.hash = '';
    const host = document.createElement('div');
    host.id = 'app';
    document.body.appendChild(host);
    app = bootstrap(host, testEnv({ fetch }).env);
    return app;
  }

  it('meldet neue oder aktualisierte Sammlungen, übernimmt aber nichts von selbst', async () => {
    publish('a.json', 'Alpha', [screw]);
    start(fetchStub);
    await waitFor(() => app?.ctx.notify.items.some((n) => n.message.includes('Gemeinsame Bibliothek: 1 neue oder aktualisierte')) === true);
    expect(await app?.ctx.collections.listCollections()).toEqual([]);
  });

  it('bleibt ohne Neuigkeiten, offline und ohne Bibliothek still (kein Hinweis, kein Fehlerprotokoll)', async () => {
    offline = true;
    start(fetchStub);
    await flush(10);
    expect(app?.ctx.notify.items).toEqual([]);
    expect(app?.ctx.logger.entries).toEqual([]);
  });
});
