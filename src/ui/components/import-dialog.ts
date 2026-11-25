/**
 * Import-Dialog: Datei wählen oder Text/Link einfügen → Inhalt vollständig prüfen → Zusammenfassung → importieren.
 *
 * Es wird erst gespeichert, wenn die Bedienperson nach der Prüfung ausdrücklich „Importieren“ wählt. Importe fügen immer
 * neue Sammlungen bzw. zusätzliche Positionen hinzu und überschreiben nie vorhandene Daten.
 */
import { AppError } from '../../domain/errors';
import { localDateString } from '../../domain/expiry';
import type { Symbology } from '../../domain/types';
import { decodeSharePayload } from '../../adapters/share/link-codec';
import type { AppContext } from '../../app/container';
import type { CollectionsPlan, ImportPlan, RowsPlan } from '../../application/import-service';
import { openDialog } from './dialog';
import { h, setChildren } from './dom';
import { SYMBOLOGY_LABEL } from '../screens/scanner';

/** Vorbelegung (z. B. aus einem geöffneten Link). */
export interface ImportDialogInput {
  text: string;
  /** Anzeigename der Quelle (Dateiname) – dient als Vorschlag für den Sammlungsnamen. */
  name: string;
}

const FORMATS: readonly Symbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'];

/**
 * Löst eingefügten Text auf: ein Link der App wird entpackt, alles andere bleibt unverändert.
 * @param text - eingefügter Text.
 * @returns Inhalt zum Prüfen.
 * @throws {AppError} wenn ein Link beschädigt ist.
 */
