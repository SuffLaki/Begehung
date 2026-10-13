// Auswahl beim Starten: Trassenbegehung oder Baustellenkontrolle (Fotodoku mit Mängeln)

import { Spline, Camera, ChevronRight } from 'lucide-react';
import { Sheet } from './kit';
import { navigate } from '../router';

export function StartCards({ onPick }: { onPick?: () => void }) {
  const go = (to: string) => { onPick?.(); navigate(to); };
  return (
    <div className="start-cards">
      <button className="start-card" onClick={() => go('/new')}>
        <span className="sc-icon"><Spline size={26} /></span>
        <span className="grow"><b>Begehung starten</b><small>Trasse erfassen, Punkte prüfen, Protokoll</small></span>
        <ChevronRight size={20} />
      </button>
      <button className="start-card alt" onClick={() => go('/new?kind=baustelle')}>
        <span className="sc-icon"><Camera size={26} /></span>
        <span className="grow"><b>Baustelle kontrollieren</b><small>Fotodoku mit Mängelaufnahme</small></span>
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

export default function StartChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Was möchtest du starten?">
      <StartCards onPick={onClose} />
    </Sheet>
  );
}
