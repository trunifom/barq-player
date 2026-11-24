// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isValidGtin } from '../../src/domain/checksum';
import { mountGenerator, PRESET } from '../../src/ui/screens/generator';
import { answerDialog, click, flush, setValue, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

/** Unabhängige Referenz der EAN-13-Prüfziffer. */
function ref13(body12: string): string {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
}

let ui: UiSetup | null = null;
afterEach(async () => {
  await teardownUi(ui);
  ui = null;
});

async function open(u: UiSetup, withCollection = false): Promise<string> {
  let cid = '';
  if (withCollection) cid = (await u.ctx.collections.createCollection('Ziel')).id;
  u.mount(mountGenerator);
  await flush(4);
  return cid;
}

const input = (u: UiSetup, sel: string): HTMLInputElement => u.root.querySelector(sel) as HTMLInputElement;

describe('Einzelcode', () => {
  it('EAN-13: gültiger Code wird als SVG gezeigt (schwarz auf weiß, crispEdges)', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#g-value', '4006381333931');
    const svg = ui.root.querySelector('#g-preview svg');
    expect(svg?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg?.getAttribute('aria-label')).toBe('EAN-13 4006381333931');
    expect(text(ui.root, '#g-error')).toBe('');
    expect(ui.root.querySelector('#g-preview')?.classList.contains('barcode-stage')).toBe(true);
  });

  it('falsche Prüfziffer wird gemeldet, nicht korrigiert; keine Vorschau, Hinzufügen gesperrt', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#g-value', '4006381333930');
    expect(text(ui.root, '#g-error')).toContain('erwartet 1');
    expect(input(ui, '#g-value').value).toBe('4006381333930');
    expect(ui.root.querySelector('#g-preview svg')).toBeNull();
    expect((ui.root.querySelector('#g-add') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Prüfziffer wird NUR auf ausdrücklichen Klick berechnet (12 Ziffern → 13)', async () => {
    ui = setupUi();
    await open(ui);
    const check = ui.root.querySelector('#g-check') as HTMLButtonElement;
    setValue(ui.root, '#g-value', '400638133393');
    expect(check.hidden).toBe(false);
    expect(input(ui, '#g-value').value).toBe('400638133393'); // keine stille Ergänzung
    expect(text(ui.root, '#g-error')).toContain('13 Ziffern');
    check.click();
    expect(input(ui, '#g-value').value).toBe('4006381333931');
    expect(ui.root.querySelector('#g-preview svg')).not.toBeNull();
    expect(check.hidden).toBe(true);
  });

  it('EAN-8, Code 128 und QR (inkl. Fehlerkorrektur-Auswahl, mehrzeiliger Text)', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#g-sym', 'EAN8');
    setValue(ui.root, '#g-value', '73513537');
    expect(ui.root.querySelector('#g-preview svg')?.getAttribute('aria-label')).toBe('EAN-8 73513537');
    setValue(ui.root, '#g-sym', 'Code128');
    setValue(ui.root, '#g-value', 'LOT-001 AB');
    expect(ui.root.querySelector('#g-preview svg')?.getAttribute('aria-label')).toBe('Code 128 LOT-001 AB');
    setValue(ui.root, '#g-sym', 'QRCode');
    expect((ui.root.querySelector('#g-ecc') as HTMLElement).parentElement?.hasAttribute('hidden')).toBe(false);
    setValue(ui.root, '#g-value', 'Zeile 1\nZeile 2');
    setValue(ui.root, '#g-ecc', 'H');
    expect(ui.root.querySelector('#g-preview svg')?.getAttribute('aria-label')).toContain('QR-Code');
    setValue(ui.root, '#g-value', 'a'.repeat(1500));
    expect(text(ui.root, '#g-error')).toContain('Fehlerkorrektur'); // zu lang für Stufe H
    setValue(ui.root, '#g-ecc', 'L');
    expect(text(ui.root, '#g-error')).toBe('');
  });

  it('QR-/Code-128-Felder: ECC nur bei QR sichtbar', async () => {
    ui = setupUi();
    await open(ui);
    expect((ui.root.querySelector('#g-ecc') as HTMLElement).parentElement?.hasAttribute('hidden')).toBe(true);
  });

  it('Zur Sammlung hinzufügen (Menge steigt bei Wiederholung); ohne Sammlung Hinweis', async () => {
    ui = setupUi();
    const cid = await open(ui, true);
    setValue(ui.root, '#g-value', '4006381333931');
    click(ui.root, '#g-add');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    click(ui.root, '#g-add');
    await waitFor(() => ui?.ctx.notify.items.filter((n) => n.kind === 'success').length === 2);
    expect((await ui.ctx.collections.listItems(cid))[0]).toMatchObject({ value: '4006381333931', quantity: 2, source: 'manual' });
  });

  it('Hinzufügen ohne Sammlung: Hinweis statt Fehler', async () => {
    ui = setupUi();
    await open(ui, false);
    setValue(ui.root, '#g-value', '4006381333931');
    click(ui.root, '#g-add');
    expect(ui.ctx.notify.items.some((n) => n.message.includes('Sammlung'))).toBe(true);
  });
});

