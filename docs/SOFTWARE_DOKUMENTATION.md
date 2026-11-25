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
| `src/domain/` | Prüfziffern, Sequenzen, Zustandsautomat, Interleaving, Fehler, Typen, Ablaufdatum (`expiry.ts`), Zusatzangaben (`item-meta.ts`), Austauschformat (`share-format.ts`), Gemeinsame Bibliothek (`library.ts`) | DOM, `window`, Kamera, IndexedDB, Browser-/Node-APIs |
| `src/application/` | Use-Cases (Capture, Collections, Playback, Backup, Import, Validation) | direkt DOM anfassen |
| `src/adapters/` | Kamera, Decoder, Renderer, Dexie, Sensoren, Teilen (`share/`: Web Share, Zwischenablage, Link-Codec) | Fachentscheidungen treffen |
| `src/ui/` | Mobile-first Screens/Komponenten | Fachlogik enthalten |
| `src/offline/` | Service Worker, Update-Policy, Installationsaufforderung | – |

Abhängigkeiten zeigen nur nach innen (`domain` kennt niemanden).

## 2. Datenmodell und Persistenz (`src/domain/types.ts`, `src/adapters/persistence/db.ts`)
Siehe Spezifikation Kap. 16. Barcodes immer als `string`; `syntaxStatus`, `checksumStatus` und `catalogStatus` sind getrennte Aussagen (kein gemeinsamer „grüner Haken“).

**Zusatzangaben je Code (ab 0.2.0):** `BarcodeItem` hat die optionalen Felder `label` (Wort), `purpose` (Nutzen), `note` (Satz), `tags` (Liste) und `expiresAt` (Kalendertag `JJJJ-MM-TT`). Sie sind **additiv und nicht indiziert**; das Dexie-Schema bleibt deshalb **Version 1** (kein Migrationsschritt), ältere Datenbanken und Backups bleiben gültig. Fehlende Angaben sind nicht als leere Felder gespeichert, sondern fehlen ganz (`normalizeItemMeta` liefert nur gesetzte Felder). Grenzen: Wort/Nutzen 100, Satz 500 Zeichen, höchstens 10 Tags à 30 Zeichen (`META_LIMITS`).

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
- `CollectionService` (ab 0.2.0 zusätzlich): `updateItemMeta` (ersetzt alle Zusatzangaben eines Eintrags, nicht angegebene entfallen), `setExpiry` (Ablaufdatum für mehrere Einträge atomar setzen/löschen), `uniqueCollectionName` (`Name`, `Name (2)` …), `importShare` (geteilte Sammlung als **neue** Sammlung anlegen; scheitert das Speichern der Codes, wird die neue Sammlung wieder entfernt). Beim Zusammenfassen gleicher Codes (`merge`) bleiben vorhandene Angaben erhalten, fehlende werden ergänzt (Tags werden vereinigt).
- `BackupService`: JSON-Voll-Export/-Import, CSV-Export/-Import einer Sammlung, Artikelstamm-CSV; ab 0.2.0 `exportCollectionShare` (Austauschformat, optional kompakt) und `exportCollectionText`.
- `ImportService` (ab 0.2.0): zweistufiger Import. `inspect(text, heute)` erkennt die Art am **Inhalt** (geteilte Sammlung, Voll-Backup, CSV, einfache Liste) und prüft vollständig, **ohne zu speichern**; `commitCollections` bzw. `commitRows` schreiben erst nach ausdrücklicher Bestätigung und immer **additiv** (neue Sammlungen bzw. zusätzliche Positionen). CSV/Listen: `abort` (Standard) oder `skip-invalid`; bei Abbruch entsteht keine leere neue Sammlung.
- `PlaybackController.prepare` überspringt abgelaufene Positionen (`includeExpired: true` spielt alles ab; die Kalibrierung ignoriert das Datum) und meldet `skippedExpired`; sind alle abgelaufen, endet `prepare` mit `ERR_PLAYBACK_FAILED` und klarer Meldung.
- `SessionService`: Sitzungskopf und Ereignisse (idempotent über Ereignis-ID).

## 2b. Backup-Format (`src/domain/backup-schema.ts`)
`{ format: "barq-player-backup", schemaVersion, exportedAt, appVersion, data: { collections, items, templates, profiles, catalog, sessions, events } }`. `validateBackup` prüft die komplette Datei **vor** dem ersten Schreibzugriff: Struktur, Typen, Aufzählungen, `quantity`/`position` als ganze Zahlen, `value` als String (nie Zahl), eindeutige IDs, Verweise Eintrag→Sammlung und Ereignis→Sitzung, eindeutige Positionen je Sammlung; unbekannte Zusatzfelder werden verworfen, Probleme mit Pfad (`data.items[3].quantity`) gemeldet (max. 50). Import = Replace-All in einer Transaktion; ein Fehler mittendrin rollt alles zurück.

## 2b-1. Austauschformat einer Sammlung (`src/domain/share-format.ts`)
`{ format: "barq-player-collection", schemaVersion: 1, exportedAt, appVersion, collection: { name }, items: [{ symbology, value, quantity, label?, purpose?, note?, tags?, expiresAt? }] }`. Keine IDs, Sitzungen, Profile oder Artikelstammdaten. `validateShareFile` prüft **jeden** Code strikt (Format bekannt, `value` ist ein String, Syntax und Prüfziffer über `validateCodeValue`, Menge 1–9999, Zusatzangaben über `normalizeItemMeta`) und verwirft beim ersten Fehler die ganze Datei mit „Code N: …“. Höchstens 5000 Codes. `detectImportKind` unterscheidet `collection`, `backup`, `json-other` und `text` allein am Inhalt; `shareFilesFromBackupText` zerlegt ein Voll-Backup (über `validateBackup`) in je eine Austauschdatei pro Sammlung.

