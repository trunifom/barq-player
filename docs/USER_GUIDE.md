# Benutzerhandbuch – BarQPlayer

BarQPlayer erfasst Barcodes und QR-Codes im Lager, erzeugt Codes und Zahlenreihen und zeigt Codes an der Kasse einzeln nacheinander an, damit der Kassenscanner sie vom Telefondisplay liest.

> **Das Wichtigste vorab:** BarQPlayer **zeigt Codes nur an**. „Angezeigt“ oder „bestätigt“ bedeutet **nie**, dass die Kasse einen Artikel gebucht hat. „Bestätigt“ heißt: *Sie* haben an der Kasse nachgesehen. Prüfen Sie die Kasse bei Unsicherheit immer selbst.

## Inhalt
1. PWA auf Android installieren
2. Offline-Vorbereitung
3. Scannen im Lager
4. Sammlungen pflegen
5. Zahlenreihen und Präfix-Vorlagen
6. Der Kassen-Fader
7. Wenn die Kasse eine Fehlermeldung zeigt
8. Kassen-Kalibrierung (20er-Test)
9. Backup, Teilen, Import und CSV-Austausch
10. Fehlerbehebung

---

## 1. PWA auf Android installieren
1. Öffnen Sie die Adresse der App in **Chrome** auf dem Android-Telefon (nur über **HTTPS** funktioniert die Kamera).
2. Tippen Sie auf das Menü (⋮) → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“**.
3. Starten Sie BarQPlayer künftig über das Symbol auf dem Startbildschirm.

**Einfacher:** Unter *Einstellungen → Als App installieren* gibt es – sobald Chrome die Installation anbietet – eine Schaltfläche **App installieren**.

**Woher kommt die Adresse?** Die App wird bei jedem Update des Projekts automatisch über **GitHub Pages** veröffentlicht (Einrichtung einmalig, siehe README). Die Adresse lautet `https://<Benutzername>.github.io/barq-player/`. Öffnen Sie sie am Handy, installieren Sie die App und nutzen Sie sie danach auch ohne Netz.

Beim ersten Start fragt der Browser nach der **Kameraberechtigung** – bitte erlauben. Die App fragt außerdem **persistenten Speicher** an, damit der Browser Ihre Daten nicht automatisch löscht (Status unter *Einstellungen → Speicher*).

## 2. Offline-Vorbereitung
Die Codeerkennung und alle Funktionen laufen **auf dem Gerät**; es werden keine Daten ins Internet gesendet.
1. Öffnen Sie die App **einmal mit Internetverbindung** und warten Sie, bis sie vollständig geladen ist.
2. Prüfen Sie die Offline-Bereitschaft: Flugmodus einschalten, App schließen und neu öffnen, Kamera und Foto-Import testen.
3. Erstellen Sie **vor wichtigen Einsätzen ein Backup** (Kapitel 9).

Sobald alle Dateien im Gerätespeicher liegen, zeigt die App „**Die App ist jetzt offline nutzbar**“. Erscheint stattdessen „Der Offline-Betrieb konnte nicht eingerichtet werden“, öffnen Sie die App über HTTPS und mit Internetverbindung erneut.

**Updates:** Eine neue Version wird **nie von selbst und nie mitten in einer Fader-Sitzung** aktiviert. Wenn eine neue Version bereitsteht, erscheint oben der Hinweis „Eine neue Version von BarQPlayer ist verfügbar“ mit der Schaltfläche **Jetzt aktualisieren**. Läuft oder pausiert gerade eine Sitzung, ist die Schaltfläche gesperrt und der Hinweis erklärt warum; sie wird frei, sobald die Sitzung beendet ist. Aktualisieren lädt die App neu – erstellen Sie vorher bei Bedarf ein Backup. Den Zustand sehen Sie auch unter *Einstellungen → Diagnose*.

## 3. Scannen im Lager (Bereich **Erfassen**)
**Sammlung wählen:** Wählen Sie oben die Zielsammlung oder tippen Sie auf **Neu**.

