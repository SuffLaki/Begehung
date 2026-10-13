// GPX-Export (Standardformat für GPS-Programme, z. B. QGIS, Garmin, Google Earth).
// Enthält nur Punkte auf der Landkarte – Punkte auf nicht eingepassten Plänen haben keine Koordinaten.

import type { Inspection } from '../model/types';
import { pointDisplayName } from '../model/factory';

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
const iso = (t: number) => new Date(t).toISOString();
const ll = (p: { lat: number; lng: number }) => `lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"`;

export function buildGpx(insp: Inspection): { xml: string; fileName: string; empty: boolean } {
  const byId = new Map(insp.route.points.map((p) => [p.id, p]));
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<gpx version="1.1" creator="Trasso" xmlns="http://www.topografix.com/GPX/1/1">');
  lines.push(`  <metadata><name>${esc(insp.meta.projectName || 'Begehung')}</name><time>${iso(insp.updatedAt)}</time></metadata>`);
  let count = 0;
  // Wegpunkte: benannte Trassenpunkte und Markierungen
  for (const p of insp.route.points) {
    if (!p.position || p.planId || (p.vertex && !p.title)) continue;
    const name = `${pointDisplayName(p)}${p.title ? ' – ' + p.title : ''}`;
    const desc = [p.description, p.check === 'ok' ? 'Prüfung: OK' : p.check === 'defect' ? 'Prüfung: Mangel' : '', p.confirmed ? '' : 'automatisch ermittelt'].filter(Boolean).join(' · ');
    lines.push(`  <wpt ${ll(p.position)}><time>${iso(p.createdAt)}</time><name>${esc(name)}</name>${desc ? `<desc>${esc(desc)}</desc>` : ''}</wpt>`);
    count++;
  }
  // Trassenabschnitte als Spuren
  for (const s of insp.route.segments) {
    const pts = s.pointIds.map((id) => byId.get(id)).filter((p) => p?.position && !p.planId);
    if (pts.length < 2) continue;
    lines.push(`  <trk><name>${esc(s.name)}</name><trkseg>`);
    for (const p of pts) lines.push(`    <trkpt ${ll(p!.position!)}></trkpt>`);
    lines.push('  </trkseg></trk>');
    count++;
  }
  // GPS-Aufzeichnungen (Rohdaten mit Zeitstempel)
  for (const t of insp.route.tracks) {
    if (t.fixes.length < 2) continue;
    lines.push(`  <trk><name>GPS-Aufzeichnung ${esc(new Date(t.startedAt).toLocaleString('de-DE'))}</name><trkseg>`);
    for (const f of t.fixes) lines.push(`    <trkpt ${ll(f)}><time>${iso(f.t)}</time></trkpt>`);
    lines.push('  </trkseg></trk>');
    count++;
  }
  lines.push('</gpx>');
  const base = `Trasse_${insp.meta.projectNumber || insp.meta.projectName || 'Begehung'}_${insp.meta.date}`.replace(/[^\wäöüÄÖÜß.-]+/g, '_');
  return { xml: lines.join('\n'), fileName: `${base}.gpx`, empty: count === 0 };
}
