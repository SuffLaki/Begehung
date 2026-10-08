import { useEffect, useState } from 'react';
import { FileImage, FileText, Flag, PenTool, ClipboardEdit, ListChecks, Sparkles, Share2, Trash2, Download, Plus, Check, Archive, Mail } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, confirmDialog, toast, errorText } from '../../state/appStore';
import { navigate } from '../../router';
import { Banner, Field, Nav, Row, Sheet, Spinner, fmtDateTime } from '../../ui/kit';
import SignaturePad from '../../ui/SignaturePad';
import { can } from '../../model/permissions';
import { newTask } from '../../model/factory';
import { aiConfigured, getAi } from '../../ai/ai';
import { deleteInspection, deleteReport, listReports } from '../../storage/db';
import { exportInspection } from '../../storage/backup';
import { shareFile } from '../../share/share';
import type { Report } from '../../model/types';
import { useCanEdit, UndoRedo } from './parts';
import { pointDisplayName } from '../../model/factory';
import { MailSheet } from '../PdfPreview';
import { useUi } from './actions';

export default function MoreTab() {
  const insp = useInspection((s) => s.insp)!;
  const user = useApp((s) => s.settings.user);
  const canEdit = useCanEdit();
  const [sheet, setSheet] = useState<'tasks' | 'summary' | 'signature' | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [mailReport, setMailReport] = useState<Report | null>(null);
  const [backup, setBackup] = useState<{ blob: Blob; fileName: string } | null>(null);

  useEffect(() => { void listReports(insp.id).then(setReports); }, [insp.id]);

  const openTasks = insp.tasks.filter((t) => !t.done).length;

  return (
    <>
      <Nav title="Mehr" backLabel="Start" onBack={() => navigate('/', true)} right={<UndoRedo />} />
      <div className="scroll with-tabs">
        <div className="group-title">Begehung</div>
        <div className="list">
          <Row icon={<FileImage size={16} />} iconBg="#5e5ce6" title="Pläne / Kartengrundlage" value={insp.basemap?.kind === 'plan' ? (insp.plans?.find((p) => insp.basemap?.kind === 'plan' && p.id === insp.basemap.planId)?.name ?? 'Plan') : 'Landkarte'} onClick={() => useUi.getState().set({ basemapOpen: true })} />
          <Row icon={<ClipboardEdit size={16} />} iconBg="#0a84ff" title="Projektdaten" sub={[insp.meta.projectNumber, insp.meta.client].filter(Boolean).join(' · ') || 'Projekt, Datum, Begeher …'} onClick={() => navigate(`/i/${insp.id}/meta`)} />
          <Row icon={<ListChecks size={16} />} iconBg="#34c759" title="Aufgaben" value={insp.tasks.length ? `${openTasks} offen` : ''} onClick={() => setSheet('tasks')} />
          <Row icon={<Sparkles size={16} />} iconBg="#bf5af2" title="Zusammenfassung" value={insp.summary ? (insp.summary.confirmed ? 'bestätigt' : 'zu prüfen') : ''} onClick={() => setSheet('summary')} />
          <Row icon={<PenTool size={16} />} iconBg="#5e5ce6" title="Unterschrift / Freigabe" value={insp.signature ? 'unterschrieben' : ''} onClick={() => setSheet('signature')} />
        </div>

        <div className="group-title">Protokoll</div>
        <div className="list">
          {can(user, 'pdf.create') && <Row icon={<FileText size={16} />} iconBg="#ff3b30" title="Begehungsprotokoll erstellen" onClick={() => navigate(`/i/${insp.id}/pdf`)} />}
          {insp.status !== 'completed' && canEdit && <Row icon={<Flag size={16} />} iconBg="#ff9f0a" title="Begehung abschließen" onClick={() => navigate(`/i/${insp.id}/finish`)} />}
        </div>

        {reports && reports.length > 0 && (
          <>
            <div className="group-title">Erstellte PDFs</div>
            <div className="list">
              {reports.map((r) => (
                <div key={r.id} className="row">
                  <div className="row-main">
                    <div className="row-title ellipsis">{r.fileName}</div>
                    <div className="row-sub">{fmtDateTime(r.createdAt)} · {r.pageCount} Seiten · {(r.pdf.size / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                  <button className="icon-btn" aria-label="Teilen" onClick={() => { shareFile(r.pdf, r.fileName, { title: r.fileName }).catch((e) => toast(errorText(e), 'error')); }}><Share2 size={20} /></button>
                  <button className="icon-btn" aria-label="Per E-Mail" onClick={() => setMailReport(r)}><Mail size={20} /></button>
                  <button className="icon-btn" aria-label="Löschen" style={{ color: 'var(--danger)' }} onClick={async () => {
                    if (await confirmDialog({ title: 'PDF löschen?', message: r.fileName, confirmLabel: 'Löschen', destructive: true })) {
                      await deleteReport(r.id);
                      setReports(await listReports(insp.id));
                    }
                  }}><Trash2 size={18} /></button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="group-title">Daten</div>
        <div className="list">
          <Row icon={<Archive size={16} />} iconBg="#30b0c7" title="Sicherung erstellen" sub="Begehung inkl. Fotos als Datei (für Backup / anderes Gerät)" onClick={async () => {
            try {
              toast('Sicherung wird erstellt …');
              setBackup(await exportInspection(insp.id));
            } catch (e) { toast(errorText(e), 'error'); }
          }} />
          {can(user, 'inspection.delete') && (
            <Row icon={<Trash2 size={16} />} iconBg="#ff3b30" danger title="Begehung löschen" onClick={async () => {
              if (await confirmDialog({ title: 'Begehung endgültig löschen?', message: `„${insp.meta.projectName}“ mit ${insp.photos.length} Fotos und allen PDFs wird von diesem Gerät gelöscht. Das kann nicht rückgängig gemacht werden.`, confirmLabel: 'Löschen', destructive: true })) {
                await useInspection.getState().close();
                await deleteInspection(insp.id);
                toast('Begehung gelöscht.');
                navigate('/', true);
              }
            }} />
          )}
        </div>
        <div className="group-foot">Alle Daten liegen nur auf diesem Gerät. Regelmäßig Sicherungen erstellen oder PDFs teilen.</div>
      </div>

      <TasksSheet open={sheet === 'tasks'} onClose={() => setSheet(null)} />
      <SummarySheet open={sheet === 'summary'} onClose={() => setSheet(null)} />
      <SignatureSheet open={sheet === 'signature'} onClose={() => setSheet(null)} />
      {mailReport && <MailSheet report={mailReport} onClose={() => setMailReport(null)} />}
      <Sheet open={!!backup} onClose={() => setBackup(null)} title="Sicherung bereit">
        {backup && (
          <div className="stack">
            <div>{backup.fileName} · {(backup.blob.size / 1024 / 1024).toFixed(1)} MB</div>
            <button className="btn primary big block" onClick={() => { shareFile(backup.blob, backup.fileName).then(() => setBackup(null)).catch((e) => toast(errorText(e), 'error')); }}>
              <Download size={20} />Sichern / Teilen
            </button>
            <div className="small muted">Im Teilen-Menü z. B. „In Dateien sichern“ wählen. Einlesen auf der Startseite über „Importieren“.</div>
          </div>
        )}
      </Sheet>
    </>
  );
}

function TasksSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insp = useInspection((s) => s.insp)!;
  const canEdit = useCanEdit();
  const [text, setText] = useState('');
  const mutate = useInspection.getState().mutate;
  const add = () => {
    if (!text.trim()) return;
    mutate((d) => { d.tasks.push(newTask(text.trim())); });
    setText('');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Aufgaben" full>
      <div className="stack">
        {canEdit && (
          <div className="hstack">
            <input className="input grow" value={text} placeholder="Neue Aufgabe, z. B. Eigentümer Flst. 123 kontaktieren" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button className="btn primary" style={{ flex: '0 0 52px', padding: 0 }} onClick={add} aria-label="Hinzufügen"><Plus size={22} /></button>
          </div>
        )}
        {!insp.tasks.length && <div className="muted center" style={{ padding: 20 }}>Noch keine Aufgaben. Offene Punkte aus Notizen erscheinen zusätzlich automatisch im Protokoll.</div>}
        <div className="list">
          {insp.tasks.map((t) => (
            <div key={t.id} style={{ borderTop: '0.5px solid var(--sep)', padding: '10px 16px' }}>
              <div className="hstack">
                <button className={`check`} style={{ padding: 0 }} disabled={!canEdit} aria-label={t.done ? 'Als offen markieren' : 'Als erledigt markieren'} onClick={() => mutate((d) => { const x = d.tasks.find((q) => q.id === t.id); if (x) x.done = !x.done; })}>
                  <span className={`ci ${t.done ? 'ok' : ''}`} style={{ border: t.done ? 0 : '2px solid var(--text-3)', width: 26, height: 26, borderRadius: 13, display: 'flex' }}>{t.done && <Check size={16} />}</span>
                </button>
                <input className="grow" style={{ border: 0, background: 'transparent', fontSize: 17, outline: 0, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--text-3)' : undefined }} value={t.text} readOnly={!canEdit}
                  onChange={(e) => mutate((d) => { const x = d.tasks.find((q) => q.id === t.id); if (x) x.text = e.target.value; }, { undoable: false })} />
                {canEdit && <button className="icon-btn" aria-label="Aufgabe löschen" onClick={() => mutate((d) => { d.tasks = d.tasks.filter((q) => q.id !== t.id); })}><Trash2 size={18} color="var(--danger)" /></button>}
              </div>
              <div className="hstack" style={{ marginLeft: 36, marginTop: 6 }}>
                <input className="input" style={{ padding: '6px 10px', fontSize: 15 }} placeholder="zuständig" value={t.assignee} readOnly={!canEdit} onChange={(e) => mutate((d) => { const x = d.tasks.find((q) => q.id === t.id); if (x) x.assignee = e.target.value; }, { undoable: false })} />
                <input className="input" style={{ padding: '6px 10px', fontSize: 15, width: 150 }} type="date" value={t.due} readOnly={!canEdit} onChange={(e) => mutate((d) => { const x = d.tasks.find((q) => q.id === t.id); if (x) x.due = e.target.value; }, { undoable: false })} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function SummarySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insp = useInspection((s) => s.insp)!;
  const ai = useApp((s) => s.settings.ai);
  const canEdit = useCanEdit();
  const [text, setText] = useState(insp.summary?.text ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(insp.summary?.text ?? ''); }, [open, insp.summary?.text]);
  const mutate = useInspection.getState().mutate;

  async function generate() {
    const lines: string[] = [];
    const m = insp.meta;
    lines.push(`Projekt: ${m.projectName}; Datum: ${m.date}; Bereich: ${m.site}`);
    if (m.remarks) lines.push(`Allgemeine Bemerkungen: ${m.remarks}`);
    for (const n of insp.notes) {
      const pt = n.pointId ? insp.route.points.find((p) => p.id === n.pointId) : null;
      lines.push(`- [${n.status}] ${n.title}${n.category ? ` (${n.category})` : ''}${n.station ? `, Station ${n.station}` : ''}${pt ? `, ${pointDisplayName(pt)}` : ''}: ${n.description}${n.hint ? ` Hinweis: ${n.hint}` : ''}`);
    }
    for (const p of insp.route.points) if (p.title || p.description) lines.push(`- Punkt ${pointDisplayName(p)}: ${p.title} ${p.description}`.trim());
    for (const t of insp.tasks) lines.push(`- Aufgabe${t.done ? ' (erledigt)' : ''}: ${t.text}`);
    if (lines.length < 2) { toast('Noch zu wenig Notizen für eine Zusammenfassung.', 'error'); return; }
    setBusy(true);
    try {
      const out = await getAi().summarize(lines.join('\n'));
      setText(out);
      mutate((d) => { d.summary = { text: out, source: 'ai', confirmed: false, updatedAt: Date.now() }; });
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Zusammenfassung" full>
      <div className="stack">
        {insp.summary && !insp.summary.confirmed && <Banner icon={<Sparkles size={20} />}><b>KI-Entwurf</b> – bitte prüfen, bearbeiten und bestätigen. Nur bestätigte Zusammenfassungen kommen ins Protokoll.</Banner>}
        <textarea className="input" rows={10} value={text} readOnly={!canEdit} onChange={(e) => setText(e.target.value)} placeholder="Zusammenfassung der Begehung …" />
        {canEdit && (
          <>
            <button className="btn primary big block" disabled={!text.trim()} onClick={() => {
              mutate((d) => { d.summary = { text: text.trim(), source: d.summary?.source ?? 'manual', confirmed: true, updatedAt: Date.now() }; });
              toast('Zusammenfassung bestätigt.', 'success');
              onClose();
            }}><Check size={20} />Bestätigen & speichern</button>
            {aiConfigured(ai) && <button className="btn block" onClick={generate} disabled={busy}>{busy ? <><Spinner />Erstelle …</> : <><Sparkles size={18} />Mit KI aus den Notizen erstellen</>}</button>}
            <div className="small muted">Die KI fasst nur zusammen, was in Notizen, Punkten und Aufgaben steht.</div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function SignatureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insp = useInspection((s) => s.insp)!;
  const canEdit = useCanEdit();
  const [name, setName] = useState(insp.signature?.name ?? insp.meta.inspector);
  const [role, setRole] = useState(insp.signature?.role ?? '');
  const [place, setPlace] = useState(insp.signature?.place ?? '');
  const [img, setImg] = useState(insp.signature?.dataUrl ?? '');
  const [initialImg, setInitialImg] = useState(insp.signature?.dataUrl ?? '');
  const [padKey, setPadKey] = useState(0);
  const mutate = useInspection.getState().mutate;
  return (
    <Sheet open={open} onClose={onClose} title="Unterschrift" full>
      <div className="stack">
        <div className="list">
          <Field label="Name" value={name} onChange={setName} readOnly={!canEdit} />
          <Field label="Funktion" value={role} onChange={setRole} placeholder="z. B. Bauleiter" readOnly={!canEdit} />
          <Field label="Ort" value={place} onChange={setPlace} readOnly={!canEdit} />
        </div>
        {canEdit ? (
          <>
            <div className="small muted">Mit dem Finger unterschreiben:</div>
            <SignaturePad key={padKey} initial={initialImg} onChange={setImg} />
            <div className="btn-row">
              <button className="btn" onClick={() => { setImg(''); setInitialImg(''); setPadKey((k) => k + 1); }}>Löschen</button>
              <button className="btn primary" disabled={!img} onClick={() => {
                mutate((d) => { d.signature = { name, role, place, dataUrl: img, signedAt: Date.now() }; });
                toast('Unterschrift gespeichert.', 'success');
                onClose();
              }}>Speichern</button>
            </div>
          </>
        ) : img ? <img src={img} alt="Unterschrift" style={{ background: '#fff', borderRadius: 12, width: '100%' }} /> : <div className="muted">Keine Unterschrift.</div>}
        {insp.signature && <div className="small muted">Unterschrieben am {fmtDateTime(insp.signature.signedAt)}</div>}
      </div>
    </Sheet>
  );
}
