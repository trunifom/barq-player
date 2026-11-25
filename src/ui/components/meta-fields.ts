/**
 * Eingabefelder für die Zusatzangaben eines Codes (Wort, Nutzen, Satz, Tags, Ablaufdatum).
 * Wird im Detaildialog und bei der Erfassung (gemeinsame Angaben für mehrere Codes) verwendet.
 */
import { META_LIMITS, type ItemMeta, type ItemMetaInput } from '../../domain/item-meta';
import { h } from './dom';

/** Felder samt Auslesefunktion. */
export interface MetaFields {
  element: HTMLElement;
  /** Das erste Feld (für den Starfokus). */
  first: HTMLElement;
  /** Liest die aktuellen Eingaben (roh, noch nicht geprüft). */
  read(): ItemMetaInput;
  /** Leert alle Felder. */
  clear(): void;
}

/**
 * Erzeugt die Eingabefelder.
 * @param idPrefix - Präfix für eindeutige Element-IDs.
 * @param initial - Startwerte.
 * @returns Felder, Fokuselement, Lese- und Löschfunktion.
 */
export function metaFields(idPrefix: string, initial: ItemMeta = {}): MetaFields {
  const label = h('input', { id: `${idPrefix}-label`, class: 'input', type: 'text', maxlength: META_LIMITS.label, value: initial.label ?? '', autocomplete: 'off', placeholder: 'z. B. Bio-Äpfel 1 kg' });
  const purpose = h('input', { id: `${idPrefix}-purpose`, class: 'input', type: 'text', maxlength: META_LIMITS.purpose, value: initial.purpose ?? '', autocomplete: 'off', placeholder: 'z. B. Kassentest, Aktion, Retoure' });
  const note = h('textarea', { id: `${idPrefix}-note`, class: 'input textarea', rows: 3, maxlength: META_LIMITS.note, placeholder: 'Ein Satz oder eine Notiz zu diesem Code' });
  note.value = initial.note ?? '';
  const tags = h('input', { id: `${idPrefix}-tags`, class: 'input', type: 'text', value: (initial.tags ?? []).join(', '), autocomplete: 'off', placeholder: 'mit Komma trennen, z. B. Obst, Aktion' });
  const expires = h('input', { id: `${idPrefix}-expires`, class: 'input', type: 'date', value: initial.expiresAt ?? '' });
  const clearDate = h('button', { type: 'button', class: 'btn', onclick: () => (expires.value = '') }, 'Datum löschen');

  const field = (id: string, text: string, control: HTMLElement, hint?: string): HTMLElement =>
    h('div', { class: 'field' }, h('label', { for: id }, text), control, hint ? h('p', { class: 'hint' }, hint) : null);

  const element = h(
    'div',
    { class: 'meta-fields' },
    field(`${idPrefix}-label`, 'Wort (Bezeichnung)', label),
    field(`${idPrefix}-purpose`, 'Nutzen', purpose),
    field(`${idPrefix}-note`, 'Satz (Notiz)', note),
    field(`${idPrefix}-tags`, 'Tags', tags, `Höchstens ${META_LIMITS.tags} Tags.`),
    h('div', { class: 'field' }, h('label', { for: `${idPrefix}-expires` }, 'Ablaufdatum'), h('div', { class: 'inline' }, expires, clearDate), h('p', { class: 'hint' }, 'Ab dem Folgetag wird der Code als abgelaufen markiert. Leer = läuft nie ab.'))
  );

  return {
    element,
    first: label,
    read: () => ({ label: label.value, purpose: purpose.value, note: note.value, tags: tags.value, expiresAt: expires.value }),
    clear: () => {
      label.value = '';
      purpose.value = '';
      note.value = '';
      tags.value = '';
      expires.value = '';
    }
  };
}
