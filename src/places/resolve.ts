// Erkannte Orte auflösen (OpenStreetMap) und als farbige Trassenabschnitte einzeichnen.

import type { Inspection, LatLng, LineType, RoutePoint } from '../model/types';
import { newPoint, newSegment, SEGMENT_COLORS } from '../model/factory';
import { nextNumber } from '../geo/routeOps';
import { simplify, distance } from '../geo/geo';
import { lineTypeOf } from '../annotate/lines';
import { placeLabel, type PlacePiece, type PlaceRef } from './placeParser';
import { bboxAround, geocodeAddress, geocodeStreet, intersection, routeAlong, type Bbox, type GeoResult } from './osm';

export interface ResolvedPlace {
  ref: PlaceRef;
  result: GeoResult | null;
  error: string;
}

export interface ResolvedPiece {
  piece: PlacePiece;
  from: { pos: LatLng; label: string; pointId: string | null; note: string } | null;
  to: { pos: LatLng; label: string; note: string } | null;
  /** kompletter Verlauf inkl. Start/Ende */
  path: LatLng[];
  routed: boolean;
  problems: string[];
}

const PRECISION_NOTE: Record<GeoResult['precision'], string> = {
  house: 'Adresse aus OpenStreetMap (Hausnummer gefunden).',
  street: 'Nur die Straße gefunden – Hausnummer nicht im Kartenbestand, Lage ungenau.',
  intersection: 'Kreuzung aus den Straßenverläufen (OpenStreetMap) berechnet.',
};

async function resolveRef(ref: PlaceRef, box: Bbox | null, city: string): Promise<ResolvedPlace> {
  try {
    let result: GeoResult | null = null;
    if (ref.kind === 'address') result = await geocodeAddress(ref.street, ref.number, box, city);
    else if (ref.kind === 'street') result = await geocodeStreet(ref.street, box, city);
    else if (ref.b) result = await intersection(ref.a, ref.b, box, city);
    else return { ref, result: null, error: `Kreuzung mit „${ref.a}“: zweite Straße nicht genannt.` };
    return { ref, result, error: result ? '' : `„${placeLabel(ref)}“ im Suchbereich nicht gefunden.` };
  } catch (e) {
    return { ref, result: null, error: (e as Error).message };
  }
}

/** einzelnen Ort auflösen (für Foto-Linien) */
export async function resolvePlace(ref: PlaceRef, near: LatLng | null, city: string): Promise<ResolvedPlace> {
  const box = near ? bboxAround(near) : null;
  if (!box && !city) return { ref, result: null, error: 'Kein Bezugsort für die Suche (GPS, Punkt auf der Karte oder Ort in „Baustelle / Bereich“).' };
  return resolveRef(ref, box, city);
}

export interface ResolveContext {
  /** Bezugspunkt für die Suche (letzter Punkt, GPS oder Kartenmitte) */
  near: LatLng | null;
  /** Ortsname als Ersatz, wenn kein Bezugspunkt da ist */
  city: string;
  /** Start, falls das erste Stück keinen „von“-Ort hat */
  start: { pos: LatLng; label: string; pointId: string | null } | null;
  followStreets: boolean;
  onProgress?: (msg: string) => void;
}

