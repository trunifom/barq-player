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

**Wichtig vorab:** BarQPlayer zeigt Codes an. „Angezeigt“ bedeutet nie „an der Kasse gebucht“.
