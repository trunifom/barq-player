/**
 * Teilen und Sichern aus der Oberfläche: Datei (Teilen-Menü oder Download), Link, Text und Voll-Backup.
 *
 * Jede Funktion weicht bei fehlender Geräteunterstützung auf eine Alternative aus (Download, Zwischenablage, Dialog mit
 * Link) und meldet das Ergebnis verständlich. Es wird nie behauptet, etwas sei „gesendet“, wenn nur eine Datei
 * heruntergeladen oder ein Link kopiert wurde.
 */
import { buildShareLink, encodeSharePayload, MAX_LINK_PAYLOAD } from '../../adapters/share/link-codec';
import { copyText, shareJsonFile, shareText, type ShareNavigator } from '../../adapters/share/share-adapter';
import type { AppContext } from '../../app/container';
import { confirmDialog } from './dialog';
import { downloadText, h } from './dom';

/** Dateiname-tauglicher Text. */
export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'sammlung';
}

function nav(): ShareNavigator {
  return navigator as unknown as ShareNavigator;
}

/**
 * Teilt eine Sammlung als Datei über das Teilen-Menü des Geräts; ohne Unterstützung wird die Datei heruntergeladen.
 * @param ctx - App-Kontext.
 * @param collectionId - Sammlung.
 */
export async function shareCollectionFile(ctx: AppContext, collectionId: string): Promise<void> {
  try {
    const { name, json } = await ctx.backup.exportCollectionShare(collectionId);
    const base = `${safeFileName(name)}.barq`;
    const outcome = await shareJsonFile(nav(), base, json, `BarQPlayer: ${name}`);
    if (outcome === 'shared') ctx.notify.success('Teilen-Menü geöffnet und Datei übergeben.');
    else if (outcome === 'unsupported') {
      downloadText(`${base}.json`, json, 'application/json');
      ctx.notify.info('Dieses Gerät kann Dateien nicht direkt teilen. Die Datei wurde heruntergeladen (Ordner „Downloads“); senden Sie sie von dort weiter.');
    }
  } catch (error: unknown) {
    ctx.notify.error(error, { source: 'share-file' });
  }
}

/**
 * Teilt eine Sammlung als Link (der Inhalt steckt komprimiert im Link, kein Server beteiligt).
 * @param ctx - App-Kontext.
 * @param collectionId - Sammlung.
 */
export async function shareCollectionLink(ctx: AppContext, collectionId: string): Promise<void> {
  try {
    const { name, json } = await ctx.backup.exportCollectionShare(collectionId, { compact: true });
    const payload = await encodeSharePayload(json);
    if (payload.length > MAX_LINK_PAYLOAD) {
      ctx.notify.info('Diese Sammlung ist für einen Link zu groß. Bitte als Datei teilen.');
      return;
    }
    const link = buildShareLink(location.href, payload);
    const outcome = await shareText(nav(), { title: `BarQPlayer: ${name}`, text: `Sammlung „${name}“ in BarQPlayer öffnen`, url: link });
    if (outcome === 'shared') {
      ctx.notify.success('Link übergeben.');
    } else if (outcome === 'unsupported') {
      if (await copyText(nav(), link)) ctx.notify.success('Link in die Zwischenablage kopiert. Fügen Sie ihn in eine Nachricht ein.');
      else await showLinkDialog(link);
    }
  } catch (error: unknown) {
    ctx.notify.error(error, { source: 'share-link' });
  }
}

async function showLinkDialog(link: string): Promise<void> {
  const box = h('textarea', { class: 'input textarea', rows: 5, readonly: true, 'aria-label': 'Link zum Kopieren' });
  box.value = link;
  await confirmDialog({ title: 'Link zum Teilen', message: h('div', null, h('p', { class: 'hint' }, 'Markieren und kopieren Sie den Link:'), box), confirmLabel: 'Schließen', cancelLabel: 'Abbrechen' });
}

/**
 * Kopiert eine Sammlung als Textliste in die Zwischenablage; ohne Zwischenablage wird eine Textdatei heruntergeladen.
 * @param ctx - App-Kontext.
 * @param collectionId - Sammlung.
 */
export async function copyCollectionText(ctx: AppContext, collectionId: string): Promise<void> {
  try {
    const { name, text } = await ctx.backup.exportCollectionText(collectionId);
    if (await copyText(nav(), text)) {
      ctx.notify.success('Liste in die Zwischenablage kopiert.');
    } else {
      downloadText(`${safeFileName(name)}.txt`, text, 'text/plain;charset=utf-8');
      ctx.notify.info('Die Zwischenablage ist nicht verfügbar. Die Liste wurde als Textdatei heruntergeladen.');
    }
  } catch (error: unknown) {
    ctx.notify.error(error, { source: 'share-text' });
  }
}

/**
 * Lädt das Voll-Backup herunter und merkt sich den Zeitpunkt für die Backup-Erinnerung.
 * @param ctx - App-Kontext.
 */
export async function downloadBackup(ctx: AppContext): Promise<void> {
  try {
    downloadText(`barqplayer-backup-${ctx.nowIso().slice(0, 10)}.json`, await ctx.backup.exportJson(), 'application/json');
    ctx.settings.update({ lastBackupAt: ctx.nowIso() });
    ctx.notify.success('Backup heruntergeladen (Ordner „Downloads“).');
  } catch (error: unknown) {
    ctx.notify.error(error, { source: 'backup-download' });
  }
}

/**
 * Sendet das Voll-Backup über das Teilen-Menü (z. B. an sich selbst per E-Mail oder in die Cloud); ohne Unterstützung wird es heruntergeladen.
 * @param ctx - App-Kontext.
 */
export async function shareBackup(ctx: AppContext): Promise<void> {
  try {
    const json = await ctx.backup.exportJson();
    const base = `barqplayer-backup-${ctx.nowIso().slice(0, 10)}`;
    const outcome = await shareJsonFile(nav(), base, json, 'BarQPlayer-Backup');
    if (outcome === 'unsupported') {
      downloadText(`${base}.json`, json, 'application/json');
      ctx.settings.update({ lastBackupAt: ctx.nowIso() });
      ctx.notify.info('Dieses Gerät kann Dateien nicht direkt teilen. Das Backup wurde heruntergeladen.');
    } else if (outcome === 'shared') {
      ctx.settings.update({ lastBackupAt: ctx.nowIso() });
      ctx.notify.success('Backup an das Teilen-Menü übergeben.');
    }
  } catch (error: unknown) {
    ctx.notify.error(error, { source: 'backup-share' });
  }
}
