// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSharePayload } from '../../src/adapters/share/link-codec';
import { mountCollections } from '../../src/ui/screens/collections';
import { mountPlayer } from '../../src/ui/screens/player';
import { mountScanner } from '../../src/ui/screens/scanner';
import { mountSettings } from '../../src/ui/screens/settings';
import { buildShareFile } from '../../src/domain/share-format';
import { answerDialog, chooseFiles, click, flush, setChecked, setValue, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

const A = '4006381333931';
const B = '5901234123457';
const C = '9780201379624';

let ui: UiSetup | null = null;
const downloads: string[] = [];
const nav = navigator as unknown as Record<string, unknown>;

function setNav(key: string, value: unknown): void {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

beforeEach(() => {
  downloads.length = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:test';
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.getAttribute('download') ?? '');
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of ['share', 'canShare', 'clipboard']) delete nav[k];
  await teardownUi(ui);
  ui = null;
});

async function seed(u: UiSetup): Promise<string> {
  const c = await u.ctx.collections.createCollection('Lager A');
  await u.ctx.collections.addItems(c.id, [
    { symbology: 'EAN13', value: A, source: 'manual', label: 'Apfel', purpose: 'Kassentest', note: 'Aktion KW 12', tags: ['Obst', 'Aktion'], expiresAt: '2026-11-23' }, // gestern
    { symbology: 'EAN13', value: B, source: 'manual', label: 'Birne', tags: ['Obst'], expiresAt: '2026-11-27' }, // in 3 Tagen
    { symbology: 'EAN13', value: C, source: 'manual', expiresAt: '2027-05-01' }
  ]);
  return c.id;
}

async function openDetail(u: UiSetup, id: string): Promise<void> {
  u.mount(mountCollections, { name: 'collections', params: { id } });
  await waitFor(() => u.root.querySelector('#co-table, #co-items-empty') !== null);
}

async function openList(u: UiSetup, params: Record<string, string> = {}): Promise<void> {
  u.mount(mountCollections, { name: 'collections', params });
  await waitFor(() => u.root.querySelector('#co-list, #co-empty') !== null);
}

const rowValues = (u: UiSetup): string[] => [...u.root.querySelectorAll('#co-table tbody tr .value')].map((e) => e.textContent ?? '');
const rowOf = (u: UiSetup, value: string): HTMLElement => [...u.root.querySelectorAll<HTMLElement>('#co-table tbody tr')].find((r) => r.querySelector('.value')?.textContent === value) as HTMLElement;

