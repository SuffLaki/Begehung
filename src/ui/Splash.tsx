// Startbildschirm (kurz beim App-Start) und Offline-Hinweis.

import { useEffect, useState } from 'react';
import { CloudOff, Check, Map as MapIcon, Save } from 'lucide-react';
import { useApp } from '../state/appStore';
import { getLogo, logoDataUrl } from '../brand/logos';

/** Gewähltes App-Symbol als Bild */
export function AppLogo({ size = 96, id }: { size?: number; id?: string }) {
  const chosen = useApp((s) => s.settings.appLogo);
  const l = getLogo(id ?? chosen);
  return <img className="app-logo" src={logoDataUrl(l)} width={size} height={size} alt="" style={{ borderRadius: size * 0.225 }} />;
}

/** Startanimation erneut abspielen (z. B. nach Wechsel des App-Symbols) */
export function replaySplash() {
  window.dispatchEvent(new Event('trasso:splash'));
}

export default function Splash() {
  const design = useApp((s) => s.settings.design ?? 'trasse');
  const loaded = useApp((s) => s.settingsLoaded);
  const logo = getLogo(useApp((s) => s.settings.appLogo));
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>('show');
  const [run, setRun] = useState(0);
  const [forced, setForced] = useState(false);
  useEffect(() => {
    const again = () => { setForced(true); setRun((n) => n + 1); setPhase('show'); };
    window.addEventListener('trasso:splash', again);
    return () => window.removeEventListener('trasso:splash', again);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t1 = window.setTimeout(() => setPhase('fade'), still ? 700 : 2000);
    const t2 = window.setTimeout(() => { setPhase('gone'); setForced(false); }, still ? 1000 : 2400);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [loaded, run]);
  if (phase === 'gone' || (loaded && design === 'klassisch' && !forced)) return null;
  return (
    <div className={`splash${phase === 'fade' ? ' hide' : ''}`} onClick={() => { setPhase('gone'); setForced(false); }} role="presentation"
      style={{ background: `radial-gradient(120% 70% at 50% 38%, ${logo.bg[0]}, ${logo.bg[1]})` }}>
      {/* Inline-SVG, damit die Animations-Klassen greifen; Schlüssel startet die Animation neu */}
      {loaded && (
        <>
          <div key={`${logo.id}-${run}`} className={`splash-logo lg-${logo.id}`} dangerouslySetInnerHTML={{ __html: logo.svg }} />
          <h1 key={`t-${run}`}>Trasso</h1>
          <p key={`p-${run}`}>Trassen &amp; Baustellen – digital dokumentiert.</p>
        </>
      )}
      <div className="ver">Version 1.4</div>
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
