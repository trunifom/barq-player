/**
 * Fader-/Player-Screen (AGENTS.md Regel 6, Spezifikation Kap. 11, 12, 17).
 *
 * Sicherheitsregeln dieser Ansicht:
 * - Das Symbol steht NUR im Zustand `SHOWING` im Bühnenbereich (`.stage`); in jedem anderen Zustand ist die Bühne leer und weiß.
 * - Keine Überblendungen oder Animationen; zwischen zwei Symbolen liegt immer ein leerer Zustand.
 * - Bedienelemente liegen in einer eigenen Leiste UNTER der Bühne und nie über dem Symbol.
 * - Pause, Fehler, Abbruch und Hintergrundwechsel leeren die Bühne sofort (synchron im Zustands-Listener).
 * - „Angezeigt“ wird nie als „gebucht“ dargestellt; „bestätigt“ heißt „von der Bedienperson geprüft“.
 */
import { ERROR_CATALOG } from '../../domain/errors';
import { evaluateCalibration, CALIBRATION_SHOWN, type CalibrationResult } from '../../domain/calibration';
import type { PlaybackMachine, PlaybackMode, PlaybackSnapshot, ResumeDecision } from '../../domain/playback-machine';
import { expiryInfo, localDateString } from '../../domain/expiry';
import { collectTags, matchesQuery } from '../../domain/item-meta';
import { MIN_BLANK_MS } from '../../domain/profiles';
import type { BarcodeItem, FaderProfile } from '../../domain/types';
import type { AppContext } from '../../app/container';
import type { Dispose, Route } from '../../app/routes';
import type { PreparedPlayback } from '../../application/playback-service';
import { confirmDialog, promptDialog } from '../components/dialog';
import { h, setChildren, svgElement } from '../components/dom';

/** Höhe der Steuerleiste in CSS-Pixeln (die Bühne ist die Fensterhöhe abzüglich dieser Leiste). */
export const PLAYER_BAR_HEIGHT = 176;

/** Hinweistext, der in Setup und Zusammenfassung erscheint (F-15). */
export const NOT_BOOKED_NOTICE = 'BarQPlayer zeigt Codes nur an. „Angezeigt“ oder „bestätigt“ bedeutet nie, dass die Kasse einen Artikel gebucht hat.';

const MODE_LABEL: Record<PlaybackMode, string> = { manual: 'Manuell (jede Position bestätigen)', auto: 'Automatik (ohne Rückmeldung der Kasse)', batch: 'Kleinstapel (nach N Codes bestätigen)' };

/**
 * Mountet den Player-Screen.
 * @param root - Wurzelelement.
 * @param ctx - App-Kontext.
 * @param route - Route (Parameter `collection`, `calibration=1`).
 * @returns Aufräumfunktion (pausiert eine laufende Sitzung sicherheitshalber).
 */
export function mountPlayer(root: HTMLElement, ctx: AppContext, route: Route): Dispose {
  const calibration = route.params['calibration'] === '1';
  let cleanup: Dispose = () => undefined;
  let disposed = false;

  const showSetup = (): void => {
    cleanup();
    cleanup = mountSetup(root, ctx, route, calibration, (prepared) => void startSession(prepared));
  };

  const startSession = async (prepared: PreparedPlayback): Promise<void> => {
    try {
      const active = await ctx.playback.begin(prepared);
      if (disposed) return;
      cleanup();
      cleanup = mountSession(root, ctx, active.machine, prepared, calibration, showSetup);
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'player-start' });
    }
  };

  const active = ctx.playback.active;
  if (active && ctx.playback.isLive) {
    cleanup = mountSession(root, ctx, active.machine, active.prepared, active.prepared.request.calibration === true, showSetup);
  } else {
    showSetup();
  }

  return () => {
    disposed = true;
    ctx.playback.pauseActive('operator', 'Ansicht geschlossen');
    cleanup();
    root.replaceChildren();
  };
}

// ------------------------------------------------------------------------------------------------ Setup

