// Interaktive Karte (Leaflet). Leaflet ist ausschließlich hier und in
// leafletPicker.tsx eingebunden – ein Wechsel der Kartenbibliothek betrifft nur
// diese Komponente; Datenmodell, Editor-Logik (routeOps) und PDF bleiben gleich.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoFix, Inspection, LatLng, MapBounds, MapType } from '../model/types';
import { MAP_TYPES, MAX_ZOOM } from './providers';
import { endpoints, isRelevantPoint } from '../geo/routeOps';
import { pointDisplayName, SYMBOLS } from '../model/factory';
import { boundsOf } from '../geo/geo';

export type MapTool = 'none' | 'addPoint' | 'addMarker' | 'place';

interface Props {
  insp: Inspection;
  mapType: MapType;
  editMode: boolean;
  tool: MapTool;
  selectedId: string | null;
  selectedPhotoId?: string | null;
  showPhotos: boolean;
  showTracks: boolean;
  gpsFix: GeoFix | null;
  liveTrackId: string | null;
  fitSignal: number;
  centerOn: { pos: LatLng; n: number; zoom?: number } | null;
  onTapMap(p: LatLng): void;
  onTapLine(segId: string, p: LatLng): void;
  onSelectPoint(id: string): void;
  onSelectPhoto(id: string): void;
  onMovePoint(id: string, p: LatLng): void;
  /** eigener Schlüssel für die gemerkte Kartenansicht (z. B. PDF-Ausschnitt) */
  viewKey?: string;
  initialBounds?: MapBounds | null;
  onViewChange?(b: MapBounds): void;
}

const views = new Map<string, { center: L.LatLng; zoom: number }>();

function contentPositions(insp: Inspection): LatLng[] {
  const pts: LatLng[] = [];
  insp.route.points.forEach((p) => p.position && pts.push(p.position));
  insp.photos.forEach((f) => f.position && pts.push(f.position));
  insp.route.tracks.forEach((t) => t.fixes.forEach((f) => pts.push(f)));
  return pts;
}

function fit(map: L.Map, insp: Inspection, fallback: GeoFix | null) {
  const b = boundsOf(contentPositions(insp));
  if (b) {
    if (b.south === b.north && b.west === b.east) map.setView([b.south, b.west], 18);
    else map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [48, 48], maxZoom: 19 });
  } else if (fallback) {
    map.setView([fallback.lat, fallback.lng], 17);
  }
}