describe('Anzeige von Zusatzangaben und Ablauf', () => {
  it('zeigt Wort, Nutzen, Satz, Tags und markiert abgelaufene Codes deutlich', async () => {
    ui = setupUi();
    await openDetail(ui, await seed(ui));
    const apple = rowOf(ui, A);
    expect(apple.textContent).toContain('Apfel');
    expect(apple.textContent).toContain('Nutzen: Kassentest');
    expect(apple.textContent).toContain('Aktion KW 12');
    expect([...apple.querySelectorAll('.tag')].map((t) => t.textContent)).toEqual(['#Obst', '#Aktion']);
    expect(apple.classList.contains('row--expired')).toBe(true);
    expect(apple.querySelector('[data-badge="expiry"]')?.textContent).toBe('ABGELAUFEN – abgelaufen am 23.11.2026');
    expect(apple.querySelector('[data-badge="expiry"]')?.className).toContain('badge--bad');
    expect(rowOf(ui, B).querySelector('[data-badge="expiry"]')?.textContent).toBe('läuft in 3 Tagen ab (27.11.2026)');
    expect(rowOf(ui, B).querySelector('[data-badge="expiry"]')?.className).toContain('badge--warn');
    expect(rowOf(ui, C).querySelector('[data-badge="expiry"]')?.textContent).toBe('gültig bis 01.05.2027');
    expect(rowOf(ui, C).classList.contains('row--expired')).toBe(false);
  });

  it('die Zusammenfassung nennt abgelaufene und bald ablaufende Positionen; „Anzeige ≠ Buchung“-Zählung bleibt unverändert', async () => {
    ui = setupUi();
    await openDetail(ui, await seed(ui));
    expect(text(ui.root, '#co-summary')).toBe('3 Position(en), 3 Stück insgesamt.');
    expect(text(ui.root, '#co-expiry-summary')).toBe('1 Position(en) ABGELAUFEN (werden im Fader übersprungen) · 1 Position(en) laufen innerhalb von 7 Tagen ab.');
  });

  it('ohne Ablaufdaten erscheint keine Ablaufzeile und kein Ablauf-Badge', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('Neutral');
    await ui.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual' });
    await openDetail(ui, c.id);
    expect(ui.root.querySelector('#co-expiry-summary')).toBeNull();
    expect(ui.root.querySelector('[data-badge="expiry"]')).toBeNull();
  });

  it('Werte und Texte werden nie als Markup interpretiert', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('X');
    await ui.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: '<img src=x onerror=alert(1)>', note: '<script>alert(1)</script>', tags: ['<b>fett</b>'] });
    await openDetail(ui, c.id);
    expect(ui.root.querySelector('#co-table img, #co-table script, #co-table b')).toBeNull();
    expect(text(ui.root, '#co-table')).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('Suchen und Filtern', () => {
  it('Suche nach Wort/Nutzen/Satz/Tag/Wert; keine Treffer → Hinweis', async () => {
    ui = setupUi();
    await openDetail(ui, await seed(ui));
    setValue(ui.root, '#co-search', 'kassentest');
    await waitFor(() => rowValues(ui as UiSetup).length === 1);
    expect(rowValues(ui)).toEqual([A]);
    setValue(ui.root, '#co-search', 'birne');
    await waitFor(() => rowValues(ui as UiSetup)[0] === B);
    setValue(ui.root, '#co-search', 'gibt-es-nicht');
    await waitFor(() => ui?.root.querySelector('#co-no-match') !== null);
    expect(ui.root.querySelector('#co-table')).toBeNull();
  });

  it('Tag-Filter per Auswahl und per Klick auf einen Tag; erneuter Klick hebt auf', async () => {
    ui = setupUi();
    await openDetail(ui, await seed(ui));
    expect([...ui.root.querySelectorAll('#co-tag option')].map((o) => o.textContent)).toEqual(['Alle Tags', '#Aktion', '#Obst']);
    setValue(ui.root, '#co-tag', 'Aktion');
    await waitFor(() => rowValues(ui as UiSetup).length === 1);
    expect(rowValues(ui)).toEqual([A]);
    setValue(ui.root, '#co-tag', '');
    await waitFor(() => rowValues(ui as UiSetup).length === 3);
    click(rowOf(ui, B), '[data-tag="Obst"]');
    await waitFor(() => rowValues(ui as UiSetup).length === 2);
    click(rowOf(ui, B), '[data-tag="Obst"]');
    await waitFor(() => rowValues(ui as UiSetup).length === 3);
  });

  it('„Nur abgelaufene“ zeigt nur abgelaufene Codes', async () => {
    ui = setupUi();
    await openDetail(ui, await seed(ui));
    setChecked(ui.root, '#co-expired-only', true);
    await waitFor(() => rowValues(ui as UiSetup).length === 1);
    expect(rowValues(ui)).toEqual([A]);
  });
});