**Link-Codec** (`src/adapters/share/link-codec.ts`): kompaktes JSON → gzip (`CompressionStream`, falls vorhanden, sonst unkomprimiert mit Präfix `r.`) → Base64URL, Präfix `g.`; Link = `<App-Adresse>#/collections?import=<Nutzlast>`. Der Hash-Teil einer URL verlässt den Browser nicht (kein Server). Grenzen: Nutzlast ≤ 6000 Zeichen (darüber wird zur Datei geraten), entpackt ≤ 2 MiB (Schutz vor Dekompressionsbomben); beschädigte oder abgeschnittene Links ergeben `ERR_IMPORT_SCHEMA_INVALID` mit verständlicher Meldung. Beim Öffnen wird der Hash sofort per `history.replaceState` bereinigt, damit ein Neuladen den Dialog nicht erneut öffnet.

**Teilen-Adapter** (`share-adapter.ts`): `shareFile`/`shareJsonFile`/`shareText`/`copyText` kapseln `navigator.share`/`canShare`/`clipboard`. Ein abgebrochener Dialog (`AbortError`) ist kein Fehler; fehlende Unterstützung liefert `unsupported`, worauf die Oberfläche auf Download bzw. Kopieren ausweicht und das ehrlich meldet.

## 2b-3. Gemeinsame Bibliothek (`src/domain/library.ts`, `src/application/library-service.ts`, `scripts/library-index.mjs`)
- **Dateien:** `public/library/<name>.json` im Austauschformat (2b-1) plus `public/library/index.json` = `{ format: "barq-player-library", schemaVersion: 1, files: [...] }`. Der Index wird von `scripts/library-index.mjs` aus dem Ordner erzeugt (`npm run library`, automatisch bei `npm run build` und `npm run dev`; unzulässige Dateinamen brechen mit Fehler ab). Der Test `tests/build/library.test.ts` ist das **Gate vor der Veröffentlichung**: Index muss zu den Dateien passen, jede Datei muss `validateShareFile` bestehen (jeder Code streng geprüft).
- **`LibraryService.check(heute)`** lädt Index und Dateien (`fetch` mit `cache: 'no-store'`, injizierbar), prüft jede Datei einzeln und liefert `entries` (inkl. Anzahl, abgelaufene Codes, Status, lokale Sammlung) und `problems`. Index fehlt (404) → leere Bibliothek; Netzwerk-/Serverfehler → `ERR_LIBRARY_UNAVAILABLE`; ungültiger Index → `ERR_IMPORT_SCHEMA_INVALID`. **`apply(entry)`** legt eine neue Sammlung an (`importShare` mit Verknüpfung) oder ersetzt den Inhalt der verknüpften (`replaceFromShare`, atomar in einer Transaktion).
- **Datenmodell:** `Collection.library?: { file, hash, importedAt }` (additiv, Dexie-Schema bleibt 1; im Backup erhalten und dort geprüft, nicht im Austauschformat).
- **Oberfläche:** Karte „Gemeinsame Bibliothek“ in der Sammlungsliste (Status je Datei, Übernehmen/Aktualisieren/Alle übernehmen, Probleme, erneut prüfen), Kennzeichen „Bibliothek“ an Sammlungen, „In Bibliothek veröffentlichen“ (Datei + Anleitung + Warnung) und „Von Bibliothek lösen“ im Detail; beim App-Start eine stille Prüfung mit Hinweis (offline bleibt still).

## 2b-2. Ablaufdatum (`src/domain/expiry.ts`)
Ablaufdatum = Kalendertag ohne Uhrzeit/Zeitzone. Gültig **bis einschließlich** dem Ablauftag, ab dem Folgetag `expired`; `soon` bei ≤ 7 Tagen (`EXPIRY_WARN_DAYS`). „Heute“ ist der Kalendertag der **Ortszeit** des Geräts und wird immer übergeben (deterministisch testbar; Schaltjahre und Monatsgrenzen über UTC-Tageszahlen). Ein ungültiges Datum zählt vorsichtshalber als abgelaufen. `parseDateInput` akzeptiert `JJJJ-MM-TT`, `TT.MM.JJJJ`, `T.M.JJJJ` und `TT/MM/JJJJ`, lehnt aber zweistellige Jahre ab (mehrdeutig).

## 2c. CSV (`src/domain/csv.ts`, `csv-items.ts`)
- RFC-4180-Parser (Anführungszeichen, Zeilenumbrüche in Feldern, BOM, CRLF/LF/CR), Trennzeichen `,` `;` Tab automatisch erkannt, alle Zellen bleiben Strings. Offene Anführungszeichen u. Ä. → `ERR_IMPORT_CSV_INVALID` mit Zeilennummer.
- **Formelschutz:** Beim Export erhält jede Zelle, die mit `=`, `+`, `-`, `@`, Tab oder CR beginnt (auch nach führenden `'`), ein vorangestelltes `'`; beim Import wird genau dieses eine `'` wieder entfernt (verlustfreier Round-Trip, getestet).
- **Führende Nullen:** Werte werden nie in Zahlen umgewandelt. Hat ein Tabellenprogramm Nullen entfernt, meldet der Import einen Längenfehler samt Hinweis – es wird nicht „repariert“.
- Export-Spalten: `collection, position (ab 1), symbology, value, quantity, label, purpose, note, tags, expiresAt, source, syntaxStatus, checksumStatus, catalogStatus` (Tags mit `, ` verbunden). Beim Import werden zusätzlich die Spalten Nutzen/Satz/Tags/Ablaufdatum erkannt (deutsch/englisch, z. B. `Gültig bis`, `MHD`); ein ungültiges Datum oder zu lange Texte sind **zeilengenaue Fehler**. Import: Spaltenzuordnung per Kopfzeile (deutsch/englisch) oder manuell; Standardsymbologie für Dateien ohne Symbologie-Spalte; `abort` (Standard, nichts importieren) oder `skip-invalid`; Fehlerbericht pro Zeile.
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
| `ERR_CAMERA_PERMISSION_DENIED`, `ERR_CAMERA_NOT_FOUND`, `ERR_CAMERA_INSECURE_CONTEXT`, `ERR_CAMERA_UNSUPPORTED` | Kamera (Torch nicht unterstützt) | `camera-adapter` |
| `ERR_WASM_LOAD_FAILED`, `ERR_DECODE_FAILED` | Decoder (WASM fehlt/passt nicht; Bild unlesbar/zu groß) | `decoder-adapter` |
| `ERR_RENDER_FAILED` | Darstellung nicht möglich (z. B. QR zu lang für ECC) | `barcode-renderer` |
| `ERR_NOT_FOUND` | Sammlung/Eintrag existiert nicht (mehr) | Services |
| `ERR_OFFLINE_SETUP_FAILED` | Service Worker/Offline-Einrichtung oder Aktivierung einer neuen Version fehlgeschlagen | `update-policy`, `service-worker` |
| `ERR_STORAGE_WRITE_FAILED`, `ERR_STORAGE_QUOTA_EXCEEDED` | Persistenz | M3 |
| `ERR_IMPORT_SCHEMA_INVALID`, `ERR_IMPORT_CSV_INVALID` | Import | M3 |
| `ERR_LIBRARY_UNAVAILABLE` | Gemeinsame Bibliothek nicht erreichbar (offline, Server-Fehler) | M9 |
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

