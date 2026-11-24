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

## 2. Datenmodell und Persistenz (`src/domain/types.ts`, `src/adapters/persistence/db.ts`)
Siehe Spezifikation Kap. 16. Barcodes immer als `string`; `syntaxStatus`, `checksumStatus` und `catalogStatus` sind getrennte Aussagen (kein gemeinsamer „grüner Haken“).

**Dexie-Schema (Datenbank `barq-player`), aktuelle Version 1**

| Tabelle | Primärschlüssel | Indizes | Inhalt |
|---|---|---|---|
| `collections` | `id` | `name`, `updatedAt` | Sammlungen |
| `items` | `id` | `collectionId`, `[collectionId+position]`, `value` | Codes (Position 0-basiert, lückenlos) |
| `templates` | `id` | `name` | Sequenzvorlagen |
| `profiles` | `id` | – | Scannerprofile (Standardprofile werden beim ersten `listProfiles()` angelegt) |
| `catalog` | `value` | – | Artikelstamm (Kennung, aktiv, Quelle, Importdatum) |
| `sessions` | `id` | `collectionId`, `startedAt` | Sitzungskopf inkl. App-Version |
| `events` | `id` | `sessionId`, `timestamp` | Wiedergabeereignisse |

**Versionierung:** Schemaänderungen nur als neuer `this.version(n).stores(...)`-Block (mit `upgrade`-Funktion bei Datenumbau) – bestehende Blöcke werden nie geändert. Vor riskanten Migrationen soll die UI ein JSON-Backup anbieten (Spezifikation 19.4). Das Backup-Format hat eine eigene `schemaVersion` (aktuell 1); neuere Dateien werden abgelehnt, ältere über eine künftige Migrationsfunktion in `backup-schema.ts` gehoben.

**Schreibzugriffe:** immer über `guardWrite`/`mapStorageError` (`QuotaExceededError` → `ERR_STORAGE_QUOTA_EXCEEDED`, sonst `ERR_STORAGE_WRITE_FAILED`). Mehrtabellen-Schreibvorgänge laufen in einer Dexie-Transaktion (alles oder nichts). Die UI bestätigt „gespeichert“ erst nach erfolgreichem Rückgabewert des Service-Aufrufs.

**Persistenz:** `requestPersistentStorage()` ruft `navigator.storage.persisted()/persist()/estimate()` auf und liefert `{supported, persisted, usageBytes, quotaBytes, error}`; sie wirft nie. Persistenter Speicher ersetzt kein Backup.

## 2a. Services (`src/application/`)
- `CollectionService`: Sammlungen (Name 1–100 Zeichen), Einträge (`addItem(s)` validiert mit `validateCodeValue`; ungültige Werte werden abgelehnt, nie korrigiert; `addItems` ist atomar), Duplikatregel `merge` (Menge erhöhen, Standard) oder `append`, Menge 1–9999, Verschieben/Entfernen mit lückenloser Neunummerierung, Artikelstamm-Abgleich (`known`/`inactive`/`unknown` mit `catalogSource` und `catalogCheckedAt`; ohne Stamm bleibt `unchecked`), Vorlagen, Profile.
- `BackupService`: JSON-Voll-Export/-Import, CSV-Export/-Import einer Sammlung, Artikelstamm-CSV.
- `SessionService`: Sitzungskopf und Ereignisse (idempotent über Ereignis-ID).

## 2b. Backup-Format (`src/domain/backup-schema.ts`)
`{ format: "barq-player-backup", schemaVersion, exportedAt, appVersion, data: { collections, items, templates, profiles, catalog, sessions, events } }`. `validateBackup` prüft die komplette Datei **vor** dem ersten Schreibzugriff: Struktur, Typen, Aufzählungen, `quantity`/`position` als ganze Zahlen, `value` als String (nie Zahl), eindeutige IDs, Verweise Eintrag→Sammlung und Ereignis→Sitzung, eindeutige Positionen je Sammlung; unbekannte Zusatzfelder werden verworfen, Probleme mit Pfad (`data.items[3].quantity`) gemeldet (max. 50). Import = Replace-All in einer Transaktion; ein Fehler mittendrin rollt alles zurück.

