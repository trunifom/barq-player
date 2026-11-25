/**
 * Scanner-Screen: Live-Kamera, Foto-Import (einzeln und mehrfach), manuelle Eingabe und Bulk-Liste.
 *
 * Grundsätze: „Gespeichert“ erscheint erst nach erfolgreichem IndexedDB-Schreibvorgang; fehlerhafte Eingaben werden
 * zeilengenau gemeldet und nie still korrigiert; QR-Inhalte werden nur angezeigt, nie geöffnet.
 */
import { parseBulkInput, type BulkParseResult } from '../../domain/bulk-parser';
import { classifyQrContent } from '../../domain/qr-content';
import type { BarcodeItem, Symbology } from '../../domain/types';
import type { AppContext } from '../../app/container';
import type { Dispose, Route } from '../../app/routes';
import type { FileScanResult } from '../../adapters/decoder/decoder-adapter';
import type { CaptureOutcome } from '../../application/capture-service';
import type { DuplicateRule } from '../../application/collection-service';
import { RESOLUTION_INFO } from '../../domain/camera-controls';
import { formatDateDe } from '../../domain/expiry';
import { createCameraControls } from '../components/camera-controls';
import { promptDialog } from '../components/dialog';
import { h, setChildren } from '../components/dom';
import { editItemDetails } from '../components/item-editor';
import { metaFields } from '../components/meta-fields';

/** Abstand zwischen zwei Bildauswertungen in ms (ca. 4 Bilder pro Sekunde schonen Akku und Prozessor). */
export const SCAN_INTERVAL_MS = 250;

/** Beschriftungen der Symbologien. */
export const SYMBOLOGY_LABEL: Readonly<Record<Symbology, string>> = {
  EAN13: 'EAN-13',
  EAN8: 'EAN-8',
  QRCode: 'QR-Code (Text)',
  Code128: 'Code 128',
  UPCA: 'UPC-A'
};

const FORMAT_ORDER: readonly Symbology[] = ['EAN13', 'EAN8', 'QRCode', 'Code128', 'UPCA'];

/**
 * Mountet den Scanner-Screen.
 * @param root - Wurzelelement.
 * @param ctx - App-Kontext.
 * @param _route - Route (ungenutzt).
 * @returns Aufräumfunktion (stoppt Kamera und Schleife).
 */
