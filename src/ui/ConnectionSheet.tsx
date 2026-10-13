// Verbindung: Online/Offline-Regler, was offline pausiert, was nachgeholt wird, Desktop-Abgleich.

import { useEffect, useState } from 'react';
import { Wifi, CloudOff, Sparkles, MapPin, Map as MapIcon, MonitorSmartphone } from 'lucide-react';
import { useApp } from '../state/appStore';
import { Row, Seg, Sheet } from './kit';
import { listAllInspections } from '../storage/db';
import { pendingChanges } from '../sync/syncPackage';
import { navigate } from '../router';

export function openConnection() {
  useApp.setState({ connOpen: true });
}

export default function ConnectionSheet() {
  const open = useApp((s) => s.connOpen);
  const offlineMode = useApp((s) => !!s.settings.offlineMode);
  const deviceOnline = useApp((s) => s.deviceOnline);
  const online = useApp((s) => s.online);
  const pendingJobs = useApp((s) => s.pendingJobs);
  const [missingAddr, setMissingAddr] = useState(0);
  const [changes, setChanges] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    void listAllInspections().then((all) => setMissingAddr(all.reduce((n, i) =>
      n + i.photos.filter((f) => f.position && !f.address).length + i.notes.filter((x) => x.position && !x.address).length, 0)));
    void pendingChanges().then((p) => setChanges(p.changed + p.deleted)).catch(() => setChanges(null));
  }, [open, online]);

  const close = () => useApp.setState({ connOpen: false });
  const set = (v: 'online' | 'offline') => {
    void useApp.getState().setOfflineMode(v === 'offline');
    useApp.getState().toast(v === 'offline' ? 'Offline-Modus an – die App nutzt keine Datenverbindung.' : deviceOnline ? 'Online – Ausstehendes wird nachgeholt.' : 'Online-Modus an – sobald das Gerät Netz hat, geht es weiter.', 'info');
  };

  return (
    <Sheet open={open} onClose={close} title="Verbindung">
      <div className="stack">
        <div className={`conn-state ${online ? 'on' : 'off'}`}>
          {online ? <Wifi size={30} /> : <CloudOff size={30} />}
          <div>
            <b>{online ? 'Online' : offlineMode ? 'Offline (von Hand)' : 'Offline – kein Netz'}</b>
            <div className="small">{online ? 'KI, Adresssuche und Karten laden aus dem Netz.' : 'Alles wird auf dem Gerät gespeichert und später nachgeholt.'}</div>
          </div>
        </div>

        <Seg<'online' | 'offline'> value={offlineMode ? 'offline' : 'online'} onChange={set}
          options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]} />
        {!offlineMode && !deviceOnline && <div className="small muted">Das Gerät hat gerade kein Netz – die App arbeitet offline weiter, bis wieder Empfang da ist.</div>}
        {offlineMode && <div className="small muted">Spart Datenvolumen und Akku, z. B. im Funkloch oder im Ausland. Die App baut keine Verbindung auf, bis du wieder „Online“ wählst.</div>}

        <div className="group-title" style={{ margin: '6px 4px 0' }}>Offline pausiert</div>
        <div className="list">
          <Row icon={<Sparkles size={16} />} iconBg="#7a5af8" title="KI-Auswertung (Sprache, Fotos)" value={pendingJobs ? `${pendingJobs} wartet` : online ? 'aktiv' : 'pausiert'} />
          <Row icon={<MapPin size={16} />} iconBg="#d0352b" title="Adressen zu Koordinaten" value={missingAddr ? `${missingAddr} fehlen` : online ? 'aktiv' : 'pausiert'} />
          <Row icon={<MapIcon size={16} />} iconBg="#2f7de1" title="Kartenkacheln" value={online ? 'aus dem Netz' : 'nur gespeicherte'} />
        </div>
        <div className="small muted" style={{ margin: '0 4px' }}>Koordinaten, Fotos, Notizen, Mängel und PDF funktionieren immer – auch offline.</div>

        <div className="group-title" style={{ margin: '6px 4px 0' }}>Desktop-Abgleich</div>
        <div className="list">
          <Row icon={<MonitorSmartphone size={16} />} iconBg="#23824f" title="Sync-Paket für die Desktop-App"
            sub={changes === null ? undefined : changes ? `${changes} Änderung(en) seit dem letzten Abgleich` : 'alles abgeglichen'}
            onClick={() => { close(); navigate('/sync'); }} />
        </div>
      </div>
    </Sheet>
  );
}