## 5a. Erfassung: Kamera, Decoder, Capture (`adapters/camera`, `adapters/decoder`, `adapters/feedback`, `application/capture-service.ts`)

**Kamera (`CameraAdapter`)** – Browser-Schnittstellen sind strukturell typisiert und injizierbar (Tests ohne Kamera).
- Constraints: `facingMode: { ideal: 'environment' }` (Rückkamera, auf Geräten ohne Rückkamera trotzdem eine Kamera), 1280×720 als Wunsch, kein Audio; eine feste `deviceId` überschreibt die Blickrichtung.
- Fehlerdiagnose: kein HTTPS/localhost → `ERR_CAMERA_INSECURE_CONTEXT`; `NotAllowedError`/`SecurityError` → `ERR_CAMERA_PERMISSION_DENIED`; `NotFoundError`/`OverconstrainedError` → `ERR_CAMERA_NOT_FOUND`; `NotReadableError`/`AbortError` → `ERR_CAMERA_NOT_FOUND` mit Hinweis auf eine andere App.
- `stop()` ruft `track.stop()` für ALLE Spuren (auch wenn eine wirft; Fehler wird danach gemeldet). `start()` beendet zuvor eine laufende Sitzung. `switchCamera()`: erst `stop`, dann nächste Kamera (mehrere Geräte: zyklisch; sonst Blickrichtung wechseln); bei Fehler wird die vorherige Kamera wiederhergestellt, der ursprüngliche Fehler gemeldet.
- Taschenlampe nur bei `capabilities.torch`; sonst `ERR_CAMERA_UNSUPPORTED`.

**Decoder (`HybridDecoder`)** – ein einheitlicher `BarcodeDetector`-Pfad:
1. Nativer Browser-`BarcodeDetector`, wenn vorhanden UND alle Whitelist-Formate unterstützt werden.
2. Sonst das `barcode-detector`-ponyfill auf Basis von zxing-wasm. **Offline-Regel:** `prepareZXingModule({ overrides: { locateFile } , fireImmediately: true })` mit `locateZxingFile`, das für `.wasm` immer `./wasm/zxing_reader.wasm` liefert (nie das CDN-Präfix). Ein fehlendes oder nicht passendes WASM führt sofort zu `ERR_WASM_LOAD_FAILED`. Ein Quelltext-Test (`offline-guard`) verbietet CDN-Hosts und absolute URLs in `src/`.
3. Laufzeit-Fallback: Wirft der native Detektor, wird dasselbe Bild einmal mit WASM wiederholt. Gelingt das, wird dauerhaft auf WASM gewechselt (`fallbackReason` zeigt den Grund); scheitert auch WASM, war das Bild unlesbar und die Engine bleibt unverändert.
- Whitelist: Standard EAN-13, EAN-8, QR, Code 128; UPC-A optional (`DEFAULT_WHITELIST`). Jede Erkennung läuft durch `interpretDetection`: Format aus dem Decoder, Whitelist, einzige Normalisierung (UPC-A mit 13 Ziffern und führender 0 → 12 Ziffern), Validierung wie beim Speichern. Ungültiges wird als `rejected` (ohne Inhalt) gemeldet, nie gespeichert. Ergebnisse sind oben→unten, links→rechts sortiert.
- Bildimport: `scanFiles` wertet Dateien nacheinander aus (Speicher schonen), mehrere Codes pro Bild einzeln; Status je Datei `ok` / `no-codes` / `error` (nicht lesbar oder > 25 MB).
- **UPC-A-Besonderheit:** Ein UPC-A-Strichcode ist zugleich ein gültiger EAN-13 mit führender 0. Mit der Standard-Whitelist (ohne UPC-A) wird er als EAN-13 `0036000291452` erfasst; nur mit reiner UPC-A-Whitelist entsteht UPC-A (`036000291452`). Der Renderer erzeugt für beide dieselben Balken.

**Capture-Service**
- Technisches Duplikat vs. fachliche Wiederholung (`DuplicateFilter`, monotone Zeit): Ein dauerhaft sichtbarer Code wird nur einmal erfasst; verschwindet er mindestens `absenceMs` (Standard 1200 ms) und erscheint erneut, zählt das als Wiederholung (Menge +1 bzw. im Modus „nur eindeutige Codes“ ignoriert). `minFrames` verlangt aufeinanderfolgende Bilder. Scheitert das Speichern, nimmt `release()` die Akzeptanz zurück (erneuter Versuch im nächsten Bild).
- Piepton/Vibration (`FeedbackAdapter`) erst NACH erfolgreichem IndexedDB-Write; Audio wird per `unlock()` aus einer Nutzeraktion entsperrt; Fehlersignal ist gedrosselt; Audio-/Vibrationsfehler werden gemeldet, nie verschluckt, und blockieren nie die Erfassung.
- Überlappende Bilder werden übersprungen (`skipped`), damit sich Auswertungen nicht stauen.
- QR-Inhalte sind Daten: `classifyQrContent` ordnet nur ein (URL/WLAN/Kontakt/Text, riskante Schemata wie `javascript:` werden gekennzeichnet); nichts wird geöffnet oder ausgeführt. Mehrzeilige QR-Texte (vCard, WLAN) sind als Einzelwerte erlaubt (`validateCodeValue(..., { multiline: true })`), Bulk-Zeilen bleiben einzeilig.
- Bildimport in zwei Schritten: `scanImages` erkennt (speichert nichts), `saveDetected` speichert die ausgewählten Codes atomar (Quelle `image`, Dateiname als Bezeichnung).