**Kamera**
- **Kamera starten** (Rückkamera). Halten Sie den Code ruhig in den Rahmen. **Taschenlampe** und **Kamera wechseln** sind nur aktiv, wenn Ihr Gerät sie anbietet.
- **Ein Code, ein Eintrag:** Bleibt ein Code dauerhaft im Bild, wird er **nur einmal** erfasst. Soll derselbe Artikel mehrfach zählen, nehmen Sie den Code etwa eine Sekunde aus dem Bild und halten ihn erneut davor – oder ändern Sie die Menge später mit **+**/**−**. Mit **„Nur eindeutige Codes erfassen“** werden Wiederholungen ignoriert.
- **Ton und Vibration** bestätigen, dass der Code **tatsächlich gespeichert** wurde. Bei einem Speicherfehler hören Sie ein tiefes Doppelsignal und sehen eine Fehlermeldung; der Code ist dann **nicht** gespeichert.
- **Freigegebene Formate:** EAN-13, EAN-8, QR-Code (Text), Code 128; UPC-A können Sie zuschalten. Erkennungen mit falscher Prüfziffer werden **verworfen**, nie korrigiert. Ein UPC-A-Strichcode wird standardmäßig als **EAN-13 mit führender 0** gespeichert (beide haben dieselben Striche).
- Die Kamera stoppt automatisch, wenn Sie die App verlassen oder in den Hintergrund wechseln.

**Foto-Import:** Wählen Sie ein oder mehrere Fotos. Pro Foto sehen Sie die erkannten Codes und wählen aus, welche übernommen werden. Bilder ohne Code oder nicht lesbare Bilder werden als solche gemeldet. Die Fotos selbst werden **nicht** gespeichert; der Dateiname dient als Bezeichnung.

**Zusatzangaben beim Erfassen:** Unter dem Kamerabild erscheinen die zuletzt erfassten Codes; **Details** daneben öffnet das Formular für Wort, Nutzen, Satz, Tags und Ablaufdatum (Kapitel 4). Bei der manuellen Eingabe können Sie diese Angaben im Aufklapper **Zusatzangaben** einmal ausfüllen; sie gelten für alle Codes dieser Eingabe.

**Manuelle Eingabe und Liste:** Format wählen, Codes einfügen (**eine Zeile = ein Code**), **Prüfen**. Sie sehen „N gültig, M fehlerhaft“ und für jede fehlerhafte Zeile den Grund (z. B. „Zeile 3: Prüfziffer falsch (erwartet 1 …)“). Fehlerhafte Zeilen werden **nie automatisch korrigiert**. Mit **„Nur die N gültigen Zeilen speichern“** übernehmen Sie bewusst nur die gültigen.

**QR-Codes** werden nur als Text gespeichert. Die App **öffnet nie Links** und führt nichts aus; Links, WLAN- und Kontaktdaten werden nur angezeigt, gefährliche Schemata (z. B. `javascript:`) mit Warnung.

## 4. Sammlungen pflegen (Bereich **Sammlungen**)
- **Neue Sammlung**, **Umbenennen**, **Löschen** (mit Rückfrage – vorher ein Backup erstellen!).
- Öffnen Sie eine Sammlung, um die Positionen zu sehen: Nummer, Format, Wert, **Menge (+/−)**, Status.
- **Reihenfolge:** mit **↑**/**↓**. **✕** entfernt eine Position (die Nummern rücken auf).
- **Drei getrennte Status-Angaben** je Code – bewusst kein gemeinsamer grüner Haken:
  - **Syntax:** richtige Länge und Zeichen?
  - **Prüfziffer:** mathematisch korrekt (bei EAN)?
  - **Artikelstamm:** bekannt / inaktiv / unbekannt – nur bezogen auf den **importierten Stand** (Tooltip zeigt Quelle und Datum), **nicht** auf den aktuellen Zustand Ihrer Kasse. Ein „bekannter“ Artikel kann an der Kasse trotzdem unbekannt sein und umgekehrt.
