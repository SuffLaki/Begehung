// Zugriff auf die Kartenkacheln, die der Service Worker zwischengespeichert hat
// (Cache „map-tiles“, siehe vite.config.ts). Im Offline-Modus lädt die Karte nur von hier.

import L from 'leaflet';

export const TILE_CACHE = 'map-tiles';

export async function cachedTile(url: string): Promise<Blob | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const c = await caches.open(TILE_CACHE);
    const r = (await c.match(url)) ?? (await c.match(url, { ignoreVary: true, ignoreSearch: false }));
    return r ? await r.blob() : null;
  } catch {
    return null;
  }
}

/** Kachel-Ebene, die nichts aus dem Netz lädt – nur bereits gespeicherte Kacheln */
export const CacheOnlyTileLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback) {
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('role', 'presentation');
    const url = this.getTileUrl(coords);
    void cachedTile(url).then((blob) => {
      if (!blob) { done(new Error('Kachel nicht offline gespeichert'), img); return; }
      const obj = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(obj); done(undefined, img); };
      img.onerror = () => { URL.revokeObjectURL(obj); done(new Error('Kachel defekt'), img); };
      img.src = obj;
    });
    return img;
  },
}) as unknown as new (url: string, opts?: L.TileLayerOptions) => L.TileLayer;
