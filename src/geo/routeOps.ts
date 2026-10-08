// Bearbeitungsoperationen für den Trassenverlauf.
// Alle Funktionen verändern einen Entwurf (Kopie) der Begehung – aufgerufen
// werden sie immer innerhalb von useInspection.mutate(), dadurch sind sie
// automatisch rückgängig machbar.

import type { Inspection, LatLng, PointKind, RoutePoint, RouteSegment, Source } from '../model/types';
import { newPoint, newSegment } from '../model/factory';
import { bearing, distanceToSegment, simplify } from './geo';

export function nextNumber(d: Inspection, kind: PointKind): number {
  return d.route.points.filter((p) => p.kind === kind).reduce((m, p) => Math.max(m, p.number), 0) + 1;
}

export function activeSegment(d: Inspection): RouteSegment {
  let seg = d.route.segments.find((s) => s.id === d.activeSegmentId);
  if (!seg) {
    seg = d.route.segments[d.route.segments.length - 1];
    if (!seg) {
      seg = newSegment(0);
      d.route.segments.push(seg);
    }
    d.activeSegmentId = seg.id;
  }
  return seg;
}

export function addRoutePoint(
  d: Inspection,
  position: LatLng | null,
  opts: { source: Source; accuracy?: number | null; title?: string; confirmed?: boolean; segmentId?: string } = { source: 'manual' },
): RoutePoint {
  const seg = opts.segmentId ? d.route.segments.find((s) => s.id === opts.segmentId) ?? activeSegment(d) : activeSegment(d);
  const p = newPoint({
    number: nextNumber(d, 'route'),
    position,
    accuracy: opts.accuracy ?? null,
    source: opts.source,
    title: opts.title ?? '',
    confirmed: opts.confirmed ?? true,
  });
  d.route.points.push(p);
  seg.pointIds.push(p.id);
  return p;
}

export function addMarker(d: Inspection, position: LatLng, symbol = 'pin', source: Source = 'manual'): RoutePoint {
  const p = newPoint({ kind: 'marker', number: nextNumber(d, 'marker'), position, symbol, source });
  d.route.points.push(p);
  return p;
}

/** Punkt in eine Linie einfügen (Tipp auf die Linie im Bearbeitungsmodus). */
export function insertPointOnLine(d: Inspection, segId: string, at: LatLng): RoutePoint | null {
  const seg = d.route.segments.find((s) => s.id === segId);
  if (!seg) return null;
  const byId = new Map(d.route.points.map((p) => [p.id, p]));
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < seg.pointIds.length - 1; i++) {
    const a = byId.get(seg.pointIds[i])?.position;
    const b = byId.get(seg.pointIds[i + 1])?.position;
    if (!a || !b) continue;
    const { d: dist } = distanceToSegment(at, a, b);
    if (dist < bestD) { bestD = dist; bestIdx = i; }
  }
  if (bestIdx < 0) return null;
  const p = newPoint({ number: nextNumber(d, 'route'), position: at, source: 'manual' });
  d.route.points.push(p);
  seg.pointIds.splice(bestIdx + 1, 0, p.id);
  return p;
}

export function movePoint(d: Inspection, id: string, pos: LatLng) {
  const p = d.route.points.find((x) => x.id === id);
  if (!p) return;
  p.position = pos;
  p.accuracy = null; // manuell gesetzt – GPS-Genauigkeit gilt nicht mehr
  if (p.source !== 'manual') p.confirmed = true; // Verschieben = Korrektur durch den Benutzer
  p.updatedAt = Date.now();
}

export function deletePoint(d: Inspection, id: string) {
  d.route.points = d.route.points.filter((p) => p.id !== id);
  for (const s of d.route.segments) s.pointIds = s.pointIds.filter((x) => x !== id);
  // leere Nebenabschnitte entfernen, den aktiven aber behalten
  d.route.segments = d.route.segments.filter((s) => s.pointIds.length > 0 || s.id === d.activeSegmentId || d.route.segments.length === 1);
  for (const f of d.photos) if (f.pointId === id) { f.pointId = null; f.pointAutoAssigned = false; }
  for (const n of d.notes) if (n.pointId === id) n.pointId = null;
}

