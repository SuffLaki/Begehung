# Begehungsprotokoll – Technische Dokumentation

iPhone-Web-App (PWA) für digitale Begehungsprotokolle von Trassenbegehungen.
Alles läuft im Browser auf dem Gerät; es gibt (noch) keinen Server.

## Tech-Stack

| Bereich | Lösung |
|---|---|
| UI | React 19 + TypeScript, eigenes CSS-Designsystem (iOS-Stil, Hell/Dunkel) |
| Build | Vite, `vite-plugin-pwa` (Service Worker, Manifest, Offline-Cache) |
| State | Zustand (`state/`), Undo/Redo über Schnappschüsse der Begehung |
| Speicher | IndexedDB über `idb` (`storage/db.ts`) |
| Karte | Leaflet + OpenStreetMap / Esri-Luftbild (`map/`) |
| PDF | pdf-lib (Erzeugung, Vorlagen als Hintergrund), pdf.js (Vorschau) |
| KI | Google Gemini per REST, gekapselt hinter `AiProvider` (`ai/`) |
| Icons | lucide-react |

## Projektstruktur

```
src/
├── model/        Datenmodell (types.ts), Fabriken, Rollen/Rechte
├── storage/      IndexedDB (db.ts), Sicherung Export/Import (backup.ts)
├── state/        App-Zustand (Einstellungen, Toasts, Dialoge), Begehung + Undo/Redo + Autosave
├── geo/          Geometrie (geo.ts), GPS + Aufzeichnung (gps.ts), Trassen-Editor-Logik (routeOps.ts)
├── map/          Kartenanbieter (providers.ts), Leaflet-Karte (RouteMap.tsx), PDF-Kartenbild (staticMap.ts)
├── camera/       Foto aufnehmen/verkleinern, Foto-URLs
├── speech/       WAV-Aufnahme, regelbasierte Auswertung (parsers.ts)
├── ai/           KI-Schnittstelle + Prompts + Prüfung (ai.ts), Gemini (gemini.ts)
├── pdf/          Layout-Engine (layout.ts), Protokoll (generator.ts), Vorschau (preview.ts)
├── share/        Teilen / E-Mail
├── sync/         Warteschlange für Offline-Sprachaufnahmen (jobs.ts), Sync-Schnittstelle (sync.ts)
├── ui/           UI-Bausteine (kit.tsx), Unterschriftenfeld
└── screens/      Bildschirme; inspection/ = Begehungsansicht mit Tabs und Sheets
```

## Datenmodell

```
Project
 └── Inspection
      ├── meta            Projekt, Nummern, Datum/Uhrzeit, Begeher, Auftraggeber, …
      ├── route
      │    ├── points     RoutePoint  (Trassenpunkte + Markierungen)
      │    ├── segments   RouteSegment (geordnete Punkt-IDs, Farbe, Name)
      │    └── tracks     GpsTrack    (Rohdaten der GPS-Aufzeichnung)
      ├── notes           Note (Notiz oder Beobachtung: Station, Kategorie, Hinweis, Original-Transkript)
      ├── photos          PhotoMeta (Bilddaten separat im Store „photos“)
      ├── tasks           Task
      ├── summary         Zusammenfassung (manuell/KI, muss bestätigt werden)
      ├── signature       Unterschrift
      └── pdfSettings     Vorlage, Inhalte, Kartenausschnitt/-art, Darstellungsoptionen
```

* Jedes Objekt hat eine eindeutige ID (`uid()`).
* Referenzen nur in eine Richtung: Foto → Punkt/Notiz, Notiz → Punkt, Segment → Punkt-IDs.
  Ein Punkt kann in mehreren Segmenten vorkommen (Abzweig).
* `RoutePoint.source`: `gps | voice | manual | auto`, `confirmed: false` = „automatisch ermittelt“.
  Geschätzte Punkte tragen `estimate` (Originaltext, Bezugspunkt, Richtung, Entfernung).
