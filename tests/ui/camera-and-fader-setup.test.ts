// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/errors';
import { mountPlayer } from '../../src/ui/screens/player';
import { mountScanner } from '../../src/ui/screens/scanner';
import { answerDialog, click, code, flush, setChecked, setValue, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

const A = '4006381333931';
const B = '5901234123457';
const C = '9780201379624';

let ui: UiSetup | null = null;
afterEach(async () => {
  await teardownUi(ui);
  ui = null;
});

// ------------------------------------------------------------------------------------------------ Kamera

async function openScanner(u: UiSetup): Promise<string> {
  const c = await u.ctx.collections.createCollection('Eingang');
  u.ctx.settings.update({ collectionId: c.id });
  u.mount(mountScanner);
  await waitFor(() => (u.root.querySelector('#sc-collection') as HTMLSelectElement | null)?.value === c.id);
  return c.id;
}

async function startCamera(u: UiSetup): Promise<void> {
  click(u.root, '#sc-cam');
  await waitFor(() => u.camera.current !== null);
  await flush(3);
}

const num = (u: UiSetup, sel: string): number => Number((u.root.querySelector(sel) as HTMLInputElement).value);
const video = (u: UiSetup): HTMLVideoElement => u.root.querySelector('#sc-video') as HTMLVideoElement;

function pointer(target: Element, type: string, id: number, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, 'pointerId', { value: id });
  target.dispatchEvent(e);
}

