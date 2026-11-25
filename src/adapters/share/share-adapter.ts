/**
 * Anbindung an die Teilen-Funktionen des Geräts: Web Share API (Dateien und Text), Zwischenablage und Download.
 *
 * Die Funktionen nehmen die Browser-Objekte als Parameter, damit sie ohne echtes Gerät testbar sind. Ein
 * abgebrochener Teilen-Dialog ist kein Fehler (`'cancelled'`); fehlende Unterstützung wird gemeldet, damit die
 * Oberfläche auf Download bzw. Kopieren ausweichen kann.
 */

/** Ausgang eines Teilen-Versuchs. */
export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

/** Minimale Teilen-Schnittstelle von `navigator`. */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Teilt eine Datei über das Teilen-Menü des Geräts (WhatsApp, E-Mail, Signal, Drive …).
 * @param nav - `navigator` oder Testersatz.
 * @param file - zu teilende Datei.
 * @param title - Titel/Betreff.
 * @returns `shared`, `cancelled` oder `unsupported` (kein Dateiteilen verfügbar).
 * @throws bei anderen Fehlern des Betriebssystems (z. B. fehlende Berechtigung).
 */
export async function shareFile(nav: ShareNavigator, file: File, title: string): Promise<ShareOutcome> {
  const data: ShareData = { files: [file], title };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || !nav.canShare(data)) return 'unsupported';
  try {
    await nav.share(data);
    return 'shared';
  } catch (error: unknown) {
    if (isAbort(error)) return 'cancelled';
    throw error;
  }
}

/**
 * Teilt Text und/oder einen Link über das Teilen-Menü.
 * @param nav - `navigator` oder Testersatz.
 * @param data - Titel, Text, Link.
 * @returns `shared`, `cancelled` oder `unsupported`.
 * @throws bei anderen Fehlern des Betriebssystems.
 */
export async function shareText(nav: ShareNavigator, data: { title: string; text?: string; url?: string }): Promise<ShareOutcome> {
  if (typeof nav.share !== 'function') return 'unsupported';
  try {
    await nav.share(data);
    return 'shared';
  } catch (error: unknown) {
    if (isAbort(error)) return 'cancelled';
    throw error;
  }
}

/**
 * Kopiert Text in die Zwischenablage.
 * @param nav - `navigator` oder Testersatz.
 * @param text - Text.
 * @returns `true`, wenn kopiert wurde; `false`, wenn die Zwischenablage nicht verfügbar oder gesperrt ist.
 */
export async function copyText(nav: ShareNavigator, text: string): Promise<boolean> {
  if (!nav.clipboard) return false;
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false; // z. B. Berechtigung verweigert – die Oberfläche bietet dann Download an
  }
}

/**
 * Teilt JSON-Inhalt als Datei. Zuerst wird `<name>.json` versucht; erlaubt der Browser (z. B. Chrome auf Android)
 * dafür kein Teilen, wird derselbe Inhalt als `<name>.txt` angeboten. Beim Import wird die Art immer am Inhalt erkannt,
 * die Endung spielt keine Rolle.
 * @param nav - `navigator` oder Testersatz.
 * @param baseName - Dateiname ohne Endung.
 * @param json - Inhalt.
 * @param title - Titel/Betreff.
 * @returns `shared`, `cancelled` oder `unsupported` (dann Download anbieten).
 * @throws bei anderen Fehlern des Betriebssystems.
 */
export async function shareJsonFile(nav: ShareNavigator, baseName: string, json: string, title: string): Promise<ShareOutcome> {
  const asJson = await shareFile(nav, new File([json], `${baseName}.json`, { type: 'application/json' }), title);
  if (asJson !== 'unsupported') return asJson;
  return shareFile(nav, new File([json], `${baseName}.txt`, { type: 'text/plain' }), title);
}