describe('Details bearbeiten', () => {
  it('speichert Wort, Nutzen, Satz, Tags und Ablaufdatum und zeigt sie sofort an', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('L');
    const item = await ui.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual' });
    await openDetail(ui, c.id);
    click(ui.root, `[data-edit="${item.id}"]`);
    await waitFor(() => document.querySelector('#ed-label') !== null);
    setValue(document.body, '#ed-label', 'Apfel');
    setValue(document.body, '#ed-purpose', 'Test');
    setValue(document.body, '#ed-note', 'Ein ganzer Satz.');
    setValue(document.body, '#ed-tags', 'Obst, #Aktion');
    setValue(document.body, '#ed-expires', '2026-11-20');
    await answerDialog('Speichern');
    await waitFor(() => rowOf(ui as UiSetup, A).textContent?.includes('Apfel') === true);
    expect(rowOf(ui, A).querySelector('[data-badge="expiry"]')?.textContent).toContain('ABGELAUFEN');
    expect((await ui.ctx.collections.listItems(c.id))[0]).toMatchObject({ label: 'Apfel', purpose: 'Test', note: 'Ein ganzer Satz.', tags: ['Obst', 'Aktion'], expiresAt: '2026-11-20' });
  });

  it('der Dialog zeigt vorhandene Werte; Leeren entfernt Angaben', async () => {
    ui = setupUi();
    const id = await seed(ui);
    const first = (await ui.ctx.collections.listItems(id))[0]!;
    await openDetail(ui, id);
    click(ui.root, `[data-edit="${first.id}"]`);
    await waitFor(() => document.querySelector('#ed-label') !== null);
    expect((document.querySelector('#ed-label') as HTMLInputElement).value).toBe('Apfel');
    expect((document.querySelector('#ed-tags') as HTMLInputElement).value).toBe('Obst, Aktion');
    expect((document.querySelector('#ed-expires') as HTMLInputElement).value).toBe('2026-11-23');
    setValue(document.body, '#ed-label', '');
    setValue(document.body, '#ed-note', '');
    setValue(document.body, '#ed-expires', '');
    await answerDialog('Speichern');
    await waitFor(() => rowOf(ui as UiSetup, A).querySelector('[data-badge="expiry"]') === null);
    const saved = (await ui.ctx.collections.listItems(id))[0]!;
    expect('label' in saved).toBe(false);
    expect('expiresAt' in saved).toBe(false);
    expect(saved.purpose).toBe('Kassentest');
  });

  it('Fehler bleiben im Dialog sichtbar (nichts gespeichert); Abbrechen ändert nichts', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('L');
    const item = await ui.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: A, source: 'manual', label: 'Bleibt' });
    await openDetail(ui, c.id);
    click(ui.root, `[data-edit="${item.id}"]`);
    await waitFor(() => document.querySelector('#ed-note') !== null);
    setValue(document.body, '#ed-note', 'x'.repeat(501));
    const ok = [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === 'Speichern') as HTMLButtonElement;
    ok.click();
    await waitFor(() => (document.querySelector('.dialog .field__error')?.textContent ?? '') !== '');
    expect(text(document.body, '.dialog .field__error')).toContain('Satz: höchstens 500 Zeichen');
    expect(document.querySelector('.dialog')).not.toBeNull();
    await answerDialog('Abbrechen');
    expect((await ui.ctx.collections.listItems(c.id))[0]?.label).toBe('Bleibt');
  });

  it('Ablaufdatum für alle (bzw. für die gefilterte Auswahl) setzen und entfernen', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    expect(text(ui.root, '#co-expiry')).toBe('Ablaufdatum für alle setzen');
    click(ui.root, '#co-expiry');
    await waitFor(() => document.querySelector('#ex-date') !== null);
    expect(text(document.body, '.dialog')).toContain('alle 3 Position(en)');
    setValue(document.body, '#ex-date', '2030-01-01');
    await answerDialog('Speichern');
    await waitFor(() => ui?.root.querySelector('#co-expiry-summary') === null);
    expect((await ui.ctx.collections.listItems(id)).map((i) => i.expiresAt)).toEqual(['2030-01-01', '2030-01-01', '2030-01-01']);
    setValue(ui.root, '#co-tag', 'Aktion');
    await waitFor(() => text(ui?.root ?? document.body, '#co-expiry') === 'Ablaufdatum für Auswahl setzen');
    click(ui.root, '#co-expiry');
    await waitFor(() => document.querySelector('#ex-date') !== null);
    expect(text(document.body, '.dialog')).toContain('1 angezeigten');
    await answerDialog('Speichern'); // leer → entfernen, nur für die Auswahl
    await flush(6);
    expect((await ui.ctx.collections.listItems(id)).map((i) => i.expiresAt)).toEqual([undefined, '2030-01-01', '2030-01-01']);
  });
});

