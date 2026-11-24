// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { mountScanner, SCAN_INTERVAL_MS } from '../../src/ui/screens/scanner';
import { answerDialog, chooseFiles, click, code, flush, setChecked, setValue, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';

let ui: UiSetup | null = null;
afterEach(async () => {
  await teardownUi(ui);
  ui = null;
});

async function open(u: UiSetup, withCollection = true): Promise<string> {
  let cid = '';
  if (withCollection) cid = (await u.ctx.collections.createCollection('Lager')).id;
  u.mount(mountScanner);
  await waitFor(() => u.root.querySelectorAll('#sc-collection option').length > 0);
  await flush(2);
  return cid;
}

describe('Sammlung wählen/anlegen', () => {
  it('listet Sammlungen; ohne Sammlung Platzhalter und Kamera gesperrt', async () => {
    ui = setupUi();
    await open(ui, false);
    expect(text(ui.root, '#sc-collection')).toContain('noch keine Sammlung');
    expect((ui.root.querySelector('#sc-cam') as HTMLButtonElement).disabled).toBe(true);
  });

  it('„Neu“ legt über den Dialog eine Sammlung an und wählt sie aus', async () => {
    ui = setupUi();
    await open(ui, false);
    click(ui.root, '#sc-new');
    await answerDialog('Anlegen', 'Wareneingang');
    await waitFor(() => (ui?.root.querySelector('#sc-collection') as HTMLSelectElement).value !== '');
    expect(text(ui.root, '#sc-collection')).toContain('Wareneingang');
    expect(ui.ctx.settings.get().collectionId).toBe((ui.root.querySelector('#sc-collection') as HTMLSelectElement).value);
    expect(ui.ctx.notify.items.some((n) => n.kind === 'success' && n.message.includes('Wareneingang'))).toBe(true);
  });

  it('Dialog-Validierung: leerer Name wird abgelehnt', async () => {
    ui = setupUi();
    await open(ui, false);
    click(ui.root, '#sc-new');
    await waitFor(() => document.querySelector('.dialog') !== null);
    (document.querySelector('.dialog .btn--primary') as HTMLElement).click();
    expect(text(document.body, '.dialog .field__error')).toBe('Bitte einen Namen eingeben.');
    await answerDialog('Abbrechen');
    expect(await ui.ctx.collections.listCollections()).toHaveLength(0);
  });
});

describe('Manuelle Eingabe und Liste', () => {
  async function typeAndCheck(u: UiSetup, lines: string, symbology = 'EAN13'): Promise<void> {
    setValue(u.root, '#sc-man-sym', symbology);
    setValue(u.root, '#sc-man-text', lines);
    click(u.root, '#sc-man-check');
  }

  it('Prüfen: gültige und fehlerhafte Zeilen getrennt, Fehler zeilengenau, nichts wird korrigiert', async () => {
    ui = setupUi();
    await open(ui);
    await typeAndCheck(ui, `${EAN_A}\n${EAN_B}\n4006381333930`);
    expect(text(ui.root, '#sc-man-summary')).toBe('2 gültig, 1 fehlerhaft.');
    expect(text(ui.root, '#sc-man-errors')).toContain('Zeile 3');
    expect(text(ui.root, '#sc-man-errors')).toContain('erwartet 1');
    expect(text(ui.root, '#sc-man-save')).toBe('Nur die 2 gültigen Zeilen speichern');
    expect(await ui.ctx.db.items.count()).toBe(0); // Prüfen speichert nichts
  });

  it('Speichern der gültigen Zeilen: erst nach erfolgreichem Schreiben „gespeichert“, Eingabe wird geleert', async () => {
    ui = setupUi();
    const cid = await open(ui);
    await typeAndCheck(ui, `${EAN_A}\n${EAN_A}\n${EAN_B}`);
    click(ui.root, '#sc-man-save');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    const items = await ui.ctx.collections.listItems(cid);
    expect(items.map((i) => [i.value, i.quantity, i.source])).toEqual([[EAN_A, 2, 'manual'], [EAN_B, 1, 'manual']]);
    expect((ui.root.querySelector('#sc-man-text') as HTMLTextAreaElement).value).toBe('');
    expect(ui.ctx.notify.items.find((n) => n.kind === 'success')?.message).toContain('3 Code(s) gespeichert (2 Position(en))');
  });

  it('Duplikate als eigene Positionen', async () => {
    ui = setupUi();
    const cid = await open(ui);
    setValue(ui.root, '#sc-man-dup', 'append');
    await typeAndCheck(ui, `${EAN_A}\n${EAN_A}`);
    click(ui.root, '#sc-man-save');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    expect(await ui.ctx.collections.listItems(cid)).toHaveLength(2);
  });

  it('ohne gültige Zeile ist Speichern gesperrt; QR-Zeilen bleiben unverändert', async () => {
    ui = setupUi();
    await open(ui);
    await typeAndCheck(ui, 'abc');
    expect((ui.root.querySelector('#sc-man-save') as HTMLButtonElement).disabled).toBe(true);
    await typeAndCheck(ui, ' https://example.org/a b ', 'QRCode');
    expect(text(ui.root, '#sc-man-summary')).toBe('1 gültig, 0 fehlerhaft.');
  });

  it('Speicherfehler: Fehlerbanner mit Code, KEINE Erfolgsmeldung, Eingabe bleibt erhalten', async () => {
    ui = setupUi();
    await open(ui);
    ui.ctx.db.items.bulkPut = (() => Promise.reject(new Error('voll'))) as unknown as typeof ui.ctx.db.items.bulkPut;
    await typeAndCheck(ui, EAN_A);
    click(ui.root, '#sc-man-save');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items.find((n) => n.kind === 'error')?.code).toBe('ERR_STORAGE_WRITE_FAILED');
    expect(ui.ctx.notify.items.some((n) => n.kind === 'success')).toBe(false);
    expect((ui.root.querySelector('#sc-man-text') as HTMLTextAreaElement).value).toBe(EAN_A);
  });

  it('zu viele Zeilen → Fehlerbanner', async () => {
    ui = setupUi();
    await open(ui);
    await typeAndCheck(ui, Array.from({ length: 10_001 }, () => EAN_A).join('\n'));
    expect(ui.ctx.notify.items.find((n) => n.kind === 'error')?.code).toBe('ERR_BULK_INPUT_INVALID');
  });
});

