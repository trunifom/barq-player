# BarQPlayer

Offline-first Android-PWA zum **Scannen**, **Erzeugen** (EAN-13, EAN-8, QR-Code, Code 128, optional UPC-A) und **zeitgesteuerten Abspielen** von Lager-Codes an Kassensystemen („Barcode- & QR-Fader“).

> **Wichtig:** BarQPlayer zeigt Codes nur an. Eine Anzeige ist **nie** eine bestätigte Kassenbuchung; „bestätigt“ heißt „von der Bedienperson geprüft“.

## Feature-Status

Alle Meilensteine sind umgesetzt (Details und Nachweise je Anforderung in [`docs/PFLICHTENHEFT_STATUS.md`](docs/PFLICHTENHEFT_STATUS.md)).

| Meilenstein | Inhalt | Status |
|---|---|---|
| M0 | Setup, Abhängigkeiten, lokales WASM, Doku-Grundstruktur | ✅ |
| M1 | Fehler-Framework, Typen, GS1-Prüfziffern, Sequenz-Engine (`2 063701 028{XX}{C}`, Schritt `+12`), Bulk-Parser | ✅ |
| M2 | Smart-Interleaver, deterministische Fader-Zustandsmaschine (Blank bei Pause/Fehler/Hintergrund, Generation-IDs, unklarer Übergabebereich) | ✅ |
| M3 | Dexie-Persistenz, Artikelstamm-Abgleich, JSON-Backup mit atomarem Restore, CSV mit Formelschutz | ✅ |
| M4 | Renderer: `#000` auf `#FFF`, `crispEdges`, ganzzahlige Pixel pro Modul, Ruhezonen, 90°-Drehung, Lookahead-Cache | ✅ |
| M5 | Kamera, Hybrid-Decoder (nativ → zxing-wasm, lokales WASM), Capture-Service, Foto-Import | ✅ |
| M6 | Mobile-First-UI (Scanner, Sammlungen, Generator, Fader, Einstellungen), 20er-Kalibrierung, globale Fehler-/Hintergrund-Absicherung | ✅ |
| M7 | Offline-Härtung (Service Worker, Update-Policy, Icons), Lift-to-Pause, Endabnahme | ✅ |

**Noch nicht Teil von Version 1** (Spezifikation 9.3): Frontkamera-/Mikrofon-Rückkanal, Kassenschnittstelle, Synchronisierung. Die Stellenbedeutung des Nummernbereichs `2063701…` und die tatsächlichen Scanner-/Kassenzeiten müssen an der realen Hardware geklärt werden (Kalibrierung).

## Tech-Stack
TypeScript (strict), Vite, vite-plugin-pwa (Service Worker, Precache), Dexie (IndexedDB), bwip-js (Modulmuster), zxing-wasm über `barcode-detector` (lokales WASM), Vitest (jsdom, fake-indexeddb). Keine UI-Frameworks, keine externen Dienste zur Laufzeit.

## Setup
```bash
npm install
npm run copy:wasm   # kopiert zxing_reader.wasm der installierten zxing-wasm-Version nach public/wasm/
npm run dev         # Entwicklungsserver
```

## Skripte
| Skript | Zweck |
|---|---|
| `npm test` | Alle Vitest-Tests (Unit, Integration, UI, Build, Qualitätsregeln). **Unter Windows aus PowerShell/cmd starten, nicht aus Git Bash.** |
| `npm run build` | `tsc --noEmit && vite build` (0 Fehler, 0 Warnungen) |
| `npm run preview` | Produktions-Build lokal ausliefern |
| `npm run copy:wasm` | lokales WASM bereitstellen (muss zur installierten Bibliotheksversion passen) |

## Offline-Test
1. `npm run build && npm run preview` und die Adresse in Chrome öffnen (Kamera braucht `localhost` oder HTTPS).
2. Warten, bis „Die App ist jetzt offline nutzbar“ erscheint.
3. Im Browser Offline schalten bzw. Flugmodus, App neu laden: Erfassen (Kamera, Foto-Import), Generator, Fader funktionieren ohne Netz.
4. Automatisch geprüft: `tests/build/production-build.test.ts` (Precache inkl. `wasm/zxing_reader.wasm`, Manifest, Icons, keine externen URLs, WASM byte-identisch zur Bibliotheksversion).

## Architektur in Kürze
`src/domain/` reine Fachlogik (Prüfziffern, Sequenzen, Zustandsautomat, Interleaving, Kalibrierung) · `src/application/` Use-Cases · `src/adapters/` Kamera, Decoder, Renderer, Dexie, Sensoren, Wake Lock · `src/ui/` Screens und Komponenten · `src/app/` Composition Root, Router, Lebenszyklus · `src/offline/` Update-Policy und Service-Worker-Registrierung. Details: [Software-Dokumentation](docs/SOFTWARE_DOKUMENTATION.md).

## Dokumente
- [Spezifikation (Single Source of Truth)](docs/Barcode_Lager_App_Dokumentation.md) · [AGENTS.md](AGENTS.md) (Regeln für KI-Agenten)
- [Pflichtenheft & Status](docs/PFLICHTENHEFT_STATUS.md) – Anforderungen, Fortschritt mit Datum/Uhrzeit/Commit, Changelog
- [Software- & Architekturdokumentation](docs/SOFTWARE_DOKUMENTATION.md) – Module, Datenmodell, Zustandsautomat, Fehlercodes, Rendering, Offline, ADRs
- [Benutzerhandbuch](docs/USER_GUIDE.md) – Installation, Scannen, Zahlenreihen, Fader, Fehlermeldungen, Kalibrierung, Backup