describe('Teilen', () => {
  it('Datei: nutzt das Teilen-Menü des Geräts', async () => {
    ui = setupUi();
    const id = await seed(ui);
    const share = vi.fn(() => Promise.resolve());
    setNav('share', share);
    setNav('canShare', () => true);
    await openDetail(ui, id);
    click(ui.root, '#co-share');
    await waitFor(() => share.mock.calls.length > 0);
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.files?.[0]?.name).toBe('Lager_A.barq.json');
    const json = JSON.parse(await (data.files?.[0] as File).text()) as { format: string; items: Array<{ value: string; expiresAt?: string }> };
    expect(json.format).toBe('barq-player-collection');
    expect(json.items.map((i) => i.value)).toEqual([A, B, C]);
    expect(json.items[0]?.expiresAt).toBe('2026-11-23');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success' && n.message.includes('Teilen-Menü')) === true);
    expect(downloads).toEqual([]);
  });

  it('Datei: ohne Teilen-Unterstützung wird heruntergeladen, mit ehrlichem Hinweis', async () => {
    ui = setupUi();
    const id = await seed(ui);
    await openDetail(ui, id);
    click(ui.root, '#co-share');
    await waitFor(() => downloads.length > 0);
    expect(downloads).toEqual(['Lager_A.barq.json']);
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.message.includes('nicht direkt teilen')) === true);
  });

  it('Datei: Abbruch des Teilen-Dialogs ist kein Fehler', async () => {
    ui = setupUi();
    const id = await seed(ui);
    setNav('share', () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })));
    setNav('canShare', () => true);
    await openDetail(ui, id);
    click(ui.root, '#co-share');
    await flush(10);
    expect(downloads).toEqual([]);
    expect(ui.ctx.logger.entries.filter((e) => e.level === 'error')).toEqual([]);
  });

  it('Link: übergibt einen App-Link mit komprimiertem Inhalt; dieser Link lässt sich wieder importieren', async () => {
    ui = setupUi();
    const id = await seed(ui);
    const share = vi.fn(() => Promise.resolve());
    setNav('share', share);
    await openDetail(ui, id);
    click(ui.root, '#co-link');
    await waitFor(() => share.mock.calls.length > 0);
    const data = (share.mock.calls[0] as unknown as [ShareData])[0];
    expect(data.url).toMatch(/#\/collections\?import=g\.[A-Za-z0-9_-]+$/);
    expect(data.title).toContain('Lager A');
    // Empfänger: öffnet den Link auf einem leeren Gerät
    await teardownUi(ui);
    ui = setupUi();
    const payload = /import=(.+)$/.exec(data.url ?? '')?.[1] ?? '';
    await openList(ui, { import: payload });
    await waitFor(() => document.querySelector('#imp-go') !== null);
    expect(text(document.body, '#imp-summary')).toBe('Geteilte Sammlung erkannt.');
    expect(text(document.body, '.dialog')).toContain('Lager A');
    expect(text(document.body, '#imp-expired')).toContain('1 Code(s) sind bereits abgelaufen');
    click(document.body, '#imp-go');
    await waitFor(() => document.querySelector('.dialog') === null);
    await waitFor(() => ui?.root.querySelector('.collection-row') !== null);
    const [col] = await ui.ctx.collections.listCollections();
    expect(col?.name).toBe('Lager A');
    expect((await ui.ctx.collections.listItems(col!.id)).map((i) => i.value)).toEqual([A, B, C]);
  });

  it('Link: ohne Teilen-Menü wird in die Zwischenablage kopiert; ohne Zwischenablage erscheint ein Dialog mit dem Link', async () => {
    ui = setupUi();
    const id = await seed(ui);
    const writeText = vi.fn(() => Promise.resolve());
    setNav('clipboard', { writeText });
    await openDetail(ui, id);
    click(ui.root, '#co-link');
    await waitFor(() => writeText.mock.calls.length > 0);
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain('#/collections?import=g.');
    setNav('clipboard', undefined);
    click(ui.root, '#co-link');
    await waitFor(() => document.querySelector('.dialog textarea') !== null);
    expect((document.querySelector('.dialog textarea') as HTMLTextAreaElement).value).toContain('#/collections?import=g.');
  });

  it('Text: kopiert die Liste; ohne Zwischenablage wird eine Textdatei heruntergeladen', async () => {
    ui = setupUi();
    const id = await seed(ui);
    const writeText = vi.fn(() => Promise.resolve());
    setNav('clipboard', { writeText });
    await openDetail(ui, id);
    click(ui.root, '#co-text');
    await waitFor(() => writeText.mock.calls.length > 0);
    expect((writeText.mock.calls[0] as unknown as [string])[0].split('\n')[0]).toBe('Lager A');
    setNav('clipboard', undefined);
    click(ui.root, '#co-text');
    await waitFor(() => downloads.length > 0);
    expect(downloads).toEqual(['Lager_A.txt']);
  });

  it('die Liste bietet „Teilen“ je Sammlung', async () => {
    ui = setupUi();
    await seed(ui);
    await openList(ui);
    click(ui.root, '[data-share]');
    await waitFor(() => downloads.length > 0);
    expect(downloads).toEqual(['Lager_A.barq.json']);
  });
});