## 6. Offline-/WASM-Strategie
- `zxing-wasm` lädt `./wasm/zxing_reader.wasm` über `locateFile`; kein CDN zur Laufzeit.
- `npm run copy:wasm` kopiert die zur installierten Bibliotheksversion passende Datei aus `node_modules/zxing-wasm/dist/reader/` nach `public/wasm/` (Bibliothek und WASM müssen versionsgleich sein).
- `vite-plugin-pwa` (generateSW, `registerType: 'prompt'`) legt alle Assets inkl. `.wasm` in den Precache.

### Offline-Härtung (Meilenstein 7)
**Precache (F-14):** Aktueller Produktions-Build: 15 Einträge (≈ 2,1 MiB) – App-Shell, JS/CSS (inkl. dynamisch geladenem `ponyfill`-Chunk), Manifest, drei Icons und `wasm/zxing_reader.wasm`. Der Test `tests/build/production-build.test.ts` baut die App in ein temporäres Verzeichnis und prüft: warnungsfreier Build, WASM/Shell/Manifest/Icons im Precache, **jede** ausgelieferte Datei im Precache, keine absoluten/externen URLs, Navigation fällt auf `index.html` zurück, `skipWaiting` nur im `SKIP_WAITING`-Nachrichtenhandler, `clientsClaim` nicht gesetzt, ausgelieferte WASM-Datei **byte-identisch** mit der Datei der installierten `zxing-wasm`-Version, `barcode-detector` bringt keine zweite `zxing-wasm`-Version mit.

**Update-Policy (`src/offline/update-policy.ts`, `service-worker.ts`, `ui/components/update-banner.ts`, Q-06):** Der Service Worker läuft mit `registerType: 'prompt'`: Eine neue Version **wartet**; sie wird nie automatisch aktiviert. `UpdatePolicy.apply()` gibt die Aktivierung (und damit den Seiten-Reload) nur frei, wenn eine Bedienperson sie ausdrücklich auslöst **und** keine Fader-Sitzung läuft oder pausiert ist (`PlaybackController.isLive`); die Bedingung wird beim Klick erneut geprüft. Der Hinweis in der Kopfzeile ist während einer Sitzung gesperrt und erklärt warum; nach Sitzungsende wird er automatisch frei (1-s-Neuprüfung). „Die App ist jetzt offline nutzbar“ wird erst gemeldet, wenn der Service Worker den Precache bestätigt (`onOfflineReady`). Registrierungs-/Aktivierungsfehler → `ERR_OFFLINE_SETUP_FAILED`. Die Registrierung (`virtual:pwa-register`) wird nur im Produktionsbuild und dynamisch aus `main.ts` geladen, damit Tests nie das virtuelle Modul brauchen.

**PWA-Installierbarkeit (Q-07):** `manifest.webmanifest` mit `id`, `start_url`/`scope` `./`, `display: standalone`, `lang: de`, Theme-/Hintergrundfarbe; Icons `icon-192.svg`, `icon-512.svg` (any) und `icon-maskable.svg` (Motiv in der inneren 80 %-Sicherheitszone) unter `public/icons/`; `index.html` mit `color-scheme: light`, Icon- und Apple-Touch-Verweisen. Alle Pfade relativ (`base: './'`), damit Unterpfad-Hosting (z. B. GitHub Pages) funktioniert.

### Lift-to-Pause (`src/domain/lift-detection.ts`, `src/adapters/sensors/lift-detector.ts`, S-06)
Optional und **standardmäßig aus** (Einstellungen → „Lift-to-Pause“, nur sichtbar aktivierbar, wenn der Browser `devicemotion` anbietet; iOS-Berechtigung wird beim Einschalten angefragt). Die reine `LiftAnalyzer`-Logik misst 800 ms eine Ruhelage (mittlerer Schwerkraftvektor) und löst danach aus bei Kippwinkel ≥ 25° (`tilt`) oder Betragsabweichung ≥ 3 m/s² (`shake`), jeweils über mindestens 3 aufeinanderfolgende Messwerte; Schwerelosigkeit/Ausfall zählt als starke Veränderung. Der Adapter schaltet nur **scharf**, solange das Telefon bereit liegt (Zustände SHOWING, BLANKING, WAITING_CONFIRMATION – nie im Countdown), überwacht den Sensor (**2 s ohne Messwerte = `sensor-lost`**, konservativ pausieren) und löst genau einmal aus. **Der Sensor kann ausschließlich pausieren:** Sein einziger Ausgang ist `onTrigger`, der in der App `pauseActive('sensor', …)` ruft; es gibt keinen Pfad zu `resume`/`confirm`/`pos-accepted` (per Quelltext-Test abgesichert). Nach einer Auslösung wird erst nach bewusster Wiederaufnahme (Countdown) erneut scharf geschaltet.

## 7. Testkonzept
Vitest. Quality Gate vor jedem Commit: `npm test` und `npm run build` (0 TypeScript-Fehler, 0 Warnungen). Jede Logik in `src/domain/` braucht Unit-Tests.

| Ordner | Inhalt | Umgebung |
|---|---|---|
| `tests/unit/` | Fachlogik (Domain), Adapter mit Attrappen (Kamera, Decoder, Feedback, Wake Lock, Sensor), Renderer inkl. Rückleseprüfung mit lokalem zxing-wasm, Router, Lebenszyklus, Einstellungen, Qualitätsregeln | node |
| `tests/integration/` | Dexie-Persistenz, Services, Backup/Restore (Rollback), Capture mit Datenbank, Decoder mit echtem Ponyfill und lokalem WASM | node + `fake-indexeddb` |
| `tests/ui/` | Screens, Komponenten, Bootstrap, Sicherheitsinvarianten des Faders (Symbol nur in SHOWING, Blank bei Pause/Fehler/Hintergrund, Navigation gesperrt, globale Fehler), Update-Banner, Lift-to-Pause | jsdom (`// @vitest-environment jsdom`) |
| `tests/build/` | Produktions-Build, Precache, Manifest, Icons, WASM-Version | node (Vite programmatisch) |
| `tests/helpers/` | `ManualScheduler`, Decode-Helfer (Rasterung → zxing-wasm) | – |

