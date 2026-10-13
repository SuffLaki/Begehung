// Fotos exportieren: in die Galerie (iPhone über „Bilder sichern“) oder als Dateien.

import { useState } from 'react';
import { Download, Images } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, errorText, toast } from '../../state/appStore';
import { Sheet, Spinner, SwitchRow } from '../../ui/kit';
import { preparePhotos, shareOrDownload } from '../../camera/exportPhotos';
import { isAppleTouch } from '../../share/share';
import { useUi } from './actions';

export default function ExportSheet() {
  const ids = useUi((s) => s.exportPhotoIds);
  if (!ids) return null;
  return <ExportInner key={ids.join()} ids={ids} />;
}

function ExportInner({ ids }: { ids: string[] }) {
  const insp = useInspection((s) => s.insp)!;
  const settings = useApp((s) => s.settings);
  const [stamp, setStamp] = useState(true);
  const [busy, setBusy] = useState('');
  const [files, setFiles] = useState<File[] | null>(null);
  const photos = insp.photos.filter((f) => ids.includes(f.id));
  const close = () => useUi.getState().set({ exportPhotoIds: null });

  async function prepare() {
    setBusy('Fotos werden vorbereitet …');
    try {
      setFiles(await preparePhotos(photos, insp, settings, stamp, (i, n) => setBusy(`Foto ${i} von ${n} …`)));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <Sheet open onClose={close} title={photos.length === 1 ? `Foto ${photos[0].number} exportieren` : `${photos.length} Fotos exportieren`}>
      <div className="stack">
        {!files ? (
          <>
            <div className="list">
              <SwitchRow title="Mit Standort-Stempel" sub="Datum, Uhrzeit, Adresse, GPS und Projekt unten ins Bild schreiben" checked={stamp} onChange={setStamp} />
            </div>
            <div className="small muted">Eingezeichnete Linien (Tiefbau, Leerrohr …) werden immer mit ins Bild übernommen. Das Original in der App bleibt unverändert.</div>
            <button className="btn primary big block" disabled={!!busy || !photos.length} onClick={() => void prepare()}>{busy ? <><Spinner />{busy}</> : <>Fotos vorbereiten</>}</button>
          </>
        ) : (
          <>
            <div className="banner ok"><Images size={20} /><div className="grow"><b>{files.length} {files.length === 1 ? 'Foto' : 'Fotos'} bereit.</b> {isAppleTouch() ? 'Im Teilen-Menü „Bilder sichern“ wählen – dann sind sie in der Fotos-App.' : 'Die Bilder werden in den Download-Ordner gespeichert.'}</div></div>
            <button className="btn primary big block" onClick={() => {
              shareOrDownload(files).then((r) => {
                if (r === 'downloaded') toast(`${files.length} ${files.length === 1 ? 'Bild' : 'Bilder'} im Download-Ordner gespeichert.`, 'success');
                if (r !== 'cancelled') close();
              }).catch((e) => toast(errorText(e), 'error'));
            }}><Download size={20} />{isAppleTouch() ? 'In Galerie sichern / Teilen' : 'Herunterladen'}</button>
            <button className="btn block" onClick={() => setFiles(null)}>Zurück</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
