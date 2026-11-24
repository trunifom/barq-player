# Barcode-Lager-App: Recherche, Fachkonzept und technische Dokumentation

Stand: 24. November 2026  
Dokumentversion: 1.0  
Status: Planungs- und Entwicklungsgrundlage; keine bereits implementierte oder an der Hardware abgenommene Software.

## 1. Executive Summary

Die Anwendung soll auf einem Android-Smartphone Produkte erfassen, Barcodes und QR-Codes erzeugen, Sammlungen speichern und Codes später manuell oder zeitgesteuert an einem Kassenscanner präsentieren. Zusätzlich soll sie vordefinierte Nummernfolgen mit Präfixen, variablen Stellen und Schrittweiten erzeugen.

Empfohlen wird zunächst eine offlinefähige Progressive Web App (PWA) mit TypeScript, HTML und CSS. Barcode-Erkennung erfolgt lokal mit ZXing-WASM; die Erzeugung beispielsweise mit bwip-js. Beide Bibliotheken unterstützen EAN-13, EAN-8 und QR-Codes. IndexedDB übernimmt strukturierte lokale Daten. Service Worker und lokale Programmressourcen ermöglichen einen vorbereiteten Offlinebetrieb. [web:70][web:35][web:52][web:54]

Der Praxistest des Auftraggebers ist ein wichtiger Machbarkeitsnachweis: Mehrere auf dem Smartphone abgespielte Codebilder wurden vom vorhandenen Kassensystem gelesen. Die geschätzte Anzeigezeit lag bei 0,3 bis 0,5 Sekunden je Bild. Das Hauptproblem war nicht die Displaylesbarkeit, sondern die fehlende Reaktion der Wiedergabe auf Kassenfehlermeldungen.

Daraus folgt die wichtigste Architekturentscheidung: Die Anwendung darf eine Anzeige nicht mit einer bestätigten Kassenbuchung gleichsetzen. Ein reiner Player besitzt keinen Rückkanal. Automatische Weitergabe mit garantierter Vollständigkeit benötigt entweder einen kontrollierten manuellen Ablauf oder eine geeignete Verbindung zum Zielsystem.

Eine Frontkamera könnte Scannerlicht beobachten. Sie kann daraus ohne gerätespezifischen Nachweis jedoch nicht zuverlässig ableiten, ob die Kasse bereit ist oder ein Artikel verbucht wurde. Hersteller dokumentieren unterschiedliche Beleuchtungs-, Bereitschafts- und Dekodierzustände. Lichtstatus ist daher zunächst nur ein experimentelles Sensorsignal. [web:13]

Prioritäten:

1. Stabile Erfassung, lokale Sammlungen und Sicherung.
2. Gut kontrollierbarer manueller und zeitgesteuerter Player.
3. Exakte EAN-Prüfziffern- und Sequenzlogik.
4. Fehlerbehandlung, besonders bei unbekannten Artikeln und nicht sichtbarer Smartphone-Oberfläche.
5. Erst danach experimentelle Licht-/Tonerkennung oder eine integrierte Kassenschnittstelle.

## 2. Evidenzstatus und Grenzen

Dieses Dokument unterscheidet folgende Kategorien:

- Nutzerbeobachtung: vom Auftraggeber berichteter Versuch, nicht unabhängig nachgestellt.
- Quellenbelegte Technik: Hersteller-, Standard- oder Entwicklerdokumentation.
- Architekturvorschlag: empfohlene Gestaltung der noch zu entwickelnden Software.
- Hypothese: noch experimentell zu prüfende Möglichkeit.
- Offen: ohne konkrete Hardware, Konfiguration oder Schnittstellenbeschreibung nicht beantwortbar.

Die Quellenkennzeichnungen stehen unmittelbar bei den entsprechenden technischen Aussagen. Dokumentation verschiedener Scannermodelle beschreibt Möglichkeiten und Beispiele, nicht die nachgewiesene Konfiguration des vorhandenen Systems.

Nicht bekannt sind bisher:

- Hersteller und Modell des Handscanners.
- Hersteller und Modell des stationären Scanners.
- Name, Version und Konfiguration der Kassensoftware.
- Scanneranschluss und Übertragungsmodus.
- Verhalten des Scanners während eines unbekannten Artikels.
- Ob Eingaben während eines Dialogs verworfen, gepuffert oder anders verarbeitet werden.
- Ob die Kasse Rückmeldungen an den Scanner sendet.
- Konkretes Android-Gerät und Browser.
- Tatsächliche Bedeutung der Stellen im genannten Nummernbereich.

Ein geräteunabhängiges Versprechen zu Geschwindigkeit, Laserblinken oder automatischer Fehlererkennung wäre deshalb nicht belastbar.

## 3. Ausgangslage und Nutzerexperiment

### 3.1 Ursprünglicher Geschäftsablauf

Im Lager sollen benötigte Produktcodes mit dem Smartphone gesammelt werden. An der Endstation oder Kasse sollen diese Codes aus der gespeicherten Liste wieder erscheinen, damit der vorhandene Scanner sie einliest. Die Anwendung muss nicht notwendigerweise selbst als Kasse arbeiten.

Zusätzliche Zwecke:

- Einzelne Barcodes erzeugen.
- Bestehende EANs manuell eingeben oder importieren.
- Nummernfolgen aus Vorlagen erzeugen.
- Vorbereitete Sammlungen wiederverwenden.
- QR-Codes lesen, speichern, erzeugen und abspielen.

### 3.2 Berichteter Versuch vom 24. November 2026

Der Auftraggeber fotografierte mehrere Codebilder, aktivierte einen Bildschirmrekorder und wechselte in der Galerie durch ungefähr fünf Bilder. Jedes Bild blieb nach eigener Schätzung etwa 0,3 bis 0,5 Sekunden sichtbar. Das entstandene Video wurde am Kassenscanner abgespielt.

Beobachtetes Ergebnis laut Auftraggeber:

- Das Lesen vom Smartphone-Display funktionierte gut.
- Bestimmte ältere Produktcodes lösten Fehlermeldungen aus.
- Die Fehlermeldungen mussten an der Kasse weggeklickt werden.
- Das Video lief währenddessen weiter.
- Dadurch war die Folge nicht mehr mit dem Zustand der Kasse synchron.

Terminologische Einschränkung: Im Bericht wurden sowohl QR-Codes als auch Strichcodes erwähnt. Später wurden die üblichen Einzelhandels-EANs genannt. Ohne die Bilder kann nicht festgestellt werden, welche Symbologien im Versuch genau verwendet wurden. Das ist kein Problem für das Konzept, muss aber im Testprotokoll sauber dokumentiert werden.

### 3.3 Was der Versuch belegt und was nicht

Belegt als Nutzerbeobachtung:

- Mindestens die getestete Geräteanordnung kann Codes vom Smartphone lesen.
- Eine einfache Bildfolge ist als technischer Prototyp geeignet.
- Fehlerdialoge sind eine reale Betriebsanforderung.

Nicht nachgewiesen:

- Fehlerfreie Übernahme langer Listen.
- Exakte maximale Geschwindigkeit.
- Korrekte Übernahme wiederholter identischer Codes.
- Verhalten beider verfügbaren Scannerarten unter gleichen Bedingungen.
- Korrekte Verarbeitung von QR-Codes mit beliebigen Inhalten.
- Automatische Erkennbarkeit eines Kassenfehlers am Scannerlicht.

Schlussfolgerung: Der nächste Prototyp soll keine Videodatei sein, sondern ein kontrollierter Player mit einzeln adressierbaren Positionen, sofortigem Ausblenden des Symbols und nachvollziehbarem Unterbrechungszustand.

## 4. Begriffe und Barcodeformate

### 4.1 Inhalt, Symbol und Artikelstamm

Diese Ebenen müssen getrennt bleiben:

1. Inhalt: die Kennung oder Nutzdaten, beispielsweise eine 13-stellige Nummer.
2. Symbologie: die Darstellungsregeln, beispielsweise EAN-13 oder QR Code.
3. Symbol: das daraus erzeugte sichtbare Barcodebild.
4. Artikelstamm: die Zuordnung der Kennung zu Artikel, Preis und weiteren Daten im Zielsystem.

