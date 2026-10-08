import { useState } from 'react';
import { Mic, PencilLine, StickyNote, Eye, Sparkles } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import type { Note } from '../../model/types';
import { pointDisplayName } from '../../model/factory';
import { Empty, Nav, Row, Seg, fmtTime } from '../../ui/kit';
import { actionNote, actionVoice, useUi } from './actions';
import { useCanEdit, UndoRedo } from './parts';
import { navigate } from '../../router';

type Filter = 'all' | 'open' | 'review';

export const NOTE_STATUS: Record<Note['status'], string> = { open: 'offen', done: 'erledigt', info: 'zur Info' };

export default function NotesTab() {
  const insp = useInspection((s) => s.insp)!;
  const canEdit = useCanEdit();
  const [filter, setFilter] = useState<Filter>('all');
  const review = insp.notes.filter((n) => !n.confirmed).length;
  const notes = [...insp.notes].reverse().filter((n) => (filter === 'open' ? n.status === 'open' : filter === 'review' ? !n.confirmed : true));

  return (
    <>
      <Nav title="Notizen" backLabel="Start" onBack={() => navigate('/', true)} right={<UndoRedo />} />
      <div className="scroll with-tabs">
        {canEdit && (
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button className="btn big" onClick={() => actionVoice('note')}><Mic size={22} color="#ff375f" />Sprache</button>
            <button className="btn primary big" onClick={() => actionNote()}><PencilLine size={22} />Notiz</button>
          </div>
        )}
        {insp.notes.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Seg<Filter> value={filter} onChange={setFilter} options={[
              { value: 'all', label: `Alle (${insp.notes.length})` },
              { value: 'open', label: 'Offen' },
              { value: 'review', label: `Zu prüfen (${review})` },
            ]} />
          </div>
        )}
        {notes.length ? (
          <div className="list">
            {notes.map((n) => {
              const pt = n.pointId ? insp.route.points.find((p) => p.id === n.pointId) : null;
              const sub = [n.category, n.station && `Stat. ${n.station}`, pt && pointDisplayName(pt), fmtTime(n.createdAt)].filter(Boolean).join(' · ');
              return (
                <Row key={n.id}
                  className={`note-row ${n.kind} ${n.status}`}
                  icon={n.origin === 'voice' ? <Mic size={16} /> : <StickyNote size={16} />}
                  title={<span className="hstack"><span className="grow ellipsis">{n.title || n.category || 'Notiz'}</span>
                    {!n.confirmed && <span className="badge warn"><Sparkles size={11} />prüfen</span>}
                    {n.status === 'open' && n.confirmed && <span className="badge accent">offen</span>}
                    {n.status === 'info' && <span className="badge"><Eye size={11} />Info</span>}
                  </span>}
                  sub={<><div className="ellipsis">{sub}</div>{n.description && <div className="ellipsis tiny">{n.description}</div>}</>}
                  onClick={() => useUi.getState().set({ noteId: n.id })}
                />
              );
            })}
          </div>
        ) : (
          <Empty icon={<StickyNote size={44} />} title={insp.notes.length ? 'Keine Notizen in diesem Filter' : 'Noch keine Notizen'} text={insp.notes.length ? undefined : 'Beobachtungen per Sprache oder Text erfassen. Die KI kann gesprochene Beobachtungen strukturieren.'} />
        )}
      </div>
    </>
  );
}
