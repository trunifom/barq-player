/**
 * Generator-Screen: Einzelcode-Generator (EAN-13, EAN-8, QR, Code 128) und Zahlenreihen-/Schablonen-Editor mit
 * Live-Vorschau, feldgenauen Überlauf- und Fehlermeldungen, Speichern als Vorlage oder Sammlung.
 *
 * Es wird nie automatisch korrigiert: Die Prüfziffer wird nur auf ausdrücklichen Klick berechnet, ein Überlauf
 * stoppt die Erzeugung mit klarer Meldung.
 */
import { AppError } from '../../domain/errors';
import { GTIN_BODY_LENGTH, appendCheckDigit } from '../../domain/checksum';
import { DEFAULT_MAX_SEQUENCE_ITEMS, endFromCount, generateSequenceList, parseSequenceTemplate, previewSequence, type SequenceIssue, type SequencePreview } from '../../domain/sequence';
import type { SequenceDefinition, SequenceSymbology, SequenceTemplate, Symbology } from '../../domain/types';
import { renderSymbol, type QrEccLevel } from '../../adapters/renderer/barcode-renderer';
import type { AppContext } from '../../app/container';
import type { Dispose, Route } from '../../app/routes';
import { confirmDialog, promptDialog } from '../components/dialog';
import { h, setChildren, svgElement } from '../components/dom';
import { SYMBOLOGY_LABEL } from './scanner';

/** Beispiel-Preset: `2 063701 028{XX}{C}`, Schritt +12 (siehe Spezifikation 6). */
export const PRESET = Object.freeze({ symbology: 'EAN13' as SequenceSymbology, pattern: '2 063701 028{XX}{C}', start: '0', end: '96', step: '12' });

const SEQ_SYMBOLOGIES: readonly SequenceSymbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128'];
const SINGLE_SYMBOLOGIES: readonly Symbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128'];

const FIELD_LABEL: Record<SequenceIssue['field'], string> = {
  symbology: 'Format',
  prefix: 'Fester Teil davor / Länge',
  suffixBeforeCheckDigit: 'Fester Teil danach',
  variableWidth: 'Feldbreite',
  start: 'Startwert',
  end: 'Endwert',
  step: 'Schrittweite',
  checksumMode: 'Prüfziffer',
  overflow: 'Überlaufregel',
  maxItems: 'Obergrenze'
};

/**
 * Mountet den Generator-Screen.
 * @param root - Wurzelelement.
 * @param ctx - App-Kontext.
 * @param _route - Route (ungenutzt).
 * @returns Aufräumfunktion.
 */
