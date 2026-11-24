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
| F-01a | Format-Typen EAN-13/EAN-8/QR/Code 128/UPC-A als `string` | Offen | | | | `src/domain/types.ts` | |
| F-01b | Capture: Kamera-Decode EAN-13/EAN-8/Text-QR | Offen | | | | `adapters/camera`, `adapters/decoder`, `application/capture-service.ts` | |
| F-02 | Bildimport (File/Blob, Multi-Code) | Offen | | | | `adapters/decoder` | |
| F-03a | Manuelle Eingabe + Bulk-Parser (zeilenweise Fehler) | Offen | | | | `src/domain/bulk-parser.ts` | |
| F-03b | Eingabe-UI | Offen | | | | `src/ui/screens/` | |
| F-04 | Sammlungen anlegen/benennen/bearbeiten | Offen | | | | `application/collection-service.ts` | |
| F-05 | Reihenfolge & Mengen persistent | Offen | | | | `adapters/persistence/db.ts` | |
| F-06 | Einzelsymbol-Generator (bwip-js SVG) | Offen | | | | `adapters/renderer/barcode-renderer.ts` | |
| F-07 | Manueller Player | Offen | | | | `domain/playback-machine.ts`, UI | |
| F-08 | Zeitgesteuerter Player (Anzeige-/Leerzeit) | Offen | | | | `domain/playback-machine.ts` | |
| F-09 | Startverzögerung, Pause, sofortiges Ausblenden | Offen | | | | `domain/playback-machine.ts` | |
| F-10 | Unklarer Übergabebereich dokumentieren | Offen | | | | `domain/playback-machine.ts` | |
| F-11a | GS1-Modulo-10 (EAN-13/EAN-8/UPC-A) | Offen | | | | `src/domain/checksum.ts` | |
| F-11b | Prüfziffer bei Generation berechnen | Offen | | | | `src/domain/sequence.ts` | |
| F-12 | Präfix-/Feldvorlagen (Start, Ende, Schritt, Überlauf-Stopp) | Offen | | | | `src/domain/sequence.ts` | |
| F-13 | JSON-Sicherung & geprüftes Restore | Offen | | | | `application/backup-service.ts` | |
| F-14 | Offline-Start (SW, Precache inkl. WASM) | Offen | | | | `vite.config.ts`, `src/offline/` | |
| F-15 | Anzeige nie als „gebucht“ ausgeben | Offen | | | | `domain/playback-machine.ts`, UI | |
| S-01 | CSV-Import/-Export (führende Nullen, Formel-Injection-Schutz) | Offen | | | | `application/backup-service.ts` | |
| S-02 | Artikelstamm-Abgleich (`catalogStatus/Source/CheckedAt`) | Offen | | | | `application/collection-service.ts` | |
| S-03 | Scannerprofile + 20er-Kalibrierung | Offen | | | | UI Einstellungen | |
| S-04 | Kleinstapel-Modus | Offen | | | | `domain/playback-machine.ts` | |
| S-05 | Smart-Interleaver | Offen | | | | `src/domain/interleaver.ts` | |
| S-06 | Lift-to-Pause-Sensor (nur pausieren) | Offen | | | | `adapters/sensors/lift-detector.ts` | |
| S-07 | Sitzungsbericht | Offen | | | | UI | |
| Q-01 | `AppError`-Hierarchie, Fehlercodes, ErrorLogger | Offen | | | | `src/domain/errors.ts` | |
| Q-02 | Globale Fehlerabsicherung (`error`, `unhandledrejection`) → Blank | Offen | | | | `src/app/lifecycle.ts` | |
| Q-03 | Rendering-Regeln (#000/#FFF, crispEdges, Ruhezonen, ganzzahlig, 90°-Drehung) | Offen | | | | renderer | |
| Q-04 | `strict`, kein `any`, TSDoc an allen Exporten | Offen | | | | alle | |
| Q-05 | `navigator.storage.persist()` + Speicheranzeige | Offen | | | | `persistence/db.ts` | |
| Q-06 | Update-Policy: kein Reload in aktiver Sitzung | Offen | | | | `src/offline/` | |
| Q-07 | PWA-Icons + Manifest | Offen | | | | `public/icons/` | |

## 2. Meilensteinplan

M0 Setup · M1 Errors/Typen/Checksum/Sequenz/Bulk · M2 Interleaver/Playback-Machine · M3 Persistenz/Backup · M4 Renderer · M5 Kamera/Decoder/Capture · M6 UI · M7 Offline-Härtung/Lift/Abnahme.

## 3. Umsetzungsprotokoll (Changelog)

### #001 – `ee07e2c` – 2026-11-24 21:01:58
`chore(init)`: Projekt-Setup, Dependencies, lokales WASM, Doku-Grundstruktur (M0-01 … M0-05).
Geänderte Dateien: gesamtes Projektgerüst, `package.json`/`package-lock.json`, `vitest.config.ts`, `tsconfig.json`, `src/vite-env.d.ts`, `public/wasm/zxing_reader.wasm`, `tests/unit/smoke.test.ts`, vier Doku-Dateien.
Tests: 1/1 grün, `npm run build` fehlerfrei (PWA-Precache 7 Einträge inkl. WASM).

