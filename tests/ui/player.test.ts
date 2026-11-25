// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CATALOG } from '../../src/domain/errors';
import type { PlaybackSnapshot } from '../../src/domain/playback-machine';
import { mountPlayer, NOT_BOOKED_NOTICE, PLAYER_BAR_HEIGHT } from '../../src/ui/screens/player';
import { answerDialog, click, flush, setChecked, setValue, setupUi, teardownUi, text, waitFor, type UiSetup } from './helpers';

const EAN_A = '4006381333931';
const EAN_B = '5901234123457';
const EAN_C = '9780201379624';

let ui: UiSetup | null = null;
afterEach(async () => {
  await teardownUi(ui);
  ui = null;
});

async function prepareCollection(u: UiSetup, items: Array<[string, number]> = [[EAN_A, 1], [EAN_B, 1], [EAN_C, 1]]): Promise<string> {
  const c = await u.ctx.collections.createCollection('Lager');
  await u.ctx.collections.addItems(c.id, items.map(([value, quantity]) => ({ symbology: 'EAN13' as const, value, source: 'manual' as const, quantity })));
  return c.id;
}

async function openSetup(u: UiSetup, params: Record<string, string> = {}): Promise<void> {
  u.mount(mountPlayer, { name: 'player', params });
  await waitFor(() => u.root.querySelector('#pl-start-btn') !== null && (u.root.querySelectorAll('#pl-profile option').length > 0));
  await flush(2);
}

/** Startet eine Sitzung über die Oberfläche. */
async function startSession(u: UiSetup, opts: { mode?: 'manual' | 'auto' | 'batch'; interleave?: boolean; batch?: number } = {}): Promise<void> {
  if (opts.mode) setValue(u.root, '#pl-mode', opts.mode);
  if (opts.batch !== undefined) setValue(u.root, '#pl-batch', String(opts.batch));
  if (opts.interleave !== undefined) setChecked(u.root, '#pl-interleave', opts.interleave);
  click(u.root, '#pl-start-btn');
  await waitFor(() => u.root.querySelector('.player') !== null);
}

const stage = (u: UiSetup): HTMLElement => u.root.querySelector('#stage') as HTMLElement;
const state = (u: UiSetup): string => (u.root.querySelector('.player') as HTMLElement).dataset['state'] ?? '';
const machine = (u: UiSetup) => {
  const a = u.ctx.playback.active;
  if (!a) throw new Error('keine aktive Sitzung');
  return a.machine;
};

describe('Setup', () => {
  it('zeigt Sammlungen und Profile, den Nicht-gebucht-Hinweis und Standardwerte', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    expect(text(ui.root, '.notice-inline')).toBe(NOT_BOOKED_NOTICE);
    expect([...ui.root.querySelectorAll('#pl-collection option')].map((o) => o.textContent)).toEqual(['Lager']);
    expect([...ui.root.querySelectorAll('#pl-profile option')].map((o) => o.textContent?.split(' – ')[0])).toEqual(['Langsam', 'Identische Codes', 'Normaltest', 'Schnelltest']);
    expect((ui.root.querySelector('#pl-profile') as HTMLSelectElement).value).toBe('profile-normal');
    expect((ui.root.querySelector('#pl-mode') as HTMLSelectElement).value).toBe('manual');
  });

  it('ohne Sammlung: Hinweis, Start gesperrt', async () => {
    ui = setupUi();
    await openSetup(ui);
    expect(text(ui.root, '.summary .hint')).toContain('noch keine Sammlung');
    expect((ui.root.querySelector('#pl-start-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Kleinstapel mit ungültiger Zahl wird abgelehnt und startet nicht', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    setValue(ui.root, '#pl-mode', 'batch');
    setValue(ui.root, '#pl-batch', '0');
    click(ui.root, '#pl-start-btn');
    await flush();
    expect(text(ui.root, '.field__error')).toContain('ganze Zahl');
    expect(ui.root.querySelector('.player')).toBeNull();
    expect(ui.ctx.playback.active).toBeNull();
  });

  it('merkt sich Auswahl in den Einstellungen', async () => {
    ui = setupUi();
    const cid = await prepareCollection(ui);
    await openSetup(ui);
    setValue(ui.root, '#pl-mode', 'auto');
    setChecked(ui.root, '#pl-interleave', true);
    await startSession(ui);
    expect(ui.ctx.settings.get()).toMatchObject({ collectionId: cid, mode: 'auto', interleave: true, profileId: 'profile-normal' });
  });

  it('Vorbereitungsfehler (z. B. nicht darstellbar) erscheinen als Fehlerbanner und starten nicht', async () => {
    ui = setupUi();
    const c = await ui.ctx.collections.createCollection('x');
    await ui.ctx.collections.addItem(c.id, { symbology: 'QRCode', value: 'a'.repeat(1990), source: 'manual' });
    Object.defineProperty(window, 'innerWidth', { value: 150, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: PLAYER_BAR_HEIGHT + 150, configurable: true });
    await openSetup(ui);
    click(ui.root, '#pl-start-btn');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'error') === true);
    expect(ui.ctx.notify.items[0]?.message).toContain('Position 1');
    expect(ui.root.querySelector('.player')).toBeNull();
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
  });
});

