// Gemeinsame Teile der Begehungsansicht: Aktionsleiste, GPS-Zeile, Aufzeichnung.

import { useEffect, useState } from 'react';
import { Camera, Mic, MapPin, PencilLine, Navigation, Pause, Play, Square, Route as RouteIcon, Undo2, Redo2, Trash2 } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, confirmDialog, toast } from '../../state/appStore';
import { accuracyLabel, pauseRecording, resumeRecording, startGps, startRecording, stopRecording, useGps, useRecorder, wakeLockSupported } from '../../geo/gps';
import { actionLocation, actionNote, actionPhoto, actionVoice } from './actions';
import { canEditInspection } from '../../model/permissions';
import { formatDistance, median, pathLength } from '../../geo/geo';
import { trackToSegment } from '../../geo/routeOps';
import { fmtDuration } from '../../ui/kit';

export function useCanEdit(): boolean {
  const insp = useInspection((s) => s.insp);
  const user = useApp((s) => s.settings.user);
  return canEditInspection(user, insp);
}

export function ActionBar() {
  const canEdit = useCanEdit();
  return (
    <div className="action-bar">
      <button className="action" disabled={!canEdit} onClick={() => void actionLocation()}>
        <span className="a-icon a-loc"><MapPin size={24} /></span>Standort
      </button>
      <button className="action" disabled={!canEdit} onClick={() => actionPhoto()}>
        <span className="a-icon a-cam"><Camera size={24} /></span>Foto
      </button>
      <button className="action" disabled={!canEdit} onClick={() => actionVoice('note')}>
        <span className="a-icon a-mic"><Mic size={24} /></span>Sprache
      </button>
      <button className="action" disabled={!canEdit} onClick={() => actionNote()}>
        <span className="a-icon a-note"><PencilLine size={24} /></span>Notiz
      </button>
    </div>
  );
}

export function UndoRedo() {
  const past = useInspection((s) => s.past.length);
  const future = useInspection((s) => s.future.length);
  const canEdit = useCanEdit();
  if (!canEdit) return null;
  return (
    <>
      <button className="nav-btn" disabled={!past} onClick={() => useInspection.getState().undo()} aria-label="Rückgängig"><Undo2 size={22} /></button>
      <button className="nav-btn" disabled={!future} onClick={() => useInspection.getState().redo()} aria-label="Wiederholen"><Redo2 size={22} /></button>
    </>
  );
}

export function GpsLine() {
  const { status, fix, error } = useGps();
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((x) => x + 1), 5000); return () => window.clearInterval(t); }, []);
  const acc = accuracyLabel(fix?.accuracy);
  const age = fix ? Math.round((Date.now() - fix.timestamp) / 1000) : null;
  let text: string;
  if (status === 'off') text = 'GPS aus – tippen zum Aktivieren';
  else if (status === 'denied') text = 'Standortzugriff verweigert';
  else if (status === 'unavailable') text = 'Kein GPS verfügbar';
  else if (!fix) text = 'GPS sucht Signal …';
  else text = `GPS aktiv · ${acc.text}${age !== null && age > 30 ? ` · vor ${age} s` : ''}`;
  return (
    <button className="gps-line" style={{ width: '100%', textAlign: 'left' }} onClick={() => void startGps()}>
      <Navigation size={18} className={fix ? `acc-${acc.level}` : 'muted'} />
      <div className="grow">
        <div>{text}</div>
        {error && status !== 'active' && <div className="small muted">{error}</div>}
        {fix && acc.level === 'bad' && <div className="small muted">Ungenau – im Freien warten, bis sich die Genauigkeit verbessert.</div>}
      </div>
    </button>
  );
}