**Qualitätsregeln als Tests (`tests/unit/quality.test.ts`):** TSDoc direkt an jedem Export, Dateiköpfe, kein `any`, keine Compiler-Unterdrückung, `strict`/`noUnused*` aktiv, keine leeren `catch`-Blöcke, `src/domain/` ohne Browser-/Timer-APIs und nur Domain-Importe, Schichtengrenzen (adapters ↛ application/ui/app, application ↛ ui/app), Sensor-Code ohne `resume`/`confirm`, Fachregeln (String-Werte, kein `pos-*` aus der Maschine, `#000000`/`#FFFFFF`/`crispEdges`, keine Fader-Animationen) sowie Vollständigkeit der Dokumente (README-Links, F-01…F-15, Ledger-Format, Kapitel, Fehlercodes ↔ Dokumentation).

Hinweis Windows: Vitest aus Git Bash gestartet scheitert wegen Pfad-Schreibweise (`c:` vs. `C:`, doppelte Modulinstanzen, „failed to find the current suite“). Tests aus PowerShell/cmd starten.

## 7a. Oberfläche und App-Schicht (Meilenstein 6)

**Aufbau:** `main.ts` → `app/bootstrap.ts` (Shell, Router, Lebenszyklus) → `app/container.ts` (Composition Root, `AppContext`) → Screens in `ui/screens/` (`scanner`, `collections`, `generator`, `player`, `settings`) mit Komponenten in `ui/components/` (`dom`, `notifier`, `dialog`, `badges`). Jeder Screen ist eine Funktion `mountX(root, ctx, route) → dispose`; der Router ruft `dispose` beim Verlassen (Kamera stoppen, Timer löschen, Fader pausieren).

**DOM-Sicherheit:** Framework-freies `h()`; Texte sind IMMER Text-Knoten (nie `innerHTML`), SVG wird über den XML-Parser importiert (`svgElement`). Sammlungsnamen, QR-Inhalte, Dateinamen und Fehlertexte sind unvertrauenswürdig und können kein Markup einschleusen (Tests mit `<img onerror>`).

**Router (`app/routes.ts`):** Hash-Routen `#/scanner|collections|generator|player|settings` mit Parametern (`#/player?collection=ID`, `?calibration=1`). Ein Guard verhindert das Verlassen des Fader-Screens bei laufender Sitzung: sofort pausieren, Hash zurücksetzen, Hinweis „zuerst abbrechen oder beenden“.

**Lebenszyklus (`app/lifecycle.ts`):**
| Ereignis | Reaktion (Reihenfolge ist sicherheitsrelevant) |
|---|---|
| `error`, `unhandledrejection` | 1. laufende Sitzung → `ERROR` (Symbol sofort aus), 2. Log + Fehlerbanner. ResizeObserver-Rauschen wird ignoriert. |
| `visibilitychange` hidden, `pagehide`, `freeze` | Sitzung pausiert sofort (`pause('background')`), Scanner-Kamera stoppt |
| `visibilitychange` visible | Wake Lock erneut anfordern |

**Meldungen (`Notifier`):** Fehler laufen immer durch den `ErrorLogger` und erscheinen als `role="alert"` mit deutscher Meldung, Handlungsempfehlung und Code (bleiben bis zum Schließen; gleiche Fehler werden nicht gestapelt). Infos/Erfolge sind `role="status"` und verschwinden nach 4 s. **„Gespeichert“ wird nur nach erfolgreichem Rückgabewert des Service-Aufrufs gemeldet.**

**Scanner-Screen:** Sammlung wählen/anlegen; Kamera (Start entsperrt Audio, Torch, Wechsel, Stopp bei Hintergrund/Verlassen); Scan-Schleife alle 250 ms, Auswertungen überlappen nie; Format-Whitelist und „nur eindeutige Codes“ (Einstellungen, Decoder wird bei Änderung neu aufgebaut); Foto-Import mit Auswahl der Codes je Bild; manuelle Eingabe/Bulk mit „Prüfen“ (zeilengenaue Fehler) und ausdrücklichem „Nur die N gültigen Zeilen speichern“.

**Sammlungen-Screen:** Liste, anlegen/umbenennen/löschen (Bestätigung), Detail als Tabelle mit Menge (+/−), Reihenfolge (↑/↓ statt Ziehen), Entfernen, **drei getrennte Status-Badges** (Syntax, Prüfziffer, Artikelstamm – Text statt nur Farbe, Tooltip mit Quelle/Datum), Artikelstamm-Abgleich, CSV-/JSON-Export.

**Generator-Screen:** Einzelcode mit Live-Vorschau (QR-ECC wählbar); Prüfziffer nur auf Klick berechnen; Zahlenreihe mit Schablone, Start/Ende **oder Anzahl**/Schritt/Obergrenze, Preset `2 063701 028{XX}{C}` (+12), Live-Vorschau (Anzahl, erste/letzte Codes, Symbol des ersten), feldgenaue Fehler und Warnungen (`data-field`, `data-code`, Überlauf = `role="alert"`), Speichern als Vorlage, neue Sammlung oder in bestehende Sammlung.

