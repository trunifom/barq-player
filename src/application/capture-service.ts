/**
 * Erfassung im Lager: Live-Bilder und Bilddateien → validierte, gespeicherte Einträge.
 *
 * Sicherheits- und Ablaufregeln:
 * - Eine Erfassung gilt erst als „gespeichert“ (und löst erst dann Piepton/Vibration aus), wenn der
 *   IndexedDB-Schreibvorgang erfolgreich abgeschlossen ist (Spezifikation 10.1).
 * - Technische Duplikate (derselbe Code dauerhaft im Videobild) werden entprellt; eine fachliche Wiederholung
 *   (Code verschwindet und wird erneut vorgehalten) erhöht die Menge bzw. wird im Modus „nur eindeutige Codes“ ignoriert.
 * - QR-Inhalte sind Daten: Es wird nichts geöffnet oder ausgeführt; der Inhalt wird nur eingeordnet (`classifyQrContent`).
 * - Bildimport: Erkennung und Speichern sind getrennt, damit mehrere Codes pro Bild einzeln angeboten werden können.
 */
import { AppError, toAppError } from '../domain/errors';
import { DuplicateFilter } from '../domain/duplicate-filter';
import { classifyQrContent, type QrContentInfo } from '../domain/qr-content';
import type { BarcodeItem, Symbology } from '../domain/types';
import type { DecodedCode, DecoderPort, DetectionSource, FileScanResult } from '../adapters/decoder/decoder-adapter';
import type { FeedbackPort } from '../adapters/feedback/feedback-adapter';
import type { CollectionService } from './collection-service';

/** Ergebnis der Verarbeitung eines einzelnen erkannten Codes. */
export type CaptureOutcome =
  | { kind: 'saved'; item: BarcodeItem; /** `true`, wenn die Menge eines vorhandenen Eintrags erhöht wurde. */ merged: boolean; qr?: QrContentInfo }
  | { kind: 'ignored'; reason: 'unique-only-duplicate'; symbology: Symbology; value: string }
  | { kind: 'error'; error: AppError; symbology?: Symbology };

/** Ergebnis eines Live-Bildes. */
export interface FrameReport {
  /** `true`, wenn das Bild übersprungen wurde, weil die vorige Auswertung noch lief. */
  skipped: boolean;
  outcomes: CaptureOutcome[];
  /** Anzahl verworfener (ungültiger/nicht freigegebener) Erkennungen. */
  rejected: number;
}

/** Ein im Bild erkannter Code zur Auswahl durch die Bedienperson. */
export interface DetectedForSave {
  symbology: Symbology;
  value: string;
  /** Herkunft (z. B. Dateiname), wird optional als Bezeichnung gespeichert. */
  origin?: string;
}

/** Abhängigkeiten des Capture-Service. */
export interface CaptureDeps {
  collections: Pick<CollectionService, 'addItem' | 'addItems' | 'findItem'>;
  decoder: DecoderPort;
  feedback?: FeedbackPort;
  /** Monotone Zeit in ms (Standard `performance.now()`). */
  nowMs?: () => number;
  filter?: DuplicateFilter;
  /** Modus „nur eindeutige Codes“: bereits vorhandene Codes werden nicht erneut erfasst. */
  uniqueOnly?: boolean;
}

const keyOf = (c: { symbology: Symbology; value: string }): string => `${c.symbology}\u0000${c.value}`;

/** Capture-Service für Kamera und Bildimport. */
export class CaptureService {
  private busy = false;
  private readonly filter: DuplicateFilter;
  private readonly nowMs: () => number;

  /** @param deps - Collaborators. */
  constructor(private readonly deps: CaptureDeps) {
    this.filter = deps.filter ?? new DuplicateFilter();
    this.nowMs = deps.nowMs ?? ((): number => performance.now());
  }

  /** Setzt die Entprellung zurück (z. B. beim Kamera- oder Sammlungswechsel). */
  resetSession(): void {
    this.filter.reset();
  }