export async function resolvePieces(pieces: PlacePiece[], ctx: ResolveContext): Promise<ResolvedPiece[]> {
  const box = ctx.near ? bboxAround(ctx.near) : null;
  if (!box && !ctx.city) throw new Error('Für die Adresssuche wird ein Bezugsort gebraucht: GPS einschalten, einen Punkt auf der Karte setzen oder in den Projektdaten „Baustelle / Bereich“ mit Ortsnamen ausfüllen.');
  const out: ResolvedPiece[] = [];
  let prev: { pos: LatLng; label: string; pointId: string | null } | null = ctx.start;
  for (const [i, piece] of pieces.entries()) {
    ctx.onProgress?.(`Suche ${i + 1}/${pieces.length}: ${placeLabel(piece.to ?? piece.from) || piece.along || ''} …`);
    const problems: string[] = [];
    let from: ResolvedPiece['from'] = null;
    let to: ResolvedPiece['to'] = null;
    if (piece.from) {
      const r = await resolveRef(piece.from, box, ctx.city);
      if (r.result) from = { pos: r.result.pos, label: r.result.label, pointId: null, note: PRECISION_NOTE[r.result.precision] };
      else problems.push(r.error);
    } else if (prev) {
      from = { ...prev, note: '' };
    }
    if (piece.to) {
      const r = await resolveRef(piece.to, box, ctx.city);
      if (r.result) to = { pos: r.result.pos, label: r.result.label, note: PRECISION_NOTE[r.result.precision] };
      else problems.push(r.error);
    } else if (piece.along) {
      problems.push(`Ende fehlt: bitte „bis …“ angeben (z. B. „bis Hausnummer 40“ oder „bis zur Kreuzung …“).`);
    }

    let path: LatLng[] = [];
    let routed = false;
    if (from && to) {
      if (ctx.followStreets && distance(from.pos, to.pos) > 15) {
        ctx.onProgress?.(`Verlauf ${i + 1}/${pieces.length} entlang des Wegenetzes …`);
        const r = await routeAlong(from.pos, to.pos);
        if (r && r.length >= 2) { path = [from.pos, ...r.slice(1, -1), to.pos]; routed = true; }
        else problems.push('Kein Weg im Wegenetz gefunden – gerade Linie eingezeichnet.');
      }
      if (!path.length) path = [from.pos, to.pos];
    } else if (to && !piece.from && !prev) {
      path = [to.pos]; // einzelner Ort
    } else if (from && !to && piece.from && !piece.to && !piece.along) {
      path = [from.pos];
      to = { pos: from.pos, label: from.label, note: from.note };
      from = null;
    }
    out.push({ piece, from, to, path, routed, problems });
    if (to) prev = { pos: to.pos, label: to.label, pointId: null };
    else if (from && piece.from) prev = { pos: from.pos, label: from.label, pointId: null }; // nur Start bekannt
    else if (problems.length) prev = null; // Bezug verloren → folgende Stücke brauchen eigenen Start
  }
  return out;
}

/** Aufgelöste Stücke als farbige Trassenabschnitte anlegen. Alle Punkte sind „automatisch ermittelt“. */
export function applyResolved(d: Inspection, resolved: ResolvedPiece[], types: LineType[]): { segments: number; points: number } {
  let segCount = 0;
  let pointCount = 0;
  let lastEnd: { pos: LatLng; id: string } | null = null;
  const mk = (pos: LatLng, title: string, note: string, text: string, vertex = false): RoutePoint => {
    const p = newPoint({ number: nextNumber(d, 'route'), position: pos, source: 'auto', confirmed: false, title, vertex });
    p.description = note;
    p.estimate = { text, fromPointId: null, bearingDeg: null, distanceM: null };
    d.route.points.push(p);
    pointCount++;
    return p;
  };
  for (const r of resolved) {
    if (!r.path.length) continue;
    const t = r.piece.lineType ? lineTypeOf(types, r.piece.lineType) : null;
    const seg = newSegment(d.route.segments.length, [], 'auto');
    seg.color = t?.color ?? SEGMENT_COLORS[d.route.segments.length % SEGMENT_COLORS.length];
    seg.lineType = t?.key;
    const typeLabel = r.piece.lineWord || t?.label || 'Trasse';
    seg.name = r.from && r.to ? `${typeLabel}: ${r.from.label} – ${r.to.label}` : `${typeLabel}: ${r.to?.label ?? r.from?.label ?? ''}`;

    // Startpunkt: vorhandenen Punkt weiterverwenden, wenn die Kette anschließt
    const ids: string[] = [];
    if (r.path.length >= 2 && r.from) {
      if (r.from.pointId) ids.push(r.from.pointId);
      else if (lastEnd && distance(lastEnd.pos, r.from.pos) < 1) ids.push(lastEnd.id);
      else ids.push(mk(r.from.pos, r.from.label, r.from.note, r.piece.text).id);
      // Zwischenpunkte des Verlaufs (vereinfacht)
      const inner = simplify(r.path.map((p, i) => ({ lat: p.lat, lng: p.lng, acc: null, t: i })), 3).slice(1, -1);
      for (const q of inner) ids.push(mk({ lat: q.lat, lng: q.lng }, '', r.routed ? 'Verlauf entlang des Wegenetzes (OpenStreetMap) – schematisch, Lage vor Ort prüfen.' : '', r.piece.text, true).id);
    }
    const end = r.path[r.path.length - 1];
    const endPoint = mk(end, r.to?.label ?? '', [r.to?.note, r.problems.join(' ')].filter(Boolean).join(' '), r.piece.text);
    ids.push(endPoint.id);
    lastEnd = { pos: end, id: endPoint.id };
    seg.pointIds = ids;
    d.route.segments = d.route.segments.filter((s) => s.pointIds.length > 0 || s.id !== d.activeSegmentId);
    d.route.segments.push(seg);
    d.activeSegmentId = seg.id;
    segCount++;
  }
  return { segments: segCount, points: pointCount };
}