function mountSetup(root: HTMLElement, ctx: AppContext, route: Route, calibration: boolean, onStart: (p: PreparedPlayback) => void): Dispose {
  const s = ctx.settings.get();
  const collectionSelect = h('select', { id: 'pl-collection', class: 'input' });
  const profileSelect = h('select', { id: 'pl-profile', class: 'input' });
  const modeSelect = h('select', { id: 'pl-mode', class: 'input' }, ...(['manual', 'auto', 'batch'] as const).map((m) => h('option', { value: m, selected: m === s.mode }, MODE_LABEL[m])));
  const batch = h('input', { id: 'pl-batch', class: 'input', type: 'number', min: 1, max: 100, value: s.batchSize });
  const interleave = h('input', { id: 'pl-interleave', type: 'checkbox', checked: s.interleave });
  const startIndex = h('input', { id: 'pl-start', class: 'input', type: 'number', min: 1, value: 1 });
  const includeExpired = h('input', { id: 'pl-include-expired', type: 'checkbox' });

  // ---- Zeiten für diesen Lauf (vorbelegt aus dem Profil, einzeln anpassbar)
  const timeInput = (id: string, min: number): HTMLInputElement => h('input', { id, class: 'input', type: 'number', min, step: 50, inputmode: 'numeric' });
  const displayInput = timeInput('pl-display', 1);
  const blankInput = timeInput('pl-blank', MIN_BLANK_MS);
  const identicalInput = timeInput('pl-identical', MIN_BLANK_MS);
  const delayInput = timeInput('pl-delay', 0);
  const saveProfileBtn = h('button', { type: 'button', class: 'btn', id: 'pl-save-profile' }, 'Als neues Profil speichern');

  // ---- Auswahl der abzuspielenden Codes
  let items: BarcodeItem[] = [];
  const selected = new Set<string>();
  const filterText = h('input', { id: 'pl-filter-text', class: 'input', type: 'search', placeholder: 'Suchen (Code, Wort, Nutzen, Satz, Tag)', 'aria-label': 'Codes suchen' });
  const filterTag = h('select', { id: 'pl-filter-tag', class: 'input', 'aria-label': 'Nach Tag filtern' });
  const pickList = h('div', { class: 'pick-list', id: 'pl-items', role: 'group', 'aria-label': 'Codes zum Abspielen' });
  const selCount = h('p', { class: 'hint', id: 'pl-sel-count', role: 'status' });
  const summary = h('div', { class: 'summary', 'aria-live': 'polite' });
  const startBtn = h('button', { type: 'button', class: 'btn btn--primary btn--big', id: 'pl-start-btn' }, calibration ? 'Kalibrierlauf starten' : 'Start');
  let profiles: FaderProfile[] = [];
  let alive = true;

  const fill = async (): Promise<void> => {
    try {
      const [cols, profs] = await Promise.all([ctx.collections.listCollections(), ctx.collections.listProfiles()]);
      if (!alive) return;
      profiles = profs;
      const cur = ctx.settings.get();
      const wanted = route.params['collection'] ?? cur.collectionId ?? cols[0]?.id;
      setChildren(collectionSelect, ...cols.map((c) => h('option', { value: c.id, selected: c.id === wanted }, c.name)));
      const wantedProfile = cur.profileId && profs.some((p) => p.id === cur.profileId) ? cur.profileId : profs.find((p) => p.id === 'profile-normal')?.id ?? profs[0]?.id;
      setChildren(profileSelect, ...profs.map((p) => h('option', { value: p.id, selected: p.id === wantedProfile }, `${p.name} – ${p.displayMs}/${p.blankMs} ms`)));
      if (cols.length === 0) setChildren(summary, h('p', { class: 'hint' }, 'Es gibt noch keine Sammlung. Legen Sie zuerst unter „Erfassen“ oder „Sammlungen“ eine an.'));
      startBtn.disabled = cols.length === 0;
      syncTimes();
      await loadItems();
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'player-setup' });
    }
  };

  /** Übernimmt die Zeiten des gewählten Profils in die Eingabefelder. */
  const syncTimes = (): void => {
    const p = profiles.find((x) => x.id === profileSelect.value);
    if (!p) return;
    displayInput.value = String(p.displayMs);
    blankInput.value = String(p.blankMs);
    identicalInput.value = String(p.identicalBlankMs);
    delayInput.value = String(p.startDelayMs);
  };

  /** Aktuelles Profil mit den (ggf. geänderten) Zeiten aus den Eingabefeldern. */
  const effectiveProfile = (): FaderProfile | undefined => {
    const base = profiles.find((p) => p.id === profileSelect.value);
    if (!base || calibration) return base;
    return { ...base, displayMs: Number(displayInput.value), blankMs: Number(blankInput.value), identicalBlankMs: Number(identicalInput.value), startDelayMs: Number(delayInput.value) };
  };

  const today = (): string => localDateString(new Date(ctx.nowIso()));
  const visibleItems = (): BarcodeItem[] => items.filter((i) => matchesQuery(i, filterText.value) && (filterTag.value === '' || (i.tags ?? []).includes(filterTag.value)));

  const updateCount = (): void => {
    const total = items.reduce((n, i) => (selected.has(i.id) ? n + i.quantity : n), 0);
    selCount.textContent = items.length === 0 ? 'Die Sammlung enthält keine Codes.' : `${selected.size} von ${items.length} Position(en) ausgewählt (${total} Stück).`;
  };

  const renderItems = (): void => {
    const now = today();
    const shown = visibleItems();
    setChildren(
      pickList,
      shown.length === 0
        ? h('p', { class: 'hint' }, items.length === 0 ? 'Keine Codes in dieser Sammlung.' : 'Keine Position passt zu Suche und Filter.')
        : null,
      ...shown.map((i) => {
        const expired = expiryInfo(i.expiresAt, now).state === 'expired';
        const box = h('input', { type: 'checkbox', 'data-item-id': i.id, checked: selected.has(i.id) });
        box.addEventListener('change', () => {
          if (box.checked) selected.add(i.id);
          else selected.delete(i.id);
          updateCount();
        });
        return h(
          'label',
          { class: `pick-row${expired ? ' row--expired' : ''}` },
          box,
          h('code', { class: 'value' }, i.value.length > 40 ? `${i.value.slice(0, 40)}…` : i.value),
          i.label ? h('span', { class: 'item-label' }, ` ${i.label}`) : null,
          i.quantity > 1 ? h('span', { class: 'hint' }, ` ×${i.quantity}`) : null,
          expired ? h('span', { class: 'badge badge--bad' }, 'abgelaufen') : null
        );
      })
    );
    updateCount();
  };

  const loadItems = async (): Promise<void> => {
    const id = collectionSelect.value;
    items = id ? await ctx.collections.listItems(id) : [];
    if (!alive) return;
    selected.clear();
    for (const i of items) selected.add(i.id);
    filterText.value = '';
    setChildren(filterTag, h('option', { value: '' }, 'Alle Tags'), ...collectTags(items).map((t) => h('option', { value: t }, `#${t}`)));
    renderItems();
  };

  collectionSelect.addEventListener('change', () => void loadItems().catch((error: unknown) => ctx.notify.error(error, { source: 'player-items' })));
  profileSelect.addEventListener('change', syncTimes);
  filterText.addEventListener('input', renderItems);
  filterTag.addEventListener('change', renderItems);
  const selectIds = (ids: readonly string[]): void => {
    selected.clear();
    for (const id of ids) selected.add(id);
    renderItems();
  };

  saveProfileBtn.addEventListener('click', () => {
    void (async () => {
      const base = profiles.find((p) => p.id === profileSelect.value);
      const name = await promptDialog({ title: 'Als neues Profil speichern', label: 'Name des Profils', confirmLabel: 'Speichern', validate: (v) => (v.trim() === '' ? 'Bitte einen Namen eingeben.' : v.trim().length > 100 ? 'Höchstens 100 Zeichen.' : null) });
      if (name === null || !base) return;
      try {
        const profile: FaderProfile = { id: `profile-${ctx.nowIso().replace(/\D/g, '')}`, name: name.trim(), displayMs: Number(displayInput.value), blankMs: Number(blankInput.value), identicalBlankMs: Number(identicalInput.value), startDelayMs: Number(delayInput.value) };
        await ctx.collections.saveProfile(profile);
        ctx.settings.update({ collectionId: collectionSelect.value || null, profileId: profile.id });
        ctx.notify.success(`Profil „${profile.name}“ gespeichert.`);
        await fill();
      } catch (error: unknown) {
        ctx.notify.error(error, { source: 'player-save-profile' });
      }
    })();
  });

  const start = async (): Promise<void> => {
    const collectionId = collectionSelect.value;
    const profile = effectiveProfile();
    if (!collectionId || !profile) {
      ctx.notify.error(new Error('Sammlung oder Profil fehlt'), { source: 'player-setup' });
      return;
    }
    if (!calibration && items.length > 0 && selected.size === 0) {
      setChildren(summary, h('p', { class: 'field__error', role: 'alert', id: 'pl-none-selected' }, 'Es ist kein Code ausgewählt. Wählen Sie mindestens einen Code zum Abspielen aus.'));
      return;
    }
    const mode = calibration ? 'auto' : (modeSelect.value as PlaybackMode);
    const batchSize = Number(batch.value);
    if (mode === 'batch' && (!Number.isInteger(batchSize) || batchSize < 1)) {
      setChildren(summary, h('p', { class: 'field__error', role: 'alert' }, 'Bitte eine ganze Zahl ≥ 1 für den Kleinstapel angeben.'));
      return;
    }
    ctx.settings.update({ collectionId, profileId: profile.id, mode: calibration ? s.mode : mode, batchSize: mode === 'batch' ? batchSize : s.batchSize, interleave: interleave.checked });
    const m = ctx.displayMetrics();
    startBtn.disabled = true;
    try {
      const prepared = await ctx.playback.prepare({
        collectionId,
        profile,
        mode,
        ...(mode === 'batch' ? { batchSize } : {}),
        interleave: calibration ? false : interleave.checked,
        startIndex: calibration ? 0 : Math.max(0, Number(startIndex.value) - 1 || 0),
        viewport: { width: m.width, height: Math.max(1, m.height - PLAYER_BAR_HEIGHT) },
        devicePixelRatio: m.devicePixelRatio,
        ...(calibration ? { calibration: true } : {}),
        ...(includeExpired.checked ? { includeExpired: true } : {}),
        ...(!calibration && selected.size < items.length ? { itemIds: [...selected] } : {})
      });
      setChildren(
        summary,
        h('p', null, `${prepared.entries.length} Positionen aus „${prepared.collectionName}“ (${prepared.uniqueSymbols} verschiedene Symbole, alle vorab geprüft).`),
        prepared.skippedExpired > 0 ? h('p', { class: 'field__error', id: 'pl-skipped-expired' }, `${prepared.skippedExpired} abgelaufene Position(en) wurden übersprungen.`) : null,
        prepared.stats.reordered ? h('p', null, `Smart-Interleaving: ${prepared.stats.avoidedTransitions} identische Übergänge vermieden${prepared.stats.identicalTransitionsAfter > 0 ? `, ${prepared.stats.identicalTransitionsAfter} nicht vermeidbar` : ''}.`) : null
      );
      if (prepared.skippedExpired > 0) ctx.notify.info(`${prepared.skippedExpired} abgelaufene Position(en) werden übersprungen.`);
      onStart(prepared);
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'player-prepare' });
      startBtn.disabled = false;
    }
  };
  startBtn.addEventListener('click', () => void start());

  setChildren(
    root,
    h(
      'section',
      { class: 'screen', 'aria-labelledby': 'pl-title' },
      h('h1', { id: 'pl-title' }, calibration ? 'Kassen-Kalibrierung (20er-Test)' : 'Kassen-Fader'),
      h('p', { class: 'notice-inline' }, NOT_BOOKED_NOTICE),
      calibration
        ? h('p', { class: 'hint' }, `Es werden genau ${CALIBRATION_SHOWN} Testpositionen aus der gewählten Sammlung angezeigt (bei weniger Codes zyklisch wiederholt). Verwenden Sie nur Artikel, die Ihre Kasse kennt, und einen freigegebenen Testprozess.`)
        : null,
      h('div', { class: 'field' }, h('label', { for: 'pl-collection' }, calibration ? 'Testsammlung' : 'Sammlung'), collectionSelect),
      calibration
        ? null
        : h(
            'details',
            { class: 'card', id: 'pl-pick', open: true },
            h('summary', null, 'Welche Codes abspielen?'),
            h('p', { class: 'hint' }, 'Standardmäßig läuft die ganze Sammlung. Wählen Sie hier einzelne Codes aus, filtern Sie nach Tag oder suchen Sie. Die Reihenfolge der Sammlung bleibt erhalten.'),
            h('div', { class: 'filters' }, filterText, filterTag),
            h(
              'div',
              { class: 'btn-row' },
              h('button', { type: 'button', class: 'btn', id: 'pl-sel-all', onclick: () => selectIds(items.map((i) => i.id)) }, 'Alle'),
              h('button', { type: 'button', class: 'btn', id: 'pl-sel-none', onclick: () => selectIds([]) }, 'Keine'),
              h('button', { type: 'button', class: 'btn', id: 'pl-sel-visible', onclick: () => selectIds(visibleItems().map((i) => i.id)) }, 'Nur die gefilterten')
            ),
            selCount,
            pickList
          ),
      h('div', { class: 'field' }, h('label', { for: 'pl-profile' }, 'Scannerprofil'), profileSelect),
      calibration
        ? null
        : h(
            'details',
            { class: 'card', id: 'pl-times', open: true },
            h('summary', null, 'Zeiten für diesen Lauf (in Millisekunden)'),
            h('p', { class: 'hint' }, 'Vorbelegt aus dem gewählten Profil. Änderungen gelten nur für diesen Lauf, bis Sie sie als neues Profil speichern. 1000 ms = 1 Sekunde.'),
            h('div', { class: 'field' }, h('label', { for: 'pl-display' }, 'Anzeigezeit: so lange ist ein Code sichtbar'), displayInput),
            h('div', { class: 'field' }, h('label', { for: 'pl-blank' }, `Zeit zwischen zwei Codes (leeres Bild, mind. ${MIN_BLANK_MS} ms)`), blankInput),
            h('div', { class: 'field' }, h('label', { for: 'pl-identical' }, `Zeit vor einem identischen Folgecode (mind. ${MIN_BLANK_MS} ms)`), identicalInput),
            h('div', { class: 'field' }, h('label', { for: 'pl-delay' }, 'Startverzögerung (Zeit, um das Telefon an den Scanner zu halten)'), delayInput),
            saveProfileBtn
          ),
      calibration
        ? null
        : h(
            'div',
            { class: 'stack' },
            h('div', { class: 'field' }, h('label', { for: 'pl-mode' }, 'Modus'), modeSelect),
            h('div', { class: 'field' }, h('label', { for: 'pl-batch' }, 'Kleinstapel: Codes bis zur Bestätigung'), batch),
            h('div', { class: 'field field--check' }, interleave, h('label', { for: 'pl-interleave' }, 'Smart-Interleaving (identische Codes nicht direkt hintereinander)')),
            h('div', { class: 'field' }, h('label', { for: 'pl-start' }, 'Ab Position'), startIndex),
            h('div', { class: 'field field--check' }, includeExpired, h('label', { for: 'pl-include-expired' }, 'Abgelaufene Codes trotzdem abspielen (Standard: überspringen)'))
          ),
      summary,
      startBtn
    )
  );
  void fill();
  return () => {
    alive = false;
  };
}