- **Mit Artikelstamm abgleichen** (Artikelstamm unter *Einstellungen* importieren), **CSV exportieren**, **Backup (JSON)**.

### Zusatzangaben und Ablaufdatum
Jeder Code kann – **wenn Sie möchten** – ergänzt werden. Tippen Sie in der Zeile auf **✎** (Details bearbeiten):
- **Wort (Bezeichnung)** – z. B. „Bio-Äpfel 1 kg“ (bis 100 Zeichen).
- **Nutzen** – wofür der Code gedacht ist, z. B. „Kassentest“ (bis 100 Zeichen).
- **Satz (Notiz)** – ein freier Satz (bis 500 Zeichen).
- **Tags** – Schlagwörter, mit Komma getrennt (bis 10, je bis 30 Zeichen).
- **Ablaufdatum** – Datum über den Datumswähler.

Leere Felder bleiben leer; **Leeren** entfernt eine Angabe wieder. Zu lange Texte oder ein ungültiges Datum werden mit einer klaren Meldung abgelehnt und nie stillschweigend gekürzt.

**Abgelaufene Codes:** Ein Code gilt **bis einschließlich** seinem Ablaufdatum und ab dem Folgetag als **abgelaufen**. Er wird dann in der Liste rot als **ABGELAUFEN** markiert (durchgestrichener Wert); Codes, die innerhalb von 7 Tagen ablaufen, erscheinen orange. Über der Tabelle steht, wie viele Positionen betroffen sind. Der **Fader überspringt abgelaufene Codes** und nennt vor dem Start, wie viele übersprungen werden; mit **„Abgelaufene Codes trotzdem abspielen“** spielen Sie sie bewusst ab. Sind *alle* Codes abgelaufen, startet der Fader nicht und sagt das. Das Ablaufdatum **löscht oder verändert nie Daten** – es markiert nur.

**Ablaufdatum für viele Codes:** **„Ablaufdatum für alle setzen“** wirkt auf alle Positionen – oder, wenn Sie gerade suchen/filtern, nur auf die angezeigte Auswahl. Leer lassen entfernt das Datum.

### Suchen und Filtern
Über der Tabelle: **Suchen** (findet Code, Wort, Nutzen, Satz und Tags, ohne Rücksicht auf Groß-/Kleinschreibung), **Tag-Auswahl** (oder Tippen auf einen Tag in der Zeile) und **„Nur abgelaufene“**.

## 5. Zahlenreihen und Präfix-Vorlagen (Bereich **Generator**)
**Einzelcode:** Format und Inhalt eingeben – die Vorschau erscheint sofort. Bei EAN-13/EAN-8 mit 12 bzw. 7 Ziffern können Sie die **Prüfziffer berechnen** lassen (nur auf Ihren Klick). Mit **Zur Sammlung hinzufügen** übernehmen Sie den Code.

**Zahlenreihe – Beispiel `2 063701 028{XX}{C}`, Schritt `+12`:**
- `2 063701 028` ist der **feste Teil** (10 Stellen), `{XX}` das **variable Feld** (2 Stellen), `{C}` die **Prüfziffer**, die die App selbst berechnet.
- Schaltfläche **„Beispiel einfügen“** füllt Format, Schablone, Start `0`, Ende `96`, Schritt `12`.
- Ergebnis: Felder `00, 12, 24, 36, 48, 60, 72, 84, 96` → **9 gültige EAN-13**. Die letzte Ziffer wird für jeden Code neu berechnet, sie wird nie hochgezählt.
- **Start, Ende und Schritt** beziehen sich nur auf das variable Feld. Statt des Endwerts können Sie eine **Anzahl** angeben.
- **Überlauf:** Passt ein Wert nicht mehr ins Feld (z. B. Endwert 100 bei zwei Stellen, oder 10 Positionen mit Schritt 12), meldet die App „Überlauf“ **feldgenau** in Rot und erzeugt **nichts**. Es wird nie abgeschnitten.
- **Endwert außerhalb des Rasters** (z. B. Ende 50 bei Schritt 12): Die Reihe endet beim letzten passenden Wert (48); die Vorschau zeigt eine Warnung.
- **EAN-13 braucht genau 12 Stellen** vor der Prüfziffer (EAN-8: 7); die App meldet, wenn Ihre Schablone eine andere Länge hat.
- Speichern können Sie als **Vorlage**, als **neue Sammlung** oder **in eine bestehende Sammlung**.
- **Vorsicht im Kassenbetrieb:** In Ihrem Kassensystem können einzelne Stellen eine besondere Bedeutung haben (z. B. Preis oder Gewicht). Testen Sie neue Nummernbereiche nur in einem freigegebenen Testprozess.

