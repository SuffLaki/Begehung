// Adresse zu Fotos/Mängeln nachtragen (nur online und wenn die Adresssuche erlaubt ist).
// Läuft im Hintergrund – die Aufnahme selbst wartet nie darauf.

import type { LatLng } from '../model/types';
import { useApp, isOnline } from '../state/appStore';
import { useInspection } from '../state/inspectionStore';
import { reverseGeocode } from './osm';

export function addressAllowed(): boolean {
  return isOnline() && useApp.getState().settings.placeSearch !== false;
}

export function enrichAddress(target: 'photo' | 'note', id: string, pos: LatLng | null | undefined) {
  if (!pos || !addressAllowed()) return;
  void reverseGeocode(pos).then((addr) => {
    if (!addr) return;
    useInspection.getState().mutate((d) => {
      const x = target === 'photo' ? d.photos.find((f) => f.id === id) : d.notes.find((n) => n.id === id);
      if (x && !x.address) x.address = addr;
    }, { undoable: false });
  }).catch(() => undefined);
}

let filling = false;

/** Fehlende Adressen der geöffneten Begehung nachtragen (z. B. nach Aufnahme im Funkloch). */
export async function fillMissingAddresses(): Promise<void> {
  if (filling || !addressAllowed()) return;
  const insp = useInspection.getState().insp;
  if (!insp) return;
  filling = true;
  try {
    const todo: { target: 'photo' | 'note'; id: string; pos: LatLng }[] = [
      ...insp.photos.filter((f) => f.position && !f.address && f.positionSource !== 'address').map((f) => ({ target: 'photo' as const, id: f.id, pos: f.position! })),
      ...insp.notes.filter((n) => n.position && !n.address).map((n) => ({ target: 'note' as const, id: n.id, pos: n.position! })),
    ].slice(0, 30);
    for (const t of todo) {
      if (!addressAllowed() || useInspection.getState().insp?.id !== insp.id) break;
      const addr = await reverseGeocode(t.pos).catch(() => null);
      if (!addr) continue;
      useInspection.getState().mutate((d) => {
        const x = t.target === 'photo' ? d.photos.find((f) => f.id === t.id) : d.notes.find((n) => n.id === t.id);
        if (x && !x.address) x.address = addr;
      }, { undoable: false });
    }
  } finally {
    filling = false;
  }
}

if (typeof window !== 'undefined') window.addEventListener('trasso:online', () => void fillMissingAddresses());
