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

## 3. Zustandsautomat
Wird in Meilenstein 2 dokumentiert (Diagramm, Übergangsregeln).

## 4. Error-Code-Katalog
Wird in Meilenstein 1 dokumentiert (`ERR_CHECKSUM_INVALID`, `ERR_SEQUENCE_OVERFLOW`, `ERR_CAMERA_PERMISSION_DENIED`, `ERR_WASM_LOAD_FAILED`, `ERR_STORAGE_WRITE_FAILED`, `ERR_IMPORT_SCHEMA_INVALID`, …).

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

### ADR-07: Toolchain-Versionen
Entscheidung: Aktuelle Releases (TypeScript 7, Vite 8, Vitest 5) wie von `npm install` aufgelöst; Versionen sind durch `package-lock.json` fixiert. `@types/node` nur für Tests (`types: ["node"]`); `src/domain/` bleibt frei von Node-/Browser-APIs.