## 6. Der Kassen-Fader (Bereich **Fader**)
**Vorbereiten:** Sammlung, **Scannerprofil**, **Modus** und optional **Smart-Interleaving** wählen, **Start**. Vor dem Start prüft die App, dass **jeder** Code darstellbar ist; sonst startet sie nicht und nennt die Position.

**Modi**
- **Manuell:** Jede Position wird kurz angezeigt, dann wartet die App. Sie prüfen die Kasse und tippen **„Geprüft – weiter“** (oder Enter).
- **Automatik:** Die Codes laufen ohne Rückmeldung der Kasse durch. Nur „angezeigt“ wird protokolliert.
- **Kleinstapel:** Nach N Codes wartet die App auf Ihre Bestätigung – ein Fehler betrifft dann höchstens einen kleinen Stapel.

**Smart-Interleaving:** Manche Scanner lesen identische Codes direkt hintereinander verzögert. Der Schalter mischt die Reihenfolge so, dass gleiche Codes möglichst nicht direkt aufeinander folgen (die Zahl vermiedener Übergänge wird angezeigt). Ohne identische Nachbarn bleibt die Reihenfolge unverändert.

**Während der Sitzung**
- **Start-Countdown** (in der unteren Leiste), dann erscheint der erste Code **schwarz auf weiß** auf der Anzeigefläche. Zwischen zwei Codes ist die Fläche **immer leer (weiß)** – es gibt **keine Überblendung**.
- Die **Bedienleiste** liegt **unter** der Anzeigefläche, nie über dem Code. **STOPP / Pause** ist die große rote Schaltfläche. Mit einem Bluetooth-Taster/Tastatur: **Leertaste oder Escape = Pause**, **Enter = Bestätigen**.
- **Pause, Fehler und App-Wechsel blenden den Code sofort aus** – damit die Kasse ihn nicht doppelt liest. Das gilt auch, wenn Sie den Tab wechseln, den Bildschirm sperren oder die App in den Hintergrund schicken.
- Der Bildschirm bleibt während der Sitzung an (sofern Ihr Gerät das erlaubt).
- **Lift-to-Pause (optional, experimentell, standardmäßig aus):** Unter *Einstellungen → Lift-to-Pause* können Sie zuschalten, dass der Fader sofort pausiert, wenn das Telefon angehoben, gekippt oder bewegt wird – oder wenn der Bewegungssensor keine Daten mehr liefert. Die Funktion wird erst scharf, wenn der erste Code angezeigt wird (nicht im Countdown). Sie kann **nur pausieren**; sie setzt nie fort und bestätigt nie etwas – danach gilt Kapitel 7. Testen Sie sie an Ihrem Gerät, bevor Sie sich darauf verlassen.
- Die Navigation ist während einer Sitzung gesperrt; beenden oder brechen Sie die Sitzung zuerst ab.

**Zusammenfassung:** Am Ende sehen Sie, wie viele Positionen **angezeigt** und wie viele von Ihnen **bestätigt** wurden – ohne Aussage über Kassenbuchungen.

