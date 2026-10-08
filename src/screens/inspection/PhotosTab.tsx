import { useState } from 'react';
import { Camera, ImagePlus, Images } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import type { PhotoMeta } from '../../model/types';
import { usePhotoUrl } from '../../camera/photoUrls';
import { useApp } from '../../state/appStore';
import { AnnotationLayer } from '../../annotate/AnnotationLayer';
import { Empty, Nav, Seg } from '../../ui/kit';
import { actionPhoto, useUi } from './actions';
import { useCanEdit, UndoRedo } from './parts';
import { navigate } from '../../router';

export function PhotoThumb({ photo, onClick }: { photo: PhotoMeta; onClick: () => void }) {
  const url = usePhotoUrl(photo.id, 'thumb');
  const types = useApp((s) => s.settings.lineTypes);
  const anns = photo.annotations ?? [];
  const w = photo.width || 1000, h = photo.height || 750;
  // Vorschaubild ist quadratisch zugeschnitten (object-fit: cover) → gleiche Ausschnittslogik für die Linien
  const side = Math.min(w, h);
  const flag = !photo.pointId && !photo.noteId ? '?' : photo.pointAutoAssigned ? 'A' : '';
  return (
    <button className="photo-cell" onClick={onClick} aria-label={`Foto ${photo.number}`}>
      {url && <img src={url} alt="" loading="lazy" />}
      {anns.length > 0 && (
        <svg className="thumb-ann" viewBox={`${(w - side) / 2} ${(h - side) / 2} ${side} ${side}`}>
          <AnnotationLayer anns={anns} w={w} h={h} types={types} labels={false} thin />
        </svg>
      )}
      <span className="ph-num">{photo.number}</span>
      {flag && <span className="ph-flag" title={flag === '?' ? 'nicht zugeordnet' : 'automatisch zugeordnet'}>{flag}</span>}
    </button>
  );
}

type Filter = 'all' | 'loose' | 'nogps';

export default function PhotosTab() {
  const insp = useInspection((s) => s.insp)!;
  const canEdit = useCanEdit();
  const [filter, setFilter] = useState<Filter>('all');
  const photos = [...insp.photos].reverse().filter((f) =>
    filter === 'loose' ? !f.pointId && !f.noteId : filter === 'nogps' ? !f.position : true);
  const loose = insp.photos.filter((f) => !f.pointId && !f.noteId).length;

  return (
    <>
      <Nav title="Fotos" backLabel="Start" onBack={() => navigate('/', true)} right={<UndoRedo />} />
      <div className="scroll with-tabs">
        {canEdit && (
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button className="btn primary big" onClick={() => actionPhoto()}><Camera size={22} />Foto aufnehmen</button>
            <button className="btn big" style={{ flex: '0 0 64px' }} aria-label="Aus Mediathek" onClick={() => actionPhoto({ library: true })}><ImagePlus size={22} /></button>
          </div>
        )}
        {insp.photos.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Seg<Filter> value={filter} onChange={setFilter} options={[
              { value: 'all', label: `Alle (${insp.photos.length})` },
              { value: 'loose', label: `Ohne Zuordnung (${loose})` },
              { value: 'nogps', label: 'Ohne GPS' },
            ]} />
          </div>
        )}
        {photos.length ? (
          <div className="photo-grid">
            {photos.map((f) => <PhotoThumb key={f.id} photo={f} onClick={() => useUi.getState().set({ photoId: f.id })} />)}
          </div>
        ) : (
          <Empty icon={<Images size={44} />} title={insp.photos.length ? 'Keine Fotos in diesem Filter' : 'Noch keine Fotos'} text={insp.photos.length ? undefined : 'Fotos werden automatisch mit Zeit, GPS-Position und dem nächsten Trassenpunkt verknüpft.'} />
        )}
        {insp.photos.length > 0 && (
          <div className="small muted" style={{ marginTop: 10 }}>„A“ = automatisch dem nächsten Punkt (≤ 30 m) zugeordnet · „?“ = nicht zugeordnet</div>
        )}
      </div>
    </>
  );
}
