// Kartengrundlage wählen: Landkarte oder eingefügter Plan (PDF/Bild).
// Plan einfügen, umbenennen, Maßstab festlegen, löschen.

import { useEffect, useState } from 'react';
import { FileUp, Map as MapIcon, Check, Trash2, Ruler, ChevronLeft } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { confirmDialog, errorText, toast } from '../../state/appStore';
import type { PlanSheet } from '../../model/types';
import { pickFile } from '../../camera/photo';
import { createPlan, isPdf, metersPerPxFromRatio, planPageCount, usePlanUrl } from '../../plans/plans';
import { renderPdfPages, releasePages, type RenderedPage } from '../../pdf/preview';
import { deletePlanBlob } from '../../storage/db';
import { deletePoint } from '../../geo/routeOps';
import { Banner, Sheet, Spinner } from '../../ui/kit';
import { useUi } from './actions';
import { useCanEdit } from './parts';

type Step = { kind: 'list' } | { kind: 'pages'; file: File; pages: RenderedPage[] } | { kind: 'name'; file: File; page: number; pageCount: number } | { kind: 'scale'; planId: string };

export default function BasemapSheet() {
  const open = useUi((s) => s.basemapOpen);
  if (!open) return null;
  return <BasemapInner />;
}

function BasemapInner() {
  const insp = useInspection((s) => s.insp)!;
  const canEdit = useCanEdit();
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState('');
  const mutate = useInspection.getState().mutate;
  const plans = insp.plans ?? [];
  const activeId = insp.basemap?.kind === 'plan' ? insp.basemap.planId : null;
  const close = () => useUi.getState().set({ basemapOpen: false });

  useEffect(() => () => { if (step.kind === 'pages') releasePages(step.pages); }, [step]);

  async function pick() {
    const f = await pickFile('application/pdf,image/*');
    if (!f) return;
    setName(f.name.replace(/\.[^.]+$/, ''));
    setRatio('');
    try {
      setBusy('Plan wird gelesen …');
      const n = await planPageCount(f);
      if (isPdf(f) && n > 1) {
        const pages = await renderPdfPages(await f.arrayBuffer(), 240, undefined, 30);
        setStep({ kind: 'pages', file: f, pages });
      } else {
        setStep({ kind: 'name', file: f, page: 0, pageCount: n });
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  }

  async function insert(file: File, page: number) {
    setBusy('Plan wird eingefügt …');
    try {
      const plan = await createPlan(insp.id, file, page, name);
      const denom = parseFloat(ratio.replace(/^1\s*:\s*/, '').replace(/\./g, '').replace(',', '.'));
      if (denom > 0 && plan.ptPerPx) {
        plan.metersPerPx = metersPerPxFromRatio(plan, denom);
        plan.scaleNote = `1:${Math.round(denom)}`;
      }
      mutate((d) => {
        d.plans = [...(d.plans ?? []), plan];
        d.basemap = { kind: 'plan', planId: plan.id };
      });
      toast(`Plan „${plan.name}“ eingefügt – Punkte jetzt direkt auf dem Plan setzen.`, 'success');
      close();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  }

  function select(planId: string | null) {
    mutate((d) => { d.basemap = planId ? { kind: 'plan', planId } : { kind: 'map' }; }, { undoable: false });
    close();
  }

  async function remove(plan: PlanSheet) {
    const n = insp.route.points.filter((p) => p.planId === plan.id).length;
    if (!(await confirmDialog({ title: `Plan „${plan.name}“ entfernen?`, message: n ? `${n} Punkte auf diesem Plan werden ebenfalls gelöscht.` : 'Der Plan wird aus der Begehung entfernt.', confirmLabel: 'Entfernen', destructive: true }))) return;
    mutate((d) => {
      for (const p of d.route.points.filter((x) => x.planId === plan.id)) deletePoint(d, p.id);
      d.plans = (d.plans ?? []).filter((x) => x.id !== plan.id);
      if (d.basemap?.kind === 'plan' && d.basemap.planId === plan.id) d.basemap = { kind: 'map' };
    });
    void deletePlanBlob(plan.id);
  }

  // ------------------------------------------------ Seiten einer mehrseitigen PDF
  if (step.kind === 'pages') {
    return (
      <Sheet open full onClose={close} title="Seite wählen" left={<button className="nav-btn" style={{ marginTop: 8 }} onClick={() => setStep({ kind: 'list' })}><ChevronLeft size={22} />Zurück</button>}>
        <div className="small muted" style={{ marginBottom: 10 }}>Welche Seite der PDF ist der Plan?</div>
        <div className="tpl-grid compact">
          {step.pages.map((p, i) => (
            <button key={i} className="tpl-card" onClick={() => setStep({ kind: 'name', file: step.file, page: i, pageCount: step.pages.length })}>
              <div className="tpl-thumb" style={{ aspectRatio: `${p.width} / ${p.height}` }}><img src={p.url} alt={`Seite ${i + 1}`} /></div>
              <b>Seite {i + 1}</b>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  // ------------------------------------------------ Name + Maßstab
  if (step.kind === 'name') {
    const pdf = isPdf(step.file);
    return (
      <Sheet open onClose={close} title="Plan einfügen" left={<button className="nav-btn" style={{ marginTop: 8 }} onClick={() => setStep({ kind: 'list' })}><ChevronLeft size={22} />Zurück</button>}>
        <div className="stack">
          <div className="list">
            <div className="field"><label htmlFor="plan-name">Name</label><input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Lageplan Trasse Abschnitt 2" /></div>
            {pdf && <div className="field"><label htmlFor="plan-ratio">Maßstab (optional)</label><input id="plan-ratio" inputMode="numeric" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder="z. B. 1:500 – steht meist im Planstempel" /></div>}
          </div>
          <div className="small muted">
            {pdf
              ? 'Mit Maßstab (bei unverändertem Papierformat, z. B. A3 1:500) berechnet die App Längen. Ohne Maßstab werden keine Längen angegeben.'
              : 'Bei Bildern/Fotos von Plänen ist das Papierformat unbekannt – Maßstab später über „Strecke messen“ festlegen (eine bekannte Strecke antippen).'}
          </div>
          <button className="btn primary big block" disabled={!!busy} onClick={() => void insert(step.file, step.page)}>{busy ? <><Spinner />{busy}</> : <><FileUp size={20} />Plan einfügen{step.pageCount > 1 ? ` (Seite ${step.page + 1})` : ''}</>}</button>
        </div>
      </Sheet>
    );
  }

  // ------------------------------------------------ Maßstab eines vorhandenen Plans
  if (step.kind === 'scale') {
    const plan = plans.find((p) => p.id === step.planId)!;
    return (
      <Sheet open onClose={close} title={`Maßstab: ${plan.name}`} left={<button className="nav-btn" style={{ marginTop: 8 }} onClick={() => setStep({ kind: 'list' })}><ChevronLeft size={22} />Zurück</button>}>
        <div className="stack">
          {plan.ptPerPx ? (
            <>
              <div className="list"><div className="field"><label htmlFor="ratio2">Maßstab laut Plan</label><input id="ratio2" inputMode="numeric" value={ratio} onChange={(e) => setRatio(e.target.value)} placeholder={plan.scaleNote || 'z. B. 1:500'} /></div></div>
              <button className="btn primary block" onClick={() => {
                const denom = parseFloat(ratio.replace(/^1\s*:\s*/, '').replace(/\./g, '').replace(',', '.'));
                const mpp = metersPerPxFromRatio(plan, denom);
                if (!mpp) { toast('Bitte einen Maßstab wie „1:500“ eingeben.', 'error'); return; }
                mutate((d) => { const p = d.plans?.find((x) => x.id === plan.id); if (p) { p.metersPerPx = mpp; p.scaleNote = `1:${Math.round(denom)}`; } });
                toast(`Maßstab 1:${Math.round(denom)} gespeichert.`, 'success');
                setStep({ kind: 'list' });
              }}><Check size={18} />Übernehmen</button>
              <div className="small muted">Gilt nur, wenn die PDF im Originalformat erstellt wurde (nicht verkleinert/gescannt).</div>
            </>
          ) : <Banner kind="info">Bei Bildplänen ist das Papierformat unbekannt – bitte „Strecke messen“ verwenden.</Banner>}
          <button className="btn block" onClick={() => { select(plan.id); useUi.getState().set({ mapTool: 'measure' }); }}><Ruler size={18} />Strecke auf dem Plan messen</button>
          <div className="small muted">Zwei Punkte einer bekannten Strecke antippen (z. B. Bemaßung oder Gebäudekante) und die Länge in Metern eingeben.</div>
          {plan.metersPerPx && (
            <button className="btn sm danger" onClick={() => { mutate((d) => { const p = d.plans?.find((x) => x.id === plan.id); if (p) { p.metersPerPx = null; p.scaleNote = ''; } }); setStep({ kind: 'list' }); }}>Maßstab entfernen</button>
          )}
        </div>
      </Sheet>
    );
  }

  // ------------------------------------------------ Übersicht
  return (
    <Sheet open onClose={close} title="Kartengrundlage">
      <div className="stack">
        <div className="list">
          <button className="row" onClick={() => select(null)}>
            <div className="row-icon" style={{ background: '#30b0c7' }}><MapIcon size={16} /></div>
            <div className="row-main"><div className="row-title">Landkarte</div><div className="row-sub">GPS, Adresssuche, Straßenkarte/Luftbild</div></div>
            {!activeId && <Check size={20} color="var(--accent)" />}
          </button>
          {plans.map((p) => <PlanRow key={p.id} plan={p} active={p.id === activeId} canEdit={canEdit} onSelect={() => select(p.id)} onScale={() => { setRatio(p.scaleNote); setStep({ kind: 'scale', planId: p.id }); }} onRemove={() => void remove(p)}
            onRename={(n) => mutate((d) => { const x = d.plans?.find((q) => q.id === p.id); if (x) x.name = n; })} />)}
        </div>
        {canEdit && (
          <button className="btn primary block" disabled={!!busy} onClick={() => void pick()}>{busy ? <><Spinner />{busy}</> : <><FileUp size={18} />Plan einfügen (PDF oder Bild)</>}</button>
        )}
        <div className="small muted">
          Auf einem Plan setzt du Punkte, Linien, Fotos und Notizen direkt – die Landkarte wird dann nicht verwendet. Ein Plan hat keinen GPS-Bezug: GPS-Position, Adressen und Richtungsangaben werden darauf nicht automatisch eingezeichnet.
        </div>
      </div>
    </Sheet>
  );
}

function PlanRow({ plan, active, canEdit, onSelect, onScale, onRemove, onRename }: { plan: PlanSheet; active: boolean; canEdit: boolean; onSelect: () => void; onScale: () => void; onRemove: () => void; onRename: (n: string) => void }) {
  const url = usePlanUrl(plan.id);
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <button onClick={onSelect} style={{ width: 64, height: 48, borderRadius: 8, overflow: 'hidden', background: '#fff', flex: 'none', boxShadow: '0 0 0 0.5px var(--sep)' }} aria-label={`${plan.name} verwenden`}>
        {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </button>
      <div className="row-main">
        <input style={{ border: 0, background: 'transparent', fontSize: 17, outline: 0, width: '100%' }} defaultValue={plan.name} aria-label="Planname" readOnly={!canEdit}
          onBlur={(e) => e.target.value.trim() && e.target.value !== plan.name && onRename(e.target.value.trim())} />
        <div className="row-sub">{plan.metersPerPx ? `Maßstab ${plan.scaleNote || 'gemessen'}` : 'ohne Maßstab'} · {plan.fileName}</div>
        <div className="hstack" style={{ marginTop: 6 }}>
          {!active && <button className="btn sm" onClick={onSelect}>Verwenden</button>}
          {canEdit && <button className="btn sm" onClick={onScale}><Ruler size={14} />Maßstab</button>}
          {canEdit && <button className="btn sm danger" onClick={onRemove} aria-label="Plan entfernen"><Trash2 size={14} /></button>}
        </div>
      </div>
      {active && <Check size={20} color="var(--accent)" />}
    </div>
  );
}