describe('Kamera: Zoom', () => {
  it('vor dem Start ist der Zoom gesperrt und erklärt sich', async () => {
    ui = setupUi();
    await openScanner(ui);
    expect((ui.root.querySelector('#sc-zoom') as HTMLInputElement).disabled).toBe(true);
    expect(text(ui.root, '#sc-zoom-info')).toContain('Starten Sie die Kamera');
    expect(ui.root.querySelectorAll('#sc-zoom-presets button')).toHaveLength(0);
  });

  it('nach dem Start: Schieber im Kamerabereich, Voreinstellungen 1×–8×, Zoom per Voreinstellung', async () => {
    ui = setupUi();
    await openScanner(ui);
    await startCamera(ui);
    const slider = ui.root.querySelector('#sc-zoom') as HTMLInputElement;
    expect([slider.disabled, slider.min, slider.max]).toEqual([false, '1', '8']);
    expect([...ui.root.querySelectorAll('#sc-zoom-presets button')].map((b) => b.getAttribute('data-zoom'))).toEqual(['1', '2', '3', '5', '8']);
    expect(text(ui.root, '#sc-zoom-info')).toContain('hardware-zoom'.replace('hardware-zoom', 'Hardware-Zoom'));
    click(ui.root, '[data-zoom="3"]');
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 1);
    expect(ui.camera.setZoom).toHaveBeenCalledWith(3);
    await waitFor(() => text(ui?.root ?? document.body, '#sc-zoom-value') === '3×');
    expect(ui.ctx.settings.get().cameraZoom).toBe(3);
    expect(ui.root.querySelector('[data-zoom="3"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Schieber und −/+ Knöpfe stellen den Zoom ein, begrenzt auf den Bereich', async () => {
    ui = setupUi();
    await openScanner(ui);
    await startCamera(ui);
    setValue(ui.root, '#sc-zoom', '4');
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 1);
    expect(ui.camera.setZoom).toHaveBeenLastCalledWith(4);
    await waitFor(() => num(ui as UiSetup, '#sc-zoom') === 4);
    click(ui.root, '#sc-zoom-in');
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 2);
    expect((ui.camera.setZoom.mock.calls[1] as unknown as [number])[0]).toBeGreaterThan(4);
    for (let i = 0; i < 20; i++) {
      click(ui.root, '#sc-zoom-out');
      await flush(2);
    }
    await flush(4);
    expect(num(ui, '#sc-zoom')).toBe(1);
    expect(Math.min(...ui.camera.setZoom.mock.calls.map((c) => (c as unknown as [number])[0]))).toBeGreaterThanOrEqual(1);
  });

  it('schnelles Schieben überflutet die Kamera nicht: während einer Anfrage zählt nur der neueste Wunsch', async () => {
    ui = setupUi();
    await openScanner(ui);
    await startCamera(ui);
    let release: () => void = () => undefined;
    ui.camera.setZoom.mockImplementationOnce((v: number) => new Promise<number>((res) => (release = () => res(v))));
    setValue(ui.root, '#sc-zoom', '2');
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 1);
    for (const v of ['3', '4', '5']) setValue(ui.root, '#sc-zoom', v);
    expect(ui.camera.setZoom).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 2);
    expect(ui.camera.setZoom.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([2, 5]);
  });

  it('der gespeicherte Zoom wird beim nächsten Kamerastart wiederhergestellt', async () => {
    ui = setupUi();
    ui.ctx.settings.update({ cameraZoom: 2.5 });
    await openScanner(ui);
    await startCamera(ui);
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 1);
    expect(ui.camera.setZoom).toHaveBeenCalledWith(2.5);
  });

  it('Zwei-Finger-Geste zoomt; ein Finger nicht', async () => {
    ui = setupUi();
    await openScanner(ui);
    await startCamera(ui);
    const box = ui.root.querySelector('.camera') as HTMLElement;
    pointer(box, 'pointerdown', 1, 100, 100);
    pointer(box, 'pointermove', 1, 120, 100);
    await flush(2);
    expect(ui.camera.setZoom).not.toHaveBeenCalled();
    pointer(box, 'pointerdown', 2, 200, 100); // Abstand 100 → 80 beim Start (Finger 1 steht bei 120)
    pointer(box, 'pointermove', 2, 360, 100); // Abstand 240
    await waitFor(() => (ui?.camera.setZoom.mock.calls.length ?? 0) > 0);
    const last = (ui.camera.setZoom.mock.calls.at(-1) as unknown as [number])[0];
    expect(last).toBeGreaterThan(2);
    pointer(box, 'pointerup', 2, 360, 100);
    pointer(box, 'pointerup', 1, 120, 100);
  });

  it('Kamera ohne Hardware-Zoom: digitaler Zoom (Bildausschnitt), ehrlich beschriftet, ohne Hardware-Aufruf', async () => {
    ui = setupUi();
    ui.camera.zoomRange = null;
    await openScanner(ui);
    await startCamera(ui);
    expect((ui.root.querySelector('#sc-zoom') as HTMLInputElement).max).toBe('4');
    expect(text(ui.root, '#sc-zoom-info')).toContain('digital');
    click(ui.root, '[data-zoom="2"]');
    await waitFor(() => video(ui as UiSetup).style.transform === 'scale(2)');
    expect(ui.camera.setZoom).not.toHaveBeenCalled();
    click(ui.root, '[data-zoom="1"]');
    await waitFor(() => video(ui as UiSetup).style.transform === '');
  });

  it('Zoom-Fehler der Kamera erscheinen als Meldung, die Oberfläche bleibt bedienbar', async () => {
    ui = setupUi();
    await openScanner(ui);
    await startCamera(ui);
    ui.camera.setZoom.mockRejectedValueOnce(new AppError('ERR_CAMERA_UNSUPPORTED', { userMessage: 'Der Zoom konnte nicht eingestellt werden.' }));
    click(ui.root, '[data-zoom="2"]');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    click(ui.root, '[data-zoom="3"]');
    await waitFor(() => ui?.camera.setZoom.mock.calls.length === 2);
  });

  it('Kamera stoppen sperrt den Zoom wieder und setzt den digitalen Zoom zurück', async () => {
    ui = setupUi();
    ui.camera.zoomRange = null;
    await openScanner(ui);
    await startCamera(ui);
    click(ui.root, '[data-zoom="3"]');
    await waitFor(() => video(ui as UiSetup).style.transform === 'scale(3)');
    click(ui.root, '#sc-cam');
    expect((ui.root.querySelector('#sc-zoom') as HTMLInputElement).disabled).toBe(true);
    expect(video(ui).style.transform).toBe('');
  });
});

