# Benutzerhandbuch – BarQPlayer

> Stand: Meilenstein 0. Die App-Funktionen entstehen in den folgenden Meilensteinen; dieses Handbuch wird dabei Kapitel für Kapitel ausgefüllt.

## Geplante Kapitel
1. PWA auf Android installieren
2. Offline-Vorbereitung
3. Scannen im Lager (Kamera & Foto-Import)
4. Sammlungen pflegen
5. Zahlenreihen & Präfix-Vorlagen (Beispiel `2 063701 028{XX}{C}`, Schritt `+12`)
6. Kassen-Fader: Manuell, Automatik, Kleinstapel
7. Verhalten bei Kassen-Fehlermeldungen
8. Kassen-Kalibrierung (20er-Test)
9. JSON-Backup & CSV-Austausch
10. Fehlerbehebung

## Vorab: Wie Zahlenreihen funktionieren (gilt ab der Oberfläche in Meilenstein 6)

Beispiel `2 063701 028{XX}{C}` mit Schritt `+12`:

- `2 063701 028` ist der **feste Teil** (10 Stellen), `{XX}` das **variable Feld** (2 Stellen), `{C}` die **Prüfziffer**, die die App selbst berechnet.
- Es entstehen die Felder `00, 12, 24, 36, 48, 60, 72, 84, 96` – also 9 gültige EAN-13. Die letzte Ziffer jedes Codes wird jedes Mal neu berechnet, sie wird nie hochgezählt.
- Passt ein Wert nicht mehr in das Feld (z. B. Endwert 100 bei zwei Stellen), meldet die App einen **Überlauf** und erzeugt nichts. Es wird nie abgeschnitten.
- Liegt der Endwert nicht auf dem Raster (+12), endet die Reihe beim letzten passenden Wert; die Vorschau zeigt dazu eine Warnung.
- EAN-13 braucht genau 12 Stellen vor der Prüfziffer (EAN-8: 7).
- Testen Sie neue Nummernbereiche zuerst mit einem freigegebenen Testprozess: In Ihrem Kassensystem können einzelne Stellen eine besondere Bedeutung haben (z. B. Preis oder Gewicht).

## Vorab: Listen einfügen

Pro Zeile ein Code. Fehlerhafte Zeilen werden mit Zeilennummer gemeldet (z. B. „Zeile 7: Prüfziffer falsch (erwartet 1 …)“) und **nicht** automatisch korrigiert. Leerzeilen werden ignoriert.

## Vorab: Wie der Kassen-Fader arbeitet (Bedienung folgt in Meilenstein 6)

- Zwischen zwei Codes ist die Fläche immer **leer (weiß)** – es gibt nie eine Überblendung.
- Bei **Pause, Fehler oder Wechsel in eine andere App/einen anderen Tab** verschwindet der Code **sofort**, damit die Kasse ihn nicht doppelt liest.
- Modi: **Manuell** (jede Position nach Ihrer Bestätigung), **Automatik** (ohne Rückmeldung der Kasse; nur „angezeigt“ wird protokolliert) und **Kleinstapel** (nach N Codes wird auf Ihre Bestätigung gewartet).
- Nach einer Unterbrechung zeigt die App den **unklaren Bereich**: Positionen, die angezeigt, aber von Ihnen nicht bestätigt wurden. Sie wählen: **abgeglichen** (Kasse geprüft), **wiederholen** (Vorsicht: Doppelbuchung möglich), **überspringen** oder **ab Position** fortsetzen. Es wird nie automatisch nachgeholt. Fortgesetzt wird immer mit einem kurzen Countdown.
- „Bestätigt“ heißt: **Sie** haben an der Kasse nachgesehen – nicht, dass die Kasse es gemeldet hat.
- **Identische Artikel nacheinander** liest mancher Scanner nur verzögert. Der Schalter „Smart-Interleaving“ mischt die Reihenfolge so, dass gleiche Codes möglichst nicht direkt aufeinander folgen.

## Vorab: Sicherung (Backup) und Austausch (Bedienung folgt in Meilenstein 6)

