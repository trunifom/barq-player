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
| F-01b | Capture: Kamera-Decode EAN-13/EAN-8/Text-QR | In Arbeit | 2026-11-24 | 22:03:55 | #006 `73935fa` | `adapters/camera`, `adapters/decoder`, `application/capture-service.ts` | `camera-adapter.test.ts`, `decoder-adapter.test.ts`, `decoder-real.test.ts`, `capture-service.test.ts`, `duplicate-filter.test.ts`, `detection.test.ts` (UI in M6) |
| F-02 | Bildimport (File/Blob, Multi-Code) | In Arbeit | 2026-11-24 | 22:03:55 | #006 `73935fa` | `adapters/decoder` | `decoder-adapter.test.ts`, `decoder-real.test.ts`, `capture-service.test.ts` (Foto-Import-UI in M6) |
| F-03a | Manuelle Eingabe + Bulk-Parser (zeilenweise Fehler) | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/bulk-parser.ts` | `bulk-parser.test.ts` (24) |
| F-03b | Eingabe-UI | Offen | | | | `src/ui/screens/` | |
| F-04 | Sammlungen anlegen/benennen/bearbeiten | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/collection-service.ts` | `collection-service.test.ts` |
| F-05 | Reihenfolge & Mengen persistent | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `adapters/persistence/db.ts` | `collection-service.test.ts`, `persistence.test.ts` |
| F-06 | Einzelsymbol-Generator (bwip-js SVG) | Umgesetzt | 2026-11-24 | 21:51:17 | #005 `fb59b88` | `adapters/renderer/barcode-renderer.ts` | `barcode-renderer.test.ts` (inkl. Decode-Roundtrip), `barcode-renderer-dom.test.ts` |
| F-07 | Manueller Player | In Arbeit | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts`, UI | `playback-machine.test.ts` (Domain; UI in M6) |
| F-08 | Zeitgesteuerter Player (Anzeige-/Leerzeit) | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| F-09 | Startverzögerung, Pause, sofortiges Ausblenden | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| F-10 | Unklarer Übergabebereich dokumentieren | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| F-11a | GS1-Modulo-10 (EAN-13/EAN-8/UPC-A) | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/checksum.ts` | `checksum.test.ts` |
| F-11b | Prüfziffer bei Generation berechnen | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/sequence.ts` | `sequence.test.ts` |
| F-12 | Präfix-/Feldvorlagen (Start, Ende, Schritt, Überlauf-Stopp) | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/sequence.ts` | `sequence.test.ts` |
| F-13 | JSON-Sicherung & geprüftes Restore | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/backup-service.ts` | `backup-schema.test.ts`, `backup-service.test.ts` |
| F-14 | Offline-Start (SW, Precache inkl. WASM) | Offen | | | | `vite.config.ts`, `src/offline/` | |
| F-15 | Anzeige nie als „gebucht“ ausgeben | In Arbeit | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts`, UI | `playback-machine.test.ts` (Domain; UI in M6) |
| S-01 | CSV-Import/-Export (führende Nullen, Formel-Injection-Schutz) | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/backup-service.ts` | `csv.test.ts`, `csv-items.test.ts`, `backup-service.test.ts` |
| S-02 | Artikelstamm-Abgleich (`catalogStatus/Source/CheckedAt`) | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `application/collection-service.ts` | `collection-service.test.ts`, `backup-service.test.ts` |
| S-03 | Scannerprofile + 20er-Kalibrierung | Offen | | | | UI Einstellungen | |
| S-04 | Kleinstapel-Modus | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `domain/playback-machine.ts` | `playback-machine.test.ts` |
| S-05 | Smart-Interleaver | Umgesetzt | 2026-11-24 | 21:18:03 | #003 `ed64ae2` | `src/domain/interleaver.ts` | `interleaver.test.ts` |
| S-06 | Lift-to-Pause-Sensor (nur pausieren) | Offen | | | | `adapters/sensors/lift-detector.ts` | |
| S-07 | Sitzungsbericht | Offen | | | | UI | |
| Q-01 | `AppError`-Hierarchie, Fehlercodes, ErrorLogger | Umgesetzt | 2026-11-24 | 21:09:57 | #002 `054851a` | `src/domain/errors.ts` | `errors.test.ts` |
| Q-02 | Globale Fehlerabsicherung (`error`, `unhandledrejection`) → Blank | Offen | | | | `src/app/lifecycle.ts` | |
| Q-03 | Rendering-Regeln (#000/#FFF, crispEdges, Ruhezonen, ganzzahlig, 90°-Drehung) | Umgesetzt | 2026-11-24 | 21:51:17 | #005 `fb59b88` | renderer | `render-layout.test.ts`, `barcode-renderer.test.ts` |
| Q-04 | `strict`, kein `any`, TSDoc an allen Exporten | Offen | | | | alle | |
| Q-05 | `navigator.storage.persist()` + Speicheranzeige | Umgesetzt | 2026-11-24 | 21:44:10 | #004 `0e03130` | `persistence/db.ts` | `persistence.test.ts` |
| Q-06 | Update-Policy: kein Reload in aktiver Sitzung | Offen | | | | `src/offline/` | |
| Q-07 | PWA-Icons + Manifest | Offen | | | | `public/icons/` | |

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
