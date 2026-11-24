/**
 * Zugängliche modale Dialoge (Bestätigen, Texteingabe) ohne `<dialog>`-Abhängigkeit.
 * Fokus wandert in den Dialog, `Escape` bricht ab, der vorherige Fokus wird wiederhergestellt.
 */
import { h } from './dom';

/** Optionen eines Bestätigungsdialogs. */
export interface ConfirmOptions {
  title: string;
  message: string | Node;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Hebt die Bestätigung als gefährlich hervor (z. B. Löschen, Wiederherstellen). */
  danger?: boolean;
}

/** Optionen eines Eingabedialogs. */
export interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  /** Liefert eine Fehlermeldung oder `null`, wenn der Wert gültig ist. */
  validate?: (value: string) => string | null;
}

let dialogCounter = 0;

function open<T>(build: (close: (value: T) => void, titleId: string) => { dialog: HTMLElement; focus: HTMLElement; cancelValue: T }): Promise<T> {
  return new Promise<T>((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const titleId = `dialog-title-${++dialogCounter}`;
    const overlay = h('div', { class: 'dialog-overlay' });
    let settled = false;
    const close = (value: T): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previous?.focus?.();
      resolve(value);
    };
    const built = build(close, titleId);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(built.cancelValue);
      }
    };
    overlay.appendChild(built.dialog);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    built.focus.focus();
  });
}

/**
 * Zeigt einen Bestätigungsdialog.
 * @param options - Titel, Text und Beschriftungen.
 * @returns `true` bei Bestätigung, sonst `false` (Abbrechen, Escape).
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return open<boolean>((close, titleId) => {
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, options.cancelLabel ?? 'Abbrechen');
    const ok = h('button', { type: 'button', class: `btn ${options.danger === true ? 'btn--danger' : 'btn--primary'}`, onclick: () => close(true) }, options.confirmLabel ?? 'OK');
    const dialog = h(
      'div',
      { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, options.title),
      h('div', { class: 'dialog__body' }, options.message),
      h('div', { class: 'dialog__actions' }, cancel, ok)
    );
    return { dialog, focus: options.danger === true ? cancel : ok, cancelValue: false };
  });
}

/**
 * Zeigt einen Eingabedialog mit Validierung.
 * @param options - Titel, Beschriftung, Startwert, Validierung.
 * @returns eingegebener Text oder `null` bei Abbruch.
 */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return open<string | null>((close, titleId) => {
    const inputId = `${titleId}-input`;
    const error = h('p', { class: 'field__error', role: 'alert' });
    const input = h('input', { type: 'text', id: inputId, class: 'input', value: options.initial ?? '', 'aria-describedby': `${inputId}-err` });
    error.id = `${inputId}-err`;
    const submit = (): void => {
      const value = input.value;
      const problem = options.validate ? options.validate(value) : null;
      if (problem) {
        error.textContent = problem;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      close(value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    const dialog = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, options.title),
      h('div', { class: 'field' }, h('label', { for: inputId }, options.label), input, error),
      h('div', { class: 'dialog__actions' }, h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Abbrechen'), h('button', { type: 'button', class: 'btn btn--primary', onclick: submit }, options.confirmLabel ?? 'OK'))
    );
    return { dialog, focus: input, cancelValue: null };
  });
}
