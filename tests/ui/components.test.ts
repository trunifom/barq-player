// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, ErrorLogger } from '../../src/domain/errors';
import { confirmDialog, promptDialog } from '../../src/ui/components/dialog';
import { describeStatus, statusBadges } from '../../src/ui/components/badges';
import { formatDateTime, h, setChildren, svgElement } from '../../src/ui/components/dom';
import { AUTO_DISMISS_MS, MAX_VISIBLE_NOTICES, Notifier } from '../../src/ui/components/notifier';
import { renderSymbol } from '../../src/adapters/renderer/barcode-renderer';
import { ManualScheduler } from '../helpers/scheduler';
import { flush } from './helpers';

afterEach(() => {
  document.body.replaceChildren();
});

describe('h() – sicheres DOM', () => {
  it('setzt Attribute, Eigenschaften, Handler und Kinder', () => {
    const onclick = vi.fn();
    const el = h('button', { class: 'btn', type: 'button', 'aria-label': 'x', disabled: true, hidden: false, nope: null, onclick }, 'Text', 5, null, false);
    expect(el.className).toBe('btn');
    expect(el.getAttribute('aria-label')).toBe('x');
    expect(el.disabled).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.hasAttribute('nope')).toBe(false);
    expect(el.textContent).toBe('Text5');
    el.disabled = false;
    el.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it('boolesche true-Attribute werden zu leeren Attributen; value/checked als Eigenschaft', () => {
    expect(h('div', { hidden: true }).hasAttribute('hidden')).toBe(true);
    const input = h('input', { type: 'checkbox', checked: true, value: 'v' });
    expect(input.checked).toBe(true);
    expect(input.value).toBe('v');
  });

  it('Texte sind IMMER Text-Knoten: kein Markup, keine Skripte (XSS-Schutz)', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const el = h('div', null, evil);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toBe(evil);
    const withAttr = h('div', { title: '"><img src=x>' });
    expect(withAttr.querySelector('img')).toBeNull();
    expect(withAttr.getAttribute('title')).toBe('"><img src=x>');
  });

  it('setChildren ersetzt den Inhalt', () => {
    const el = h('div', null, 'alt');
    setChildren(el, 'neu', h('b', null, 'x'));
    expect(el.innerHTML).toBe('neu<b>x</b>');
  });
});

describe('svgElement', () => {
  it('importiert gültiges Renderer-SVG als echtes SVG-Element', () => {
    const el = svgElement(renderSymbol({ symbology: 'EAN13', value: '4006381333931', pixelsPerModule: 2 }).svg);
    expect(el.localName).toBe('svg');
    expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.getAttribute('shape-rendering')).toBe('crispEdges');
  });

  it('weist Nicht-SVG und kaputtes XML ab', () => {
    expect(() => svgElement('<div>x</div>')).toThrow();
    expect(() => svgElement('<svg><')).toThrow();
    expect(() => svgElement('')).toThrow();
  });
});

describe('formatDateTime', () => {
  it('formatiert ISO und lässt Ungültiges unverändert', () => {
    expect(formatDateTime('2026-11-24T10:00:00.000Z')).toMatch(/2026|26/);
    expect(formatDateTime('kein Datum')).toBe('kein Datum');
  });
});

