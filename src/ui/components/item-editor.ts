/**
 * Dialog zum Bearbeiten der Zusatzangaben eines gespeicherten Codes (Wort, Nutzen, Satz, Tags, Ablaufdatum).
 * Wert, Format und Menge bleiben unverändert; Fehler (z. B. ungültiges Datum) erscheinen im Dialog.
 */
import { AppError } from '../../domain/errors';
import type { BarcodeItem } from '../../domain/types';
import type { AppContext } from '../../app/container';
import { formDialog } from './dialog';
import { h } from './dom';
import { metaFields } from './meta-fields';

/**
 * Öffnet den Detaildialog zu einem Eintrag und speichert die Änderungen.
 * @param ctx - App-Kontext.
 * @param item - zu bearbeitender Eintrag.
 * @returns der gespeicherte Eintrag oder `null` bei Abbruch.
 */
export async function editItemDetails(ctx: AppContext, item: BarcodeItem): Promise<BarcodeItem | null> {
  const fields = metaFields('ed', item);
  const shown = item.value.length > 80 ? `${item.value.slice(0, 80)}…` : item.value;
  let saved: BarcodeItem | null = null;
  const ok = await formDialog({
    title: 'Details zum Code',
    body: h('div', null, h('p', { class: 'hint' }, 'Code: ', h('code', null, shown)), fields.element),
    focus: fields.first,
    onSubmit: async () => {
      try {
        saved = await ctx.collections.updateItemMeta(item.id, fields.read());
        return null;
      } catch (error: unknown) {
        if (error instanceof AppError) return error.userMessage;
        throw error;
      }
    }
  });
  return ok ? saved : null;
}
