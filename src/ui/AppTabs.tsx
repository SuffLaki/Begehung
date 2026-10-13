// Untere App-Leiste außerhalb einer Begehung: Übersicht · Begehungen · + · Meldungen · Profil

import { useEffect, useState } from 'react';
import { House, FolderOpen, Plus, Bell, UserRound } from 'lucide-react';
import { navigate } from '../router';
import { listAllInspections } from '../storage/db';
import StartChooser from './StartChooser';

export type AppTab = 'home' | 'list' | 'meldungen' | 'profil';

export default function AppTabs({ active }: { active: AppTab }) {
  const [open, setOpen] = useState(0);
  const [choose, setChoose] = useState(false);
  useEffect(() => {
    void listAllInspections().then((all) => setOpen(all.reduce((n, i) => n + i.notes.filter((x) => x.status === 'open').length, 0)));
  }, []);
  const tab = (id: AppTab, label: string, Icon: typeof House, to: string, badge = 0) => (
    <button className={active === id ? 'on' : ''} aria-current={active === id} onClick={() => navigate(to, true)}>
      <Icon size={24} strokeWidth={active === id ? 2.3 : 1.8} />
      {label}
      {badge > 0 && <span className="tab-badge">{badge}</span>}
    </button>
  );
  return (
    <nav className="apptabs">
      {tab('home', 'Übersicht', House, '/')}
      {tab('list', 'Begehungen', FolderOpen, '/list')}
      <button aria-label="Neu starten" onClick={() => setChoose(true)}><span className="plus"><Plus size={28} strokeWidth={2.6} /></span></button>
      {tab('meldungen', 'Meldungen', Bell, '/meldungen', open)}
      {tab('profil', 'Profil', UserRound, '/settings')}
      <StartChooser open={choose} onClose={() => setChoose(false)} />
    </nav>
  );
}