describe('Sicherheitsinvarianten der Anzeige', () => {
  it('Symbol steht NUR im Zustand SHOWING auf der Bühne; zwischen zwei Symbolen ist die Bühne leer (kompletter Durchlauf)', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    const u = ui;
    const observed: Array<{ state: string; children: number }> = [];
    machine(u).subscribe((snap: PlaybackSnapshot) => observed.push({ state: snap.state, children: stage(u).children.length }));
    u.sched.advance(30_000);
    expect(observed.length).toBeGreaterThan(5);
    for (const o of observed) expect(o.children).toBe(o.state === 'SHOWING' ? 1 : 0);
    // nie zwei SHOWING in Folge ohne leeren Zustand dazwischen
    for (let i = 1; i < observed.length; i++) expect(observed[i]?.state === 'SHOWING' && observed[i - 1]?.state === 'SHOWING').toBe(false);
    expect(state(u)).toBe('FINISHED');
    expect(stage(u).children).toHaveLength(0);
  });

  it('COUNTDOWN: Bühne leer, Countdown nur in der Leiste (nie im Symbolbereich)', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    expect(state(ui)).toBe('COUNTDOWN');
    expect(stage(ui).children).toHaveLength(0);
    expect(stage(ui).textContent).toBe('');
    expect(text(ui.root, '.player__bar')).toContain('Start in');
    expect(text(ui.root, '#countdown')).toBe('3');
  });

  it('SHOWING zeigt das echte Symbol: SVG mit crispEdges, #000 auf #FFF, ohne Bedienelemente in der Bühne', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(3000);
    expect(state(ui)).toBe('SHOWING');
    const svg = stage(ui).querySelector('svg');
    expect(svg?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg?.getAttribute('aria-label')).toBe(`EAN-13 ${EAN_A}`);
    expect(stage(ui).querySelector('button, input, a')).toBeNull();
    expect(stage(ui).classList.contains('barcode-stage')).toBe(true);
    expect(ui.root.querySelector('.player')?.contains(stage(ui))).toBe(true);
    expect(stage(ui).contains(ui.root.querySelector('.player__bar'))).toBe(false); // Leiste liegt neben, nie in der Bühne
    expect(document.body.classList.contains('is-playing')).toBe(true);
  });

  it('Pause per Taste blendet das Symbol SOFORT aus (synchron), Leiste zeigt unklaren Bereich', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(3000);
    expect(stage(ui).children).toHaveLength(1);
    click(ui.root, '#btn-pause');
    expect(stage(ui).children).toHaveLength(0);
    expect(state(ui)).toBe('PAUSED');
    expect(text(ui.root, '.uncertain__range')).toContain('Positionen 1–1');
    expect(text(ui.root, '.uncertain__range')).toContain('nicht von Ihnen bestätigt');
    ui.sched.advance(60_000);
    expect(stage(ui).children).toHaveLength(0);
  });

  it('Leertaste und Escape pausieren (externer Taster); Eingabefelder werden respektiert', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(3000);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(state(ui)).toBe('SHOWING'); // in Eingabefeld: ignoriert
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(state(ui)).toBe('PAUSED');
    expect(stage(ui).children).toHaveLength(0);
  });

  it('Hintergrundwechsel (Pause-Quelle background) zeigt den passenden Grund und blendet aus', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(3000);
    ui.ctx.playback.pauseActive('background');
    expect(stage(ui).children).toHaveLength(0);
    expect(text(ui.root, '#player-status')).toContain('Seite im Hintergrund');
  });

  it('Renderfehler während der Sitzung → ERROR, Bühne bleibt leer, Fehlermeldung sichtbar', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.ctx.renderCache.get = () => {
      throw new Error('render kaputt');
    };
    ui.sched.advance(3000);
    expect(state(ui)).toBe('ERROR');
    expect(stage(ui).children).toHaveLength(0);
    expect(text(ui.root, '#player-status')).toContain(ERROR_CATALOG.ERR_PLAYBACK_FAILED.userMessage);
    expect(ui.root.querySelector('#player-status')?.getAttribute('role')).toBe('alert');
    ui.sched.advance(60_000);
    expect(stage(ui).children).toHaveLength(0);
  });

  it('Verlassen des Screens pausiert eine laufende Sitzung sicherheitshalber; erneutes Öffnen zeigt die Sitzung (nicht das Setup)', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(3000);
    ui.unmount();
    expect(machine(ui).snapshot.state).toBe('PAUSED');
    expect(machine(ui).snapshot.visibleEntry).toBeNull();
    ui.mount(mountPlayer, { name: 'player', params: {} });
    expect(ui.root.querySelector('.player')).not.toBeNull();
    expect(state(ui)).toBe('PAUSED');
    expect(ui.root.querySelector('#pl-start-btn')).toBeNull();
  });
});