GS1 beschreibt EAN/UPC-Symbole als Datenträger unter anderem für GTINs; die GTIN identifiziert den Artikel. Ein Barcode ist nicht automatisch eine vollständige Produktdatenbank. [web:37][web:56]

### 4.2 EAN-13, EAN-8 und die Bezeichnung „EAN-9“

Für das hier gemeinte übliche EAN/UPC-Einzelhandelsumfeld sind insbesondere EAN-13 und EAN-8 relevant. GS1 dokumentiert EAN-13 als Datenträger für GTIN-13 beziehungsweise RCN-13 und EAN-8 für GTIN-8 beziehungsweise RCN-8. „EAN-9“ ist in dieser Aufzählung kein entsprechendes übliches EAN-Format; wahrscheinlich ist EAN-8 gemeint. Neun sichtbare Ziffern allein reichen nicht zur Formatbestimmung. [web:56][web:57]

Für die Anwendung:

- EAN-13 und EAN-8 explizit anbieten.
- Format aus Decodergebnis übernehmen, nicht nur aus Textlänge raten.
- Ungültige Eingaben nicht stillschweigend in ein anderes Format umwandeln.
- UPC-A gegebenenfalls ergänzen und Normalisierung explizit dokumentieren.
- Ursprünglichen Inhalt und ursprüngliches Format erhalten.

### 4.3 QR-Unterstützung

QR-Code ist ein verpflichtender Funktionsbereich. ZXing-WASM und bwip-js unterstützen QR-Erkennung beziehungsweise -Erzeugung. GS1-QR und GS1-Digital-Link-QR sind gegenüber einem gewöhnlichen Text-QR gesonderte Anwendungsfälle. [web:70][web:35]

MVP-Umfang:

- Normale QR-Codes mit Textinhalt scannen.
- QR-Inhalt unverändert speichern.
- QR aus Text erzeugen.
- QR-Codes in Listen und Player verwenden.
- Inhalt vor der Übernahme sichtbar machen.
- Keine URL automatisch öffnen.
- Keine Aktionen oder Befehle aus einem QR automatisch ausführen.

Wichtig: Ein QR mit der Zeichenfolge einer EAN ist nicht dasselbe Symbol wie ein EAN-13. Ob eine Kasse denselben Text aus QR genauso verarbeitet, muss separat getestet werden. Das Format darf nicht ungefragt ersetzt werden.

Eine inhaltstreue Neuerzeugung muss auch nicht dasselbe Pixelbild ergeben. Für spezielle Byte-Inhalte, ECI, GS1-Modi oder strukturierte QR-Anwendungen werden zusätzliche Metadaten und Formatprüfungen benötigt; eine einfache Textspeicherung ist dafür nicht pauschal verlustfrei. Der MVP soll seinen unterstützten Umfang klar als Text-QR definieren.

## 5. Warum „ungültig“ mehrere Ursachen haben kann

Die Anwendung muss mindestens drei Prüfungen unterscheiden:

| Prüfung | Bedeutung | Lokal möglich? |
|---|---|---|
| Syntax | Richtige Länge und erlaubte Zeichen | Ja |
| Prüfziffer | Mathematisch korrekte EAN-Prüfziffer | Ja |
| Artikelbekanntheit | Zielkasse kennt und akzeptiert den Artikel | Nur mit passenden Kassendaten oder Rückmeldung |

Eine alte Artikelnummer kann eine richtige Prüfziffer haben und trotzdem an der Kasse unbekannt sein. Umgekehrt lässt sich eine falsche Prüfziffer lokal erkennen, bevor das Symbol angezeigt wird. Die letzte Stelle der GTIN ist die aus den übrigen Stellen berechnete Prüfziffer. [web:55][web:60]

Das berichtete Fehlerbild ist mit unbekannten oder nicht mehr aktiven Artikeln vereinbar. Es beweist nicht, dass die fotografierten Symbole technisch falsch aufgebaut waren.

Vorgeschlagene Statusfelder:

- syntaxStatus: valid / invalid / unchecked.
- checksumStatus: valid / invalid / not-applicable / unchecked.
- catalogStatus: known / unknown / inactive / unchecked.
- catalogSource und catalogCheckedAt.

Die Oberfläche soll diese Aussagen nicht zu einem einzigen irreführenden grünen Haken zusammenfassen.

## 6. EAN-Prüfziffern und sichere Nummernfolgen

### 6.1 Grundregel

EAN-13 besteht aus zwölf Stellen des Nummernkörpers und einer abschliessenden Prüfziffer. Die Prüfziffer wird bei Änderung des Nummernkörpers neu berechnet; sie ist kein frei hochzählbarer Suffix. [web:57][web:60]

Für zwölf Ziffern d1 bis d12:

S = d1 + 3*d2 + d3 + 3*d4 + d5 + 3*d6 + d7 + 3*d8 + d9 + 3*d10 + d11 + 3*d12

Prüfziffer = (10 - (S mod 10)) mod 10.

GS1 beschreibt hierfür das Modulo-10-Verfahren. Für andere Längen ist auf die korrekte Ausrichtung der wechselnden Gewichte von rechts zu achten. [web:65]

### 6.2 Analyse des Beispiels „2 063701 0289 XY“

Ohne Leerzeichen:

20637010289XY

Zählung:

- 2: eine Stelle.
- 063701: sechs Stellen.
- 0289: vier Stellen.
- XY: zwei Stellen.
- Gesamt: dreizehn Stellen.

Damit gilt für eine vollständige EAN-13 in genau dieser Schreibweise:

- Positionen 1–11: fester Teil 20637010289.
- Position 12: X als frei wählbare Nutzdatenziffer.
- Position 13: Y als daraus berechnete Prüfziffer.

X und Y können hier nicht unabhängig als zweistelliger Wert von 00 bis 99 hochgezählt werden, wenn jede Ausgabe eine gültige EAN-13 bleiben soll.

Zwei sinnvolle, klar getrennte Modi:

A. Genau diese Vorlage beibehalten: X variiert von 0 bis 9, Y wird berechnet. Das ergibt maximal zehn verschiedene Nummernkörper.

B. Zwei frei variable Nutzdatenstellen verlangen: Dann dürfen davor nur zehn feste Stellen stehen. Allgemeine Schreibweise: fester_10_stelliger_Teil + XX + C. C ist die berechnete Prüfziffer. Welcher Teil des vorhandenen Präfixes dafür verändert werden dürfte, ist fachlich zu klären und darf nicht automatisch entschieden werden.

Weitere Möglichkeit: Ein grösseres Nutzdatenfeld variieren, beispielsweise die letzten fünf Stellen des zwölfstelligen Körpers. Das wäre eine andere Vorlage und muss ausdrücklich freigegeben werden.

### 6.3 Schrittweite zwölf

Die Schrittweite bezieht sich auf das konfigurierte Nutzdatenfeld, nicht auf die vollständige EAN inklusive Prüfziffer.

Beispiel für ein fünfstelliges Feld:

Start 289, Schritt 12, Breite 5:

00289, 00301, 00313, 00325, ...

Der vollständige Nummernkörper wird aus festen Teilen und diesem Feld aufgebaut. Anschliessend wird die Prüfziffer berechnet.

Ein einstelliges Feld kann keinen nächsten Wert mit +12 innerhalb seiner Breite aufnehmen. Die Anwendung muss den Überlauf melden oder die Folge beenden. Stilles Abschneiden, Modulo-Rücksetzen oder Übertragen in feste Präfixstellen ist verboten.

### 6.4 Vorgeschlagene Eingabemaske

- Format: EAN-13 / EAN-8 / QR / Code 128.
- Vorlagenmodus: vollständige vorhandene Codes oder generierte Folge.
- Fester Teil vor dem variablen Feld.
- Breite des variablen Feldes.
- Optional fester Teil danach, jedoch vor der Prüfziffer.
- Startwert.
- Endwert oder Anzahl.
- Schrittweite.
- Führende Nullen erhalten.
- Prüfziffermodus: automatisch bei EAN.
- Überlaufregel: stoppen und melden.
- Anzahl und erste/letzte Werte als Vorschau.