**Player-Screen** (Sicherheitsregeln): Bühne (`#stage`, weiß, `barcode-stage`) und Steuerleiste sind getrennte Bereiche – nie Bedienelemente über dem Symbol; Viewport für den Renderer = Fenster − 176 px Leiste. Der Zustands-Listener leert die Bühne **zuerst** und zeichnet das Symbol nur im Zustand `SHOWING`; ein Renderfehler wirft und führt zu `ERROR` mit leerer Bühne. Keine Animationen/Transitions im Fader (CSS `transition/animation: none !important`). Countdown erscheint in der Leiste (nicht auf der Bühne). Zustände: Countdown, Anzeige, Wechsel, Warten auf Bestätigung („Geprüft – weiter“), Pause/Fehler mit **Panel für den unklaren Übergabebereich** (zuletzt bestätigt, zuletzt angezeigt, Bereich, Doppelbuchungswarnung) und Entscheidungen *abgeglichen / wiederholen / überspringen / ab Position / abbrechen* (wiederholen, überspringen, abbrechen mit Bestätigungsdialog), Zusammenfassung ohne Buchungsbehauptung. Externe Tasten (Bluetooth-Taster): Leertaste/Escape = Pause, Enter = Bestätigen (nicht in Eingabefeldern). Wake Lock wird mit Sitzungsstart angefordert und bei Rückkehr erneut.

**Einstellungen-Screen:** Profile (anlegen/bearbeiten/löschen, Leerzeit ≥ 20 ms), Kalibrierung, Artikelstamm-CSV (Abbruch oder „Fehlerhafte überspringen“, Fehlerbericht), Persistenzstatus/Belegung, JSON-Backup und **bestätigter, vorvalidierter Restore**, Rückmeldung (Ton/Vibration), Diagnose (Decoder-Engine samt Fallback-Grund, Fehlerprotokoll ohne Barcode-Inhalte, leeren).

### Kassen-Kalibrierung (`domain/calibration.ts`, `domain/playback-entries.ts`)
Ablauf: 20 Testpositionen (`buildCalibrationEntries`: Sammlung inkl. Mengen, zyklisch aufgefüllt, ohne Interleaving, Modus Automatik) → Bedienperson trägt ein: von der Kasse angenommen, zusätzliche Buchungen, Fehlerdialoge → `evaluateCalibration`:

| Ergebnis | Vorschlag |
|---|---|
| fehlerfrei (20/20, 0 zusätzlich) | Betriebsprofil mit **25 % Reserve** (Anzeige/Leerzeiten ×1,25, auf 10 ms gerundet) |
| Positionen fehlen | langsamer: alle Zeiten ×1,5 |
| zusätzliche Buchungen | Anzeige ×0,75, Leerzeiten unverändert |
| beides oder Fehlerdialoge | **kein Vorschlag**, Test wiederholen (Fehlerdialoge deuten auf unbekannte Artikel, nicht auf Timing) |

Werte werden geklammert (Anzeige 100–5000 ms, Leerzeit 50–3000 ms, identisch 50–5000 ms). Die Empfehlung ist ein **Teststartpunkt, keine Garantie** (steht in jeder Erläuterung).

### Wiedergabe-Controller (`application/playback-service.ts`)
`prepare` (Sammlung laden, Liste bauen, optional interleaven, **Profil prüfen**, **jedes einzigartige Symbol vorab rendern** – nicht darstellbare oder nicht passende Codes verhindern den Start mit Positionsangabe) → `begin` (Sitzungskopf zuerst speichern; scheitert das, startet nichts; Maschine anlegen, Ereignisse und Status fortlaufend sequenziell in IndexedDB schreiben, Wake Lock) → `pauseActive/failActive/abortActive`. Protokoll-Schreibfehler werden gemeldet, blockieren aber nie das Ausblenden.

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

### ADR-25: Ein Detektor-Pfad über das barcode-detector-ponyfill
Entscheidung: Nativ und WASM teilen sich die `BarcodeDetector`-Schnittstelle; WASM kommt über das ponyfill (gleiches zxing-wasm 3.1.8 wie die lokale Datei). Grund: ein Auswertecode für beide Engines; Bibliotheks- und WASM-Version sind per Lockfile gekoppelt (Spezifikation 19.3).

### ADR-26: Rückkamera per `ideal`, nicht `exact`
Entscheidung: `facingMode: { ideal: 'environment' }`. Grund: `exact` scheitert auf Geräten ohne Rückkamera (Laptops, Tests); `ideal` liefert dort trotzdem ein Bild.

### ADR-27: Fallback erst nach Wiederholung mit WASM
Entscheidung: Ein Fehler des nativen Detektors führt nicht sofort zum dauerhaften Engine-Wechsel, sondern zu einer Wiederholung mit WASM. Grund: Beschädigte Bilder lassen den nativen Detektor ebenfalls werfen; sie sollen die Engine nicht herabstufen.

### ADR-28: UPC-A als EAN-13 erfassen, solange UPC-A nicht freigegeben ist
Entscheidung: Keine heimliche Umdeutung. Mit Standard-Whitelist wird ein UPC-A-Strichcode als EAN-13 (13 Ziffern, führende 0) gespeichert, mit reiner UPC-A-Whitelist als UPC-A. Grund: Spezifikation 4.2 („Format aus Decodergebnis übernehmen“); beide Symbole sind bitgleich.

### ADR-29: Mehrzeilige QR-Texte nur als Einzelwerte
Entscheidung: `validateCodeValue` erlaubt LF/CRLF bei QR nur mit `multiline: true` (Erfassung, Speichern, CSV-Zellen, Rendern); der Bulk-Parser bleibt „eine Zeile = ein Code“. Grund: vCard/WLAN-QR enthalten Zeilenumbrüche; Bulk-Listen können sie nicht abbilden.

### ADR-30: `base: './'` im Build
Entscheidung: Relative Asset-Pfade. Grund: Betrieb unter Unterpfaden (z. B. GitHub Pages) und lokaler WASM-Pfad `./wasm/zxing_reader.wasm` bleiben gültig.

### ADR-31: Framework-freie UI
Entscheidung: Kleine `h()`-Helferfunktion statt Framework; Screens als `mount`-Funktionen mit `dispose`. Grund: Spezifikation 7.1 („kein großes UI-Framework nötig“), kleine Bundles, volle Kontrolle über den sicherheitskritischen Fader-DOM; Fachlogik bleibt ohnehin unabhängig.