describe('Kamera: Auflösung, Fokus, Belichtung', () => {
  it('Standard „Hoch“ (1920×1080); die Kamera wird mit der gewählten Auflösung gestartet', async () => {
    ui = setupUi();
    await openScanner(ui);
    expect((ui.root.querySelector('#sc-res') as HTMLSelectElement).value).toBe('high');
    await startCamera(ui);
    expect(ui.camera.lastOptions).toEqual({ idealWidth: 1920, idealHeight: 1080 });
    expect(text(ui.root, '#sc-cam-status')).toContain('1280×720'); // tatsächliche Auflösung laut Kamera
  });

  it('Änderung der Auflösung wird gespeichert und startet eine laufende Kamera neu; ohne Kamera nur speichern', async () => {
    ui = setupUi();
    await openScanner(ui);
    setValue(ui.root, '#sc-res', 'standard');
    expect(ui.ctx.settings.get().cameraResolution).toBe('standard');
    expect(ui.camera.start).not.toHaveBeenCalled();
    await startCamera(ui);
    expect(ui.camera.lastOptions).toEqual({ idealWidth: 1280, idealHeight: 720 });
    setValue(ui.root, '#sc-res', 'max');
    await waitFor(() => ui?.camera.start.mock.calls.length === 2);
    expect(ui.camera.lastOptions).toEqual({ idealWidth: 3840, idealHeight: 2160 });
    expect(ui.camera.stop).toHaveBeenCalled();
    expect(ui.ctx.settings.get().cameraResolution).toBe('max');
  });

  it('Fokus: Regler nur bei Unterstützung; Modus wechseln, manuelle Entfernung, „Jetzt scharfstellen“', async () => {
    ui = setupUi();
    ui.camera.focusModes = [];
    await openScanner(ui);
    await startCamera(ui);
    expect((ui.root.querySelector('#sc-focus-box') as HTMLElement).hidden).toBe(true);
    click(ui.root, '#sc-cam'); // stoppen
    ui.camera.focusModes = ['continuous', 'single-shot', 'manual'];
    await startCamera(ui);
    expect((ui.root.querySelector('#sc-focus-box') as HTMLElement).hidden).toBe(false);
    expect([...ui.root.querySelectorAll('#sc-focus-mode option')].map((o) => (o as HTMLOptionElement).value)).toEqual(['continuous', 'single-shot', 'manual']);
    expect((ui.root.querySelector('#sc-focus-distance-field') as HTMLElement).hidden).toBe(true);
    setValue(ui.root, '#sc-focus-mode', 'single-shot');
    await waitFor(() => ui?.camera.setFocusMode.mock.calls.length === 1);
    expect(ui.camera.setFocusMode).toHaveBeenLastCalledWith('single-shot');
    setValue(ui.root, '#sc-focus-mode', 'manual');
    await waitFor(() => ui?.camera.setFocusDistance.mock.calls.length === 1);
    expect((ui.root.querySelector('#sc-focus-distance-field') as HTMLElement).hidden).toBe(false);
    setValue(ui.root, '#sc-focus-distance', '1.5');
    await waitFor(() => ui?.camera.setFocusDistance.mock.calls.length === 2);
    expect(ui.camera.setFocusDistance).toHaveBeenLastCalledWith(1.5);
    setValue(ui.root, '#sc-focus-mode', 'continuous');
    await waitFor(() => ui?.camera.setFocusMode.mock.calls.length === 2);
    ui.camera.setFocusMode.mockClear();
    click(ui.root, '#sc-focus-now');
    await waitFor(() => ui?.camera.setFocusMode.mock.calls.length === 2);
    expect(ui.camera.setFocusMode.mock.calls).toEqual([['single-shot'], ['continuous']]);
  });

  it('Belichtung: Regler nur bei Unterstützung, wirkt auf die Kamera', async () => {
    ui = setupUi();
    ui.camera.exposureRange = null;
    await openScanner(ui);
    await startCamera(ui);
    expect((ui.root.querySelector('#sc-exposure-box') as HTMLElement).hidden).toBe(true);
    click(ui.root, '#sc-cam');
    ui.camera.exposureRange = { min: -2, max: 2, step: 0.5 };
    await startCamera(ui);
    expect((ui.root.querySelector('#sc-exposure-box') as HTMLElement).hidden).toBe(false);
    setValue(ui.root, '#sc-exposure', '1');
    await waitFor(() => ui?.camera.setExposure.mock.calls.length === 1);
    expect(ui.camera.setExposure).toHaveBeenCalledWith(1);
    await waitFor(() => text(ui?.root ?? document.body, '#sc-exposure-value') === '1');
  });
});