EAN-13 verlangt im Vorschlag exakt zwölf Nutzdatenstellen vor der berechneten Prüfziffer. EAN-8 verlangt entsprechend sieben. [web:57]

### 6.5 Modus für bereits vollständige Codes

Beim Einfügen vollständiger EANs:

1. Leere Zeilen erkennen.
2. Zulässige Darstellungsleerzeichen nach expliziter Regel entfernen.
3. Länge und Ziffern prüfen.
4. Prüfziffer prüfen.
5. Fehler pro Zeile anzeigen.
6. Ungültige Werte nicht automatisch korrigieren.
7. Korrektur als ausdrücklich bestätigte neue Kennung behandeln.

Bei QR-Inhalten dürfen Leerzeichen und Zeilenumbrüche nicht mit denselben EAN-Regeln entfernt werden.

### 6.6 Schweizer Nummernbereiche mit führender 2

Das genannte Präfix beginnt mit 20. GS1 Switzerland erläutert besondere, national geregelte Anwendungen im Bereich 20 bis 29, darunter Kennzeichnungen für mengenvariable Einheiten. Die Schweizer Spezifikationen zeigen unter anderem Preis- und Gewichtsfelder für bestimmte Präfixe. [web:62][web:59][web:68]

Daraus folgt nicht, dass die konkrete Nummer 2063701... sicher einen Preis oder ein Gewicht enthält. Die interne Interpretation eurer Kasse ist unbekannt.

Vor dem produktiven Generieren ist deshalb zu klären:

- Welche Stellen identifizieren die Kategorie oder den Artikel?
- Welche Stellen sind frei vergebbar?
- Welche Stellen enthalten Preis, Gewicht oder andere Werte?
- Gibt es zusätzliche feldbezogene Prüfziffern?
- Ist der Nummernbereich intern freigegeben?

Keine beliebigen Nummernfolgen in einer produktiven Verkaufssitzung ausprobieren: In einem konfigurierten variablen Nummernsystem kann eine geänderte Stelle fachlich etwas anderes als einen neuen Artikel bedeuten. Testkonto oder freigegebener Testprozess verwenden.

## 7. Technologieentscheidung

### 7.1 Empfohlener Ausgangspunkt: lokale PWA

Vorgeschlagener Stack:

| Bereich | Auswahl |
|---|---|
| Sprache | TypeScript |
| Darstellung | HTML und CSS |
| Build | Vite |
| Erkennung | zxing-wasm/reader |
| Erzeugung | @bwip-js/browser |
| Daten | IndexedDB |
| Offline | Service Worker und Cache API |
| Sicherung | Versioniertes JSON |
| Austausch | CSV nach dokumentiertem Schema |
| Tests | Unit- und Browsertests plus echte Hardwaretests |

Begründung: Die Grundfunktionen brauchen keine zentrale Datenverarbeitung. ZXing-WASM kann lokale Bilder auswerten, bwip-js Symbole im Browser erzeugen. Browserkamera, strukturierte lokale Speicherung und Offline-Caching sind dokumentierte Plattformfunktionen. [web:70][web:35][web:34][web:52][web:54]

Für den MVP ist kein grosses UI-Framework nötig. Ein vorhandenes Team kann stattdessen ein vertrautes Framework wählen; die Fachlogik soll davon unabhängig bleiben.

### 7.2 Native Android-App

Alternative bei nachgewiesenem Bedarf:

- Kotlin.
- CameraX.
- ML Kit Barcode Scanning.
- Lokale Datenbank, beispielsweise über Room.
- Native Bedienung und gegebenenfalls Hardwaretastenintegration.

Google dokumentiert ML Kit mit Kamerabildern und CameraX. Das Modell kann gebündelt in der App vorliegen oder dynamisch bereitgestellt werden. Für garantierte Ersterkennung ohne Netz ist der Unterschied relevant. [web:53]

Eine native App löst aber nicht automatisch das fehlende Kassenfeedback. Auch sie sieht ohne geeignete Schnittstelle zunächst nur das eigene Display und ihre Sensoren.

### 7.3 Java

Technisch eine mögliche Android-Sprache. Für dieses neue Projekt wird Kotlin als persönliche Architekturpräferenz empfohlen, nicht weil Java grundsätzlich ungeeignet wäre.

### 7.4 Python und Streamlit

Geeignet als Prototyp oder Zusatzwerkzeug für Artikelverwaltung, Auswertung und Importbereinigung. Das Standardwidget st.camera_input liefert aufgenommene Bilder und lädt sie zum Server; es ist kein fertiger kontinuierlicher Offline-Lagerdecoder. [web:36]

Kontinuierliches Scannen wäre mit zusätzlichen Komponenten möglich. Dann würde ein wesentlicher Teil der für dieses Projekt wichtigen Smartphone-Logik trotzdem im Browser oder einer Zusatzkomponente liegen. Deshalb nicht erste Wahl als Hauptarchitektur.

### 7.5 PHP und klassische Serveranwendung

Sinnvoll bei zentralem Artikelstamm, Mehrbenutzerbetrieb oder Unternehmensintegration. Für lokale Erzeugung, Erkennung und Wiedergabe ist PHP im vorgeschlagenen Aufbau nicht erforderlich.

### 7.6 Native Hülle später

Die Webanwendung kann bei Bedarf später in eine native Hülle überführt werden. Das ist ein Ausbaupfad, keine Garantie unveränderter Kamerafunktion oder Hardwaretastenunterstützung. Auch dieser Weg braucht Gerätetests.

## 8. Zielarchitektur und Modulgrenzen

```text
Android-Smartphone
  Oberfläche
    Scannen / Sammlungen / Generator / Sequenzen / Player / Einstellungen
  Anwendungsdienste
    Erfassen / Validieren / Mengen / Import / Export / Sitzungen
  Fachkern
    Barcodewerte / Prüfziffern / Vorlagen / Reihenfolge / Playerzustände
  Adapter
    Kamera / Decoder / Renderer / IndexedDB / Eingabegeräte
  Offline
    Service Worker / App-Cache / lokale WASM-Datei

Optional später
  PC-Helfer / Artikelstamm / Kassenschnittstelle / Synchronisierung
```

Designregeln:

- Prüfziffernlogik kennt keine Kamera und keine Oberfläche.
- Sequenzgenerator erzeugt Werte, keine Bilder.
- Renderer zeichnet, entscheidet aber nicht über Buchungsstatus.
- Player kennt eine unveränderliche Ausgabeliste der laufenden Sitzung.
- Persistenzadapter speichert fachliche Datensätze.
- Rückmeldungen besitzen Quelle und Vertrauensniveau.
- Fehler werden nicht stillschweigend übersprungen.

## 9. Fachliche Funktionen und Prioritäten

### 9.1 Muss für Version 1

| ID | Anforderung |
|---|---|
| F-01 | EAN-13, EAN-8 und Text-QR erfassen |
| F-02 | Aus Bilddateien lesen, neben Livekamera |
| F-03 | Inhalte manuell eingeben |
| F-04 | Sammlungen anlegen, benennen und bearbeiten |
| F-05 | Reihenfolge und Mengen speichern |
| F-06 | Einzelne Symbole erzeugen |
| F-07 | Manueller Player |
| F-08 | Zeitgesteuerter Player mit Anzeige- und Leerzeit |
| F-09 | Startverzögerung, Pause und sofortiges Ausblenden |
| F-10 | Unterbrechung mit unklarem Übergabebereich dokumentieren |
| F-11 | EAN-Prüfziffern prüfen und bei Generation berechnen |
| F-12 | Präfix-/Feldvorlagen mit Start, Ende, Schritt |
| F-13 | JSON-Sicherung und geprüfte Wiederherstellung |
| F-14 | Nach Vorbereitung offline starten und arbeiten |
| F-15 | Anzeige nicht als bestätigte Buchung ausgeben |

### 9.2 Soll nach stabiler Basis

- CSV-Import mit Spaltenzuordnung und Fehlerbericht.
- Artikelstammabgleich mit Datum und Quelle.
- Scannerprofile pro Arbeitsplatz.
- Kleine Stapel mit Bestätigung zwischen den Stapeln.
- Externe Bedienung für den Betrieb mit Display nach unten.
- Optional Code 128 und UPC-A.
- Sitzungsbericht über angezeigte und manuell bestätigte Positionen.

