import { useEffect, useRef } from 'react';

/** Unterschriftenfeld (Finger/Stift). Liefert ein PNG als Data-URL. */
export default function SignaturePad({ onChange, initial }: { onChange: (dataUrl: string) => void; initial?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext('2d')!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#0b1f4d';
    if (initial) {
      const img = new Image();
      img.onload = () => g.drawImage(img, 0, 0, c.clientWidth, c.clientHeight);
      img.src = initial;
    }
  }, [initial]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <canvas
      ref={ref}
      className="sig-pad"
      aria-label="Unterschriftenfeld"
      onPointerDown={(e) => {
        drawing.current = true;
        ref.current!.setPointerCapture(e.pointerId);
        const g = ref.current!.getContext('2d')!;
        const [x, y] = pos(e);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 0.1, y + 0.1);
        g.stroke();
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const g = ref.current!.getContext('2d')!;
        const [x, y] = pos(e);
        g.lineTo(x, y);
        g.stroke();
        dirty.current = true;
      }}
      onPointerUp={() => {
        drawing.current = false;
        if (dirty.current) onChange(ref.current!.toDataURL('image/png'));
      }}
    />
  );
}