## 7. Wenn die Kasse eine Fehlermeldung zeigt
Zeigt die Kasse einen Dialog (z. B. unbekannter Artikel), während die Codes laufen:
1. Tippen Sie **sofort auf STOPP / Pause** (oder Leertaste/Escape). Der Code verschwindet.
2. Lösen Sie den Kassendialog.
3. Die App zeigt den **unklaren Übergabebereich**:
   - *Zuletzt von Ihnen bestätigt:* Position X
   - *Zuletzt angezeigt:* Position Y
   - *Unklarer Bereich:* Positionen X+1 bis Y – angezeigt, aber nicht von Ihnen bestätigt. Ob die Kasse sie angenommen, verworfen oder zwischengespeichert hat, weiß die App **nicht**.
4. **Prüfen Sie die Kasse** und wählen Sie:
   - **Kasse abgeglichen – weiter nach Position Y:** Sie haben geprüft, alles bis Y ist erledigt. Das wird als **von Ihnen bestätigt** protokolliert.
   - **Unklaren Bereich wiederholen:** zeigt den Bereich erneut. **Achtung: Doppelbuchungen sind möglich**, wenn einzelne Artikel schon gebucht sind (Rückfrage).
   - **Unklaren Bereich überspringen:** weiter nach Y, der Bereich bleibt unbestätigt im Protokoll (Rückfrage).
   - **Ab dieser Position:** frei wählbare Fortsetzung.
   - **Sitzung abbrechen** (Rückfrage).
5. Nach Ihrer Wahl startet immer ein kurzer **Countdown**; verpasste Codes werden **nie automatisch nachgeholt**.

**Tipp:** Verwenden Sie den **Kleinstapel-Modus** und, wenn möglich, vorher den **Artikelstamm-Abgleich** – dann ist ein Fehler klein und unbekannte Artikel fallen vorab auf.

## 8. Kassen-Kalibrierung (20er-Test)
Ziel: Anzeige- und Leerzeit finden, die Ihre Kasse zuverlässig annimmt (*Einstellungen → 20er-Kalibrierung starten*).
1. Legen Sie eine **Testsammlung mit Artikeln an, die Ihre Kasse kennt** (nur in einem freigegebenen Testprozess!). Mit weniger als 20 Positionen wiederholt die App die Codes zyklisch; Mengen > 1 testen auch identische Folgecodes.
2. Wählen Sie das **Profil**, das Sie testen möchten, und starten Sie den Lauf: 20 Codes werden automatisch angezeigt.
3. Tragen Sie danach ein: **von der Kasse angenommen** (von 20), **zusätzliche Buchungen**, **Fehlerdialoge**.
4. **Auswerten** zeigt eine Erläuterung und einen Vorschlag:
   - **Fehlerfrei:** Betriebsprofil mit **25 % Reserve**.
   - **Positionen fehlen:** langsameres Profil (×1,5).
   - **Zusätzliche Buchungen:** kürzere Anzeige.
   - **Beides** oder **Fehlerdialoge:** kein Vorschlag – Lauf mit bekannten Testartikeln wiederholen.
5. **Als Profil speichern** übernimmt den Vorschlag.

Die Werte sind **Teststartpunkte, keine Garantie**. Wiederholen Sie wichtige Einstellungen mehrfach und planen Sie Reserve ein. Die mitgelieferten Profile (Langsam, Normaltest, Schnelltest, Identische Codes) sind ebenfalls nur Startpunkte. Die **Leerzeit ist mindestens 20 ms**, damit zwischen zwei Codes sicher ein leeres Bild liegt.

