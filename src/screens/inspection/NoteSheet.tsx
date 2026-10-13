import { useEffect, useState } from 'react';
import { Camera, Navigation, Route as RouteIcon, Sparkles, Trash2, X } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, confirmDialog, toast } from '../../state/appStore';
import type { GeoFix, Note } from '../../model/types';
import { SITE_CATEGORIES, newNote, pointDisplayName } from '../../model/factory';
import { orderedPoints } from '../../geo/routeOps';
import { formatCoord } from '../../geo/geo';
import { fixIfAvailable } from '../../geo/gps';
import { Banner, Field, Row, Seg, SelectField, Sheet, fmtDateTime } from '../../ui/kit';
import { actionPhoto, actionVoice, useUi } from './actions';
import { useCanEdit } from './parts';
import { PhotoThumb } from './PhotosTab';
import { NOTE_STATUS, PRIORITY } from './NotesTab';
import { addressAllowed, enrichAddress } from '../../places/address';

type Draft = Pick<Note, 'kind' | 'title' | 'description' | 'category' | 'station' | 'hint' | 'status' | 'pointId' | 'position' | 'priority' | 'dueDate' | 'assignee'>;

export default function NoteSheet() {
  const noteId = useUi((s) => s.noteId);
  const prefill = useUi((s) => s.notePrefill);
  const insp = useInspection((s) => s.insp);
  const trassenCategories = useApp((s) => s.settings.categories);
  const categories = insp?.kind === 'baustelle' ? SITE_CATEGORIES : trassenCategories;
  const canEdit = useCanEdit();
  const isNew = noteId === 'new';
  const existing = !isNew ? insp?.notes.find((n) => n.id === noteId) ?? null : null;
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!noteId) { setDraft(null); return; }
    if (isNew) {
      const defect = !!prefill?.defect;
      const base: Draft = { kind: defect ? 'observation' : 'note', title: defect ? 'Mangel' : '', description: '', category: '', station: '', hint: '', status: defect ? 'open' : 'info', pointId: prefill?.pointId ?? null, position: null, priority: defect ? 'medium' : undefined };
      setDraft(base);
      void fixIfAvailable().then((fix: GeoFix | null) => fix && setDraft((d) => (d && !d.position ? { ...d, position: fix } : d)));
    } else if (existing) {
      setDraft({ kind: existing.kind, title: existing.title, description: existing.description, category: existing.category, station: existing.station, hint: existing.hint, status: existing.status, pointId: existing.pointId, position: existing.position, priority: existing.priority, dueDate: existing.dueDate, assignee: existing.assignee });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  if (!insp || !noteId || !draft || (!isNew && !existing)) return null;
  const mutate = useInspection.getState().mutate;
  const empty = !draft.title.trim() && !draft.description.trim();

  function save(confirm = true) {
    if (!canEdit) return;
    if (isNew) {
      if (empty) return;
      const n = newNote({ ...draft!, origin: 'text', confirmed: true });
      mutate((d) => { d.notes.push(n); });
      enrichAddress('note', n.id, n.position);
      toast('Notiz gespeichert.', 'success');
      return;
    }
    const e = existing!;
    const changed = (Object.keys(draft!) as (keyof Draft)[]).some((k) => draft![k] !== e[k]);
    if (changed || (confirm && !e.confirmed)) mutate((d) => {
      const x = d.notes.find((q) => q.id === e.id);
      if (!x) return;
      Object.assign(x, draft);
      x.updatedAt = Date.now();
      if (confirm) x.confirmed = true;
    });
  }
  function close(saveIt: boolean) {
    if (saveIt) save(false);
    useUi.getState().set({ noteId: null, notePrefill: null });
  }
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d!, [k]: v }));
  const photos = existing ? insp.photos.filter((f) => f.noteId === existing.id) : [];

  return (
    <Sheet open full onClose={() => close(!isNew)} title={isNew ? (prefill?.defect ? 'Mangel melden' : 'Neue Notiz') : draft.title || 'Notiz'}
      left={<button className="nav-btn" style={{ marginTop: 8 }} onClick={() => close(!isNew)}>{isNew ? 'Abbrechen' : <X size={22} />}</button>}
      right={canEdit ? <button className="nav-btn" style={{ fontWeight: 600, marginTop: 8 }} disabled={isNew && empty} onClick={() => { save(true); close(false); }}>{existing && !existing.confirmed ? 'Bestätigen' : 'Sichern'}</button> : <span />}>
      <div className="stack">
        {existing && !existing.confirmed && (
          <Banner icon={<Sparkles size={20} />}>
            <b>{existing.aiStructured ? 'Von der KI strukturiert' : 'Automatisch erstellt'}</b> – bitte prüfen, ggf. korrigieren und bestätigen. Die Originalaufnahme steht unten.
          </Banner>
        )}
        <Seg<Note['kind']> value={draft.kind} onChange={set('kind')} options={[{ value: 'note', label: 'Notiz' }, { value: 'observation', label: 'Beobachtung' }]} />
        <div className="list">
          <Field label="Titel" value={draft.title} onChange={set('title')} placeholder="kurz, z. B. Wirtschaftsweg kreuzt Trasse" readOnly={!canEdit} autoFocus={isNew} />
          <Field label="Beschreibung" multiline rows={4} value={draft.description} onChange={set('description')} placeholder="Was wurde festgestellt? (Diktat über die Tastatur möglich)" readOnly={!canEdit} />
          <Field label="Hinweis / zu prüfen" value={draft.hint} onChange={set('hint')} placeholder="z. B. Unterquerung prüfen" readOnly={!canEdit} />
          <div className="hstack" style={{ alignItems: 'stretch' }}>
            <div className="field grow">
              <label htmlFor="n-due">Frist</label>
              <input id="n-due" type="date" value={draft.dueDate ?? ''} readOnly={!canEdit} onChange={(e) => setDraft((d) => ({ ...d!, dueDate: e.target.value || undefined }))} />
            </div>
            <div className="field grow">
              <label htmlFor="n-assignee">Zuständig</label>
              <input id="n-assignee" list="n-assignees" value={draft.assignee ?? ''} readOnly={!canEdit} placeholder="Person / Firma" onChange={(e) => setDraft((d) => ({ ...d!, assignee: e.target.value || undefined }))} />
              <datalist id="n-assignees">{(insp.meta.participants ?? []).map((p) => <option key={p.id} value={p.company ? `${p.name} (${p.company})` : p.name} />)}</datalist>
            </div>
          </div>
          <Field label="Station" value={draft.station} onChange={set('station')} placeholder="z. B. 125 oder 0+125" readOnly={!canEdit} />
        </div>

        <div className="group-title" style={{ margin: '4px 4px 0' }}>Kategorie</div>
        <div className="chips">
          {categories.map((c) => (
            <button key={c} className={`chip${draft.category === c ? ' on' : ''}`} disabled={!canEdit} onClick={() => set('category')(draft.category === c ? '' : c)}>{c}</button>
          ))}
        </div>

        <div className="group-title" style={{ margin: '4px 4px 0' }}>Priorität</div>
        <div className="seg" role="tablist">
          {([['', '–'], ['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']] as const).map(([k, l]) => (
            <button key={k} className={(draft.priority ?? '') === k ? 'on' : ''} disabled={!canEdit} onClick={() => setDraft((d) => ({ ...d!, priority: (k || undefined) as Note['priority'] }))}>
              {k && <span className="prio-dot" style={{ background: PRIORITY[k].color, marginRight: 5 }} />}{l}
            </button>
          ))}
        </div>

        <div className="group-title" style={{ margin: '4px 4px 0' }}>Status</div>
        <Seg<Note['status']> value={draft.status} onChange={set('status')} options={(Object.keys(NOTE_STATUS) as Note['status'][]).map((k) => ({ value: k, label: NOTE_STATUS[k] }))} />

        <div className="list">
          <SelectField label="Trassenpunkt" value={draft.pointId ?? ''} onChange={(v) => set('pointId')(v || null)}
            options={[{ value: '', label: '– keiner –' }, ...orderedPoints(insp).map((p) => ({ value: p.id, label: `${pointDisplayName(p)}${p.title ? ' – ' + p.title : ''}` }))]} />
          {draft.position && <Row title="Adresse" value={existing?.address || (!addressAllowed() ? (navigator.onLine ? 'Adresssuche ausgeschaltet' : 'wird nachgetragen (offline)') : 'wird beim Sichern ermittelt …')} chevron={false} />}
          <Row title="Koordinaten" value={draft.position ? formatCoord(draft.position, 6) : 'keine'} chevron={false}
            right={canEdit ? (
              <button className="icon-btn" aria-label="Aktuelle Position übernehmen" onClick={async () => {
                const fix = await fixIfAvailable(15000);
                if (fix) set('position')(fix); else toast('Keine GPS-Position verfügbar.', 'error');
              }}><Navigation size={18} /></button>
            ) : undefined} />
          {existing && <Row title="Erstellt" value={fmtDateTime(existing.createdAt)} chevron={false} />}
        </div>

        {existing?.transcript && (
          <div className="card">
            <div className="small muted" style={{ marginBottom: 4 }}>Originalaufnahme (wörtlich)</div>
            <div style={{ fontStyle: 'italic' }}>„{existing.transcript}“</div>
            {canEdit && existing.category === 'Trassenverlauf' && (
              <button className="btn sm" style={{ marginTop: 10 }} onClick={() => { close(true); actionVoice('route', existing.transcript); }}><RouteIcon size={16} />Als Trassenverlauf übernehmen</button>
            )}
          </div>
        )}

        {existing && (
          <>
            <div className="group-title" style={{ margin: '4px 4px 0' }}>Fotos ({photos.length})</div>
            <div className="photo-strip">
              {canEdit && (
                <button className="photo-cell" style={{ width: 84, flex: 'none', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexDirection: 'column', fontSize: 12, gap: 4 }} onClick={() => actionPhoto({ noteId: existing.id, pointId: draft.pointId })}>
                  <Camera size={24} />Foto
                </button>
              )}
              {photos.map((f) => <PhotoThumb key={f.id} photo={f} onClick={() => { save(false); useUi.getState().set({ noteId: null, photoId: f.id }); }} />)}
            </div>
          </>
        )}
        {isNew && <div className="small muted">Fotos kannst du nach dem Sichern hinzufügen.</div>}

        {existing && canEdit && (
          <div className="list">
            <Row icon={<Trash2 size={16} />} iconBg="#ff3b30" danger title="Notiz löschen" onClick={async () => {
              if (await confirmDialog({ title: 'Notiz löschen?', confirmLabel: 'Löschen', destructive: true })) {
                mutate((d) => {
                  d.notes = d.notes.filter((n) => n.id !== existing.id);
                  d.photos.forEach((f) => { if (f.noteId === existing.id) f.noteId = null; });
                });
                close(false);
                toast('Notiz gelöscht.', 'info', { label: 'Rückgängig', run: () => useInspection.getState().undo() });
              }
            }} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