### ADR-32: Navigation während einer Fader-Sitzung gesperrt
Entscheidung: Router-Guard pausiert und bleibt auf dem Fader; die Navigationsleiste ist während der Sitzung ausgeblendet. Grund: Verlassen der Ansicht darf nie ein sichtbares Symbol zurücklassen oder die Sitzung unbemerkt beenden; Abbruch ist eine ausdrückliche Entscheidung.

### ADR-33: Ein Bundle, Chunk-Warnschwelle 1500 kB
Entscheidung: `build.chunkSizeWarningLimit = 1500`. Grund: Offline-first, alle Dateien werden ohnehin vorab gecacht; Code-Splitting verringert die Offline-Gesamtgröße nicht (bwip-js ist groß). Der Build soll warnungsfrei bleiben.

### ADR-34: Bühne und Steuerleiste getrennt, Viewport = Fenster − 176 px
Entscheidung: Das Symbol wird für die Fläche oberhalb der Leiste skaliert; die Leiste überdeckt die Bühne nur in den Zuständen Pause/Fehler/Ende (dann ist die Bühne ohnehin leer). Grund: Spezifikation 18 („Keine Bedienelemente über dem Symbol“).

### ADR-35: Mindest-Leerzeit 20 ms
Entscheidung: Profile verlangen `blankMs`/`identicalBlankMs` ≥ 20 ms (mindestens ein Bild bei 60 Hz); die Maschine selbst bleibt rein und erlaubt 0. Grund: AGENTS.md Regel 6 („harter Wechsel mit leerem Blank-Frame“) ist bei 0 ms technisch nicht garantiert. `prepare` und `saveProfile` erzwingen die Grenze.

### ADR-36: Kalibrierung als transparente Heuristik
Entscheidung: Faktoren 1,25 / 1,5 / 0,75 und Klammerung (siehe Kalibrierungskapitel); Fehlerdialoge machen den Test ungültig. Grund: Spezifikation 15.3/15.4/23.5 – Reserve gegenüber der schnellsten gerade noch fehlerfreien Einstellung; ohne Rückkanal wird nur gemessen, was die Bedienperson eingibt.

### ADR-37: Erst ausblenden, dann melden
Entscheidung: Bei unbehandelten Fehlern ruft der Lebenszyklus `failActive` vor `report` auf; im Player wird die Bühne vor jedem Zeichnen geleert. Grund: Das Ausblenden ist sicherheitskritisch und darf nicht von Logging oder Banner-Darstellung abhängen.

### ADR-38: Bedieneinstellungen in `localStorage`, Sachdaten in IndexedDB
Entscheidung: `SettingsStore` (abgesichert, mit Standardwerten bei Fehlern) für Komfort-Einstellungen; alles Fachliche in Dexie/Backup. Grund: Einstellungen sind klein und synchron nötig; ihr Verlust ist unkritisch und im Backup nicht erforderlich.

### ADR-39: Service Worker mit `prompt` und expliziter Update-Policy
Entscheidung: Neue Versionen warten; Aktivierung nur auf Klick und nur ohne laufende/pausierte Fader-Sitzung. Grund: Spezifikation 19.4 („Neue Version nicht mitten in einer Sitzung aktivieren“); ein Reload beendet die Sitzung und lässt einen unklaren Übergabebereich zurück.

### ADR-40: SVG-Icons statt PNG
Entscheidung: Einfache SVG-Icons (192, 512, maskable) unter `public/icons/`. Grund: Vorgabe „einfache PWA-SVG-Icons“, keine Binärdateien im Repository, skalierbar; Chrome Android akzeptiert SVG-Manifest-Icons. Bei Bedarf können PNG-Varianten ergänzt werden.

### ADR-41: Lift-to-Pause konservativ, nur pausierend, Sensorverlust pausiert
Entscheidung: Standardmäßig aus; scharf nur bei Anzeige/Wechsel/Warten; Schwellen 25° / 3 m/s² / 3 Messwerte; 2 s ohne Messwerte pausieren; der Sensor hat keinen Zugriff auf Fortsetzen oder Bestätigen. Grund: Spezifikation 13.5 – ein Sensorsignal darf höchstens pausieren und beweist keine Buchung; ein unnötiger Halt ist lästig, eine falsche Freigabe kann den Stapel unbemerkt beschädigen. Die Schwellen sind Startwerte und an der echten Hardware zu prüfen.

### ADR-42: Qualitätsregeln und Produktions-Build als Tests
Entscheidung: TSDoc-, `any`-, Schichten- und Dokumentationsregeln sowie der Precache-Check laufen als Vitest-Tests. Grund: AGENTS.md-Regeln bleiben bei jedem Commit automatisch erzwungen, nicht nur dokumentiert; der Offline-Nachweis (WASM im Precache, byte-identisch zur Bibliotheksversion) ist reproduzierbar.

### ADR-43: Windows/Git-Bash-Hinweis für Skripte
Entscheidung: Tests und Builds unter Windows aus PowerShell/cmd starten (nicht aus Git Bash). Grund: Pfad-Schreibweise `c:` vs. `C:` führt zu doppelten Modulinstanzen in Vitest (siehe Testkonzept).

### ADR-44: Zusatzangaben additiv, ohne Schema-Versionssprung
Entscheidung: Wort, Nutzen, Satz, Tags und Ablaufdatum sind optionale, nicht indizierte Felder von `BarcodeItem`; Dexie-Schema und Backup-`schemaVersion` bleiben 1. Grund: Bestehende Datenbanken und Backups bleiben ohne Migration gültig; ältere App-Versionen verwerfen unbekannte Felder beim Import (statt abzulehnen). Fehlende Angaben werden nicht als leere Strings gespeichert, damit „nicht gesetzt“ eindeutig bleibt.

### ADR-45: Ablaufdatum als Kalendertag, markiert nur, löscht nie
Entscheidung: Kalendertag in Ortszeit, gültig bis einschließlich Ablauftag; abgelaufene Codes werden sichtbar markiert (Text **und** Farbe, durchgestrichen) und vom Fader standardmäßig übersprungen – mit Hinweis und bewusstem Schalter „trotzdem abspielen“. Grund: Ein Code am Ablauftag soll noch nutzbar sein; Ablauf darf nie stillschweigend Daten ändern oder löschen; wer einen abgelaufenen Code bewusst braucht (z. B. Testfall), behält die Kontrolle. Die Kalibrierung ignoriert das Datum.

