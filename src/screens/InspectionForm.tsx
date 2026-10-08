// Neue Begehung anlegen bzw. Projektdaten einer Begehung bearbeiten.

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import type { InspectionMeta, Project } from '../model/types';
import { emptyMeta, newInspection, uid } from '../model/factory';
import { listInspections, listProjects, saveInspection, saveProject } from '../storage/db';
import { navigate } from '../router';
import { useApp, toast, errorText } from '../state/appStore';
import { useInspection } from '../state/inspectionStore';
import { Field, Loading, Nav, SwitchRow, Spinner } from '../ui/kit';
import { currentFix, gpsSupported } from '../geo/gps';
import { addRoutePoint } from '../geo/routeOps';
import { canEditInspection } from '../model/permissions';
import { useUi } from './inspection/actions';

export default function InspectionForm({ editId }: { editId?: string }) {
  const settings = useApp((s) => s.settings);
  const insp = useInspection((s) => s.insp);
  const [meta, setMeta] = useState<InspectionMeta | null>(editId ? null : { ...emptyMeta(), inspector: settings.user.name });
  const [projects, setProjects] = useState<Project[]>([]);
  const [useGpsStart, setUseGpsStart] = useState(gpsSupported());
  const [usePlan, setUsePlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => { void listProjects().then(setProjects); }, []);
  useEffect(() => {
    if (!editId) return;
    void useInspection.getState().load(editId).then((ok) => {
      if (!ok) { toast('Begehung nicht gefunden.', 'error'); navigate('/list', true); return; }
      setMeta({ ...useInspection.getState().insp!.meta });
    });
  }, [editId]);

  if (!meta) return <div className="screen"><Nav title="Projektdaten" /><Loading /></div>;
  const readOnly = !!editId && !canEditInspection(settings.user, insp);
  const set = (k: keyof InspectionMeta) => (v: string) => setMeta((m) => {
    const next = { ...m!, [k]: v };
    if (k === 'projectName' && !editId) {
      const p = projects.find((x) => x.name === v);
      if (p) { next.projectNumber = next.projectNumber || p.number; next.client = next.client || p.client; }
    }
    return next;
  });

  const invalid = { projectName: !meta.projectName.trim(), date: !meta.date, inspector: !meta.inspector.trim() };
  const hasErrors = Object.values(invalid).some(Boolean);

  async function upsertProject(): Promise<string> {
    const m = meta!;
    const existing = projects.find((p) => (m.projectNumber && p.number === m.projectNumber) || (!m.projectNumber && p.name === m.projectName));
    const now = Date.now();
    const p: Project = existing
      ? { ...existing, name: m.projectName, number: m.projectNumber, client: m.client, updatedAt: now }
      : { id: uid('pr'), name: m.projectName, number: m.projectNumber, client: m.client, createdAt: now, updatedAt: now };
    await saveProject(p);
    return p.id;
  }

  async function submit() {
    setTried(true);
    if (hasErrors) { toast('Bitte die markierten Pflichtfelder ausfüllen.', 'error'); return; }
    setBusy(true);
    try {
      const m = { ...meta! };
      if (!m.inspectionNumber.trim()) {
        const same = (await listInspections()).filter((r) => r.projectName === m.projectName && r.projectNumber === m.projectNumber).length;
        m.inspectionNumber = `${m.date.replace(/-/g, '')}-${same + 1}`;
      }
      const projectId = await upsertProject();
      if (editId) {
        useInspection.getState().mutate((d) => { d.meta = m; d.projectId = projectId; });
        await useInspection.getState().flush();
        toast('Projektdaten gespeichert.', 'success');
        navigate(`/i/${editId}/more`, true);
        return;
      }
      const insp = newInspection(m, projectId, settings.user, settings.defaultTemplateId, settings.defaultMapType);
      if (useGpsStart && !usePlan) {
        try {
          const fix = await currentFix(30000, 15000);
          const p = addRoutePoint(insp, fix, { source: 'gps', accuracy: fix.accuracy, title: m.startPoint || 'Startpunkt' });
          p.description = m.startPoint ? '' : 'Startpunkt (GPS bei Anlage der Begehung)';
        } catch (e) {
          toast(`Startpunkt nicht gesetzt: ${errorText(e)}`, 'error');
        }
      }
      await saveInspection(insp);
      if (settings.user.name !== m.inspector && !settings.user.name) {
        void useApp.getState().updateSettings((s) => { s.user.name = m.inspector; });
      }
      navigate(`/i/${insp.id}/map`, true);
      if (usePlan) window.setTimeout(() => useUi.getState().set({ basemapOpen: true }), 300);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const back = editId ? `/i/${editId}/more` : '/';
  return (
    <div className="screen">
      <Nav
        title={editId ? 'Projektdaten' : 'Neue Begehung'}
        backLabel={editId ? 'Zurück' : 'Abbrechen'}
        onBack={() => navigate(back, true)}
        right={!readOnly && <button className="nav-btn" style={{ fontWeight: 600 }} onClick={submit} disabled={busy}>{busy ? <Spinner /> : editId ? 'Sichern' : 'Weiter'}</button>}
      />
      <div className="scroll">
        <datalist id="projects">{projects.map((p) => <option key={p.id} value={p.name}>{p.number}</option>)}</datalist>
        <div className="group-title">Projekt</div>
        <div className="list">
          <Field label="Projektname" required invalid={tried && invalid.projectName} value={meta.projectName} onChange={set('projectName')} list="projects" placeholder="z. B. 110-kV-Kabel Ulm-Nord" readOnly={readOnly} />
          <Field label="Projekt-/Auftragsnummer" value={meta.projectNumber} onChange={set('projectNumber')} placeholder="z. B. 2026-0412" readOnly={readOnly} />
          <Field label="Auftraggeber" value={meta.client} onChange={set('client')} readOnly={readOnly} />
          <Field label="Ansprechpartner" value={meta.contactPerson} onChange={set('contactPerson')} readOnly={readOnly} />
        </div>

        <div className="group-title">Begehung</div>
        <div className="list">
          <div className="hstack" style={{ alignItems: 'stretch' }}>
            <div className="grow"><Field label="Datum" type="date" required invalid={tried && invalid.date} value={meta.date} onChange={set('date')} readOnly={readOnly} /></div>
            <div style={{ width: '38%' }}><Field label="Uhrzeit" type="time" value={meta.time} onChange={set('time')} readOnly={readOnly} /></div>
          </div>
          <Field label="Mitarbeiter / Begeher" required invalid={tried && invalid.inspector} value={meta.inspector} onChange={set('inspector')} readOnly={readOnly} />
          <Field label="Begehungsnummer" value={meta.inspectionNumber} onChange={set('inspectionNumber')} placeholder="automatisch, wenn leer" readOnly={readOnly} />
          <Field label="Baustelle / Bereich" value={meta.site} onChange={set('site')} readOnly={readOnly} />
          <Field label="Startpunkt (Beschreibung)" value={meta.startPoint} onChange={set('startPoint')} placeholder="z. B. UW Ulm-Nord, Tor 2" readOnly={readOnly} />
        </div>
        {!editId && (
          <>
            <div className="list" style={{ marginTop: 12 }}>
              <SwitchRow title="Plan statt Karte verwenden" sub="Vorhandenen Lageplan (PDF/Bild) einfügen und darauf arbeiten" checked={usePlan} onChange={setUsePlan} />
              {!usePlan && gpsSupported() && <SwitchRow title="GPS-Standort als Startpunkt" sub="Setzt den ersten Trassenpunkt an deine aktuelle Position" checked={useGpsStart} onChange={setUseGpsStart} />}
            </div>
            <div className="group-foot hstack"><MapPin size={14} /> Den Startpunkt kannst du später auf der Karte verschieben.</div>
          </>
        )}

        <div className="group-title">Beschreibung & Bemerkungen</div>
        <div className="list">
          <Field label="Beschreibung" multiline value={meta.description} onChange={set('description')} placeholder="Ziel/Umfang der Begehung" readOnly={readOnly} />
          <Field label="Allgemeine Bemerkungen" multiline value={meta.remarks} onChange={set('remarks')} placeholder="Wetter, Teilnehmer, Besonderheiten …" readOnly={readOnly} />
        </div>

        {!readOnly && (
          <div style={{ marginTop: 20 }}>
            <button className="btn primary big block" onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : editId ? 'Speichern' : 'Begehung starten'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