export default function RouteMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.LayerGroup | null>(null);
  const vecRef = useRef<L.LayerGroup | null>(null);
  const gpsRef = useRef<L.LayerGroup | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ------------------------------------------------ Karte anlegen
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, {
      zoomControl: false,
      attributionControl: true,
      maxZoom: MAX_ZOOM,
      tapTolerance: 20,
      worldCopyJump: false,
    });
    map.attributionControl.setPrefix(false);
    tilesRef.current = L.layerGroup().addTo(map);
    vecRef.current = L.layerGroup().addTo(map);
    gpsRef.current = L.layerGroup().addTo(map);
    const key = propsRef.current.viewKey ?? propsRef.current.insp.id;
    const saved = views.get(key);
    const ib = propsRef.current.initialBounds;
    if (ib) map.fitBounds([[ib.south, ib.west], [ib.north, ib.east]], { animate: false });
    else if (saved) map.setView(saved.center, saved.zoom);
    else {
      map.setView([51.1, 10.4], 6);
      fit(map, propsRef.current.insp, propsRef.current.gpsFix);
    }
    map.on('moveend', () => {
      views.set(key, { center: map.getCenter(), zoom: map.getZoom() });
      const b = map.getBounds();
      propsRef.current.onViewChange?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
    });
    map.on('click', (e: L.LeafletMouseEvent) => propsRef.current.onTapMap({ lat: e.latlng.lat, lng: e.latlng.lng }));
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ------------------------------------------------ Kartenart
  useEffect(() => {
    const g = tilesRef.current;
    const map = mapRef.current;
    if (!g || !map) return;
    g.clearLayers();
    const layers = MAP_TYPES[props.mapType].layers;
    const attributions = [...new Set(layers.map((l) => l.attribution))].join(' · ');
    layers.forEach((src, i) => {
      L.tileLayer(src.url, {
        maxNativeZoom: src.maxNativeZoom,
        maxZoom: MAX_ZOOM,
        crossOrigin: 'anonymous',
        attribution: i === 0 ? attributions : undefined,
        opacity: src.opacity ?? 1,
      }).addTo(g);
    });
  }, [props.mapType]);

  // ------------------------------------------------ Einpassen / Zentrieren
  useEffect(() => {
    if (props.fitSignal && mapRef.current) fit(mapRef.current, props.insp, props.gpsFix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitSignal]);

  useEffect(() => {
    if (props.centerOn && mapRef.current) {
      const m = mapRef.current;
      m.setView([props.centerOn.pos.lat, props.centerOn.pos.lng], props.centerOn.zoom ?? Math.max(m.getZoom(), 17));
    }
  }, [props.centerOn]);

  // erste GPS-Position: hinzoomen, wenn noch nichts erfasst ist
  const jumped = useRef(false);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !props.gpsFix || jumped.current) return;
    jumped.current = true;
    if (!views.has(props.viewKey ?? props.insp.id) && !contentPositions(props.insp).length) m.setView([props.gpsFix.lat, props.gpsFix.lng], 17);
  }, [props.gpsFix, props.insp]);

  // ------------------------------------------------ GPS-Punkt
  useEffect(() => {
    const g = gpsRef.current;
    if (!g) return;
    g.clearLayers();
    const f = props.gpsFix;
    if (!f) return;
    if (f.accuracy) L.circle([f.lat, f.lng], { radius: f.accuracy, color: '#0A84FF', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(g);
    L.marker([f.lat, f.lng], { icon: L.divIcon({ className: 'gps-dot', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false }).addTo(g);
  }, [props.gpsFix]);

  // ------------------------------------------------ Trasse, Punkte, Fotos
  useEffect(() => {
    const g = vecRef.current;
    if (!g) return;
    g.clearLayers();
    const { insp, editMode, selectedId, tool } = props;
    const byId = new Map(insp.route.points.map((p) => [p.id, p]));
    const { startIds, endIds } = endpoints(insp);
    const legsOf = new Map<string, { line: L.Polyline; hit: L.Polyline; end: 0 | 1 }[]>();
    const lineTap = (segId: string) => (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e);
      propsRef.current.onTapLine(segId, { lat: e.latlng.lat, lng: e.latlng.lng });
    };

    // GPS-Aufzeichnungen (Rohdaten)
    if (props.showTracks || props.liveTrackId) {
      for (const t of insp.route.tracks) {
        if (t.fixes.length < 2) continue;
        if (t.convertedSegmentId && t.id !== props.liveTrackId) continue;
        const live = t.id === props.liveTrackId;
        L.polyline(t.fixes.map((f) => [f.lat, f.lng] as L.LatLngTuple), {
          color: live ? '#FF375F' : '#64D2FF', weight: live ? 5 : 3, opacity: 0.85, dashArray: live ? undefined : '2 6', interactive: false,
        }).addTo(g);
      }
    }

    // Linien – jedes Teilstück einzeln, damit unbestätigte Abschnitte gestrichelt erscheinen
    for (const seg of insp.route.segments) {
      for (let i = 0; i < seg.pointIds.length - 1; i++) {
        const a = byId.get(seg.pointIds[i]);
        const b = byId.get(seg.pointIds[i + 1]);
        if (!a?.position || !b?.position) continue;
        const ll: L.LatLngTuple[] = [[a.position.lat, a.position.lng], [b.position.lat, b.position.lng]];
        const unconfirmed = !a.confirmed || !b.confirmed;
        L.polyline(ll, { color: '#000', weight: 8, opacity: 0.35, interactive: false }).addTo(g);
        const line = L.polyline(ll, {
          color: seg.color, weight: 5, opacity: 1, dashArray: unconfirmed ? '10 9' : undefined, interactive: false,
        }).addTo(g);
        const hit = L.polyline(ll, { color: '#000', weight: 26, opacity: 0, interactive: true }).addTo(g);
        hit.on('click', lineTap(seg.id));
        for (const [pid, end] of [[a.id, 0], [b.id, 1]] as const) {
          const arr = legsOf.get(pid) ?? [];
          arr.push({ line, hit, end });
          legsOf.set(pid, arr);
        }
      }
    }

    // Fotos
    if (props.showPhotos) {
      for (const f of insp.photos) {
        const pos = f.position ?? (f.pointId ? byId.get(f.pointId)?.position : null);
        if (!pos) continue;
        const sel = f.id === props.selectedPhotoId;
        const m = L.marker([pos.lat, pos.lng], {
          icon: L.divIcon({ className: '', html: `<div class="mk-photo${sel ? ' sel' : ''}"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"/></svg><b>${f.number}</b></div>`, iconSize: [40, 26], iconAnchor: [20, 13] }),
          zIndexOffset: 200,
          keyboard: false,
        }).addTo(g);
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); propsRef.current.onSelectPhoto(f.id); });
      }
    }

    // Punkte
    for (const p of insp.route.points) {
      if (!p.position) continue;
      const sel = p.id === selectedId;
      const seg = insp.route.segments.find((s) => s.pointIds.includes(p.id));
      const color = seg?.color ?? '#FF9F0A';
      let html: string;
      let size: [number, number];
      if (p.kind === 'marker') {
        const sym = SYMBOLS[p.symbol] ?? SYMBOLS.pin;
        html = `<div class="mk-sym${sel ? ' sel' : ''}${p.confirmed ? '' : ' auto'}"><span>${sym.glyph}</span></div><div class="mk-label">${escapeHtml(pointDisplayName(p))}</div>`;
        size = [36, 36];
      } else if (!isRelevantPoint(insp, p, startIds, endIds) && !sel) {
        html = `<div class="mk-vertex${p.confirmed ? '' : ' auto'}" style="--c:${color}"></div>`;
        size = editMode ? [30, 30] : [14, 14];
      } else {
        const role = startIds.has(p.id) ? ' start' : endIds.has(p.id) ? ' end' : '';
        const text = startIds.has(p.id) && !p.label ? 'S' : endIds.has(p.id) && !p.label ? 'E' : escapeHtml(p.label || String(p.number));
        html = `<div class="mk-pt${role}${sel ? ' sel' : ''}${p.confirmed ? '' : ' auto'}" style="--c:${color}"><span>${text}</span></div>${p.title ? `<div class="mk-label">${escapeHtml(p.title)}</div>` : ''}`;
        size = [38, 38];
      }
      const m = L.marker([p.position.lat, p.position.lng], {
        icon: L.divIcon({ className: 'mk-wrap', html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] }),
        draggable: editMode && tool === 'none',
        zIndexOffset: sel ? 1000 : p.kind === 'marker' ? 300 : 400,
        keyboard: false,
        autoPan: true,
      }).addTo(g);
      m.on('click', (e) => { L.DomEvent.stopPropagation(e); propsRef.current.onSelectPoint(p.id); });
      m.on('drag', () => {
        const ll = m.getLatLng();
        for (const { line, hit, end } of legsOf.get(p.id) ?? []) {
          const cur = line.getLatLngs() as L.LatLng[];
          const next = end === 0 ? [ll, cur[1]] : [cur[0], ll];
          line.setLatLngs(next);
          hit.setLatLngs(next);
        }
      });
      m.on('dragend', () => {
        const ll = m.getLatLng();
        propsRef.current.onMovePoint(p.id, { lat: ll.lat, lng: ll.lng });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.insp.route, props.insp.photos, props.selectedId, props.selectedPhotoId, props.editMode, props.tool, props.showPhotos, props.showTracks, props.liveTrackId]);

  const cls = ['route-map', props.tool !== 'none' ? 'tool-active' : '', props.editMode ? 'editing' : ''].join(' ');
  return <div ref={el} className={cls} />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
