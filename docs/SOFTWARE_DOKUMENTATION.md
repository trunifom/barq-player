# Software- & Architekturdokumentation – BarQPlayer

Stand: Meilenstein 0. Maßgeblich: [`Barcode_Lager_App_Dokumentation.md`](Barcode_Lager_App_Dokumentation.md) und [`../AGENTS.md`](../AGENTS.md). Diese Datei wird mit jedem Meilenstein erweitert.

## 1. Modulübersicht und Abhängigkeitsregeln

```
ui ──► application ──► domain
 │          │
 └────► adapters ─────► domain
offline (Service Worker, unabhängig)
```

| Schicht | Inhalt | Darf nicht |
|---|---|---|
| `src/domain/` | Prüfziffern, Sequenzen, Zustandsautomat, Interleaving, Fehler, Typen | DOM, `window`, Kamera, IndexedDB, Browser-/Node-APIs |
| `src/application/` | Use-Cases (Capture, Collections, Playback, Backup, Validation) | direkt DOM anfassen |
| `src/adapters/` | Kamera, Decoder, Renderer, Dexie, Sensoren | Fachentscheidungen treffen |
| `src/ui/` | Mobile-first Screens/Komponenten | Fachlogik enthalten |
| `src/offline/` | Service Worker, Update-Policy | – |

Abhängigkeiten zeigen nur nach innen (`domain` kennt niemanden).

## 2. Datenmodell
Siehe Spezifikation Kap. 16. Barcodes immer als `string`. Das Dexie-Schema (Meilenstein 3) wird hier mit Versionsstand dokumentiert.

## 3. Zustandsautomat (`src/domain/playback-machine.ts`)

```text
            start()                     Startverzögerung
 IDLE ───────────────► VALIDATING ──ok──► COUNTDOWN ───────────► SHOWING ◄──────────────┐
                           │ (Liste ungültig)                      │ displayMs          │ blank-Zeit
                           ▼                                       ▼                    │ (blankMs bzw.
                         ERROR                    auto/Stapel ► BLANKING ───────────────┘  identicalBlankMs)
                                                  manuell / Stapelende ► WAITING_CONFIRMATION
                                                                          │ confirm()
                                                                          └──► BLANKING ► SHOWING … ► FINISHED

 COUNTDOWN | SHOWING | BLANKING | WAITING_CONFIRMATION ──pause(quelle)──► PAUSED
 jeder aktive Zustand (+PAUSED) ──fail(e)──► ERROR
 PAUSED | ERROR ──resume(entscheidung)──► COUNTDOWN ► SHOWING …   (oder FINISHED)
 jeder aktive Zustand ──abort()──► FINISHED (aborted)
```

**Übergangsregeln**
- Das Symbol ist nur in `SHOWING` sichtbar (`snapshot.visibleEntry`); in allen anderen Zuständen ist die Fläche leer. Es gibt keine Überblendung; zwischen zwei Symbolen liegt immer `BLANKING` bzw. `WAITING_CONFIRMATION`.
- `pause`, `fail`, `abort` und Hintergrundwechsel (`pause('background')`, vom Lifecycle-Adapter bei `visibilitychange`) wirken **synchron**: Timer löschen, Generation erhöhen, Symbol aus.
- **Generation-IDs:** Jeder Timer merkt sich die Generation bei der Planung und tut nichts, wenn sie sich geändert hat – auch wenn ein Scheduler `clearTimeout` ignoriert (Race-Condition-Tests).
- **Blank-Zeiten:** `identicalBlankMs`, wenn Symbologie und Wert des Folgecodes gleich sind, sonst `blankMs`.
- **Modi:** `auto` (ohne Rückkanal, läuft bis `FINISHED`), `manual` (nach jeder Anzeige `WAITING_CONFIRMATION`), `batch` (nach `batchSize` Anzeigen und am Listenende `WAITING_CONFIRMATION`).
- **Fortsetzen:** immer über `COUNTDOWN` (Startverzögerung, leere Fläche). Entscheidungen: `reconciled` (bis zur letzten Anzeige manuell bestätigt, weiter danach), `repeat` (ab erster unbestätigter Position; `doubleBookingRisk=true`), `skip` (ohne Bestätigung nach der letzten Anzeige weiter, protokolliert), `from-position`. Verpasste Positionen werden nie automatisch nachgeholt.
- **Unklarer Übergabebereich:** `uncertainRange = [unresolvedFrom … highestDisplayedIndex]`; `lastConfirmedIndex` ist die zuletzt MANUELL bestätigte Position. `displayed` (Evidenz `player`) und `manual-confirmed` (Evidenz `operator`) sind getrennte Ereignisse; `pos-accepted`/`pos-rejected` erzeugt die Maschine nie (F-15).
- **Fehlersicherheit:** Wirft ein UI-Listener (Unsicherheit, ob das Symbol ausgeblendet wurde), geht die Maschine in `ERROR` und meldet den Fehler über `onInternalError`.
- **Ereignisprotokoll:** `PlaybackEvent[]` mit `displayed`, `blanked`, `paused`, `manual-confirmed`, `uncertain`; Details enthalten Positionsnummern, nie Barcode-Werte.

