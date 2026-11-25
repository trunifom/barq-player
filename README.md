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
| M8 | Alltagstauglichkeit (Version 0.2.0): Zusatzangaben je Code (Wort, Nutzen, Satz, Tags, Ablaufdatum), Ablauf-Markierung, Suche/Filter, Teilen (Datei, Link, Text), vollständiger Import (geteilte Sammlung, Backup, CSV, Liste, Link), Installationsknopf, Backup-Erinnerung, Veröffentlichung per GitHub Pages | ✅ |
| M9 | Gemeinsame Bibliothek (Version 0.3.0): Sammlungen samt Wort, Nutzen, Satz, Tags und Ablaufdatum werden als Dateien im Repository veröffentlicht; wer die Web-Adresse öffnet, kann sie übernehmen und aktualisieren – ohne Neuerfassung | ✅ |
| M10 | Kamera und Fader (Version 0.4.0): Zoom (Hardware und digital, Pinch), Auflösung, Fokus, Belichtung, hochauflösendes Foto und Kamera-App für kleine Codes; Fader mit Codeauswahl (Häkchen, Tag-Filter, Suche) und Zeiten pro Lauf | ✅ |

**Noch nicht Teil von Version 1** (Spezifikation 9.3): Frontkamera-/Mikrofon-Rückkanal, Kassenschnittstelle, Synchronisierung. Die Stellenbedeutung des Nummernbereichs `2063701…` und die tatsächlichen Scanner-/Kassenzeiten müssen an der realen Hardware geklärt werden (Kalibrierung).

## Tech-Stack
TypeScript (strict), Vite, vite-plugin-pwa (Service Worker, Precache), Dexie (IndexedDB), bwip-js (Modulmuster), zxing-wasm über `barcode-detector` (lokales WASM), Vitest (jsdom, fake-indexeddb). Keine UI-Frameworks, keine externen Dienste zur Laufzeit.

## Im Alltag auf dem Smartphone nutzen (einmalig einrichten)
Kamera und App-Installation funktionieren nur über **HTTPS**. Der mitgelieferte Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) testet die App bei jedem Push auf `main`, baut sie und veröffentlicht sie über **GitHub Pages**:

1. Änderungen pushen (`git push -u origin main`).
2. Im GitHub-Repository: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
3. Unter **Actions** den Lauf „Veröffentlichen (GitHub Pages)“ abwarten (grüner Haken). Die Adresse steht im Lauf und lautet `https://<Benutzername>.github.io/barq-player/`.
4. Diese Adresse am Handy in **Chrome** öffnen, kurz mit Netz warten („Die App ist jetzt offline nutzbar“) und dann **Einstellungen → App installieren** (oder Chrome-Menü ⋮ → *App installieren*).

Danach startet BarQPlayer wie jede App vom Startbildschirm, auch ohne Netz. Updates erscheinen als Hinweis und werden nie mitten in einer Fader-Sitzung aktiviert. Alle Daten bleiben auf dem Gerät – sichern Sie regelmäßig (*Einstellungen → Backup senden*), die App erinnert nach 14 Tagen.

## Codes für alle: die gemeinsame Bibliothek
Damit niemand Codes neu erfassen muss, lassen sich Sammlungen **zusammen mit der App veröffentlichen**: Datei in den Ordner [`public/library/`](public/library) legen (z. B. über GitHub „Add file → Upload files“), committen – nach dem Lauf „Veröffentlichen“ kann jeder, der die Web-Adresse öffnet, die Sammlung unter *Sammlungen → Gemeinsame Bibliothek* übernehmen (inklusive Wort, Nutzen, Satz, Tags und Ablaufdatum) und später aktualisieren. Der Index `public/library/index.json` wird bei `npm run build` bzw. `npm run library` automatisch erzeugt; ein Test prüft vor jeder Veröffentlichung, dass jede Datei gültig ist. **Die Bibliothek ist öffentlich lesbar** – keine vertraulichen Daten ablegen. Die App schreibt nie selbst nach GitHub. Details: [Benutzerhandbuch, Kapitel 11](docs/USER_GUIDE.md).

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