## 9. Backup, Teilen, Import und CSV-Austausch
### Sammlungen mit anderen teilen
In einer Sammlung (und in der Sammlungsliste über **Teilen**):
- **Teilen (Datei)** öffnet das Teilen-Menü Ihres Telefons (WhatsApp, E-Mail, Signal, Cloud …) und übergibt eine Datei (`….barq.json`). Bietet Ihr Gerät das Dateiteilen nicht an, wird die Datei **heruntergeladen** (Ordner *Downloads*) und Sie senden sie von dort weiter – die App sagt Ihnen, was passiert ist.
- **Teilen (Link)** erzeugt einen Link, der den Inhalt **komprimiert in sich trägt** (kein Server, keine Anmeldung). Wer den Link öffnet, sieht zuerst eine Vorschau und importiert erst nach Bestätigung. Sehr große Sammlungen sind für einen Link zu groß – dann die Datei verwenden.
- **Als Text kopieren** legt eine einfache Liste in die Zwischenablage (Code, Menge, Wort, Ablaufdatum).
- **CSV exportieren** liefert eine Tabelle mit allen Zusatzangaben.

Die geteilte Datei enthält Name, Codes, Mengen und Zusatzangaben – **keine** Protokolle, Profile oder Artikelstammdaten.

### Importieren (Daten laden)
**Sammlungen → Importieren** (auch unter *Einstellungen → Sichern, Teilen und Importieren*). Wählen Sie eine Datei **oder** fügen Sie Text bzw. einen App-Link ein. Die App erkennt die Art **am Inhalt** (die Dateiendung spielt keine Rolle):
- **Geteilte Sammlung** (`.barq.json`/`.txt`, Link) → wird als **neue Sammlung** angelegt.
- **BarQPlayer-Backup** → die Sammlungen daraus werden als **neue Sammlungen** übernommen (Vorlagen, Profile, Protokolle nicht; zum vollständigen Ersetzen dient *Backup wiederherstellen*).
- **CSV-Tabelle** → Spalten werden an der Kopfzeile erkannt (deutsch/englisch, z. B. *Code, Format, Menge, Wort, Nutzen, Satz, Tags, Ablaufdatum*). Ohne Format-Spalte wählen Sie das Format.
- **Einfache Liste** (eine Zeile = ein Code) → Format wählen.

Nach der **Prüfung** sehen Sie eine Zusammenfassung (Anzahl, bereits abgelaufene Codes, Fehler mit Zeilennummer). Erst **Importieren** speichert. **Vorhandene Daten werden nie überschrieben:** Gibt es den Namen schon, heißt die neue Sammlung „Name (2)“. Ein Fehler in einer geteilten Datei verwirft sie komplett; bei CSV/Listen wählen Sie, ob fehlerhafte Zeilen den Import abbrechen oder übersprungen werden. Bereits abgelaufene Codes werden mitimportiert und als abgelaufen markiert.

### Backup
**JSON-Backup** (*Einstellungen → Backup herunterladen*, **Backup senden / in Cloud speichern** oder in einer Sammlung): enthält alles – Sammlungen, Vorlagen, Profile, Artikelstamm, Sitzungsprotokolle. Der Browser-Speicher kann gelöscht werden (auch bei „persistentem Speicher“); sichern Sie regelmäßig.

Die App merkt sich, wann Sie zuletzt gesichert haben (*Einstellungen*), und erinnert in der Sammlungsliste, wenn die letzte Sicherung **älter als 14 Tage** ist oder es noch keine gibt. Ein sinnvoller Alltag: einmal pro Woche **Backup senden** an sich selbst (E-Mail/Cloud).

**Wiederherstellen** ersetzt **alle** aktuellen Daten. Die Datei wird zuerst **vollständig geprüft**; ist sie fehlerhaft, bleiben Ihre Daten unverändert und die Meldung nennt die Stelle (z. B. `data.items[3].quantity`). Sie müssen den Austausch ausdrücklich bestätigen.

**CSV-Export** (in der Sammlung) eignet sich für Tabellen. **Wichtig:** Öffnen Sie CSV-Dateien nicht einfach per Doppelklick in Excel – führende Nullen gehen sonst verloren. Importieren Sie die Spalte „value“ als **Text**. Verlorene Nullen werden beim Import als Fehler gemeldet, nicht still ergänzt. Werte, die mit `=`, `+`, `-` oder `@` beginnen, werden im Export mit einem vorangestellten `'` gegen Tabellenformeln geschützt; beim Import der App wird das `'` wieder entfernt.

