import { useState } from 'react';
import { ArrowLeftRight, Check, Link2, Plus, Trash2 } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { confirmDialog, toast } from '../../state/appStore';
import { SEGMENT_COLORS } from '../../model/factory';
import { deleteSegment, joinSegments, newEmptySegment, reverseSegment } from '../../geo/routeOps';
import { formatDistance, pathLength, segmentPositions } from '../../geo/geo';
import { Sheet } from '../../ui/kit';
import { useUi } from './actions';
import { useCanEdit } from './parts';

export default function SegmentsSheet() {
  const open = useUi((s) => s.segmentsOpen);
  const insp = useInspection((s) => s.insp);
  const canEdit = useCanEdit();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!open || !insp) return null;
  const mutate = useInspection.getState().mutate;
  const close = () => { useUi.getState().set({ segmentsOpen: false }); setOpenId(null); };

  return (
    <Sheet open onClose={close} title="Trassenabschnitte">
      <div className="stack">
        <div className="small muted">Neue Punkte werden an den <b>aktiven</b> Abschnitt angehängt. Abschnitte können eigene Farben haben, geteilt (am Punkt) und verbunden werden.</div>
        <div className="list">
          {insp.route.segments.map((s) => {
            const len = pathLength(segmentPositions(insp.route, s.pointIds));
            const active = s.id === insp.activeSegmentId;
            const expanded = openId === s.id;
            const others = insp.route.segments.filter((o) => o.id !== s.id);
            return (
              <div key={s.id} style={{ borderTop: '0.5px solid var(--sep)' }}>
                <button className="row" onClick={() => setOpenId(expanded ? null : s.id)}>
                  <span className="seg-swatch" style={{ background: s.color, width: 28, height: 8 }} />
                  <div className="row-main">
                    <div className="row-title">{s.name}</div>
                    <div className="row-sub">{s.pointIds.length} Punkte · {formatDistance(len)}{s.source === 'gps' ? ' · GPS' : s.source === 'voice' ? ' · Sprache' : ''}</div>
                  </div>
                  {active && <span className="badge accent">aktiv</span>}
                </button>
                {expanded && canEdit && (
                  <div className="stack" style={{ padding: '0 16px 14px' }}>
                    <input className="input" value={s.name} aria-label="Name des Abschnitts" onChange={(e) => mutate((d) => { const x = d.route.segments.find((q) => q.id === s.id); if (x) x.name = e.target.value; }, { undoable: false })} />
                    <div className="hstack" style={{ flexWrap: 'wrap' }}>
                      {SEGMENT_COLORS.map((c) => (
                        <button key={c} className={`color-dot${s.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Farbe ${c}`} onClick={() => mutate((d) => { const x = d.route.segments.find((q) => q.id === s.id); if (x) x.color = c; })} />
                      ))}
                    </div>
                    <div className="btn-row" style={{ flexWrap: 'wrap' }}>
                      {!active && <button className="btn sm" onClick={() => { mutate((d) => { d.activeSegmentId = s.id; }); toast(`${s.name} ist aktiv.`); }}><Check size={16} />Aktiv</button>}
                      <button className="btn sm" onClick={() => mutate((d) => reverseSegment(d, s.id))}><ArrowLeftRight size={16} />Umdrehen</button>
                    </div>
                    {others.length > 0 && (
                      <select className="input" value="" aria-label="Verbinden mit" onChange={(e) => {
                        const other = e.target.value;
                        if (!other) return;
                        let ok = false;
                        mutate((d) => { ok = joinSegments(d, s.id, other); });
                        toast(ok ? 'Abschnitte verbunden.' : 'Verbinden nicht möglich.', ok ? 'success' : 'error');
                      }}>
                        <option value="">Verbinden mit …</option>
                        {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    )}
                    <button className="btn sm danger" onClick={async () => {
                      if (!await confirmDialog({ title: `${s.name} löschen?`, confirmLabel: 'Löschen', destructive: true })) return;
                      const withPoints = s.pointIds.length > 0 && await confirmDialog({
                        title: 'Punkte auch löschen?',
                        message: 'Punkte, die auch in anderen Abschnitten liegen, bleiben in jedem Fall erhalten.',
                        confirmLabel: 'Punkte löschen', cancelLabel: 'Punkte behalten', destructive: true,
                      });
                      mutate((d) => deleteSegment(d, s.id, withPoints));
                      setOpenId(null);
                      toast('Abschnitt gelöscht.', 'info', { label: 'Rückgängig', run: () => useInspection.getState().undo() });
                    }}><Trash2 size={16} />Löschen</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button className="btn block" onClick={() => { mutate((d) => { newEmptySegment(d); }); toast('Neuer Abschnitt ist aktiv – Punkte auf der Karte setzen.', 'success'); close(); }}>
            <Plus size={18} />Neuer Abschnitt
          </button>
        )}
        <div className="small muted"><Link2 size={12} /> Abzweige legst du am Punkt an: Punkt antippen → „Abzweig ab hier“.</div>
      </div>
    </Sheet>
  );
}
