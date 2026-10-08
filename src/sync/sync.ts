// Schnittstelle für einen späteren Server-Abgleich (mehrere Geräte/Benutzer).
//
// Aktuell: LocalOnlySync – nichts verlässt das Gerät. Für einen Server wird eine
// Klasse implementiert, die Begehungen + Fotos hoch-/herunterlädt (z. B. REST mit
// Login-Token), und in getSync() zurückgegeben. Konflikte lassen sich über
// Inspection.updatedAt bzw. eine Versionsnummer pro Objekt auflösen; jedes Objekt
// hat bereits eine global eindeutige ID.

import type { Inspection } from '../model/types';

export interface SyncAdapter {
  readonly label: string;
  /** true = Daten werden mit einem Server abgeglichen */
  readonly remote: boolean;
  push(insp: Inspection): Promise<void>;
  pull(since: number): Promise<Inspection[]>;
}

class LocalOnlySync implements SyncAdapter {
  readonly label = 'Nur auf diesem Gerät';
  readonly remote = false;
  async push() { /* nichts zu tun */ }
  async pull() { return []; }
}

const adapter: SyncAdapter = new LocalOnlySync();

export function getSync(): SyncAdapter {
  return adapter;
}
