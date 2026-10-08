// SVG-Überlagerung der Foto-Linien (Anzeige in App, Vorschaubildern und Editor).

import type { LineType, PhotoAnnotation } from '../model/types';
import { layoutLabels, lineTypeOf } from './lines';

interface Props {
  anns: PhotoAnnotation[];
  /** Bildgröße (Seitenverhältnis) */
  w: number;
  h: number;
  types: LineType[];
  /** gestrichelt (z. B. KI-Vorschläge) */
  dashed?: boolean;
  labels?: boolean;
  thin?: boolean;
}

export function AnnotationLayer({ anns, w, h, types, dashed, labels = true, thin }: Props) {
  const lw = Math.max(3, w * (thin ? 0.012 : 0.008));
  const fs = Math.max(14, w * 0.03);
  const suffix = dashed ? ' (KI-Vorschlag)' : '';
  // Breite grob geschätzt (fette Schrift ≈ 0,62 × Schriftgröße je Zeichen)
  const boxes = labels ? layoutLabels(anns, w, h, fs, (s) => (s + suffix).length * fs * 0.62) : new Map();
  return (
    <g>
      {anns.map((a) => {
        if (a.points.length < 2) return null;
        const t = lineTypeOf(types, a.type);
        const pts = a.points.map(([x, y]) => `${x * w},${y * h}`).join(' ');
        return (
          <g key={a.id}>
            <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={lw * 1.9} strokeLinecap="round" strokeLinejoin="round" />
            <polyline points={pts} fill="none" stroke={t.color} strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? `${lw * 3} ${lw * 2}` : undefined} />
          </g>
        );
      })}
      {labels && anns.map((a) => {
        const box = boxes.get(a.id);
        if (!box) return null;
        const t = lineTypeOf(types, a.type);
        return (
          <text key={`l-${a.id}`} x={box.x} y={box.y} fontSize={fs} fontWeight={700} fill={t.color} stroke="#fff" strokeWidth={fs * 0.28} paintOrder="stroke" dominantBaseline="middle" fontFamily="-apple-system, Helvetica, Arial, sans-serif">
            {a.label}{dashed ? ' (KI-Vorschlag)' : ''}
          </text>
        );
      })}
    </g>
  );
}

/** Foto mit Linien in festem Seitenverhältnis */
export function AnnotatedPhoto({ src, w, h, anns, types, className, maxHeightVh = 52 }: { src: string | null; w: number; h: number; anns: PhotoAnnotation[]; types: LineType[]; className?: string; maxHeightVh?: number }) {
  const ratio = w && h ? w / h : 4 / 3;
  return (
    <div className={`annotated ${className ?? ''}`} style={{ aspectRatio: String(ratio), maxWidth: `calc(${maxHeightVh}vh * ${ratio})` }}>
      {src && <img src={src} alt="" />}
      {anns.length > 0 && (
        <svg viewBox={`0 0 ${w || 1000} ${h || 750}`} preserveAspectRatio="none">
          <AnnotationLayer anns={anns} w={w || 1000} h={h || 750} types={types} />
        </svg>
      )}
    </div>
  );
}