* `position: null` = Punkt ohne Position (z. B. Sprache ohne Entfernungsangabe).
* Weitere IndexedDB-Stores: `templates` (PDF-Vorlagen inkl. Datei), `reports` (erstellte PDFs),
  `jobs` (Offline-Sprachaufnahmen), `settings`, `projects`.

## GPS

* Geolocation-API, `watchPosition` mit `enableHighAccuracy`. Vor der ersten Nutzung erklärt die App,
  wofür sie den Standort braucht; danach fragt iOS selbst.
* Jede Position hat eine Genauigkeit (±m). Sie wird angezeigt und an Punkten/Fotos gespeichert.
* **Aufzeichnung:** Messungen schlechter als die eingestellte Grenze (Standard ±30 m) werden verworfen,
  Bewegungen innerhalb des Messrauschens ignoriert. Pause/Fortsetzen/Beenden, Zeit ohne Pausen.
  „In Trasse übernehmen“ vereinfacht die Spur (Douglas-Peucker, 4 m) zu einem bearbeitbaren Abschnitt.
* Screen Wake Lock hält das Display an (iOS ≥ 16.4); bei gesperrtem Bildschirm liefert iOS keine Positionen.

## Karte

* Leaflet ist nur in `map/RouteMap.tsx` eingebunden. Datenmodell, Editor-Logik (`geo/routeOps.ts`) und
  PDF-Kartenbild sind unabhängig davon → Kartenbibliothek austauschbar.
* Kartenanbieter stehen ausschließlich in `map/providers.ts` (URL, Attribution, max. Zoom, Platz für API-Key):
  Straßenkarte = OpenStreetMap, Satellit = Esri World Imagery, Hybrid = Luftbild + Esri-Beschriftungen.
* Editor: Punkte ziehen (Linien folgen live), Punkte anhängen, Linie antippen = Punkt einfügen,
  Abschnitt teilen/verbinden/umdrehen/einfärben, Abzweig ab Punkt, Markierungen mit Symbol,
  Nummerierung neu vergeben, Undo/Redo (60 Schritte).
* Offline: Der Service Worker speichert jede angesehene Kachel (bis 6000 Kacheln, 60 Tage).

## Spracheingabe

1. **Aufnahme-Taste**: WAV 16 kHz (AudioContext). Mit KI → Gemini transkribiert und strukturiert in einem Aufruf.
   Ohne Netz → Aufnahme in `jobs`, Auswertung automatisch bei Verbindung („ausstehend“-Anzeige),
   Ergebnis als unbestätigte Notiz.
2. **Tastatur-Diktat** von iOS ins Textfeld → lokale Auswertung (`speech/parsers.ts`) oder KI.

Lokaler Parser erkennt: Himmelsrichtungen, links/rechts/halb links/geradeaus, Entfernungen (m/km, Zahlwörter),
„ungefähr“, „bis zum …“, „entlang des …“, Stationen, Kategorien, Prüf-Hinweise („muss“, „wahrscheinlich“ …).
Trassenpunkte werden per Koppelnavigation ab einem Bezugspunkt geschätzt und als „automatisch ermittelt“
markiert. Fehlt Richtung oder Entfernung, wird **keine** Position erfunden – der Punkt bleibt ohne Position.

## KI

* `ai/ai.ts` definiert `AiProvider` (voiceNote, structureNote, voiceRoute, parseRoute, describePhoto, summarize).
  Neuer Anbieter = neue Klasse + Eintrag in `getAi()`. Schlüssel kommt aus den Einstellungen (Platzhalter leer).
* Prompts verbieten Erfinden. Zusätzlich technische Absicherung: Entfernungen/Stationen aus der KI-Antwort,
  die nicht im Originaltext vorkommen, werden verworfen (`guardLegs`, `guardNote`); Kategorien nur aus der Liste.
* Alle KI-Ergebnisse sind Vorschläge (editierbar, `confirmed: false` bzw. Bestätigung im Dialog).
  Zusammenfassungen kommen nur bestätigt ins PDF.
