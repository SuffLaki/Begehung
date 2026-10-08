// Vorlagen / PDF-Hintergründe verwalten.
// Eine Vorlage ist eine PDF (z. B. Firmenbriefbogen mit Logo, Kopf-/Fußzeile)
// oder ein Bild. Die App legt sie als Hintergrund unter jede Seite und platziert
// die Inhalte im eingestellten freien Bereich (Ränder in mm).

import { useEffect, useState } from 'react';
import { FileStack, Plus, Trash2, Star, Minus, FileText } from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import type { PdfTemplate } from '../model/types';
import { deleteTemplate, listTemplates, saveTemplate } from '../storage/db';
import { uid } from '../model/factory';
import { useApp, confirmDialog, toast, errorText } from '../state/appStore';
import { Empty, Field, Loading, Nav, SelectField, Sheet, SwitchRow } from '../ui/kit';
import { canvasToBlob, loadImage, pickFile, scaleToCanvas } from '../camera/photo';
import { renderPdfPages } from '../pdf/preview';
import { can } from '../model/permissions';
import { navigate } from '../router';

const thumbCache = new Map<string, string>();

async function thumbUrl(t: PdfTemplate, page: number): Promise<string | null> {
  if (!t.file) return null;
  const key = `${t.id}:${t.updatedAt}:${page}`;
  if (thumbCache.has(key)) return thumbCache.get(key)!;
  let url: string;
  if (t.kind === 'pdf') {
    const pages = await renderPdfPages(await t.file.arrayBuffer(), 420, undefined, page + 1);
    url = pages[page]?.url ?? pages[0]?.url;
  } else {
    url = URL.createObjectURL(t.file);
  }
  thumbCache.set(key, url);
  return url;
}

export function TemplateThumb({ tpl, page = 0, showMargins = false }: { tpl: PdfTemplate; page?: number; showMargins?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    thumbUrl(tpl, page).then((u) => alive && setUrl(u)).catch(() => undefined);
    return () => { alive = false; };
  }, [tpl, page]);
  const m = tpl.margins;
  return (
    <div className="tpl-thumb">
      {tpl.kind === 'standard' ? (
        <div className="std-thumb"><i className="acc" /><i className="big" /><i /><i /><i style={{ width: '70%' }} /><i /><i style={{ width: '50%' }} /></div>
      ) : url ? <img src={url} alt="" /> : <FileText size={28} />}
      {showMargins && (
        <div className="margin-box" style={{ top: `${(m.top / 297) * 100}%`, bottom: `${(m.bottom / 297) * 100}%`, left: `${(m.left / 210) * 100}%`, right: `${(m.right / 210) * 100}%` }} />
      )}
    </div>
  );
}

/** Legt aus einer hochgeladenen Datei eine Vorlage an (prüft die Datei vorher). */
export async function createTemplateFromFile(file: File): Promise<PdfTemplate> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  let blob: Blob;
  let pageCount = 1;
  if (isPdf) {
    const bytes = await file.arrayBuffer();
    try {
      const doc = await PDFDocument.load(bytes);
      pageCount = doc.getPageCount();
    } catch (e) {
      if (String(e).toLowerCase().includes('encrypt')) throw new Error('Diese PDF ist geschützt/verschlüsselt und kann nicht als Hintergrund dienen. Bitte eine ungeschützte Version exportieren.');
      throw new Error('Die PDF konnte nicht gelesen werden.');
    }
    blob = new Blob([bytes], { type: 'application/pdf' });
  } else {
    // Bilder (auch HEIC vom iPhone) in JPEG umwandeln – pdf-lib kann nur JPEG/PNG
    const img = await loadImage(file);
    blob = await canvasToBlob(scaleToCanvas(img, 2480), 'image/jpeg', 0.9);
  }
  const now = Date.now();
  const t: PdfTemplate = {
    id: uid('tpl'),
    name: file.name.replace(/\.[^.]+$/, '') || 'Eigene Vorlage',
    kind: isPdf ? 'pdf' : 'image',
    file: blob,
    fileName: file.name,
    pageCount,
    margins: { top: 35, right: 18, bottom: 25, left: 20 },
    coverPage: 0,
    followPage: pageCount > 1 ? 1 : 0,
    drawHeader: false,
    drawPageNumbers: true,
    accentColor: '#1F4E79',
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  await saveTemplate(t);
  return t;
}