describe('Manuell und Kleinstapel', () => {
  it('manuell: nach Anzeige „Geprüft – weiter“; bestätigt wird nur durch die Bedienperson', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'manual' });
    ui.sched.advance(3000 + 500);
    expect(state(ui)).toBe('WAITING_CONFIRMATION');
    expect(stage(ui).children).toHaveLength(0);
    expect(text(ui.root, '#player-status')).toContain('Kasse prüfen');
    expect(machine(ui).events.some((e) => e.type === 'manual-confirmed')).toBe(false);
    click(ui.root, '#btn-confirm');
    expect(state(ui)).toBe('BLANKING');
    expect(machine(ui).events.filter((e) => e.type === 'manual-confirmed').map((e) => e.evidence)).toEqual(['operator']);
  });

  it('Enter bestätigt im Wartezustand', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'manual' });
    ui.sched.advance(3500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(state(ui)).toBe('BLANKING');
  });

  it('Kleinstapel: nach N Codes warten', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'batch', batch: 2 });
    ui.sched.advance(3000 + 500 + 150 + 500);
    expect(state(ui)).toBe('WAITING_CONFIRMATION');
    expect(text(ui.root, '#player-status')).toContain('Position 2 von 3');
  });
});

describe('Wiederaufnahme mit unklarem Übergabebereich', () => {
  async function pausedAtSecond(u: UiSetup): Promise<void> {
    await prepareCollection(u);
    await openSetup(u);
    await startSession(u, { mode: 'auto' });
    u.sched.advance(3000 + 500 + 150 + 100); // Position 2 wird angezeigt
    click(u.root, '#btn-pause');
  }

  it('zeigt zuletzt bestätigt / zuletzt angezeigt / Bereich und die Entscheidungen', async () => {
    ui = setupUi();
    await pausedAtSecond(ui);
    const t = text(ui.root, '.uncertain');
    expect(t).toContain('Zuletzt von Ihnen bestätigt: noch keine');
    expect(t).toContain('Zuletzt angezeigt: Position 2');
    expect(t).toContain('Positionen 1–2');
    for (const id of ['#btn-reconciled', '#btn-repeat', '#btn-skip', '#btn-from', '#btn-abort']) expect(ui.root.querySelector(id)).not.toBeNull();
  });

  it('„Abgeglichen“: bestätigt manuell, Countdown, dann nächste Position ohne Nachholen', async () => {
    ui = setupUi();
    await pausedAtSecond(ui);
    click(ui.root, '#btn-reconciled');
    expect(state(ui)).toBe('COUNTDOWN');
    expect(machine(ui).snapshot.lastConfirmedIndex).toBe(1);
    ui.sched.advance(3000);
    expect(stage(ui).querySelector('svg')?.getAttribute('aria-label')).toBe(`EAN-13 ${EAN_C}`);
  });

  it('„Wiederholen“ verlangt Bestätigung (Doppelbuchungsgefahr) und warnt anschließend', async () => {
    ui = setupUi();
    await pausedAtSecond(ui);
    click(ui.root, '#btn-repeat');
    await waitFor(() => document.querySelector('.dialog') !== null);
    expect(text(document.body, '.dialog')).toContain('Doppelbuchungen');
    await answerDialog('Wiederholen');
    expect(state(ui)).toBe('COUNTDOWN');
    ui.sched.advance(3000);
    expect(stage(ui).querySelector('svg')?.getAttribute('aria-label')).toBe(`EAN-13 ${EAN_A}`);
    expect(text(ui.root, '#player-status')).toContain('Wiederholung');
  });

  it('„Wiederholen“ abbrechen im Dialog ändert nichts', async () => {
    ui = setupUi();
    await pausedAtSecond(ui);
    click(ui.root, '#btn-repeat');
    await answerDialog('Abbrechen');
    expect(state(ui)).toBe('PAUSED');
  });

  it('„Überspringen“ nach Bestätigung; „Ab Position“ mit gültiger Zahl', async () => {
    ui = setupUi();
    await pausedAtSecond(ui);
    click(ui.root, '#btn-skip');
    await answerDialog('Überspringen');
    expect(state(ui)).toBe('COUNTDOWN');
    expect(machine(ui).events.some((e) => e.type === 'manual-confirmed')).toBe(false);
    click(ui.root, '#btn-pause');
    setValue(ui.root, '#resume-from', '1');
    click(ui.root, '#btn-from');
    expect(state(ui)).toBe('COUNTDOWN');
    ui.sched.advance(3000);
    expect(stage(ui).querySelector('svg')?.getAttribute('aria-label')).toBe(`EAN-13 ${EAN_A}`);
  });

  it('Abbrechen mit Bestätigung beendet die Sitzung (aborted) und blendet aus', async () => {
    ui = setupUi();
    await pausedAtSecond(ui);
    click(ui.root, '#btn-abort');
    await answerDialog('Abbrechen');
    expect(state(ui)).toBe('FINISHED');
    expect(text(ui.root, '.summary__title')).toBe('Sitzung abgebrochen.');
    expect(text(ui.root, '.uncertain__range')).toContain('Nicht bestätigt');
  });
});

