// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { formatBytes, mountSettings } from '../../src/ui/screens/settings';
import { answerDialog, chooseFiles, click, flush, setChecked, setValue, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

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

async function open(u: UiSetup): Promise<void> {
  u.mount(mountSettings, { name: 'settings', params: {} });
  await waitFor(() => u.root.querySelectorAll('#st-profiles li').length > 0);
}

const csvFile = (name: string, content: string): File => new File([content], name, { type: 'text/csv' });
const profileNames = (u: UiSetup): string[] => [...u.root.querySelectorAll('#st-profiles li strong')].map((e) => e.textContent ?? '');

describe('formatBytes', () => {
  it('formatiert Größen', () => {
    expect(formatBytes(null)).toBe('unbekannt');
    expect(formatBytes(Number.NaN)).toBe('unbekannt');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });
});

describe('Profile', () => {
  it('zeigt die Standardprofile mit Zeiten und dem Hinweis „Teststartpunkte“', async () => {
    ui = setupUi();
    await open(ui);
    expect(profileNames(ui)).toEqual(['Langsam', 'Identische Codes', 'Normaltest', 'Schnelltest']);
    expect(text(ui.root, '[data-profile="profile-normal"]')).toContain('Anzeige 500 ms');
    expect(text(ui.root, '#st-prof-title + p')).toContain('Teststartpunkte');
  });

  it('bearbeiten und speichern', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '[data-edit="profile-fast"]');
    setValue(ui.root, '#pf-display', '350');
    click(ui.root, '#pf-save');
    await waitFor(() => text(ui?.root ?? document.body, '[data-profile="profile-fast"]').includes('Anzeige 350 ms'));
    expect(ui.ctx.notify.items.some((n) => n.kind === 'success')).toBe(true);
  });

  it('ungültige Werte (Leerzeit < 20 ms) werden im Formular erklärt und nicht gespeichert', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#st-profile-new');
    setValue(ui.root, '#pf-name', 'Zu schnell');
    setValue(ui.root, '#pf-blank', '5');
    click(ui.root, '#pf-save');
    await waitFor(() => text(ui?.root ?? document.body, '#pf-error') !== '');
    expect(text(ui.root, '#pf-error')).toContain('≥ 20');
    expect(profileNames(ui)).not.toContain('Zu schnell');
  });

  it('neues Profil anlegen und löschen (mit Bestätigung)', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#st-profile-new');
    setValue(ui.root, '#pf-name', 'Kasse 2');
    click(ui.root, '#pf-save');
    await waitFor(() => profileNames(ui!).includes('Kasse 2'));
    const row = [...ui.root.querySelectorAll('#st-profiles li')].find((li) => li.querySelector('strong')?.textContent === 'Kasse 2');
    const id = row?.querySelector('[data-delete]')?.getAttribute('data-delete');
    expect(id).toBeTruthy();
    click(ui.root, `[data-delete="${id}"]`);
    await answerDialog('Löschen');
    await waitFor(() => !profileNames(ui!).includes('Kasse 2'));
  });

  it('Name fehlt → Fehlermeldung', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#st-profile-new');
    click(ui.root, '#pf-save');
    await waitFor(() => text(ui?.root ?? document.body, '#pf-error') !== '');
    expect(text(ui.root, '#pf-error')).toContain('Profilname');
  });
});

describe('Kalibrierung', () => {
  it('Start navigiert zum Fader im Kalibriermodus', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#st-calibrate');
    expect(window.location.hash).toBe('#/player?calibration=1');
  });
});