export function mountGenerator(root: HTMLElement, ctx: AppContext, _route: Route): Dispose {
  let alive = true;
  const m = ctx.displayMetrics();
  const previewViewport = { width: Math.min(m.width - 32, 480), height: 320 };

  // ================================================================== Einzelcode
  const sSym = h('select', { id: 'g-sym', class: 'input' }, ...SINGLE_SYMBOLOGIES.map((s) => h('option', { value: s }, SYMBOLOGY_LABEL[s])));
  const sVal = h('input', { id: 'g-value', class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const sEcc = h('select', { id: 'g-ecc', class: 'input' }, ...(['L', 'M', 'Q', 'H'] as const).map((e) => h('option', { value: e, selected: e === 'M' }, `Stufe ${e}`)));
  const sErr = h('p', { class: 'field__error', id: 'g-error', role: 'alert' });
  const sPreview = h('div', { class: 'preview barcode-stage', id: 'g-preview', 'aria-live': 'polite' });
  const sCheckBtn = h('button', { type: 'button', class: 'btn', id: 'g-check', hidden: true }, 'Prüfziffer berechnen');
  const sCollection = h('select', { id: 'g-collection', class: 'input', 'aria-label': 'Sammlung' });
  const sAdd = h('button', { type: 'button', class: 'btn btn--primary', id: 'g-add', disabled: true }, 'Zur Sammlung hinzufügen');

  const updateSingle = (): void => {
    const symbology = sSym.value as Symbology;
    sEcc.parentElement?.toggleAttribute('hidden', symbology !== 'QRCode');
    const value = sVal.value;
    const body = symbology === 'EAN13' || symbology === 'EAN8' ? GTIN_BODY_LENGTH[symbology] : 0;
    sCheckBtn.hidden = !(body > 0 && /^\d+$/.test(value) && value.length === body);
    sErr.textContent = '';
    sAdd.disabled = true;
    if (value === '') {
      setChildren(sPreview);
      return;
    }
    try {
      const rendered = renderSymbol({ symbology, value, ...(symbology === 'QRCode' ? { eccLevel: sEcc.value as QrEccLevel } : {}), viewport: previewViewport, devicePixelRatio: m.devicePixelRatio });
      setChildren(sPreview, svgElement(rendered.svg));
      sAdd.disabled = false;
    } catch (error: unknown) {
      setChildren(sPreview);
      sErr.textContent = error instanceof AppError ? error.userMessage : 'Der Code kann nicht dargestellt werden.';
      if (!(error instanceof AppError)) ctx.logger.logError(error, { source: 'generator-single' });
    }
  };
  for (const el of [sSym, sVal, sEcc]) el.addEventListener('input', updateSingle);
  sCheckBtn.addEventListener('click', () => {
    try {
      const symbology = sSym.value as 'EAN13' | 'EAN8';
      sVal.value = appendCheckDigit(sVal.value, symbology); // nur auf ausdrücklichen Klick
      updateSingle();
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'generator-check' });
    }
  });
  sAdd.addEventListener('click', () => {
    const cid = sCollection.value;
    if (!cid) {
      ctx.notify.info('Bitte eine Sammlung wählen oder zuerst anlegen.');
      return;
    }
    sAdd.disabled = true;
    ctx.collections
      .addItem(cid, { symbology: sSym.value as Symbology, value: sVal.value, source: 'manual' })
      .then((item) => ctx.notify.success(`Hinzugefügt (Menge ${item.quantity}).`))
      .catch((error: unknown) => ctx.notify.error(error, { source: 'generator-add' }))
      .finally(() => {
        sAdd.disabled = false;
      });
  });

  // ================================================================== Zahlenreihe
  const qSym = h('select', { id: 'q-sym', class: 'input' }, ...SEQ_SYMBOLOGIES.map((s) => h('option', { value: s }, SYMBOLOGY_LABEL[s])));
  const qPattern = h('input', { id: 'q-pattern', class: 'input', type: 'text', value: PRESET.pattern, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'q-pattern-help q-pattern-err' });
  const qPatternErr = h('p', { class: 'field__error', id: 'q-pattern-err', role: 'alert' });
  const qStart = h('input', { id: 'q-start', class: 'input', type: 'text', inputmode: 'numeric', value: PRESET.start });
  const qEnd = h('input', { id: 'q-end', class: 'input', type: 'text', inputmode: 'numeric', value: PRESET.end });
  const qCount = h('input', { id: 'q-count', class: 'input', type: 'text', inputmode: 'numeric', placeholder: 'optional statt Endwert' });
  const qStep = h('input', { id: 'q-step', class: 'input', type: 'text', inputmode: 'numeric', value: PRESET.step });
  const qMax = h('input', { id: 'q-max', class: 'input', type: 'number', min: 1, max: 100000, value: DEFAULT_MAX_SEQUENCE_ITEMS });
  const qOut = h('div', { class: 'seq-out', id: 'q-out', 'aria-live': 'polite' });
  const qPreview = h('div', { class: 'preview barcode-stage', id: 'q-preview' });
  const qCollection = h('select', { id: 'q-collection', class: 'input', 'aria-label': 'Sammlung' });
  const qTemplates = h('ul', { class: 'plain-list', id: 'q-templates' });
  const saveTemplateBtn = h('button', { type: 'button', class: 'btn', id: 'q-save-template', disabled: true }, 'Als Vorlage speichern');
  const saveNewBtn = h('button', { type: 'button', class: 'btn btn--primary', id: 'q-save-new', disabled: true }, 'Als neue Sammlung speichern');
  const addBtn = h('button', { type: 'button', class: 'btn', id: 'q-add', disabled: true }, 'Zu gewählter Sammlung hinzufügen');
  let current: { def: SequenceDefinition; preview: SequencePreview } | null = null;

  const buildDefinition = (): { def: SequenceDefinition | null; error: string | null } => {
    const symbology = qSym.value as SequenceSymbology;
    let parts;
    try {
      parts = parseSequenceTemplate(qPattern.value, symbology);
    } catch (error: unknown) {
      return { def: null, error: error instanceof AppError ? error.userMessage : 'Die Schablone ist ungültig.' };
    }
    let end = qEnd.value.trim();
    const countText = qCount.value.trim();
    if (countText !== '') {
      try {
        end = endFromCount(qStart.value.trim(), qStep.value.trim(), Number(countText), parts.variableWidth);
      } catch (error: unknown) {
        return {
          def: { id: 'preview', symbology, prefix: parts.prefix, suffixBeforeCheckDigit: parts.suffixBeforeCheckDigit, variableWidth: parts.variableWidth, start: qStart.value.trim(), end: '', step: qStep.value.trim(), checksumMode: parts.checksumMode, overflow: 'stop' },
          error: error instanceof AppError ? error.userMessage : 'Die Anzahl ist ungültig.'
        };
      }
    }
    return {
      def: {
        id: 'preview',
        symbology,
        prefix: parts.prefix,
        suffixBeforeCheckDigit: parts.suffixBeforeCheckDigit,
        variableWidth: parts.variableWidth,
        start: qStart.value.trim(),
        end,
        step: qStep.value.trim(),
        checksumMode: parts.checksumMode,
        overflow: 'stop',
        maxItems: Number(qMax.value)
      },
      error: null
    };
  };

  const issueList = (issues: SequenceIssue[]): HTMLElement | null =>
    issues.length === 0
      ? null
      : h('ul', { class: 'issues', id: 'q-issues' }, ...issues.map((i) => h('li', { class: i.severity === 'error' ? 'field__error' : 'hint', 'data-field': i.field, 'data-code': i.code, ...(i.severity === 'error' ? { role: 'alert' } : {}) }, h('strong', null, `${FIELD_LABEL[i.field]}: `), i.message)));

  const updateSequence = (): void => {
    current = null;
    qPatternErr.textContent = '';
    saveTemplateBtn.disabled = saveNewBtn.disabled = addBtn.disabled = true;
    setChildren(qPreview);
    const { def, error } = buildDefinition();
    if (error) {
      if (!def) qPatternErr.textContent = error;
      setChildren(qOut, h('p', { class: 'field__error', role: 'alert', id: 'q-count-error' }, error));
      return;
    }
    if (!def) return;
    const preview = previewSequence(def, 3);
    if (!preview.ok) {
      setChildren(qOut, h('p', { class: 'field__error', id: 'q-status' }, 'Die Reihe kann so nicht erzeugt werden. Es wird nichts erzeugt.'), issueList(preview.issues));
      return;
    }
    current = { def, preview };
    saveTemplateBtn.disabled = saveNewBtn.disabled = addBtn.disabled = false;
    const firstCode = preview.first[0];
    if (firstCode) {
      try {
        setChildren(qPreview, svgElement(renderSymbol({ symbology: def.symbology, value: firstCode, viewport: previewViewport, devicePixelRatio: m.devicePixelRatio }).svg));
      } catch (error2: unknown) {
        qOut.append(h('p', { class: 'field__error', role: 'alert' }, error2 instanceof AppError ? error2.userMessage : 'Vorschau nicht möglich.'));
      }
    }
    setChildren(
      qOut,
      h('p', { id: 'q-status' }, h('strong', null, `${preview.count} Code(s). `), `Erster: `, h('code', { id: 'q-first' }, preview.first[0] ?? ''), ' · Letzter: ', h('code', { id: 'q-last' }, preview.last.at(-1) ?? '')),
      h('p', { class: 'hint', id: 'q-samples' }, `Erste: ${preview.first.join(', ')}${(preview.count ?? 0) > 3 ? ` … Letzte: ${preview.last.join(', ')}` : ''}`),
      issueList(preview.issues)
    );
  };
  for (const el of [qSym, qPattern, qStart, qEnd, qCount, qStep, qMax]) el.addEventListener('input', updateSequence);

  const presetBtn = h('button', { type: 'button', class: 'btn', id: 'q-preset' }, 'Beispiel einfügen (2 063701 028{XX}{C}, +12)');
  presetBtn.addEventListener('click', () => {
    qSym.value = PRESET.symbology;
    qPattern.value = PRESET.pattern;
    qStart.value = PRESET.start;
    qEnd.value = PRESET.end;
    qCount.value = '';
    qStep.value = PRESET.step;
    qMax.value = String(DEFAULT_MAX_SEQUENCE_ITEMS);
    updateSequence();
  });

  const valuesOf = (def: SequenceDefinition): string[] | null => {
    try {
      return generateSequenceList(def);
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'generator-sequence' });
      return null;
    }
  };

  saveTemplateBtn.addEventListener('click', () => {
    const cur = current;
    if (!cur) return;
    void (async () => {
      const name = await promptDialog({ title: 'Vorlage speichern', label: 'Name der Vorlage', confirmLabel: 'Speichern', validate: (v) => (v.trim() === '' ? 'Bitte einen Namen eingeben.' : null) });
      if (name === null) return;
      try {
        const now = ctx.nowIso();
        await ctx.collections.saveTemplate({ id: `tpl-${now.replace(/\D/g, '')}`, name, pattern: qPattern.value, definition: { ...cur.def, id: `def-${now.replace(/\D/g, '')}` }, createdAt: now, updatedAt: now });
        ctx.notify.success(`Vorlage „${name.trim()}“ gespeichert.`);
        await loadTemplates();
      } catch (error: unknown) {
        ctx.notify.error(error, { source: 'generator-template' });
      }
    })();
  });

  saveNewBtn.addEventListener('click', () => {
    const cur = current;
    if (!cur) return;
    void (async () => {
      const name = await promptDialog({ title: 'Neue Sammlung aus Zahlenreihe', label: 'Name der Sammlung', initial: `Reihe ${qPattern.value}`.slice(0, 100), confirmLabel: 'Anlegen', validate: (v) => (v.trim() === '' ? 'Bitte einen Namen eingeben.' : v.trim().length > 100 ? 'Höchstens 100 Zeichen.' : null) });
      if (name === null) return;
      const values = valuesOf(cur.def);
      if (!values) return;
      try {
        const col = await ctx.collections.createCollection(name);
        await ctx.collections.addItems(col.id, values.map((value) => ({ symbology: cur.def.symbology, value, source: 'sequence' as const })), 'append');
        ctx.notify.success(`Sammlung „${col.name}“ mit ${values.length} Position(en) angelegt.`);
        await loadCollections(col.id);
      } catch (error: unknown) {
        ctx.notify.error(error, { source: 'generator-save-new' });
      }
    })();
  });

  addBtn.addEventListener('click', () => {
    const cur = current;
    const cid = qCollection.value;
    if (!cur) return;
    if (!cid) {
      ctx.notify.info('Bitte eine Sammlung wählen oder anlegen.');
      return;
    }
    const values = valuesOf(cur.def);
    if (!values) return;
    ctx.collections
      .addItems(cid, values.map((value) => ({ symbology: cur.def.symbology, value, source: 'sequence' as const })), 'append')
      .then(() => ctx.notify.success(`${values.length} Position(en) hinzugefügt.`))
      .catch((error: unknown) => ctx.notify.error(error, { source: 'generator-add-seq' }));
  });

  // ================================================================== Laden
  const loadCollections = async (select?: string): Promise<void> => {
    try {
      const cols = await ctx.collections.listCollections();
      if (!alive) return;
      const empty = h('option', { value: '' }, '– noch keine Sammlung –');
      for (const sel of [sCollection, qCollection]) setChildren(sel, ...(cols.length === 0 ? [empty.cloneNode(true)] : cols.map((c) => h('option', { value: c.id, selected: c.id === (select ?? ctx.settings.get().collectionId) }, c.name))));
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'generator-collections' });
    }
  };

  const applyTemplate = (t: SequenceTemplate): void => {
    qSym.value = t.definition.symbology;
    qPattern.value = t.pattern;
    qStart.value = t.definition.start;
    qEnd.value = t.definition.end;
    qCount.value = '';
    qStep.value = t.definition.step;
    qMax.value = String(t.definition.maxItems ?? DEFAULT_MAX_SEQUENCE_ITEMS);
    updateSequence();
  };

  const loadTemplates = async (): Promise<void> => {
    try {
      const list = await ctx.collections.listTemplates();
      if (!alive) return;
      setChildren(
        qTemplates,
        ...(list.length === 0
          ? [h('li', { class: 'hint' }, 'Noch keine Vorlagen gespeichert.')]
          : list.map((t) =>
              h(
                'li',
                { class: 'inline', 'data-template': t.id },
                h('span', null, h('strong', null, t.name), ' ', h('code', null, t.pattern)),
                h('button', { type: 'button', class: 'btn', 'data-load': t.id, onclick: () => applyTemplate(t) }, 'Laden'),
                h('button', { type: 'button', class: 'btn btn--danger', 'data-delete': t.id, onclick: () => void deleteTemplate(t) }, 'Löschen')
              )
            ))
      );
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'generator-templates' });
    }
  };

  const deleteTemplate = async (t: SequenceTemplate): Promise<void> => {
    if (!(await confirmDialog({ title: 'Vorlage löschen?', message: `Vorlage „${t.name}“ wird gelöscht.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await ctx.collections.deleteTemplate(t.id);
      await loadTemplates();
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'generator-template-delete' });
    }
  };

  // ================================================================== Aufbau
  setChildren(
    root,
    h(
      'section',
      { class: 'screen', 'aria-labelledby': 'g-title' },
      h('h1', { id: 'g-title' }, 'Generator'),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'g-single-title' },
        h('h2', { id: 'g-single-title' }, 'Einzelcode'),
        h('div', { class: 'field' }, h('label', { for: 'g-sym' }, 'Format'), sSym),
        h('div', { class: 'field' }, h('label', { for: 'g-value' }, 'Inhalt'), sVal, sCheckBtn),
        h('div', { class: 'field', hidden: true }, h('label', { for: 'g-ecc' }, 'QR-Fehlerkorrektur'), sEcc),
        sErr,
        sPreview,
        h('div', { class: 'inline' }, sCollection, sAdd)
      ),
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'q-title' },
        h('h2', { id: 'q-title' }, 'Zahlenreihe'),
        h('p', { class: 'hint', id: 'q-pattern-help' }, '{XX} = variables Feld (Breite = Anzahl X), {C} = automatische Prüfziffer. Beispiel: 2 063701 028{XX}{C}. Start, Ende und Schritt zählen nur das variable Feld.'),
        presetBtn,
        h('div', { class: 'field' }, h('label', { for: 'q-sym' }, 'Format'), qSym),
        h('div', { class: 'field' }, h('label', { for: 'q-pattern' }, 'Schablone'), qPattern, qPatternErr),
        h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: 'q-start' }, 'Startwert'), qStart), h('div', { class: 'field' }, h('label', { for: 'q-step' }, 'Schrittweite'), qStep), h('div', { class: 'field' }, h('label', { for: 'q-end' }, 'Endwert'), qEnd), h('div', { class: 'field' }, h('label', { for: 'q-count' }, 'Anzahl'), qCount)),
        h('div', { class: 'field' }, h('label', { for: 'q-max' }, 'Obergrenze der Positionen'), qMax),
        qOut,
        qPreview,
        h('div', { class: 'btn-row' }, saveTemplateBtn, saveNewBtn),
        h('div', { class: 'inline' }, qCollection, addBtn),
        h('h3', null, 'Gespeicherte Vorlagen'),
        qTemplates
      )
    )
  );
  updateSingle();
  updateSequence();
  void loadCollections();
  void loadTemplates();
  return () => {
    alive = false;
  };
}