// ------------------------------------------------------------------------------------------------ Sitzung

function mountSession(root: HTMLElement, ctx: AppContext, machine: PlaybackMachine, prepared: PreparedPlayback, calibration: boolean, backToSetup: () => void): Dispose {
  const m = ctx.displayMetrics();
  const viewport = { width: m.width, height: Math.max(1, m.height - PLAYER_BAR_HEIGHT) };
  const stage = h('div', { class: 'stage barcode-stage', id: 'stage', 'aria-label': 'Anzeigefläche für den Code', role: 'img' });
  const bar = h('div', { class: 'player__bar', role: 'region', 'aria-label': 'Steuerung', style: `--bar-h:${PLAYER_BAR_HEIGHT}px` });
  const player = h('div', { class: 'player', 'data-state': 'IDLE' }, stage, bar);
  setChildren(root, player);
  document.body.classList.add('is-playing');

  const total = prepared.entries.length;
  const profile = prepared.request.profile;
  let countdownStart = 0;
  let lastState = '';
  let ticker: ReturnType<typeof setInterval> | null = null;
  let calibrationResult: CalibrationResult | null = null;

  const pauseButton = (): HTMLElement => h('button', { type: 'button', class: 'btn btn--stop btn--big', id: 'btn-pause', onclick: () => void ctx.playback.pauseActive('operator') }, 'STOPP / Pause');

  const decide = async (decision: ResumeDecision, confirmText?: { title: string; message: string; label: string }): Promise<void> => {
    if (confirmText && !(await confirmDialog({ title: confirmText.title, message: confirmText.message, confirmLabel: confirmText.label, danger: true }))) return;
    if (!machine.resume(decision)) ctx.notify.error(new Error('Fortsetzen nicht möglich'), { source: 'player-resume' });
  };

  const uncertaintyPanel = (snap: PlaybackSnapshot): HTMLElement => {
    const confirmed = snap.lastConfirmedIndex === null ? 'noch keine' : `Position ${snap.lastConfirmedIndex + 1}`;
    const shown = snap.lastDisplayedIndex === null ? 'noch keine' : `Position ${snap.lastDisplayedIndex + 1}`;
    const range = snap.uncertainRange;
    const fromInput = h('input', { type: 'number', class: 'input input--small', id: 'resume-from', min: 1, max: total, value: Math.min(total, (snap.lastDisplayedIndex ?? -1) + 2), 'aria-label': 'Fortsetzen ab Position' });
    return h(
      'div',
      { class: 'uncertain', role: 'group', 'aria-label': 'Unklarer Übergabebereich' },
      h('p', null, h('strong', null, 'Zuletzt von Ihnen bestätigt: '), confirmed),
      h('p', null, h('strong', null, 'Zuletzt angezeigt: '), shown),
      range ? h('p', { class: 'uncertain__range' }, h('strong', null, 'Unklarer Bereich: '), `Positionen ${range.from + 1}–${range.to + 1} wurden angezeigt, aber nicht von Ihnen bestätigt. Prüfen Sie die Kasse.`) : h('p', null, 'Es gibt keinen unklaren Bereich.'),
      snap.doubleBookingRisk ? h('p', { class: 'field__error' }, 'Achtung: Bereits angezeigte Positionen werden erneut gezeigt – Doppelbuchungen sind möglich.') : null,
      h(
        'div',
        { class: 'btn-col' },
        h('button', { type: 'button', class: 'btn btn--primary', id: 'btn-reconciled', onclick: () => void decide({ kind: 'reconciled' }) }, `Kasse abgeglichen – nach Position ${(snap.lastDisplayedIndex ?? -1) + 1} weiter`),
        h('button', { type: 'button', class: 'btn', id: 'btn-repeat', onclick: () => void decide({ kind: 'repeat' }, { title: 'Bereich wiederholen?', message: 'Der unklare Bereich wird erneut angezeigt. Wurden einzelne Artikel bereits gebucht, entstehen Doppelbuchungen.', label: 'Wiederholen' }) }, 'Unklaren Bereich wiederholen'),
        h('button', { type: 'button', class: 'btn', id: 'btn-skip', onclick: () => void decide({ kind: 'skip' }, { title: 'Bereich überspringen?', message: 'Der unklare Bereich bleibt unbestätigt im Protokoll und wird nicht erneut angezeigt.', label: 'Überspringen' }) }, 'Unklaren Bereich überspringen'),
        h('div', { class: 'inline' }, fromInput, h('button', { type: 'button', class: 'btn', id: 'btn-from', onclick: () => void decide({ kind: 'from-position', index: Number(fromInput.value) - 1 }) }, 'Ab dieser Position')),
        h('button', { type: 'button', class: 'btn btn--danger', id: 'btn-abort', onclick: () => void abort() }, 'Sitzung abbrechen')
      )
    );
  };

  const abort = async (): Promise<void> => {
    if (await confirmDialog({ title: 'Sitzung abbrechen?', message: 'Die Wiedergabe endet. Der unklare Bereich bleibt im Protokoll.', confirmLabel: 'Abbrechen', cancelLabel: 'Zurück', danger: true })) machine.abort();
  };

  const finishedPanel = (snap: PlaybackSnapshot): HTMLElement => {
    const events = machine.events;
    const displayed = events.filter((e) => e.type === 'displayed').length;
    const confirmed = events.filter((e) => e.type === 'manual-confirmed').length;
    const aborted = snap.finishReason === 'aborted';
    const children: Array<HTMLElement | null> = [
      h('p', { class: 'summary__title' }, aborted ? 'Sitzung abgebrochen.' : 'Sitzung beendet.'),
      h('p', null, `${displayed} Anzeigen von ${total} Positionen, ${confirmed} von Ihnen bestätigt.`),
      snap.uncertainRange ? h('p', { class: 'uncertain__range' }, `Nicht bestätigt: Positionen ${snap.uncertainRange.from + 1}–${snap.uncertainRange.to + 1}.`) : null,
      h('p', { class: 'notice-inline' }, NOT_BOOKED_NOTICE)
    ];
    if (calibration && !aborted) children.push(calibrationForm());
    children.push(h('button', { type: 'button', class: 'btn btn--primary', id: 'btn-done', onclick: () => {
      ctx.playback.clearFinished();
      backToSetup();
    } }, 'Zurück'));
    return h('div', { class: 'finished' }, ...children);
  };

  const calibrationForm = (): HTMLElement => {
    const num = (id: string, label: string, value: number): { field: HTMLElement; input: HTMLInputElement } => {
      const input = h('input', { id, class: 'input input--small', type: 'number', min: 0, max: 1000, value });
      return { field: h('div', { class: 'field' }, h('label', { for: id }, label), input), input };
    };
    const accepted = num('cal-accepted', `Von der Kasse angenommen (von ${CALIBRATION_SHOWN})`, CALIBRATION_SHOWN);
    const extra = num('cal-extra', 'Zusätzliche (doppelte) Buchungen', 0);
    const dialogs = num('cal-dialogs', 'Fehlerdialoge an der Kasse', 0);
    const out = h('div', { class: 'cal-result', 'aria-live': 'polite' });
    const evaluate = (): void => {
      calibrationResult = evaluateCalibration(
        { profile, shown: CALIBRATION_SHOWN, accepted: Number(accepted.input.value), extra: Number(extra.input.value), errorDialogs: Number(dialogs.input.value) },
        `profile-${ctx.nowIso().replace(/\D/g, '')}`
      );
      const r = calibrationResult;
      setChildren(
        out,
        h('p', null, h('strong', null, 'Auswertung: '), r.verdict === 'stable' ? 'fehlerfrei' : r.verdict === 'missing' ? 'Positionen fehlen' : r.verdict === 'extra' ? 'zusätzliche Buchungen' : r.verdict === 'mixed' ? 'uneinheitlich' : 'Test nicht aussagekräftig'),
        h('ul', null, ...r.explanation.map((l) => h('li', null, l))),
        r.verdict === 'stable' || r.verdict === 'missing' || r.verdict === 'extra'
          ? h('button', { type: 'button', class: 'btn btn--primary', id: 'cal-save', onclick: () => void saveRecommended() }, `Als Profil „${r.recommended.name}“ speichern`)
          : null
      );
    };
    const saveRecommended = async (): Promise<void> => {
      if (!calibrationResult) return;
      try {
        await ctx.collections.saveProfile(calibrationResult.recommended);
        ctx.notify.success(`Profil „${calibrationResult.recommended.name}“ gespeichert.`);
      } catch (error: unknown) {
        ctx.notify.error(error, { source: 'calibration-save' });
      }
    };
    return h('div', { class: 'calibration' }, h('h2', null, 'Ergebnis eintragen'), accepted.field, extra.field, dialogs.field, h('button', { type: 'button', class: 'btn', id: 'cal-evaluate', onclick: evaluate }, 'Auswerten'), out);
  };

  const renderBar = (snap: PlaybackSnapshot): void => {
    const pos = snap.currentIndex === null ? '' : `Position ${Math.min(snap.currentIndex + 1, total)} von ${total}`;
    const remaining = (): string => `${Math.max(0, Math.ceil((profile.startDelayMs - (ctx.nowMs() - countdownStart)) / 1000))}`;
    switch (snap.state) {
      case 'COUNTDOWN':
        setChildren(bar, h('p', { class: 'player__status', id: 'player-status' }, `Start in `, h('strong', { id: 'countdown' }, remaining()), ' s – Telefon an den Scanner halten.'), pauseButton());
        break;
      case 'SHOWING':
      case 'BLANKING':
        setChildren(bar, h('p', { class: 'player__status', id: 'player-status' }, snap.state === 'SHOWING' ? `Angezeigt: ${pos}` : `Wechsel … nächste ${pos}`, snap.doubleBookingRisk ? ' (Wiederholung)' : ''), pauseButton());
        break;
      case 'WAITING_CONFIRMATION':
        setChildren(
          bar,
          h('p', { class: 'player__status', id: 'player-status' }, `Bitte Kasse prüfen. Angezeigt bis Position ${(snap.lastDisplayedIndex ?? 0) + 1} von ${total}.`),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn--primary btn--big', id: 'btn-confirm', onclick: () => void machine.confirm() }, 'Geprüft – weiter'), pauseButton())
        );
        break;
      case 'PAUSED':
      case 'ERROR': {
        const reason = snap.state === 'ERROR' ? `Fehler: ${ERROR_CATALOG[snap.errorCode ?? 'ERR_PLAYBACK_FAILED'].userMessage}` : `Pausiert (${snap.pauseSource === 'background' ? 'Seite im Hintergrund' : snap.pauseSource === 'sensor' ? 'Sensor' : 'von Ihnen'}). Der Code ist ausgeblendet.`;
        setChildren(bar, h('p', { class: 'player__status player__status--alert', id: 'player-status', role: snap.state === 'ERROR' ? 'alert' : 'status' }, reason), uncertaintyPanel(snap));
        break;
      }
      case 'FINISHED':
        setChildren(bar, finishedPanel(snap));
        break;
      default:
        setChildren(bar, h('p', { class: 'player__status', id: 'player-status' }, 'Bereit …'));
    }
  };

  const render = (snap: PlaybackSnapshot): void => {
    // 1) IMMER zuerst leeren: das Symbol steht nur im Zustand SHOWING auf der Bühne.
    stage.replaceChildren();
    player.dataset['state'] = snap.state;
    if (snap.state === 'COUNTDOWN' && lastState !== 'COUNTDOWN') countdownStart = ctx.nowMs();
    lastState = snap.state;
    // 2) Symbol nur bei SHOWING (ein Renderfehler wirft und versetzt die Maschine in ERROR; die Bühne bleibt leer).
    if (snap.visibleEntry) {
      const e = snap.visibleEntry;
      const sym = ctx.renderCache.get({ symbology: e.symbology, value: e.value, viewport, devicePixelRatio: m.devicePixelRatio });
      stage.appendChild(svgElement(sym.svg));
      const idx = snap.currentIndex ?? 0;
      const upcoming = machine.frozenEntries.slice(idx + 1, idx + 3).map((n) => ({ symbology: n.symbology, value: n.value, viewport, devicePixelRatio: m.devicePixelRatio }));
      const problems = ctx.renderCache.prefetch(upcoming);
      for (const p of problems) ctx.logger.logError(p.error, { source: 'prefetch', offset: p.offset });
    }
    renderBar(snap);
  };

  // Optional: Lift-to-Pause (nur PAUSIEREN). Scharf geschaltet wird erst, wenn das Telefon bereit liegt (nicht im Countdown).
  const useLift = ctx.settings.get().liftToPause && ctx.lift.supported;
  const syncLift = (state: PlaybackSnapshot['state']): void => {
    if (!useLift) return;
    if (state === 'SHOWING' || state === 'BLANKING' || state === 'WAITING_CONFIRMATION') ctx.lift.arm();
    else ctx.lift.disarm();
  };
  const unsubscribe = machine.subscribe((snap) => {
    render(snap);
    syncLift(snap.state);
  });
  render(machine.snapshot);

  ticker = setInterval(() => {
    const el = bar.querySelector('#countdown');
    if (el && machine.snapshot.state === 'COUNTDOWN') el.textContent = `${Math.max(0, Math.ceil((profile.startDelayMs - (ctx.nowMs() - countdownStart)) / 1000))}`;
  }, 250);

  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const state = machine.snapshot.state;
    if ((e.key === ' ' || e.key === 'Escape') && ['COUNTDOWN', 'SHOWING', 'BLANKING', 'WAITING_CONFIRMATION'].includes(state)) {
      e.preventDefault();
      ctx.playback.pauseActive('operator', 'Externe Taste');
    } else if (e.key === 'Enter' && state === 'WAITING_CONFIRMATION') {
      e.preventDefault();
      machine.confirm();
    }
  };
  document.addEventListener('keydown', onKey);

  return () => {
    unsubscribe();
    ctx.lift.disarm();
    if (ticker) clearInterval(ticker);
    document.removeEventListener('keydown', onKey);
    stage.replaceChildren();
    document.body.classList.remove('is-playing');
  };
}
