// Ring-Diagramm (z. B. Mängel: erledigt / in Bearbeitung / offen)

export interface DonutPart { label: string; value: number; color: string }

export default function Donut({ parts, size = 150, totalLabel = 'Gesamt' }: { parts: DonutPart[]; size?: number; totalLabel?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label={`${totalLabel}: ${total}. ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--fill-strong)" strokeWidth="18" />
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.label} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
          off += len;
          return el;
        })}
        <text x="70" y="64" textAnchor="middle" fontSize="12" fill="var(--text-3)">{totalLabel}</text>
        <text x="70" y="88" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--text)">{total}</text>
      </svg>
      <div className="donut-legend">
        {parts.map((p) => (
          <span key={p.label}><i style={{ background: p.color }} />{p.label} <b>{p.value}</b></span>
        ))}
      </div>
    </div>
  );
}