describe('Import-Dialog', () => {
  it('Liste einfügen: Format wählen, prüfen, in neue Sammlung importieren', async () => {
    ui = setupUi();
    await openList(ui);
    click(ui.root, '#co-import');
    await waitFor(() => document.querySelector('#imp-text') !== null);
    setValue(document.body, '#imp-text', `${A}\n${B}\n`);
    click(document.body, '#imp-check');
    await waitFor(() => document.querySelector('#imp-go') !== null);
    expect(text(document.body, '#imp-summary')).toBe('Liste erkannt: 2 Zeile(n).');
    setValue(document.body, '#imp-name', 'Mein Import');
    click(document.body, '#imp-go');
    await waitFor(() => document.querySelector('.dialog') === null);
    await waitFor(() => text(ui?.root ?? document.body, '.collection-row').includes('Mein Import'));
    expect(text(ui.root, '.collection-row')).toContain('2 Position(en)');
  });

  it('Fehlerhafte Zeile: Abbruch ohne Import mit Zeilenangabe; „überspringen“ importiert den Rest', async () => {
    ui = setupUi();
    await openList(ui);
    click(ui.root, '#co-import');
    await waitFor(() => document.querySelector('#imp-text') !== null);
    setValue(document.body, '#imp-text', `${A}\n12345\n`);
    click(document.body, '#imp-check');
    await waitFor(() => document.querySelector('#imp-go') !== null);
    click(document.body, '#imp-go');
    await waitFor(() => document.querySelector('#imp-aborted') !== null);
    expect(text(document.body, '#imp-result')).toContain('Zeile 2');
    expect(await ui.ctx.collections.listCollections()).toEqual([]);
    setChecked(document.body, '#imp-skip', true);
    click(document.body, '#imp-go');
    await waitFor(() => document.querySelector('.dialog') === null);
    expect((await ui.ctx.collections.listCollections())).toHaveLength(1);
  });

  it('Datei wählen: geteilte Sammlung (.json) wird erkannt und importiert', async () => {
    ui = setupUi();
    const json = JSON.stringify(buildShareFile('Fremd', [], { exportedAt: '', appVersion: '' }, ));
    const file = JSON.parse(json) as { items: unknown[] };
    file.items.push({ symbology: 'EAN13', value: A, quantity: 2, label: 'Stift', expiresAt: '2026-01-01' });
    await openList(ui);
    click(ui.root, '#co-import');
    await waitFor(() => document.querySelector('#imp-file') !== null);
    chooseFiles(document.querySelector('#imp-file') as HTMLInputElement, [new File([JSON.stringify(file)], 'fremd.barq.json', { type: 'application/json' })]);
    click(document.body, '#imp-check');
    await waitFor(() => document.querySelector('#imp-go') !== null);
    expect(text(document.body, '.dialog')).toContain('Fremd');
    expect(text(document.body, '#imp-expired')).toContain('1 Code(s) sind bereits abgelaufen');
    click(document.body, '#imp-go');
    await waitFor(() => document.querySelector('.dialog') === null);
    const [c] = await ui.ctx.collections.listCollections();
    expect((await ui.ctx.collections.listItems(c!.id))[0]).toMatchObject({ value: A, quantity: 2, label: 'Stift', expiresAt: '2026-01-01', source: 'import' });
  });

  it('beschädigte Datei: verständliche Meldung im Dialog, nichts importiert', async () => {
    ui = setupUi();
    await openList(ui);
    click(ui.root, '#co-import');
    await waitFor(() => document.querySelector('#imp-file') !== null);
    chooseFiles(document.querySelector('#imp-file') as HTMLInputElement, [new File(['{"format":"barq-player-collection","schemaVersion":1,"collection":{"name":"X"},"items":[{"symbology":"EAN13","value":"123"}]}'], 'kaputt.json')]);
    click(document.body, '#imp-check');
    await waitFor(() => (document.querySelector('.dialog .field__error')?.textContent ?? '') !== '');
    expect(text(document.body, '.dialog .field__error')).toContain('Code 1');
    expect(await ui.ctx.collections.listCollections()).toEqual([]);
  });

  it('eingefügter App-Link wird entpackt', async () => {
    ui = setupUi();
    const file = buildShareFile('Per Link', [], { exportedAt: '', appVersion: '' });
    file.items.push({ symbology: 'EAN13', value: B, quantity: 1 });
    const payload = await encodeSharePayload(JSON.stringify(file));
    await openList(ui);
    click(ui.root, '#co-import');
    await waitFor(() => document.querySelector('#imp-text') !== null);
    setValue(document.body, '#imp-text', `Hier: https://beispiel.test/app/#/collections?import=${payload}`.replace('Hier: ', ''));
    click(document.body, '#imp-check');
    await waitFor(() => document.querySelector('#imp-go') !== null);
    expect(text(document.body, '.dialog')).toContain('Per Link');
  });

  it('leere Eingabe wird freundlich abgelehnt; Abbrechen schließt ohne Änderung', async () => {
    ui = setupUi();
    await openList(ui);
    click(ui.root, '#co-import');
    await waitFor(() => document.querySelector('#imp-check') !== null);
    click(document.body, '#imp-check');
    await waitFor(() => (document.querySelector('.dialog .field__error')?.textContent ?? '') !== '');
    expect(text(document.body, '.dialog .field__error')).toContain('Datei wählen oder Text einfügen');
    await answerDialog('Abbrechen');
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('ein beschädigter Link in der Adresse zeigt eine Meldung statt eines leeren Dialogs', async () => {
    ui = setupUi();
    await openList(ui, { import: 'g.kaputt' });
    await waitFor(() => ui?.ctx.logger.entries.some((e) => e.code === 'ERR_IMPORT_SCHEMA_INVALID') === true);
    expect(document.querySelector('.dialog')).toBeNull();
  });
});

describe('Backup-Erinnerung', () => {
  it('erscheint ohne bisherige Sicherung; „Jetzt sichern“ lädt herunter und merkt sich den Zeitpunkt', async () => {
    ui = setupUi();
    await seed(ui);
    await openList(ui);
    expect(text(ui.root, '#co-backup-reminder')).toContain('noch keine Sicherung');
    click(ui.root, '#co-backup-now');
    await waitFor(() => downloads.length > 0);
    expect(downloads[0]).toMatch(/^barqplayer-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await waitFor(() => ui?.root.querySelector('#co-backup-reminder') === null);
    expect(ui.ctx.settings.get().lastBackupAt).not.toBeNull();
  });

  it('erscheint nicht ohne Sammlungen und nicht bei frischer Sicherung', async () => {
    ui = setupUi();
    await openList(ui);
    expect(ui.root.querySelector('#co-backup-reminder')).toBeNull();
    await seed(ui);
    ui.ctx.settings.update({ lastBackupAt: ui.ctx.nowIso() });
    ui.unmount();
    await openList(ui);
    expect(ui.root.querySelector('#co-backup-reminder')).toBeNull();
  });

  it('erscheint, wenn die letzte Sicherung älter als 14 Tage ist', async () => {
    ui = setupUi();
    await seed(ui);
    ui.ctx.settings.update({ lastBackupAt: '2026-10-01T00:00:00.000Z' });
    await openList(ui);
    expect(text(ui.root, '#co-backup-reminder')).toContain('über 14 Tage alt');
  });
});

describe('Erfassen mit Zusatzangaben', () => {
  it('manuell eingegebene Codes erhalten die gemeinsamen Zusatzangaben; die Felder werden danach geleert', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('Eingang');
    ui.ctx.settings.update({ collectionId: c.id });
    ui.mount(mountScanner);
    await waitFor(() => (ui?.root.querySelector('#sc-collection') as HTMLSelectElement | null)?.value === c.id);
    setValue(ui.root, '#sc-man-text', `${A}\n${B}`);
    setValue(ui.root, '#sc-meta-purpose', 'Wareneingang');
    setValue(ui.root, '#sc-meta-tags', 'Neu, Frisch');
    setValue(ui.root, '#sc-meta-expires', '2027-02-01');
    click(ui.root, '#sc-man-check');
    await waitFor(() => ui?.root.querySelector('#sc-man-save') !== null);
    click(ui.root, '#sc-man-save');
    await waitFor(() => (ui?.root.querySelector('#sc-man-text') as HTMLTextAreaElement).value === '');
    const items = await ui.ctx.collections.listItems(c.id);
    expect(items).toHaveLength(2);
    for (const i of items) expect(i).toMatchObject({ purpose: 'Wareneingang', tags: ['Neu', 'Frisch'], expiresAt: '2027-02-01' });
    expect((ui.root.querySelector('#sc-meta-purpose') as HTMLInputElement).value).toBe('');
  });

  it('ein zu langer Nutzen verhindert das Speichern und meldet den Fehler; Eingaben bleiben erhalten', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('Eingang');
    ui.ctx.settings.update({ collectionId: c.id });
    ui.mount(mountScanner);
    await waitFor(() => (ui?.root.querySelector('#sc-collection') as HTMLSelectElement | null)?.value === c.id);
    setValue(ui.root, '#sc-man-text', A);
    setValue(ui.root, '#sc-meta-purpose', 'x'.repeat(101));
    click(ui.root, '#sc-man-check');
    await waitFor(() => ui?.root.querySelector('#sc-man-save') !== null);
    click(ui.root, '#sc-man-save');
    await waitFor(() => ui?.ctx.logger.entries.some((e) => e.code === 'ERR_SYNTAX_INVALID') === true);
    expect(await ui.ctx.collections.countItems(c.id)).toBe(0);
    expect((ui.root.querySelector('#sc-man-text') as HTMLTextAreaElement).value).toBe(A);
  });

  it('zuletzt erfasste Codes bieten „Details“ zum nachträglichen Ergänzen', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('Eingang');
    ui.ctx.settings.update({ collectionId: c.id });
    ui.mount(mountScanner);
    await waitFor(() => (ui?.root.querySelector('#sc-collection') as HTMLSelectElement | null)?.value === c.id);
    ui.decoder.frames.push({ codes: [{ symbology: 'EAN13', value: A, engine: 'native' }], rejected: [] });
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    (ui.root.querySelector('#sc-video') as HTMLVideoElement).dispatchEvent(new Event('loadeddata'));
    Object.defineProperty(ui.root.querySelector('#sc-video'), 'readyState', { value: 4, configurable: true });
    await waitFor(() => ui?.root.querySelector('.recent__details') !== null, 4000);
    click(ui.root, '.recent__details');
    await waitFor(() => document.querySelector('#ed-label') !== null);
    setValue(document.body, '#ed-label', 'Scan-Notiz');
    setValue(document.body, '#ed-expires', '2027-03-04');
    await answerDialog('Speichern');
    await waitFor(() => text(ui?.root ?? document.body, '.recent__qty').includes('Details gespeichert'));
    expect(text(ui.root, '.recent__qty')).toContain('bis 04.03.2027');
    expect((await ui.ctx.collections.listItems(c.id))[0]).toMatchObject({ label: 'Scan-Notiz', expiresAt: '2027-03-04' });
  });
});

