// Desktop-Abgleich (Vorbereitung): Sync-Pakete erstellen und vom Desktop einlesen.
// Die Desktop-App gibt es noch nicht – Format und Regeln stehen in docs/SYNC.md.

import { useEffect, useState } from 'react';
import { Upload, Download, MonitorSmartphone, Info, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Banner, Field, Nav, Row, Spinner, fmtDateTime } from '../ui/kit';
import { navigate } from '../router';
import { toast, errorText } from '../state/appStore';
import { exportSyncPackage, importSyncPackage, pendingChanges, type ImportResult } from '../sync/syncPackage';
import { renameDevice, type SyncState } from '../sync/syncState';
import { saveLocally } from '../share/share';
import { pickFile } from '../camera/photo';

export default function DesktopSync() {
  const [info, setInfo] = useState<{ changed: number; deleted: number; total: number; state: SyncState } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [name, setName] = useState('');

  const reload = () => pendingChanges().then((p) => { setInfo(p); setName(p.state.deviceName); });
  useEffect(() => { void reload(); }, []);

  async function doExport(changesOnly: boolean) {
    setBusy(changesOnly ? 'Änderungen werden gepackt …' : 'Alle Begehungen werden gepackt …');
    try {
      const r = await exportSyncPackage({ changesOnly });
      const how = await saveLocally(r.blob, r.fileName);
      if (how !== 'cancelled') toast(`Sync-Paket erstellt: ${r.count} Begehung(en), ${r.photos} Foto(s)${r.deleted ? `, ${r.deleted} gelöscht` : ''}.`, 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
      void reload();
    }
  }

  async function doImport() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    setBusy('Sync-Paket wird eingelesen …');
    try {
      setResult(await importSyncPackage(f, f.name));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
      void reload();
    }
  }

  const st = info?.state;
  return (
    <div className="screen">
      <Nav title="Desktop-Abgleich" backLabel="Zurück" onBack={() => history.length > 1 ? history.back() : navigate('/settings', true)} />
      <div className="scroll">
        <div className="stack">
          <Banner kind="info" icon={<Info size={20} />}>
            <b>Vorbereitung für die Trasso-Desktop-App.</b> Ein Sync-Paket enthält Begehungen mit Fotos, Plänen und Projekten. Es lässt sich per OneDrive, iCloud Drive, AirDrop oder USB zum PC bringen. Pakete vom Desktop liest du hier wieder ein.
          </Banner>

          {!info ? <div className="center" style={{ padding: 20 }}><Spinner /></div> : (
            <>
              <div className="list">
                <Row icon={<MonitorSmartphone size={16} />} iconBg="#23824f" title="Geändert seit letztem Abgleich" value={`${info.changed} von ${info.total}`} />
                <Row title="Gelöschte Begehungen (noch nicht übertragen)" value={String(info.deleted)} />
                <Row title="Letztes Paket erstellt" value={st?.lastExportAt ? fmtDateTime(st.lastExportAt) : 'noch nie'} />
                <Row title="Letztes Paket eingelesen" value={st?.lastImportAt ? fmtDateTime(st.lastImportAt) : 'noch nie'} />
              </div>

              <button className="btn primary big block" disabled={!!busy || (info.changed + info.deleted === 0)} onClick={() => void doExport(true)}>
                {busy ? <><Spinner />{busy}</> : <><Upload size={20} />Änderungen als Sync-Paket</>}
              </button>
              <div className="btn-row">
                <button className="btn" disabled={!!busy || !info.total} onClick={() => void doExport(false)}><Upload size={18} />Alles exportieren</button>
                <button className="btn" disabled={!!busy} onClick={() => void doImport()}><Download size={18} />Paket einlesen</button>
              </div>

              {result && (
                <Banner kind={result.conflicts.length || result.keptDespiteDelete.length ? 'warn' : 'ok'} icon={result.conflicts.length ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}>
                  <b>Eingelesen:</b> {result.added} neu, {result.updated} aktualisiert, {result.unchanged} unverändert{result.deleted ? `, ${result.deleted} gelöscht` : ''}.
                  {result.conflicts.length > 0 && <div>Auf beiden Seiten geändert: {result.conflicts.join(', ')} – deine Fassung bleibt, die Desktop-Fassung liegt als Kopie daneben.</div>}
                  {result.keptDespiteDelete.length > 0 && <div>Am Desktop gelöscht, hier aber geändert und deshalb behalten: {result.keptDespiteDelete.join(', ')}.</div>}
                </Banner>
              )}

              <div className="group-title">Dieses Gerät</div>
              <div className="list">
                <Field label="Gerätename (erscheint auf dem Desktop)" value={name} onChange={(v) => { setName(v); void renameDevice(v); }} />
                <Row title="Geräte-ID" value={<span className="tiny">{st?.deviceId}</span>} />
              </div>

              {!!st?.log.length && (
                <>
                  <div className="group-title">Verlauf</div>
                  <div className="list">
                    {[...st.log].reverse().slice(0, 10).map((l, i) => (
                      <Row key={i} title={`${l.kind === 'export' ? 'Erstellt' : 'Eingelesen'} · ${fmtDateTime(l.at)}`} sub={<span className="ellipsis" style={{ display: 'block' }}>{l.summary} · {l.peer}</span>} />
                    ))}
                  </div>
                </>
              )}
              <div className="group-foot">
                Regeln: Neues vom Desktop wird übernommen. Wurde eine Begehung nur am Desktop geändert, gilt die Desktop-Fassung. Wurde sie auf beiden Seiten geändert, wird nichts überschrieben – die Desktop-Fassung kommt als Kopie dazu. Ein Paket ist nach dem Erstellen „abgeglichen“, auch wenn es noch nicht am PC eingelesen wurde.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