export function mountScanner(root: HTMLElement, ctx: AppContext, _route: Route): Dispose {
  let alive = true;
  let loop: ReturnType<typeof setTimeout> | null = null;
  const s = ctx.settings.get();

  const collectionSelect = h('select', { id: 'sc-collection', class: 'input', 'aria-label': 'Zielsammlung' });
  const recent = h('ol', { class: 'recent', id: 'sc-recent', 'aria-live': 'polite', 'aria-label': 'Zuletzt erfasste Codes' });
  const video = h('video', { class: 'camera__video', id: 'sc-video', playsinline: true, muted: true, 'aria-label': 'Kamerabild' });
  const camToggle = h('button', { type: 'button', class: 'btn btn--primary', id: 'sc-cam' }, 'Kamera starten');
  const torchBtn = h('button', { type: 'button', class: 'btn', id: 'sc-torch', disabled: true }, 'Taschenlampe');
  const switchBtn = h('button', { type: 'button', class: 'btn', id: 'sc-switch', disabled: true }, 'Kamera wechseln');
  const camStatus = h('p', { class: 'hint', id: 'sc-cam-status', role: 'status' }, 'Kamera aus.');
  let torchOn = false;
  const cameraBox = h('div', { class: 'camera' }, video, h('div', { class: 'camera__reticle', 'aria-hidden': 'true' }));
  const photoBtn = h('button', { type: 'button', class: 'btn', id: 'sc-photo', disabled: true, title: 'Nimmt ein Foto in voller Kameraauflösung auf und wertet es aus – ideal für kleine Codes' }, 'Hochauflösendes Foto auswerten');
  const controls = createCameraControls(ctx, video, cameraBox, {
    restartCamera: () => {
      stopCamera();
      void startCamera();
    }
  });

  const currentCollection = (): string => collectionSelect.value;

  const loadCollections = async (select?: string): Promise<void> => {
    try {
      const cols = await ctx.collections.listCollections();
      if (!alive) return;
      const wanted = select ?? ctx.settings.get().collectionId ?? cols[0]?.id;
      setChildren(collectionSelect, ...cols.map((c) => h('option', { value: c.id, selected: c.id === wanted }, c.name)));
      if (cols.length === 0) setChildren(collectionSelect, h('option', { value: '' }, '– noch keine Sammlung –'));
      refreshEnabled();
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'scanner-collections' });
    }
  };

  const newCollection = async (): Promise<void> => {
    const name = await promptDialog({ title: 'Neue Sammlung', label: 'Name', confirmLabel: 'Anlegen', validate: (v) => (v.trim() === '' ? 'Bitte einen Namen eingeben.' : v.trim().length > 100 ? 'Höchstens 100 Zeichen.' : null) });
    if (name === null) return;
    try {
      const c = await ctx.collections.createCollection(name);
      ctx.settings.update({ collectionId: c.id });
      await loadCollections(c.id);
      ctx.notify.success(`Sammlung „${c.name}“ angelegt.`);
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'scanner-new-collection' });
    }
  };

  const remember = (item: BarcodeItem, merged: boolean): void => {
    let current = item;
    const info = h('span', { class: 'recent__qty' }, merged ? `Menge ${item.quantity}` : 'neu gespeichert');
    const detailsBtn = h('button', { type: 'button', class: 'btn recent__details', 'data-details': item.id, 'aria-label': `Details zu ${item.value} bearbeiten` }, 'Details');
    detailsBtn.addEventListener('click', () => {
      void editItemDetails(ctx, current)
        .then((saved) => {
          if (!saved) return;
          current = saved;
          info.textContent = [saved.label, saved.expiresAt ? `bis ${formatDateDe(saved.expiresAt)}` : '', 'Details gespeichert'].filter((t) => t).join(' · ');
        })
        .catch((error: unknown) => ctx.notify.error(error, { source: 'scanner-details' }));
    });
    const li = h(
      'li',
      { class: 'recent__item' },
      h('span', { class: 'recent__symbology' }, SYMBOLOGY_LABEL[item.symbology]),
      h('code', { class: 'recent__value' }, item.value.length > 80 ? `${item.value.slice(0, 80)}…` : item.value),
      info,
      detailsBtn
    );
    recent.prepend(li);
    while (recent.children.length > 8) recent.lastElementChild?.remove();
  };

  const handleOutcomes = (outcomes: readonly CaptureOutcome[]): void => {
    for (const o of outcomes) {
      if (o.kind === 'saved') {
        remember(o.item, o.merged);
        if (o.qr && (o.qr.risky || o.qr.kind !== 'text')) ctx.notify.info(`QR-Inhalt: ${o.qr.notice}`);
      } else if (o.kind === 'ignored') {
        ctx.notify.info('Code ist bereits in der Sammlung (Modus „nur eindeutige Codes“).');
      } else {
        ctx.notify.error(o.error, { source: 'scanner-save' });
      }
    }
  };

  // ------------------------------------------------------------------ Kamera
  const tick = async (): Promise<void> => {
    loop = null;
    if (!alive || !ctx.camera.current) return;
    try {
      const cid = currentCollection();
      if (cid && video.readyState >= 2) {
        const report = await ctx.getCapture().processFrame(cid, controls.frameSource());
        if (alive) handleOutcomes(report.outcomes);
      }
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'scanner-frame' });
    }
    if (alive && ctx.camera.current) loop = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
  };

  const attach = (): void => {
    const session = ctx.camera.current;
    if (!session) return;
    (video as unknown as { srcObject: unknown }).srcObject = session.stream;
    void Promise.resolve(video.play?.()).catch((error: unknown) => ctx.notify.error(error, { source: 'scanner-video' }));
    torchBtn.disabled = !session.torchSupported;
    switchBtn.disabled = false;
    camToggle.textContent = 'Kamera stoppen';
    camStatus.textContent = `Kamera läuft (${session.facingMode ?? 'unbekannte Richtung'}${session.width && session.height ? `, ${session.width}×${session.height}` : ''}).`;
    photoBtn.disabled = !ctx.camera.photoSupported;
    controls.onSession(session);
    ctx.getCapture().resetSession();
    loop ??= setTimeout(() => void tick(), SCAN_INTERVAL_MS);
  };

  const stopCamera = (): void => {
    if (loop) clearTimeout(loop);
    loop = null;
    try {
      ctx.camera.stop();
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'scanner-stop' });
    }
    (video as unknown as { srcObject: unknown }).srcObject = null;
    torchOn = false;
    torchBtn.disabled = true;
    switchBtn.disabled = true;
    photoBtn.disabled = true;
    controls.onSession(null);
    camToggle.textContent = 'Kamera starten';
    camStatus.textContent = 'Kamera aus.';
  };

  const startCamera = async (): Promise<void> => {
    camToggle.disabled = true;
    try {
      await ctx.feedback.unlock(); // aus der Nutzeraktion heraus (Browser-Autoplay-Regel)
      const res = RESOLUTION_INFO[ctx.settings.get().cameraResolution];
      await ctx.camera.start({ idealWidth: res.width, idealHeight: res.height });
      attach();
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'scanner-start' });
      stopCamera();
    } finally {
      camToggle.disabled = false;
    }
  };

  camToggle.addEventListener('click', () => {
    if (ctx.camera.current) stopCamera();
    else void startCamera();
  });
  switchBtn.addEventListener('click', () => {
    if (loop) clearTimeout(loop);
    loop = null;
    void ctx.camera
      .switchCamera()
      .then(attach)
      .catch((error: unknown) => {
        ctx.notify.error(error, { source: 'scanner-switch' });
        stopCamera();
      });
  });
  torchBtn.addEventListener('click', () => {
    void ctx.camera
      .setTorch(!torchOn)
      .then(() => {
        torchOn = !torchOn;
        torchBtn.setAttribute('aria-pressed', String(torchOn));
      })
      .catch((error: unknown) => ctx.notify.error(error, { source: 'scanner-torch' }));
  });

  // ------------------------------------------------------------------ Einstellungen
  const formatBoxes = FORMAT_ORDER.map((f) => h('input', { type: 'checkbox', id: `sc-fmt-${f}`, 'data-format': f, checked: s.formats.includes(f) }));
  const uniqueBox = h('input', { type: 'checkbox', id: 'sc-unique', checked: s.uniqueOnly });
  const saveSettings = (): void => {
    const formats = FORMAT_ORDER.filter((_f, i) => formatBoxes[i]?.checked === true);
    if (formats.length === 0) {
      ctx.notify.info('Mindestens ein Format muss freigegeben sein.');
      FORMAT_ORDER.forEach((f, i) => {
        const box = formatBoxes[i];
        if (box) box.checked = ctx.settings.get().formats.includes(f);
      });
      return;
    }
    ctx.settings.update({ formats, uniqueOnly: uniqueBox.checked });
    ctx.reconfigureCapture();
  };
  for (const b of [...formatBoxes, uniqueBox]) b.addEventListener('change', saveSettings);

  // ------------------------------------------------------------------ Foto-Import
  const fileInput = h('input', { type: 'file', id: 'sc-files', accept: 'image/*', multiple: true, class: 'input' });
  const importOut = h('div', { class: 'import-out', id: 'sc-import-out', 'aria-live': 'polite' });
  const renderScan = (results: FileScanResult[]): void => {
    const checks: Array<{ box: HTMLInputElement; symbology: Symbology; value: string; origin: string }> = [];
    const blocks = results.map((r) => {
      if (r.status === 'error') return h('div', { class: 'import-file import-file--error' }, h('strong', null, r.fileName), h('p', null, `Nicht lesbar: ${r.error?.userMessage ?? 'unbekannter Fehler'}`));
      if (r.status === 'no-codes') return h('div', { class: 'import-file' }, h('strong', null, r.fileName), h('p', null, 'Kein Code erkannt.'));
      return h(
        'div',
        { class: 'import-file' },
        h('strong', null, r.fileName),
        h(
          'ul',
          { class: 'import-codes' },
          ...r.codes.map((c, i) => {
            const id = `imp-${results.indexOf(r)}-${i}`;
            const box = h('input', { type: 'checkbox', id, checked: true });
            checks.push({ box, symbology: c.symbology, value: c.value, origin: r.fileName });
            const qr = c.symbology === 'QRCode' ? classifyQrContent(c.value) : null;
            return h('li', null, box, h('label', { for: id }, `${SYMBOLOGY_LABEL[c.symbology]}: `, h('code', null, c.value.length > 120 ? `${c.value.slice(0, 120)}…` : c.value)), qr ? h('span', { class: qr.risky ? 'field__error' : 'hint' }, ` ${qr.notice}`) : null);
          })
        ),
        r.rejected.length > 0 ? h('p', { class: 'hint' }, `${r.rejected.length} Erkennung(en) verworfen (ungültig oder nicht freigegeben).`) : null
      );
    });
    const saveBtn = h('button', { type: 'button', class: 'btn btn--primary', id: 'sc-import-save', disabled: checks.length === 0 }, 'Ausgewählte Codes speichern');
    saveBtn.addEventListener('click', () => {
      const cid = currentCollection();
      if (!cid) {
        ctx.notify.info('Bitte zuerst eine Sammlung wählen oder anlegen.');
        return;
      }
      const selected = checks.filter((c) => c.box.checked).map((c) => ({ symbology: c.symbology, value: c.value, origin: c.origin }));
      saveBtn.disabled = true;
      ctx
        .getCapture()
        .saveDetected(cid, selected)
        .then((items) => {
          ctx.notify.success(`${items.length} Code(s) gespeichert.`);
          setChildren(importOut);
        })
        .catch((error: unknown) => {
          ctx.notify.error(error, { source: 'scanner-import-save' });
          saveBtn.disabled = false;
        });
    });
    setChildren(importOut, ...blocks, checks.length > 0 ? saveBtn : null);
  };
  /** Wertet Bilddateien aus (Foto-Import, Kamera-App, hochauflösendes Foto) und zeigt die Treffer zur Auswahl. */
  const scanFiles = (files: File[], done?: () => void): Promise<void> => {
    if (files.length === 0) return Promise.resolve();
    setChildren(importOut, h('p', { role: 'status' }, `${files.length} Bild(er) werden ausgewertet …`));
    return ctx
      .getCapture()
      .scanImages(files)
      .then(renderScan)
      .catch((error: unknown) => {
        ctx.notify.error(error, { source: 'scanner-import' });
        setChildren(importOut);
      })
      .finally(() => done?.());
  };
  fileInput.addEventListener('change', () => {
    void scanFiles(Array.from(fileInput.files ?? []), () => {
      fileInput.value = '';
    });
  });

  // Kamera-App des Telefons: oft bessere Bildverarbeitung, Zoom und Fokus als das Browser-Videobild
  const nativeInput = h('input', { type: 'file', id: 'sc-native', accept: 'image/*', capture: 'environment', class: 'sr-only', 'aria-label': 'Mit Kamera-App fotografieren' });
  nativeInput.addEventListener('change', () => {
    void scanFiles(Array.from(nativeInput.files ?? []), () => {
      nativeInput.value = '';
    });
  });
  photoBtn.addEventListener('click', () => {
    photoBtn.disabled = true;
    void ctx.camera
      .takePhoto()
      .then((blob) => scanFiles([new File([blob], 'kamera-foto.jpg', { type: blob.type || 'image/jpeg' })]))
      .catch((error: unknown) => ctx.notify.error(error, { source: 'scanner-photo' }))
      .finally(() => {
        photoBtn.disabled = ctx.camera.current === null || !ctx.camera.photoSupported;
      });
  });

  // ------------------------------------------------------------------ Manuelle Eingabe / Bulk
  const symSelect = h('select', { id: 'sc-man-sym', class: 'input' }, ...FORMAT_ORDER.map((f) => h('option', { value: f }, SYMBOLOGY_LABEL[f])));
  const dupSelect = h('select', { id: 'sc-man-dup', class: 'input' }, h('option', { value: 'merge' }, 'Gleiche Codes zusammenfassen (Menge)'), h('option', { value: 'append' }, 'Jede Zeile als eigene Position'));
  const text = h('textarea', { id: 'sc-man-text', class: 'input textarea', rows: 6, placeholder: 'Ein Code pro Zeile', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off' });
  const manOut = h('div', { class: 'man-out', id: 'sc-man-out', 'aria-live': 'polite' });
  const manMeta = metaFields('sc-meta');
  let lastParse: BulkParseResult | null = null;

  const parse = (): BulkParseResult | null => {
    try {
      const symbology = symSelect.value as Symbology;
      const dup = dupSelect.value as DuplicateRule;
      lastParse = parseBulkInput(text.value, { symbology, duplicates: dup === 'merge' ? 'merge' : 'keep' });
      return lastParse;
    } catch (error: unknown) {
      ctx.notify.error(error, { source: 'scanner-parse' });
      return null;
    }
  };

  const check = (): void => {
    const r = parse();
    if (!r) return;
    const saveValid = h('button', { type: 'button', class: 'btn btn--primary', id: 'sc-man-save', disabled: r.entries.length === 0 }, r.errors.length > 0 ? `Nur die ${r.entries.length} gültigen Zeilen speichern` : `${r.entries.length} Code(s) speichern`);
    saveValid.addEventListener('click', () => void saveManual());
    setChildren(
      manOut,
      h('p', { class: r.errors.length > 0 ? 'field__error' : 'hint', id: 'sc-man-summary' }, `${r.entries.length} gültig, ${r.errors.length} fehlerhaft${r.skippedEmptyLines > 0 ? `, ${r.skippedEmptyLines} Leerzeile(n) übersprungen` : ''}.`),
      r.errors.length > 0 ? h('ul', { class: 'errors', id: 'sc-man-errors' }, ...r.errors.map((e) => h('li', null, e.message))) : null,
      saveValid
    );
  };

  const saveManual = async (): Promise<void> => {
    const cid = currentCollection();
    if (!cid) {
      ctx.notify.info('Bitte zuerst eine Sammlung wählen oder anlegen.');
      return;
    }
    const r = lastParse ?? parse();
    if (!r || r.entries.length === 0) return;
    try {
      const items = await ctx.collections.addItems(
        cid,
        r.entries.map((e) => ({ symbology: e.symbology, value: e.value, quantity: e.quantity, source: 'manual' as const, ...manMeta.read() })),
        dupSelect.value === 'append' ? 'append' : 'merge'
      );
      ctx.feedback.saved();
      const total = r.entries.reduce((n, e) => n + e.quantity, 0);
      ctx.notify.success(`${total} Code(s) gespeichert (${items.length} Position(en)).`);
      text.value = '';
      manMeta.clear();
      lastParse = null;
      setChildren(manOut);
    } catch (error: unknown) {
      ctx.feedback.failed();
      ctx.notify.error(error, { source: 'scanner-manual-save' });
    }
  };

  collectionSelect.addEventListener('change', () => {
    ctx.settings.update({ collectionId: currentCollection() || null });
    ctx.getCapture().resetSession();
  });

  const refreshEnabled = (): void => {
    const hasCollection = currentCollection() !== '';
    camToggle.disabled = !hasCollection && !ctx.camera.current;
  };

  // Seite im Hintergrund → Kamera sparen
  const onHidden = (): void => {
    if (document.visibilityState === 'hidden' && ctx.camera.current) stopCamera();
  };
  document.addEventListener('visibilitychange', onHidden);

  setChildren(
    root,
    h(
      'section',
      { class: 'screen', 'aria-labelledby': 'sc-title' },
      h('h1', { id: 'sc-title' }, 'Erfassen'),
      h('div', { class: 'field' }, h('label', { for: 'sc-collection' }, 'Sammlung'), h('div', { class: 'inline' }, collectionSelect, h('button', { type: 'button', class: 'btn', id: 'sc-new', onclick: () => void newCollection() }, 'Neu'))),
      h('details', { open: true, class: 'card' }, h('summary', null, 'Kamera'), cameraBox, h('div', { class: 'btn-row' }, camToggle, torchBtn, switchBtn), camStatus, h('details', { class: 'sub-details', id: 'sc-cam-settings', open: true }, h('summary', null, 'Zoom und Kamera-Einstellungen'), controls.element), h('div', { class: 'btn-row' }, photoBtn, h('label', { class: 'btn', for: 'sc-native', id: 'sc-native-label' }, 'Mit Kamera-App fotografieren'), nativeInput), h('p', { class: 'hint' }, 'Tipp bei kleinen Codes: nicht näher herangehen (das Bild wird unscharf), sondern zoomen, die Auflösung erhöhen oder ein hochauflösendes Foto auswerten. Die Auswertung des Fotos erscheint unter „Foto-Import“.'), h('fieldset', { class: 'fieldset' }, h('legend', null, 'Freigegebene Formate'), ...FORMAT_ORDER.map((f, i) => h('label', { class: 'check', for: `sc-fmt-${f}` }, formatBoxes[i] as HTMLElement, SYMBOLOGY_LABEL[f])), h('label', { class: 'check', for: 'sc-unique' }, uniqueBox, 'Nur eindeutige Codes erfassen'))),
      h('details', { class: 'card' }, h('summary', null, 'Foto-Import'), h('p', { class: 'hint' }, 'Ein oder mehrere Fotos wählen. Erkannte Codes können einzeln übernommen werden. Die Fotos selbst werden nicht gespeichert.'), h('label', { for: 'sc-files', class: 'sr-only' }, 'Fotos auswählen'), fileInput, importOut),
      h('details', { class: 'card' }, h('summary', null, 'Manuelle Eingabe und Liste'), h('div', { class: 'field' }, h('label', { for: 'sc-man-sym' }, 'Format'), symSelect), h('div', { class: 'field' }, h('label', { for: 'sc-man-dup' }, 'Gleiche Codes'), dupSelect), h('div', { class: 'field' }, h('label', { for: 'sc-man-text' }, 'Codes (eine Zeile = ein Code)'), text), h('details', { class: 'sub-details', open: true }, h('summary', null, 'Zusatzangaben (optional, gelten für alle Codes dieser Eingabe)'), manMeta.element), h('button', { type: 'button', class: 'btn', id: 'sc-man-check', onclick: check }, 'Prüfen'), manOut),
      h('section', { class: 'card', 'aria-labelledby': 'sc-recent-title' }, h('h2', { id: 'sc-recent-title' }, 'Zuletzt erfasst'), recent)
    )
  );
  void loadCollections();

  return () => {
    alive = false;
    document.removeEventListener('visibilitychange', onHidden);
    stopCamera();
  };
}
