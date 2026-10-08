// Erzeugt das Kartenbild für die PDF: Kacheln des gewählten Kartentyps laden,
// Trasse/Punkte/Fotos selbst darüber zeichnen (gestochen scharf, unabhängig
// vom Bildschirm), Maßstab, Nordpfeil und Quellenangabe ergänzen.
// Sind die Kacheln nicht erreichbar (offline, Gebiet nie angesehen), wird die
// Trasse auf neutralem Raster gezeichnet und das im Ergebnis gemeldet.

import type { Inspection, MapBounds, PdfSettings, PlanSheet } from '../model/types';
import { planImage } from '../plans/plans';
import { MAP_TYPES, attributionOf, tileUrl } from './providers';
import { endpoints, isRelevantPoint } from '../geo/routeOps';
import { boundsOf } from '../geo/geo';
import { SYMBOLS } from '../model/factory';

export interface StaticMapResult {
  jpeg: Uint8Array;
  width: number;
  height: number;
  tilesOk: boolean;
  attribution: string;
  /** Meter pro Bildpixel */
  mpp: number;
}

const LOGICAL_W = 900;
const TILE = 256;

const projX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const projY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

export function contentBounds(insp: Inspection): MapBounds | null {
  const pts = [
    ...insp.route.points.flatMap((p) => (p.position && !p.planId ? [p.position] : [])),
    ...insp.photos.flatMap((f) => (f.position ? [f.position] : [])),
  ];
  if (!pts.length) insp.route.tracks.forEach((t) => t.fixes.forEach((f) => pts.push(f)));
  return boundsOf(pts);
}

/** Bounds um 12 % erweitern und auf das Seitenverhältnis bringen; Mindestausdehnung ~120 m */
export function frameBounds(b: MapBounds, aspect: number): MapBounds {
  const midLat = (b.south + b.north) / 2;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  let wM = Math.max((b.east - b.west) * mPerDegLng, 120);
  let hM = Math.max((b.north - b.south) * mPerDegLat, 120 / aspect);
  wM *= 1.24; hM *= 1.24;
  if (wM / hM > aspect) hM = wM / aspect; else wM = hM * aspect;
  const cLng = (b.west + b.east) / 2;
  return {
    south: midLat - hM / 2 / mPerDegLat, north: midLat + hM / 2 / mPerDegLat,
    west: cLng - wM / 2 / mPerDegLng, east: cLng + wM / 2 / mPerDegLng,
  };
}

