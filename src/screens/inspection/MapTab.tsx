// Karte + Trassen-Editor.
// Ansichtsmodus: Karte bewegen, Punkte/Fotos antippen, Schnellaktionen.
// Bearbeitungsmodus: Punkte ziehen, Punkte/Markierungen setzen, in Linien
// einfügen (Linie antippen), Abschnitte verwalten, Undo/Redo.

import { useEffect, useState } from 'react';
import { Layers, LocateFixed, Maximize, Pencil, Check, MapPinPlus, Diamond, Spline, ListOrdered, Undo2, Redo2, Camera, Mic, MapPin, PencilLine, Crosshair, Pause, Play, Square, X } from 'lucide-react';
import RouteMap, { type MapTool } from '../../map/RouteMap';
import { useInspection } from '../../state/inspectionStore';
import { useApp, toast } from '../../state/appStore';
import { useGps, useRecorder, pauseRecording, resumeRecording, stopRecording, startGps } from '../../geo/gps';
import { addMarker, addRoutePoint, insertPointOnLine, movePoint, renumber } from '../../geo/routeOps';
import { formatDistance, hasUnscaledLength, pathLength, planDistance, routeLength } from '../../geo/geo';
import { activePlan } from '../../plans/plans';
import { FileImage } from 'lucide-react';
import { pointDisplayName } from '../../model/factory';
import type { LatLng, MapType } from '../../model/types';
import { Seg, Sheet, SwitchRow, fmtDuration } from '../../ui/kit';
import { MAP_TYPES } from '../../map/providers';
import { actionLocation, actionNote, actionPhoto, actionVoice, useUi } from './actions';
import { useCanEdit } from './parts';

