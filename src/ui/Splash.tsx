// Startbildschirm (kurz beim App-Start) und Offline-Hinweis.

import { useEffect, useState } from 'react';
import { CloudOff, Check, Map as MapIcon, Save } from 'lucide-react';
import { useApp } from '../state/appStore';

/** Strommast als Linienzeichnung */
export function MastIcon({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M32 4 L24 60 M32 4 L40 60 M18 16 H46 M14 26 H50 M26.3 44 H37.7 M28 30 L36 44 M36 30 L28 44 M29.7 16 L35 26 M34.3 16 L29 26" />
      <path d="M18 16 v4 M46 16 v4 M14 26 v4 M50 26 v4" />
    </svg>
  );
}

export default function Splash() {
  const design = useApp((s) => s.settings.design ?? 'trasse');
  const loaded = useApp((s) => s.settingsLoaded);
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');
  useEffect(() => {
    if (!loaded) return;
    const t1 = window.setTimeout(() => setPhase('fade'), 900);
    const t2 = window.setTimeout(() => setPhase('gone'), 1300);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [loaded]);
  if (phase === 'gone' || (loaded && design === 'klassisch')) return null;
  return (
    <div className={`splash${phase === 'fade' ? ' hide' : ''}`} onClick={() => setPhase('gone')} role="presentation">
      <svg className="scene" viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d="M0 160 Q80 120 160 150 T320 140 T400 150 V220 H0Z" fill="rgba(0,0,0,0.18)" />
        <path d="M0 185 Q100 160 200 182 T400 176 V220 H0Z" fill="rgba(0,0,0,0.28)" />
        <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.4" fill="none">
          <path d="M60 175 L72 70 L84 175 M50 95 H94 M46 112 H98 M66 140 L78 110 M78 140 L66 110" />
          <path d="M300 165 L310 85 L320 165 M292 102 H328 M289 116 H331" />
          <path d="M50 95 Q180 130 292 102 M94 95 Q200 128 328 102 M46 112 Q180 150 289 116 M98 112 Q200 148 331 116" />
        </g>
      </svg>
      <div className="logo"><MastIcon /></div>
      <h1>Trassenbegehung</h1>
      <p>Sicher. Effizient. Digital.</p>
      <div className="ver">Version 1.3</div>
    </div>
  );
}

/** Einmaliger Hinweis, wenn die Verbindung wegfällt */
export function OfflineNotice() {
  const online = useApp((s) => s.online);
  const pending = useApp((s) => s.pendingJobs);
  const [show, setShow] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!online && !seen) setShow(true);
    if (online) setShow(false);
  }, [online, seen]);
  if (!show) return null;
  return (
    <div className="offline-modal" role="alertdialog" aria-label="Offline-Modus">
      <div className="ring"><CloudOff size={44} /></div>
      <h2>Offline-Modus</h2>
      <p>Du hast keine Internetverbindung. Die App arbeitet weiter – alles wird auf dem Gerät gespeichert.</p>
      <ul>
        <li><MapIcon size={18} />Karte: bereits angesehene Ausschnitte verfügbar</li>
        <li><Check size={18} />Begehungen, Trassen & Punkte verfügbar</li>
        <li><Save size={18} />Neue Fotos, Notizen & Meldungen werden gespeichert</li>
        <li><CloudOff size={18} />KI und Adresssuche erst wieder online{pending ? ` (${pending} Aufnahme(n) warten)` : ''}</li>
      </ul>
      <button className="btn big" onClick={() => { setShow(false); setSeen(true); }}>Verstanden</button>
    </div>
  );
}