### 9.3 Experimentell oder später

- Frontkamera erkennt Beleuchtungswechsel.
- Mikrofon erkennt ein spezifisches Fehlersignal.
- Native Hardwaretastensteuerung.
- PC-Helfer mit authentifizierter Verbindung.
- Dokumentierte Kassenschnittstelle.
- Mehrbenutzerbetrieb und Synchronisierung.

## 10. Erfassung im Lager

### 10.1 Empfohlener Ablauf

1. Sammlung öffnen oder anlegen.
2. Rückkamera aktivieren.
3. Code in Zielbereich halten.
4. Inhalt und Format dekodieren.
5. EAN gegebenenfalls lokal prüfen.
6. Aufnahme nach Duplikatsregel behandeln.
7. Datensatz erfolgreich speichern.
8. Erst danach eine eindeutige Speicherbestätigung anzeigen.

Die Kameraauswahl kann im Browser über facingMode erfolgen. Berechtigung, Geräteverfügbarkeit und gegebenenfalls Wechsel durch Stoppen bestehender Tracks müssen behandelt werden. [web:34]

### 10.2 Technische und fachliche Duplikate

Technisches Duplikat: Derselbe vorgehaltene Code erscheint in vielen Videobildern.

Fachliche Wiederholung: Derselbe Artikel soll mehrfach gezählt werden.

Vorschlag:

- Durchgehend sichtbarer Code wird nur einmal erfasst.
- Erneute Erfassung nach bestätigtem Entfernen und erneutem Vorhalten.
- Alternativ Menge direkt ändern.
- Modus „nur eindeutige Codes“ optional.
- Keine globale Duplikatsperre als unveränderlicher Standard.

Google beschreibt bei Echtzeitdecodierung die Bedeutung ausreichender Bildqualität und stabiler Ergebnisse. Ein mehrbildbasierter Akzeptanzfilter ist ein möglicher Entwurf, muss aber gegen Reaktionszeit und falsches Zusammenfassen getestet werden. [web:53]

### 10.3 Bildimport

Der Bildimport ist besonders nützlich, weil bereits fotografierte Codes existieren.

Vorgeschlagener Ablauf:

- Eine oder mehrere Dateien wählen.
- Erkennung lokal durchführen.
- Mehrere gefundene Codes pro Bild einzeln anbieten.
- Nicht lesbare Bilder als solche melden.
- Dateiname als optionale Herkunft speichern.
- Originalfotos standardmässig nicht dauerhaft aufbewahren.

ZXing-WASM kann unter anderem File, Blob und ImageData verarbeiten. [web:70]

## 11. Player: kein Video und keine Überblendung

### 11.1 Darstellungsablauf

```text
Startverzögerung
  → Code 1 stabil anzeigen
  → leere Fläche
  → Code 2 stabil anzeigen
  → leere Fläche
  → ...
```

Keine weichen Übergänge: Während einer Überblendung entstehen veränderte Zwischenbilder. Die Erzeugungsbibliothek betont konsistente Module; Hersteller weisen auf deutlich getrennte Balken und Zwischenräume bei Bildschirmdarstellung hin. [web:35][web:18]

### 11.2 Parameter

- Anzeigezeit.
- Leerzeit.
- Startverzögerung.
- Manuell / automatisch / Kleinstapel.
- Menge je Position.
- Einzelposition wiederholen.
- Ab Position fortsetzen.
- Scannerprofil.
- Erwarteter Rückmeldekanal, falls überhaupt vorhanden.

### 11.3 Pause muss den Code ausblenden

Ein entscheidendes Detail: Pause soll standardmässig nicht denselben Barcode endlos sichtbar halten. Sonst könnte der Scanner je nach Konfiguration denselben Artikel nochmals lesen.

Beim Pausieren:

1. Symbol sofort ausblenden.
2. Timer abbrechen.
3. aktuelle Position protokollieren.
4. unklaren Übergabestatus anzeigen.
5. erst nach ausdrücklicher Entscheidung fortsetzen.

Eine Option „Code manuell dauerhaft anzeigen“ kann separat existieren, muss aber klar von einer sicheren Playerpause unterschieden werden.

### 11.4 Wiederholte identische Artikel

Scanner können identische Symbole zeitweise unterdrücken. Herstellerhandbücher dokumentieren dafür Einstellungen wie Timeout Between Decodes, Same Symbol. Bei bestimmten Modellen werden identische Symbole erst nach ausreichender Abwesenheit aus dem Sichtfeld erneut gelesen. [web:4][web:10]

Deshalb:

- Anzeige- und Leerzeit getrennt kalibrieren.
- Wiederholungen ausdrücklich testen.
- Schwarz oder Weiss als Leerfläche vergleichen; die gewählte Fläche darf kein lesbares Symbol enthalten.
- Nicht behaupten, dass jede identische Wiederholung angenommen wurde.

## 12. Fehlerdialoge: zentrale fachliche Herausforderung

### 12.1 Was beim Nutzerexperiment passiert ist

```text
Code A anzeigen → Kasse akzeptiert
Code B anzeigen → Kasse zeigt Fehlerdialog
Code C anzeigen → Kasse noch im Dialog
Code D anzeigen → Kasse noch im Dialog
...
```

Nicht bekannt ist, ob C und D verworfen, zwischengespeichert oder anderweitig verarbeitet werden. Deshalb ist automatisches Zurückspringen um eine feste Zahl gefährlich: Es könnte fehlende Positionen ergänzen, aber auch bereits gebuchte Artikel verdoppeln.

### 12.2 Betriebsmodi

A. Manuell bestätigt:

- Eine Position anzeigen.
- Symbol ausblenden.
- Bedienperson kontrolliert die Kasse.
- Bestätigung oder Fehler markieren.
- Nächste Position.

B. Zeitgesteuert ohne Rückkanal:

- Für bekannte und geprüfte Listen.
- Klarer Hinweis, dass nur Anzeigen protokolliert werden.
- Leicht erreichbarer Stopp.
- Bei Unsicherheit sofort pausieren und abgleichen.

C. Kleinstapel:

- Beispielsweise eine konfigurierbare kleine Zahl von Codes.
- Dann automatisch ausblenden und auf Bestätigung warten.
- Reduziert den Umfang einer unklaren Unterbrechung, beweist aber keine korrekte Einzelverarbeitung.

D. Integriert:

- Weitergabe mit Position-ID.
- Geeignete Rückmeldung über Annahme oder Ablehnung.
- Nächste Position erst nach definierter Bestätigung.

### 12.3 Wiederaufnahme nach Fehler

Vorgeschlagene Oberfläche:

- Letzte manuell bestätigte Position.
- Zuletzt angezeigte Position.
- Dazwischen liegender unbestätigter Bereich.
- Auswahl: abgeglichen / wiederholen / überspringen / Sitzung abbrechen.
- Warnung vor möglichen Doppelbuchungen.

Wichtig: Manuelle Bestätigung bedeutet eine Entscheidung der Bedienperson, nicht einen technisch empfangenen Kassennachweis.

### 12.4 Vorvalidierung

Die Fehlerrate kann durch einen aktuellen freigegebenen Artikelstamm sinken.

Ein Import soll mindestens Kennung, Aktivstatus, Datenquelle und Aktualitätsdatum enthalten. Offlinebekanntheit ist dann eine Aussage zum importierten Stand, nicht zu jedem späteren Kassenzustand.

Ohne Kassendaten kann die App unbekannte Artikel nicht anhand der Prüfziffer erkennen.

## 13. Frontkamera und rotes Scannerlicht

### 13.1 Direkte Antwort

Es ist technisch plausibel, dass die Frontkamera bei Display-nach-unten-Anordnung Licht vom Scanner sieht. Ob sie einen verwertbaren Unterschied erkennt, muss an genau dieser Gerätekombination getestet werden. Eine zuverlässige Erkennung „Kasse bereit“ folgt daraus nicht.

