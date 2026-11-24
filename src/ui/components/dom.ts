/**
 * Minimale, sichere DOM-Helfer ohne Framework.
 *
 * Sicherheitsgrundsatz: Texte werden IMMER als Text-Knoten eingefügt (nie `innerHTML`). Sammlungsnamen, QR-Inhalte,
 * Dateinamen und Fehlertexte sind unvertrauenswürdige Daten und dürfen nie als Markup interpretiert werden.
 */

/** Zulässige Kindelemente. */
export type Child = Node | string | number | null | undefined | false;

/** Wert eines Attributs/Handlers. */
export type PropValue = string | number | boolean | null | undefined | ((event: Event) => void);

/** Attribute und Ereignishandler (`onclick`, `onchange`, … → `addEventListener`). */
export type Props = Record<string, PropValue>;

/**
 * Erzeugt ein Element.
 * - `class`, `id`, `type`, `aria-*`, `data-*` usw. werden als Attribute gesetzt (`true` → leeres Attribut, `false`/`null`/`undefined` → weggelassen).
 * - `value`, `checked`, `disabled`, `selected` werden als Eigenschaften gesetzt.
 * - Schlüssel mit Präfix `on` registrieren Ereignishandler.
 * @param tag - Elementname.
 * @param props - Attribute und Handler.
 * @param children - Kinder (Strings werden zu Text-Knoten, `false`/`null` übersprungen).
 * @returns das Element.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === 'function') {
      el.addEventListener(key.replace(/^on/, '').toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

/**
 * Hängt Kinder an (Strings/Zahlen als Text-Knoten).
 * @param parent - Elternknoten.
 * @param children - Kinder.
 */
export function append(parent: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/**
 * Ersetzt den Inhalt eines Elements.
 * @param parent - Element.
 * @param children - neue Kinder.
 */
export function setChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

/**
 * Wandelt einen SVG-String des Renderers in ein DOM-Element (über den XML-Parser, ohne `innerHTML`).
 * @param svg - vollständiges SVG-Dokument.
 * @returns das importierte SVG-Element.
 * @throws {Error} wenn der String kein wohlgeformtes SVG ist.
 */
export function svgElement(svg: string): SVGElement {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg') throw new Error('Ungültiges SVG');
  return document.importNode(root, true) as unknown as SVGElement;
}

/**
 * Löst einen Download im Browser aus.
 * @param filename - Dateiname.
 * @param text - Inhalt.
 * @param mime - MIME-Typ.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Formatiert einen ISO-Zeitstempel für die Anzeige (Ortszeit, deutsch).
 * @param iso - ISO-Zeitstempel.
 * @returns lesbarer Text; bei ungültigem Wert der Originaltext.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'medium' });
}
