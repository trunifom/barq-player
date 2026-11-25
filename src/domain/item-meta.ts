/**
 * Zusatzangaben eines Codes: Wort (Bezeichnung), Nutzen, Satz (Notiz), Tags und Ablaufdatum.
 *
 * Alle Angaben sind optional. Die Prüfung ist streng, aber verständlich: zu lange Texte oder ein ungültiges
 * Datum werden mit einer klaren Meldung abgelehnt, nie stillschweigend gekürzt oder korrigiert.
 */
import { AppError } from './errors';
import { parseDateInput } from './expiry';

/** Grenzen der Zusatzangaben. */
export const META_LIMITS = Object.freeze({
  /** Wort / Bezeichnung. */
  label: 100,
  /** Nutzen / Verwendungszweck. */
  purpose: 100,
  /** Satz / Notiz. */
  note: 500,
  /** Länge eines einzelnen Tags. */
  tag: 30,
  /** Anzahl Tags je Code. */
  tags: 10
});

/** Normalisierte Zusatzangaben (nur gesetzte Felder sind vorhanden). */
export interface ItemMeta {
  label?: string;
  purpose?: string;
  note?: string;
  tags?: string[];
  /** Ablaufdatum `JJJJ-MM-TT`. */
  expiresAt?: string;
}

/** Rohe Eingabe der Zusatzangaben (z. B. aus Formularen oder Dateien). */
export interface ItemMetaInput {
  label?: string | undefined;
  purpose?: string | undefined;
  note?: string | undefined;
  /** Liste oder Text mit Trennzeichen `,` `;` `|` bzw. Zeilenumbruch. */
  tags?: readonly string[] | string | undefined;
  /** Datum in `JJJJ-MM-TT` oder `TT.MM.JJJJ`; leer = kein Ablaufdatum. */
  expiresAt?: string | undefined;
}

function bad(message: string): AppError {
  return new AppError('ERR_SYNTAX_INVALID', { details: message, userMessage: message });
}

/**
 * Zerlegt einen Tag-Text in einzelne Tags (Trennzeichen `,` `;` `|` Zeilenumbruch; führendes `#` entfällt;
 * Duplikate ohne Rücksicht auf Groß-/Kleinschreibung entfallen, die erste Schreibweise gewinnt).
 * @param text - Eingabetext.
 * @returns bereinigte Tags in Eingabereihenfolge.
 */
export function parseTags(text: string): string[] {
  return dedupeTags(text.split(/[,;|\n\r]+/));
}

function dedupeTags(parts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const tag = raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');
    if (tag === '') continue;
    const key = tag.toLocaleLowerCase('de');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function cleanText(value: string | undefined, max: number, name: string): string | undefined {
  if (value === undefined) return undefined;
  const t = value.trim();
  if (t === '') return undefined;
  if (t.length > max) throw bad(`${name}: höchstens ${max} Zeichen erlaubt (aktuell ${t.length}).`);
  return t;
}

/**
 * Prüft und normalisiert Zusatzangaben.
 * @param input - Rohdaten; leere Texte bedeuten „nicht gesetzt“.
 * @returns normalisierte Angaben (nur gesetzte Felder).
 * @throws {AppError} `ERR_SYNTAX_INVALID` mit verständlicher Meldung bei zu langen Texten, zu vielen/zu langen Tags
 * oder ungültigem Datum.
 */
export function normalizeItemMeta(input: ItemMetaInput): ItemMeta {
  const label = cleanText(input.label, META_LIMITS.label, 'Wort');
  const purpose = cleanText(input.purpose, META_LIMITS.purpose, 'Nutzen');
  const note = cleanText(input.note, META_LIMITS.note, 'Satz');
  const tags = input.tags === undefined ? [] : typeof input.tags === 'string' ? parseTags(input.tags) : dedupeTags(input.tags);
  if (tags.length > META_LIMITS.tags) throw bad(`Tags: höchstens ${META_LIMITS.tags} Tags je Code erlaubt (aktuell ${tags.length}).`);
  const longTag = tags.find((t) => t.length > META_LIMITS.tag);
  if (longTag !== undefined) throw bad(`Tag „${longTag.slice(0, 20)}…“ ist zu lang (höchstens ${META_LIMITS.tag} Zeichen).`);
  let expiresAt: string | undefined;
  const rawDate = input.expiresAt?.trim() ?? '';
  if (rawDate !== '') {
    const iso = parseDateInput(rawDate);
    if (iso === null) throw bad(`Ablaufdatum „${rawDate.slice(0, 20)}“ ist ungültig. Bitte Tag.Monat.Jahr (z. B. 31.12.2026) verwenden.`);
    expiresAt = iso;
  }
  return {
    ...(label === undefined ? {} : { label }),
    ...(purpose === undefined ? {} : { purpose }),
    ...(note === undefined ? {} : { note }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(expiresAt === undefined ? {} : { expiresAt })
  };
}

/**
 * Füllt in `base` nur fehlende Angaben aus `extra` auf (vorhandene Angaben bleiben unverändert).
 * @param base - bestehende Angaben.
 * @param extra - ergänzende Angaben.
 * @returns zusammengeführte Angaben; Tags werden vereinigt.
 */
export function fillMissingMeta(base: ItemMeta, extra: ItemMeta): ItemMeta {
  const tags = dedupeTags([...(base.tags ?? []), ...(extra.tags ?? [])]).slice(0, META_LIMITS.tags);
  const label = base.label ?? extra.label;
  const purpose = base.purpose ?? extra.purpose;
  const note = base.note ?? extra.note;
  const expiresAt = base.expiresAt ?? extra.expiresAt;
  return {
    ...(label === undefined ? {} : { label }),
    ...(purpose === undefined ? {} : { purpose }),
    ...(note === undefined ? {} : { note }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(expiresAt === undefined ? {} : { expiresAt })
  };
}

/**
 * Prüft, ob ein Eintrag zu einem Suchtext passt (Wert, Wort, Nutzen, Satz, Tags; ohne Groß-/Kleinschreibung).
 * @param item - Eintrag mit Zusatzangaben.
 * @param query - Suchtext (leer = alles).
 * @returns `true` bei Treffer.
 */
export function matchesQuery(item: ItemMeta & { value: string }, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('de');
  if (q === '') return true;
  const hay = [item.value, item.label, item.purpose, item.note, ...(item.tags ?? [])].filter((s): s is string => typeof s === 'string').join('\n').toLocaleLowerCase('de');
  return hay.includes(q);
}

/**
 * Sammelt alle verwendeten Tags (eindeutig, alphabetisch).
 * @param items - Einträge.
 * @returns sortierte Tag-Liste.
 */
export function collectTags(items: readonly ItemMeta[]): string[] {
  return dedupeTags(items.flatMap((i) => i.tags ?? [])).sort((a, b) => a.localeCompare(b, 'de'));
}