export async function resolveImportText(text: string): Promise<string> {
  const t = text.trim();
  const m = /[#?&]import=([A-Za-z0-9._-]+)/.exec(t);
  if (m && /^https?:\/\//i.test(t)) return decodeSharePayload(m[1] ?? '');
  if (m && t.startsWith('#')) return decodeSharePayload(m[1] ?? '');
  return text;
}

function nameFromFile(name: string): string {
  return name.replace(/\.(barq\.)?(json|csv|txt)$/i, '').replace(/[_]+/g, ' ').trim() || 'Import';
}

/**
 * Öffnet den Import-Dialog.
 * @param ctx - App-Kontext.
 * @param initial - optional bereits vorliegender Inhalt (überspringt die Auswahl und zeigt direkt die Zusammenfassung).
 * @returns `true`, wenn etwas importiert wurde.
 */
export function openImportDialog(ctx: AppContext, initial?: ImportDialogInput): Promise<boolean> {
  return openDialog<boolean>((close, titleId) => {
    const error = h('p', { class: 'field__error', role: 'alert', id: `${titleId}-err` });
    const body = h('div', { class: 'import-dialog' });
    const actions = h('div', { class: 'dialog__actions' });
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Abbrechen');
    const focusTarget = h('button', { type: 'button', class: 'btn', style: 'position:absolute;opacity:0;pointer-events:none', tabindex: '-1', 'aria-hidden': 'true' });

    const showError = (e: unknown): void => {
      if (e instanceof AppError) error.textContent = e.userMessage;
      else {
        error.textContent = 'Der Import ist fehlgeschlagen.';
        ctx.notify.error(e, { source: 'import-dialog' });
      }
    };

    // ------------------------------------------------------------------ Phase 1: Quelle wählen
    const showSource = (): void => {
      error.textContent = '';
      const file = h('input', { type: 'file', id: 'imp-file', class: 'input', accept: '.json,.csv,.txt,text/*,application/json' });
      const paste = h('textarea', { id: 'imp-text', class: 'input textarea', rows: 5, placeholder: 'Link, Liste (ein Code pro Zeile) oder CSV einfügen', spellcheck: 'false', autocapitalize: 'off' });
      const check = h('button', { type: 'button', class: 'btn btn--primary', id: 'imp-check' }, 'Prüfen');
      check.addEventListener('click', () => {
        error.textContent = '';
        check.disabled = true;
        void (async () => {
          try {
            const chosen = file.files?.[0];
            if (chosen) await review({ text: await chosen.text(), name: chosen.name });
            else if (paste.value.trim() !== '') await review({ text: await resolveImportText(paste.value), name: 'Einfügen' });
            else error.textContent = 'Bitte eine Datei wählen oder Text einfügen.';
          } catch (e: unknown) {
            showError(e);
          } finally {
            check.disabled = false;
          }
        })();
      });
      setChildren(
        body,
        h('p', { class: 'hint' }, 'Unterstützt: geteilte Sammlungen (.json/.txt, Link), BarQPlayer-Backups, CSV-Tabellen und einfache Listen. Vorhandene Daten werden nicht überschrieben.'),
        h('div', { class: 'field' }, h('label', { for: 'imp-file' }, 'Datei wählen'), file),
        h('div', { class: 'field' }, h('label', { for: 'imp-text' }, 'oder Text bzw. Link einfügen'), paste),
        check
      );
      setChildren(actions, cancel);
    };

    // ------------------------------------------------------------------ Phase 2: Zusammenfassung
    const review = async (input: ImportDialogInput): Promise<void> => {
      error.textContent = '';
      const plan: ImportPlan = ctx.importer.inspect(input.text, localDateString(new Date(ctx.nowIso())));
      if (plan.kind === 'collections') reviewCollections(plan);
      else await reviewRows(plan, input.name);
    };

    const back = h('button', { type: 'button', class: 'btn', onclick: showSource }, 'Zurück');

    const reviewCollections = (plan: CollectionsPlan): void => {
      const go = h('button', { type: 'button', class: 'btn btn--primary', id: 'imp-go' }, plan.files.length === 1 ? 'Als neue Sammlung importieren' : `${plan.files.length} Sammlungen importieren`);
      go.addEventListener('click', () => {
        go.disabled = true;
        void ctx.importer
          .commitCollections(plan.files)
          .then((r) => {
            ctx.notify.success(`${r.collections} Sammlung(en) mit ${r.items} Code(s) importiert.`);
            close(true);
          })
          .catch((e: unknown) => {
            go.disabled = false;
            showError(e);
          });
      });
      setChildren(
        body,
        h('p', { id: 'imp-summary' }, plan.source === 'backup' ? 'Backup erkannt: Die Sammlungen werden als neue Sammlungen übernommen (Vorlagen, Profile und Protokolle nicht).' : 'Geteilte Sammlung erkannt.'),
        h('ul', { class: 'plain-list' }, ...plan.files.map((f) => h('li', null, h('strong', null, f.collection.name), ` – ${f.items.length} Code(s)`))),
        plan.expiredItems > 0 ? h('p', { class: 'field__error', id: 'imp-expired' }, `${plan.expiredItems} Code(s) sind bereits abgelaufen. Sie werden mit importiert und als abgelaufen markiert.`) : null,
        h('p', { class: 'hint' }, `Insgesamt ${plan.totalItems} Code(s), alle wurden vollständig geprüft.`)
      );
      setChildren(actions, back, cancel, go);
    };

    const reviewRows = async (plan: RowsPlan, name: string): Promise<void> => {
      const cols = await ctx.collections.listCollections();
      const target = h('select', { id: 'imp-target', class: 'input' }, h('option', { value: '' }, 'Neue Sammlung anlegen'), ...cols.map((c) => h('option', { value: c.id }, `In „${c.name}“ einfügen`)));
      const newName = h('input', { id: 'imp-name', class: 'input', type: 'text', maxlength: 100, value: nameFromFile(name) });
      const nameField = h('div', { class: 'field' }, h('label', { for: 'imp-name' }, 'Name der neuen Sammlung'), newName);
      target.addEventListener('change', () => {
        nameField.hidden = target.value !== '';
      });
      const sym = h('select', { id: 'imp-sym', class: 'input' }, ...FORMATS.map((f) => h('option', { value: f }, SYMBOLOGY_LABEL[f])));
      const skip = h('input', { type: 'checkbox', id: 'imp-skip' });
      const go = h('button', { type: 'button', class: 'btn btn--primary', id: 'imp-go' }, 'Importieren');
      const result = h('div', { id: 'imp-result', 'aria-live': 'polite' });
      go.addEventListener('click', () => {
        error.textContent = '';
        const chosenTarget = target.value === '' ? { newName: newName.value.trim() || 'Import' } : { collectionId: target.value };
        go.disabled = true;
        void ctx.importer
          .commitRows(plan, chosenTarget, { defaultSymbology: sym.value as Symbology, onError: skip.checked ? 'skip-invalid' : 'abort' })
          .then((r) => {
            if (r.aborted) {
              setChildren(
                result,
                h('p', { class: 'field__error', id: 'imp-aborted' }, `Abgebrochen: ${r.errors.length} fehlerhafte Zeile(n). Es wurde nichts importiert.`),
                h('ul', { class: 'errors' }, ...r.errors.slice(0, 20).map((e) => h('li', null, e.message)), r.errors.length > 20 ? h('li', null, `… und ${r.errors.length - 20} weitere`) : null)
              );
              go.disabled = false;
              return;
            }
            ctx.notify.success(`${r.imported} Code(s) importiert${r.errors.length > 0 ? `, ${r.errors.length} fehlerhafte Zeile(n) übersprungen` : ''}.`);
            close(true);
          })
          .catch((e: unknown) => {
            go.disabled = false;
            showError(e);
          });
      });
      setChildren(
        body,
        h('p', { id: 'imp-summary' }, plan.format === 'csv' ? `CSV-Tabelle erkannt: ${plan.rowCount} Datenzeile(n).` : `Liste erkannt: ${plan.rowCount} Zeile(n).`),
        plan.needsSymbology ? h('div', { class: 'field' }, h('label', { for: 'imp-sym' }, 'Format der Codes'), sym) : h('p', { class: 'hint' }, 'Das Format wird aus der Spalte „Format“ gelesen; leere Zellen verwenden das gewählte Standardformat.'),
        plan.needsSymbology ? null : h('div', { class: 'field' }, h('label', { for: 'imp-sym' }, 'Standardformat'), sym),
        h('div', { class: 'field' }, h('label', { for: 'imp-target' }, 'Ziel'), target),
        nameField,
        h('label', { class: 'check', for: 'imp-skip' }, skip, 'Fehlerhafte Zeilen überspringen (sonst Abbruch ohne Import)'),
        plan.errors.length > 0 ? h('ul', { class: 'errors' }, ...plan.errors.slice(0, 20).map((e) => h('li', null, e.message))) : null,
        result
      );
      setChildren(actions, back, cancel, go);
    };

    const dialog = h(
      'div',
      { class: 'dialog dialog--form', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, 'Importieren'),
      h('div', { class: 'dialog__body' }, body, error),
      actions,
      focusTarget
    );

    if (initial) {
      setChildren(actions, cancel);
      void review(initial).catch((e: unknown) => {
        showError(e);
        showSource();
      });
    } else {
      showSource();
    }
    return { dialog, focus: dialog.querySelector<HTMLElement>('#imp-file') ?? focusTarget, cancelValue: false };
  });
}
