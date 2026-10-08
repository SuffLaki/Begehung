// Foto-Markierungen: Linienarten per Wort erkennen und Linien zeichnen.
// Das Wort (getippt oder gesprochen) wählt Farbe + Beschriftung, z. B.
// „Tiefbau“ → rot, „Leerrohr“/„Bestandsrohr“ → blau. Den Verlauf zieht der
// Benutzer mit dem Finger – oder lässt ihn sich von der KI vorschlagen.

import type { LineType, PhotoAnnotation } from '../model/types';

export interface LineMatch {
  type: LineType;
  /** erkanntes Wort als Beschriftung, z. B. „Leerrohr“ */
  word: string;
  index: number;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Alle Linienarten, deren Schlüsselwörter im Text vorkommen – in der Reihenfolge des Textes. */
export function matchLineTypes(text: string, types: LineType[]): LineMatch[] {
  const lower = text.toLowerCase();
  const found: LineMatch[] = [];
  for (const type of types) {
    // längstes Schlüsselwort zuerst („bestandsleerrohr“ vor „leerrohr“)
    const kws = [...type.keywords, type.label].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3).sort((a, b) => b.length - a.length);
    let best: LineMatch | null = null;
    for (const kw of kws) {
      const i = lower.indexOf(kw);
      if (i < 0) continue;
      // Beschriftung: bei mehreren Wörtern das gesagte („Leerrohr“), sonst der Name der Linienart
      const word = type.keywords.length > 1 && kw !== type.label.toLowerCase() ? cap(kw) : type.label;
      if (!best || i < best.index) best = { type, word, index: i };
    }
    if (best) found.push(best);
  }
  return found.sort((a, b) => a.index - b.index);
}

export function lineTypeOf(types: LineType[], key: string): LineType {
  return types.find((t) => t.key === key) ?? { key, label: key, color: '#FF9F0A', keywords: [] };
}

/** Freihand-Spur ausdünnen (Punkte näher als minDist normiert verwerfen) */
export function thinPoints(pts: [number, number][], minDist = 0.006): [number, number][] {
  if (pts.length <= 2) return pts;
  const out: [number, number][] = [pts[0]];
  for (const p of pts.slice(1, -1)) {
    const l = out[out.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= minDist) out.push(p);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Linien in ein Canvas zeichnen (für PDF / Export). w,h = Bildgröße in Pixeln.
 * Weiße Kontur für Lesbarkeit auf jedem Untergrund, Beschriftung am Linienende.
 */
export function drawAnnotations(g: CanvasRenderingContext2D, anns: PhotoAnnotation[], w: number, h: number, types: LineType[]) {
  const lw = Math.max(3, w * 0.008);
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const a of anns) {
    if (a.points.length < 2) continue;
    const t = lineTypeOf(types, a.type);
    const path = () => {
      g.beginPath();
      a.points.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)));
    };
    path();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = lw * 1.9;
    g.stroke();
    path();
    g.strokeStyle = t.color;
    g.lineWidth = lw;
    g.stroke();
  }
  // Beschriftungen zuletzt, damit keine Linie darüber liegt
  const fs = Math.max(14, w * 0.03);
  g.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
  g.textBaseline = 'middle';
  const boxes = layoutLabels(anns, w, h, fs, (s) => g.measureText(s).width);
  for (const a of anns) {
    const box = boxes.get(a.id);
    if (!box) continue;
    const t = lineTypeOf(types, a.type);
    const { x, y, w: tw } = box;
    const pad = fs * 0.35;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(g, x - pad, y - fs * 0.7, tw + pad * 2, fs * 1.4, fs * 0.3);
    g.fill();
    g.fillStyle = t.color;
    g.fillText(a.label, x, y);
  }
  g.restore();
}

export interface LabelBox { x: number; y: number; w: number }

/**
 * Beschriftungen platzieren (Pixel). Liegen zwei Beschriftungen übereinander,
 * weicht die spätere nach unten/oben aus.
 */
export function layoutLabels(anns: PhotoAnnotation[], w: number, h: number, fs: number, measure: (s: string) => number): Map<string, LabelBox> {
  const placed: LabelBox[] = [];
  const out = new Map<string, LabelBox>();
  const pad = fs * 0.35;
  const lh = fs * 1.5;
  for (const a of anns) {
    if (a.points.length < 2 || !a.label) continue;
    const tw = measure(a.label);
    const [lx, ly] = labelAnchor(a.points);
    const x = Math.min(Math.max(pad, lx * w + fs * 0.5), w - tw - pad * 2);
    const base = Math.min(Math.max(fs, ly * h), h - fs);
    let y = base;
    const hits = (yy: number) => placed.some((p) => Math.abs(p.y - yy) < lh && x < p.x + p.w + pad * 2 && p.x < x + tw + pad * 2);
    for (let i = 1; i <= 8 && hits(y); i++) {
      const cand = base + Math.ceil(i / 2) * lh * (i % 2 ? 1 : -1);
      if (cand >= fs && cand <= h - fs) y = cand;
    }
    const box = { x, y, w: tw };
    placed.push(box);
    out.set(a.id, box);
  }
  return out;
}

/** Beschriftung am Endpunkt, der weiter rechts liegt (meist besser lesbar) */
export function labelAnchor(pts: [number, number][]): [number, number] {
  const a = pts[0];
  const b = pts[pts.length - 1];
  return b[0] >= a[0] ? b : a;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Legende für Bildunterschriften: „rot = Tiefbau, blau = Leerrohr“ */
export function legendText(anns: PhotoAnnotation[], types: LineType[]): string {
  const seen = new Map<string, Set<string>>();
  for (const a of anns) {
    const t = lineTypeOf(types, a.type);
    const k = colorName(t.color);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(a.label || t.label);
  }
  return [...seen.entries()].map(([c, labels]) => `${c} = ${[...labels].join(', ')}`).join(' · ');
}

export function colorName(hex: string): string {
  const m = hex.replace('#', '').match(/^(..)(..)(..)$/);
  if (!m) return 'Linie';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 30) return max > 200 ? 'weiß' : max < 60 ? 'schwarz' : 'grau';
  if (r >= g && r >= b) return g > 150 ? (g > 200 ? 'gelb' : 'orange') : b > 150 ? 'pink' : 'rot';
  if (g >= r && g >= b) return b > 150 ? 'türkis' : 'grün';
  return r > 120 ? 'lila' : 'blau';
}
