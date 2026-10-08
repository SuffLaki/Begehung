// Kartenanbieter. Nur hier stehen URLs/Attributionen – ein Wechsel des Anbieters
// (z. B. auf einen kostenpflichtigen Dienst mit API-Key oder auf
// Landesvermessungs-Daten) bedeutet: diese Datei anpassen, sonst nichts.
//
// Standard:
//  * Straßenkarte: OpenStreetMap (frei, Nutzungsrichtlinie: moderate Nutzung, Attribution Pflicht)
//  * Luftbild + Beschriftung: Esri World Imagery / Reference Layers
//    (Attribution Pflicht; für dauerhafte gewerbliche Nutzung ArcGIS-Nutzungsbedingungen
//     prüfen bzw. einen Schlüssel hinterlegen → API_KEYS unten)

import type { MapType } from '../model/types';

/** Platzhalter für spätere Dienste mit Schlüssel */
export const API_KEYS = {
  esri: '', // optional: ArcGIS Location Platform API-Key
};

export interface TileSource {
  url: string; // {z} {x} {y}
  maxNativeZoom: number;
  attribution: string;
  opacity?: number;
}

function esri(path: string): string {
  const key = API_KEYS.esri ? `?token=${encodeURIComponent(API_KEYS.esri)}` : '';
  return `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}${key}`;
}

const OSM: TileSource = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxNativeZoom: 19,
  attribution: '© OpenStreetMap-Mitwirkende',
};

const IMAGERY: TileSource = {
  url: esri('World_Imagery'),
  maxNativeZoom: 19,
  attribution: 'Luftbild © Esri, Maxar, Earthstar Geographics u. a.',
};

const TRANSPORT: TileSource = { url: esri('Reference/World_Transportation'), maxNativeZoom: 19, attribution: 'Esri' };
const LABELS: TileSource = { url: esri('Reference/World_Boundaries_and_Places'), maxNativeZoom: 19, attribution: 'Esri' };

export const MAP_TYPES: Record<MapType, { label: string; layers: TileSource[] }> = {
  streets: { label: 'Karte', layers: [OSM] },
  satellite: { label: 'Satellit', layers: [IMAGERY] },
  hybrid: { label: 'Hybrid', layers: [IMAGERY, TRANSPORT, LABELS] },
};

export const MAX_ZOOM = 21;

export function attributionOf(type: MapType): string {
  return [...new Set(MAP_TYPES[type].layers.map((l) => l.attribution))].join(' · ');
}

export function tileUrl(src: TileSource, z: number, x: number, y: number): string {
  return src.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
