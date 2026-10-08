// OpenStreetMap-Dienste für Adressen und Straßenverläufe.
//
//  * Nominatim (nominatim.openstreetmap.org): Adresse → Koordinate, Straßengeometrie.
//    Nutzungsregeln: max. 1 Anfrage/Sekunde, keine Massenabfragen → Warteschlange + Cache.
//  * Routing (routing.openstreetmap.de, Profil Fußweg): Verlauf entlang des Wegenetzes.
//  * Kreuzungen: aus den Straßengeometrien beider Straßen berechnet (nächste Annäherung < 25 m).
//
// Übertragen werden nur Straßennamen/Hausnummern und der Kartenausschnitt der Suche –
// keine Projektdaten. Daten © OpenStreetMap-Mitwirkende (ODbL).

import type { LatLng } from '../model/types';
import { distance, distanceToSegment } from '../geo/geo';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';

export interface Bbox { west: number; south: number; east: number; north: number }

export function bboxAround(p: LatLng, km = 8): Bbox {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((p.lat * Math.PI) / 180));
  return { west: p.lng - dLng, east: p.lng + dLng, south: p.lat - dLat, north: p.lat + dLat };
}

// ---------------------------------------------------------------- Warteschlange (1 Anfrage/s)

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
const cache = new Map<string, unknown>();

function throttled<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
  const run = async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const v = await fn();
    cache.set(key, v);
    return v;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

async function getJson<T>(url: string): Promise<T> {
  if (!navigator.onLine) throw new Error('Keine Internetverbindung – Adressen können nur online gesucht werden.');
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept-Language': 'de' } });
    if (res.status === 429) throw new Error('Adressdienst ausgelastet – bitte kurz warten und erneut versuchen.');
    if (!res.ok) throw new Error(`Adressdienst-Fehler ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Adressdienst antwortet nicht (Zeitüberschreitung).');
    throw e;
  } finally {
    window.clearTimeout(t);
  }
}

interface NominatimHit {
  lat: string;
  lon: string;
  type: string;
  addresstype?: string;
  display_name: string;
  address?: { road?: string; house_number?: string; city?: string; town?: string; village?: string; suburb?: string };
  geojson?: { type: string; coordinates: unknown };
}

function search(params: Record<string, string>, box: Bbox | null, city: string): Promise<NominatimHit[]> {
  const p = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', countrycodes: 'de,at,ch', ...params });
  if (box) {
    p.set('viewbox', `${box.west},${box.north},${box.east},${box.south}`);
    p.set('bounded', '1');
  }
  if (city && p.has('q')) p.set('q', `${p.get('q')}, ${city}`);
  const url = `${NOMINATIM}?${p}`;
  return throttled(url, () => getJson<NominatimHit[]>(url));
}

export interface GeoResult {
  pos: LatLng;
  /** 'house' = Hausnummer gefunden, 'street' = nur Straße (Lage ungenau) */
  precision: 'house' | 'street' | 'intersection';
  label: string;
}

const norm = (s: string) => s.toLowerCase().replace(/str\.?$/, 'straße').replace(/strasse/g, 'straße').replace(/[^a-zäöüß0-9]/g, '');

export async function geocodeAddress(street: string, number: string, box: Bbox | null, city = ''): Promise<GeoResult | null> {
  const hits = await search({ q: `${street} ${number}`, limit: '3' }, box, city);
  const house = hits.find((h) => h.address?.house_number && norm(h.address.house_number) === norm(number) && norm(h.address.road ?? street) === norm(street));
  if (house) return { pos: { lat: +house.lat, lng: +house.lon }, precision: 'house', label: `${street} ${number}` };
  const road = hits.find((h) => norm(h.address?.road ?? '') === norm(street)) ?? null;
  if (road) return { pos: { lat: +road.lat, lng: +road.lon }, precision: 'street', label: street };
  return null;
}

export async function geocodeStreet(street: string, box: Bbox | null, city = ''): Promise<GeoResult | null> {
  const hits = await search({ q: street, limit: '3' }, box, city);
  const road = hits.find((h) => norm(h.address?.road ?? h.display_name.split(',')[0]) === norm(street)) ?? hits[0];
  return road ? { pos: { lat: +road.lat, lng: +road.lon }, precision: 'street', label: street } : null;
}

/** alle Teilstücke (Linien) einer Straße im Suchbereich */
export async function streetLines(street: string, box: Bbox | null, city = ''): Promise<LatLng[][]> {
  const hits = await search({ q: street, limit: '40', dedupe: '0', polygon_geojson: '1', polygon_threshold: '0.00001' }, box, city);
  const lines: LatLng[][] = [];
  for (const h of hits) {
    if (norm(h.address?.road ?? h.display_name.split(',')[0]) !== norm(street)) continue;
    const g = h.geojson;
    if (!g) continue;
    const toLL = (c: [number, number][]) => c.map(([lng, lat]) => ({ lat, lng }));
    if (g.type === 'LineString') lines.push(toLL(g.coordinates as [number, number][]));
    if (g.type === 'MultiLineString') (g.coordinates as [number, number][][]).forEach((c) => lines.push(toLL(c)));
  }
  return lines;
}

/** Kreuzung zweier Straßen = Stelle, an der sich die Straßenlinien am nächsten kommen (< 25 m) */
export async function intersection(a: string, b: string, box: Bbox | null, city = ''): Promise<GeoResult | null> {
  const [la, lb] = [await streetLines(a, box, city), await streetLines(b, box, city)];
  let best: { d: number; p: LatLng } | null = null;
  for (const A of la) for (const p of A) for (const B of lb) {
    for (let i = 0; i < B.length - 1; i++) {
      const { d, t } = distanceToSegment(p, B[i], B[i + 1]);
      if (!best || d < best.d) best = { d, p: { lat: B[i].lat + (B[i + 1].lat - B[i].lat) * t, lng: B[i].lng + (B[i + 1].lng - B[i].lng) * t } };
    }
    if (B.length === 1) {
      const d = distance(p, B[0]);
      if (!best || d < best.d) best = { d, p: B[0] };
    }
  }
  if (!best || best.d > 25) return null;
  return { pos: best.p, precision: 'intersection', label: `Kreuzung ${a} / ${b}` };
}

/** Verlauf entlang des Wegenetzes (Fußweg-Profil, folgt Straßen und Wegen) */
export async function routeAlong(from: LatLng, to: LatLng): Promise<LatLng[] | null> {
  const url = `${ROUTER}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const r = await throttled(url, () => getJson<{ code: string; routes?: { geometry: { coordinates: [number, number][] }; distance: number }[] }>(url));
    const route = r.routes?.[0];
    if (r.code !== 'Ok' || !route) return null;
    // Umwege (> 2,5 × Luftlinie) nicht verwenden – dann lieber gerade Linie
    if (route.distance > 2.5 * distance(from, to) + 50) return null;
    return route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  } catch {
    return null;
  }
}
