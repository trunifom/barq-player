/**
 * Einstellungen-Screen: Scannerprofile, Kalibrierung, Artikelstamm-Import, Persistenzstatus, JSON-Backup und
 * geprüfter Restore, Rückmeldungen, Diagnose-Fehlerlog.
 */
import { AppError } from '../../domain/errors';
import { MIN_BLANK_MS } from '../../domain/profiles';
import type { FaderProfile } from '../../domain/types';
import { requestPersistentStorage, type PersistenceStatus } from '../../adapters/persistence/db';
import type { AppContext } from '../../app/container';
import type { Dispose, Route } from '../../app/routes';
import type { CsvImportReport } from '../../application/backup-service';
import { confirmDialog } from '../components/dialog';
import { downloadText, formatDateTime, h, setChildren } from '../components/dom';

/** Liest eine Textdatei (Standard: `File.text()`). */
function readText(file: Blob): Promise<string> {
  return file.text();
}

/** Formatiert Bytes für die Anzeige. */
export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'unbekannt';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Mountet den Einstellungen-Screen.
 * @param root - Wurzelelement.
 * @param ctx - App-Kontext.
 * @param _route - Route (ungenutzt).
 * @returns Aufräumfunktion.
 */
export function mountSettings(root: HTMLElement, ctx: AppContext, _route: Route): Dispose {
  let alive = true;
  const fail = (source: string) => (error: unknown): void => {
    ctx.notify.error(error, { source });
  };

  // ------------------------------------------------------------------ Profile
  const profilesBox = h('div', { id: 'st-profiles' });
  const loadProfiles = async (): Promise<void> => {
    try {
      const list = await ctx.collections.listProfiles();
      if (!alive) return;
      setChildren(profilesBox, h('ul', { class: 'plain-list' }, ...list.map(profileRow)), h('button', { type: 'button', class: 'btn', id: 'st-profile-new', onclick: () => editProfile(null) }, 'Neues Profil'));
    } catch (error: unknown) {
      fail('settings-profiles')(error);
    }
  };

  const profileRow = (p: FaderProfile): HTMLElement =>
    h(
      'li',
      { class: 'card', 'data-profile': p.id },
      h('strong', null, p.name),
      h('span', { class: 'hint' }, ` Anzeige ${p.displayMs} ms · Leerzeit ${p.blankMs} ms · identische Codes ${p.identicalBlankMs} ms · Start ${p.startDelayMs} ms`),
      p.notes ? h('div', { class: 'hint' }, p.notes) : null,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', 'data-edit': p.id, onclick: () => editProfile(p) }, 'Bearbeiten'), h('button', { type: 'button', class: 'btn btn--danger', 'data-delete': p.id, onclick: () => void deleteProfile(p) }, 'Löschen'))
    );

  const editProfile = (p: FaderProfile | null): void => {
    const num = (id: string, label: string, value: number, min: number): { field: HTMLElement; input: HTMLInputElement } => {
      const input = h('input', { id, class: 'input', type: 'number', min, value });
      return { field: h('div', { class: 'field' }, h('label', { for: id }, label), input), input };
    };
    const name = h('input', { id: 'pf-name', class: 'input', type: 'text', value: p?.name ?? '' });
    const display = num('pf-display', 'Anzeigezeit (ms)', p?.displayMs ?? 500, 1);
    const blank = num('pf-blank', `Leerzeit vor anderem Code (ms, mind. ${MIN_BLANK_MS})`, p?.blankMs ?? 150, MIN_BLANK_MS);
    const identical = num('pf-identical', `Leerzeit vor identischem Code (ms, mind. ${MIN_BLANK_MS})`, p?.identicalBlankMs ?? 400, MIN_BLANK_MS);
    const delay = num('pf-delay', 'Startverzögerung (ms)', p?.startDelayMs ?? 3000, 0);
    const err = h('p', { class: 'field__error', id: 'pf-error', role: 'alert' });
    const form = h(
      'div',
      { class: 'card', id: 'st-profile-form' },
      h('h3', null, p ? 'Profil bearbeiten' : 'Neues Profil'),
      h('div', { class: 'field' }, h('label', { for: 'pf-name' }, 'Name'), name),
      display.field,
      blank.field,
      identical.field,
      delay.field,
      err,
      h(
        'div',
        { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn--primary', id: 'pf-save', onclick: () => {
          const profile: FaderProfile = {
            id: p?.id ?? `profile-${ctx.nowIso().replace(/\D/g, '')}`,
            name: name.value.trim(),
            displayMs: Number(display.input.value),
            blankMs: Number(blank.input.value),
            identicalBlankMs: Number(identical.input.value),
            startDelayMs: Number(delay.input.value),
            ...(p?.notes ? { notes: p.notes } : {})
          };
          ctx.collections
            .saveProfile(profile)
            .then(() => {
              ctx.notify.success('Profil gespeichert.');
              return loadProfiles();
            })
            .catch((error: unknown) => {
              err.textContent = error instanceof AppError ? error.userMessage : 'Das Profil konnte nicht gespeichert werden.';
              if (!(error instanceof AppError)) fail('settings-profile-save')(error);
            });
        } }, 'Speichern'),
        h('button', { type: 'button', class: 'btn', onclick: () => void loadProfiles() }, 'Abbrechen')
      )
    );
    profilesBox.append(form);
    name.focus();
  };

  const deleteProfile = async (p: FaderProfile): Promise<void> => {
    if (!(await confirmDialog({ title: 'Profil löschen?', message: `Profil „${p.name}“ wird gelöscht.`, confirmLabel: 'Löschen', danger: true }))) return;
    try {
      await ctx.collections.deleteProfile(p.id);
      await loadProfiles();
    } catch (error: unknown) {
      fail('settings-profile-delete')(error);
    }
  };

  // ------------------------------------------------------------------ Artikelstamm
  const catalogInfo = h('p', { class: 'hint', id: 'st-catalog-info' });
  const catalogOut = h('div', { id: 'st-catalog-out', 'aria-live': 'polite' });
  const catalogSkip = h('input', { type: 'checkbox', id: 'st-catalog-skip' });
  const catalogFile = h('input', { type: 'file', id: 'st-catalog-file', accept: '.csv,text/csv', class: 'input' });
  const refreshCatalogInfo = async (): Promise<void> => {
    try {
      const n = await ctx.collections.catalogSize();
      if (alive) catalogInfo.textContent = n === 0 ? 'Kein Artikelstamm importiert.' : `${n} Artikel im importierten Artikelstamm.`;
    } catch (error: unknown) {
      fail('settings-catalog-size')(error);
    }
  };
  const showReport = (target: HTMLElement, report: CsvImportReport, what: string): void => {
    setChildren(
      target,
      h('p', { class: report.aborted ? 'field__error' : 'hint', id: `${target.id}-summary` }, report.aborted ? `Import abgebrochen: ${report.errors.length} fehlerhafte Zeile(n). Es wurde nichts importiert.` : `${report.imported} ${what} importiert${report.errors.length > 0 ? `, ${report.errors.length} fehlerhafte Zeile(n) übersprungen` : ''}.`),
      report.errors.length > 0 ? h('ul', { class: 'errors' }, ...report.errors.slice(0, 50).map((e) => h('li', null, e.message)), report.errors.length > 50 ? h('li', null, `… und ${report.errors.length - 50} weitere`) : null) : null
    );
  };
  catalogFile.addEventListener('change', () => {
    const file = catalogFile.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const report = await ctx.backup.importCatalogCsv(await readText(file), file.name, catalogSkip.checked ? 'skip-invalid' : 'abort');
        showReport(catalogOut, report, 'Artikel');
        if (!report.aborted) ctx.notify.success('Artikelstamm importiert.');
        await refreshCatalogInfo();
      } catch (error: unknown) {
        fail('settings-catalog-import')(error);
      } finally {
        catalogFile.value = '';
      }
    })();
  });

  // ------------------------------------------------------------------ Speicher
  const storageOut = h('div', { id: 'st-storage-out', 'aria-live': 'polite' });
  const showStorage = (s: PersistenceStatus): void => {
    setChildren(
      storageOut,
      h('p', { id: 'st-storage-status' }, !s.supported ? 'Der Browser bietet keine Speicherverwaltung an.' : s.persisted ? 'Persistenter Speicher: aktiv (wird nicht automatisch gelöscht).' : 'Persistenter Speicher: nicht gewährt – der Browser darf Daten bei Platzmangel löschen. Erstellen Sie regelmäßig ein Backup.'),
      s.supported ? h('p', { class: 'hint', id: 'st-storage-usage' }, `Belegt: ${formatBytes(s.usageBytes)} von ${formatBytes(s.quotaBytes)}`) : null,
      s.error ? h('p', { class: 'field__error' }, s.error.userMessage) : null
    );
  };
  const checkStorage = (): void => {
    void requestPersistentStorage(ctx.storageManager).then((s) => {
      if (alive) showStorage(s);
    });
  };

  // ------------------------------------------------------------------ Backup
  const restoreOut = h('div', { id: 'st-restore-out', 'aria-live': 'polite' });
  const restoreFile = h('input', { type: 'file', id: 'st-restore-file', accept: '.json,application/json', class: 'input' });
  restoreFile.addEventListener('change', () => {
    const file = restoreFile.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const text = await readText(file);
        const ok = await confirmDialog({ title: 'Backup wiederherstellen?', message: 'Alle aktuellen Daten (Sammlungen, Vorlagen, Profile, Artikelstamm, Protokolle) werden durch den Inhalt der Datei ersetzt. Die Datei wird vorher vollständig geprüft; bei Fehlern bleibt alles unverändert.', confirmLabel: 'Wiederherstellen', danger: true });
        if (!ok) return;
        const s = await ctx.backup.importJson(text);
        setChildren(restoreOut, h('p', { class: 'hint', id: 'st-restore-summary' }, `Wiederhergestellt: ${s.collections} Sammlung(en), ${s.items} Position(en), ${s.templates} Vorlage(n), ${s.profiles} Profil(e), ${s.catalog} Artikel, ${s.sessions} Sitzung(en).`));
        ctx.notify.success('Backup wiederhergestellt.');
        await Promise.all([loadProfiles(), refreshCatalogInfo()]);
      } catch (error: unknown) {
        setChildren(restoreOut);
        fail('settings-restore')(error);
      } finally {
        restoreFile.value = '';
      }
    })();
  });

  // ------------------------------------------------------------------ Rückmeldung
  const s0 = ctx.settings.get();
  const soundBox = h('input', { type: 'checkbox', id: 'st-sound', checked: s0.sound });
  const vibrationBox = h('input', { type: 'checkbox', id: 'st-vibration', checked: s0.vibration });
  const applyFeedback = (): void => {
    ctx.settings.update({ sound: soundBox.checked, vibration: vibrationBox.checked });
    ctx.reconfigureCapture();
  };
  soundBox.addEventListener('change', applyFeedback);
  vibrationBox.addEventListener('change', applyFeedback);

  // ------------------------------------------------------------------ Lift-to-Pause
  const liftBox = h('input', { type: 'checkbox', id: 'st-lift', checked: s0.liftToPause && ctx.lift.supported, disabled: !ctx.lift.supported });
  const liftInfo = h('p', { class: 'hint', id: 'st-lift-info' }, ctx.lift.supported ? 'Pausiert den Fader sofort, wenn das Telefon angehoben, gekippt oder bewegt wird oder der Sensor keine Daten mehr liefert. Der Sensor kann nur pausieren, nie fortsetzen oder bestätigen. Experimentell – an Ihrer Hardware testen.' : 'Dieses Gerät bzw. dieser Browser bietet keine Bewegungssensoren an.');
  liftBox.addEventListener('change', () => {
    void (async () => {
      if (liftBox.checked) {
        const ok = await ctx.lift.enable();
        if (!ok) {
          liftBox.checked = false;
          ctx.settings.update({ liftToPause: false });
          ctx.notify.info('Die Bewegungssensoren sind nicht verfügbar oder wurden nicht erlaubt.');
          return;
        }
        ctx.settings.update({ liftToPause: true });
      } else {
        ctx.lift.disable();
        ctx.settings.update({ liftToPause: false });
      }
    })();
  });

  // ------------------------------------------------------------------ Update-Status
  const updateInfo = h('p', { class: 'hint', id: 'st-update' });
  const renderUpdate = (): void => {
    const u = ctx.updates.state;
    updateInfo.textContent =
      u.phase === 'offline-ready'
        ? 'Offline bereit: alle Dateien sind im Cache.'
        : u.phase === 'update-available'
          ? 'Neue Version verfügbar. Sie wird nie mitten in einer Fader-Sitzung aktiviert (Hinweis oben auf der Seite).'
          : u.phase === 'applying'
            ? 'Neue Version wird aktiviert.'
            : u.phase === 'error'
              ? `Offline-/Update-Problem: ${u.error?.userMessage ?? 'unbekannt'}`
              : 'Keine Update-Informationen (im installierten Produktionsbuild erscheinen sie hier).';
  };
  const unsubUpdates = ctx.updates.subscribe(() => {
    if (alive) renderUpdate();
  });

  // ------------------------------------------------------------------ Diagnose
  const logBox = h('div', { id: 'st-log' });
  const decoderInfo = h('p', { class: 'hint', id: 'st-decoder' });
  const renderLog = (): void => {
    const entries = ctx.logger.entries;
    const d = ctx.getDecoder();
    decoderInfo.textContent = `Decoder: ${d.engine ?? 'noch nicht gestartet'}${d.fallbackReason ? ` (${d.fallbackReason})` : ''}`;
    setChildren(
      logBox,
      entries.length === 0
        ? h('p', { class: 'hint', id: 'st-log-empty' }, 'Keine Einträge.')
        : h('ol', { class: 'log', id: 'st-log-list' }, ...[...entries].reverse().slice(0, 50).map((e) => h('li', { class: `log__${e.level}` }, `${formatDateTime(e.timestamp)} · ${e.level.toUpperCase()} · ${e.code} · ${e.message}${Object.keys(e.context).length > 0 ? ` · ${Object.entries(e.context).map(([k, v]) => `${k}=${String(v)}`).join(' ')}` : ''}`)))
    );
  };
  const unsub = ctx.logger.subscribe(() => {
    if (alive) renderLog();
  });

  setChildren(
    root,
    h(
      'section',
      { class: 'screen', 'aria-labelledby': 'st-title' },
      h('h1', { id: 'st-title' }, 'Einstellungen'),
      h('section', { class: 'card', 'aria-labelledby': 'st-prof-title' }, h('h2', { id: 'st-prof-title' }, 'Scannerprofile'), h('p', { class: 'hint' }, 'Die mitgelieferten Zeiten sind Teststartpunkte, keine garantierten Einstellungen. Die Leerzeit ist mindestens 20 ms, damit zwischen zwei Codes sicher ein leeres Bild liegt.'), profilesBox),
      h('section', { class: 'card', 'aria-labelledby': 'st-cal-title' }, h('h2', { id: 'st-cal-title' }, 'Kassen-Kalibrierung'), h('p', { class: 'hint' }, '20 Testcodes anzeigen und das Ergebnis an der Kasse eintragen. Daraus wird ein Profil vorgeschlagen.'), h('button', { type: 'button', class: 'btn', id: 'st-calibrate', onclick: () => ctx.navigate({ name: 'player', params: { calibration: '1' } }) }, '20er-Kalibrierung starten')),
      h('section', { class: 'card', 'aria-labelledby': 'st-cat-title' }, h('h2', { id: 'st-cat-title' }, 'Artikelstamm (CSV)'), catalogInfo, h('p', { class: 'hint' }, 'Spalten z. B. „EAN“, „Aktiv“, „Bezeichnung“. Die Aussage „bekannt/unbekannt“ gilt nur für den importierten Stand, nicht für den aktuellen Zustand der Kasse.'), h('label', { class: 'check', for: 'st-catalog-skip' }, catalogSkip, 'Fehlerhafte Zeilen überspringen (sonst Abbruch)'), h('label', { for: 'st-catalog-file', class: 'sr-only' }, 'CSV-Datei wählen'), catalogFile, catalogOut),
      h('section', { class: 'card', 'aria-labelledby': 'st-store-title' }, h('h2', { id: 'st-store-title' }, 'Speicher'), h('button', { type: 'button', class: 'btn', id: 'st-storage-btn', onclick: checkStorage }, 'Persistenten Speicher anfragen / Status'), storageOut),
      h('section', { class: 'card', 'aria-labelledby': 'st-bak-title' }, h('h2', { id: 'st-bak-title' }, 'Backup'), h('button', { type: 'button', class: 'btn btn--primary', id: 'st-backup', onclick: () => void ctx.backup.exportJson().then((json) => downloadText(`barqplayer-backup-${ctx.nowIso().slice(0, 10)}.json`, json, 'application/json')).catch(fail('settings-backup')) }, 'Backup herunterladen (JSON)'), h('p', { class: 'hint' }, 'Wiederherstellen ersetzt alle Daten. Die Datei wird vollständig vorab geprüft.'), h('label', { for: 'st-restore-file', class: 'sr-only' }, 'Backup-Datei wählen'), restoreFile, restoreOut),
      h('section', { class: 'card', 'aria-labelledby': 'st-fb-title' }, h('h2', { id: 'st-fb-title' }, 'Rückmeldung beim Scannen'), h('label', { class: 'check', for: 'st-sound' }, soundBox, 'Piepton nach erfolgreichem Speichern'), h('label', { class: 'check', for: 'st-vibration' }, vibrationBox, 'Vibration nach erfolgreichem Speichern')),
      h('section', { class: 'card', 'aria-labelledby': 'st-lift-title' }, h('h2', { id: 'st-lift-title' }, 'Lift-to-Pause (experimentell)'), h('label', { class: 'check', for: 'st-lift' }, liftBox, 'Beim Anheben des Telefons pausieren'), liftInfo),
      h('section', { class: 'card', 'aria-labelledby': 'st-diag-title' }, h('h2', { id: 'st-diag-title' }, 'Diagnose'), h('p', { class: 'hint' }, `App-Version ${ctx.appVersion}. Das Protokoll enthält keine Barcode-Inhalte.`), decoderInfo, updateInfo, logBox, h('button', { type: 'button', class: 'btn', id: 'st-log-clear', onclick: () => { ctx.logger.clear(); renderLog(); } }, 'Protokoll leeren'))
    )
  );
  void loadProfiles();
  void refreshCatalogInfo();
  renderLog();
  renderUpdate();
  return () => {
    alive = false;
    unsub();
    unsubUpdates();
  };
}
