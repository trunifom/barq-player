# Barcode-Lager-App: Technische Spezifikation, Systemarchitektur & Hardware-Leitfaden

**Stand:** 24. November 2026  
**Version:** 2.0 (Master-Dokumentation inkl. Praxisvalidierung & Perplexity-Erweiterungen)  
**Status:** Planungs-, Architekturentwurfs- und Entwicklungsgrundlage

---

## Inhaltsverzeichnis
1. [Executive Summary & Systemüberblick](#1-executive-summary--systemüberblick)
2. [Analyse des Praxistests & Open-Loop-Problematik](#2-analyse-des-praxistests--open-loop-problematik)
3. [Barcode- & GS1-Standards (EAN-13, EAN-8, QR-Code)](#3-barcode---gs1-standards-ean-13-ean-8-qr-code)
4. [Pattern- & Sequenz-Engine](#4-pattern---sequenz-engine)
5. [Hardware-Sensoren & Experimenteller Rückkanal](#5-hardware-sensoren--experimenteller-rückkanal)
6. [Technologieentscheidung & PWA-Plattform-Stack](#6-technologieentscheidung--pwa-plattform-stack)
7. [Systemarchitektur, Datenmodell & Zustandsautomat](#7-systemarchitektur-datenmodell--zustandsautomat)
8. [Offlinebetrieb, Caching & Datenschutz](#8-offlinebetrieb-caching--datenschutz)
9. [Teststrategie, Hardware-Matrix & Risikoregister](#9-teststrategie-hardware-matrix--risikoregister)
10. [Architecture Decision Records (ADRs) & Referenzcode](#10-architecture-decision-records-adrs--referenzcode)

---

## 1. Executive Summary & Systemüberblick

Die geplante Mobilanwendung für Android-Smartphones dient der Erfassung, Generierung, Verwaltung und zeitgesteuerten Wiedergabe („Fading“) von Barcodes und QR-Codes im Lager- und Kassenumfeld. 

### Hauptfunktionen
* **Erfassung & Import:** Continuous-Scan via Smartphone-Kamera (ZXing-WASM), Galerie-Bildimport (Batch-Scan) und manuelle Zifferneingabe.
* **Sequenz- & Pattern-Generator:** Regelbasierte Erstellung von EAN-Nummernfolgen mit Präfixen, variablen Nutzdatenfeldern, definierbaren Schrittweiten (z. B. $+12$) und automatischer Prüfziffernberechnung.
* **Smart Fader / Player:** Taktgenaue Präsentation der Code-Bilder auf dem Smartphone-Display zur Erfassung durch Kassenscanner (1D/2D Imager) mit konfigurierbaren Anzeige- und Leerphasen (Blanking).
* **Robustes Fehlermanagement:** Absicherung gegen Asynchronität bei Kassen-Fehlermeldungen („Not-on-file“-Artikel).

### Empfohlener Technologiestack
* **Typ:** Progressive Web App (PWA) auf TypeScript-Basis mit Vite.
* **Erzeugung:** `@bwip-js/browser` (Vektor-Rendering auf Canvas/SVG).
* **Erkennung:** `zxing-wasm` mit lokal gehosteter WebAssembly-Binärdatei.
* **Speicherung:** IndexedDB mit `navigator.storage.persist()`.

---

## 2. Analyse des Praxistests & Open-Loop-Problematik

### 2.1 Auswertung des Praxistests
Ein Praxistest zeigte, dass Kassenscanner Smartphone-Displays problemlos erfassen können:
* **Testaufbau:** Erfassung von 5 QR- bzw. Barcode-Fotos, Aufzeichnung als Video, Abspielen am Kassenscanner mit $0{,}3 \text{ bis } 0{,}5 \text{ s}$ Standzeit pro Bild.
* **Ergebnis:** Alle gültigen Codes wurden fehlerfrei gelesen.
* **Hauptproblem:** Ungültige / veraltete Artikel lösten am Kassensystem eine Dialog-Fehlermeldung aus. Während die Kasse blockiert war, lief das Video unbeeinflusst weiter. Das führte zu Asynchronität und nicht erfassten Folgecodes.

```
[ Smartphone Video ] ─── Code A ───> Code B ───> Code C ───> Code D ───> ...
                                      │
[ Kassen-Scanner  ] ─── OK ───────> ERROR! (Dialog öffnet)
                                      │
                                      └─ Blockiert! (Code C & D gehen verloren)
```

### 2.2 Reiner Player (Open-Loop) vs. Kontrollierter Ablauf (Closed-Loop)
Ein abgespieltes Video ist ein **Open-Loop-System** ohne Rückkanal. Für einen produktiven Ablauf werden folgende Anpassungen benötigt:
1. **Kein Video-Export:** Abspielen über einen gesteuerten Zustandsautomaten.
2. **Blitzschnelles Ausblenden (Blanking):** Bei Stop oder Pause muss das Symbol sofort in eine leere Fläche (Schwarz oder Weiß) wechseln.
3. **Leerphasen-Steuerung (Blanking Interval):** Zwischen zwei Barcodes muss eine Leerphase eingefügt werden, um Mehrfacherfassungen desselben Codes oder scannerseitige Unterdrückungen zu verhindern.
4. **Kleinstapel-Modus (Batching):** Optionales Anhalten nach $N$ Codes (z. B. 5er-Stapel), bis der Bediener an der Kasse quittiert.

---

## 3. Barcode- & GS1-Standards (EAN-13, EAN-8, QR-Code)

### 3.1 Symbologien und Formatabgrenzung
* **EAN-13 (GTIN-13 / RCN-13):** Standard im europäischen Einzelhandel. Besteht aus 12 Nutzdatenstellen und 1 Prüfziffer.
* **EAN-8 (GTIN-8 / RCN-8):** Kurzformat für kleine Verpackungen (7 Nutzdatenstellen + 1 Prüfziffer). *Hinweis: Ein Format „EAN-9“ existiert im GS1-Standard nicht.*
* **QR-Code:** 2D-Matrixcode. Im MVP als klassischer Text-QR unterstützt.

```
    EAN-13 Struktur:  [ N1 N2 N3 N4 N5 N6 N7 N8 N9 N10 N11 N12 ] [ P ]
                      └──────────────────┬────────────────────┘   └─ Modulo-10 Prüfziffer
                                  12 Nutzdatenstellen
```

### 3.2 GS1 Modulo-10 Prüfziffern-Mathematik
Für eine 12-stellige Nutzdatensequenz $d_1 d_2 \dots d_{12}$ berechnet sich die Prüfziffer $P$ nach dem offiziellen GS1-Algorithmus:

$$\text{Gewichtete Summe } S = \sum_{i=1}^{12} d_i \cdot w_i \quad \text{mit } w_i = \begin{cases} 1 & \text{falls } i \text{ ungerade} \\ 3 & \text{falls } i \text{ gerade} \end{cases}$$

$$S = 1 \cdot d_1 + 3 \cdot d_2 + 1 \cdot d_3 + 3 \cdot d_4 + 1 \cdot d_5 + 3 \cdot d_6 + 1 \cdot d_7 + 3 \cdot d_8 + 1 \cdot d_9 + 3 \cdot d_{10} + 1 \cdot d_{11} + 3 \cdot d_{12}$$

$$P = (10 - (S \bmod 10)) \bmod 10$$

### 3.3 Status-Differenzierung bei Codes
Ein Code muss in der Anwendung folgende unabhängige Qualitätsstufen durchlaufen:
* **Syntax-Status:** Stimmen Länge und zulässige Zeichen? (`valid` / `invalid`)
* **Checksum-Status:** Ist die Modulo-10-Prüfziffer mathematisch korrekt? (`valid` / `invalid`)
* **Katalog-Status:** Ist der Artikel im Zielkassensystem angelegt und aktiv? (`known` / `unknown` / `unchecked`)

---

## 4. Pattern- & Sequenz-Engine

### 4.1 Analyse des Musters `2 063701 0289 XY`
Die Eingabe `2 063701 0289 XY` hat unformatiert 13 Zeichen: `20637010289XY`.
Im GS1-Standard (Schweiz: RCN-Präfix `20` für interne Zwecke) gilt bei EAN-13:
* **Positionen 1–11:** Fester Teil (`20637010289`).
* **Position 12 ($X$):** Einzige frei wählbare Nutzdatenziffer ($0 \dots 9$).
* **Position 13 ($Y$):** Mathematisch zwingend gebundene Prüfziffer $P$.

*Konsequenz:* $X$ und $Y$ können **nicht** unabhängig von `00` bis `99` hochgezählt werden.

### 4.2 Lösung: Sequenz-Varianten
1. **Variante A (Exakt 13-stellig mit 1 variablen Nutzdatenziffer):**  
   Fester Rumpf: `20637010289`, $X \in [0 \dots 9]$. $Y$ wird automatisch berechnet. Max. 10 Codes.
2. **Variante B (Fünfstelliges Nutzdatenfeld mit Schrittweite $+12$):**  
   Präfix: `2063701`, Nutzdatenfeld (5 Stellen): Start `00289`, Schrittweite $+12$.

#### Beispielberechnung für Variante B (Schrittweite $+12$):
| Schritt | Nutzdaten-Feld | 12-stelliger Rumpf | Prüfziffer $P$ | Resultierende EAN-13 |
|---|---|---|---|---|
| Start | `00289` | `206370100289` | $7$ | `2063701002897` |
| +12 | `00301` | `206370100301` | $9$ | `2063701003019` |
| +12 | `00313` | `206370100313` | $1$ | `2063701003131` |
| +12 | `00325` | `206370100325` | $3$ | `2063701003253` |

---

## 5. Hardware-Sensoren & Experimenteller Rückkanal

Bei verdecktem Display (Handy auf Glasplatte des Scanners gelegt) kann der Anwender den Fortschritt nicht sehen. Es werden drei Rückkanal-Ansätze untersucht:

### 5.1 Frontkamera-Lichtanalyse (Optischer Sensor)
Die Frontkamera erfasst das vom Scannerglas reflektierte Licht.
* **Metrik:** Rot-Dominanz-Quotient $Q_{\text{red}}$:
  $$Q_{\text{red}} = \frac{R}{R + G + B + \epsilon}$$
* **Herausforderung:** Unterschiedliche Scannermodi (Zebra, Datalogic, Honeywell). Einige Geräte nutzen dauerhaftes rotes Zieldioden-Licht, andere blinken mit $1 \text{ Hz}$ im Präsentationsmodus.
* **Bewertung:** Als harter Freigabe-Trigger ungeeignet, jedoch als **Sicherheits-Stopp** nutzbar (wenn Licht komplett erlischt = Scanner offline).

### 5.2 Akustische Erkennung über Mikrofon (Audio-Sensor)
* **Funktion:** Erkennung der typischen Pieptöne von POS-Scannern ($2 \text{ kHz} \dots 4 \text{ kHz}$ Frequenzpeak) bei erfolgreicher Erfassung („Good Read“).
* **Vorteil:** Funktioniert unabhängig von der Display-Ausrichtung.
* **Einschränkung:** Umgebungsgeräusche im Lager können Fehlauslösungen erzeugen.

### 5.3 Lift-to-Pause (Bewegungssensor)
* **Funktion:** Nutzung des Beschleunigungssensors (`DeviceMotionEvent`). Wird das Handy angehoben (z. B. $Z$-Achse $> 12 \text{ m/s}^2$), pausiert der Fader sofort und blendet das Symbol aus.

---

## 6. Technologieentscheidung & PWA-Plattform-Stack

| Komponente | Wahl / Bibliothek | Rationale |
|---|---|---|
| **Plattform** | Progressive Web App (PWA) | Plattformunabhängig, keine App-Store-Hürden, direkt auf Android installierbar. |
| **Sprache / Build** | TypeScript + Vite | Typensicherheit für GS1-Logik, extrem schnelle Ladezeiten. |
| **Barcode-Rendering**| `@bwip-js/browser` | Native Vector-Draws auf HTML5 Canvas; garantiert scharfe Kanten ohne Artefakte. |
| **Barcode-Reading**  | `zxing-wasm` | High-Performance WebAssembly-Portierung der ZXing-Bibliothek. |
| **Datenhaltung**     | IndexedDB (`idb` Wrapper) | Strukturierte Offline-Datenbank für >100.000 Artikel und Historien. |
| **Storage-Schutz**   | `navigator.storage.persist()` | Verhindert automatisches Löschen der Daten durch den Android-Browser. |

---

## 7. Systemarchitektur, Datenmodell & Zustandsautomat

### 7.1 Modulare Systemarchitektur
```text
┌────────────────────────────────────────────────────────────────────────┐
│                        UI Layer (HTML5 / SASS)                         │
│   [ Scanner-View ]    [ Generator-View ]    [ Player / Fader-View ]    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                    Application Layer (Services)                        │
│   [ CaptureService ]    [ SequenceEngine ]    [ PlaybackController ]   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                       Domain Layer (Business Logic)                    │
│   [ ChecksumCalculator ]   [ EANValidator ]   [ BatchStateModel ]      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                         Adapter Layer (Hardware)                       │
│   [ ZXingWasmAdapter ]   [ BwipRenderer ]   [ IndexedDbAdapter ]       │
│   [ FrontCamSensor ]     [ AudioSensor ]    [ MotionSensor ]           │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Core Datenmodell (TypeScript Interfaces)

```ts
export type Symbology = 'EAN13' | 'EAN8' | 'QRCode' | 'Code128';

export interface BarcodeItem {
  id: string;
  collectionId: string;
  position: number;
  symbology: Symbology;
  value: string;
  quantity: number;
  source: 'camera' | 'image' | 'manual' | 'sequence';
  capturedAt: string;
  syntaxStatus: 'valid' | 'invalid';
  checksumStatus: 'valid' | 'invalid' | 'not-applicable';
  catalogStatus: 'known' | 'unknown' | 'unchecked';
  label?: string;
}

export interface SequenceConfig {
  prefix: string;
  variableWidth: number;
  suffixBeforeChecksum: string;
  startValue: number;
  endValue: number;
  stepSize: number;
  symbology: Symbology;
}

export interface PlaybackSession {
  sessionId: string;
  items: BarcodeItem[];
  displayDurationMs: number;
  blankDurationMs: number;
  batchSize: number; // 0 = unbegrenzt
  currentIndex: number;
  state: 'IDLE' | 'COUNTDOWN' | 'SHOWING' | 'BLANKING' | 'PAUSED' | 'FINISHED';
}
```

### 7.3 Playback-Zustandsautomat (Fader Engine)

```text
       ┌──────────┐
       │   IDLE   │
       └────┬─────┘
            │ Start
       ┌────▼─────┐
    ┌──► COUNTDOWN ◄──┐
    │  └────┬─────┘   │
    │       │ Timeout │
    │  ┌────▼─────┐   │
    │  │  SHOWING │   │
    │  └────┬─────┘   │
    │       │ Display-Zeit abgelaufen
    │  ┌────▼─────┐   │
    │  │ BLANKING │   │ (Bildschirm weiß/schwarz)
    │  └────┬─────┘   │
    │       │ Blank-Zeit abgelaufen
    └───────┴─────────┘
```

*Sicherheitsregel:* Bei Auslösung von **PAUSE** schaltet das System augenblicklich in den Zustand `BLANKING` um, löscht den Canvas-Inhalt und stoppt alle Timer.

---

## 8. Offlinebetrieb, Caching & Datenschutz

1. **Local WASM Loading:**  
   Standardmäßig lädt `zxing-wasm` das Binärpaket vom CDN. Für 100% Offline-Betrieb muss der Pfad lokal umgeleitet werden:
   ```ts
   import { setWasmPaths } from 'zxing-wasm';
   setWasmPaths({ 'zxing_reader.wasm': '/wasm/zxing_reader.wasm' });
   ```
2. **Service Worker Caching Strategy:**
   * **App Shell (HTML/JS/CSS/WASM):** Cache-First-Strategie.
   * **Nutzerdaten:** Werden ausschließlich lokal in IndexedDB verarbeitet. Es erfolgt kein Upload an externe Server.

---

## 9. Teststrategie, Hardware-Matrix & Risikoregister

### 9.1 Hardware-Testmatrix für Kassenscanner

| Test-ID | Scanner-Typ | Symbologie | Display-Helligkeit | Display-Zeit | Blank-Zeit | Ergebnis |
|---|---|---|---|---|---|---|
| HW-01 | Zebra DS2208 Handscanner | EAN-13 | 100% | 300 ms | 150 ms | PASSED |
| HW-02 | Datalogic Magellan 3450VS | EAN-13 | 100% | 300 ms | 100 ms | PASSED |
| HW-03 | Datalogic Magellan 3450VS | QR-Code | 80% | 400 ms | 150 ms | PASSED |
| HW-04 | Kassen-Einbauscanner | Ident. EAN-13 | 100% | 300 ms | 300 ms | Benötigt 300ms Blank |

### 9.2 Risikoregister & Gegenmaßnahmen

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| **Unbekannter Artikel an Kasse** | POS stoppt mit Dialog, Player läuft weiter | Kleinstapel-Modus, Schnell-Stopp-Taste, Lift-to-Pause |
| **Scanner unterdrückt identische Codes** | Menge stimmt an der Kasse nicht | Ausreichend lange Leerphase (`blankDurationMs >= 300ms`) erzwingen |
| **Ungültige Prüfziffer bei Sequenz** | Scanner piept nicht / Fehlermeldung | GS1-Prüfziffernmodul erzwingt mathematische Neuberechnung |
| **Display-Abschaltung (Standby)** | Fader unterbrochen | HTML5 `navigator.wakeLock.request('screen')` aktivieren |

---

## 10. Architecture Decision Records (ADRs) & Referenzcode

### 10.1 Key ADRs
* **ADR-01: Wahl von PWA statt Native Kotlin App**  
  *Entscheidung:* PWA mit WebAssembly.  
  *Grund:* Schnellere Entwicklung, einfache Updates, direkte Plattformunabhängigkeit.
* **ADR-02: Kein Video-Export für die Wiedergabe**  
  *Entscheidung:* Exklusive Nutzung der JS-Zustandsmaschine.  
  *Grund:* Videos bieten keine Unterbrechungs- und Blanking-Kontrolle bei POS-Fehlern.
* **ADR-03: Entkopplung von Prüfziffer und Nutzdaten**  
  *Entscheidung:* Generatoren verändern nur Nutzdatenfelder; die letzte Ziffer wird stets berechnet.  
  *Grund:* Einhaltung der GS1-Spezifikation.

### 10.2 Referenzcode: GS1 Modulo-10 Prüfziffer & Sequenzgenerator (TypeScript)

```ts
/**
 * Berechnet die GS1 Modulo-10 Prüfziffer für einen beliebig langen Ziffern-String.
 */
export function calculateGs1CheckDigit(body: string): string {
  if (!/^\d+$/.test(body)) {
    throw new Error('Ungültige Eingabe: Nur Ziffern erlaubt.');
  }
  
  let sum = 0;
  let weight = 3;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body.charAt(i), 10) * weight;
    weight = weight === 3 ? 1 : 3;
  }

  const remainder = sum % 10;
  return remainder === 0 ? '0' : String(10 - remainder);
}

/**
 * Erzeugt eine EAN-13 Sequenz für variable Nutzdatenfelder mit Schrittweite.
 */
export function generateEan13Sequence(
  prefix: string,
  startVal: number,
  endVal: number,
  step: number,
  varWidth: number
): string[] {
  const results: string[] = [];
  
  for (let val = startVal; val <= endVal; val += step) {
    const varPart = String(val).padStart(varWidth, '0');
    const body = `${prefix}${varPart}`;
    
    if (body.length !== 12) {
      throw new Error(`Rumpflänge muss exakt 12 Ziffern sein. Aktuell: ${body.length}`);
    }
    
    const checkDigit = calculateGs1CheckDigit(body);
    results.push(`${body}${checkDigit}`);
  }
  
  return results;
}
```