**Artikelstamm-CSV** (*Einstellungen → Artikelstamm*): Spalten z. B. `EAN`, `Aktiv`, `Bezeichnung`. Bei Fehlern wird standardmäßig **nichts importiert** und jede fehlerhafte Zeile gemeldet; mit „Fehlerhafte Zeilen überspringen“ werden die gültigen übernommen.

## 10. Fehlerbehebung
| Problem | Lösung |
|---|---|
| „Der Kamerazugriff wurde verweigert“ | In den Chrome-/Android-Einstellungen die Kameraberechtigung für die App erlauben; bis dahin **Foto-Import** oder **manuelle Eingabe** nutzen. |
| „Die Kamera ist nur über HTTPS oder localhost verfügbar“ | App über eine HTTPS-Adresse öffnen bzw. installierte App verwenden. |
| „Kamera wird von einer anderen App verwendet“ | Andere Apps schließen (Videoanruf, Taschenlampen-Apps), erneut starten. |
| Taschenlampe ausgegraut | Ihr Gerät bietet sie für diese Kamera nicht an. |
| „Die lokale Decoder-Datei (WASM) konnte nicht geladen werden“ | App einmal **online** neu laden, damit alle Offline-Dateien vorhanden sind; danach erneut versuchen. |
| Code wird nicht erkannt | Näher/ruhiger halten, Beleuchtung/Taschenlampe, Foto-Import mit schärferem Bild. Nur freigegebene Formate werden übernommen. |
| Erkennung mit falscher Prüfziffer verworfen | Beschädigter oder falsch erkannter Code; erneut scannen. Es wird nie korrigiert. |
| „Die Daten konnten nicht gespeichert werden“ | Speicherplatz prüfen, Backup erstellen, Sammlungen aufräumen. Der Eintrag ist **nicht** gespeichert. |
| „Der Browser-Speicher ist voll“ | Alte Sammlungen exportieren und löschen. |
| Zahlenreihe meldet Überlauf | Feldbreite vergrößern (mehr `X`), Endwert senken oder Schritt verringern. |
| Fader startet nicht („Position n …“) | Der genannte Code ist nicht darstellbar (z. B. zu langer Text) oder passt nicht auf den Bildschirm; entfernen/kürzen. |
| Scanner liest identische Codes nicht | **Smart-Interleaving** einschalten oder das Profil „Identische Codes“ bzw. eine längere Leerzeit für identische Codes verwenden (Kalibrierung). |
| Sitzung zeigt „Fehler“ | Der Code wurde sofort ausgeblendet. Kasse prüfen, dann wie in Kapitel 7 fortfahren. Details unter *Einstellungen → Diagnose* (ohne Barcode-Inhalte). |
| „Der Offline-Betrieb konnte nicht eingerichtet werden“ | App über HTTPS und mit Internet öffnen und neu laden; danach Flugmodus-Test (Kapitel 2). |
| Hinweis „neue Version“ lässt sich nicht anklicken | Es läuft oder pausiert eine Fader-Sitzung. Sitzung beenden oder abbrechen, dann aktualisieren. |
| Fader pausiert von selbst („Sensor“) | Lift-to-Pause hat ein Anheben/Bewegen oder fehlende Sensordaten erkannt. Kapitel 7 anwenden; bei Fehlalarmen die Funktion in den Einstellungen ausschalten. |
| Daten verschwunden | Browserdaten gelöscht? Letztes **Backup wiederherstellen** (Kapitel 9). |

**Diagnose:** *Einstellungen → Diagnose* zeigt Decoder-Engine, App-Version und das Fehlerprotokoll. Es enthält Fehlercodes, aber keine Barcode-Inhalte.
