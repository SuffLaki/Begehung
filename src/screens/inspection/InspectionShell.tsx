import { useEffect, useState } from 'react';
import { ClipboardList, Map as MapIcon, Image, StickyNote, MoreHorizontal } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { navigate } from '../../router';
import { Loading, Nav } from '../../ui/kit';
import { toast } from '../../state/appStore';
import { adoptOpenTrack, resetRecorder, startGps, useRecorder } from '../../geo/gps';
import { useApp } from '../../state/appStore';
import { resetUi } from './actions';
import OverviewTab from './OverviewTab';
import MapTab from './MapTab';
import PhotosTab from './PhotosTab';
import NotesTab from './NotesTab';
import MoreTab from './MoreTab';
import PointSheet from './PointSheet';
import PhotoSheet from './PhotoSheet';
import NoteSheet from './NoteSheet';
import VoiceSheet from './VoiceSheet';
import SegmentsSheet from './SegmentsSheet';
import AnnotateSheet from './AnnotateSheet';
import BasemapSheet from './BasemapSheet';

const TABS = [
  { id: 'overview', label: 'Begehung', icon: ClipboardList },
  { id: 'map', label: 'Karte', icon: MapIcon },
  { id: 'photos', label: 'Fotos', icon: Image },
  { id: 'notes', label: 'Notizen', icon: StickyNote },
  { id: 'more', label: 'Mehr', icon: MoreHorizontal },
] as const;

let loadedId: string | null = null;

export default function InspectionShell({ id, tab }: { id: string; tab: string }) {
  const insp = useInspection((s) => s.insp);
  const [missing, setMissing] = useState(false);
  const recording = useRecorder((s) => s.trackId && !s.paused);
  const consent = useApp((s) => s.settings.gps.locationConsent);

  useEffect(() => {
    if (loadedId !== id) {
      resetUi();
      resetRecorder();
    }
    loadedId = id;
    void useInspection.getState().load(id).then((ok) => {
      if (!ok) {
        setMissing(true);
        toast('Begehung nicht gefunden.', 'error');
        navigate('/list', true);
        return;
      }
      adoptOpenTrack(useInspection.getState().insp!.route.tracks);
    });
  }, [id]);

  // Live-Standort, sobald die Freigabe einmal erteilt wurde
  useEffect(() => {
    if (consent && insp?.status !== 'completed') void startGps();
  }, [consent, insp?.status]);

  if (missing) return null;
  if (!insp || insp.id !== id) return <div className="screen"><Nav title="Begehung" backLabel="Start" /><Loading /></div>;

  const openNotes = insp.notes.filter((n) => !n.confirmed).length;
  const autoPoints = insp.route.points.filter((p) => !p.confirmed).length;
  const unassigned = insp.photos.filter((f) => !f.pointId && !f.noteId).length;

  return (
    <div className="screen">
      {tab === 'overview' && <OverviewTab />}
      {tab === 'map' && <MapTab />}
      {tab === 'photos' && <PhotosTab />}
      {tab === 'notes' && <NotesTab />}
      {tab === 'more' && <MoreTab />}

      <nav className="tabbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const badge = t.id === 'notes' ? openNotes : t.id === 'photos' ? unassigned : t.id === 'map' ? (recording ? '●' : autoPoints) : 0;
          return (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => navigate(`/i/${id}/${t.id}`, true)} aria-current={tab === t.id}>
              <Icon size={25} strokeWidth={tab === t.id ? 2.3 : 1.8} />
              {t.label}
              {!!badge && <span className="tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <PointSheet />
      <PhotoSheet />
      <NoteSheet />
      <VoiceSheet />
      <SegmentsSheet />
      <AnnotateSheet />
      <BasemapSheet />
    </div>
  );
}