## 2c. CSV (`src/domain/csv.ts`, `csv-items.ts`)
- RFC-4180-Parser (Anführungszeichen, Zeilenumbrüche in Feldern, BOM, CRLF/LF/CR), Trennzeichen `,` `;` Tab automatisch erkannt, alle Zellen bleiben Strings. Offene Anführungszeichen u. Ä. → `ERR_IMPORT_CSV_INVALID` mit Zeilennummer.
- **Formelschutz:** Beim Export erhält jede Zelle, die mit `=`, `+`, `-`, `@`, Tab oder CR beginnt (auch nach führenden `'`), ein vorangestelltes `'`; beim Import wird genau dieses eine `'` wieder entfernt (verlustfreier Round-Trip, getestet).
- **Führende Nullen:** Werte werden nie in Zahlen umgewandelt. Hat ein Tabellenprogramm Nullen entfernt, meldet der Import einen Längenfehler samt Hinweis – es wird nicht „repariert“.
- Export-Spalten: `collection, position (ab 1), symbology, value, quantity, label, source, syntaxStatus, checksumStatus, catalogStatus`. Import: Spaltenzuordnung per Kopfzeile (deutsch/englisch) oder manuell; Standardsymbologie für Dateien ohne Symbologie-Spalte; `abort` (Standard, nichts importieren) oder `skip-invalid`; Fehlerbericht pro Zeile.
- Artikelstamm-CSV: Kennung (`EAN`/`GTIN`/`Code`/…), optional `Aktiv` (ja/nein/1/0/…) und `Bezeichnung`; doppelte Kennungen sind Fehler.

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

## 5. Rendering (`src/domain/render-layout.ts`, `src/adapters/renderer/barcode-renderer.ts`)

**Pipeline:** Wert validieren (`validateCodeValue`, wie beim Speichern) → bwip-js `raw()` liefert nur das Modulmuster (1D: abwechselnde Balken-/Lückenbreiten, beginnend mit Balken; QR: Matrix) → eigenes SVG aus ganzzahligen Modulkoordinaten. bwip-js zeichnet nichts; so sind Farben, Ruhezonen und Skalierung vollständig unter eigener Kontrolle und im Test prüfbar.

**Ruhezonen (Module „X“)**

| Symbologie | links | rechts | oben/unten |
|---|---|---|---|
| EAN-13 | 11 | 7 | 4 |
| EAN-8 | 7 | 7 | 4 |
| UPC-A | 9 | 9 | 4 |
| Code 128 | 10 | 10 | 4 |
| QR | 4 | 4 | 4 |

Balkenhöhe (Module, ohne Klartext): EAN-13/UPC-A 69, EAN-8 65, Code 128 50.

**Skalierung:** `modulePx = floor(min(Viewport.width·dpr / modulesWide, Viewport.height·dpr / modulesHigh))` in **Gerätepixeln** (mindestens 1). Das SVG hat `viewBox="0 0 W H"` in Modulen und `width/height = modules·modulePx / dpr` (CSS-Pixel, so dass Gerätepixel ganzzahlig bleiben). Passt das Symbol selbst mit 1 Gerätepixel/Modul nicht, setzt der Renderer `fits=false` – es wird nie gestaucht oder abgeschnitten; der Player muss das als Fehler behandeln.

**Drehung:** `recommendRotation` empfiehlt 90° nur für 1D-Codes, wenn ungedreht `< 3` Gerätepixel/Modul möglich wären **und** die Drehung ein größeres Modulmaß erlaubt. Die Geometrie wird gedreht ((x,y,w,h) → (H−y−h, x, h, w)); es gibt kein `transform`. QR wird nie gedreht.

**Farben/Effekte:** nur `#000000` auf `#FFFFFF`, `shape-rendering="crispEdges"`, `style="forced-color-adjust:none;color-scheme:light only"` gegen Dark-Mode-/Kontrast-Umkehr; keine Opacity, Filter, Strokes oder Transformationen (per Test abgesichert).

**QR:** Fehlerkorrektur `L/M/Q/H`, Standard `M`; zu langer Inhalt für die Stufe → `ERR_RENDER_FAILED` (nie stilles Kürzen). Text wird als Daten behandelt, nie ausgeführt.

**Lookahead-Cache (`RenderCache`):** LRU mit höchstens 3 Einträgen (aktuell + `MAX_LOOKAHEAD = 2`); `prefetch` bereitet höchstens 2 Folgesymbole vor und liefert Fehler als Liste zurück, statt sie zu verschlucken oder zu werfen. Das aktuelle Symbol rendert immer über `get` und wirft Fehler weiter.