### Interleaver (`src/domain/interleaver.ts`)
Greedy nach größter Restmenge ohne direkten Vorgänger gleicher Identität (`keyOf`); Gleichstand → zuerst aufgetretener Wert; Reihenfolge innerhalb eines Werts bleibt. Optimal, wenn der häufigste Wert ≤ ⌈n/2⌉ ist; sonst bleibt `maxCount − (n − maxCount) − 1` unvermeidbare Nachbarn (Statistik). Listen ohne identische Nachbarn bleiben unverändert; abschaltbar (`enabled: false`).

## 4. Fehlerkonzept und Error-Code-Katalog (`src/domain/errors.ts`)

`AppError` trägt `code`, `details` (technisch), `cause`, `userMessage` (deutsch, UI) und `recoveryHint` (Handlungsempfehlung). `toAppError(unknown)` normalisiert jeden gefangenen Wert; `isAppError` ist der Type Guard. Der `ErrorLogger` ist ein Ringpuffer (Standard 200 Einträge) mit Listenern für UI-Banner. Er protokolliert nur Code, Standardmeldung und bereinigten Kontext – **nie** `details` oder Barcode-Werte (Kontextschlüssel `value`, `raw`, `content`, `text`, `payload`, `token`, … werden zu `[redacted]`).

| Code | Bedeutung | Ausgelöst durch |
|---|---|---|
| `ERR_SYNTAX_INVALID` | Länge/Zeichen ungültig | `checksum`, `bulk-parser` |
| `ERR_CHECKSUM_INVALID` | GS1-Prüfziffer falsch | `validateGtin`, `bulk-parser` |
| `ERR_SEQUENCE_CONFIG_INVALID` | Vorlage/Definition ungültig | `sequence` |
| `ERR_SEQUENCE_OVERFLOW` | Wert passt nicht ins variable Feld | `sequence`, `endFromCount` |
| `ERR_SEQUENCE_LIMIT_EXCEEDED` | Mehr als `maxItems` Positionen | `sequence` |
| `ERR_BULK_INPUT_INVALID` | Eingabe kein String / zu viele Zeilen | `bulk-parser` |
| `ERR_CAMERA_PERMISSION_DENIED`, `ERR_CAMERA_NOT_FOUND`, `ERR_CAMERA_INSECURE_CONTEXT` | Kamera | M5 |
| `ERR_WASM_LOAD_FAILED`, `ERR_DECODE_FAILED` | Decoder | M5 |
| `ERR_STORAGE_WRITE_FAILED`, `ERR_STORAGE_QUOTA_EXCEEDED` | Persistenz | M3 |
| `ERR_IMPORT_SCHEMA_INVALID`, `ERR_IMPORT_CSV_INVALID` | Import | M3 |
| `ERR_PLAYBACK_FAILED` | Laufzeitfehler im Player (→ Symbol sofort ausblenden) | M2/M6 |
| `ERR_UNKNOWN` | Fallback | überall |

