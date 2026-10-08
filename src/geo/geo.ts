// Reine Geometrie-Funktionen (keine Abhängigkeit zur Kartenbibliothek).

import type { LatLng, Route, RoutePoint, TrackFix } from '../model/types';

const R = 6371008.8; // mittlerer Erdradius in m
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distance(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Richtung von a nach b in Grad (0 = Nord, 90 = Ost) */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Punkt in gegebener Richtung und Entfernung */
export function destination(from: LatLng, bearingDeg: number, distM: number): LatLng {
  const d = distM / R;
  const b = rad(bearingDeg);
  const lat1 = rad(from.lat);
  const lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: ((deg(lng2) + 540) % 360) - 180 };
}

export function pathLength(pts: (LatLng | null)[]): number {
  let sum = 0;
  let prev: LatLng | null = null;
  for (const p of pts) {
    if (p && prev) sum += distance(prev, p);
    if (p) prev = p;
  }
  return sum;
}

export function segmentPositions(route: Route, pointIds: string[]): (LatLng | null)[] {
  const byId = new Map(route.points.map((p) => [p.id, p]));
  return pointIds.map((id) => byId.get(id)?.position ?? null);
}

export function routeLength(route: Route): number {
  return route.segments.reduce((s, seg) => s + pathLength(segmentPositions(route, seg.pointIds)), 0);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} km`;
}

export function formatCoord(p: LatLng | null | undefined, digits = 6): string {
  if (!p) return '–';
  return `${p.lat.toFixed(digits)} / ${p.lng.toFixed(digits)}`;
}

const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
export function compass(bearingDeg: number): string {
  return DIRS[Math.round(bearingDeg / 45) % 8];
}

/** Lokale ebene Projektion (Meter) um einen Bezugspunkt – ausreichend für Trassen bis einige km */
function toXY(p: LatLng, ref: LatLng): [number, number] {
  return [rad(p.lng - ref.lng) * R * Math.cos(rad(ref.lat)), rad(p.lat - ref.lat) * R];
}

/** Abstand Punkt → Strecke a-b in Metern + Position t (0..1) entlang der Strecke */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): { d: number; t: number } {
  const [px, py] = toXY(p, a);
  const [bx, by] = toXY(b, a);
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx;
  const dy = py - t * by;
  return { d: Math.hypot(dx, dy), t };
}

/** Douglas-Peucker-Vereinfachung einer GPS-Spur (Toleranz in Metern) */
export function simplify(fixes: TrackFix[], toleranceM: number): TrackFix[] {
  if (fixes.length <= 2) return fixes.slice();
  const keep = new Uint8Array(fixes.length);
  keep[0] = keep[fixes.length - 1] = 1;
  const stack: [number, number][] = [[0, fixes.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const { d } = distanceToSegment(fixes[i], fixes[s], fixes[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return fixes.filter((_, i) => keep[i]);
}

export function nearestPoint(points: RoutePoint[], p: LatLng, maxM: number): RoutePoint | null {
  let best: RoutePoint | null = null;
  let bestD = maxM;
  for (const q of points) {
    if (!q.position) continue;
    const d = distance(q.position, p);
    if (d <= bestD) { bestD = d; best = q; }
  }
  return best;
}

export function boundsOf(pts: LatLng[]): { south: number; west: number; north: number; east: number } | null {
  if (!pts.length) return null;
  let south = 90, north = -90, west = 180, east = -180;
  for (const p of pts) {
    south = Math.min(south, p.lat); north = Math.max(north, p.lat);
    west = Math.min(west, p.lng); east = Math.max(east, p.lng);
  }
  return { south, west, north, east };
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
