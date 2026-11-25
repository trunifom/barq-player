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

/** Ergebnis des Aufbaus eines eigenen Dialogs. */
export interface DialogBuild<T> {
  dialog: HTMLElement;
  /** Element, das beim Öffnen den Fokus erhält. */
  focus: HTMLElement;
  /** Ergebnis bei Abbruch (Escape). */
  cancelValue: T;
}

/**
 * Öffnet einen eigenen modalen Dialog mit Fokusverwaltung und Escape-Abbruch.
 * @param build - baut den Dialog; erhält die Schließfunktion und die ID für `aria-labelledby`.
 * @returns Wert, mit dem der Dialog geschlossen wurde.
 */
export function openDialog<T>(build: (close: (value: T) => void, titleId: string) => DialogBuild<T>): Promise<T> {
  return open(build);
}

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

/** Optionen eines Formulardialogs. */
export interface FormDialogOptions {
  title: string;
  /** Formularinhalt (Felder). */
  body: Node;
  confirmLabel?: string;
  /** Element mit Starfokus. */
  focus?: HTMLElement;
  /**
   * Wird beim Bestätigen aufgerufen. Liefert eine Fehlermeldung (Dialog bleibt offen) oder `null` (Dialog schließt, Ergebnis `true`).
   * Eine geworfene Ausnahme wird als Meldung angezeigt, damit der Dialog nie hängen bleibt.
   */
  onSubmit: () => Promise<string | null> | string | null;
}

/**
 * Zeigt einen Dialog mit frei gestalteten Feldern und Prüfung beim Bestätigen.
 * @param options - Titel, Felder und Prüfroutine.
 * @returns `true`, wenn bestätigt und gespeichert wurde, sonst `false`.
 */
export function formDialog(options: FormDialogOptions): Promise<boolean> {
  return open<boolean>((close, titleId) => {
    const error = h('p', { class: 'field__error', role: 'alert', id: `${titleId}-err` });
    const ok = h('button', { type: 'button', class: 'btn btn--primary', 'data-dialog-ok': true }, options.confirmLabel ?? 'Speichern');
    ok.addEventListener('click', () => {
      ok.disabled = true;
      error.textContent = '';
      void (async () => {
        try {
          const problem = await options.onSubmit();
          if (problem === null) {
            close(true);
            return;
          }
          error.textContent = problem;
        } catch (e: unknown) {
          error.textContent = e instanceof Error && e.message !== '' ? e.message : 'Das Speichern ist fehlgeschlagen.';
        }
        ok.disabled = false;
      })();
    });
    const cancel = h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, 'Abbrechen');
    const dialog = h(
      'div',
      { class: 'dialog dialog--form', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { id: titleId }, options.title),
      h('div', { class: 'dialog__body' }, options.body, error),
      h('div', { class: 'dialog__actions' }, cancel, ok)
    );
    return { dialog, focus: options.focus ?? ok, cancelValue: false };
  });
}