Regeln: Jeder `catch` behandelt den Fehler typisiert (`unknown` → `toAppError`), protokolliert über den Logger und macht ihn in der UI sichtbar. Kein stilles Verschlucken.

## 4a. Prüfziffern (`src/domain/checksum.ts`)
GS1 Modulo-10: Gewichte 3,1,3,1,… von **rechts** über den Nummernkörper (letzte Nutzdatenstelle = 3); Prüfziffer = `(10 − S mod 10) mod 10`. Gilt unverändert für EAN-13 (12+1), EAN-8 (7+1) und UPC-A (11+1). `validateGtin` trennt `syntax` und `checksum`, nennt bei falscher Prüfziffer die erwartete Ziffer und **korrigiert nie**. Die Symbologie wird immer vorgegeben, nie aus der Länge geraten.

## 4b. Sequenz-Engine (`src/domain/sequence.ts`)
Wert = `prefix + pad(feld, variableWidth) + suffixBeforeCheckDigit` (+ GS1-Prüfziffer bei EAN). Start/Ende/Schritt sind dezimale Strings (JSON-sicher), gerechnet wird mit `BigInt`.

- Beispiel `2 063701 028{XX}{C}`, Schritt `+12`: Präfix `2063701028`, Feldbreite 2 → Werte `00, 12, … 96` (9 Codes); Endwert 100 ⇒ `ERR_SEQUENCE_OVERFLOW`, nichts wird erzeugt.
- EAN-13 verlangt `|prefix| + width + |suffix| = 12`, EAN-8 = 7; EAN braucht `gs1-mod10`, QR/Code 128 brauchen `none`.
- `validateSequenceDefinition` sammelt **alle** feldgenauen Fehler/Warnungen; `generateSequence` wirft sofort (nicht erst beim ersten `next()`), liefert lazy und verwendet nie mehr als `maxItems` (Standard 10 000, hart 100 000).
- `endFromCount` rechnet „Anzahl“ in ein Ende um und meldet Überlauf.
- `parseSequenceTemplate('2 063701 028{XX}{C}', 'EAN13')` zerlegt die Schreibweise; Leerzeichen in festen Teilen werden nur bei EAN entfernt.

## 4c. Bulk-Parser (`src/domain/bulk-parser.ts`)
Eine Zeile = ein Code, explizite Symbologie, zeilengenaue deutsche Fehler (`Zeile 7: …`), ungültige Zeilen erscheinen nie in den Ergebnissen. Normalisierung: BOM weg; EAN/UPC: Leerzeichen/Tabs entfernen; Code 128: Zeilenränder trimmen, ASCII 0x20–0x7E, ≤ 80 Zeichen; QR: Text unverändert, keine Steuerzeichen (außer Tab), ≤ 2000 UTF-8-Bytes. Grenze 10 000 Zeilen (`ERR_BULK_INPUT_INVALID`). Duplikate: `keep` (Standard) oder `merge` (zu Menge).

## 5. Rendering-Mathematik
Wird in Meilenstein 4 dokumentiert (Ruhezonen EAN-13 11X/7X, EAN-8 7X/7X, Code 128 10X/10X, QR 4X; ganzzahlige Pixel pro Modul).

## 6. Offline-/WASM-Strategie
- `zxing-wasm` lädt `./wasm/zxing_reader.wasm` über `locateFile`; kein CDN zur Laufzeit.
- `npm run copy:wasm` kopiert die zur installierten Bibliotheksversion passende Datei aus `node_modules/zxing-wasm/dist/reader/` nach `public/wasm/` (Bibliothek und WASM müssen versionsgleich sein).
- `vite-plugin-pwa` (generateSW, `registerType: 'prompt'`) legt alle Assets inkl. `.wasm` in den Precache. Baseline-Build M0: 7 Einträge, ca. 926 KiB.