export default function Templates() {
  const [list, setList] = useState<PdfTemplate[] | null>(null);
  const [edit, setEdit] = useState<PdfTemplate | null>(null);
  const settings = useApp((s) => s.settings);
  const manage = can(settings.user, 'templates.manage');
  const reload = async () => setList(await listTemplates());
  useEffect(() => { void reload(); }, []);

  async function add() {
    const f = await pickFile('application/pdf,image/*');
    if (!f) return;
    try {
      const t = await createTemplateFromFile(f);
      await reload();
      setEdit(t);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="screen">
      <Nav title="Vorlagen" backLabel="Start" onBack={() => navigate('/', true)} right={manage && <button className="nav-btn" aria-label="Vorlage hinzufügen" onClick={add}><Plus size={24} /></button>} />
      {!list ? <Loading /> : (
        <div className="scroll">
          <p className="muted small" style={{ margin: '8px 4px 14px' }}>
            Lade z. B. deinen Firmenbriefbogen als PDF hoch. Die App legt ihn unter jede Seite und schreibt die Inhalte in den freien Bereich (blau gestrichelt). Mehrseitige PDFs: getrennte Seiten für Deckblatt und Folgeseiten wählbar.
          </p>
          {list.length ? (
            <div className="tpl-grid">
              {list.map((t) => (
                <button key={t.id} className="tpl-card" onClick={() => setEdit(t)}>
                  <TemplateThumb tpl={t} showMargins />
                  <b className="ellipsis">{t.name}{settings.defaultTemplateId === t.id && <Star size={13} style={{ marginLeft: 4, color: '#ff9f0a' }} fill="#ff9f0a" />}</b>
                  <span>{t.kind === 'standard' ? 'Eingebaut' : t.kind === 'pdf' ? `PDF · ${t.pageCount} S.` : 'Bild'}</span>
                </button>
              ))}
              {manage && (
                <button className="tpl-card" onClick={add}>
                  <div className="tpl-thumb" style={{ background: 'var(--fill)', flexDirection: 'column', gap: 6 }}><Plus size={30} /><span className="small">PDF oder Bild</span></div>
                  <b>Neue Vorlage</b><span>hochladen</span>
                </button>
              )}
            </div>
          ) : <Empty icon={<FileStack size={40} />} title="Keine Vorlagen" />}
        </div>
      )}
      {edit && <TemplateEditor tpl={edit} readOnly={!manage} onClose={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}

function Stepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="row">
      <div className="row-main"><div className="row-title">{label}</div></div>
      <button className="icon-btn" disabled={disabled || value <= 0} aria-label={`${label} verkleinern`} onClick={() => onChange(Math.max(0, value - 1))}><Minus size={18} /></button>
      <div style={{ width: 56, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{value} mm</div>
      <button className="icon-btn" disabled={disabled || value >= 120} aria-label={`${label} vergrößern`} onClick={() => onChange(Math.min(120, value + 1))}><Plus size={18} /></button>
    </div>
  );
}

const ACCENTS = ['#1F4E79', '#0A5C36', '#8B1E1E', '#4B2E83', '#C25E00', '#222222'];

function TemplateEditor({ tpl, onClose, readOnly }: { tpl: PdfTemplate; onClose: () => void; readOnly: boolean }) {
  const [t, setT] = useState(tpl);
  const [previewPage, setPreviewPage] = useState(tpl.coverPage);
  const defaultId = useApp((s) => s.settings.defaultTemplateId);
  const setM = (k: keyof PdfTemplate['margins']) => (v: number) => setT({ ...t, margins: { ...t.margins, [k]: v } });

  async function save() {
    if (!readOnly) await saveTemplate({ ...t, updatedAt: Date.now() });
    onClose();
  }

  const pages = Array.from({ length: t.pageCount }, (_, i) => ({ value: String(i), label: `Seite ${i + 1}` }));
  return (
    <Sheet open full onClose={save} title={t.name} right={<button className="nav-btn" style={{ fontWeight: 600, marginTop: 8 }} onClick={save}>Fertig</button>}>
      <div className="stack">
        <div style={{ maxWidth: 260, margin: '0 auto', width: '100%' }}>
          <TemplateThumb tpl={{ ...t }} page={previewPage} showMargins />
        </div>
        {t.pageCount > 1 && (
          <div className="chips" style={{ justifyContent: 'center' }}>
            {pages.map((p) => <button key={p.value} className={`chip${previewPage === Number(p.value) ? ' on' : ''}`} onClick={() => setPreviewPage(Number(p.value))}>{p.label}</button>)}
          </div>
        )}
        <div className="small muted center">Blau = Bereich für die Inhalte. Ränder so wählen, dass Logo, Kopf- und Fußzeile der Vorlage frei bleiben.</div>

        <div className="list"><Field label="Name" value={t.name} onChange={(v) => setT({ ...t, name: v })} readOnly={readOnly || t.builtin} /></div>

        <div className="group-title" style={{ margin: '4px 4px 0' }}>Freier Inhaltsbereich (Abstand vom Rand)</div>
        <div className="list">
          <Stepper label="Oben" value={t.margins.top} onChange={setM('top')} disabled={readOnly} />
          <Stepper label="Unten" value={t.margins.bottom} onChange={setM('bottom')} disabled={readOnly} />
          <Stepper label="Links" value={t.margins.left} onChange={setM('left')} disabled={readOnly} />
          <Stepper label="Rechts" value={t.margins.right} onChange={setM('right')} disabled={readOnly} />
        </div>

        {t.kind === 'pdf' && t.pageCount > 1 && (
          <div className="list">
            <SelectField label="Seite für das Deckblatt" value={String(t.coverPage)} onChange={(v) => setT({ ...t, coverPage: Number(v) })} options={pages} />
            <SelectField label="Seite für alle Folgeseiten" value={String(t.followPage)} onChange={(v) => setT({ ...t, followPage: Number(v) })} options={pages} />
          </div>
        )}

        <div className="list">
          <SwitchRow title="Eigene Kopf-/Fußzeile & Logo" sub={t.kind === 'standard' ? 'Firmenname, Projekt, Logo aus den Einstellungen' : 'Ausschalten, wenn die Vorlage schon Kopf-/Fußzeile hat'} checked={t.drawHeader} onChange={(v) => setT({ ...t, drawHeader: v })} disabled={readOnly} />
          <SwitchRow title="Seitenzahlen" sub="„Seite x von y“ unten rechts" checked={t.drawPageNumbers} onChange={(v) => setT({ ...t, drawPageNumbers: v })} disabled={readOnly} />
        </div>

        <div className="group-title" style={{ margin: '4px 4px 0' }}>Akzentfarbe (Überschriften)</div>
        <div className="hstack">
          {ACCENTS.map((c) => <button key={c} className={`color-dot${t.accentColor === c ? ' on' : ''}`} style={{ background: c }} aria-label={`Farbe ${c}`} disabled={readOnly} onClick={() => setT({ ...t, accentColor: c })} />)}
        </div>
        {t.kind === 'image' && <div className="small muted">Bild-Hintergründe werden auf A4 hochkant gestreckt – am besten ein A4-Bild (210 × 297) verwenden.</div>}

        {!readOnly && (
          <div className="list">
            {defaultId !== t.id && (
              <button className="row" onClick={async () => { await useApp.getState().updateSettings((s) => { s.defaultTemplateId = t.id; }); toast('Als Standardvorlage gesetzt.', 'success'); }}>
                <Star size={18} color="#ff9f0a" /><div className="row-main"><div className="row-title">Als Standard für neue Begehungen</div></div>
              </button>
            )}
            {!t.builtin && (
              <button className="row danger" onClick={async () => {
                if (await confirmDialog({ title: `Vorlage „${t.name}“ löschen?`, confirmLabel: 'Löschen', destructive: true })) {
                  await deleteTemplate(t.id);
                  if (defaultId === t.id) await useApp.getState().updateSettings((s) => { s.defaultTemplateId = null; });
                  onClose();
                }
              }}>
                <Trash2 size={18} color="var(--danger)" /><div className="row-main"><div className="row-title">Vorlage löschen</div></div>
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
