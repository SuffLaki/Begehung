// PDF-Vorschau mit Blättern, Erstellen, Teilen und E-Mail.

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Pencil, Share2, Mail, Check, AlertTriangle, Copy } from 'lucide-react';
import { useInspection } from '../state/inspectionStore';
import { useApp, toast, errorText } from '../state/appStore';
import { navigate } from '../router';
import { Field, Loading, Sheet, SwitchRow } from '../ui/kit';
import { generatePdf, reportFileName } from '../pdf/generator';
import { renderPdfPages, releasePages, type RenderedPage } from '../pdf/preview';
import { getTemplate, saveReport } from '../storage/db';
import { uid } from '../model/factory';
import type { MailDefaults, Report } from '../model/types';
import { canShareFiles, copyText, mailDraft, mailtoUrl, shareFile } from '../share/share';

export default function PdfPreview({ id }: { id: string }) {
  const insp = useInspection((s) => s.insp);
  const settings = useApp((s) => s.settings);
  const [progress, setProgress] = useState('Wird vorbereitet …');
  const [error, setError] = useState('');
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [pdf, setPdf] = useState<{ blob: Blob; fileName: string; pageCount: number; warnings: string[] } | null>(null);
  const [saved, setSaved] = useState<Report | null>(null);
  const [current, setCurrent] = useState(0);
  const [mailOpen, setMailOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let rendered: RenderedPage[] = [];
    (async () => {
      try {
        if (!(await useInspection.getState().load(id))) throw new Error('Begehung nicht gefunden.');
        await useInspection.getState().flush();
        const i = useInspection.getState().insp!;
        const tpl = await getTemplate(i.pdfSettings.templateId);
        const res = await generatePdf(i, useApp.getState().settings, tpl, (m) => alive && setProgress(m));
        if (!alive) return;
        const blob = new Blob([res.bytes as BlobPart], { type: 'application/pdf' });
        setPdf({ blob, fileName: reportFileName(i), pageCount: res.pageCount, warnings: res.warnings });
        setProgress('Vorschau wird gerendert …');
        rendered = await renderPdfPages(res.bytes, Math.min(1400, Math.round(window.innerWidth * (window.devicePixelRatio || 1))), (n, total) => alive && setProgress(`Vorschau Seite ${n} von ${total} …`));
        if (alive) setPages(rendered);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => { alive = false; releasePages(rendered); };
  }, [id]);

  async function store(): Promise<Report | null> {
    if (!pdf || !insp) return null;
    if (saved) return saved;
    const r: Report = { id: uid('r'), inspectionId: insp.id, fileName: pdf.fileName, pdf: pdf.blob, pageCount: pdf.pageCount, createdAt: Date.now() };
    try {
      await saveReport(r);
      setSaved(r);
      return r;
    } catch (e) {
      toast(`PDF konnte nicht gespeichert werden: ${errorText(e)}`, 'error');
      return null;
    }
  }

  function share() {
    if (!pdf) return;
    // erst teilen (braucht die Benutzeraktion), dann im Hintergrund speichern
    const p = shareFile(pdf.blob, pdf.fileName, { title: pdf.fileName });
    void store();
    p.then((o) => { if (o === 'downloaded') toast('PDF heruntergeladen.', 'success'); }).catch((e) => toast(errorText(e), 'error'));
  }

  const onScroll = () => {
    const el = scroller.current;
    if (el) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  };

  if (error) {
    return (
      <div className="screen">
        <PreviewNav id={id} />
        <div className="loading-full"><AlertTriangle size={40} color="var(--danger)" /><b>PDF konnte nicht erstellt werden</b><div>{error}</div>
          <button className="btn" onClick={() => navigate(`/i/${id}/pdf`, true)}>PDF bearbeiten</button></div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PreviewNav id={id} />
      {!pages.length ? <Loading text={progress} /> : (
        <div className="preview">
          <div className="preview-pages" ref={scroller} onScroll={onScroll}>
            {pages.map((p, i) => (
              <div className="preview-page" key={i}><img src={p.url} alt={`Seite ${i + 1}`} /></div>
            ))}
          </div>
          <div className="page-ind">Seite {current + 1} von {pages.length} · wischen zum Blättern</div>
        </div>
      )}
      <div className="preview-bar">
        {pdf && pdf.warnings.length > 0 && (
          <div className="small" style={{ color: 'var(--warn)' }}>{pdf.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>
        )}
        <div className="btn-row">
          <button className="btn" onClick={() => navigate(`/i/${id}`, true)}><ChevronLeft size={18} />Zurück</button>
          <button className="btn" onClick={() => navigate(`/i/${id}/pdf`, true)}><Pencil size={16} />PDF bearbeiten</button>
        </div>
        <div className="btn-row">
          <button className="btn primary" disabled={!pdf || !!saved} onClick={async () => { if (await store()) toast('PDF erstellt und in der Begehung gespeichert.', 'success'); }}>
            {saved ? <><Check size={18} />Erstellt</> : 'PDF erstellen'}
          </button>
          <button className="btn primary" disabled={!pdf} onClick={share}><Share2 size={18} />Teilen</button>
        </div>
        <button className="btn block" disabled={!pdf} onClick={() => setMailOpen(true)}><Mail size={18} />Per E-Mail senden</button>
        {!canShareFiles() && <div className="tiny muted center">Dieser Browser kann keine Dateien teilen – „Teilen“ lädt die PDF herunter.</div>}
      </div>
      {mailOpen && pdf && insp && <MailSheet blob={pdf.blob} fileName={pdf.fileName} onClose={() => setMailOpen(false)} onShared={() => void store()} defaults={settings.mail} />}
    </div>
  );
}

function PreviewNav({ id }: { id: string }) {
  return (
    <header className="nav">
      <div className="nav-left"><button className="nav-btn" onClick={() => navigate(`/i/${id}/pdf`, true)}><ChevronLeft size={26} />Bearbeiten</button></div>
      <div className="nav-title">Vorschau</div>
      <div className="nav-right" />
    </header>
  );
}

/**
 * E-Mail vorbereiten. Ein direkter Versand mit Anhang ist aus einer Web-App
 * nicht möglich – daher Teilen-Menü (Mail wählen → PDF ist angehängt) oder
 * mailto-Entwurf ohne Anhang.
 */
export function MailSheet(props: { blob?: Blob; fileName?: string; report?: Report; onClose: () => void; onShared?: () => void; defaults?: MailDefaults }) {
  const insp = useInspection((s) => s.insp)!;
  const settingsMail = useApp((s) => s.settings.mail);
  const [m, setM] = useState<MailDefaults>(() => mailDraft(props.defaults ?? settingsMail, insp));
  const [remember, setRemember] = useState(false);
  const blob = props.blob ?? props.report?.pdf;
  const fileName = props.fileName ?? props.report?.fileName ?? 'Begehungsprotokoll.pdf';

  function persist() {
    if (remember) void useApp.getState().updateSettings((s) => { s.mail.to = m.to; s.mail.cc = m.cc; });
  }

  return (
    <Sheet open onClose={props.onClose} title="Per E-Mail senden" full>
      <div className="stack">
        <div className="list">
          <Field label="An" type="email" value={m.to} onChange={(v) => setM({ ...m, to: v })} placeholder="name@firma.de, …" inputMode="email" />
          <Field label="CC" type="email" value={m.cc} onChange={(v) => setM({ ...m, cc: v })} inputMode="email" />
          <Field label="Betreff" value={m.subject} onChange={(v) => setM({ ...m, subject: v })} />
          <Field label="Nachricht" multiline rows={6} value={m.body} onChange={(v) => setM({ ...m, body: v })} />
        </div>
        <div className="list"><SwitchRow title="Empfänger als Standard merken" checked={remember} onChange={setRemember} /></div>

        <button className="btn primary big block" disabled={!blob} onClick={() => {
          if (!blob) return;
          const rcpt = [m.to, m.cc && `CC: ${m.cc}`].filter(Boolean).join('  ');
          if (rcpt) copyText(m.to);
          persist();
          const p = shareFile(blob, fileName, { title: m.subject, text: m.body });
          props.onShared?.();
          p.then((o) => { if (o === 'shared') props.onClose(); }).catch((e) => toast(errorText(e), 'error'));
        }}><Mail size={20} />Mail mit PDF-Anhang</button>
        <div className="small muted">
          Öffnet das iOS-Teilen-Menü → <b>„Mail“</b> wählen. Die PDF ist angehängt, der Text eingefügt.
          {m.to && <> Die Empfängeradresse liegt in der Zwischenablage – im Feld „An“ <b>einfügen</b>.</>}
          {' '}Hintergrund: Web-Apps dürfen unter iOS keine Mail mit Anhang direkt vorbefüllen.
        </div>

        <button className="btn block" onClick={() => { persist(); window.location.href = mailtoUrl(m); }}><Mail size={18} />Mail-Entwurf ohne Anhang</button>
        <div className="small muted">Füllt An, CC, Betreff und Text in der Mail-App aus – die PDF muss dann manuell angehängt werden.</div>
        {m.to && <button className="btn sm" onClick={() => { copyText([m.to, m.cc].filter(Boolean).join(', ')); toast('Adressen kopiert.', 'success'); }}><Copy size={16} />Adressen kopieren</button>}
      </div>
    </Sheet>
  );
}
