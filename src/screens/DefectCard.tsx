// Kompakte Mangel-Karte mit Foto, Status, Priorität, Frist und Standort.

import { Camera, ChevronRight } from 'lucide-react';
import type { Inspection, Note } from '../model/types';
import { usePhotoUrl } from '../camera/photoUrls';
import { NOTE_STATUS, PRIORITY } from './inspection/NotesTab';
import { formatDate } from '../pdf/generator';
import { relTime } from './common';
import { today } from '../model/factory';

export default function DefectCard({ n, insp, onClick, showProject }: { n: Note; insp: Inspection; onClick: () => void; showProject?: boolean }) {
  const photo = insp.photos.find((f) => f.noteId === n.id);
  const url = usePhotoUrl(photo?.id, 'thumb');
  const prio = n.priority ? PRIORITY[n.priority] : null;
  const pill = n.status === 'done' ? 'ok' : n.status === 'progress' ? 'warn' : n.status === 'open' ? 'danger' : '';
  const overdue = n.dueDate && n.status !== 'done' && n.dueDate < today().date;
  return (
    <button className="defect-card" onClick={onClick}>
      <span className="thumb">{url ? <img src={url} alt="" /> : <Camera size={22} />}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="hstack"><b className="ellipsis grow">{n.title || n.category || 'Mangel'}</b><span className={`badge ${overdue ? 'danger' : pill}`}>{overdue ? 'überfällig' : NOTE_STATUS[n.status]}</span></span>
        <span className="meta ellipsis" style={{ display: 'block' }}>
          {prio && <><span className="prio-dot" style={{ background: prio.color, marginRight: 4 }} />{prio.label} · </>}
          {n.dueDate ? `Frist ${formatDate(n.dueDate)} · ` : ''}{showProject ? `${insp.meta.projectName} · ` : ''}{relTime(n.createdAt)}
        </span>
        <span className="meta ellipsis" style={{ display: 'block' }}>
          📍 {n.position ? (n.address || 'Adresse wird ermittelt …') : 'ohne Standort'}
        </span>
        {n.position && <span className="meta ellipsis" style={{ display: 'block' }}>GPS {n.position.lat.toFixed(6)}, {n.position.lng.toFixed(6)}</span>}
      </span>
      <ChevronRight size={18} color="var(--text-3)" />
    </button>
  );
}
