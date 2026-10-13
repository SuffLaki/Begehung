// Meldungen: alle Beobachtungen/Mängel und Notizen aus allen Begehungen.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, StickyNote } from 'lucide-react';
import type { Inspection, Note } from '../model/types';
import { listAllInspections } from '../storage/db';
import { navigate } from '../router';
import { Empty, Loading, Nav, Row } from '../ui/kit';
import AppTabs from '../ui/AppTabs';
import { relTime } from './common';
import { NOTE_STATUS, PRIORITY } from './inspection/NotesTab';
import { pointDisplayName } from '../model/factory';

type Filter = 'all' | 'open' | 'progress' | 'done';

export default function Meldungen() {
  const [all, setAll] = useState<Inspection[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  useEffect(() => { void listAllInspections().then(setAll); }, []);

  const items = useMemo(() => {
    const out: { n: Note; insp: Inspection }[] = [];
    for (const i of all ?? []) for (const n of i.notes) out.push({ n, insp: i });
    return out.sort((a, b) => b.n.createdAt - a.n.createdAt);
  }, [all]);
  const count = (f: Filter) => (f === 'all' ? items.length : items.filter((x) => x.n.status === f).length);
  const shown = items.filter((x) => filter === 'all' || x.n.status === filter);

  return (
    <div className="screen">
      <Nav title="Meldungen" />
      {!all ? <Loading /> : (
        <div className="scroll with-tabs">
          <div className="chips" style={{ margin: '8px 0 12px' }}>
            {([['all', 'Alle'], ['open', 'Offen'], ['progress', 'In Bearbeitung'], ['done', 'Erledigt']] as [Filter, string][]).map(([f, l]) => (
              <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{l} ({count(f)})</button>
            ))}
          </div>
          {!shown.length ? (
            <Empty icon={<Bell size={40} />} title={items.length ? 'Keine Meldungen in diesem Filter' : 'Noch keine Meldungen'} text={items.length ? undefined : 'Mängel und Beobachtungen aus den Begehungen erscheinen hier.'} />
          ) : (
            <div className="list">
              {shown.map(({ n, insp }) => {
                const pt = n.pointId ? insp.route.points.find((p) => p.id === n.pointId) : null;
                const prio = n.priority ? PRIORITY[n.priority] : null;
                const color = n.status === 'done' ? '#23824f' : prio ? prio.color : n.kind === 'observation' ? '#e0a100' : '#8e8e93';
                const title = pt ? `${pt.title || pointDisplayName(pt)}` : n.title || n.category || 'Notiz';
                const sub = [n.category || n.title, prio?.label].filter(Boolean).join(' · ');
                const pill = n.status === 'done' ? 'ok' : n.status === 'progress' ? 'accent' : n.status === 'open' ? 'danger' : '';
                return (
                  <Row key={n.id}
                    icon={n.status === 'done' ? <CheckCircle2 size={18} /> : n.kind === 'observation' ? <AlertTriangle size={17} /> : <StickyNote size={16} />}
                    iconBg={color}
                    title={<span className="hstack"><span className="ellipsis grow">{title}</span><span className={`badge ${pill}`}>{NOTE_STATUS[n.status]}</span></span>}
                    sub={<><div className="ellipsis">{sub || n.description}</div><div className="tiny ellipsis">{insp.meta.projectName} · {relTime(n.createdAt)}</div></>}
                    onClick={() => navigate(`/i/${insp.id}/notes?note=${n.id}`)} />
                );
              })}
            </div>
          )}
        </div>
      )}
      <AppTabs active="meldungen" />
    </div>
  );
}