* Datenschutz: Fotos/Audio nur nach Freigabe in den Einstellungen; GPS-Koordinaten werden nie an die KI gesendet.

## Straßen, Hausnummern, Kreuzungen (Adresssuche)

* `places/placeParser.ts` erkennt im Text Straßennamen (Endungen wie -straße, -weg, -gasse … sowie „Am …“, „Neue Straße“),
  Hausnummern, „Kreuzung/Ecke X und Y“, „von … bis …“, „entlang der …“ und die Linienart (Tiefbau, Leerrohr …).
* `places/osm.ts`: Nominatim (Adresse → Koordinate, Straßengeometrie; max. 1 Anfrage/s, Cache), Kreuzung =
  nächste Annäherung beider Straßenlinien (< 25 m), Verlauf über routing.openstreetmap.de (Fußweg-Profil).
  Gesucht wird im Umkreis von ca. 8 km um den letzten Punkt/GPS, sonst mit dem Ort aus „Baustelle / Bereich“.
* `places/resolve.ts`: legt pro Stück einen farbigen Abschnitt an (Farbe/Name aus der Linienart), Start/Ziel als
  benannte Punkte, Routing-Zwischenpunkte als Stützpunkte (`vertex`). Alles `confirmed: false`.
  Hausnummer nicht im Kartenbestand → „nur Straße gefunden“ wird angezeigt; nicht gefundene Orte werden nicht eingezeichnet.
* Foto-Linien: derselbe Erkenner liefert den Ort für die Beschriftung („Leerrohr – Olgastraße 100“) und ordnet
  das Foto auf Wunsch dem nächsten Trassenpunkt (≤ 30 m) zu bzw. verortet es (`positionSource: 'address'`).
* Abschaltbar in den Einstellungen (Adresssuche). Funktioniert nur online.

## Foto-Markierungen (Linien)

* `PhotoMeta.annotations`: Polylinien normiert auf 0..1, mit Linienart und Beschriftung; das Originalfoto bleibt unverändert.
* Linienarten (`Settings.lineTypes`): Name, Farbe, Schlüsselwörter. Standard: Tiefbau = rot,
  Bestandsrohr/Leerrohr = blau. In den Einstellungen erweiterbar.
* Editor (`screens/inspection/AnnotateSheet.tsx`): Wort tippen oder sprechen → Linienart wird gewählt
  (`annotate/lines.ts → matchLineTypes`), Verlauf mit dem Finger (Freihand/Gerade).
  Optional KI-Vorschlag (`AiProvider.suggestLines`), gestrichelt, muss übernommen werden; unbekannte Arten
  und Koordinaten außerhalb des Bildes werden verworfen.
* Anzeige per SVG (`annotate/AnnotationLayer.tsx`), im PDF werden die Linien ins Foto gezeichnet
  (`drawAnnotations`) und als Legende unter das Foto geschrieben.

## PDF

* `pdf/layout.ts`: Seitenaufbau mit pdf-lib, freier Inhaltsbereich = Vorlagenränder (mm), Textumbruch,
  automatischer Seitenumbruch, Zeichenbereinigung für die Standardschrift.
* `pdf/generator.ts`: Deckblatt → Übersichtskarte + Legende → Begehungspunkte (mit Fotos, Notizen) →
  Beobachtungen/Notizen → weitere Fotos → Koordinatenliste → Abschluss (Zusammenfassung, offene Punkte,
  Aufgaben, Unterschriften). Kopf-/Fußzeilen und „Seite x von y“ am Ende.
* Kartenbild (`map/staticMap.ts`): lädt Kacheln des gewählten Kartentyps in ein Canvas (2× Auflösung),
  zeichnet Trasse, Punkte, Nummern, Fotos, Markierungen, Maßstab, Nordpfeil, Quellenangabe selbst.
  Ausschnitt/Zoom wählt der Nutzer im Assistenten auf einer Mini-Karte (4:3 wie im PDF).
  Offline ohne Kacheln: Trasse auf Raster + Hinweis.