- **JSON-Backup** enthält alles (Sammlungen, Vorlagen, Profile, Artikelstamm, Sitzungsprotokolle). Erstellen Sie regelmäßig eine Sicherung – der Browser-Speicher kann gelöscht werden, auch wenn die App „persistenten Speicher“ erhält.
- **Wiederherstellen** ersetzt alle aktuellen Daten. Die Datei wird zuerst vollständig geprüft; ist sie fehlerhaft, bleiben Ihre Daten unverändert. Die Fehlermeldung nennt die betroffene Stelle (z. B. `data.items[3].quantity`).
- **CSV-Export/-Import** eignet sich für den Austausch mit Tabellen. Wichtig: Öffnen Sie CSV-Dateien nicht einfach per Doppelklick in Excel – führende Nullen gehen sonst verloren. Importieren Sie die Spalte „value“ als **Text**. Verlorene Nullen werden beim Import als Fehler gemeldet, nicht still ergänzt.
- Werte, die mit `=`, `+`, `-` oder `@` beginnen, werden im Export mit einem vorangestellten `'` geschützt, damit Tabellenprogramme sie nicht als Formel ausführen; beim Import der App wird das `'` wieder entfernt.
- **Artikelstamm-CSV** (Spalten z. B. `EAN`, `Aktiv`, `Bezeichnung`): Danach zeigt die App je Code „bekannt / inaktiv / unbekannt“ – bezogen auf den **importierten Stand** und dessen Datum, nicht auf den aktuellen Zustand Ihrer Kasse.

## Vorab: So werden Codes angezeigt (Generator/Fader, Bedienung folgt in Meilenstein 6)

- Codes erscheinen immer **schwarz auf weiß**, auch im Dunkelmodus des Telefons, mit dem vorgeschriebenen weißen Rand rundherum. Bitte keine Hüllen oder Schutzfolien mit Spiegelung verwenden und die Bildschirmhelligkeit hoch einstellen.
- Die Größe wird immer in **ganzen Bildschirmpunkten pro Strich** berechnet, damit die Striche scharf bleiben. Passt ein Code nicht auf den Bildschirm, meldet die App das – sie quetscht ihn nicht.
- **Lange Strichcodes** (z. B. Code 128 mit vielen Zeichen) werden bei Bedarf automatisch **um 90° gedreht**, damit sie größer dargestellt werden können. Halten Sie das Telefon dann entsprechend zum Scanner.
- QR-Codes enthalten reinen Text. Die App öffnet nie Links und führt nie etwas aus.

## Vorab: Scannen im Lager (Bedienung folgt in Meilenstein 6)

- **Kamera:** Die App nimmt bevorzugt die **Rückkamera**. Beim ersten Start fragt der Browser nach der Kameraberechtigung – bitte erlauben. Die Kamera funktioniert nur über eine sichere Verbindung (HTTPS) bzw. als installierte App. Wird die Berechtigung verweigert oder die Kamera von einer anderen App benutzt, zeigt die App eine verständliche Meldung; **Foto-Import** und **manuelle Eingabe** funktionieren dann trotzdem.
- **Ein Code, ein Eintrag:** Halten Sie den Code ruhig vor die Kamera. Bleibt er dauerhaft im Bild, wird er **nur einmal** erfasst. Soll derselbe Artikel mehrfach gezählt werden, nehmen Sie den Code kurz aus dem Bild (etwa eine Sekunde) und halten ihn erneut davor – oder ändern Sie die Menge direkt mit **+**/**−**. Im Modus „nur eindeutige Codes“ werden Wiederholungen ignoriert.
- **Ton und Vibration** bestätigen, dass der Code **tatsächlich gespeichert** wurde. Gab es einen Speicherfehler, hören Sie das tiefe Fehlersignal und der Code wurde **nicht** gespeichert. Ton wird erst nach Ihrem ersten Tippen auf der Seite freigeschaltet (Browser-Vorgabe).
- **Taschenlampe:** nur verfügbar, wenn Ihr Gerät sie für die Kamera anbietet.
- **Foto-Import:** Wählen Sie ein oder mehrere Fotos. Finden sich mehrere Codes in einem Bild, wählen Sie aus, welche übernommen werden. Bilder ohne erkennbaren Code oder nicht lesbare Bilder werden als solche gemeldet. Fotos werden nicht gespeichert, nur die ausgewählten Codes (der Dateiname dient als Bezeichnung).
- **Nur freigegebene Formate** werden übernommen: EAN-13, EAN-8, QR-Code (Text) und Code 128. Erkennungen mit falscher Prüfziffer werden verworfen und nicht korrigiert.
- **UPC-A:** Ein UPC-A-Strichcode ist technisch ein EAN-13 mit führender 0 und wird deshalb standardmäßig als **EAN-13** (13 Ziffern) gespeichert. UPC-A als eigenes Format kann in den Einstellungen freigegeben werden.
- **QR-Codes** werden nur als Text gespeichert. Die App **öffnet nie Links** und führt nichts aus; Links, WLAN- und Kontaktdaten werden nur angezeigt, gefährliche Schemata (z. B. `javascript:`) mit Warnung.
- **Offline:** Die Codeerkennung läuft komplett auf dem Gerät (lokale Datei `wasm/zxing_reader.wasm`); nach der ersten Installation brauchen Sie kein Netz.

**Wichtig vorab:** BarQPlayer zeigt Codes an. „Angezeigt“ bedeutet nie „an der Kasse gebucht“.
