import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, GitBranch, Navigation, Plus, Scissors, Trash2, PenLine, StickyNote } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, confirmDialog, toast, errorText } from '../../state/appStore';
import type { RoutePoint } from '../../model/types';
import { pointDisplayName, SYMBOLS } from '../../model/factory';
import { branchFrom, deletePoint, endpoints, movePoint, segmentEndingAt, segmentsOfPoint, splitSegmentAt } from '../../geo/routeOps';
import { formatCoord } from '../../geo/geo';
import { accuracyLabel, currentFix } from '../../geo/gps';
import { Banner, Field, Row, SelectField, Sheet, fmtDateTime } from '../../ui/kit';
import { actionNote, actionPhoto, useUi } from './actions';
import { useCanEdit } from './parts';
import { PhotoThumb } from './PhotosTab';

const SOURCE: Record<RoutePoint['source'], string> = { gps: 'GPS', voice: 'Sprache (geschätzt)', manual: 'Manuell gesetzt', auto: 'Automatisch' };

type Draft = Pick<RoutePoint, 'label' | 'title' | 'category' | 'station' | 'description' | 'symbol'>;

export default function PointSheet() {
  const id = useUi((s) => s.pointId);
  const insp = useInspection((s) => s.insp);
  const categories = useApp((s) => s.settings.categories);
  const canEdit = useCanEdit();
  const p = insp?.route.points.find((x) => x.id === id) ?? null;
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    setDraft(p ? { label: p.label, title: p.title, category: p.category, station: p.station, description: p.description, symbol: p.symbol } : null);
    // nur beim Öffnen eines anderen Punktes neu laden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!insp || !p || !draft) return null;
  const mutate = useInspection.getState().mutate;

  function commit() {
    if (!p || !draft || !canEdit) return;
    const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== p[k]);
    if (changed) mutate((d) => {
      const x = d.route.points.find((q) => q.id === p.id);
      if (x) { Object.assign(x, draft); x.updatedAt = Date.now(); }
    });
  }
  function close() {
    commit();
    useUi.getState().set({ pointId: null });
  }
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d!, [k]: v }));

  const segs = segmentsOfPoint(insp, p.id);
  const { startIds, endIds } = endpoints(insp);
  const photos = insp.photos.filter((f) => f.pointId === p.id);
  const notes = insp.notes.filter((n) => n.pointId === p.id);
  const innerSeg = segs.find((s) => { const i = s.pointIds.indexOf(p.id); return i > 0 && i < s.pointIds.length - 1; });
  const role = startIds.has(p.id) ? 'Start' : endIds.has(p.id) ? 'Ende' : p.kind === 'marker' ? 'Markierung' : 'Trassenpunkt';
  const acc = accuracyLabel(p.accuracy);

  async function toGps() {
    try {
      const fix = await currentFix(10000);
      mutate((d) => { movePoint(d, p!.id, fix); const x = d.route.points.find((q) => q.id === p!.id)!; x.accuracy = fix.accuracy; x.source = 'gps'; });
      toast(`Auf GPS-Position gesetzt (±${Math.round(fix.accuracy ?? 0)} m).`, 'success');
    } catch (e) { toast(errorText(e), 'error'); }
  }

  return (
    <Sheet open onClose={close} title={`${pointDisplayName(p)} · ${role}`} right={<button className="nav-btn" style={{ fontWeight: 600, marginTop: 8 }} onClick={close}>Fertig</button>}>
      <div className="stack">
        {!p.confirmed && (
          <Banner>
            <b>Automatisch ermittelt</b> – {p.position ? 'Lage aus Sprachbeschreibung geschätzt.' : 'noch ohne Position.'}
            {p.estimate?.text && <div className="small" style={{ marginTop: 4 }}>„{p.estimate.text}“</div>}
            {canEdit && p.position && (
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={() => mutate((d) => { const x = d.route.points.find((q) => q.id === p.id); if (x) x.confirmed = true; })}><CheckCircle2 size={16} />Lage bestätigen</button>
              </div>
            )}
            {canEdit && <div className="small" style={{ marginTop: 6 }}>Zum Korrigieren auf der Karte „Bearbeiten“ wählen und den Punkt ziehen.</div>}
          </Banner>
        )}

        <div className="list">
          <Field label="Titel" value={draft.title} onChange={set('title')} placeholder="z. B. Wirtschaftsweg" readOnly={!canEdit} />
          <div className="hstack" style={{ alignItems: 'stretch' }}>
            <div className="grow"><Field label="Beschriftung (statt Nummer)" value={draft.label} onChange={set('label')} placeholder={`P${p.number}`} readOnly={!canEdit} /></div>
            <div style={{ width: '40%' }}><Field label="Station" value={draft.station} onChange={set('station')} placeholder="0+125" readOnly={!canEdit} /></div>
          </div>
          <SelectField label="Kategorie" value={draft.category} onChange={set('category')} options={[{ value: '', label: '– keine –' }, ...categories.map((c) => ({ value: c, label: c }))]} />
          <Field label="Beschreibung" multiline value={draft.description} onChange={set('description')} readOnly={!canEdit} />
        </div>

        {p.kind === 'marker' && (
          <>
            <div className="group-title" style={{ margin: '4px 4px 0' }}>Symbol</div>
            <div className="chips">
              {Object.entries(SYMBOLS).map(([k, s]) => (
                <button key={k} className={`chip${draft.symbol === k ? ' on' : ''}`} disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d!, symbol: k }))}>{s.glyph} {s.label}</button>
              ))}
            </div>
          </>
        )}

        <div className="list">
          <Row title="Koordinaten" value={p.position ? formatCoord(p.position) : 'nicht verortet'} chevron={false} />
          <Row title="Genauigkeit" value={p.source === 'gps' ? acc.text : p.source === 'voice' ? 'geschätzt' : 'manuell'} chevron={false} />
          <Row title="Quelle" value={SOURCE[p.source]} chevron={false} />
          {segs.length > 0 && <Row title="Abschnitt" value={segs.map((s) => s.name).join(', ')} chevron={false} />}
          <Row title="Erfasst" value={fmtDateTime(p.createdAt)} chevron={false} />
        </div>

        <div className="group-title" style={{ margin: '4px 4px 0' }}>Fotos ({photos.length})</div>
        <div className="photo-strip">
          {canEdit && (
            <button className="photo-cell" style={{ width: 84, flex: 'none', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexDirection: 'column', fontSize: 12, gap: 4 }} onClick={() => actionPhoto({ pointId: p.id })}>
              <Camera size={24} />Foto
            </button>
          )}
          {photos.map((f) => <PhotoThumb key={f.id} photo={f} onClick={() => useUi.getState().set({ pointId: null, photoId: f.id })} />)}
        </div>

        <div className="list">
          {notes.map((n) => <Row key={n.id} icon={<StickyNote size={16} />} iconBg="#ff9f0a" title={n.title || n.category || 'Notiz'} sub={n.description} onClick={() => { commit(); useUi.getState().set({ pointId: null, noteId: n.id }); }} />)}
          {canEdit && <Row icon={<Plus size={16} />} iconBg="#ff9f0a" title="Notiz zu diesem Punkt" onClick={() => { commit(); useUi.getState().set({ pointId: null }); actionNote(p.id); }} />}
        </div>

        {canEdit && (
          <div className="list">
            <Row icon={<Navigation size={16} />} iconBg="#0a84ff" title="Auf aktuelle GPS-Position setzen" onClick={toGps} />
            {p.kind === 'route' && (
              <Row icon={<PenLine size={16} />} iconBg="#34c759" title="Ab hier weiterzeichnen" sub="Neue Punkte werden hier angehängt" onClick={() => {
                mutate((d) => { const s = segmentEndingAt(d, p.id) ?? branchFrom(d, p.id); d.activeSegmentId = s.id; });
                toast('Neue Punkte werden ab hier angehängt.', 'success');
                close();
              }} />
            )}
            {p.kind === 'route' && (
              <Row icon={<GitBranch size={16} />} iconBg="#bf5af2" title="Abzweig ab hier" sub="Neuer Abschnitt beginnt an diesem Punkt" onClick={() => {
                mutate((d) => { branchFrom(d, p.id); });
                toast('Abzweig angelegt – tippe Punkte auf der Karte (Bearbeiten → Punkt).', 'success');
                close();
              }} />
            )}
            {innerSeg && (
              <Row icon={<Scissors size={16} />} iconBg="#ff9f0a" title="Abschnitt hier teilen" onClick={() => {
                mutate((d) => { splitSegmentAt(d, innerSeg.id, p.id); });
                toast('Abschnitt geteilt.', 'success');
              }} />
            )}
            <Row icon={<Trash2 size={16} />} iconBg="#ff3b30" danger title="Punkt löschen" onClick={async () => {
              const extra = photos.length || notes.length ? ` ${photos.length} Foto(s) und ${notes.length} Notiz(en) bleiben erhalten, verlieren aber die Zuordnung.` : '';
              if (await confirmDialog({ title: `${pointDisplayName(p)} löschen?`, message: `Der Punkt wird aus der Trasse entfernt.${extra}`, confirmLabel: 'Löschen', destructive: true })) {
                mutate((d) => deletePoint(d, p.id));
                useUi.getState().set({ pointId: null });
                toast('Punkt gelöscht.', 'info', { label: 'Rückgängig', run: () => useInspection.getState().undo() });
              }
            }} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