describe('Kamera: Fotos für kleine Codes', () => {
  it('„Hochauflösendes Foto auswerten“ ist ohne Kamera gesperrt; mit Kamera wird das Foto ausgewertet und zur Auswahl angezeigt', async () => {
    ui = setupUi();
    const cid = await openScanner(ui);
    const btn = ui.root.querySelector('#sc-photo') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await startCamera(ui);
    expect(btn.disabled).toBe(false);
    ui.decoder.files = [{ fileName: 'kamera-foto.jpg', status: 'ok', codes: [code('EAN13', A), code('EAN13', B)], rejected: [] }];
    click(ui.root, '#sc-photo');
    await waitFor(() => ui?.root.querySelector('#sc-import-save') !== null);
    expect(ui.camera.takePhoto).toHaveBeenCalledOnce();
    expect(text(ui.root, '#sc-import-out')).toContain(A);
    expect(text(ui.root, '#sc-import-out')).toContain(B);
    expect(btn.disabled).toBe(false);
    click(ui.root, '#sc-import-save');
    await flush(8);
    expect(await ui.ctx.collections.countItems(cid)).toBe(2);
  });

  it('Aufnahmefehler werden gemeldet; ohne ImageCapture bleibt der Knopf gesperrt und die Kamera-App ist der Ausweg', async () => {
    ui = setupUi();
    await openScanner(ui);
    await startCamera(ui);
    ui.camera.takePhoto.mockRejectedValueOnce(new AppError('ERR_CAMERA_UNSUPPORTED', { userMessage: 'Das Foto konnte nicht aufgenommen werden.' }));
    click(ui.root, '#sc-photo');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect((ui.root.querySelector('#sc-photo') as HTMLButtonElement).disabled).toBe(false);
    click(ui.root, '#sc-cam');
    ui.camera.photoSupported = false;
    await startCamera(ui);
    expect((ui.root.querySelector('#sc-photo') as HTMLButtonElement).disabled).toBe(true);
    const native = ui.root.querySelector('#sc-native') as HTMLInputElement;
    expect([native.getAttribute('capture'), native.accept]).toEqual(['environment', 'image/*']);
    expect(text(ui.root, '#sc-native-label')).toBe('Mit Kamera-App fotografieren');
  });
});

// ------------------------------------------------------------------------------------------------ Fader: Auswahl und Zeiten

async function seedFader(u: UiSetup): Promise<string> {
  const c = await u.ctx.collections.createCollection('Schrauben');
  await u.ctx.collections.addItems(c.id, [
    { symbology: 'EAN13', value: A, source: 'manual', label: 'Schraube 2x3mm', tags: ['Firma XYZ'], quantity: 2 },
    { symbology: 'EAN13', value: B, source: 'manual', label: 'Mutter M3', tags: ['Firma XYZ', 'Maschine 2374'] },
    { symbology: 'EAN13', value: C, source: 'manual', label: 'Scheibe', tags: ['Firma ABC'] }
  ]);
  return c.id;
}

async function openFader(u: UiSetup): Promise<void> {
  u.mount(mountPlayer, { name: 'player', params: {} });
  await waitFor(() => u.root.querySelector('#pl-start-btn') !== null && u.root.querySelectorAll('#pl-profile option').length > 0 && u.root.querySelectorAll('#pl-items input').length > 0);
  await flush(2);
}

const checked = (u: UiSetup): string[] => [...u.root.querySelectorAll<HTMLInputElement>('#pl-items input[type=checkbox]')].filter((b) => b.checked).map((b) => b.closest('label')?.querySelector('.value')?.textContent ?? '');

