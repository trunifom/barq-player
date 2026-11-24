/**
 * Sichere Einordnung von QR-Inhalten (AGENTS.md / Spezifikation 4.3): QR-Inhalte sind DATEN.
 * Die App öffnet nie automatisch Links und führt nie Befehle aus; diese Einordnung dient nur der
 * Anzeige („Inhalt vor der Übernahme sichtbar machen“).
 */

/** Art des QR-Inhalts. */
export type QrContentKind = 'url' | 'wifi' | 'contact' | 'text';

/** Einordnung eines QR-Inhalts. */
export interface QrContentInfo {
  kind: QrContentKind;
  /** URL-Schema (kleingeschrieben), z. B. `https`, `javascript`, `tel`. */
  scheme?: string;
  /** `true` bei Schemata, die beim Öffnen Code ausführen könnten (`javascript`, `data`, `vbscript`, `file`). */
  risky: boolean;
  /** Fester deutscher Hinweis für die Anzeige. */
  notice: string;
}

const RISKY_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob']);

/**
 * Ordnet einen QR-Text ein, ohne ihn zu verändern oder auszuführen.
 * @param text - QR-Inhalt.
 * @returns Art, ggf. Schema und Risikokennzeichen samt Anzeigehinweis.
 */
export function classifyQrContent(text: string): QrContentInfo {
  const t = text.trimStart();
  if (/^WIFI:/i.test(t)) return { kind: 'wifi', risky: false, notice: 'WLAN-Zugangsdaten – werden nicht verwendet, nur gespeichert.' };
  if (/^(BEGIN:VCARD|MECARD:)/i.test(t)) return { kind: 'contact', risky: false, notice: 'Kontaktdaten – werden nicht verwendet, nur gespeichert.' };
  const m = /^([a-z][a-z0-9+.-]{1,31}):/i.exec(t);
  if (m && m[1]) {
    const scheme = m[1].toLowerCase();
    const risky = RISKY_SCHEMES.has(scheme);
    return {
      kind: 'url',
      scheme,
      risky,
      notice: risky ? 'Achtung: gefährliches Link-Schema. Der Inhalt wird nie geöffnet oder ausgeführt.' : 'Link – wird nie automatisch geöffnet.'
    };
  }
  return { kind: 'text', risky: false, notice: 'Reiner Text.' };
}