describe('Notifier', () => {
  function setup(): { n: Notifier; box: HTMLElement; logger: ErrorLogger; timers: ManualScheduler } {
    const logger = new ErrorLogger(50, () => 'ts');
    const timers = new ManualScheduler();
    const n = new Notifier(logger, timers);
    const box = document.createElement('div');
    document.body.appendChild(box);
    n.mount(box);
    return { n, box, logger, timers };
  }

  it('Fehler: protokolliert, zeigt Meldung + Hinweis + Code mit role=alert, bleibt bis zum Schließen', () => {
    const { n, box, logger, timers } = setup();
    const e = n.error(new AppError('ERR_STORAGE_WRITE_FAILED', { details: 'geheimer Wert 4006381333931' }), { line: 3 });
    expect(e.code).toBe('ERR_STORAGE_WRITE_FAILED');
    expect(logger.entries).toHaveLength(1);
    const item = box.querySelector('.notice--error');
    expect(item?.getAttribute('role')).toBe('alert');
    expect(item?.textContent).toContain('Die Daten konnten nicht gespeichert werden.');
    expect(item?.textContent).toContain('Speicherplatz');
    expect(item?.textContent).toContain('ERR_STORAGE_WRITE_FAILED');
    expect(item?.textContent).not.toContain('4006381333931'); // details werden nicht angezeigt
    timers.advance(AUTO_DISMISS_MS * 10);
    expect(box.querySelectorAll('.notice--error')).toHaveLength(1);
    (box.querySelector('.notice__close') as HTMLElement).click();
    expect(box.querySelectorAll('.notice')).toHaveLength(0);
  });

  it('normalisiert unbekannte Fehler und stapelt gleiche Fehler nicht', () => {
    const { n, box } = setup();
    n.error('seltsam');
    n.error(new Error('noch was'));
    expect(box.querySelectorAll('.notice--error')).toHaveLength(1);
    expect(n.items[0]?.code).toBe('ERR_UNKNOWN');
  });

  it('Infos/Erfolge: role=status und verschwinden automatisch', () => {
    const { n, box, timers } = setup();
    n.info('Hinweis');
    n.success('Gespeichert');
    expect(box.querySelectorAll('[role="status"]')).toHaveLength(2);
    timers.advance(AUTO_DISMISS_MS);
    expect(box.querySelectorAll('.notice')).toHaveLength(0);
  });

  it('begrenzt die Anzahl: Infos werden zuerst verdrängt, Fehler bleiben', () => {
    const { n } = setup();
    n.error(new AppError('ERR_DECODE_FAILED'));
    n.error(new AppError('ERR_CAMERA_NOT_FOUND'));
    for (let i = 0; i < 10; i++) n.info(`Info ${i}`);
    expect(n.items.length).toBeLessThanOrEqual(MAX_VISIBLE_NOTICES);
    expect(n.items.filter((x) => x.kind === 'error')).toHaveLength(2);
  });

  it('Container ist aria-live; dismiss/clear robust', () => {
    const { n, box } = setup();
    expect(box.getAttribute('aria-live')).toBe('polite');
    n.dismiss(999);
    n.info('a');
    n.clear();
    expect(n.items).toHaveLength(0);
  });

  it('Meldungstexte werden nie als Markup interpretiert', () => {
    const { n, box } = setup();
    n.info('<img src=x onerror=1>');
    expect(box.querySelector('img')).toBeNull();
  });

  it('funktioniert auch ohne gebundenen Container', () => {
    const n = new Notifier(new ErrorLogger());
    expect(() => n.error('x')).not.toThrow();
  });
});