Rotes Licht ist nicht automatisch ein Laser und nicht automatisch eine Statusanzeige. Bei Imaging-Scannern unterscheidet die Herstellerdokumentation unter anderem Beleuchtung, Zielmuster, Objekterkennung und Dekodierzustand. Beim dokumentierten DS5502 können LEDs im Objekterkennungszustand schwach leuchten; ein anderer Modus schaltet Licht erst bei aktiver Dekodierung ein. [web:13]

### 13.2 Drei verschiedene Fragen

1. Ist Licht sichtbar?
2. Ist der Scanner gerade im aktiven Erkennungszustand?
3. Kann die Kassensoftware den nächsten Artikel fachlich verarbeiten?

Eine Kamera beantwortet zunächst nur die erste Frage. Die zweite benötigt gerätespezifische Kalibrierung. Die dritte benötigt einen belegten Zusammenhang oder, besser, eine geeignete Kassenschnittstelle.

Auch ein Scanner-Good-Read bedeutet zunächst erfolgreiche Dekodierung. Die dokumentierte Präsentationsfunktion beschreibt Piepsen und grüne LED beim erfolgreichen Decode, nicht die bestätigte Artikelbuchung. [web:13]

### 13.3 Warum es scheitern kann

Zu testende Risiken, keine bereits nachgewiesenen Fehler des vorhandenen Geräts:

- Kamera liegt ausserhalb des beleuchteten Bereichs.
- Smartphone liegt zu nahe an der Scanfläche für ein brauchbares Kamerabild.
- Reflexe oder Überbelichtung verdecken Zustandsunterschiede.
- Automatische Belichtung verändert die Helligkeit.
- Kurze Lichtimpulse werden nicht in jedem Kamerabild erfasst.
- Unterschiedliche Scanner benötigen andere Schwellen.
- Scannerlicht bleibt während eines Kassenfehlers unverändert.
- Licht geht auch nach einem normalen Lesevorgang kurz aus.
- Die eigene weisse Leerphase verändert das beobachtete Bild.
- Ein Bildschirm- oder Kamerazustandswechsel stört die Messung.

### 13.4 Experimenteller Entwurf

Zuerst nur Messung, noch keine automatische Steuerung:

1. Frontkamera mit Berechtigung öffnen.
2. Relevanten Bildbereich wählen.
3. Helligkeit und Rotanteil pro Bild berechnen.
4. Zeitstempel und tatsächliche Bildabstände protokollieren.
5. Parallel bekannte Ereignisse markieren: bereit, gültiger Artikel, unbekannter Artikel, Dialog geöffnet, Dialog geschlossen.
6. Mehrere Wiederholungen pro Ereignis durchführen.
7. An späteren, nicht zur Einstellung verwendeten Versuchen prüfen.

Beispielmerkmale als Entwurf:

- mittlere Helligkeit.
- Anteil rotdominanter Pixel.
- Anteil gesättigter Pixel.
- Änderung zum vorherigen Bild.
- Dauer eines stabilen Zustands.

Ein einfaches normalisiertes Rotmerkmal könnte R/(R+G+B+epsilon) sein. Das ist kein verifizierter Algorithmus für euren Scanner, sondern ein Ausgangspunkt für den Versuch.

### 13.5 Sicherheitsregel für Sensorik

Falls das Experiment brauchbare Signale zeigt, soll die erste Automatik konservativ sein:

- Verdächtiges Signal kann pausieren.
- Sensorverlust pausiert.
- Ein Lichtsignal allein bestätigt keine Buchung.
- Wiederanlauf zunächst nur manuell.
- Kein automatisches schnelles Nachholen.

Eine automatische Freigabe allein wegen erneut sichtbaren roten Lichts wäre vorerst nicht vorgesehen.

### 13.6 Sichtbarkeit und Bedienung bei Display nach unten

Der Nutzer sieht den Player in dieser Lage nicht und kann die Bildschirmtaste schlecht erreichen. Das ist eine zentrale UX-Anforderung.

Mögliche Entwürfe:

- Handy schräg halten statt vollständig auflegen, falls weiterhin lesbar.
- Freigegebener externer Taster, der als Tastatur erkannt wird.
- Bedienung über einen gekoppelten zweiten Bildschirm mit abgesicherter Verbindung.
- Native Android-Variante mit geeigneter Tastenbehandlung.

Jede Variante muss mit dem tatsächlichen Gerät getestet werden. Betriebssystemtasten dürfen nicht als garantiert im Browser abfangbar eingeplant werden. Ein zweites Gerät oder PC-Helfer ist eine zusätzliche Integration, keine Gratis-Eigenschaft der PWA.

## 14. Andere Rückmeldekanäle

| Kanal | Kann grundsätzlich anzeigen | Grenze |
|---|---|---|
| Kamera erkennt Rotlicht | Optisches Muster | Keine direkte Artikelbestätigung |
| Kamera erkennt Good-Read-LED | Dekodierereignis bei passender Sicht | Nicht automatisch Kassenbuchung |
| Mikrofon erkennt Ton | Akustisches Ereignis | Herkunft und Bedeutung können mehrdeutig sein |
| Scanner-SDK | Modellabhängige Scannerereignisse | Kassenstatus nicht automatisch enthalten |
| Kassenschnittstelle | Dokumentierte fachliche Antwort | Nur wenn vorhanden und freigegeben |
| Bedienperson | Sichtkontrolle der Kasse | Manuell, aufwendig und fehlbar |

Zebra dokumentiert bei einem Modell unterschiedliche Host-Schnittstellen, ACK/NAK-Mechanismen und sogar hostabhängige Not-on-File-Optionen. Das zeigt, dass Rückkanäle existieren können, aber stark von Modell, Protokoll und Konfiguration abhängen. Ein Transport-ACK ist nicht automatisch ein fachliches „Artikel gebucht“. [web:13]

Ein Mikrofonexperiment soll zunächst nur Metadaten oder Merkmale lokal verarbeiten und keine Gespräche speichern. Die Anwendung muss Kamera- und Mikrofonberechtigungen verständlich erklären. getUserMedia verlangt Nutzerberechtigung und signalisiert die Verwendung von Aufnahmegeräten im Browser. [web:34]

## 15. Geschwindigkeit und Leistungsziele

### 15.1 Berichtete Ausgangswerte

0,3 bis 0,5 Sekunden Bildanzeige entsprechen rechnerisch ungefähr 2 bis 3,3 Bildern pro Sekunde. Für 100 Bilder ergibt das 30 bis 50 Sekunden reine Anzeigezeit. Zusätzliche Leerphasen, Bedienung und Fehlerdialoge sind dabei noch nicht enthalten.

Das sind aus den geschätzten Versuchszeiten abgeleitete Werte, keine gemessene Dauer einer vollständig korrekt verbuchten 100er-Liste.

### 15.2 Ursprüngliches Ziel: 100 in fünf Sekunden

100 in fünf Sekunden bedeuten 20 verarbeitete Positionen je Sekunde und 50 Millisekunden je Position für den gesamten Ablauf. Dafür gibt es bisher keinen Nachweis.

Eine Herstellerangabe zu Scans oder Bildern pro Sekunde ist nicht mit vollständig angenommenen Kassenartikeln gleichzusetzen. Scanner können zusätzlich Wartezeiten zwischen gleichen oder unterschiedlichen Symbolen haben. [web:6][web:9][web:10]

### 15.3 Vorschlag für erste Profile

Die folgenden Werte sind Startpunkte für Tests, keine garantierten Einstellungen:

| Profil | Anzeige | Leerphase | Zweck |
|---|---:|---:|---|
| Langsam | 1000 ms | 300 ms | Grundfunktion prüfen |
| Normaltest | 500 ms | 150 ms | Nutzerbeobachtung vorsichtig aufgreifen |
| Schnelltest | 300 ms | 100 ms | Nur nach fehlerfreien Vergleichstests |
| Identische Codes | gesondert | gesondert | Wiederholsperre kalibrieren |

Bei gleichen Codes können deutlich andere Leerzeiten erforderlich sein. Die getestete Scanposition, Helligkeit und Scannerkonfiguration gehören zum Profil.

### 15.4 Leistungsmetrik

Nicht nur „angezeigte Codes pro Sekunde“ messen, sondern:

- korrekt akzeptierte Positionen.
- fehlende Positionen.
- unerwartete zusätzliche Positionen.
- falsche Artikel oder Mengen.
- Fehlerdialoge.
- Zeit bis sicherer Unterbrechung.
- Zahl unklarer Positionen nach Unterbrechung.
- Gesamtdauer inklusive Bedienung.

Ein schneller Lauf mit fehlenden Artikeln ist kein Erfolg.

## 16. Datenmodell

Grundsatz: Kennungen werden als Zeichenfolgen gespeichert, nicht als Zahlen. Führende Nullen bleiben erhalten. Rechenwerte für Sequenzen sind ein getrenntes Konzept.

```ts
type Symbology = 'EAN13' | 'EAN8' | 'QRCode' | 'Code128' | 'UPCA';

type CatalogStatus = 'unchecked' | 'known' | 'unknown' | 'inactive';

interface Collection {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface BarcodeItem {
  id: string;
  collectionId: string;
  position: number;
  symbology: Symbology;
  value: string;
  quantity: number;
  source: 'camera' | 'image' | 'manual' | 'import' | 'sequence';
  capturedAt: string;
  catalogStatus: CatalogStatus;
  catalogCheckedAt?: string;
  label?: string;
}

interface SequenceDefinition {
  id: string;
  symbology: 'EAN13' | 'EAN8' | 'QRCode' | 'Code128';
  prefix: string;
  suffixBeforeCheckDigit: string;
  variableWidth: number;
  start: string;
  end: string;
  step: string;
  checksumMode: 'gs1-mod10' | 'none';
  overflow: 'stop';
}

interface PlaybackEntry {
  id: string;
  sourceItemId: string;
  repetition: number;
  value: string;
  symbology: Symbology;
}

interface PlaybackEvent {
  id: string;
  sessionId: string;
  entryId?: string;
  timestamp: string;
  type: 'displayed' | 'blanked' | 'paused' | 'manual-confirmed'
    | 'pos-accepted' | 'pos-rejected' | 'uncertain';
  evidence: 'player' | 'operator' | 'sensor' | 'pos';
  detail?: string;
}
```

Dies ist ein fachlicher Entwurf, kein vollständiges Datenbankschema. pos-accepted darf nur durch einen dafür definierten vertrauenswürdigen Integrationsadapter entstehen, nicht durch einen Timer oder Rotlichtsensor.

Laufende Sitzungen verwenden einen eingefrorenen Snapshot der Werte und Reihenfolge. Änderungen an der ursprünglichen Sammlung dürfen eine bereits laufende Ausgabe nicht unbemerkt verändern.

## 17. Zustandsautomat und Zeitsteuerung

Vorgeschlagene Zustände:

```text
IDLE → VALIDATING → COUNTDOWN → SHOWING → BLANKING
                                      ↑          ↓
                                      └── NEXT ──┘

Zusätzliche Übergänge:
PAUSED / WAITING_CONFIRMATION / WAITING_POS / ERROR / FINISHED
```

Regeln:

- Pause und Fehler blenden den Barcode sofort aus.
- Bei Hintergrundwechsel pausieren.
- Nach Unterbrechung keine verpassten Positionen nachholen.
- Keine zusätzlichen Ausgaben nach einem alten abgelaufenen Timer.
- Bei Fortsetzen zuerst einen klaren Startzustand herstellen.
- Anzeigezeit beginnt erst, wenn das Symbol vorbereitet und an den Darstellungsablauf übergeben wurde.
- Browserseitiges Renderereignis beweist keine optische Sichtbarkeit beim Scanner.
- Timer sind keine harte Echtzeitgarantie.

Implementierungsvorschlag:

- Pro Sitzung eine Generation-ID oder ein Abbruchsignal.
- Alte asynchrone Ergebnisse verwerfen, wenn Sitzung oder Position gewechselt hat.
- Statt unabhängig laufendem setInterval eine kontrollierte Folge zustandsgebundener Schritte.
- Monotone Zeitmessung für Dauern.
- Nächste ein bis zwei Symbole vorbereiten.
- Keine unbegrenzte Vorberechnung aller Bilder grosser Folgen.

## 18. Darstellung und Bildqualität

Anforderungen:

- Schwarze Symbole auf weissem Hintergrund.
- Formatgerechte freie Randzonen.
- Keine Bedienelemente über dem Symbol.
- Keine Verzerrung des Seitenverhältnisses.
- Kein Abschneiden langer Symbole.
- Integerbasierte Modulgrössen bei Rasterdarstellung berücksichtigen.
- Device-Pixel-Ratio und CSS-Skalierung prüfen.
- Ausreichende, aber getestete Bildschirmhelligkeit.
- Keine Kamera-Vorschau im Barcodebereich.

bwip-js erklärt, dass ungleichmässige Modulbreiten bei niedriger Auflösung problematisch sind, und verwendet konstante Modulgrössen. Ein nachträgliches beliebiges Zusammendrücken eines fertig erzeugten Symbols kann diesen Vorteil zunichtemachen. [web:35]

Der Player sollte echte neu erzeugte Symbole verwenden, statt fotografierte Etiketten mit schiefen Rändern und unnötigem Hintergrund. Fotos bleiben ein nützlicher Eingabekanal.

## 19. Offlinebetrieb, Hosting und Installation

### 19.1 HTTPS und Kamera

Kamerazugriff mit getUserMedia erfordert einen sicheren Kontext und eine Berechtigung. MDN dokumentiert HTTPS und lokale Ausnahmen wie localhost. Ein auf dem PC gestarteter HTTP-Server unter einer privaten LAN-Adresse ist auf dem Smartphone nicht automatisch localhost. [web:34]

Eine direkt geöffnete HTML-Datei kann je nach Browser einzelne Funktionen erlauben, ist aber nicht der empfohlene Weg für eine konsistente installierbare Offlineanwendung.

### 19.2 Statisches Hosting

Vorgeschlagener Betrieb:

1. Anwendung bauen.
2. Statische Dateien auf HTTPS-Hosting ausliefern.
3. Auf Smartphone öffnen und gegebenenfalls zum Startbildschirm hinzufügen.
4. Offlinebestandteile vollständig laden.
5. Offlinebereitschaft testen.

Ein öffentlicher App-Host muss nicht die Produktdaten erhalten. Im vorgesehenen lokalen Modell bleiben Sammlungen im Browser, solange keine Synchronisation oder externen Dienste eingebaut werden.

Keine bestimmte Gratisplattform wird dauerhaft zugesichert. Vor der Auswahl sind aktuelle Nutzungsbedingungen, geschäftliche Nutzung, Speicher- und Bandbreitenlimits sowie Verfügbarkeit zu prüfen.

### 19.3 Besonders wichtig: WASM lokal ausliefern

ZXing-WASM verwendet standardmässig einen CDN-Pfad für die WASM-Datei. Für kontrollierten Offlinebetrieb soll locateFile auf die zur Bibliotheksversion passende lokale Datei zeigen. Bibliothek und WASM-Version müssen zusammenpassen. [web:70]

Offline-Checkliste:

- HTML und App-JavaScript vorhanden.
- CSS und lokale Symbole vorhanden.
- Decoder-WASM vorhanden.
- Barcodegenerator vorhanden.
- Keine zwingende externe Schriftart.
- Kamera funktioniert im Flugmodus.
- App startet nach Schliessen und Wiederöffnen ohne Netz.
- Bildimport funktioniert ohne Netz.

### 19.4 Updates

- Neue Version nicht mitten in einer Sitzung aktivieren.
- Datenbankschema versionieren.
- Vor riskanter Migration Sicherung anbieten.
- Nach Update Offline-Smoke-Test ausführen.
- Appversion im Sitzungsprotokoll speichern.

## 20. Speicherung, Backup und Datenschutz

IndexedDB bietet strukturierte Speicherung. Browserdaten sind standardmässig Best-Effort-Daten; persistenter Speicher kann angefragt werden. Auch persistente Daten sind kein Ersatz für eine Sicherung, da Nutzer sie löschen können. Im privaten Modus werden Daten üblicherweise beim Sitzungsende entfernt. [web:52]

