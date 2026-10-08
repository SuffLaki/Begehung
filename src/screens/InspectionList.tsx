import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Search, Plus } from 'lucide-react';
import type { InspectionSummaryRow } from '../model/types';
import { listInspections } from '../storage/db';
import { navigate } from '../router';
import { Empty, Loading, Nav, Seg } from '../ui/kit';
import { InspectionRow } from './common';

type Filter = 'all' | 'open' | 'done';

export default function InspectionList() {
  const [rows, setRows] = useState<InspectionSummaryRow[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => { void listInspections().then(setRows); }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (filter === 'open' && r.status === 'completed') return false;
      if (filter === 'done' && r.status !== 'completed') return false;
      if (!needle) return true;
      return [r.projectName, r.projectNumber, r.inspectionNumber, r.client, r.site, r.inspector].join(' ').toLowerCase().includes(needle);
    });
  }, [rows, q, filter]);

  // nach Projekt gruppieren
  const groups = useMemo(() => {
    const m = new Map<string, InspectionSummaryRow[]>();
    for (const r of shown) {
      const k = r.projectNumber ? `${r.projectName} · ${r.projectNumber}` : r.projectName || 'Ohne Projekt';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="screen">
      <Nav title="Meine Begehungen" backLabel="Start" right={<button className="nav-btn" onClick={() => navigate('/new')} aria-label="Neue Begehung"><Plus size={24} /></button>} />
      {!rows ? <Loading /> : (
        <div className="scroll">
          <div className="stack" style={{ marginTop: 6 }}>
            <label className="search"><Search size={18} /><input placeholder="Projekt, Nummer, Auftraggeber …" value={q} onChange={(e) => setQ(e.target.value)} type="search" /></label>
            <Seg<Filter> value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Alle' }, { value: 'open', label: 'Offen' }, { value: 'done', label: 'Abgeschlossen' }]} />
          </div>
          {!shown.length ? (
            <Empty icon={<FolderOpen size={40} />} title={rows.length ? 'Nichts gefunden' : 'Noch keine Begehungen'} text={rows.length ? 'Suchbegriff oder Filter ändern.' : undefined} />
          ) : groups.map(([name, list]) => (
            <div key={name}>
              <div className="group-title">{name}</div>
              <div className="list">{list.map((r) => <InspectionRow key={r.id} r={r} />)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
