import { useEffect, useState } from 'react';
import { FileStack, FolderOpen, Plus, Settings as Cog, Share, Download, X } from 'lucide-react';
import type { InspectionSummaryRow } from '../model/types';
import { listInspections } from '../storage/db';
import { navigate } from '../router';
import { Banner, Empty, Spinner, SyncPill } from '../ui/kit';
import { InspectionRow, isIosSafariBrowser } from './common';
import { useApp, toast, errorText } from '../state/appStore';
import { can } from '../model/permissions';
import { pickFile } from '../camera/photo';
import { importInspection } from '../storage/backup';

export default function Home() {
  const [rows, setRows] = useState<InspectionSummaryRow[] | null>(null);
  const user = useApp((s) => s.settings.user);
  const company = useApp((s) => s.settings.company.name);
  const [hideInstall, setHideInstall] = useState(() => { try { return localStorage.getItem('hideInstall') === '1'; } catch { return false; } });

  useEffect(() => { void listInspections().then(setRows); }, []);

  const open = rows?.filter((r) => r.status !== 'completed').length ?? 0;

  async function doImport() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
      const insp = await importInspection(f);
      toast('Begehung importiert.', 'success');
      navigate(`/i/${insp.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="screen">
      <div className="scroll" style={{ paddingTop: 'calc(var(--safe-t) + 12px)' }}>
        <div className="hstack" style={{ justifyContent: 'space-between', margin: '0 4px' }}>
          <span className="muted small">{company || 'Trassenbegehung'}</span>
          <SyncPill />
        </div>
        <h1 className="large-title">Begehungen</h1>
        <p className="subtitle">{rows ? (open ? `${open} offene Begehung${open === 1 ? '' : 'en'}` : 'Keine offenen Begehungen') : ' '}</p>

        <div className="stack">
          {isIosSafariBrowser() && !hideInstall && (
            <Banner kind="info" icon={<Share size={20} />}>
              <div className="hstack" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><b>Als App installieren:</b> unten auf <b>Teilen</b> tippen → <b>„Zum Home-Bildschirm“</b>. Dann läuft die App im Vollbild und offline.</div>
                <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Hinweis ausblenden" onClick={() => { setHideInstall(true); try { localStorage.setItem('hideInstall', '1'); } catch { /* egal */ } }}><X size={16} /></button>
              </div>
            </Banner>
          )}

          {can(user, 'inspection.create') && (
            <button className="hero-btn" onClick={() => navigate('/new')}>
              <div className="hero-icon"><Plus size={28} strokeWidth={2.6} /></div>
              <div><b>Neue Begehung</b><span>Projekt anlegen und losgehen</span></div>
            </button>
          )}

          <div className="tiles">
            <button className="tile" onClick={() => navigate('/list')}>
              <div className="tile-icon" style={{ background: '#0a84ff' }}><FolderOpen size={20} /></div>
              <div><b>Meine Begehungen</b><br /><span>{rows ? `${rows.length} gespeichert` : '…'}</span></div>
            </button>
            <button className="tile" onClick={() => navigate('/templates')}>
              <div className="tile-icon" style={{ background: '#bf5af2' }}><FileStack size={20} /></div>
              <div><b>Vorlagen</b><br /><span>PDF-Hintergründe</span></div>
            </button>
            <button className="tile" onClick={() => navigate('/settings')}>
              <div className="tile-icon" style={{ background: '#8e8e93' }}><Cog size={20} /></div>
              <div><b>Einstellungen</b><br /><span>Firma, KI, Kategorien</span></div>
            </button>
            <button className="tile" onClick={doImport}>
              <div className="tile-icon" style={{ background: '#30b0c7' }}><Download size={20} /></div>
              <div><b>Importieren</b><br /><span>Sicherung öffnen</span></div>
            </button>
          </div>
        </div>

        <div className="group-title">Zuletzt bearbeitet</div>
        {!rows ? (
          <div className="center" style={{ padding: 24 }}><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="list"><Empty icon={<FolderOpen size={40} />} title="Noch keine Begehungen" text="Lege oben deine erste Begehung an." /></div>
        ) : (
          <div className="list">{rows.slice(0, 6).map((r) => <InspectionRow key={r.id} r={r} />)}</div>
        )}
        {rows && rows.length > 6 && (
          <button className="btn plain block" onClick={() => navigate('/list')}>Alle {rows.length} Begehungen anzeigen</button>
        )}
      </div>
    </div>
  );
}