async function loadTile(url: string): Promise<ImageBitmap | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function renderStaticMap(insp: Inspection, ps: PdfSettings, aspect: number, onProgress?: (msg: string) => void): Promise<StaticMapResult | null> {
  const raw = ps.mapView ?? (contentBounds(insp) ? frameBounds(contentBounds(insp)!, aspect) : null);
  if (!raw) return null;
  const S = 2; // Ausgabe in doppelter Auflösung
  const CW = LOGICAL_W * S;
  const CH = Math.round(CW / aspect);

  // gebrochene Zoomstufe, so dass die gewünschte Breite genau ins Bild passt
  const lngSpan = Math.max(1e-6, raw.east - raw.west);
  let zf = Math.log2((CW * 360) / (lngSpan * TILE));
  zf = Math.min(zf, 22);
  const cx = (projX(raw.west, zf) + projX(raw.east, zf)) / 2;
  const cy = (projY(raw.south, zf) + projY(raw.north, zf)) / 2;
  const ox = cx - CW / 2;
  const oy = cy - CH / 2;
  const toPx = (lat: number, lng: number): [number, number] => [projX(lng, zf) - ox, projY(lat, zf) - oy];

  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#E9ECEF';
  g.fillRect(0, 0, CW, CH);

  // ---------------------------------------------- Kacheln
  let tilesOk = true;
  const layers = MAP_TYPES[ps.mapType].layers;
  for (const [li, src] of layers.entries()) {
    const zt = Math.max(0, Math.min(src.maxNativeZoom, Math.round(zf)));
    const k = 2 ** (zf - zt); // Skalierung einer Kachel
    const ts = TILE * k;
    const x0 = Math.floor(ox / ts), x1 = Math.floor((ox + CW) / ts);
    const y0 = Math.floor(oy / ts), y1 = Math.floor((oy + CH) / ts);
    const n = 2 ** zt;
    const jobs: { tx: number; ty: number }[] = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (ty >= 0 && ty < n) jobs.push({ tx, ty });
    let done = 0;
    let failed = 0;
    onProgress?.(`Karte wird geladen (Ebene ${li + 1}/${layers.length}) …`);
    await pool(jobs, 8, async ({ tx, ty }) => {
      const img = await loadTile(tileUrl(src, zt, ((tx % n) + n) % n, ty));
      done++;
      if (!img) { failed++; return; }
      g.drawImage(img, Math.round(tx * ts - ox), Math.round(ty * ts - oy), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      img.close?.();
    });
    if (li === 0 && failed > done * 0.3) tilesOk = false;
  }
  if (!tilesOk) {
    g.fillStyle = '#F1F3F5';
    g.fillRect(0, 0, CW, CH);
    g.strokeStyle = '#D5DAE0';
    g.lineWidth = 1;
    for (let x = 0; x < CW; x += 60 * S) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CH); g.stroke(); }
    for (let y = 0; y < CH; y += 60 * S) { g.beginPath(); g.moveTo(0, y); g.lineTo(CW, y); g.stroke(); }
    label(g, 'Kartenhintergrund nicht verfügbar (offline) – nur Trassengeometrie', 14 * S, 22 * S, S, '#5c6670');
  }

  drawOverlay(g, insp, ps, toPx, S, null);

  // ---------------------------------------------- Maßstab, Nordpfeil, Quelle
  const midLat = (raw.south + raw.north) / 2;
  const mpp = (Math.cos((midLat * Math.PI) / 180) * 2 * Math.PI * 6378137) / (TILE * 2 ** zf);
  const target = (CW * 0.18) * mpp;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const barPx = nice / mpp;
  const bx = 14 * S, by = CH - 16 * S;
  roundRect(g, bx - 6 * S, by - 20 * S, barPx + 12 * S, 28 * S, 4 * S, 'rgba(255,255,255,0.88)', null, 0);
  g.fillStyle = '#111';
  g.fillRect(bx, by - 3 * S, barPx, 4 * S);
  g.fillRect(bx, by - 8 * S, 1.5 * S, 9 * S);
  g.fillRect(bx + barPx - 1.5 * S, by - 8 * S, 1.5 * S, 9 * S);
  g.font = `bold ${10 * S}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, bx, by - 8 * S);

  const nx = CW - 26 * S, ny = 30 * S;
  g.beginPath(); g.arc(nx, ny, 17 * S, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
  g.beginPath(); g.moveTo(nx, ny - 12 * S); g.lineTo(nx + 7 * S, ny + 8 * S); g.lineTo(nx, ny + 3 * S); g.lineTo(nx - 7 * S, ny + 8 * S); g.closePath();
  g.fillStyle = '#111'; g.fill();
  g.font = `bold ${8 * S}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.fillText('N', nx, ny - 13 * S + 0 * S - 2 * S);

  const attribution = tilesOk ? attributionOf(ps.mapType) : '';
  if (attribution) {
    g.font = `${9 * S}px Helvetica, Arial, sans-serif`;
    const tw = g.measureText(attribution).width;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(CW - tw - 10 * S, CH - 14 * S, tw + 10 * S, 14 * S);
    g.fillStyle = '#333';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText(attribution, CW - 5 * S, CH - 7 * S);
  }

  onProgress?.('Kartenbild wird erzeugt …');
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Kartenbild konnte nicht erzeugt werden.'))), 'image/jpeg', 0.9));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: CW, height: CH, tilesOk, attribution, mpp: mpp };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke: string | null, lw: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke && lw) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, S: number, color = '#111') {
  g.font = `bold ${10 * S}px Helvetica, Arial, sans-serif`;
  const w = g.measureText(text).width + 8 * S;
  const h = 15 * S;
  roundRect(g, x, y - h / 2, w, h, 3 * S, 'rgba(255,255,255,0.92)', 'rgba(0,0,0,0.25)', 1 * S);
  g.fillStyle = color;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x + 4 * S, y + 0.5 * S);
}

