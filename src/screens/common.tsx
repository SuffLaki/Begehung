import { ClipboardList } from 'lucide-react';
import type { InspectionStatus, InspectionSummaryRow } from '../model/types';
import { Row } from '../ui/kit';
import { navigate } from '../router';
import { formatDate } from '../pdf/generator';
import { formatDistance } from '../geo/geo';
import { today } from '../model/factory';

export const STATUS_TEXT: Record<InspectionStatus, string> = { draft: 'Geplant', in_progress: 'Aktiv', completed: 'Abgeschlossen' };

/** „Geplant“, wenn das Begehungsdatum in der Zukunft liegt */
export function statusOf(r: { status: InspectionStatus; date: string }): InspectionStatus {
  if (r.status === 'in_progress' && r.date > today().date) return 'draft';
  return r.status;
}

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return <span className={`badge ${status === 'completed' ? '' : status === 'in_progress' ? 'ok' : 'accent'}`}>{STATUS_TEXT[status]}</span>;
}

/** „Heute, 09:42“ / „Gestern, 16:21“ / „12.06.2026, 16:17“ */
export function relTime(ts: number): string {
  const d = new Date(ts);
  const t = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => x.toDateString();
  const now = new Date();
  const y = new Date(now.getTime() - 86400000);
  if (day(d) === day(now)) return `Heute, ${t}`;
  if (day(d) === day(y)) return `Gestern, ${t}`;
  return `${d.toLocaleDateString('de-DE')}, ${t}`;
}

export function InspectionRow({ r }: { r: InspectionSummaryRow }) {
  const sub = [
    r.projectNumber,
    `${formatDate(r.date)}${r.time ? ' ' + r.time : ''}`,
    r.inspector,
  ].filter(Boolean).join(' · ');
  const counts = [`${r.pointCount} Pkt.`, `${r.photoCount} Fotos`, `${r.noteCount} Notizen`, r.lengthM ? formatDistance(r.lengthM) : ''].filter(Boolean).join(' · ');
  return (
    <Row
      icon={<ClipboardList size={18} />}
      iconBg={r.status === 'completed' ? '#8e8e93' : 'var(--accent)'}
      title={<span className="hstack"><span className="ellipsis grow">{r.projectName || 'Ohne Projektname'}</span><StatusBadge status={statusOf(r)} /></span>}
      sub={<><div className="ellipsis">{sub}</div><div className="tiny ellipsis">{counts}</div></>}
      onClick={() => navigate(`/i/${r.id}`)}
    />
  );
}

export function isIosSafariBrowser(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone || window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}