describe('Formate und Einstellungen', () => {
  it('Standard: EAN-13, EAN-8, QR, Code 128 an, UPC-A aus; Änderung wird gespeichert und Decoder neu aufgebaut', async () => {
    ui = setupUi();
    await open(ui);
    const checked = (f: string): boolean => (ui?.root.querySelector(`#sc-fmt-${f}`) as HTMLInputElement).checked;
    expect(['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'].map(checked)).toEqual([true, true, true, true, false]);
    const before = ui.ctx.getCapture();
    setChecked(ui.root, '#sc-fmt-UPCA', true);
    expect(ui.ctx.settings.get().formats).toEqual(['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA']);
    expect(ui.ctx.getCapture()).not.toBe(before);
  });

  it('mindestens ein Format bleibt freigegeben', async () => {
    ui = setupUi();
    await open(ui);
    for (const f of ['EAN13', 'EAN8', 'QRCode']) setChecked(ui.root, `#sc-fmt-${f}`, false);
    setChecked(ui.root, '#sc-fmt-Code128', false);
    expect(ui.ctx.settings.get().formats).toEqual(['Code128']);
    expect((ui.root.querySelector('#sc-fmt-Code128') as HTMLInputElement).checked).toBe(true);
    expect(ui.ctx.notify.items.some((n) => n.message.includes('Mindestens ein Format'))).toBe(true);
  });

  it('„nur eindeutige Codes“ wird gespeichert', async () => {
    ui = setupUi();
    await open(ui);
    setChecked(ui.root, '#sc-unique', true);
    expect(ui.ctx.settings.get().uniqueOnly).toBe(true);
  });
});

