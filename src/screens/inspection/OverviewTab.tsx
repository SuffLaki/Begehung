import { FileText, Flag, Lock, MapPin, Camera, StickyNote, AlertTriangle, CloudUpload, Unlock } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, confirmDialog } from '../../state/appStore';
import { navigate } from '../../router';
import { Banner, Nav, Row, SyncPill, fmtTime } from '../../ui/kit';
import { ActionBar, GpsLine, RecorderCard, UndoRedo } from './parts';
import { StatusBadge } from '../common';
import { formatDistance, hasUnscaledLength, routeLength } from '../../geo/geo';
import { activePlan } from '../../plans/plans';
import { FileImage } from 'lucide-react';
import { formatDate } from '../../pdf/generator';
import { pointDisplayName } from '../../model/factory';
import { useUi } from './actions';
import { can } from '../../model/permissions';

export function SaveState() {
  const dirty = useInspection((s) => s.dirty);
  const err = useInspection((s) => s.saveError);
  if (err) return <span className="pill off">Nicht gespeichert</span>;
  return <span className="pill">{dirty ? 'Speichert …' : 'Gespeichert'}</span>;
}

export default function OverviewTab() {
  const insp = useInspection((s) => s.insp)!;
  const saveError = useInspection((s) => s.saveError);
  const user = useApp((s) => s.settings.user);
  const pending = useApp((s) => s.pendingJobs);
  const ui = useUi();
  const m = insp.meta;
  const completed = insp.status === 'completed';

  const routePts = insp.route.points.filter((p) => p.kind === 'route');
  const auto = insp.route.points.filter((p) => !p.confirmed);
  const unplaced = insp.route.points.filter((p) => !p.position);
  const loose = insp.photos.filter((f) => !f.pointId && !f.noteId);
  const autoNotes = insp.notes.filter((n) => !n.confirmed);

  const activity = [
    ...insp.route.points.map((p) => ({ t: p.createdAt, icon: <MapPin size={16} />, title: `${pointDisplayName(p)}${p.title ? ' · ' + p.title : ''}`, sub: p.kind === 'marker' ? 'Markierung' : 'Trassenpunkt', go: () => ui.set({ pointId: p.id }) })),
    ...insp.photos.map((f) => ({ t: f.takenAt, icon: <Camera size={16} />, title: `Foto ${f.number}`, sub: f.description || 'ohne Beschreibung', go: () => ui.set({ photoId: f.id }) })),
    ...insp.notes.map((n) => ({ t: n.createdAt, icon: <StickyNote size={16} />, title: n.title || n.category || 'Notiz', sub: n.description, go: () => ui.set({ noteId: n.id }) })),
  ].sort((a, b) => b.t - a.t).slice(0, 6);

  return (
    <>
      <Nav backLabel="Start" onBack={() => navigate('/', true)} right={<UndoRedo />} />
      <div className="scroll with-tabs">
        <div className="insp-head">
          <div className="grow">
            <h1>{m.projectName || 'Ohne Projektname'}</h1>
            <div className="meta">{[m.projectNumber, `${formatDate(m.date)}${m.time ? ' ' + m.time : ''}`, m.inspector].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="status-row"><StatusBadge status={insp.status} /><SyncPill /><SaveState /></div>

        <div className="stack">
          {saveError && <Banner kind="danger">{saveError}</Banner>}
          {completed && (
            <Banner kind="ok" icon={<Lock size={20} />}>
              <b>Abgeschlossen</b> – schreibgeschützt.{' '}
              {can(user, 'inspection.edit') && (
                <button className="btn sm" style={{ marginTop: 8 }} onClick={async () => {
                  if (await confirmDialog({ title: 'Begehung wieder öffnen?', message: 'Danach kann sie wieder bearbeitet werden. Bereits erstellte PDFs bleiben unverändert.', confirmLabel: 'Wieder öffnen' })) {
                    useInspection.getState().mutate((d) => { d.status = 'in_progress'; d.completedAt = null; });
                  }
                }}><Unlock size={16} />Wieder öffnen</button>
              )}
            </Banner>
          )}

          {!completed && <ActionBar />}
          {!completed && activePlan(insp) && (
            <Banner kind="info" icon={<FileImage size={20} />} onClick={() => useUi.getState().set({ basemapOpen: true })}>
              <b>Plan als Grundlage:</b> {activePlan(insp)!.name}. Punkte und Linien auf dem Plan antippen – GPS wird dort nicht eingezeichnet.
            </Banner>
          )}
          {!completed && !activePlan(insp) && <GpsLine />}
          {!completed && !activePlan(insp) && <RecorderCard />}

          <div className="stats">
            <div className="stat"><b>{hasUnscaledLength(insp.route, insp.plans) && !routeLength(insp.route, insp.plans) ? '–' : formatDistance(routeLength(insp.route, insp.plans))}</b><span>{hasUnscaledLength(insp.route, insp.plans) ? 'Trasse*' : 'Trasse'}</span></div>
            <div className="stat"><b>{routePts.length}</b><span>Punkte</span></div>
            <div className="stat"><b>{insp.photos.length}</b><span>Fotos</span></div>
            <div className="stat"><b>{insp.notes.length}</b><span>Notizen</span></div>
          </div>

          {auto.length > 0 && (
            <Banner onClick={() => navigate(`/i/${insp.id}/map`, true)}>
              <b>{auto.length} automatisch ermittelte Punkt{auto.length === 1 ? '' : 'e'}</b> – Lage prüfen und bestätigen.
              {unplaced.length > 0 && ` ${unplaced.length} davon noch ohne Position.`}
            </Banner>
          )}
          {autoNotes.length > 0 && (
            <Banner onClick={() => navigate(`/i/${insp.id}/notes`, true)}><b>{autoNotes.length} KI-Notiz{autoNotes.length === 1 ? '' : 'en'}</b> warten auf Bestätigung.</Banner>
          )}
          {loose.length > 0 && (
            <Banner kind="info" icon={<Camera size={20} />} onClick={() => navigate(`/i/${insp.id}/photos`, true)}><b>{loose.length} Foto{loose.length === 1 ? '' : 's'}</b> ohne Zuordnung zu Punkt oder Notiz.</Banner>
          )}
          {pending > 0 && (
            <Banner kind="info" icon={<CloudUpload size={20} />}><b>{pending} Sprachaufnahme{pending === 1 ? '' : 'n'}</b> warten auf Internet und werden dann automatisch ausgewertet.</Banner>
          )}
        </div>

        <div className="group-title">Letzte Einträge</div>
        <div className="list timeline">
          {activity.length ? activity.map((a, i) => (
            <Row key={i} icon={a.icon} title={a.title} sub={<span className="ellipsis" style={{ display: 'block' }}>{fmtTime(a.t)} · {a.sub}</span>} onClick={a.go} />
          )) : <Row icon={<AlertTriangle size={16} />} title="Noch keine Einträge" sub="Standort, Foto, Sprache oder Notiz oben antippen" />}
        </div>

        <div className="stack" style={{ marginTop: 20 }}>
          {can(user, 'pdf.create') && (
            <button className="btn primary big block" onClick={() => navigate(`/i/${insp.id}/pdf`)}><FileText size={22} />Begehungsprotokoll erstellen</button>
          )}
          {!completed && can(user, 'inspection.edit') && (
            <button className="btn big block" onClick={() => navigate(`/i/${insp.id}/finish`)}><Flag size={20} />Begehung abschließen</button>
          )}
        </div>
      </div>
    </>
  );
}