export default function MapTab() {
  const insp = useInspection((s) => s.insp)!;
  const past = useInspection((s) => s.past.length);
  const future = useInspection((s) => s.future.length);
  const mapType = useApp((s) => s.settings.defaultMapType);
  const gpsFix = useGps((s) => s.fix);
  const rec = useRecorder();
  const ui = useUi();
  const canEdit = useCanEdit();
  const [editMode, setEditMode] = useState(false);
  const [tool, setTool] = useState<MapTool>('none');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [centerOn, setCenterOn] = useState<{ pos: LatLng; n: number } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [showPhotos, setShowPhotos] = useState(true);
  const [showTracks, setShowTracks] = useState(true);
  const [measure, setMeasure] = useState<LatLng[]>([]);
  const [measureM, setMeasureM] = useState('');
  const plan = activePlan(insp);

  // Werkzeug aus anderer Ansicht übernehmen (z. B. „Standort“ auf einem Plan → Punkt antippen)
  useEffect(() => {
    const t = useUi.getState().mapTool;
    if (t) {
      setEditMode(true);
      setTool(t);
      setMeasure([]);
      useUi.getState().set({ mapTool: null });
    }
  }, [ui.mapTool]);

  const mutate = useInspection.getState().mutate;
  const unplaced = insp.route.points.filter((p) => !p.position);
  const active = insp.route.segments.find((s) => s.id === insp.activeSegmentId) ?? insp.route.segments[0];
  const track = rec.trackId ? insp.route.tracks.find((t) => t.id === rec.trackId) : null;

  function setMapType(t: MapType) {
    void useApp.getState().updateSettings((s) => { s.defaultMapType = t; });
  }

  function chooseTool(t: MapTool) {
    setTool((cur) => (cur === t ? 'none' : t));
    setPlaceId(null);
  }

  function onTapMap(p: LatLng) {
    if (!canEdit) return;
    // auf einem Plan nur innerhalb des Plans
    if (plan && (p.lng < 0 || p.lng > plan.width || p.lat > 0 || p.lat < -plan.height)) return;
    if (tool === 'measure') {
      setMeasure((m) => (m.length >= 2 ? [p] : [...m, p]));
      return;
    }
    if (tool === 'addPoint') {
      mutate((d) => { addRoutePoint(d, p, { source: 'manual' }); });
    } else if (tool === 'addMarker') {
      let id = '';
      mutate((d) => { id = addMarker(d, p).id; });
      setTool('none');
      ui.set({ pointId: id });
    } else if (tool === 'place' && placeId) {
      mutate((d) => {
        const pt = d.route.points.find((x) => x.id === placeId);
        if (pt) { pt.position = p; pt.confirmed = true; pt.updatedAt = Date.now(); }
      });
      const rest = unplaced.filter((x) => x.id !== placeId);
      if (rest.length) setPlaceId(rest[0].id);
      else { setPlaceId(null); setTool('none'); toast('Alle Punkte platziert.', 'success'); }
    }
  }

  function onTapLine(segId: string, p: LatLng) {
    if (!canEdit || !editMode) return;
    if (tool === 'addPoint') {
      let ok = false;
      mutate((d) => { ok = !!insertPointOnLine(d, segId, p); });
      if (ok) toast('Punkt in Linie eingefügt.', 'success');
    } else if (tool === 'none') {
      mutate((d) => { d.activeSegmentId = segId; }, { undoable: false });
      const s = insp.route.segments.find((x) => x.id === segId);
      toast(`${s?.name ?? 'Abschnitt'} ist jetzt aktiv – neue Punkte werden dort angehängt.`);
    }
  }

  const hint = !editMode ? null
    : tool === 'addPoint' ? <>Tippe auf die Karte, um an <b>{active?.name}</b> anzuhängen – oder auf eine Linie, um einen Punkt einzufügen.</>
    : tool === 'addMarker' ? <>Tippe auf die Karte, um eine Markierung zu setzen.</>
    : tool === 'measure' ? <>{measure.length === 0 ? 'Ersten Punkt einer bekannten Strecke antippen.' : measure.length === 1 ? 'Zweiten Punkt antippen.' : 'Länge eingeben.'}</>
    : tool === 'place' ? <>Tippe auf die Karte, um <b>{(() => { const p = unplaced.find((x) => x.id === placeId); return p ? `${pointDisplayName(p)}${p.title ? ' – ' + p.title : ''}` : ''; })()}</b> zu platzieren.</>
    : <>Punkte ziehen zum Verschieben · Punkt antippen für Details · Linie antippen = Abschnitt aktiv</>;

  return (
    <div className="map-screen">
      <RouteMap
        key={plan?.id ?? 'map'}
        plan={plan ? { id: plan.id, width: plan.width, height: plan.height } : null}
        extraLine={tool === 'measure' ? measure : undefined}
        insp={insp}
        mapType={mapType}
        editMode={editMode && canEdit}
        tool={tool}
        selectedId={ui.pointId}
        selectedPhotoId={ui.photoId}
        showPhotos={showPhotos}
        showTracks={showTracks}
        gpsFix={gpsFix}
        liveTrackId={rec.trackId}
        fitSignal={fitSignal}
        centerOn={centerOn}
        onTapMap={onTapMap}
        onTapLine={onTapLine}
        onSelectPoint={(id) => tool !== 'place' && ui.set({ pointId: id })}
        onSelectPhoto={(id) => ui.set({ photoId: id })}
        onMovePoint={(id, p) => mutate((d) => movePoint(d, id, p))}
      />

      <div className="map-top">
        <div className="glass map-title">
          {active && <span className="seg-swatch" style={{ background: active.color }} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t ellipsis">{insp.meta.projectName || 'Begehung'}</div>
            <div className="s ellipsis">{plan ? `Plan: ${plan.name} · ` : ''}{formatDistance(routeLength(insp.route, insp.plans))}{hasUnscaledLength(insp.route, insp.plans) ? ' (Plan ohne Maßstab)' : ''} · {insp.route.points.filter((p) => p.kind === 'route').length} Punkte{editMode && active ? ` · aktiv: ${active.name}` : ''}</div>
          </div>
        </div>
        <div className="glass map-ctl">
          <button onClick={() => ui.set({ basemapOpen: true })} aria-label="Plan / Kartengrundlage" className={plan ? 'on' : ''}><FileImage size={22} /></button>
          <button onClick={() => setLayersOpen(true)} aria-label="Kartenansicht"><Layers size={22} /></button>
        </div>
      </div>

      <div className="map-right">
        <div className="glass map-ctl">
          {!plan && <button aria-label="Auf meinen Standort" onClick={() => { if (gpsFix) setCenterOn({ pos: gpsFix, n: Date.now() }); else void startGps(); }}><LocateFixed size={22} /></button>}
          <button aria-label="Trasse einpassen" onClick={() => setFitSignal((n) => n + 1)}><Maximize size={20} /></button>
        </div>
        {canEdit && (
          <div className="glass map-ctl">
            <button className={editMode ? 'on' : ''} aria-label={editMode ? 'Bearbeiten beenden' : 'Trasse bearbeiten'} onClick={() => { setEditMode(!editMode); setTool('none'); setPlaceId(null); }}>
              {editMode ? <Check size={22} /> : <Pencil size={20} />}
            </button>
          </div>
        )}
      </div>

      <div className="map-bottom">
        {canEdit && unplaced.length > 0 && tool !== 'place' && (
          <button className="glass map-hint" onClick={() => { setEditMode(true); setTool('place'); setPlaceId(unplaced[0].id); }}>
            <Crosshair size={20} color="#ff9f0a" />
            <span className="grow" style={{ textAlign: 'left' }}><b>{unplaced.length} Punkt{unplaced.length === 1 ? '' : 'e'} ohne Position</b> – antippen und auf der Karte setzen</span>
          </button>
        )}

        {track && (
          <div className="glass map-hint">
            {!rec.paused && <span className="rec-dot" />}
            <span className="grow"><b>{rec.paused ? 'Pausiert' : 'Aufzeichnung'}</b> · {formatDistance(pathLength(track.fixes))} · {fmtDuration(track.durationMs + (rec.runStartedAt ? Date.now() - rec.runStartedAt : 0))}</span>
            {rec.paused
              ? <button className="icon-btn" aria-label="Fortsetzen" onClick={() => void resumeRecording(track.id)}><Play size={20} /></button>
              : <button className="icon-btn" aria-label="Pause" onClick={() => pauseRecording()}><Pause size={20} /></button>}
            <button className="icon-btn" aria-label="Beenden" style={{ color: 'var(--danger)' }} onClick={() => { stopRecording(); toast('Aufzeichnung beendet – im Tab „Begehung“ in Trasse übernehmen.'); }}><Square size={18} /></button>
          </div>
        )}

        {editMode && canEdit ? (
          <>
            <div className="glass map-hint small">
              <span className="grow">{hint}</span>
              {tool !== 'none' && <button className="icon-btn" aria-label="Werkzeug beenden" onClick={() => { setTool('none'); setPlaceId(null); }}><X size={18} /></button>}
            </div>
            <div className="glass edit-bar">
              <button className={tool === 'addPoint' ? 'on' : ''} onClick={() => chooseTool('addPoint')}><MapPinPlus size={22} />Punkt</button>
              <button className={tool === 'addMarker' ? 'on' : ''} onClick={() => chooseTool('addMarker')}><Diamond size={22} />Symbol</button>
              <button onClick={() => ui.set({ segmentsOpen: true })}><Spline size={22} />Abschnitte</button>
              <button onClick={() => { mutate((d) => renumber(d)); toast('Punkte neu nummeriert.', 'success'); }}><ListOrdered size={22} />Nummern</button>
              <button disabled={!past} onClick={() => useInspection.getState().undo()}><Undo2 size={22} />Zurück</button>
              <button disabled={!future} onClick={() => useInspection.getState().redo()}><Redo2 size={22} />Vor</button>
              <button onClick={() => { setEditMode(false); setTool('none'); }}><Check size={22} />Fertig</button>
            </div>
          </>
        ) : canEdit ? (
          <div className="map-actions">
            <button className="fab sm a-loc" aria-label={plan ? 'Punkt auf Plan setzen' : 'Standort als Punkt'} onClick={() => (plan ? (setEditMode(true), setTool('addPoint')) : void actionLocation())}><MapPin size={24} /></button>
            <button className="fab a-cam" aria-label="Foto" onClick={() => actionPhoto()}><Camera size={28} /></button>
            <button className="fab a-mic" aria-label="Trasse per Sprache" onClick={() => actionVoice(plan ? 'note' : 'route')}><Mic size={28} /></button>
            <button className="fab sm a-note" aria-label="Notiz" onClick={() => actionNote()}><PencilLine size={22} /></button>
          </div>
        ) : null}
      </div>

      <Sheet open={tool === 'measure' && measure.length === 2 && !!plan} onClose={() => setMeasure([])} title="Strecke auf dem Plan">
        <div className="stack">
          <div className="list"><div className="field"><label htmlFor="measure-m">Länge der Strecke in Metern</label><input id="measure-m" inputMode="decimal" autoFocus value={measureM} onChange={(e) => setMeasureM(e.target.value)} placeholder="z. B. 25" /></div></div>
          <button className="btn primary block" onClick={() => {
            const m = parseFloat(measureM.replace(',', '.'));
            const px = measure.length === 2 ? planDistance(measure[0], measure[1]) : 0;
            if (!(m > 0) || px < 5 || !plan) { toast('Bitte eine Länge in Metern eingeben (Punkte nicht zu dicht).', 'error'); return; }
            mutate((d) => { const p = d.plans?.find((x) => x.id === plan.id); if (p) { p.metersPerPx = m / px; p.scaleNote = `über ${m} m lange Strecke gemessen`; } });
            toast('Maßstab gespeichert – Längen werden jetzt berechnet.', 'success');
            setMeasure([]); setMeasureM(''); setTool('none');
          }}>Maßstab übernehmen</button>
        </div>
      </Sheet>

      <Sheet open={layersOpen} onClose={() => setLayersOpen(false)} title="Kartenansicht">
        <div className="stack">
          <button className="row" style={{ background: 'var(--bg-elev)', borderRadius: 14 }} onClick={() => { setLayersOpen(false); ui.set({ basemapOpen: true }); }}>
            <div className="row-icon" style={{ background: '#5e5ce6' }}><FileImage size={16} /></div>
            <div className="row-main"><div className="row-title">Grundlage: {plan ? plan.name : 'Landkarte'}</div><div className="row-sub">Plan einfügen oder wechseln</div></div>
          </button>
          {!plan && <Seg<MapType> value={mapType} onChange={setMapType} options={(Object.keys(MAP_TYPES) as MapType[]).map((k) => ({ value: k, label: MAP_TYPES[k].label }))} />}
          <div className="list">
            <SwitchRow title="Fotos anzeigen" checked={showPhotos} onChange={setShowPhotos} />
            <SwitchRow title="GPS-Spuren anzeigen" sub="Rohdaten der Aufzeichnungen (gepunktet)" checked={showTracks} onChange={setShowTracks} />
          </div>
          <div className="small muted">
            Offline: Kartenausschnitte, die du online angesehen hast, bleiben gespeichert. Für ein Gebiet ohne Netz die Karte vorher im WLAN durchzoomen.
          </div>
          {editMode && active && (
            <div className="small muted">Aktiver Abschnitt: {active.name}. Neue Punkte werden dort angehängt.</div>
          )}
        </div>
      </Sheet>
    </div>
  );
}