Vorgeschlagene Schutzmassnahmen:

- Nach jeder bestätigten Erfassung transaktional speichern.
- Schreibfehler sichtbar melden.
- navigator.storage.persist() anfragen und Ergebnis anzeigen.
- Geschätzte Speichernutzung anzeigen.
- JSON mit schemaVersion exportieren.
- Import vor dem Überschreiben vollständig validieren.
- Wiederherstellung praktisch testen.
- Migration zwischen Domains durch Export/Import vorsehen, da Browserspeicher originbezogen ist. [web:52]

Datenschutzentwurf:

- Keine Analyse-Tracker im MVP.
- Keine Produktcodes an öffentliche Generator-APIs senden.
- Kamera- und Mikrofondaten lokal verarbeiten.
- Sensorvideos nicht standardmässig speichern.
- Bei optionalen Diagnosedaten Löschregeln und Einwilligung klären.
- Unbekannte QR-Inhalte als Daten behandeln.
- Keine Zugangstoken in QR-Vorschauen oder Diagnoseprotokollen unnötig offenlegen.

CSV-Import/-Export muss führende Nullen und Tabellenformeln berücksichtigen. JSON ist das vollständigere Backupformat; CSV ist ein dokumentiertes Austauschformat, kein verlustfreier Ersatz für das gesamte Datenmodell.

## 21. Kleine Referenzimplementierung für Prüfziffer und Vorlage

Das folgende TypeScript ist ein bewusst kleiner, nicht in dieser Dokumentation ausgeführter Entwurf. Vor produktiver Nutzung sind Unit-Tests, Grenzfalltests und Integrationstests erforderlich. Er unterstützt nur aufsteigende EAN-13-Folgen mit genau einem variablen Nutzdatenfeld.

```ts
export function gs1CheckDigit(body: string): string {
  if (!/^\d+$/.test(body)) throw new Error('Nur Ziffern erlaubt');
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan(value: string): boolean {
  if (!/^(?:\d{8}|\d{13})$/.test(value)) return false;
  return gs1CheckDigit(value.slice(0, -1)) === value.slice(-1);
}

interface Ean13Sequence {
  prefix: string;
  suffix: string; // feste Nutzdaten nach dem variablen Feld
  width: number;
  start: bigint;
  end: bigint;
  step: bigint;
  maxItems: bigint;
}

export function* generateEan13(s: Ean13Sequence): Generator<string> {
  if (!/^\d*$/.test(s.prefix) || !/^\d*$/.test(s.suffix)) {
    throw new Error('Feste Teile müssen numerisch sein');
  }
  if (!Number.isInteger(s.width) || s.width < 1 || s.width > 12) {
    throw new Error('Ungültige Feldbreite');
  }
  if (s.prefix.length + s.width + s.suffix.length !== 12) {
    throw new Error('EAN-13 benötigt 12 Nutzdatenstellen');
  }
  const max = 10n ** BigInt(s.width) - 1n;
  if (s.start < 0n || s.end < s.start || s.end > max) {
    throw new Error('Bereich passt nicht in das variable Feld');
  }
  if (s.step <= 0n || s.maxItems < 1n) {
    throw new Error('Schritt und Obergrenze müssen positiv sein');
  }
  const count = (s.end - s.start) / s.step + 1n;
  if (count > s.maxItems) throw new Error('Zu viele Positionen');
  for (let n = s.start; n <= s.end; n += s.step) {
    const part = n.toString().padStart(s.width, '0');
    const body = s.prefix + part + s.suffix;
    yield body + gs1CheckDigit(body);
  }
}
```

Wichtige Integrationsdetails:

- BigInt ist eine interne Rechenform; für JSON Start, Ende und Schritt als dezimale Strings speichern.
- Obergrenze vor dem Rendern prüfen.
- Ende wird nur erreicht, wenn es auf dem Schrittraster liegt.
- Kein Überlauf in feste Stellen.
- Ein Generator liefert bei Bedarf Werte und muss nicht alle Bilder speichern.
- UI muss Invalidität bereits vor Beginn verständlich anzeigen.

## 22. Beispielhafte Projektstruktur

```text
barcode-lager/
  README.md
  package.json
  package-lock.json
  tsconfig.json
  vite.config.ts
  index.html
  public/
    manifest.webmanifest
    icons/
    wasm/
  src/
    main.ts
    app/
      routes.ts
      lifecycle.ts
    domain/
      barcode.ts
      checksum.ts
      sequence.ts
      collection.ts
      playback-machine.ts
    application/
      capture-service.ts
      collection-service.ts
      playback-service.ts
      backup-service.ts
    adapters/
      camera/
      decoder/
      renderer/
      persistence/
      input/
      sensors/
      pos/
    ui/
      screens/
      components/
      styles/
    offline/
      service-worker.ts
      update-policy.ts
  tests/
    unit/
    integration/
    browser/
    fixtures/
  docs/
    architecture.md
    requirements.md
    hardware-test-plan.md
    operator-guide.md
    decisions/
```

Die Struktur ist ein Vorschlag, kein bereits geliefertes Repository. Nur tatsächlich benötigte Adapter implementieren. Ein leerer Kassenadapter darf nicht den Eindruck einer vorhandenen Integration erzeugen.

## 23. Teststrategie

### 23.1 Unit-Tests

- Prüfziffer mit unabhängigen bekannten Testvektoren.
- EAN-13 und EAN-8.
- Führende Nullen.
- Ungültige Länge und Zeichen.
- Schrittweite 1, 12 und grösser als Bereich.
- Einwertige Folge.
- Ungültige Breite.
- Präfix/Feld/Suffix zusammen genau zwölf Stellen.
- Überlauf ohne Abschneiden.
- Anzahlbegrenzung.
- Endwert ausserhalb des Schrittrasters.
- Playerpause während Anzeige und Leerphase.
- Späte Timer nach Stopp.

### 23.2 Browser- und Datenprüfungen

- Kamera erlaubt und verweigert.
- Keine passende Kamera.
- Kamerawechsel.
- Bildimport mit einem und mehreren Codes.
- Nicht lesbares Bild.
- Offline-Kaltstart nach Vorbereitung.
- Fehlende WASM-Datei.
- Bibliothek/WASM passen nicht zusammen.
- Speicher voll oder Schreibfehler.
- Export und Wiederimport mit identischen Inhalten.
- Datenmigration.
- Hintergrundwechsel während Wiedergabe.
- Appupdate während Sitzung.

### 23.3 Hardwarematrix

Jede Kombination getrennt protokollieren:

| Feld | Eintrag |
|---|---|
| Scannerhersteller/-modell | offen |
| Handgerät oder stationär | offen |
| Firmware/Konfiguration | soweit zugänglich |
| Kassenprodukt/-version | offen |
| Smartphone | offen |
| Android/Browser | offen |
| Symbologie | EAN-13 / EAN-8 / QR |
| Helligkeit und Ausrichtung | dokumentieren |
| Anzeige-/Leerzeit | dokumentieren |
| Prüfdatensatz | bekannte, freigegebene Werte |
| Tatsächliches Ergebnis | Fehlstellen, Duplikate, Ablehnungen |

### 23.4 Sequenztest an der Kasse

Freigegebene Testfolge, beispielsweise:

A, B, C, A, A, D, E, E, E.

Zusätzlich gezielt einen bekannten unbekannten Testartikel einfügen, sofern der Testbetrieb das erlaubt.

Prüfen:

- Was geschieht am Scanner?
- Was geschieht am Kassendisplay?
- Bleibt das rote Licht an?
- Gibt es ein unterscheidbares Ton- oder LED-Signal?
- Werden weitere Codes während des Dialogs angenommen?
- Gibt es nach Dialogschluss verzögerte Eingaben?
- Stimmen Reihenfolge und Mengen?

### 23.5 Sensorversuch

Handscanner und stationären Scanner separat testen. Für Licht-/Tonerkennung zunächst einen beschrifteten Datensatz sammeln, dann Regeln einstellen und anschliessend neue Versuche verwenden. Ein Schwellenwert, der nur das erste Video richtig erklärt, ist noch kein belastbares Modell.

