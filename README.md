# BarQPlayer

Offline-first Android-PWA zum Scannen, Erzeugen (EAN-13, EAN-8, QR-Code, Code 128) und zeitgesteuerten Abspielen von Lager-Codes an Kassensystemen. Eine Anzeige gilt nie als bestätigte Kassenbuchung.

## Feature-Status
Meilenstein 0 (Setup) – noch keine Fachfunktionen. Aktueller Stand: [`docs/PFLICHTENHEFT_STATUS.md`](docs/PFLICHTENHEFT_STATUS.md).

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