  /** @returns `true`, solange ein Bild ausgewertet wird. */
  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Wertet ein Live-Bild aus und speichert neu vorgehaltene Codes. Überlappende Aufrufe werden übersprungen,
   * damit sich Auswertungen nicht aufstauen.
   * @param collectionId - Zielsammlung.
   * @param frame - Bildquelle (z. B. das Video-Element).
   * @returns Bericht; Fehler stehen als `error`-Ergebnisse darin (die Funktion wirft nicht für Einzelfehler).
   */
  async processFrame(collectionId: string, frame: DetectionSource): Promise<FrameReport> {
    if (this.busy) return { skipped: true, outcomes: [], rejected: 0 };
    this.busy = true;
    try {
      let result;
      try {
        result = await this.deps.decoder.decodeFrame(frame);
      } catch (error: unknown) {
        this.deps.feedback?.failed();
        return { skipped: false, outcomes: [{ kind: 'error', error: toAppError(error, 'ERR_DECODE_FAILED') }], rejected: 0 };
      }
      const byKey = new Map<string, DecodedCode>();
      for (const code of result.codes) byKey.set(keyOf(code), code);
      const accepted = this.filter.observe([...byKey.keys()], this.nowMs());

      const outcomes: CaptureOutcome[] = [];
      for (const key of accepted) {
        const code = byKey.get(key);
        if (code) outcomes.push(await this.save(collectionId, code, key));
      }
      return { skipped: false, outcomes, rejected: result.rejected.length };
    } finally {
      this.busy = false;
    }
  }

  private async save(collectionId: string, code: DecodedCode, key: string): Promise<CaptureOutcome> {
    try {
      const existing = await this.deps.collections.findItem(collectionId, code.symbology, code.value);
      if (existing && this.deps.uniqueOnly === true) {
        return { kind: 'ignored', reason: 'unique-only-duplicate', symbology: code.symbology, value: code.value };
      }
      const item = await this.deps.collections.addItem(collectionId, { symbology: code.symbology, value: code.value, source: 'camera' }, 'merge');
      // Erst NACH erfolgreichem Schreiben bestätigen:
      this.deps.feedback?.saved();
      return { kind: 'saved', item, merged: existing !== undefined, ...(code.symbology === 'QRCode' ? { qr: classifyQrContent(code.value) } : {}) };
    } catch (error: unknown) {
      this.filter.release(key); // beim nächsten Bild erneut versuchen, solange der Code vorgehalten wird
      this.deps.feedback?.failed();
      return { kind: 'error', error: toAppError(error, 'ERR_STORAGE_WRITE_FAILED'), symbology: code.symbology };
    }
  }

  /**
   * Wertet Bilddateien aus, ohne zu speichern (mehrere Codes pro Bild werden einzeln angeboten).
   * Nicht lesbare Bilder erscheinen als `status: 'error'`, Bilder ohne Code als `no-codes`.
   * @param files - Bilddateien.
   * @returns Ergebnis je Datei samt QR-Einordnung nicht nötig (siehe `classifyQrContent` für die Anzeige).
   * @throws {AppError} `ERR_WASM_LOAD_FAILED`, wenn der Decoder nicht geladen werden kann.
   */
  scanImages(files: ReadonlyArray<Blob & { name?: string }>): Promise<FileScanResult[]> {
    return this.deps.decoder.scanFiles(files);
  }

  /**
   * Speichert die von der Bedienperson ausgewählten, im Bild erkannten Codes atomar (alle oder keiner).
   * @param collectionId - Zielsammlung.
   * @param selected - ausgewählte Codes.
   * @returns gespeicherte Einträge in Eingabereihenfolge.
   * @throws {AppError} Validierungs- oder Speicherfehler; dann wurde nichts gespeichert und es gibt keine Bestätigung.
   */
  async saveDetected(collectionId: string, selected: readonly DetectedForSave[]): Promise<BarcodeItem[]> {
    try {
      const items = await this.deps.collections.addItems(
        collectionId,
        selected.map((s) => ({ symbology: s.symbology, value: s.value, source: 'image' as const, ...(s.origin === undefined ? {} : { label: s.origin }) })),
        'merge'
      );
      if (items.length > 0) this.deps.feedback?.saved();
      return items;
    } catch (error: unknown) {
      this.deps.feedback?.failed();
      throw error;
    }
  }
}