describe('Artikelstamm-Import', () => {
  const input = (u: UiSetup): HTMLInputElement => u.root.querySelector('#st-catalog-file') as HTMLInputElement;

  it('importiert, zeigt Anzahl, Hinweis zur Aussagekraft', async () => {
    ui = setupUi();
    await open(ui);
    expect(text(ui.root, '#st-catalog-info')).toBe('Kein Artikelstamm importiert.');
    chooseFiles(input(ui), [csvFile('stamm.csv', `EAN;Aktiv;Bezeichnung\n${EAN_A};ja;Stift\n${EAN_B};nein;Block\n`)]);
    await waitFor(() => text(ui?.root ?? document.body, '#st-catalog-out-summary').includes('importiert'));
    expect(text(ui.root, '#st-catalog-out-summary')).toBe('2 Artikel importiert.');
    await waitFor(() => text(ui?.root ?? document.body, '#st-catalog-info').includes('2 Artikel'));
    expect(text(ui.root, '#st-cat-title + p + p')).toContain('importierten Stand');
  });

  it('Fehler: standardmäßig Abbruch mit Fehlerbericht, nichts importiert', async () => {
    ui = setupUi();
    await open(ui);
    chooseFiles(input(ui), [csvFile('stamm.csv', `EAN,Aktiv\n${EAN_A},ja\n${EAN_A},ja\n,ja\n`)]);
    await waitFor(() => text(ui?.root ?? document.body, '#st-catalog-out-summary').includes('abgebrochen'));
    expect(text(ui.root, '#st-catalog-out .errors')).toContain('Zeile 3');
    expect(text(ui.root, '#st-catalog-out .errors')).toContain('Zeile 4');
    expect(await ui.ctx.collections.catalogSize()).toBe(0);
  });

  it('„Fehlerhafte Zeilen überspringen“ importiert den Rest', async () => {
    ui = setupUi();
    await open(ui);
    setChecked(ui.root, '#st-catalog-skip', true);
    chooseFiles(input(ui), [csvFile('stamm.csv', `EAN,Aktiv\n${EAN_A},ja\n${EAN_A},ja\n${EAN_B},nein\n`)]);
    await waitFor(() => text(ui?.root ?? document.body, '#st-catalog-out-summary').includes('importiert'));
    expect(text(ui.root, '#st-catalog-out-summary')).toContain('2 Artikel importiert, 1 fehlerhafte');
    expect(await ui.ctx.collections.catalogSize()).toBe(2);
  });

  it('strukturell unbrauchbare Datei → Fehlerbanner', async () => {
    ui = setupUi();
    await open(ui);
    chooseFiles(input(ui), [csvFile('x.csv', 'foo,bar\n1,2\n')]);
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items[0]?.code).toBe('ERR_IMPORT_CSV_INVALID');
  });
});

describe('Speicher', () => {
  it('zeigt Persistenzstatus und Belegung', async () => {
    ui = setupUi({ storageManager: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true), estimate: () => Promise.resolve({ usage: 2048, quota: 5 * 1024 * 1024 }) } });
    await open(ui);
    click(ui.root, '#st-storage-btn');
    await waitFor(() => ui?.root.querySelector('#st-storage-status') !== null);
    expect(text(ui.root, '#st-storage-status')).toContain('aktiv');
    expect(text(ui.root, '#st-storage-usage')).toBe('Belegt: 2.0 KB von 5.0 MB');
  });

  it('nicht gewährt: Warnung mit Backup-Empfehlung; nicht unterstützt: klare Aussage', async () => {
    ui = setupUi({ storageManager: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) } });
    await open(ui);
    click(ui.root, '#st-storage-btn');
    await waitFor(() => ui?.root.querySelector('#st-storage-status') !== null);
    expect(text(ui.root, '#st-storage-status')).toContain('nicht gewährt');
    expect(text(ui.root, '#st-storage-status')).toContain('Backup');
    await teardownUi(ui);
    ui = setupUi();
    await open(ui);
    click(ui.root, '#st-storage-btn');
    await waitFor(() => ui?.root.querySelector('#st-storage-status') !== null);
    expect(text(ui.root, '#st-storage-status')).toContain('keine Speicherverwaltung');
  });
});