**Verifikation:** Die Tests vergleichen die Modulzeile mit unabhängigen GS1-Referenz-Encodern (EAN-13/EAN-8/UPC-A), prüfen Start-/Stoppmuster bei Code 128 und rastern jedes Symbol zurück, um es mit `zxing-wasm` (lokales WASM) zu dekodieren (EAN, Code 128, QR in allen ECC-Stufen, Unicode, gedrehter Code 128).

**Hinweise für den Decoder-Adapter (M5):** zxing liefert UPC-A mit Formatnamen `UPCA` und als 13-stelligen Text mit führender `0`; diese Normalisierung muss dort explizit und dokumentiert erfolgen.

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

### ADR-07: Toolchain-Versionen
Entscheidung: Aktuelle Releases (TypeScript 7, Vite 8, Vitest 5) wie von `npm install` aufgelöst; Versionen sind durch `package-lock.json` fixiert. `@types/node` nur für Tests (`types: ["node"]`); `src/domain/` bleibt frei von Node-/Browser-APIs.

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

### ADR-15: Duplikate beim Erfassen standardmäßig zusammenführen
Entscheidung: `addItem` erhöht bei gleicher Symbologie und gleichem Wert die Menge (`merge`); `append` bleibt wählbar. Grund: Spezifikation 10.2 („Alternativ Menge direkt ändern“, keine globale Duplikatsperre); das technische Duplikat im Videostream behandelt der Capture-Service (M5) getrennt.

### ADR-16: Backup-Import ist Replace-All, atomar und vorvalidiert
Entscheidung: Kein Merge-Import. Eine ungültige Datei berührt die Datenbank nie. Grund: Spezifikation 20 („Import vor dem Überschreiben vollständig validieren“); ein Merge würde ID-Konflikte und Teilzustände erzeugen.

### ADR-17: CSV-Formelschutz per Apostroph mit Rückbau beim Import
Entscheidung: Schutz nach OWASP-Muster, aber reversibel (`'`-Präfix wird beim Import genau einmal entfernt). Grund: Verlustfreier Round-Trip bei gleichzeitigem Schutz vor Formeln in Excel/Calc.

### ADR-18: Positionen 0-basiert, lückenlos
Entscheidung: `BarcodeItem.position` ist 0-basiert und wird nach Entfernen/Verschieben neu nummeriert; die UI zeigt `position + 1`. Grund: einfache Indexierung der Ausgabeliste und eindeutiger Index `[collectionId+position]`.

### ADR-19: Artikelstamm-Abgleich nur über die Kennung
Entscheidung: Treffer wird über den Wert (String) ermittelt, nicht über die Symbologie. Grund: Der Stamm enthält Kennungen (GTIN/Artikelnummer); die Aussage gilt nur für den importierten Stand (Spezifikation 12.4).

### ADR-20: Test-Setup mit `fake-indexeddb` global
Entscheidung: `tests/setup.ts` lädt `fake-indexeddb/auto` für alle Tests (vor Dexie). Grund: ES-Importreihenfolge – Dexie liest `indexedDB` beim Laden des Moduls.

### ADR-21: Vertikaler Rand bei 1D-Codes = 4 Module
Entscheidung: Oben und unten wird bei Strichcodes ein weißer Rand von 4 Modulen gelassen. Grund: Die Spezifikation legt nur die horizontalen Ruhezonen fest; der Rand verhindert, dass Rahmen oder Bildschirmkante die Balken berühren.

### ADR-22: Drehung nur bei Bedarf (Schwelle 3 Gerätepixel pro Modul)
Entscheidung: Breite 1D-Codes werden nur gedreht, wenn sie ungedreht kleiner als 3 Gerätepixel/Modul wären und die Drehung das Modulmaß vergrößert. Grund: AGENTS.md verlangt automatische Drehung bei breiten Codes; ein größeres Modulmaß ist nur dann nötig, wenn ungedreht kaum lesbar. Der Schwellenwert ist ein Startwert und per `minModulePx` einstellbar (an echter Hardware zu kalibrieren).

### ADR-23: Eigenes SVG statt `bwipjs.toSVG`
Entscheidung: Nur `bwipjs.raw()` nutzen, SVG selbst erzeugen. Grund: Volle Kontrolle über ganzzahlige Koordinaten, Farben und Ruhezonen; testbar gegen unabhängige Referenz-Encoder.

### ADR-24: Kein Klartext unter dem Symbol
Entscheidung: Keine lesbaren Ziffern im Symbolbereich. Grund: Spezifikation 18 („Keine Bedienelemente über dem Symbol“); Scanner brauchen sie nicht, zusätzliche Elemente verkleinern nur die nutzbare Fläche.