describe('Dialoge', () => {
  it('confirmDialog: OK → true, Abbrechen → false, Escape → false; Dialog verschwindet; Fokus wird wiederhergestellt', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const p1 = confirmDialog({ title: 'T', message: 'M', confirmLabel: 'Ja' });
    expect(document.querySelector('[role="alertdialog"]')?.getAttribute('aria-modal')).toBe('true');
    (document.querySelectorAll('.dialog button')[1] as HTMLElement).click();
    expect(await p1).toBe(true);
    expect(document.querySelector('.dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    const p2 = confirmDialog({ title: 'T', message: 'M' });
    (document.querySelectorAll('.dialog button')[0] as HTMLElement).click();
    expect(await p2).toBe(false);

    const p3 = confirmDialog({ title: 'T', message: 'M' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await p3).toBe(false);
    expect(document.querySelector('.dialog-overlay')).toBeNull();
  });

  it('gefährliche Bestätigung fokussiert zuerst „Abbrechen“', async () => {
    const p = confirmDialog({ title: 'Löschen?', message: 'x', danger: true });
    expect((document.activeElement as HTMLElement).textContent).toBe('Abbrechen');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('Dialogtext wird nie als Markup interpretiert', async () => {
    const p = confirmDialog({ title: '<b>T</b>', message: '<img src=x>' });
    expect(document.querySelector('.dialog img')).toBeNull();
    expect(document.querySelector('.dialog b')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await p;
  });

  it('promptDialog: Validierung zeigt Fehler und schließt nicht; gültiger Wert und Enter bestätigen', async () => {
    const p = promptDialog({ title: 'Name', label: 'Name', validate: (v) => (v.trim() === '' ? 'Bitte Namen eingeben.' : null) });
    const input = document.querySelector<HTMLInputElement>('.dialog input') as HTMLInputElement;
    const ok = [...document.querySelectorAll<HTMLButtonElement>('.dialog button')].find((b) => b.textContent === 'OK') as HTMLButtonElement;
    ok.click();
    expect(document.querySelector('.field__error')?.textContent).toBe('Bitte Namen eingeben.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.dialog')).not.toBeNull();
    input.value = 'Lager';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await p).toBe('Lager');
  });

  it('promptDialog: Abbrechen/Escape → null; Startwert vorbelegt; Label verknüpft', async () => {
    const p = promptDialog({ title: 'Name', label: 'Neuer Name', initial: 'Alt' });
    const input = document.querySelector<HTMLInputElement>('.dialog input') as HTMLInputElement;
    expect(input.value).toBe('Alt');
    expect(document.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Neuer Name');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
    await flush(1);
  });
});

describe('Status-Badges (getrennte Aussagen)', () => {
  const base = { syntaxStatus: 'valid', checksumStatus: 'valid', catalogStatus: 'unchecked' } as const;

  it('liefert drei getrennte Badges in fester Reihenfolge', () => {
    const b = describeStatus(base);
    expect(b.map((x) => x.key)).toEqual(['syntax', 'checksum', 'catalog']);
    expect(b.map((x) => `${x.label}: ${x.text}`)).toEqual(['Syntax: gültig', 'Prüfziffer: gültig', 'Artikelstamm: ungeprüft']);
  });

  it.each([
    ['syntaxStatus', 'invalid', 'syntax', 'ungültig', 'bad'],
    ['syntaxStatus', 'unchecked', 'syntax', 'ungeprüft', 'neutral'],
    ['checksumStatus', 'invalid', 'checksum', 'ungültig', 'bad'],
    ['checksumStatus', 'not-applicable', 'checksum', 'entfällt', 'neutral'],
    ['checksumStatus', 'unchecked', 'checksum', 'ungeprüft', 'neutral'],
    ['catalogStatus', 'known', 'catalog', 'bekannt', 'ok'],
    ['catalogStatus', 'unknown', 'catalog', 'unbekannt', 'warn'],
    ['catalogStatus', 'inactive', 'catalog', 'inaktiv', 'warn']
  ] as const)('%s=%s', (field, value, key, textOut, tone) => {
    const b = describeStatus({ ...base, [field]: value }).find((x) => x.key === key);
    expect(b).toMatchObject({ text: textOut, tone });
  });

  it('Artikelstamm-Badge nennt Quelle und Datum im Tooltip; bekannt ersetzt nie die Prüfziffer-Aussage', () => {
    const b = describeStatus({ ...base, checksumStatus: 'invalid', catalogStatus: 'known', catalogSource: 'artikel.csv', catalogCheckedAt: '2026-11-24T10:00:00.000Z' });
    expect(b[2]?.title).toContain('artikel.csv');
    expect(b[1]?.tone).toBe('bad');
    expect(b[2]?.tone).toBe('ok');
  });

  it('rendert Text (nicht nur Farbe) und data-badge', () => {
    const el = statusBadges({ ...base, catalogStatus: 'unknown' });
    expect([...el.querySelectorAll('.badge')].map((x) => x.textContent)).toEqual(['Syntax: gültig', 'Prüfziffer: gültig', 'Artikelstamm: unbekannt']);
    expect(el.querySelector('[data-badge="catalog"]')?.className).toContain('badge--warn');
  });
});