describe('Fader: Welche Codes?', () => {
  it('standardmäßig sind alle Codes ausgewählt, mit Anzahl und Stückzahl', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    expect(checked(ui)).toEqual([A, B, C]);
    expect(text(ui.root, '#pl-sel-count')).toBe('3 von 3 Position(en) ausgewählt (4 Stück).');
    expect(text(ui.root, '#pl-items')).toContain('Schraube 2x3mm');
    expect(text(ui.root, '#pl-items')).toContain('×2');
  });

  it('einzelne Codes abwählen: nur die gewählten laufen (Reihenfolge der Sammlung bleibt)', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    (ui.root.querySelector('#pl-items input[type=checkbox]') as HTMLInputElement).click(); // A abwählen
    expect(text(ui.root, '#pl-sel-count')).toBe('2 von 3 Position(en) ausgewählt (2 Stück).');
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('.player') !== null);
    expect(ui.ctx.playback.active?.prepared.entries.map((e) => e.value)).toEqual([B, C]);
  });

  it('Filter nach Tag und Suche; „Nur die gefilterten“ wählt genau diese aus', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    expect([...ui.root.querySelectorAll('#pl-filter-tag option')].map((o) => o.textContent)).toEqual(['Alle Tags', '#Firma ABC', '#Firma XYZ', '#Maschine 2374']);
    setValue(ui.root, '#pl-filter-tag', 'Firma XYZ');
    expect(ui.root.querySelectorAll('#pl-items input')).toHaveLength(2);
    click(ui.root, '#pl-sel-visible');
    expect(checked(ui)).toEqual([A, B]);
    setValue(ui.root, '#pl-filter-text', 'maschine');
    expect(ui.root.querySelectorAll('#pl-items input')).toHaveLength(1);
    setValue(ui.root, '#pl-filter-text', 'gibt-es-nicht');
    expect(text(ui.root, '#pl-items')).toContain('Keine Position passt');
    setValue(ui.root, '#pl-filter-text', '');
    setValue(ui.root, '#pl-filter-tag', '');
    click(ui.root, '#pl-sel-none');
    expect(checked(ui)).toEqual([]);
    click(ui.root, '#pl-sel-all');
    expect(checked(ui)).toEqual([A, B, C]);
  });

  it('nichts ausgewählt: klare Meldung, kein Start', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    click(ui.root, '#pl-sel-none');
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('#pl-none-selected') !== null);
    expect(text(ui.root, '#pl-none-selected')).toContain('kein Code ausgewählt');
    expect(ui.ctx.playback.active).toBeNull();
    expect((ui.root.querySelector('#pl-start-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Wechsel der Sammlung lädt deren Codes und wählt wieder alle aus; abgelaufene sind markiert', async () => {
    ui = setupUi();
    await seedFader(ui);
    const other = await ui.ctx.collections.createCollection('Andere');
    await ui.ctx.collections.addItem(other.id, { symbology: 'EAN13', value: A, source: 'manual', expiresAt: '2020-01-01' });
    await openFader(ui);
    const select = ui.root.querySelector('#pl-collection') as HTMLSelectElement;
    setValue(ui.root, '#pl-collection', [...select.options].find((o) => o.textContent === 'Andere')?.value ?? '');
    await waitFor(() => ui?.root.querySelectorAll('#pl-items input').length === 1);
    expect(text(ui.root, '#pl-items')).toContain('abgelaufen');
    expect(checked(ui)).toEqual([A]);
  });

  it('die Kalibrierung zeigt keine Auswahl', async () => {
    ui = setupUi();
    await seedFader(ui);
    ui.mount(mountPlayer, { name: 'player', params: { calibration: '1' } });
    await waitFor(() => ui?.root.querySelector('#pl-start-btn') !== null && (ui?.root.querySelectorAll('#pl-profile option').length ?? 0) > 0);
    expect(ui.root.querySelector('#pl-pick')).toBeNull();
    expect(ui.root.querySelector('#pl-times')).toBeNull();
  });
});

