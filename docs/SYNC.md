# Trasso – Abgleich mit der Desktop-App (Format v1)

Stand: Vorbereitung. Die iPhone-App kann Sync-Pakete schreiben und lesen; die Desktop-App gibt es noch nicht.
Dieses Dokument ist die Vorgabe, nach der sie gebaut wird.

## Transportweg

Heute per **Datei**: Die App erstellt ein Sync-Paket (`Trasso-Sync_<Gerät>_<JJJJMMTT>_<HHMM>.json`).
Es geht über das Teilen-Menü (OneDrive, iCloud Drive, AirDrop, Mail) oder per USB zum PC. Die Desktop-App
liest es ein und kann selbst ein Paket mit ihren Änderungen zurückgeben, das in der App unter
*Profil → Desktop-Abgleich → Paket einlesen* übernommen wird.

Später ist ein direkter Abgleich möglich (`src/sync/sync.ts`, Schnittstelle `SyncAdapter`). Dabei gilt:
Die App läuft unter `https://sufflaki.github.io/…`. Browser blockieren von dort Aufrufe an `http://` im lokalen Netz
(Mixed Content). Ein Desktop-Server bräuchte also HTTPS mit einem Zertifikat, dem das iPhone vertraut, oder
einen Umweg über einen gemeinsamen Cloud-Dienst. Inhalt und Regeln der Pakete bleiben gleich.

## Paket (JSON)

```jsonc
{
  "format": "trasso-sync",
  "version": 1,                       // höhere Versionen lehnt die App ab („bitte aktualisieren“)
  "createdAt": 1760360000000,         // ms seit 1970
  "source": {
    "deviceId": "dev_…",              // stabile ID des Absenders; die App lehnt eigene Pakete ab
    "deviceName": "iPhone",
    "app": "Trasso",                  // Desktop schreibt "Trasso Desktop"
    "appVersion": "1.5"
  },
  "changesOnly": true,                // nur Änderungen seit dem letzten Abgleich des Absenders
  "inspections": [
    {
      "inspection": { /* Inspection, siehe src/model/types.ts – unverändert übernehmen */ },
      "photos": [ { "id": "f_…", "full": "<Base64 JPEG>", "thumb": "<Base64 JPEG>" } ],
      "plans":  [ { "id": "pl_…", "image": "<Base64>", "type": "image/jpeg" } ]
    }
  ],
  "projects": [ /* Project[] – vollständige Liste, Upsert per id */ ],
  "deleted":  [ { "id": "i_…", "deletedAt": 1760350000000 } ]
}
```

* Alle IDs sind global eindeutig (`uid()` in `src/model/factory.ts`). Die Desktop-App darf keine IDs ändern,
  außer beim Anlegen von Konflikt-Kopien.
* `inspection.updatedAt` (ms) ist der Änderungsstand. Wer eine Begehung ändert, setzt ihn auf „jetzt“.
* Eine Begehung wird immer **vollständig** übertragen (alle Fotos/Pläne). Fotos, die in `inspection.photos` fehlen,
  sind gelöscht.
* Unbekannte Felder in `inspection` unverändert mitführen (die App wird weiterentwickelt).
* Standortangaben: `position` = WGS84 (`lat`, `lng`, `accuracy` in m), `address` = Adresse aus OpenStreetMap
  (kann fehlen und wird nachgetragen, sobald online).

## Regeln beim Einlesen (beide Seiten gleich)

Jede Seite merkt sich je Begehung den `updatedAt`-Stand des letzten Abgleichs (`synced[id]`, App: `src/sync/syncState.ts`).

| Lage | Ergebnis |
|---|---|
| Begehung gibt es lokal nicht | übernehmen |
| nur die Gegenseite hat geändert (`remote.updatedAt > synced`, lokal nicht) | Gegenseite übernimmt, Fotos/Pläne ersetzen |
| nur lokal geändert bzw. Gegenseite unverändert | lokale Fassung bleibt |
| beide geändert | **nichts überschreiben**: Gegenseite als Kopie mit neuen IDs und dem Zusatz „(Desktop-Fassung)“ bzw. „(iPhone-Fassung)“ anlegen |
| `deleted` enthält die Begehung | löschen – außer sie wurde lokal nach dem letzten Abgleich und nach `deletedAt` geändert, dann behalten und melden |

Nach dem Einlesen bzw. Erstellen eines Pakets gilt die übertragene Fassung als abgeglichen (`synced[id] = updatedAt`).
Gelöschte Begehungen werden 180 Tage lang als Grabstein gemerkt.

## Was (noch) nicht im Paket ist

Einstellungen, PDF-Vorlagen, erzeugte PDF-Berichte und die Warteschlange für KI-Auswertungen bleiben auf dem Gerät.