describe('Fader und Einstellungen', () => {
  it('der Fader bietet „Abgelaufene Codes trotzdem abspielen“ und überspringt sie standardmäßig mit Hinweis', async () => {
    ui = setupUi();
    await seed(ui);
    ui.mount(mountPlayer, { name: 'player', params: {} });
    await waitFor(() => ui?.root.querySelector('#pl-start-btn') !== null && (ui?.root.querySelectorAll('#pl-profile option').length ?? 0) > 0);
    await flush(2);
    expect((ui.root.querySelector('#pl-include-expired') as HTMLInputElement).checked).toBe(false);
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('.player') !== null);
    expect(ui.ctx.playback.active?.prepared.entries.map((e) => e.value)).toEqual([B, C]);
    expect(ui.ctx.playback.active?.prepared.skippedExpired).toBe(1);
    expect(ui.ctx.notify.items.some((n) => n.message.includes('1 abgelaufene Position(en) werden übersprungen'))).toBe(true);
  });

  it('mit dem Schalter werden auch abgelaufene Codes abgespielt', async () => {
    ui = setupUi();
    await seed(ui);
    ui.mount(mountPlayer, { name: 'player', params: {} });
    await waitFor(() => ui?.root.querySelector('#pl-start-btn') !== null && (ui?.root.querySelectorAll('#pl-profile option').length ?? 0) > 0);
    await flush(2);
    setChecked(ui.root, '#pl-include-expired', true);
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('.player') !== null);
    expect(ui.ctx.playback.active?.prepared.entries).toHaveLength(3);
  });

  it('Einstellungen: Installationsknopf erscheint erst mit dem Browser-Ereignis; Backup-Info und Import-Knopf', async () => {
    ui = setupUi();
    ui.mount(mountSettings, { name: 'settings', params: {} });
    await flush(4);
    expect((ui.root.querySelector('#st-install') as HTMLElement).hidden).toBe(true);
    expect(text(ui.root, '#st-install-info')).toContain('App installieren');
    expect(text(ui.root, '#st-backup-info')).toContain('Noch keine Sicherung');
    const prompt = vi.fn(() => Promise.resolve());
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) }));
    await waitFor(() => (ui?.root.querySelector('#st-install') as HTMLElement).hidden === false);
    click(ui.root, '#st-install');
    await waitFor(() => prompt.mock.calls.length > 0);
    click(ui.root, '#st-backup');
    await waitFor(() => downloads.length > 0);
    await waitFor(() => text(ui?.root ?? document.body, '#st-backup-info').startsWith('Letzte Sicherung:'));
    click(ui.root, '#st-import');
    await waitFor(() => document.querySelector('#imp-text') !== null);
    await answerDialog('Abbrechen');
  });

  it('Backup senden: nutzt das Teilen-Menü, sonst Download; merkt sich nur echte Sicherungen', async () => {
    ui = setupUi();
    const share = vi.fn(() => Promise.resolve());
    setNav('share', share);
    setNav('canShare', (d: ShareData) => d.files?.[0]?.type === 'text/plain'); // wie Chrome Android: json nicht, txt schon
    ui.mount(mountSettings, { name: 'settings', params: {} });
    await flush(4);
    click(ui.root, '#st-backup-share');
    await waitFor(() => share.mock.calls.length > 0);
    expect(((share.mock.calls[0] as unknown as [ShareData])[0].files?.[0] as File).name).toMatch(/^barqplayer-backup-.*\.txt$/);
    await waitFor(() => ui?.ctx.settings.get().lastBackupAt !== null);
  });
});