describe('Zahlenreihe', () => {
  it('Startzustand ist das Beispiel 2 063701 028{XX}{C}, +12: 9 gültige Codes mit korrekter Prüfziffer', async () => {
    ui = setupUi();
    await open(ui);
    expect(input(ui, '#q-pattern').value).toBe(PRESET.pattern);
    expect(text(ui.root, '#q-status')).toContain('9 Code(s)');
    expect(text(ui.root, '#q-first')).toBe(`2063701028${'00'}${ref13('206370102800')}`);
    expect(text(ui.root, '#q-last')).toBe(`2063701028${'96'}${ref13('206370102896')}`);
    expect(isValidGtin(text(ui.root, '#q-first'), 'EAN13')).toBe(true);
    expect(text(ui.root, '#q-samples')).toContain(`2063701028${'12'}${ref13('206370102812')}`);
    expect(ui.root.querySelector('#q-preview svg')?.getAttribute('aria-label')).toBe(`EAN-13 ${text(ui.root, '#q-first')}`);
    for (const id of ['#q-save-template', '#q-save-new', '#q-add']) expect((ui?.root.querySelector(id) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Überlauf (Endwert 100 im 2-stelligen Feld): feldgenaue Fehlermeldung, nichts wird erzeugt, Speichern gesperrt', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-end', '100');
    expect(text(ui.root, '#q-status')).toContain('nichts erzeugt');
    const issue = ui.root.querySelector('#q-issues [data-code="ERR_SEQUENCE_OVERFLOW"]');
    expect(issue?.getAttribute('data-field')).toBe('end');
    expect(issue?.textContent).toContain('Endwert');
    expect(issue?.textContent).toContain('nie abgeschnitten');
    expect(issue?.getAttribute('role')).toBe('alert');
    for (const id of ['#q-save-template', '#q-save-new', '#q-add']) expect((ui?.root.querySelector(id) as HTMLButtonElement).disabled).toBe(true);
    expect(ui.root.querySelector('#q-preview svg')).toBeNull();
  });

  it('Anzahl statt Endwert: 9 Positionen ergeben Endwert 96; 10 Positionen laufen über', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-count', '9');
    expect(text(ui.root, '#q-status')).toContain('9 Code(s)');
    setValue(ui.root, '#q-count', '10');
    expect(text(ui.root, '#q-count-error')).toContain('passen nicht');
    expect((ui.root.querySelector('#q-save-new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Endwert außerhalb des Schrittrasters: Warnung, Reihe endet auf dem letzten Rasterwert', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-end', '50');
    expect(text(ui.root, '#q-status')).toContain('5 Code(s)'); // 0,12,24,36,48
    const warn = ui.root.querySelector('#q-issues [data-field="end"]');
    expect(warn?.getAttribute('role')).toBeNull();
    expect(warn?.textContent).toContain('Schrittraster');
    expect(text(ui.root, '#q-last')).toBe(`2063701028${'48'}${ref13('206370102848')}`);
  });

  it('fehlerhafte Schablone und falsche Gesamtlänge werden erklärt', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-pattern', '2063{X}{Y}');
    expect(text(ui.root, '#q-pattern-err')).toContain('Feld wie {XX}');
    setValue(ui.root, '#q-pattern', '20{XX}{C}');
    expect(text(ui.root, '#q-pattern-err')).toBe('');
    expect(text(ui.root, '#q-issues')).toContain('braucht 12 Nutzdatenstellen');
    expect(text(ui.root, '#q-issues')).toContain('Länge');
  });

  it('ungültige Zahlen und Schritt 0', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-start', 'abc');
    expect(ui.root.querySelector('#q-issues [data-field="start"]')).not.toBeNull();
    setValue(ui.root, '#q-start', '0');
    setValue(ui.root, '#q-step', '0');
    expect(ui.root.querySelector('#q-issues [data-field="step"]')).not.toBeNull();
  });

  it('Obergrenze der Positionen greift (Reihe mit 100000 Werten bei Standardgrenze)', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-pattern', '2063701{XXXXX}{C}');
    setValue(ui.root, '#q-end', '99999');
    setValue(ui.root, '#q-step', '1');
    expect(ui.root.querySelector('#q-issues [data-code="ERR_SEQUENCE_LIMIT_EXCEEDED"]')).not.toBeNull();
    setValue(ui.root, '#q-max', '100000');
    expect(text(ui.root, '#q-status')).toContain('100000 Code(s)');
  });

  it('QR-Reihe mit Textschablone; {C} ist dort nicht erlaubt', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-sym', 'QRCode');
    setValue(ui.root, '#q-pattern', 'LOT A-{XXX}');
    setValue(ui.root, '#q-start', '1');
    setValue(ui.root, '#q-end', '3');
    setValue(ui.root, '#q-step', '1');
    expect(text(ui.root, '#q-status')).toContain('3 Code(s)');
    expect(text(ui.root, '#q-first')).toBe('LOT A-001');
    setValue(ui.root, '#q-pattern', 'LOT A-{XXX}{C}');
    expect(text(ui.root, '#q-pattern-err')).toContain('nur bei EAN');
  });

  it('Preset-Schaltfläche stellt das Beispiel wieder her', async () => {
    ui = setupUi();
    await open(ui);
    setValue(ui.root, '#q-pattern', 'x');
    setValue(ui.root, '#q-end', '5');
    click(ui.root, '#q-preset');
    expect(input(ui, '#q-pattern').value).toBe(PRESET.pattern);
    expect(input(ui, '#q-end').value).toBe('96');
    expect(text(ui.root, '#q-status')).toContain('9 Code(s)');
  });

  it('als neue Sammlung speichern: 9 Positionen, Quelle sequence, alle Codes gültig', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#q-save-new');
    await answerDialog('Anlegen', 'Reihe A');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    const cols = await ui.ctx.collections.listCollections();
    expect(cols.map((c) => c.name)).toContain('Reihe A');
    const items = await ui.ctx.collections.listItems(cols.find((c) => c.name === 'Reihe A')?.id ?? '');
    expect(items).toHaveLength(9);
    expect(items.every((i) => i.source === 'sequence' && i.checksumStatus === 'valid' && isValidGtin(i.value, 'EAN13'))).toBe(true);
    expect(items.map((i) => i.value.slice(10, 12))).toEqual(['00', '12', '24', '36', '48', '60', '72', '84', '96']);
  });

  it('zu bestehender Sammlung hinzufügen; ohne Sammlung Hinweis', async () => {
    ui = setupUi();
    const cid = await open(ui, true);
    click(ui.root, '#q-add');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    expect(await ui.ctx.collections.listItems(cid)).toHaveLength(9);
  });

  it('Vorlagen: speichern, laden, löschen (mit Bestätigung); leerer Name wird abgelehnt', async () => {
    ui = setupUi();
    await open(ui);
    click(ui.root, '#q-save-template');
    await waitFor(() => document.querySelector('.dialog') !== null);
    (document.querySelector('.dialog .btn--primary') as HTMLElement).click();
    expect(text(document.body, '.dialog .field__error')).toBe('Bitte einen Namen eingeben.');
    await answerDialog('Speichern', 'Kassenreihe');
    await waitFor(() => ui?.root.querySelector('[data-template]') !== null);
    expect(text(ui.root, '[data-template]')).toContain('Kassenreihe');
    expect(text(ui.root, '[data-template]')).toContain(PRESET.pattern);
    setValue(ui.root, '#q-end', '12');
    setValue(ui.root, '#q-step', '6');
    click(ui.root, '[data-load]');
    expect(input(ui, '#q-end').value).toBe('96');
    expect(input(ui, '#q-step').value).toBe('12');
    click(ui.root, '[data-delete]');
    await answerDialog('Löschen');
    await waitFor(() => ui?.root.querySelector('[data-template]') === null);
    expect(text(ui.root, '#q-templates')).toContain('Noch keine Vorlagen');
  });
});
