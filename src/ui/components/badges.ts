/**
 * Getrennte Status-Badges für Syntax, Prüfziffer und Artikelstamm (Spezifikation 5): bewusst KEIN gemeinsamer
 * grüner Haken. Jede Aussage trägt Text (nicht nur Farbe) und bleibt für sich lesbar.
 */
import type { BarcodeItem } from '../../domain/types';
import { formatDateTime, h } from './dom';

/** Tonalität eines Badges. */
export type BadgeTone = 'ok' | 'warn' | 'bad' | 'neutral';

/** Beschreibung eines Badges. */
export interface BadgeInfo {
  key: 'syntax' | 'checksum' | 'catalog';
  label: string;
  text: string;
  tone: BadgeTone;
  /** Zusatzinformation (Tooltip), z. B. Quelle und Datum des Artikelstamm-Abgleichs. */
  title?: string;
}

/**
 * Beschreibt die drei Statusaussagen eines Eintrags.
 * @param item - Eintrag.
 * @returns drei Badges in fester Reihenfolge: Syntax, Prüfziffer, Artikelstamm.
 */
export function describeStatus(item: Pick<BarcodeItem, 'syntaxStatus' | 'checksumStatus' | 'catalogStatus' | 'catalogSource' | 'catalogCheckedAt'>): BadgeInfo[] {
  const syntax: BadgeInfo =
    item.syntaxStatus === 'valid'
      ? { key: 'syntax', label: 'Syntax', text: 'gültig', tone: 'ok' }
      : item.syntaxStatus === 'invalid'
        ? { key: 'syntax', label: 'Syntax', text: 'ungültig', tone: 'bad' }
        : { key: 'syntax', label: 'Syntax', text: 'ungeprüft', tone: 'neutral' };
  const checksum: BadgeInfo =
    item.checksumStatus === 'valid'
      ? { key: 'checksum', label: 'Prüfziffer', text: 'gültig', tone: 'ok' }
      : item.checksumStatus === 'invalid'
        ? { key: 'checksum', label: 'Prüfziffer', text: 'ungültig', tone: 'bad' }
        : item.checksumStatus === 'not-applicable'
          ? { key: 'checksum', label: 'Prüfziffer', text: 'entfällt', tone: 'neutral' }
          : { key: 'checksum', label: 'Prüfziffer', text: 'ungeprüft', tone: 'neutral' };
  const detail = item.catalogCheckedAt ? `Stand ${formatDateTime(item.catalogCheckedAt)}${item.catalogSource ? `, Quelle: ${item.catalogSource}` : ''}` : undefined;
  const catalogText: Record<BarcodeItem['catalogStatus'], { text: string; tone: BadgeTone }> = {
    known: { text: 'bekannt', tone: 'ok' },
    inactive: { text: 'inaktiv', tone: 'warn' },
    unknown: { text: 'unbekannt', tone: 'warn' },
    unchecked: { text: 'ungeprüft', tone: 'neutral' }
  };
  const c = catalogText[item.catalogStatus];
  const catalog: BadgeInfo = { key: 'catalog', label: 'Artikelstamm', text: c.text, tone: c.tone, ...(detail === undefined ? {} : { title: detail }) };
  return [syntax, checksum, catalog];
}

/**
 * Rendert die Badges eines Eintrags.
 * @param item - Eintrag.
 * @returns Container mit drei Badges.
 */
export function statusBadges(item: Parameters<typeof describeStatus>[0]): HTMLElement {
  return h(
    'span',
    { class: 'badges' },
    ...describeStatus(item).map((b) => h('span', { class: `badge badge--${b.tone}`, 'data-badge': b.key, ...(b.title ? { title: b.title } : {}) }, `${b.label}: ${b.text}`))
  );
}