/** Abschnitt an einem Punkt teilen. Der Punkt gehört danach zu beiden Teilen (Ende bzw. Anfang). */
export function splitSegmentAt(d: Inspection, segId: string, pointId: string): RouteSegment | null {
  const seg = d.route.segments.find((s) => s.id === segId);
  if (!seg) return null;
  const idx = seg.pointIds.indexOf(pointId);
  if (idx <= 0 || idx >= seg.pointIds.length - 1) return null;
  const tail = newSegment(d.route.segments.length, seg.pointIds.slice(idx), seg.source);
  seg.pointIds = seg.pointIds.slice(0, idx + 1);
  d.route.segments.splice(d.route.segments.indexOf(seg) + 1, 0, tail);
  return tail;
}

/** Neuen Abschnitt (Abzweig) beginnend an einem vorhandenen Punkt anlegen und aktiv setzen. */
export function branchFrom(d: Inspection, pointId: string): RouteSegment {
  const seg = newSegment(d.route.segments.length, [pointId]);
  d.route.segments.push(seg);
  d.activeSegmentId = seg.id;
  return seg;
}

export function newEmptySegment(d: Inspection): RouteSegment {
  const seg = newSegment(d.route.segments.length);
  d.route.segments.push(seg);
  d.activeSegmentId = seg.id;
  return seg;
}

/** Zwei Abschnitte verbinden: b wird an a angehängt (passend gedreht, gemeinsamer Punkt nur einmal). */
export function joinSegments(d: Inspection, aId: string, bId: string): boolean {
  const a = d.route.segments.find((s) => s.id === aId);
  const b = d.route.segments.find((s) => s.id === bId);
  if (!a || !b || a === b) return false;
  let bIds = [...b.pointIds];
  const aLast = a.pointIds[a.pointIds.length - 1];
  if (bIds[bIds.length - 1] === aLast) bIds.reverse();
  else if (bIds[0] !== aLast && a.pointIds[0] === bIds[0]) {
    a.pointIds.reverse();
  } else if (bIds[0] !== aLast && a.pointIds[0] === bIds[bIds.length - 1]) {
    a.pointIds.reverse();
    bIds.reverse();
  }
  if (bIds[0] === a.pointIds[a.pointIds.length - 1]) bIds = bIds.slice(1);
  a.pointIds.push(...bIds);
  d.route.segments = d.route.segments.filter((s) => s !== b);
  if (d.activeSegmentId === b.id) d.activeSegmentId = a.id;
  return true;
}

export function reverseSegment(d: Inspection, segId: string) {
  const seg = d.route.segments.find((s) => s.id === segId);
  if (seg) seg.pointIds.reverse();
}

export function deleteSegment(d: Inspection, segId: string, removePoints: boolean) {
  const seg = d.route.segments.find((s) => s.id === segId);
  if (!seg) return;
  d.route.segments = d.route.segments.filter((s) => s !== seg);
  if (removePoints) {
    const stillUsed = new Set(d.route.segments.flatMap((s) => s.pointIds));
    for (const id of seg.pointIds) if (!stillUsed.has(id)) deletePoint(d, id);
  }
  if (d.activeSegmentId === segId) d.activeSegmentId = d.route.segments[0]?.id ?? null;
  if (!d.route.segments.length) {
    const s = newSegment(0);
    d.route.segments.push(s);
    d.activeSegmentId = s.id;
  }
}

/** Punkte in Trassenreihenfolge neu durchnummerieren (1, 2, 3 …); Markierungen separat. */
export function renumber(d: Inspection) {
  const order: string[] = [];
  for (const s of d.route.segments) for (const id of s.pointIds) if (!order.includes(id)) order.push(id);
  const byId = new Map(d.route.points.map((p) => [p.id, p]));
  let n = 1;
  for (const id of order) {
    const p = byId.get(id);
    if (p && p.kind === 'route') p.number = n++;
  }
  for (const p of d.route.points) if (p.kind === 'route' && !order.includes(p.id)) p.number = n++;
  let m = 1;
  for (const p of d.route.points) if (p.kind === 'marker') p.number = m++;
}

/** Punkte, die in keinem Abschnitt vorkommen (z. B. nach dem Löschen eines Abschnitts) */
export function orphanRoutePoints(d: Inspection): RoutePoint[] {
  const used = new Set(d.route.segments.flatMap((s) => s.pointIds));
  return d.route.points.filter((p) => p.kind === 'route' && !used.has(p.id));
}

