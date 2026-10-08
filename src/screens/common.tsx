import { ClipboardList } from 'lucide-react';
import type { InspectionStatus, InspectionSummaryRow } from '../model/types';
import { Row } from '../ui/kit';
import { navigate } from '../router';
import { formatDate } from '../pdf/generator';
import { formatDistance } from '../geo/geo';

export const STATUS_TEXT: Record<InspectionStatus, string> = { draft: 'Entwurf', in_progress: 'In Bearbeitung', completed: 'Abgeschlossen' };

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return <span className={`badge ${status === 'completed' ? 'ok' : status === 'in_progress' ? 'accent' : ''}`}>{STATUS_TEXT[status]}</span>;
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
      iconBg={r.status === 'completed' ? '#34c759' : '#0a84ff'}
      title={<span className="hstack"><span className="ellipsis grow">{r.projectName || 'Ohne Projektname'}</span><StatusBadge status={r.status} /></span>}
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