describe('Kamera', () => {
  it('Start entsperrt Audio (Nutzeraktion), startet Kamera, erfasst Codes, bestätigt erst nach Speichern; Stopp beendet alles', async () => {
    ui = setupUi();
    const cid = await open(ui);
    ui.decoder.frames.push({ codes: [code('EAN13', EAN_A)], rejected: [] });
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    expect(text(ui.root, '#sc-cam')).toBe('Kamera stoppen');
    expect(text(ui.root, '#sc-cam-status')).toContain('Kamera läuft');
    (ui.root.querySelector('#sc-video') as HTMLVideoElement).dispatchEvent(new Event('loadeddata'));
    Object.defineProperty(ui.root.querySelector('#sc-video'), 'readyState', { value: 4, configurable: true });
    await waitFor(() => ui?.root.querySelectorAll('#sc-recent li').length === 1, SCAN_INTERVAL_MS * 6);
    expect(text(ui.root, '#sc-recent')).toContain(EAN_A);
    expect(text(ui.root, '#sc-recent')).toContain('neu gespeichert');
    expect((await ui.ctx.collections.listItems(cid))[0]?.source).toBe('camera');
    click(ui.root, '#sc-cam');
    expect(ui.camera.stop).toHaveBeenCalled();
    expect(text(ui.root, '#sc-cam')).toBe('Kamera starten');
    expect((ui.root.querySelector('#sc-torch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Kamerafehler (Berechtigung verweigert) → verständliche Meldung, Kamera bleibt aus', async () => {
    ui = setupUi();
    await open(ui);
    ui.camera.startError = new AppError('ERR_CAMERA_PERMISSION_DENIED');
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    const n = ui.ctx.notify.items.find((x) => x.kind === 'error');
    expect(n?.code).toBe('ERR_CAMERA_PERMISSION_DENIED');
    expect(n?.hint).toContain('Foto-Import');
    expect(text(ui.root, '#sc-cam')).toBe('Kamera starten');
    expect(ui.camera.current).toBeNull();
  });

  it('Taschenlampe: nur bei Unterstützung aktiv, schaltet um', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    const torch = ui.root.querySelector('#sc-torch') as HTMLButtonElement;
    expect(torch.disabled).toBe(false);
    torch.click();
    await waitFor(() => torch.getAttribute('aria-pressed') === 'true');
    expect(ui.camera.setTorch).toHaveBeenLastCalledWith(true);
    click(ui.root, '#sc-cam'); // stoppen
    ui.camera.torchSupported = false;
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    expect((ui.root.querySelector('#sc-torch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Kamera wechseln startet neu; Fehler beim Wechsel stoppt sauber', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    click(ui.root, '#sc-switch');
    await waitFor(() => (ui?.camera.switchCamera.mock.calls.length ?? 0) === 1);
    ui.camera.switchCamera.mockRejectedValueOnce(new AppError('ERR_CAMERA_NOT_FOUND'));
    click(ui.root, '#sc-switch');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.camera.current).toBeNull();
  });

  it('Verlassen des Screens stoppt die Kamera', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    ui.unmount();
    expect(ui.camera.current).toBeNull();
  });

  it('Seite im Hintergrund → Kamera wird gestoppt', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(ui.camera.current).toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('Erfassungsfehler (Speichern) erscheinen als Banner, Erfolgsliste bleibt leer', async () => {
    ui = setupUi();
    await open(ui);
    ui.ctx.db.items.bulkPut = (() => Promise.reject(new Error('voll'))) as unknown as typeof ui.ctx.db.items.bulkPut;
    ui.decoder.frames.push({ codes: [code('EAN13', EAN_A)], rejected: [] });
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    Object.defineProperty(ui.root.querySelector('#sc-video'), 'readyState', { value: 4, configurable: true });
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true, SCAN_INTERVAL_MS * 6);
    expect(ui.root.querySelectorAll('#sc-recent li')).toHaveLength(0);
  });

  it('riskanter QR-Inhalt wird gemeldet, aber nie geöffnet', async () => {
    ui = setupUi();
    await open(ui);
    ui.decoder.frames.push({ codes: [code('QRCode', 'javascript:alert(1)')], rejected: [] });
    click(ui.root, '#sc-cam');
    await waitFor(() => ui?.camera.current !== null);
    Object.defineProperty(ui.root.querySelector('#sc-video'), 'readyState', { value: 4, configurable: true });
    await waitFor(() => ui?.root.querySelectorAll('#sc-recent li').length === 1, SCAN_INTERVAL_MS * 6);
    expect(ui.ctx.notify.items.some((n) => n.message.includes('gefährliches Link-Schema'))).toBe(true);
    expect(ui.root.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('Foto-Import', () => {
  const fileInput = (u: UiSetup): HTMLInputElement => u.root.querySelector('#sc-files') as HTMLInputElement;
  const png = (name: string): File => new File([new Uint8Array(4)], name, { type: 'image/png' });

  it('zeigt je Datei Codes zur Auswahl, meldet „kein Code“ und „nicht lesbar“; speichert nur Ausgewähltes (Quelle image, Dateiname als Bezeichnung)', async () => {
    ui = setupUi();
    const cid = await open(ui);
    ui.decoder.files = [
      { fileName: 'a.png', status: 'ok', codes: [code('EAN13', EAN_A), code('QRCode', 'https://example.org')], rejected: [{ format: 'ean_13', reason: 'invalid-value', message: 'x' }] },
      { fileName: 'b.png', status: 'no-codes', codes: [], rejected: [] },
      { fileName: 'c.png', status: 'error', codes: [], rejected: [], error: new AppError('ERR_DECODE_FAILED') }
    ];
    chooseFiles(fileInput(ui), [png('a.png'), png('b.png'), png('c.png')]);
    await waitFor(() => ui?.root.querySelector('#sc-import-save') !== null);
    const out = text(ui.root, '#sc-import-out');
    expect(out).toContain('Kein Code erkannt.');
    expect(out).toContain('Nicht lesbar');
    expect(out).toContain('1 Erkennung(en) verworfen');
    expect(out).toContain('Link – wird nie automatisch geöffnet.');
    // QR abwählen, nur EAN speichern
    const boxes = ui.root.querySelectorAll<HTMLInputElement>('.import-codes input');
    expect(boxes).toHaveLength(2);
    boxes[1]!.checked = false;
    click(ui.root, '#sc-import-save');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    const items = await ui.ctx.collections.listItems(cid);
    expect(items.map((i) => [i.value, i.source, i.label])).toEqual([[EAN_A, 'image', 'a.png']]);
    expect(ui.root.querySelector('#sc-import-save')).toBeNull();
  });

  it('Decoder-/WASM-Fehler beim Import → Fehlerbanner', async () => {
    ui = setupUi();
    await open(ui);
    ui.decoder.scanFiles.mockRejectedValueOnce(new AppError('ERR_WASM_LOAD_FAILED'));
    chooseFiles(fileInput(ui), [png('a.png')]);
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items.find((n) => n.kind === 'error')?.code).toBe('ERR_WASM_LOAD_FAILED');
    expect(ui.root.querySelector('#sc-import-save')).toBeNull();
  });

  it('Speichern fehlgeschlagen: Fehlerbanner, Auswahl bleibt, kein Erfolg', async () => {
    ui = setupUi();
    await open(ui);
    ui.decoder.files = [{ fileName: 'a.png', status: 'ok', codes: [code('EAN13', EAN_A)], rejected: [] }];
    chooseFiles(fileInput(ui), [png('a.png')]);
    await waitFor(() => ui?.root.querySelector('#sc-import-save') !== null);
    ui.ctx.db.items.bulkPut = (() => Promise.reject(new Error('voll'))) as unknown as typeof ui.ctx.db.items.bulkPut;
    click(ui.root, '#sc-import-save');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items.some((n) => n.kind === 'success')).toBe(false);
    expect((ui.root.querySelector('#sc-import-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ohne Datei passiert nichts', async () => {
    ui = setupUi();
    await open(ui);
    chooseFiles(fileInput(ui), []);
    await flush(2);
    expect(ui.decoder.scanFiles).not.toHaveBeenCalled();
  });
});
