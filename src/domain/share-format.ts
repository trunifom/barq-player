/**
 * Austauschformat für das Teilen einer einzelnen Sammlung (Datei `*.barq.json`, Text oder Link).
 *
 * Im Gegensatz zum Voll-Backup enthält es nur Name und Codes samt Zusatzangaben (keine IDs, Sitzungen oder Profile).
 * Beim Import entstehen immer neue Datensätze; vorhandene Daten werden nie überschrieben. Jeder Code wird strikt
 * geprüft (Syntax, Prüfziffer, Zusatzangaben); ein einziger Fehler verwirft die ganze Datei mit Zeilenangabe.
 */
import { AppError } from './errors';
import { validateCodeValue } from './bulk-parser';
import { MAX_QUANTITY } from './csv-items';
import { normalizeItemMeta, type ItemMeta } from './item-meta';
import { BACKUP_FORMAT, validateBackup } from './backup-schema';
import type { BarcodeItem, Symbology } from './types';

/** Kennung des Austauschformats. */
export const SHARE_FORMAT = 'barq-player-collection';
/** Aktuelle Schemaversion. */
export const SHARE_SCHEMA_VERSION = 1;
/** Höchstzahl Codes je geteilter Sammlung. */
export const MAX_SHARE_ITEMS = 5000;

const SYMBOLOGIES: readonly Symbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'];

/** Ein Code im Austauschformat. */
export interface ShareItem extends ItemMeta {
  symbology: Symbology;
  /** Immer als String (führende Nullen bleiben erhalten). */
  value: string;
  quantity: number;
}

/** Austauschdatei einer Sammlung. */
export interface ShareFile {
  format: typeof SHARE_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  collection: { name: string };
  items: ShareItem[];
}

function schemaError(details: string): AppError {
  return new AppError('ERR_IMPORT_SCHEMA_INVALID', { details, userMessage: details });
}

/**
 * Baut die Austauschdatei einer Sammlung.
 * @param name - Name der Sammlung.
 * @param items - Einträge (werden nach Position sortiert).
 * @param meta - Exportzeitpunkt und App-Version.
 * @returns Austauschdatei.
 */
export function buildShareFile(name: string, items: readonly BarcodeItem[], meta: { exportedAt: string; appVersion: string }): ShareFile {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return {
    format: SHARE_FORMAT,
    schemaVersion: SHARE_SCHEMA_VERSION,
    exportedAt: meta.exportedAt,
    appVersion: meta.appVersion,
    collection: { name },
    items: sorted.map((i) => ({
      symbology: i.symbology,
      value: i.value,
      quantity: i.quantity,
      ...(i.label === undefined ? {} : { label: i.label }),
      ...(i.purpose === undefined ? {} : { purpose: i.purpose }),
      ...(i.note === undefined ? {} : { note: i.note }),
      ...(i.tags === undefined || i.tags.length === 0 ? {} : { tags: [...i.tags] }),
      ...(i.expiresAt === undefined ? {} : { expiresAt: i.expiresAt })
    }))
  };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function optText(o: Record<string, unknown>, key: string, index: number): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw schemaError(`Code ${index + 1}: „${key}“ muss ein Text sein.`);
  return v;
}

/**
 * Prüft ein bereits geparstes Objekt als Austauschdatei.
 * @param input - unvertrauenswürdiger Wert.
 * @returns bereinigte, vollständig geprüfte Datei.
 * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID` mit Angabe der Position des ersten Fehlers.
 */