Relevant sind vor allem gefährliche Fehlfreigaben: Der Sensor meldet bereit, obwohl die Kasse noch blockiert ist. Ein unnötiger Halt ist lästig, eine falsche Freigabe kann den Stapel unbemerkt beschädigen.

### 23.6 Abnahme

Vorgeschlagene Mindestkriterien:

- Keine verlorenen gespeicherten Positionen in Neustarttests.
- Keine stillen Änderungen von EANs oder QR-Inhalten.
- Prüfziffern und führende Nullen bleiben korrekt.
- Keine zusätzliche Ausgabe nach bestätigtem Stopp.
- Keine automatische Buchungsbestätigung aus reinem Timer- oder Sensorsignal.
- Wiederholte gleiche Artikel in der geprüften Konfiguration korrekt behandelt.
- Unklarer Übergabebereich nach Störung sichtbar.
- Backup lässt sich praktisch wiederherstellen.
- Dokumentiertes Standardprofil für jeden produktiven Scanner.

Ein kleiner fehlerfreier Versuch ist kein Nachweis fehlerfreier beliebig langer Nutzung. Langzeittests und Reserve gegenüber der schnellsten gerade noch funktionierenden Einstellung einplanen.

## 24. Risikoregister

| Risiko | Wirkung | Gegenmassnahme |
|---|---|---|
| Unbekannter Artikel | Dialog stoppt fachlichen Ablauf | Artikelstamm, Pause, Abgleich |
| Player läuft im Dialog weiter | Fehlende oder unklare Positionen | Externer Stopp, Kleinstapel, Rückkanal |
| Gleicher Code wird unterdrückt | Menge zu klein | Leerphase und Hardwaretests |
| Daueranzeige wird erneut gelesen | Menge zu gross | Bei Pause ausblenden |
| Falsches EAN-Zählen | Ungültige oder fachlich andere Codes | Nutzdatenfeld und Prüfziffer trennen |
| Nummernbereich enthält Preis/Gewicht | Falsche Buchung | Stellenbedeutung vorab klären |
| Lichtsignal falsch interpretiert | Falsches Weiterlaufen | Nur konservative Pause, keine Buchungsbestätigung |
| Display nach unten | Stopp schlecht erreichbar | Bedienkonzept vor Automatik lösen |
| Browserspeicher gelöscht | Sammlungen verloren | Persistenzanfrage und Backup |
| Externe WASM-Abhängigkeit | Offlineerkennung fällt aus | Versionierte lokale Datei |
| Unbekannter QR-Inhalt | Falsche Aktion oder Datenabfluss | Nur Daten anzeigen, keine Autoausführung |
| Automatisches Wiederholen nach Fehler | Doppelbuchung | Unklare Positionen manuell abgleichen |
| PC-Helfer tippt ins falsche Feld | Falsche Eingaben | Freigabe, Fokusprüfung, offizielle Schnittstelle bevorzugen |

## 25. Entwicklungsfahrplan

### Phase 0: Hardware und Fachschema klären

- Modelle beider Scanner aufnehmen.
- Kassenprodukt bestimmen.
- Gültige Testartikel zusammenstellen.
- Beispieletiketten mit vollständigen Ziffern untersuchen.
- Stellenbedeutung von 2063701... klären.
- Verhalten während Fehlerdialogen beobachten.

### Phase 1: Kontrollierter MVP

- PWA-Grundgerüst.
- Lokale Datenhaltung.
- Kamera- und Bildimport.
- EAN-13, EAN-8 und Text-QR.
- Einzelgenerator.
- Sammlungen.
- Manueller Player.
- Backup und Wiederherstellung.

### Phase 2: Automatik

- Zustandsautomat.
- Anzeige-/Leerzeit.
- Startverzögerung.
- Mengenwiederholungen.
- Nummernvorlagen.
- Wiederaufnahme und Unsicherheitsbereich.
- Offlinehärtung.

### Phase 3: Betriebsreife

- Getestete Scannerprofile.
- Bedienung bei verdecktem Display.
- Kleinstapel und Artikelstammprüfung.
- Hardware- und Störungstests.
- Mitarbeitenden-Anleitung.

### Phase 4: Rückkanal untersuchen

- Zunächst prüfen, ob offizielle Kassenintegration möglich ist.
- Parallel optional Frontkamera-/Mikrofonmessung als getrenntes Experiment.
- Nur bei erwiesener Zuverlässigkeit Sensorautomatik zur Pause nutzen.
- Native Android-App erst bei konkret belegten PWA-Grenzen.

Keine belastbare Aufwands- oder Kostenschätzung ohne Hardwaredaten, endgültigen Funktionsumfang und Integrationsmöglichkeiten. Der lokale MVP ist ein anderes Projektvolumen als eine geschäftskritische Kassenintegration.

## 26. Entscheidungsprotokoll

### ADR-01: PWA als Ausgangspunkt

Entscheidung: TypeScript-Webanwendung mit lokalem Fachkern.

Grund: Grundfunktionen sind mit Browserkamera, lokalen Bibliotheken und Browserspeicher darstellbar. [web:34][web:70][web:35][web:52]

Umkehrkriterium: Reproduzierbare, für den Betrieb relevante Grenzen bei Kamera, Bedienung oder Geräteintegration.

### ADR-02: Kein Video als Produktionsplayer

Entscheidung: Codes einzeln rendern und zustandsgeführt wechseln.

Grund: Unterbrechbarkeit, Fortschrittskontrolle und gezielte Wiederaufnahme sind im berichteten Versuch die zentrale fehlende Fähigkeit.

### ADR-03: Kein „gebucht“ ohne definierten Nachweis

Entscheidung: Angezeigt, vom Bediener bestätigt und von der Kasse angenommen sind unterschiedliche Ereignisse.

Grund: Scanner-Dekodierung und Kassenverarbeitung sind unterschiedliche Ebenen. [web:13]

### ADR-04: EAN-Prüfziffer ist abgeleitet

Entscheidung: Sequenzen verändern ausschliesslich freigegebene Nutzdatenfelder; die letzte Stelle wird neu berechnet.

Grund: GS1-Prüfziffernregeln. [web:60][web:65]

### ADR-05: Sensorik zunächst nur beobachtend

Entscheidung: Licht-/Tonerkennung wird nicht als notwendige Voraussetzung für Version 1 eingeplant.

Grund: Zusammenhang zwischen sichtbarem Signal und Kassenbereitschaft ist unbekannt; Hersteller zeigen geräte- und modusabhängiges Beleuchtungsverhalten. [web:13]

## 27. Schlussfolgerung

Die Grundidee ist technisch gut begründet, und der Nutzer hat die optische Displayübergabe für seine Testanordnung bereits praktisch erprobt. Der Schwerpunkt verschiebt sich damit von „Kann ein Scanner vom Smartphone lesen?“ zu „Wie bleibt der Stapel trotz unbekannter Artikel und Fehlerdialoge kontrollierbar?“.

Eine kleine lokale PWA ist der empfohlene Start. Sie soll EAN-13, EAN-8 und QR unterstützen, Inhalte unverändert speichern, Prüfziffern korrekt behandeln, Nummernvorlagen transparent aufbauen und die Ausgabe jederzeit sicher ausblenden können.

Für das konkrete Muster 20637010289XY ist besonders wichtig: Bei EAN-13 ist Y die berechnete Prüfziffer. Zwei frei hochzählbare letzte Stellen sind in dieser 13-stelligen Form nicht möglich. Schrittweiten wie zwölf gehören auf ein entsprechend breites Nutzdatenfeld, nicht auf die vollständige EAN.

Die Frontkamera-Idee verdient einen eigenen Messprototyp, aber keinen Vertrauensvorschuss als Buchungsrückmeldung. Ein Lichtwechsel kann ein nützliches Signal sein; erst eine belegte gerätespezifische Zuordnung oder eine geeignete Kassenschnittstelle macht daraus eine verwertbare Zustandsaussage.

Die sinnvollste nächste Entwicklungsstufe ist daher ein kontrollierbarer Player mit Sammlungen, manueller Fehlerbehandlung und belastbarem Testprotokoll – nicht maximale Geschwindigkeit und nicht ungeprüfte Sensorautomatik.
