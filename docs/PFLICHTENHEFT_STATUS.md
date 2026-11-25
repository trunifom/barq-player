# Pflichtenheft & Aufgabenheft – BarQPlayer

Quelle der Anforderungen: [`Barcode_Lager_App_Dokumentation.md`](Barcode_Lager_App_Dokumentation.md) (Kap. 9, 16, 17, 19, 20, 23) und [`../AGENTS.md`](../AGENTS.md).
Status-Werte: **Offen** / **In Arbeit** / **Umgesetzt**. Commit-Nummern laufen fortlaufend (`#001`, …); Hashes sind echte Kurz-Hashes (`git log`), Ledger-Commits werden nicht gezählt.

## 1. Fortschrittstabelle

| Aufgaben-ID | Modul/Funktion | Status | Datum | Uhrzeit | Commit-Nr. & Hash | Dateien | Tests |
|---|---|---|---|---|---|---|---|
| M0-01 | Git-Setup, Branch `main`, Remote `origin` (kein Push) | Umgesetzt | 2026-11-24 | 21:01:58 | #001 `ee07e2c` | – | – |
| M0-02 | Dependencies (bwip-js, dexie, zxing-wasm, barcode-detector, vite, vite-plugin-pwa, vitest, jsdom, fake-indexeddb) | Umgesetzt | 2026-11-24 | 21:01:58 | #001 `ee07e2c` | `package.json`, `package-lock.json` | Smoke |
| M0-03 | Lokales WASM `public/wasm/zxing_reader.wasm` (`npm run copy:wasm`) | Umgesetzt | 2026-11-24 | 21:01:58 | #001 `ee07e2c` | `public/wasm/zxing_reader.wasm` | Smoke |
| M0-04 | Vitest-Konfiguration, TS-Typen | Umgesetzt | 2026-11-24 | 21:01:58 | #001 `ee07e2c` | `vitest.config.ts`, `tsconfig.json`, `src/vite-env.d.ts` | Smoke |
| M0-05 | Dokumentations-Grundstruktur (4 Säulen) | Umgesetzt | 2026-11-24 | 21:01:58 | #001 `ee07e2c` | `docs/*.md`, `README.md` | – |
| F-01a | Format-Typen EAN-13/EAN-8/QR/Code 128/UPC-A als `string` | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/types.ts` | types (kompiliert) |
| F-01b | Capture: Kamera-Decode EAN-13/EAN-8/Text-QR | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | `adapters/camera`, `adapters/decoder`, `application/capture-service.ts` | `camera-adapter.test.ts`, `decoder-adapter.test.ts`, `decoder-real.test.ts`, `capture-service.test.ts`, `duplicate-filter.test.ts`, `detection.test.ts` (UI in M6); UI: `scanner.test.ts` |
| F-02 | Bildimport (File/Blob, Multi-Code) | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | `adapters/decoder` | `decoder-adapter.test.ts`, `decoder-real.test.ts`, `capture-service.test.ts` (Foto-Import-UI in M6); UI: `scanner.test.ts` |
| F-03a | Manuelle Eingabe + Bulk-Parser (zeilenweise Fehler) | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/bulk-parser.ts` | `bulk-parser.test.ts` (24) |
| F-03b | Eingabe-UI | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | `src/ui/screens/` | `scanner.test.ts`, `validate-code-value.test.ts` |
| F-04 | Sammlungen anlegen/benennen/bearbeiten | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/collection-service.ts` | `collection-service.test.ts` |
| F-05 | Reihenfolge & Mengen persistent | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `adapters/persistence/db.ts` | `collection-service.test.ts`, `persistence.test.ts` |
| F-06 | Einzelsymbol-Generator (bwip-js SVG) | Umgesetzt | 2026-11-24 | 21:51:17 | #005 `fb59b88` | `adapters/renderer/barcode-renderer.ts` | `barcode-renderer.test.ts` (inkl. Decode-Roundtrip), `barcode-renderer-dom.test.ts` |
| F-07 | Manueller Player | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | `domain/playback-machine.ts`, UI | `playback-machine.test.ts` (Domain; UI in M6); UI: `player.test.ts`, `bootstrap.test.ts`, `playback-controller.test.ts` |
| F-08 | Zeitgesteuerter Player (Anzeige-/Leerzeit) | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| F-09 | Startverzögerung, Pause, sofortiges Ausblenden | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| F-10 | Unklarer Übergabebereich dokumentieren | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| F-11a | GS1-Modulo-10 (EAN-13/EAN-8/UPC-A) | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/checksum.ts` | `checksum.test.ts` |
| F-11b | Prüfziffer bei Generation berechnen | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/sequence.ts` | `sequence.test.ts` |
| F-12 | Präfix-/Feldvorlagen (Start, Ende, Schritt, Überlauf-Stopp) | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/sequence.ts` | `sequence.test.ts` |
| F-13 | JSON-Sicherung & geprüftes Restore | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/backup-service.ts` | `backup-schema.test.ts`, `backup-service.test.ts` |
| F-14 | Offline-Start (SW, Precache inkl. WASM) | Umgesetzt | 2026-11-24 | 22:54:53 | #008 `51bcd32` | `vite.config.ts`, `src/offline/` | `production-build.test.ts` (Precache inkl. WASM), `offline-update.test.ts` |
| F-15 | Anzeige nie als „gebucht“ ausgeben | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | `domain/playback-machine.ts`, UI | `playback-machine.test.ts` (Domain; UI in M6); UI: `player.test.ts` |
| S-01 | CSV-Import/-Export (führende Nullen, Formel-Injection-Schutz) | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/backup-service.ts` | `csv.test.ts`, `csv-items.test.ts`, `backup-service.test.ts` |
| S-02 | Artikelstamm-Abgleich (`catalogStatus/Source/CheckedAt`) | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/collection-service.ts` | `collection-service.test.ts`, `backup-service.test.ts` |
| S-03 | Scannerprofile + 20er-Kalibrierung | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | UI Einstellungen | `calibration.test.ts`, `player.test.ts`, `settings.test.ts` |
| S-04 | Kleinstapel-Modus | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| S-05 | Smart-Interleaver | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `src/domain/interleaver.ts` | `interleaver.test.ts` |
| S-06 | Lift-to-Pause-Sensor (nur pausieren) | Umgesetzt | 2026-11-24 | 22:54:53 | #008 `51bcd32` | `adapters/sensors/lift-detector.ts` | `lift-detection.test.ts`, `lift-detector.test.ts`, `lift-and-update.test.ts` |
| S-07 | Sitzungsbericht | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | UI | `player.test.ts` |
| Q-01 | `AppError`-Hierarchie, Fehlercodes, ErrorLogger | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/errors.ts` | `errors.test.ts` |
| Q-02 | Globale Fehlerabsicherung (`error`, `unhandledrejection`) → Blank | Umgesetzt | 2026-11-24 | 22:35:29 | #007 `3c79ea9` | `src/app/lifecycle.ts` | `lifecycle.test.ts`, `bootstrap.test.ts` |
| Q-03 | Rendering-Regeln (#000/#FFF, crispEdges, Ruhezonen, ganzzahlig, 90°-Drehung) | Umgesetzt | 2026-11-24 | 21:51:17 | #005 `fb59b88` | renderer | `render-layout.test.ts`, `barcode-renderer.test.ts` |
| Q-04 | `strict`, kein `any`, TSDoc an allen Exporten | Umgesetzt | 2026-11-24 | 22:54:53 | #008 `51bcd32` | alle | `quality.test.ts` (TSDoc an allen Exports, kein `any`) |
| Q-05 | `navigator.storage.persist()` + Speicheranzeige | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `persistence/db.ts` | `persistence.test.ts` |
| Q-06 | Update-Policy: kein Reload in aktiver Sitzung | Umgesetzt | 2026-11-24 | 22:54:53 | #008 `51bcd32` | `src/offline/` | `offline-update.test.ts`, `lift-and-update.test.ts`, `production-build.test.ts` |
| Q-07 | PWA-Icons + Manifest | Umgesetzt | 2026-11-24 | 22:54:53 | #008 `51bcd32` | `public/icons/` | `production-build.test.ts` (Manifest, Icons) |
| F-16 | Zusatzangaben je Code: Wort, Nutzen, Satz, Tags (optional, streng geprüft) | Umgesetzt | 2026-11-25 | 08:36:18 | #009 `ee17d5f` | `domain/item-meta.ts`, `application/collection-service.ts`, `ui/components/{meta-fields,item-editor}.ts`, `ui/screens/{collections,scanner}.ts` | `item-meta.test.ts`, `meta-share-import.test.ts`, `meta-share.test.ts` |
| F-17 | Ablaufdatum: Markierung „ABGELAUFEN“, Warnung 7 Tage, Fader überspringt abgelaufene Codes | Umgesetzt | 2026-11-25 | 08:36:18 | #009 `ee17d5f` | `domain/expiry.ts`, `application/playback-service.ts`, `ui/components/badges.ts`, `ui/screens/{collections,player}.ts` | `expiry.test.ts`, `meta-share-import.test.ts`, `meta-share.test.ts` |
| F-18 | Teilen von Sammlungen: Datei (Web Share/Download), Link ohne Server, Textliste, CSV | Umgesetzt | 2026-11-25 | 08:36:18 | #009 `ee17d5f` | `domain/share-format.ts`, `adapters/share/*`, `ui/components/share-actions.ts` | `share-format.test.ts`, `link-codec.test.ts`, `share-adapter.test.ts`, `meta-share.test.ts` |
| F-19 | Vollständiger Import: geteilte Sammlung, Backup, CSV, Liste, Link (zweistufig, additiv) | Umgesetzt | 2026-11-25 | 08:36:18 | #009 `ee17d5f` | `application/import-service.ts`, `ui/components/import-dialog.ts`, `domain/csv-items.ts` | `meta-share-import.test.ts`, `csv-items.test.ts`, `meta-share.test.ts` |
| F-20 | Suchen und Filtern (Text, Tag, nur abgelaufene), Ablaufdatum für viele Codes setzen | Umgesetzt | 2026-11-25 | 08:36:18 | #009 `ee17d5f` | `ui/screens/collections.ts`, `domain/item-meta.ts`, `application/collection-service.ts` | `item-meta.test.ts`, `meta-share-import.test.ts`, `meta-share.test.ts` |
| Q-08 | Alltagsbetrieb: GitHub-Pages-Deployment mit Tests als Gate, Installationsknopf, Backup-Erinnerung | Umgesetzt | 2026-11-25 | 08:36:18 | #009 `ee17d5f` | `.github/workflows/pages.yml`, `offline/install-prompt.ts`, `application/settings-store.ts`, `ui/screens/settings.ts` | `install-prompt.test.ts`, `meta-share.test.ts` |
| F-21 | Gemeinsame Bibliothek: Sammlungen mit Wort, Nutzen, Satz, Tags und Ablaufdatum mit der App veröffentlichen, auf jedem Gerät übernehmen und aktualisieren (ohne Neuerfassung) | Umgesetzt | 2026-11-25 | 08:55:38 | #010 `aa738b3` | `domain/library.ts`, `application/library-service.ts`, `application/collection-service.ts`, `ui/screens/collections.ts`, `app/bootstrap.ts` | `library.test.ts`, `library-service.test.ts`, `ui/library.test.ts` |
| F-22 | Lokale Änderungen an Bibliotheks-Sammlungen erkennen, nie automatisch überschreiben; „Von Bibliothek lösen“ | Umgesetzt | 2026-11-25 | 08:55:38 | #010 `aa738b3` | `domain/library.ts`, `application/collection-service.ts`, `ui/screens/collections.ts` | `library.test.ts`, `library-service.test.ts`, `ui/library.test.ts` |
| Q-09 | Bibliotheks-Gate vor Veröffentlichung (jede Datei streng geprüft), Index-Skript, netzwerkbevorzugter Laufzeitcache statt Precache | Umgesetzt | 2026-11-25 | 08:55:38 | #010 `aa738b3` | `scripts/library-index.mjs`, `vite.config.ts`, `public/library/` | `tests/build/library.test.ts`, `production-build.test.ts` |

## 2. Meilensteinplan

M0 Setup · M1 Errors/Typen/Checksum/Sequenz/Bulk · M2 Interleaver/Playback-Machine · M3 Persistenz/Backup · M4 Renderer · M5 Kamera/Decoder/Capture · M6 UI · M7 Offline-Härtung/Lift/Abnahme.

## 3. Umsetzungsprotokoll (Changelog)

### #001 – `ee07e2c` – 2026-11-24 21:01:58
`chore(init)`: Projekt-Setup, Dependencies, lokales WASM, Doku-Grundstruktur (M0-01 … M0-05).
Geänderte Dateien: gesamtes Projektgerüst, `package.json`/`package-lock.json`, `vitest.config.ts`, `tsconfig.json`, `src/vite-env.d.ts`, `public/wasm/zxing_reader.wasm`, `tests/unit/smoke.test.ts`, vier Doku-Dateien.
Tests: 1/1 grün, `npm run build` fehlerfrei (PWA-Precache 7 Einträge inkl. WASM).


### #002 – `054851a` – 2026-11-24 21:09:57
`feat(domain)`: Error-Framework, GS1-Prüfziffern, Sequenz-Engine, Bulk-Parser (F-01a, F-03a, F-11a, F-11b, F-12, Q-01).
Dateien: `src/domain/{errors,types,checksum,sequence,bulk-parser}.ts`, `tests/unit/{errors,checksum,sequence,bulk-parser}.test.ts`, Doku.
Tests: 98/98 grün (5 Dateien), `npm run build` fehlerfrei.

### #003 – `ed64ae2` – 2026-11-24 21:18:03
`feat(domain)`: Smart-Interleaver und Fader-Zustandsmaschine (F-08, F-09, F-10, S-04, S-05 umgesetzt; F-07 und F-15 Domain-Teil, UI folgt in M6).
Dateien: `src/domain/{interleaver,playback-machine}.ts`, `tests/unit/{interleaver,playback-machine}.test.ts`, Doku.
Tests: 172/172 grün (7 Dateien, +74), `npm run build` fehlerfrei.

### #004 – `0e03130` – 2026-11-24 21:44:10
`feat(persistence)`: Dexie-Schema v1, Sammlungs-/Session-/Backup-Service, Artikelstamm, JSON-Backup (atomar, vorvalidiert), CSV mit Formelschutz (F-04, F-05, F-13, S-01, S-02, Q-05).
Dateien: `src/adapters/persistence/db.ts`, `src/application/{collection,backup,session}-service.ts`, `src/domain/{csv,csv-items,backup-schema,profiles}.ts`, `tests/unit/{csv,csv-items,backup-schema}.test.ts`, `tests/integration/*`, `tests/setup.ts`, Doku, `.gitattributes`.
Tests: 326/326 grün (13 Dateien, +154), `npm run build` fehlerfrei.

### #005 – `fb59b88` – 2026-11-24 21:51:17
`feat(renderer)`: Barcode-/QR-Renderer mit ganzzahligen Modulen, Ruhezonen, 90°-Drehung und Lookahead-Cache (F-06, Q-03).
Dateien: `src/domain/render-layout.ts`, `src/adapters/renderer/barcode-renderer.ts`, `src/domain/errors.ts`, `tests/unit/{render-layout,barcode-renderer,barcode-renderer-dom}.test.ts`, `tests/helpers/decode.ts`, Doku.
Tests: 408/408 grün (16 Dateien, +82), `npm run build` fehlerfrei. Hinweis: zxing meldet UPC-A als `UPCA` mit 13-stelligem Text (für M5 vermerkt).

### #006 – `73935fa` – 2026-11-24 22:03:55
`feat(capture)`: Kamera-Adapter, Hybrid-Decoder mit lokalem zxing-wasm, Feedback-Adapter, Capture-Service, Bildimport (F-01b, F-02: Adapter/Service umgesetzt, UI folgt in M6).
Dateien: `src/adapters/{camera,decoder,feedback}/*`, `src/application/capture-service.ts`, `src/domain/{detection,duplicate-filter,qr-content}.ts`, `vite.config.ts` (`base: './'`), Tests (+126), Doku.
Tests: 534/534 grün (27 Dateien), `npm run build` fehlerfrei, WASM im Precache.

### #007 – `3c79ea9` – 2026-11-24 22:35:29
`feat(ui)`: Mobile-First-Oberfläche (Scanner, Sammlungen, Generator, Fader, Einstellungen), Router mit Guard, globale Fehler-/Hintergrund-Absicherung, 20er-Kalibrierung, Wiedergabe-Controller (F-01b, F-02, F-03b, F-07, F-15, S-03, S-07, Q-02 umgesetzt).
Dateien: `src/app/*`, `src/ui/{components,screens,styles}/*`, `src/application/{playback-service,settings-store}.ts`, `src/adapters/wakelock/wake-lock.ts`, `src/domain/{calibration,playback-entries}.ts`, `tests/ui/*`, Doku.
Tests: 761/761 grün (41 Dateien, +227), `npm run build` ohne Warnungen.

### #008 – `51bcd32` – 2026-11-24 22:54:53
`feat(offline)`: Offline-Härtung, Update-Policy, PWA-Icons/Manifest, Lift-to-Pause, Endabnahme-Tests (F-14, S-06, Q-04, Q-06, Q-07 umgesetzt).
Dateien: `src/offline/{update-policy,service-worker}.ts`, `src/ui/components/update-banner.ts`, `src/domain/lift-detection.ts`, `src/adapters/sensors/lift-detector.ts`, `public/icons/*.svg`, `public/manifest.webmanifest`, `index.html`, `src/app/{container,bootstrap}.ts`, `src/ui/screens/{player,settings}.ts`, `tests/{build,ui,unit}/*`, Doku.
Tests: 849/849 grün (47 Dateien, +88), `npm run build` ohne Warnungen (15 Precache-Einträge inkl. `wasm/zxing_reader.wasm`).

### #009 – `ee17d5f` – 2026-11-25 08:36:18
`feat(alltag)`: Alltagstauglichkeit, Version 0.2.0 (F-16 … F-20, Q-08 umgesetzt). Anforderungsänderung des Auftraggebers: im Alltag auf dem Smartphone nutzbar; Import, Export, Speichern und Laden vollumfänglich; Scannen, manuelle Eingabe, Laden und Importieren; Teilen mit anderen Personen; Codes nach einem Datum als ungültig markieren; Wort, Nutzen, Satz, Tag und Ablaufdatum je Code.
Dateien: `src/domain/{expiry,item-meta,share-format}.ts`, `src/adapters/share/{link-codec,share-adapter}.ts`, `src/application/{import-service,collection-service,backup-service,playback-service,settings-store}.ts`, `src/offline/install-prompt.ts`, `src/ui/components/{meta-fields,item-editor,share-actions,import-dialog,badges,dialog}.ts`, `src/ui/screens/{collections,scanner,player,settings}.ts`, `src/domain/{types,backup-schema,csv-items}.ts`, `.github/workflows/pages.yml`, `src/app/{container,version}.ts`, Doku.
Entscheidungen: ADR-44 … ADR-50 (Zusatzangaben additiv ohne Schema-Sprung, Ablaufdatum markiert nur, Austauschformat je Sammlung, Teilen mit Rückfällen, zweistufiger Import, Pages mit Tests als Gate, lokale Backup-Erinnerung).
Gefunden und behoben durch Tests: unbehandelte Ablehnung beim Entpacken beschädigter Links (Link-Codec).
Tests: 978/978 grün (55 Dateien, +129), `npm run build` ohne Warnungen.

### #010 – `aa738b3` – 2026-11-25 08:55:38
`feat(bibliothek)`: Gemeinsame Bibliothek, Version 0.3.0 (F-21, F-22, Q-09 umgesetzt). Anforderungsänderung des Auftraggebers: Codes nicht jedes Mal neu erfassen; Sammlungen über die Web-Adresse der App mit anderen teilen, inklusive Wort, Nutzen, Tags, Notiz und Ablaufdatum.
Dateien: `src/domain/library.ts`, `src/application/library-service.ts`, `src/application/collection-service.ts`, `src/domain/{types,backup-schema,errors}.ts`, `src/ui/screens/{collections,scanner}.ts`, `src/app/{bootstrap,container,version}.ts`, `scripts/library-index.mjs`, `public/library/index.json`, `vite.config.ts`, `package.json`, `tests/{unit,integration,ui,build}/*`, Doku.
Entscheidungen: ADR-51 … ADR-53 (Dateien im Repository statt Schreibzugriff auf GitHub aus der App wegen AGENTS.md Regel 1 und Token-Sicherheit; netzwerkbevorzugter Cache statt Precache; Fingerabdruck-Aktualisierung ohne automatisches Überschreiben).
Hinweis an den Auftraggeber: Das Beispiel `2345678765432` hat eine falsche GS1-Prüfziffer (richtig: `2345678765430`); die App lehnt es ab und korrigiert nie selbst (Regel 4).
Tests: 1028/1028 grün (59 Dateien, +50), `npm run build` ohne Warnungen.

## 4. Endabnahme (Meilenstein 7)

- Alle Muss-Anforderungen F-01 … F-15 sowie S-01 … S-07 und Q-01 … Q-07 sind „Umgesetzt“ (siehe Tabelle).
- Quality Gate: `npm test` 849/849, `npm run build` 0 Fehler / 0 Warnungen.
- Offene fachliche Punkte außerhalb der Software (Spezifikation Kap. 2, 25 Phase 0): Scanner-/Kassenmodelle, Stellenbedeutung von `2063701…`, reale Anzeige-/Leerzeiten (20er-Kalibrierung an der Hardware), Hardwaretests von Lift-to-Pause. Rückkanal (Frontkamera/Mikrofon/Kassenschnittstelle) ist laut Spezifikation 9.3 nicht Teil von Version 1.

## 5. Stand nach Alltags-Erweiterung (Version 0.2.0)

- Zusätzlich umgesetzt: F-16 … F-20 und Q-08 (Version 0.2.0) sowie F-21, F-22 und Q-09 (Version 0.3.0, gemeinsame Bibliothek). Quality Gate: `npm test` 1028/1028, `npm run build` 0 Fehler / 0 Warnungen.
- Noch am echten Gerät zu prüfen (nicht automatisiert testbar): Web-Share-Dialog mit Dateien auf dem Zielgerät (Chrome Android erlaubt je nach Version nur `.txt`; die App weicht automatisch aus), Installation über GitHub Pages, Datumswähler des Telefons.
- Einmalig nötig (außerhalb des Codes): GitHub-Repository → Settings → Pages → Source „GitHub Actions“; danach veröffentlicht jeder Push auf `main` die App nach bestandenen Tests.