function glyphSafe(s: string): string {
  return s === '♣' ? 'B' : s === '⚡' ? 'L' : s === '≈' ? '~' : s;
}

/** Trasse, Fotos, Punkte und Markierungen einer Grundlage (Karte oder Plan) zeichnen */
function drawOverlay(g: CanvasRenderingContext2D, insp: Inspection, ps: PdfSettings, toPx: (lat: number, lng: number) => [number, number], S: number, space: string | null) {
  // ---------------------------------------------- Trasse
  const byId = new Map(insp.route.points.filter((p) => (p.planId ?? null) === space).map((p) => [p.id, p]));
  const { startIds, endIds } = endpoints(insp);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const seg of insp.route.segments) {
    const color = ps.colored ? seg.color : '#111111';
    for (let i = 0; i < seg.pointIds.length - 1; i++) {
      const a = byId.get(seg.pointIds[i]);
      const b = byId.get(seg.pointIds[i + 1]);
      if (!a?.position || !b?.position) continue;
      const [ax, ay] = toPx(a.position.lat, a.position.lng);
      const [bx, by] = toPx(b.position.lat, b.position.lng);
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 8 * S;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      g.strokeStyle = color;
      g.lineWidth = 4.5 * S;
      g.setLineDash(!a.confirmed || !b.confirmed ? [10 * S, 8 * S] : []);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
  }
  g.setLineDash([]);

  // ---------------------------------------------- Fotos
  if (ps.showPhotoMarkers) {
    for (const f of insp.photos) {
      const pos = space ? (f.pointId ? byId.get(f.pointId)?.position : null) : f.position ?? (f.pointId ? byId.get(f.pointId)?.position : null);
      if (!pos) continue;
      const [x, y] = toPx(pos.lat, pos.lng);
      const w = 30 * S, h = 18 * S;
      roundRect(g, x - w / 2, y - h / 2, w, h, 4 * S, '#1C1C1E', '#FFFFFF', 1.5 * S);
      g.fillStyle = '#FFFFFF';
      g.font = `bold ${10 * S}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`F${f.number}`, x, y + 0.5 * S);
    }
  }

  // ---------------------------------------------- Punkte
  for (const p of byId.values()) {
    if (!p.position) continue;
    const [x, y] = toPx(p.position.lat, p.position.lng);
    const seg = insp.route.segments.find((s) => s.pointIds.includes(p.id));
    const color = ps.colored ? seg?.color ?? '#FF9F0A' : '#111111';
    if (p.kind === 'marker') {
      if (!ps.showMarkers) continue;
      const r = 10 * S;
      g.save();
      g.translate(x, y);
      g.rotate(Math.PI / 4);
      roundRect(g, -r, -r, 2 * r, 2 * r, 3 * S, '#FFFFFF', '#1C1C1E', 2 * S);
      g.restore();
      g.fillStyle = '#1C1C1E';
      g.font = `bold ${11 * S}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(glyphSafe(SYMBOLS[p.symbol]?.glyph ?? '•'), x, y + 0.5 * S);
      if (ps.showNumbers) label(g, p.label || `M${p.number}`, x + 14 * S, y - 14 * S, S);
      continue;
    }
    const isStart = startIds.has(p.id);
    const isEnd = endIds.has(p.id);
    const relevant = isRelevantPoint(insp, p, startIds, endIds);
    if (!ps.showGpsPoints && !isStart && !isEnd) continue;
    if (!relevant) {
      g.beginPath(); g.arc(x, y, 3 * S, 0, Math.PI * 2);
      g.fillStyle = '#FFFFFF'; g.fill();
      g.lineWidth = 1.5 * S; g.strokeStyle = color; g.stroke();
      continue;
    }
    const r = (isStart || isEnd ? 10 : 8) * S;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = isStart ? '#1E8E3E' : isEnd ? '#C5221F' : '#FFFFFF';
    g.fill();
    g.lineWidth = 2.5 * S;
    g.strokeStyle = isStart || isEnd ? '#FFFFFF' : color;
    if (!p.confirmed) g.setLineDash([3 * S, 2 * S]);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = isStart || isEnd ? '#FFFFFF' : '#111111';
    g.font = `bold ${(isStart || isEnd ? 11 : 9) * S}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(isStart ? 'S' : isEnd ? 'E' : '', x, y + 0.5 * S);
    if (ps.showNumbers) label(g, p.label || `P${p.number}${p.confirmed ? '' : ' ?'}`, x + r + 3 * S, y - r - 2 * S, S);
  }

}

/** Inhaltsbereich auf einem Plan (Planpixel), null = keine Punkte */
export function planContentBounds(insp: Inspection, planId: string): MapBounds | null {
  return boundsOf(insp.route.points.filter((p) => p.planId === planId && p.position).map((p) => p.position!));
}

/**
 * Übersicht auf Basis eines Plans: Planbild als Hintergrund, Eintragungen darüber.
 * Ausschnitt: gewählter Ausschnitt, sonst ganzer Plan.
 */
export async function renderPlanMap(insp: Inspection, plan: PlanSheet, ps: PdfSettings, aspect: number, view: MapBounds | null): Promise<StaticMapResult | null> {
  const img = await planImage(plan.id);
  if (!img) return null;
  const CW = 2400;
  const CH = Math.round(CW / aspect);
  const S = CW / 900;
  // Ausschnitt in Planpixeln (x = lng, y = −lat)
  let x0 = view ? view.west : 0;
  let x1 = view ? view.east : plan.width;
  let y0 = view ? -view.north : 0;
  let y1 = view ? -view.south : plan.height;
  // auf das Seitenverhältnis bringen (zentriert)
  if ((x1 - x0) / (y1 - y0) > aspect) {
    const h = (x1 - x0) / aspect, cy = (y0 + y1) / 2;
    y0 = cy - h / 2; y1 = cy + h / 2;
  } else {
    const w = (y1 - y0) * aspect, cx = (x0 + x1) / 2;
    x0 = cx - w / 2; x1 = cx + w / 2;
  }
  const k = CW / (x1 - x0);
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, CW, CH);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, -x0 * k, -y0 * k, plan.width * k, plan.height * k);
  const toPx = (lat: number, lng: number): [number, number] => [(lng - x0) * k, (-lat - y0) * k];
  drawOverlay(g, insp, ps, toPx, S, plan.id);

  // Maßstabsleiste nur mit bekanntem Maßstab
  const mpp = plan.metersPerPx ? plan.metersPerPx / k : 0;
  if (mpp) {
    const target = CW * 0.18 * mpp;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const barPx = nice / mpp;
    const bx = 14 * S, by = CH - 16 * S;
    roundRect(g, bx - 6 * S, by - 20 * S, barPx + 12 * S, 28 * S, 4 * S, 'rgba(255,255,255,0.88)', null, 0);
    g.fillStyle = '#111';
    g.fillRect(bx, by - 3 * S, barPx, 4 * S);
    g.font = `bold ${10 * S}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, bx, by - 8 * S);
  }
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Planbild konnte nicht erzeugt werden.'))), 'image/jpeg', 0.9));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: CW, height: CH, tilesOk: true, attribution: `Plangrundlage: ${plan.fileName}`, mpp };
}
