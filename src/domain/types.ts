/**
 * Domain-Datenmodell (Spezifikation Kap. 16). Reine Typen, keine Laufzeitabhaengigkeiten.
 * Kennungen (Barcode-Werte, Start/Ende/Schritt von Sequenzen) sind IMMER `string`,
 * damit fuehrende Nullen nie verloren gehen.
 */

/** Unterstuetzte Symbologien. */
export type Symbology = 'EAN13' | 'EAN8' | 'QRCode' | 'Code128' | 'UPCA';

/** Symbologien, für die Sequenzen erzeugt werden können. */
export type SequenceSymbology = 'EAN13' | 'EAN8' | 'QRCode' | 'Code128';

/** Ergebnis der Syntaxpruefung (Länge/Zeichen). */
export type SyntaxStatus = 'unchecked' | 'valid' | 'invalid';

/** Ergebnis der Prüfziffernpruefung. */
export type ChecksumStatus = 'unchecked' | 'valid' | 'invalid' | 'not-applicable';

/** Artikelstamm-Status (nur Aussage zum importierten Stand, nicht zur Kasse). */
export type CatalogStatus = 'unchecked' | 'known' | 'unknown' | 'inactive';

/** Herkunft eines Eintrags. */
export type ItemSource = 'camera' | 'image' | 'manual' | 'import' | 'sequence';

/** Eine Sammlung (Liste) von Codes. */
export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Ein gespeicherter Code in einer Sammlung. Syntax, Prüfziffer und Artikelstamm sind getrennte Aussagen. */
export interface BarcodeItem {
  id: string;
  collectionId: string;
  position: number;
  symbology: Symbology;
  /** Zwingend als String (fuehrende Nullen erhalten). */
  value: string;
  quantity: number;
  source: ItemSource;
  capturedAt: string;
  syntaxStatus: SyntaxStatus;
  checksumStatus: ChecksumStatus;
  catalogStatus: CatalogStatus;
  catalogSource?: string;
  catalogCheckedAt?: string;
  /** Wort / Bezeichnung (optional). */
  label?: string;
  /** Nutzen / Verwendungszweck (optional). */
  purpose?: string;
  /** Satz / Notiz (optional). */
  note?: string;
  /** Tags (optional, eindeutig ohne Rücksicht auf Groß-/Kleinschreibung). */
  tags?: string[];
  /** Ablaufdatum `JJJJ-MM-TT`; ab dem Folgetag gilt der Code als abgelaufen (optional). */
  expiresAt?: string;
}

/** Prüfziffernmodus einer Sequenz. */
export type SequenceChecksumMode = 'gs1-mod10' | 'none';

/**
 * Sequenzdefinition: fester Praefix + variables Feld + optionaler fester Teil vor der Prüfziffer.
 * Start, Ende und Schritt beziehen sich NUR auf das variable Feld (dezimale Strings, intern BigInt).
 */
export interface SequenceDefinition {
  id: string;
  symbology: SequenceSymbology;
  prefix: string;
  suffixBeforeCheckDigit: string;
  variableWidth: number;
  start: string;
  /** Inklusiver Endwert; wird nur erreicht, wenn er auf dem Schrittraster liegt. */
  end: string;
  step: string;
  checksumMode: SequenceChecksumMode;
  /** Überlaufregel: es wird gestoppt und gemeldet, nie abgeschnitten. */
  overflow: 'stop';
  /** Obergrenze der Positionen (Standard siehe `DEFAULT_MAX_SEQUENCE_ITEMS`). */
  maxItems?: number;
}

/** Gespeicherte, benannte Sequenzvorlage. */
export interface SequenceTemplate {
  id: string;
  name: string;
  /** Schreibweise, z. B. `2 063701 028{XX}{C}`. */
  pattern: string;
  definition: SequenceDefinition;
  createdAt: string;
  updatedAt: string;
}

/** Scannerprofil mit Anzeige- und Leerzeiten (Startpunkte siehe Spezifikation Kap. 15.3). */
export interface FaderProfile {
  id: string;
  name: string;
  displayMs: number;
  /** Leerzeit vor einem anderen Folgecode. */
  blankMs: number;
  /** Leerzeit vor einem identischen Folgecode. */
  identicalBlankMs: number;
  startDelayMs: number;
  notes?: string;
}

/** Eine Position der eingefrorenen Ausgabeliste einer Sitzung. */
export interface PlaybackEntry {
  id: string;
  sourceItemId: string;
  repetition: number;
  value: string;
  symbology: Symbology;
}

/** Ereignisart im Wiedergabeprotokoll. `pos-accepted` darf nur ein vertrauenswürdiger Kassenadapter erzeugen. */
export type PlaybackEventType =
  | 'displayed'
  | 'blanked'
  | 'paused'
  | 'manual-confirmed'
  | 'pos-accepted'
  | 'pos-rejected'
  | 'uncertain';

/** Quelle (Vertrauensniveau) eines Ereignisses. */
export type EventEvidence = 'player' | 'operator' | 'sensor' | 'pos';

/** Ein Ereignis im Wiedergabeprotokoll. */
export interface PlaybackEvent {
  id: string;
  sessionId: string;
  entryId?: string;
  timestamp: string;
  type: PlaybackEventType;
  evidence: EventEvidence;
  detail?: string;
}

/** Ein Artikelstamm-Eintrag (importierter Stand). */
export interface CatalogProduct {
  /** Kennung als String. */
  value: string;
  active: boolean;
  source: string;
  importedAt: string;
  label?: string;
}

/** Status einer gespeicherten Wiedergabesitzung. */
export type SessionStatus = 'running' | 'finished' | 'aborted' | 'error';

/** Protokollkopf einer Wiedergabesitzung (Ereignisse liegen separat, siehe `PlaybackEvent`). */
export interface SessionRecord {
  id: string;
  collectionId: string;
  startedAt: string;
  mode: 'manual' | 'auto' | 'batch';
  /** App-Version zum Sitzungszeitpunkt (Spezifikation 19.4). */
  appVersion: string;
  profileId?: string;
  entryCount: number;
  /** Wurde Smart-Interleaving angewendet? */
  interleaved: boolean;
  status: SessionStatus;
}