export function validateShareFile(input: unknown): ShareFile {
  if (!isRec(input) || input['format'] !== SHARE_FORMAT) throw schemaError('Die Datei ist keine geteilte BarQPlayer-Sammlung.');
  const version = input['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw schemaError('Die Datei hat keine gültige Versionsnummer.');
  if (version > SHARE_SCHEMA_VERSION) throw schemaError(`Die Datei stammt von einer neueren App-Version (Format ${version}). Bitte die App aktualisieren.`);
  const col = input['collection'];
  const name = isRec(col) && typeof col['name'] === 'string' ? col['name'].trim() : '';
  if (name === '') throw schemaError('Die Sammlung in der Datei hat keinen Namen.');
  if (name.length > 100) throw schemaError('Der Sammlungsname in der Datei ist länger als 100 Zeichen.');
  const rawItems = input['items'];
  if (!Array.isArray(rawItems)) throw schemaError('Die Datei enthält keine Liste von Codes.');
  if (rawItems.length > MAX_SHARE_ITEMS) throw schemaError(`Die Datei enthält ${rawItems.length} Codes; erlaubt sind höchstens ${MAX_SHARE_ITEMS}.`);
  const items: ShareItem[] = rawItems.map((raw: unknown, i) => {
    if (!isRec(raw)) throw schemaError(`Code ${i + 1}: ungültiger Eintrag.`);
    const symbology = raw['symbology'];
    if (typeof symbology !== 'string' || !(SYMBOLOGIES as readonly string[]).includes(symbology)) throw schemaError(`Code ${i + 1}: unbekanntes Format.`);
    const value = raw['value'];
    if (typeof value !== 'string') throw schemaError(`Code ${i + 1}: der Wert muss ein Text sein.`);
    const check = validateCodeValue(value, symbology as Symbology, { multiline: true });
    if (!check.ok) throw schemaError(`Code ${i + 1}: ${check.message}`);
    const q = raw['quantity'] ?? 1;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) throw schemaError(`Code ${i + 1}: Menge muss eine ganze Zahl von 1 bis ${MAX_QUANTITY} sein.`);
    const rawTags = raw['tags'];
    if (rawTags !== undefined && (!Array.isArray(rawTags) || rawTags.some((t: unknown) => typeof t !== 'string'))) throw schemaError(`Code ${i + 1}: „tags“ muss eine Liste von Texten sein.`);
    let meta: ItemMeta;
    try {
      meta = normalizeItemMeta({
        label: optText(raw, 'label', i),
        purpose: optText(raw, 'purpose', i),
        note: optText(raw, 'note', i),
        tags: rawTags as string[] | undefined,
        expiresAt: optText(raw, 'expiresAt', i)
      });
    } catch (error: unknown) {
      throw schemaError(`Code ${i + 1}: ${error instanceof AppError ? error.userMessage : 'ungültige Zusatzangaben'}`);
    }
    return { symbology: symbology as Symbology, value: check.value, quantity: q, ...meta };
  });
  const exportedAt = typeof input['exportedAt'] === 'string' ? input['exportedAt'] : '';
  const appVersion = typeof input['appVersion'] === 'string' ? input['appVersion'] : '';
  return { format: SHARE_FORMAT, schemaVersion: version, exportedAt, appVersion, collection: { name }, items };
}

/**
 * Liest eine Austauschdatei aus Text.
 * @param text - JSON-Text.
 * @returns geprüfte Datei.
 * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID`, wenn der Text kein gültiges JSON oder keine gültige Sammlung ist.
 */
export function parseShareText(text: string): ShareFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error: unknown) {
    throw new AppError('ERR_IMPORT_SCHEMA_INVALID', { details: 'JSON ungültig', cause: error, userMessage: 'Die Datei ist kein gültiges JSON und konnte nicht gelesen werden.' });
  }
  return validateShareFile(parsed);
}

/**
 * Wandelt ein Voll-Backup in eine Austauschdatei je Sammlung um (ohne Vorlagen, Profile, Protokolle).
 * @param text - Backup-JSON.
 * @returns eine Austauschdatei pro Sammlung des Backups; Einträge ungültiger Sammlungen führen zu einem Fehler.
 * @throws {AppError} `ERR_IMPORT_SCHEMA_INVALID`, wenn das Backup ungültig ist.
 */
export function shareFilesFromBackupText(text: string): ShareFile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error: unknown) {
    throw new AppError('ERR_IMPORT_SCHEMA_INVALID', { details: 'JSON ungültig', cause: error, userMessage: 'Die Datei ist kein gültiges JSON und konnte nicht gelesen werden.' });
  }
  const result = validateBackup(parsed);
  if (!result.ok) {
    const first = result.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ');
    throw schemaError(`Das Backup ist ungültig (${first}).`);
  }
  const { collections, items } = result.backup.data;
  return collections.map((c) =>
    buildShareFile(
      c.name,
      items.filter((i) => i.collectionId === c.id),
      { exportedAt: result.backup.exportedAt, appVersion: result.backup.appVersion }
    )
  );
}

/**
 * Erkennt die Art eines Textes, den jemand importieren möchte.
 * @param text - Dateiinhalt oder eingefügter Text.
 * @returns `collection` (geteilte Sammlung), `backup` (Voll-Backup), `json-other` (anderes JSON) oder `text` (CSV/Liste).
 */
export function detectImportKind(text: string): 'collection' | 'backup' | 'json-other' | 'text' {
  const t = text.replace(/^﻿/, '').trimStart();
  if (!t.startsWith('{')) return 'text';
  try {
    const parsed: unknown = JSON.parse(t);
    if (isRec(parsed) && parsed['format'] === SHARE_FORMAT) return 'collection';
    if (isRec(parsed) && parsed['format'] === BACKUP_FORMAT) return 'backup';
    return 'json-other';
  } catch {
    // beginnt mit „{“, ist aber kein gültiges JSON → wird später mit klarer Meldung abgelehnt
    return 'json-other';
  }
}

/**
 * Erzeugt eine einfache Textliste (`Format<TAB>Wert<TAB>Menge<TAB>Wort`) zum Einfügen in Chats oder Tabellen.
 * @param name - Sammlungsname (Überschrift).
 * @param items - Einträge.
 * @returns Mehrzeiliger Text.
 */
export function itemsToPlainText(name: string, items: readonly BarcodeItem[]): string {
  const lines = [...items]
    .sort((a, b) => a.position - b.position)
    .map((i) => [i.value, i.quantity > 1 ? `x${i.quantity}` : '', i.label ?? '', i.expiresAt ? `bis ${i.expiresAt}` : ''].filter((p) => p !== '').join('  '));
  return [name, ...lines].join('\n');
}