describe('Fader: Zeiten für diesen Lauf', () => {
  it('sind aus dem Profil vorbelegt und folgen dem Profilwechsel', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    const v = (id: string): string => (ui?.root.querySelector(id) as HTMLInputElement).value;
    const normal = (await ui.ctx.collections.listProfiles()).find((p) => p.id === 'profile-normal');
    expect([v('#pl-display'), v('#pl-blank'), v('#pl-identical'), v('#pl-delay')]).toEqual([normal?.displayMs, normal?.blankMs, normal?.identicalBlankMs, normal?.startDelayMs].map(String));
    setValue(ui.root, '#pl-profile', 'profile-slow');
    const slow = (await ui.ctx.collections.listProfiles()).find((p) => p.id === 'profile-slow');
    expect(slow).toBeDefined();
    expect(v('#pl-display')).toBe(String(slow?.displayMs));
  });

  it('geänderte Zeiten gelten für den Lauf und stehen im Sitzungsprotokoll; das Profil selbst bleibt unverändert', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    setValue(ui.root, '#pl-display', '1200');
    setValue(ui.root, '#pl-blank', '300');
    setValue(ui.root, '#pl-identical', '700');
    setValue(ui.root, '#pl-delay', '4000');
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('.player') !== null);
    const request = ui.ctx.playback.active?.prepared.request;
    expect(request?.profile).toMatchObject({ displayMs: 1200, blankMs: 300, identicalBlankMs: 700, startDelayMs: 4000 });
    expect(ui.ctx.playback.active?.session.timing).toEqual({ displayMs: 1200, blankMs: 300, identicalBlankMs: 700, startDelayMs: 4000 });
    const stored = (await ui.ctx.collections.listProfiles()).find((p) => p.id === request?.profile.id);
    expect(stored?.displayMs).not.toBe(1200);
  });

  it('ungültige Zeiten (Leerzeit unter 20 ms) verhindern den Start mit verständlicher Meldung', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    setValue(ui.root, '#pl-blank', '5');
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error' && n.message.includes('Leerzeit')) === true);
    expect(ui.ctx.playback.active).toBeNull();
  });

  it('„Als neues Profil speichern“ legt ein Profil mit den eingestellten Zeiten an und wählt es aus', async () => {
    ui = setupUi();
    await seedFader(ui);
    await openFader(ui);
    setValue(ui.root, '#pl-display', '900');
    setValue(ui.root, '#pl-blank', '250');
    click(ui.root, '#pl-save-profile');
    await answerDialog('Speichern', 'Mein Kassentest');
    await waitFor(() => [...(ui?.root.querySelectorAll('#pl-profile option') ?? [])].some((o) => (o.textContent ?? '').startsWith('Mein Kassentest')));
    const saved = (await ui.ctx.collections.listProfiles()).find((p) => p.name === 'Mein Kassentest');
    expect(saved).toMatchObject({ displayMs: 900, blankMs: 250 });
    expect((ui.root.querySelector('#pl-profile') as HTMLSelectElement).value).toBe(saved?.id);
    expect((ui.root.querySelector('#pl-display') as HTMLInputElement).value).toBe('900');
  });

  it('Kombination: gewählte Codes + eigene Zeiten + Ablauf + Interleaving im selben Lauf', async () => {
    ui = setupUi();
    const id = await seedFader(ui);
    await ui.ctx.collections.addItem(id, { symbology: 'EAN13', value: '4006381333948', source: 'manual', expiresAt: '2020-01-01' });
    await openFader(ui);
    setValue(ui.root, '#pl-filter-tag', 'Firma XYZ');
    click(ui.root, '#pl-sel-visible');
    setChecked(ui.root, '#pl-interleave', true);
    setValue(ui.root, '#pl-display', '800');
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.root.querySelector('.player') !== null);
    const p = ui.ctx.playback.active?.prepared;
    expect(p?.entries.map((e) => e.value).sort()).toEqual([A, A, B].sort());
    expect(p?.request.profile.displayMs).toBe(800);
    expect(p?.request.interleave).toBe(true);
  });
});
