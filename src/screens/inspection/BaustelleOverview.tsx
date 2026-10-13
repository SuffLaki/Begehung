// Übersicht einer Baustellenkontrolle: Mängel aufnehmen (Foto → Mangel), Stand, Liste.

import { useState } from 'react';
import { Camera, Mic, PencilLine, FileText, Flag, Lock, AlertTriangle, MapPin } from 'lucide-react';
import { ensureLocationConsent, gpsSupported } from '../../geo/gps';
import { useInspection } from '../../state/inspectionStore';
import { useApp } from '../../state/appStore';
import { navigate } from '../../router';
import { Banner, Empty, Nav, Seg, SyncPill } from '../../ui/kit';
import Donut from '../../ui/Donut';
import { StatusBadge } from '../common';
import { formatDate } from '../../pdf/generator';
import { actionDefectPhoto, actionNote, actionPhoto, actionVoice, useUi } from './actions';
import { UndoRedo, useCanEdit } from './parts';
import { SaveState } from './OverviewTab';
import DefectCard from '../DefectCard';
import { can } from '../../model/permissions';

type F = 'open' | 'all' | 'done';

export default function BaustelleOverview() {
  const insp = useInspection((s) => s.insp)!;
  const user = useApp((s) => s.settings.user);
  const canEdit = useCanEdit();
  const consent = useApp((s) => s.settings.gps.locationConsent);
  const [filter, setFilter] = useState<F>('open');
  const m = insp.meta;
  const defects = insp.notes.filter((n) => n.kind === 'observation' || n.priority);
  const open = defects.filter((n) => n.status === 'open').length;
  const prog = defects.filter((n) => n.status === 'progress').length;
  const done = defects.filter((n) => n.status === 'done').length;
  const shown = [...defects].reverse().filter((n) => (filter === 'open' ? n.status !== 'done' : filter === 'done' ? n.status === 'done' : true));
  const completed = insp.status === 'completed';

  return (
    <>
      <Nav backLabel="Start" onBack={() => navigate('/', true)} right={<UndoRedo />} />
      <div className="scroll with-tabs">
        <div className="insp-head">
          <div className="grow">
            <div className="small muted">Baustellenkontrolle</div>
            <h1>{m.projectName || 'Ohne Projektname'}</h1>
            <div className="meta">{[m.site, formatDate(m.date), m.inspector].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="status-row"><StatusBadge status={insp.status} /><SyncPill /><SaveState /></div>

        <div className="stack">
          {completed && <Banner kind="ok" icon={<Lock size={20} />}><b>Abgeschlossen</b> – schreibgeschützt.</Banner>}
          {canEdit && (
            <>
              {!consent && gpsSupported() && (
                <Banner kind="warn" icon={<MapPin size={20} />}>
                  Ohne Standort-Freigabe bekommen Mängel keine Koordinaten und keine Adresse.{' '}
                  <button className="btn sm" onClick={() => void ensureLocationConsent()}>Standort freigeben</button>
                </Banner>
              )}
              <button className="big-defect" onClick={() => actionDefectPhoto()}><Camera size={30} />Mangel aufnehmen</button>
              <div className="btn-row">
                <button className="btn" onClick={() => actionPhoto()}><Camera size={18} />Foto</button>
                <button className="btn" onClick={() => actionVoice('note')}><Mic size={18} />Sprache</button>
                <button className="btn" onClick={() => actionNote()}><PencilLine size={18} />Notiz</button>
              </div>
            </>
          )}

          <div className="card">
            <Donut parts={[
              { label: 'Offen', value: open, color: '#d0352b' },
              { label: 'In Bearbeitung', value: prog, color: '#e0a100' },
              { label: 'Erledigt', value: done, color: '#23824f' },
            ]} totalLabel="Mängel" size={140} />
          </div>

          <Seg<F> value={filter} onChange={setFilter} options={[{ value: 'open', label: `Offen (${open + prog})` }, { value: 'done', label: `Erledigt (${done})` }, { value: 'all', label: `Alle (${defects.length})` }]} />
          {shown.length ? (
            <div className="list">
              {shown.map((n) => <DefectCard key={n.id} n={n} insp={insp} onClick={() => useUi.getState().set({ noteId: n.id })} />)}
            </div>
          ) : (
            <Empty icon={<AlertTriangle size={36} />} title={defects.length ? 'Keine Mängel in diesem Filter' : 'Noch keine Mängel'} text={defects.length ? undefined : '„Mangel aufnehmen“ öffnet die Kamera – danach Beschreibung, Priorität und Frist eintragen. Standort (Koordinaten + Adresse) wird automatisch gespeichert.'} />
          )}

          {can(user, 'pdf.create') && <button className="btn primary big block" onClick={() => navigate(`/i/${insp.id}/pdf`)}><FileText size={22} />Mängelbericht erstellen</button>}
          {!completed && can(user, 'inspection.edit') && <button className="btn big block" onClick={() => navigate(`/i/${insp.id}/finish`)}><Flag size={20} />Kontrolle abschließen</button>}
        </div>
      </div>
    </>
  );
}