/** Start- und Endpunkte für die Darstellung */
export function endpoints(d: Inspection): { startIds: Set<string>; endIds: Set<string> } {
  const startIds = new Set<string>();
  const endIds = new Set<string>();
  const first = d.route.segments.find((s) => s.pointIds.length > 0);
  if (first) startIds.add(first.pointIds[0]);
  const inner = new Set<string>();
  for (const s of d.route.segments) s.pointIds.slice(0, -1).forEach((id) => inner.add(id));
  for (const s of d.route.segments) {
    const last = s.pointIds[s.pointIds.length - 1];
    if (s.pointIds.length > 1 && last && !inner.has(last) && !startIds.has(last)) endIds.add(last);
  }
  return { startIds, endIds };
}

/** GPS-Aufzeichnung vereinfachen und als neuen Trassenabschnitt übernehmen. */
export function trackToSegment(d: Inspection, trackId: string, toleranceM = 4): RouteSegment | null {
  const t = d.route.tracks.find((x) => x.id === trackId);
  if (!t || t.fixes.length < 2) return null;
  const simple = simplify(t.fixes, toleranceM);
  const seg = newSegment(d.route.segments.length, [], 'gps');
  seg.name = `GPS-Aufzeichnung ${new Date(t.startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  // leeren aktiven Standardabschnitt ersetzen statt einen zweiten anzulegen
  const empty = d.route.segments.find((s) => s.pointIds.length === 0);
  if (empty) {
    seg.color = empty.color;
    d.route.segments = d.route.segments.filter((s) => s !== empty);
  }
  let n = nextNumber(d, 'route');
  for (const f of simple) {
    const p = newPoint({ number: n++, position: { lat: f.lat, lng: f.lng }, accuracy: f.acc, source: 'gps', confirmed: true });
    d.route.points.push(p);
    seg.pointIds.push(p.id);
  }
  d.route.segments.push(seg);
  d.activeSegmentId = seg.id;
  t.convertedSegmentId = seg.id;
  return seg;
}

/** Richtung des letzten Linienstücks, das in einem Punkt endet (für „links“/„rechts“). */
export function headingInto(d: Inspection, pointId: string): number | null {
  const byId = new Map(d.route.points.map((p) => [p.id, p]));
  for (const s of d.route.segments) {
    const i = s.pointIds.indexOf(pointId);
    if (i > 0) {
      const a = byId.get(s.pointIds[i - 1])?.position;
      const b = byId.get(pointId)?.position;
      if (a && b) return bearing(a, b);
    }
  }
  return null;
}

/** Segment, in dem ein Punkt als letzter vorkommt – dort wird weitergezeichnet. */
export function segmentEndingAt(d: Inspection, pointId: string): RouteSegment | null {
  return d.route.segments.find((s) => s.pointIds[s.pointIds.length - 1] === pointId) ?? null;
}

export function segmentsOfPoint(d: Inspection, pointId: string): RouteSegment[] {
  return d.route.segments.filter((s) => s.pointIds.includes(pointId));
}

/**
 * „Relevante“ Punkte bekommen in Karte und PDF eine Nummer und einen eigenen
 * Abschnitt. Reine Stützpunkte aus einer GPS-Aufzeichnung ohne Inhalte nicht.
 */
export function isRelevantPoint(d: Inspection, p: RoutePoint, startIds: Set<string>, endIds: Set<string>): boolean {
  if (p.kind === 'marker') return true;
  const hasContent = !!(p.title || p.description && !p.vertex || p.label || p.category || p.station);
  if (p.vertex && !hasContent && !startIds.has(p.id) && !endIds.has(p.id) && !d.photos.some((f) => f.pointId === p.id) && !d.notes.some((n) => n.pointId === p.id)) return false;
  if (p.source !== 'gps' || !p.confirmed) return true;
  if (startIds.has(p.id) || endIds.has(p.id)) return true;
  if (p.title || p.description || p.label || p.category || p.station) return true;
  if (d.photos.some((f) => f.pointId === p.id)) return true;
  if (d.notes.some((n) => n.pointId === p.id)) return true;
  return false;
}

/** Punkte in Trassenreihenfolge (Abschnitt für Abschnitt), danach Markierungen */
export function orderedPoints(d: Inspection): RoutePoint[] {
  const byId = new Map(d.route.points.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: RoutePoint[] = [];
  for (const s of d.route.segments) for (const id of s.pointIds) {
    const p = byId.get(id);
    if (p && !seen.has(id)) { seen.add(id); out.push(p); }
  }
  for (const p of d.route.points) if (p.kind === 'route' && !seen.has(p.id)) out.push(p);
  for (const p of d.route.points) if (p.kind === 'marker') out.push(p);
  return out;
}