describe('Backup und Restore', () => {
  const file = (u: UiSetup): HTMLInputElement => u.root.querySelector('#st-restore-file') as HTMLInputElement;

  async function seed(u: UiSetup): Promise<string> {
    const c = await u.ctx.collections.createCollection('Original');
    await u.ctx.collections.addItem(c.id, { symbology: 'EAN13', value: EAN_A, source: 'manual' });
    return c.id;
  }

  it('Download als JSON mit Datum im Dateinamen', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#st-backup');
    await waitFor(() => downloads.length === 1);
    expect(downloads[0]?.name).toMatch(/^barqplayer-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads[0]?.type).toBe('application/json');
  });

  it('Restore: nach Bestätigung werden alle Daten ersetzt; Zusammenfassung wird angezeigt', async () => {
    ui = setupUi();
    await seed(ui);
    const json = await ui.ctx.backup.exportJson();
    await ui.ctx.collections.createCollection('Später dazugekommen');
    await open(ui);
    chooseFiles(file(ui), [new File([json], 'b.json', { type: 'application/json' })]);
    await waitFor(() => document.querySelector('.dialog') !== null);
    expect(text(document.body, '.dialog')).toContain('ersetzt');
    await answerDialog('Wiederherstellen');
    await waitFor(() => text(ui?.root ?? document.body, '#st-restore-summary').includes('Wiederhergestellt'));
    expect(text(ui.root, '#st-restore-summary')).toContain('1 Sammlung(en), 1 Position(en)');
    expect((await ui.ctx.collections.listCollections()).map((c) => c.name)).toEqual(['Original']);
  });

  it('Abbruch im Dialog ändert nichts', async () => {
    ui = setupUi();
    await seed(ui);
    const json = await ui.ctx.backup.exportJson();
    await ui.ctx.collections.createCollection('Zusatz');
    await open(ui);
    chooseFiles(file(ui), [new File([json], 'b.json')]);
    await answerDialog('Abbrechen');
    await flush(4);
    expect(await ui.ctx.collections.listCollections()).toHaveLength(2);
  });

  it('ungültige Datei: Fehlerbanner mit Pfad, vorhandene Daten bleiben unverändert', async () => {
    ui = setupUi();
    await seed(ui);
    await open(ui);
    const bad = JSON.stringify({ format: 'barq-player-backup', schemaVersion: 1, exportedAt: 't', appVersion: 'v', data: { collections: [], items: [{ id: 'x' }], templates: [], profiles: [], catalog: [], sessions: [], events: [] } });
    chooseFiles(file(ui), [new File([bad], 'kaputt.json')]);
    await answerDialog('Wiederherstellen');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    const n = ui.ctx.notify.items.find((x) => x.kind === 'error');
    expect(n?.code).toBe('ERR_IMPORT_SCHEMA_INVALID');
    expect(n?.message).toContain('data.items[0]');
    expect((await ui.ctx.collections.listCollections()).map((c) => c.name)).toEqual(['Original']);
  });

  it('kein JSON → Fehlerbanner', async () => {
    ui = setupUi();
    await open(ui);
    chooseFiles(file(ui), [new File(['das ist kein json'], 'x.json')]);
    await answerDialog('Wiederherstellen');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items[0]?.code).toBe('ERR_IMPORT_SCHEMA_INVALID');
  });
});

describe('Rückmeldung und Diagnose', () => {
  it('Schalter für Ton und Vibration werden gespeichert und wirken auf den Adapter', async () => {
    ui = setupUi();
    await open(ui);
    setChecked(ui.root, '#st-sound', false);
    expect(ui.ctx.settings.get().sound).toBe(false);
    expect(ui.ctx.feedback.settings).toEqual({ sound: false, vibration: true });
    setChecked(ui.root, '#st-vibration', false);
    expect(ui.ctx.feedback.settings).toEqual({ sound: false, vibration: false });
  });

  it('Diagnose-Log zeigt Fehler live (ohne Barcode-Inhalte) und lässt sich leeren; Decoder-Info und Version sichtbar', async () => {
    ui = setupUi();
    await open(ui);
    expect(text(ui.root, '#st-log-empty')).toBe('Keine Einträge.');
    ui.ctx.notify.error(new AppError('ERR_DECODE_FAILED', { details: `Wert ${EAN_A}` }), { source: 'test', value: EAN_A });
    await waitFor(() => ui?.root.querySelector('#st-log-list') !== null);
    const log = text(ui.root, '#st-log-list');
    expect(log).toContain('ERR_DECODE_FAILED');
    expect(log).toContain('source=test');
    expect(log).not.toContain(EAN_A);
    expect(text(ui.root, '#st-decoder')).toContain('Decoder: wasm');
    expect(text(ui.root, '#st-diag-title + p')).toContain(ui.ctx.appVersion);
    click(ui.root, '#st-log-clear');
    expect(ui.root.querySelector('#st-log-empty')).not.toBeNull();
  });
});
