# KI-Agenten-Anweisungen fuer BarQPlayer

Lies vor jeder Implementierung zwingend `docs/Barcode_Lager_App_Dokumentation.md` als Single Source of Truth.

## Verbindliche Architekturregeln
1. **Offline-First PWA (TypeScript + Vite):** Keine externen APIs, kein CDN zur Laufzeit. `zxing-wasm` MUSS die lokale Datei `./wasm/zxing_reader.wasm` laden (`locateFile`).
2. **Strenge Schichten-Trennung:** `src/domain/` enthaelt reine Fachlogik (Pruefziffern, Sequenzen, Zustandsautomat, Interleaving) ohne DOM-, Kamera- oder Browser-Abhaengigkeiten.
3. **Strings statt Numbers:** Barcodes (EAN-13, EAN-8, QR, Code 128) werden immer als `string` gespeichert, damit fuehrende Nullen nie verloren gehen.
4. **EAN-Pruefziffern:** Bei Sequenzen (z. B. `2 063701 028{XX}{C}`, Schritt `+12`) duerfen nur die Nutzdatenstellen gezaehlt werden; die letzte Stelle wird immer per GS1 Modulo-10 neu berechnet. Ueberlaeufe muessen gemeldet und gestoppt werden.
5. **Barcode- & QR-Rendering:** Reines Schwarz (`#000000`) auf reinem Weiss (`#FFFFFF`), niemals Dark-Mode-Invertierung, volle Ruhezonen (EAN-13: 11X/7X, QR: 4X rundum), SVG mit `shape-rendering="crispEdges"`, ganzzahlige Pixel-pro-Modul.
6. **Player-Sicherheit:**
   - Keine Ueberblendungen/Animationen zwischen Codes – nur harter Wechsel mit leerem Blank-Frame.
   - Bei **Pause** oder Tab-Wechsel das Symbol **sofort ausblenden** (verhindert Doppelscans).
   - Anzeige eines Codes darf niemals als bestaetigte Kassenbuchung markiert werden.
7. **Tests:** Jede Logik in `src/domain/` muss durch Vitest-Unit-Tests in `tests/unit/` abgesichert werden.