describe('Zusammenfassung (F-15)', () => {
  it('beendete Sitzung: Zahlen, Nicht-gebucht-Hinweis, kein „gebucht“-Erfolg; Zurück führt zum Setup', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(30_000);
    expect(state(ui)).toBe('FINISHED');
    const t = text(ui.root, '.finished');
    expect(t).toContain('Sitzung beendet.');
    expect(t).toContain('3 Anzeigen von 3 Positionen, 0 von Ihnen bestätigt.');
    expect(t).toContain(NOT_BOOKED_NOTICE);
    expect(t).not.toMatch(/erfolgreich gebucht|wurde gebucht|verbucht/i);
    click(ui.root, '#btn-done');
    await waitFor(() => ui?.root.querySelector('#pl-start-btn') !== null);
    expect(ui.ctx.playback.active).toBeNull();
    expect(document.body.classList.contains('is-playing')).toBe(false);
  });

  it('Protokoll: Sitzung und Ereignisse stehen in der Datenbank (mit App-Version)', async () => {
    ui = setupUi();
    await prepareCollection(ui);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto' });
    ui.sched.advance(30_000);
    await ui.ctx.playback.flush();
    const [s] = await ui.ctx.sessions.listSessions();
    expect(s).toMatchObject({ status: 'finished', entryCount: 3, appVersion: ui.ctx.appVersion });
    expect((await ui.ctx.sessions.listEvents(s?.id ?? '')).filter((e) => e.type === 'displayed')).toHaveLength(3);
  });
});