### ADR-46: Eigenes Austauschformat pro Sammlung, Import immer additiv
Entscheidung: Teilen nutzt `barq-player-collection` statt des Voll-Backups; Import legt immer neue Sammlungen bzw. zusätzliche Positionen an, Namenskonflikte werden mit „ (2)“ gelöst. Grund: Ein Voll-Backup enthielte Protokolle und Profile und würde beim Wiederherstellen alles ersetzen – für das Weitergeben an andere Personen ungeeignet und riskant. Ein einziger fehlerhafter Code verwirft die ganze Datei mit Positionsangabe (keine Teilimporte aus unvertrauenswürdigen Dateien).

### ADR-47: Teilen per Web Share (Datei), Link ohne Server und Download-Rückfall
Entscheidung: Dateiteilen versucht `.json`, dann `.txt` (Chrome auf Android erlaubt JSON-Dateien nicht in jeder Version), danach Download; zusätzlich Link (gzip + Base64URL im Hash) und Textliste. Grund: Offline-first und ohne Backend soll das Weitergeben trotzdem ohne Dateiverwaltung möglich sein; der Hash-Teil einer URL wird nie an Server gesendet. Die Oberfläche behauptet nie „gesendet“, wenn nur heruntergeladen oder kopiert wurde.

### ADR-48: Import erkennt Inhalt statt Dateiendung, zweistufig
Entscheidung: `inspect` (vollständige Prüfung, kein Schreiben) und `commit*` (nach ausdrücklicher Bestätigung). Grund: Geteilte Dateien landen unterwegs als `.txt` oder ohne Endung; der Benutzer soll vor dem Speichern sehen, was passiert (Anzahl, bereits abgelaufene Codes, Fehler mit Zeilennummer).

### ADR-49: Veröffentlichung per GitHub Pages, Tests als Gate
Entscheidung: Der Workflow `.github/workflows/pages.yml` führt `npm test` und `npm run build` aus und veröffentlicht `dist/` nur bei Erfolg. Grund: Kamera und PWA-Installation brauchen HTTPS; `base: './'` (ADR-30) lässt die App unter dem Unterpfad `/barq-player/` laufen. Fehlgeschlagene Tests verhindern ein fehlerhaftes Update auf den Geräten.

### ADR-50: Installationsknopf und Backup-Erinnerung lokal
Entscheidung: `beforeinstallprompt` wird abgefangen und als Knopf in den Einstellungen angeboten; `lastBackupAt` liegt in den Bedieneinstellungen (`localStorage`) und löst nach 14 Tagen eine Erinnerung in der Sammlungsliste aus. Grund: Die Daten liegen nur auf dem Gerät (kein Cloud-Konto); im Alltag ist die regelmäßige Sicherung das größte Risiko, und eine Erinnerung ist ehrlicher als eine Automatik, die ohne Cloud nicht existieren kann.

### ADR-51: Gemeinsame Bibliothek als Dateien im Repository, App schreibt nie nach GitHub
Entscheidung: Sammlungen werden als `public/library/*.json` (Austauschformat aus ADR-46) zusammen mit der App veröffentlicht; die App liest sie von der **eigenen Herkunft** (`./library/…`) und erzeugt zum Veröffentlichen nur die Datei. Das Hochladen nach GitHub geschieht außerhalb der App. Grund: AGENTS.md Regel 1 verbietet externe APIs zur Laufzeit – ein direkter Schreibzugriff auf die GitHub-API würde einen Zugriffstoken im Browser (localStorage) erfordern und wäre ein Sicherheitsrisiko sowie eine Offline-Abhängigkeit. Mit Dateien bleibt die App offline-first, jede Version ist in Git nachvollziehbar (Verlauf, Rückgängig), und die vorhandene CI prüft jede Datei vor der Veröffentlichung. Folge: Die Bibliothek ist öffentlich lesbar (GitHub Pages) – die Oberfläche warnt davor.

### ADR-52: Bibliotheksdateien netzwerkbevorzugt statt vorab gecacht
Entscheidung: `library/**` ist vom Precache ausgeschlossen (`globIgnores`); ein Workbox-Laufzeitcache `barq-library` mit `NetworkFirst` (Timeout 4 s) liefert online immer den aktuellen Stand und offline den zuletzt gesehenen. Grund: Mit Precache würden Daten-Updates erst mit einer neuen App-Version (und deren Freigabe nach Update-Policy, ADR-39) ankommen; die Daten sollen unabhängig vom Programmcode aktualisierbar sein. Der Test `production-build.test.ts` sichert beides ab (nicht im Precache, Laufzeitregel vorhanden).

### ADR-53: Aktualisierung über Fingerabdruck, nie automatisch überschreibend
Entscheidung: Jede übernommene Sammlung speichert `library = { file, hash, importedAt }` (Fingerabdruck des übernommenen Inhalts, `contentHash`). Der Status ergibt sich aus Vergleich von veröffentlichtem Hash, gespeichertem Hash und aktuellem lokalen Inhalt (`new`, `current`, `update`, `update-modified`, `modified`). Prüfen schreibt nie; Aktualisieren ersetzt den Inhalt atomar (ID und lokaler Name bleiben), und bei `update-modified` erst nach ausdrücklicher Bestätigung. Der Name zählt nicht als Änderung, Menge, Reihenfolge und alle Zusatzangaben schon. „Von Bibliothek lösen“ entfernt die Verknüpfung. Grund: Lokale Arbeit darf nie unbemerkt verloren gehen; ein nicht kryptografischer 53-Bit-Fingerabdruck genügt zur Änderungserkennung (kein Sicherheitsmerkmal). Dateinamen im Index sind streng auf `[Buchstaben Ziffern _ - .]` + `.json` begrenzt (kein Pfadzugriff), eine fehlerhafte Datei blockiert die übrigen nicht.