* Vorschau: pdf.js rendert jede Seite als Bild (iOS zeigt PDFs im iframe nur unzuverlässig).

## Eigene PDF-Hintergründe

* Upload einer PDF (z. B. Briefbogen) oder eines Bildes unter „Vorlagen“.
* PDF: Seiten werden mit `embedPdf` als Vektor-Hintergrund unter jede Seite gelegt; eigene Seite für
  Deckblatt und Folgeseiten wählbar. Bild: wird auf A4 gelegt (HEIC/PNG → JPEG).
* Der freie Inhaltsbereich (Ränder in mm) wird mit Live-Vorschau eingestellt; eigene Kopf-/Fußzeile
  und Seitenzahlen lassen sich abschalten, wenn die Vorlage sie schon enthält.
* Verschlüsselte/geschützte PDFs werden beim Hochladen erkannt und abgelehnt.

## Rollen

`model/permissions.ts`: Admin / Mitarbeiter / Lesender Benutzer mit Rechte-Matrix; die UI fragt nur `can()`.
Ohne Login ist die Rolle eine lokale Einstellung. Ein späterer Login liefert Benutzer + Rolle, ohne UI-Umbau.

## Synchronisierung

Es gibt keinen Server. `sync/sync.ts` definiert `SyncAdapter` (push/pull); aktiv ist `LocalOnlySync`.
Bis dahin: Sicherung pro Begehung als Datei (inkl. Fotos) exportieren/importieren.

## Echte Browser-/iOS-Einschränkungen

| Funktion | Einschränkung | Umsetzung in der App |
|---|---|---|
| Kamera, Mikrofon, GPS | nur über HTTPS + Freigabe | Hosting über HTTPS (GitHub Pages), Erklär-Dialog vor der Systemabfrage |
| GPS im Hintergrund | Web-Apps bekommen bei gesperrtem Bildschirm/im Hintergrund keine Positionen | Wake Lock, deutlicher Hinweis, Aufzeichnung pausiert sichtbar |
| E-Mail mit Anhang | `mailto:` kann keine Anhänge | iOS-Teilen-Menü → Mail (PDF angehängt, Text drin, Empfänger aus Zwischenablage einfügen) oder mailto-Entwurf ohne Anhang |
| Spracherkennung | Web Speech API in Home-Bildschirm-Apps unzuverlässig | eigene WAV-Aufnahme + KI, oder iOS-Tastatur-Diktat |
| Offline-Karten | kein Vorab-Download ganzer Gebiete (OSM-Nutzungsregeln) | angesehene Kacheln werden gespeichert; PDF-Karte offline nur Geometrie |
| Speicher | iOS kann Daten nicht genutzter Web-Apps löschen; Kontingent begrenzt | `navigator.storage.persist()`, Fotos auf 2048 px verkleinert, Sicherungsexport |
| Verschlüsselung | keine sichere Schlüsselablage im Browser ohne Passwort-Eingabe | Daten liegen im App-Speicher, durch die iOS-Gerätesperre verschlüsselt; App-PIN wäre nächster Ausbauschritt |
| Adresssuche | braucht Internet; OSM-Daten können lückenhaft sein (fehlende Hausnummern) | Status je Ort sichtbar, nichts wird geraten |
| Hintergrund-Sync | iOS unterstützt Background Sync nicht | Warteschlange wird beim Öffnen/Online-Werden abgearbeitet |

## Entwicklung

```
npm install
npm run dev       # Entwicklungsserver
npm run build     # Produktions-Build nach dist/
npm run preview   # Build lokal testen
```

Bereitstellung: Inhalt von `dist/` auf einen HTTPS-Webspace (z. B. GitHub Pages) kopieren.
`base: './'` in `vite.config.ts` → funktioniert in jedem Unterordner.