export function RecorderCard() {
  const insp = useInspection((s) => s.insp)!;
  const rec = useRecorder();
  const canEdit = useCanEdit();
  const fix = useGps((s) => s.fix);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!rec.trackId || rec.paused) return;
    const t = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [rec.trackId, rec.paused]);

  const track = rec.trackId ? insp.route.tracks.find((t) => t.id === rec.trackId) : null;
  const finished = insp.route.tracks.filter((t) => t.endedAt && !t.convertedSegmentId && t.fixes.length >= 2);

  if (!canEdit && !track) return null;

  if (!track) {
    return (
      <div className="stack">
        <button className="btn block" onClick={() => void startRecording()} disabled={!canEdit}>
          <RouteIcon size={20} /> Trasse aufzeichnen
        </button>
        {finished.map((t) => <FinishedTrack key={t.id} id={t.id} />)}
      </div>
    );
  }

  const dur = track.durationMs + (rec.runStartedAt ? Date.now() - rec.runStartedAt : 0);
  const dist = pathLength(track.fixes);
  const accs = track.fixes.map((f) => f.acc).filter((a): a is number => a != null);
  const med = median(accs);
  return (
    <div className={`rec-card${rec.paused ? '' : ' live'}`}>
      <div className="hstack">
        {!rec.paused && <span className="rec-dot" />}
        <b className="grow">{rec.paused ? 'Aufzeichnung pausiert' : 'Trasse wird aufgezeichnet'}</b>
        {fix && <span className={`badge ${accuracyLabel(fix.accuracy).level === 'good' ? 'ok' : accuracyLabel(fix.accuracy).level === 'bad' ? 'danger' : 'warn'}`}>{accuracyLabel(fix.accuracy).text}</span>}
      </div>
      <div className="rec-stats">
        <div><b>{formatDistance(dist)}</b><span>Strecke</span></div>
        <div><b>{fmtDuration(dur)}</b><span>Zeit</span></div>
        <div><b>{track.fixes.length}</b><span>Messpunkte</span></div>
      </div>
      <div className="small muted">
        {med != null ? `Mittlere Genauigkeit ±${Math.round(med)} m. ` : ''}
        {track.rejected ? `${track.rejected} ungenaue Messungen verworfen. ` : ''}
        {!wakeLockSupported() ? 'Bildschirm nicht sperren – iOS stoppt GPS bei gesperrtem Gerät.' : 'Bildschirm bleibt an. App nicht verlassen – im Hintergrund pausiert iOS das GPS.'}
      </div>
      <div className="btn-row">
        {rec.paused ? (
          <button className="btn" onClick={() => void resumeRecording(track.id)}><Play size={18} />Fortsetzen</button>
        ) : (
          <button className="btn" onClick={() => pauseRecording()}><Pause size={18} />Pause</button>
        )}
        <button className="btn danger" onClick={() => stopRecording()}><Square size={16} />Beenden</button>
      </div>
    </div>
  );
}

function FinishedTrack({ id }: { id: string }) {
  const t = useInspection((s) => s.insp!.route.tracks.find((x) => x.id === id))!;
  const accs = t.fixes.map((f) => f.acc).filter((a): a is number => a != null);
  const med = median(accs);
  const worst = accs.length ? Math.max(...accs) : null;
  return (
    <div className="rec-card">
      <b>Aufzeichnung beendet</b>
      <div className="small muted">
        {formatDistance(pathLength(t.fixes))} · {fmtDuration(t.durationMs)} · {t.fixes.length} Messpunkte
        {med != null && ` · Genauigkeit Ø ±${Math.round(med)} m (schlechteste ±${Math.round(worst!)} m)`}
      </div>
      <div className="btn-row">
        <button className="btn primary" onClick={() => {
          let n = 0;
          useInspection.getState().mutate((d) => { const s = trackToSegment(d, id); n = s?.pointIds.length ?? 0; });
          toast(`Als Trassenabschnitt übernommen (${n} Punkte). Auf der Karte korrigierbar.`, 'success');
        }}>In Trasse übernehmen</button>
        <button className="btn danger" style={{ flex: '0 0 56px' }} aria-label="Aufzeichnung verwerfen" onClick={async () => {
          if (await confirmDialog({ title: 'Aufzeichnung verwerfen?', message: 'Die GPS-Spur wird gelöscht.', confirmLabel: 'Verwerfen', destructive: true })) {
            useInspection.getState().mutate((d) => { d.route.tracks = d.route.tracks.filter((x) => x.id !== id); });
          }
        }}><Trash2 size={18} /></button>
      </div>
    </div>
  );
}
