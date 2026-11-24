# BarQPlayer

Offline-first Android-PWA zum Scannen, Erzeugen (EAN-13, EAN-8, QR-Code, Code 128) und zeitgesteuerten Abspielen von Lager-Codes an Kassensystemen. Eine Anzeige gilt nie als bestätigte Kassenbuchung.

## Feature-Status
- ✅ M0 Setup (lokales WASM, Doku-Grundstruktur)
- ✅ M1 Fachkern 1: Fehler-Framework, Domain-Typen, GS1-Prüfziffern, Sequenz-Engine (`2 063701 028{XX}{C}`, Schritt `+12`), Bulk-Parser
- ✅ M2 Fachkern 2: Smart-Interleaver, deterministische Fader-Zustandsmaschine (Blank-on-Pause/Error/Background, Generation-IDs, Unsicherheitsbereich)
- ✅ M3 Persistenz: Dexie-Schema v1, Sammlungs-/Artikelstamm-Service, JSON-Backup mit atomarem Restore, CSV-Austausch mit Formelschutz
- ✅ M4 Renderer: bwip-js-Modulmuster → eigenes SVG (`#000`/`#FFF`, `crispEdges`, ganzzahlige Pixel pro Modul, Ruhezonen, 90°-Drehung, Lookahead-Cache), per zxing-wasm rückgelesen
- ✅ M5 Erfassung: Kamera-Adapter (Rückkamera, Wechsel, Taschenlampe), Hybrid-Decoder (nativ → zxing-wasm, lokales WASM), Capture-Service (Debounce, Ton/Vibration nach Speichern), Bildimport, QR nur als Daten
- ✅ M6 Oberfläche: Scanner, Sammlungen, Generator (Zahlenreihen), Fader mit Wiederaufnahme-Dialog, Einstellungen (Profile, 20er-Kalibrierung, Artikelstamm, Backup/Restore, Diagnose), Fehlerbanner, globale Fehler-/Hintergrund-Absicherung
- ⏳ M7: Offline-Härtung (Service Worker, Update-Policy, Icons), Lift-to-Pause, Endabnahme

Detailstand: [`docs/PFLICHTENHEFT_STATUS.md`](docs/PFLICHTENHEFT_STATUS.md).

## Tech-Stack
TypeScript (strict), Vite, vite-plugin-pwa, Dexie (IndexedDB), bwip-js, zxing-wasm (lokales WASM), barcode-detector, Vitest.

## Setup
```bash
npm install
npm run copy:wasm   # kopiert zxing_reader.wasm nach public/wasm/
npm run dev
```

## Skripte
| Skript | Zweck |
|---|---|
| `npm test` | Vitest (unter Windows aus PowerShell/cmd starten, nicht aus Git Bash) |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run preview` | Produktions-Build lokal ansehen |
| `npm run copy:wasm` | WASM lokal bereitstellen |

## Offline-Test
`npm run build && npm run preview`, Seite einmal online laden, dann im Browser Offline schalten bzw. Flugmodus und neu laden.

## Dokumente
- [Spezifikation](docs/Barcode_Lager_App_Dokumentation.md) · [AGENTS.md](AGENTS.md)
- [Pflichtenheft & Status](docs/PFLICHTENHEFT_STATUS.md)
- [Software-/Architekturdokumentation](docs/SOFTWARE_DOKUMENTATION.md)
- [Benutzerhandbuch](docs/USER_GUIDE.md)
