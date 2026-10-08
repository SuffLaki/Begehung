import { useEffect, useState } from 'react';
import { Sparkles, Trash2, MapPin, CheckCircle2, PenLine } from 'lucide-react';
import { AnnotatedPhoto } from '../../annotate/AnnotationLayer';
import { legendText } from '../../annotate/lines';
import { useInspection } from '../../state/inspectionStore';
import { useApp, confirmDialog, toast, errorText } from '../../state/appStore';
import type { PhotoMeta } from '../../model/types';
import { usePhotoUrl } from '../../camera/photoUrls';
import { getPhotoBlob } from '../../storage/db';
import { aiConfigured, getAi } from '../../ai/ai';
import { formatCoord } from '../../geo/geo';
import { accuracyLabel } from '../../geo/gps';
import { orderedPoints } from '../../geo/routeOps';
import { pointDisplayName } from '../../model/factory';
import { Banner, Field, Row, SelectField, Sheet, Spinner, fmtDateTime } from '../../ui/kit';
import { useUi } from './actions';
import { useCanEdit } from './parts';
import { navigate } from '../../router';

type Draft = Pick<PhotoMeta, 'description' | 'category' | 'pointId' | 'noteId'>;

export default function PhotoSheet() {
  const id = useUi((s) => s.photoId);
  const insp = useInspection((s) => s.insp);
  const settings = useApp((s) => s.settings);
  const canEdit = useCanEdit();
  const f = insp?.photos.find((x) => x.id === id) ?? null;
  const url = usePhotoUrl(f?.id, 'full');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    setDraft(f ? { description: f.description, category: f.category, pointId: f.pointId, noteId: f.noteId } : null);
    setSuggestion(f?.aiSuggestion ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!insp || !f || !draft) return null;
  const mutate = useInspection.getState().mutate;

  function commit() {
    if (!f || !draft || !canEdit) return;
    const changed = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== f[k]);
    if (changed) mutate((d) => {
      const x = d.photos.find((q) => q.id === f.id);
      if (!x) return;
      if (draft.pointId !== x.pointId) x.pointAutoAssigned = false;
      Object.assign(x, draft);
    });
  }
  function close() { commit(); useUi.getState().set({ photoId: null }); }

  async function describe() {
    if (!settings.ai.allowPhotos) {
      toast('Fotoanalyse ist in den Einstellungen (KI-Assistent) nicht erlaubt.', 'error');
      return;
    }
    setAiBusy(true);
    try {
      const rec = await getPhotoBlob(f!.id);
      if (!rec) throw new Error('Foto nicht gefunden.');
      const pt = draft!.pointId ? insp!.route.points.find((p) => p.id === draft!.pointId) : null;
      const ctx = [pt?.title ? `Trassenpunkt: ${pt.title}` : '', draft!.category ? `Kategorie: ${draft!.category}` : ''].filter(Boolean).join('; ');
      const text = await getAi().describePhoto(rec.full, ctx);
      setSuggestion(text);
      mutate((d) => { const x = d.photos.find((q) => q.id === f!.id); if (x) x.aiSuggestion = text; }, { undoable: false });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setAiBusy(false);
    }
  }

  const points = orderedPoints(insp);
  const acc = accuracyLabel(f.position?.accuracy);
  return (
    <Sheet open onClose={close} title={`Foto ${f.number}`} full right={<button className="nav-btn" style={{ fontWeight: 600, marginTop: 8 }} onClick={close}>Fertig</button>}>
      <div className="stack">
        {url ? <AnnotatedPhoto src={url} w={f.width} h={f.height} anns={f.annotations ?? []} types={settings.lineTypes} /> : <div className="photo-view center" style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>}
        {(f.annotations?.length ?? 0) > 0 && <div className="small muted center">{legendText(f.annotations!, settings.lineTypes)}</div>}
        {canEdit && (
          <button className="btn block" onClick={() => { commit(); useUi.getState().set({ photoId: null, annotateId: f.id }); }}>
            <PenLine size={18} />{f.annotations?.length ? 'Linien bearbeiten' : 'Linien einzeichnen (Tiefbau, Leerrohr …)'}
          </button>
        )}

        {f.pointAutoAssigned && f.pointId && (
          <Banner kind="info">
            Automatisch dem nächstgelegenen Punkt <b>{pointDisplayName(insp.route.points.find((p) => p.id === f.pointId)!)}</b> zugeordnet.
            {canEdit && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => mutate((d) => { const x = d.photos.find((q) => q.id === f.id); if (x) x.pointAutoAssigned = false; })}><CheckCircle2 size={16} />Zuordnung bestätigen</button></div>}
          </Banner>
        )}

        <div className="list">
          <Field label="Beschreibung" multiline value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} placeholder="z. B. Wirtschaftsweg im Bereich der geplanten Trasse" readOnly={!canEdit} />
          <SelectField label="Trassenpunkt / Standort" value={draft.pointId ?? ''} onChange={(v) => setDraft({ ...draft, pointId: v || null })}
            options={[{ value: '', label: '– nicht zugeordnet –' }, ...points.map((p) => ({ value: p.id, label: `${pointDisplayName(p)}${p.title ? ' – ' + p.title : ''}` }))]} />
          <SelectField label="Notiz" value={draft.noteId ?? ''} onChange={(v) => setDraft({ ...draft, noteId: v || null })}
            options={[{ value: '', label: '– keine –' }, ...insp.notes.map((n) => ({ value: n.id, label: n.title || n.category || 'Notiz' }))]} />
          <SelectField label="Kategorie" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })}
            options={[{ value: '', label: '– keine –' }, ...settings.categories.map((c) => ({ value: c, label: c }))]} />
        </div>

        {canEdit && aiConfigured(settings.ai) && (
          <div className="card stack">
            <div className="hstack"><Sparkles size={18} color="var(--accent)" /><b className="grow">KI-Beschreibungsvorschlag</b></div>
            {suggestion ? (
              <>
                <div style={{ fontStyle: 'italic' }}>„{suggestion}“</div>
                <div className="small muted">Vorschlag der KI – bitte prüfen. Wird erst nach „Übernehmen“ verwendet.</div>
                <div className="btn-row">
                  <button className="btn sm primary" onClick={() => setDraft({ ...draft, description: draft.description ? `${draft.description}\n${suggestion}` : suggestion })}>Übernehmen</button>
                  <button className="btn sm" onClick={() => { setSuggestion(''); mutate((d) => { const x = d.photos.find((q) => q.id === f.id); if (x) x.aiSuggestion = ''; }, { undoable: false }); }}>Verwerfen</button>
                </div>
              </>
            ) : (
              <button className="btn sm" onClick={describe} disabled={aiBusy}>{aiBusy ? <><Spinner />Analysiere …</> : 'Foto beschreiben lassen'}</button>
            )}
            {!settings.ai.allowPhotos && <div className="small muted">Dafür in den Einstellungen „Fotos an KI senden“ erlauben.</div>}
          </div>
        )}

        <div className="list">
          <Row title="Aufgenommen" value={fmtDateTime(f.takenAt)} chevron={false} />
          <Row title="GPS" value={f.position ? formatCoord(f.position) : 'keine Position'} chevron={false} />
          {f.position && <Row title="Genauigkeit" value={acc.text} chevron={false} />}
          <Row title="Größe" value={`${f.width} × ${f.height} px`} chevron={false} />
        </div>

        <div className="list">
          {f.position && <Row icon={<MapPin size={16} />} iconBg="#0a84ff" title="Auf der Karte zeigen" onClick={() => { commit(); navigate(`/i/${insp.id}/map`, true); }} />}
          {canEdit && (
            <Row icon={<Trash2 size={16} />} iconBg="#ff3b30" danger title="Foto löschen" onClick={async () => {
              if (await confirmDialog({ title: `Foto ${f.number} löschen?`, confirmLabel: 'Löschen', destructive: true })) {
                mutate((d) => { d.photos = d.photos.filter((q) => q.id !== f.id); });
                useUi.getState().set({ photoId: null });
                toast('Foto gelöscht.', 'info', { label: 'Rückgängig', run: () => useInspection.getState().undo() });
              }
            }} />
          )}
        </div>
      </div>
    </Sheet>
  );
}