## 7. Testkonzept
Vitest; Unit-Tests in `tests/unit/`, Integration in `tests/integration/` (`fake-indexeddb`, `jsdom` bei Bedarf). Quality Gate vor jedem Commit: `npm test` und `npm run build` fehlerfrei. Jede Logik in `src/domain/` braucht Unit-Tests.

Hinweis Windows: Vitest aus Git Bash gestartet scheitert wegen Pfad-Schreibweise (`c:` vs. `C:`, doppelte Modulinstanzen, „failed to find the current suite“). Tests aus PowerShell/cmd starten.

## 8. ADR-Protokoll
Spezifikations-ADRs 01–05 gelten unverändert (Kap. 26). Ergänzungen:

### ADR-06: Eigene `vitest.config.ts`
Entscheidung: Test-Konfiguration getrennt von `vite.config.ts`. Grund: Das PWA-Plugin wird im Testlauf nicht gebraucht; saubere Trennung.

### ADR-08: Sequenzende außerhalb des Schrittrasters
Entscheidung: Liegt `end` nicht auf dem Raster, endet die Reihe beim letzten Rasterwert ≤ `end` und die Vorschau zeigt eine **Warnung** (kein Fehler). Grund: Spezifikation 21 („Ende wird nur erreicht, wenn es auf dem Schrittraster liegt“); sichtbar statt still.

### ADR-09: Überlauf = Fehler, nicht Warnung
Entscheidung: `start` oder `end` größer als das Feldmaximum ⇒ `ERR_SEQUENCE_OVERFLOW`; keine Ausgabe. „Anzahl“-Eingaben laufen über `endFromCount`. Ein Schritt größer als der Bereich liefert legal genau einen Wert (Warnung). Grund: Spezifikation 6.3 und AGENTS.md Regel 4.

### ADR-10: Sequenzen für EAN verlangen volle Körperlänge
Entscheidung: Die Summe aus Präfix, Feld und festem Teil muss exakt 12 (EAN-13) bzw. 7 (EAN-8) betragen; es wird weder aufgefüllt noch gekürzt. Grund: Spezifikation 6.2 (Beispiel `20637010289XY` kann nicht zwei freie Endstellen haben).

### ADR-11: Leerraum-Regeln im Bulk-Parser
Entscheidung: Nur bei EAN/UPC werden Leerzeichen/Tabs innerhalb der Zeile entfernt; QR bleibt unverändert, Code 128 wird nur an den Rändern getrimmt. Grund: Spezifikation 6.5 (QR nicht mit EAN-Regeln behandeln).

### ADR-12: Zustandsmaschine mit injiziertem Scheduler
Entscheidung: `PlaybackMachine` ist eine kleine Klasse mit injiziertem `Scheduler` statt eines reinen Reducers plus separatem Timer-Code. Grund: Timer, Generation-ID und Zustand müssen atomar zusammenwirken; Tests können Zeit deterministisch steuern (ManualScheduler) und zusätzlich mit Vitest-Fake-Timern prüfen. Die Domain bleibt browserfrei.

### ADR-13: Manuell = zeitbegrenzte Anzeige + Bestätigung
Entscheidung: Auch im manuellen Modus wird das Symbol nach `displayMs` ausgeblendet (Spezifikation 12.2 A); die Bestätigung öffnet den Weg zur nächsten Position über `BLANKING`. Eine „Dauer anzeigen“-Option gehört nicht zur sicheren Playerpause (Spezifikation 11.3) und ist nicht Teil der Maschine.

### ADR-14: Interleaver sortiert nur bei Bedarf
Entscheidung: Ohne identische Nachbarn bleibt die Reihenfolge unverändert. Grund: Die Reihenfolge der Sammlung soll nicht ohne Not verändert werden.

### ADR-07: Toolchain-Versionen
Entscheidung: Aktuelle Releases (TypeScript 7, Vite 8, Vitest 5) wie von `npm install` aufgelöst; Versionen sind durch `package-lock.json` fixiert. `@types/node` nur für Tests (`types: ["node"]`); `src/domain/` bleibt frei von Node-/Browser-APIs.