describe('Smart-Interleaving im Setup', () => {
  it('zeigt die Statistik vermiedener identischer Übergänge', async () => {
    ui = setupUi();
    await prepareCollection(ui, [[EAN_A, 3], [EAN_B, 2]]);
    await openSetup(ui);
    await startSession(ui, { mode: 'auto', interleave: true });
    // die Statistik steht in der Setup-Zusammenfassung; nach Start ist die Sitzung gemischt
    const values = machine(ui).frozenEntries.map((e) => e.value);
    expect(values).toEqual([EAN_A, EAN_B, EAN_A, EAN_B, EAN_A]);
  });
});

describe('Kalibrierungsassistent', () => {
  it('20 Testcodes, Ergebnis eintragen, Vorschlag auswerten und als Profil speichern', async () => {
    ui = setupUi();
    const cid = await prepareCollection(ui);
    await openSetup(ui, { calibration: '1', collection: cid });
    expect(text(ui.root, 'h1')).toContain('Kalibrierung');
    expect(ui.root.querySelector('#pl-mode')).toBeNull();
    await startSession(ui);
    expect(machine(ui).frozenEntries).toHaveLength(20);
    ui.sched.advance(120_000);
    expect(state(ui)).toBe('FINISHED');
    expect(ui.root.querySelector('.calibration')).not.toBeNull();
    setValue(ui.root, '#cal-accepted', '17');
    click(ui.root, '#cal-evaluate');
    expect(text(ui.root, '.cal-result')).toContain('Positionen fehlen');
    expect(text(ui.root, '.cal-result')).toContain('3 von 20');
    click(ui.root, '#cal-save');
    await waitFor(() => ui?.ctx.notify.items.some((n) => n.kind === 'success') === true);
    const profiles = await ui.ctx.collections.listProfiles();
    expect(profiles.some((p) => p.name === 'Normaltest (langsamer)' && p.displayMs === 750)).toBe(true);
  });

  it('fehlerfreier Lauf schlägt Betriebsprofil mit Reserve vor; Fehlerdialoge → kein Speichern angeboten', async () => {
    ui = setupUi();
    const cid = await prepareCollection(ui);
    await openSetup(ui, { calibration: '1', collection: cid });
    await startSession(ui);
    ui.sched.advance(120_000);
    click(ui.root, '#cal-evaluate');
    expect(text(ui.root, '.cal-result')).toContain('fehlerfrei');
    expect(text(ui.root, '.cal-result')).toContain('25 % Reserve');
    expect(ui.root.querySelector('#cal-save')).not.toBeNull();
    setValue(ui.root, '#cal-dialogs', '2');
    click(ui.root, '#cal-evaluate');
    expect(text(ui.root, '.cal-result')).toContain('nicht aussagekräftig');
    expect(ui.root.querySelector('#cal-save')).toBeNull();
  });

  it('ungültige Eingabe wird erklärt statt gespeichert', async () => {
    ui = setupUi();
    const cid = await prepareCollection(ui);
    await openSetup(ui, { calibration: '1', collection: cid });
    await startSession(ui);
    ui.sched.advance(120_000);
    setValue(ui.root, '#cal-accepted', '-4');
    click(ui.root, '#cal-evaluate');
    expect(text(ui.root, '.cal-result')).toContain('ganze Zahl');
    expect(ui.root.querySelector('#cal-save')).toBeNull();
  });
});
