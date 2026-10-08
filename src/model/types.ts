// Datenmodell der Anwendung.
//
// Project
//  └── Inspection (Begehung)
//       ├── meta            Metadaten (Projekt, Datum, Begeher …)
//       ├── route
//       │    ├── points     RoutePoint  (Trassenpunkte + freie Markierungen)
//       │    ├── segments   RouteSegment (geordnete Punktfolgen, eigene Farbe)
//       │    └── tracks     GpsTrack    (GPS-Aufzeichnungen, Rohdaten)
//       ├── notes           Note        (Notizen + strukturierte Beobachtungen)
//       ├── photos          PhotoMeta   (Metadaten; Bilddaten liegen separat im Foto-Speicher)
//       ├── tasks           Task
//       ├── summary         Zusammenfassung (manuell oder KI, immer bestätigungspflichtig)
//       ├── signature       Unterschrift / Freigabe
//       └── pdfSettings     PdfSettings
//
// Jedes Objekt hat eine eindeutige ID. Referenzen laufen immer in eine Richtung
// (Foto → Punkt, Notiz → Punkt), damit nichts doppelt gepflegt werden muss.

export type ID = string;

/** Woher eine Information stammt. Alles außer 'manual' und 'gps' gilt als „automatisch ermittelt“. */
export type Source = 'gps' | 'voice' | 'manual' | 'auto';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GeoFix extends LatLng {
  /** Genauigkeit in Metern (Radius, 68 %) laut Gerät */
  accuracy: number | null;
  timestamp: number;
}

export type Role = 'admin' | 'employee' | 'viewer';

export interface User {
  id: ID;
  name: string;
  role: Role;
}

export interface Project {
  id: ID;
  name: string;
  number: string;
  client: string;
  createdAt: number;
  updatedAt: number;
}

export type InspectionStatus = 'draft' | 'in_progress' | 'completed';

export interface InspectionMeta {
  projectName: string;
  projectNumber: string;
  inspectionNumber: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  inspector: string;
  client: string;
  contactPerson: string;
  site: string;
  description: string;
  startPoint: string;
  remarks: string;
}

export type PointKind = 'route' | 'marker';

export interface RoutePoint {
  id: ID;
  kind: PointKind;
  /** null = noch nicht auf der Karte platziert (z. B. aus Sprache ohne Entfernungsangabe) */
  position: LatLng | null;
  /** GPS-Genauigkeit in m, falls die Position vom GPS stammt */
  accuracy: number | null;
  /** fortlaufende Nummer innerhalb der Begehung */
  number: number;
  /** freie Beschriftung, überschreibt die Nummer in Karte und PDF */
  label: string;
  title: string;
  description: string;
  category: string;
  /** Symbol für Markierungen (Schlüssel aus SYMBOLS) */
  symbol: string;
  station: string;
  source: Source;
  /** false = automatisch ermittelt und vom Benutzer noch nicht bestätigt */
  confirmed: boolean;
  /** reiner Stützpunkt des Linienverlaufs (z. B. aus Routing) – ohne eigene Nummer in Karte/PDF */
  vertex?: boolean;
  /** Nachvollziehbarkeit für geschätzte Punkte */
  estimate?: {
    text: string;
    fromPointId: ID | null;
    bearingDeg: number | null;
    distanceM: number | null;
  };
  createdAt: number;
  updatedAt: number;
}

export interface RouteSegment {
  id: ID;
  name: string;
  color: string;
  /** geordnete Punktfolge; ein Punkt darf in mehreren Abschnitten vorkommen (Abzweig) */
  pointIds: ID[];
  source: Source;
  createdAt: number;
  /** Linienart (Farbe/Bedeutung), z. B. „tiefbau“ */
  lineType?: string;
}

export interface TrackFix {
  lat: number;
  lng: number;
  acc: number | null;
  t: number;
}

export interface GpsTrack {
  id: ID;
  startedAt: number;
  endedAt: number | null;
  /** reine Aufzeichnungszeit ohne Pausen */
  durationMs: number;
  fixes: TrackFix[];
  /** verworfene Messungen wegen zu schlechter Genauigkeit */
  rejected: number;
  convertedSegmentId: ID | null;
}

export interface Route {
  points: RoutePoint[];
  segments: RouteSegment[];
  tracks: GpsTrack[];
}

export type NoteStatus = 'open' | 'done' | 'info';
export type NoteOrigin = 'text' | 'voice';

export interface Note {
  id: ID;
  /** 'observation' = strukturierte Beobachtung (Station/Kategorie/Hinweis) */
  kind: 'note' | 'observation';
  title: string;
  description: string;
  category: string;
  station: string;
  hint: string;
  pointId: ID | null;
  position: GeoFix | null;
  status: NoteStatus;
  origin: NoteOrigin;
  /** wörtliche Spracheingabe – bleibt immer erhalten */
  transcript: string;
  /** true, wenn KI die Felder strukturiert hat */
  aiStructured: boolean;
  confirmed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PhotoMeta {
  id: ID;
  number: number;
  takenAt: number;
  position: GeoFix | null;
  pointId: ID | null;
  /** optional einer Notiz zugeordnet */
  noteId: ID | null;
  /** true, wenn der Punkt automatisch (nächster Punkt) zugeordnet wurde */
  pointAutoAssigned: boolean;
  category: string;
  description: string;
  aiSuggestion: string;
  width: number;
  height: number;
  /** 'address' = Position aus erkannter Adresse (OpenStreetMap), nicht vom GPS */
  positionSource?: 'gps' | 'address';
  /** Ort, der beim Markieren genannt wurde (z. B. „Hauptstraße 12“) */
  placeLabel?: string;
  /** eingezeichnete Linien (Vektordaten – das Originalfoto bleibt unverändert) */
  annotations?: PhotoAnnotation[];
}

/** Linienart für Foto-Markierungen, z. B. „Tiefbau“ = rot. Über Schlüsselwörter per Text/Sprache wählbar. */
export interface LineType {
  key: string;
  label: string;
  color: string;
  /** Wörter, die diese Linienart auswählen (Kleinschreibung, Wortanfang genügt) */
  keywords: string[];
}

export interface PhotoAnnotation {
  id: ID;
  /** Schlüssel der Linienart */
  type: string;
  /** angezeigte Beschriftung (das erkannte Wort, z. B. „Leerrohr“) */
  label: string;
  /** Polylinie, normiert auf Bildbreite/-höhe (0..1) */
  points: [number, number][];
  source: 'manual' | 'ai';
  createdAt: number;
}

export interface Task {
  id: ID;
  text: string;
  assignee: string;
  due: string;
  done: boolean;
  createdAt: number;
}

export type MapType = 'streets' | 'satellite' | 'hybrid';

export interface PdfSettings {
  templateId: ID | null;
  mapType: MapType;
  /** gewählter Kartenausschnitt; null = automatisch auf die Trasse einpassen */
  mapView: MapBounds | null;
  showGpsPoints: boolean;
  showPhotoMarkers: boolean;
  showNumbers: boolean;
  colored: boolean;
  showMarkers: boolean;
  include: {
    cover: boolean;
    map: boolean;
    points: boolean;
    notes: boolean;
    photos: boolean;
    closing: boolean;
    /** Koordinatenliste aller Wegpunkte */
    coordTable: boolean;
  };
}

export interface Summary {
  text: string;
  source: 'manual' | 'ai';
  confirmed: boolean;
  updatedAt: number;
}

export interface Signature {
  name: string;
  role: string;
  place: string;
  dataUrl: string;
  signedAt: number;
}

export interface Inspection {
  id: ID;
  schemaVersion: 1;
  projectId: ID;
  meta: InspectionMeta;
  status: InspectionStatus;
  route: Route;
  notes: Note[];
  photos: PhotoMeta[];
  tasks: Task[];
  summary: Summary | null;
  signature: Signature | null;
  pdfSettings: PdfSettings;
  /** Segment, an das neue Punkte angehängt werden */
  activeSegmentId: ID | null;
  counters: { point: number; photo: number };
  createdBy: ID;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

/** Kurzform für Listen, ohne die ganze Begehung zu laden */
export interface InspectionSummaryRow {
  id: ID;
  projectName: string;
  projectNumber: string;
  inspectionNumber: string;
  date: string;
  time: string;
  inspector: string;
  client: string;
  site: string;
  status: InspectionStatus;
  pointCount: number;
  photoCount: number;
  noteCount: number;
  lengthM: number;
  createdAt: number;
  updatedAt: number;
}

export interface PhotoBlob {
  id: ID;
  inspectionId: ID;
  full: Blob;
  thumb: Blob;
}

export type TemplateKind = 'standard' | 'pdf' | 'image';

export interface PdfTemplate {
  id: ID;
  name: string;
  kind: TemplateKind;
  /** Hintergrunddatei (PDF oder Bild) */
  file: Blob | null;
  fileName: string;
  pageCount: number;
  /** freier Inhaltsbereich in mm vom Seitenrand – dort landen die dynamischen Inhalte */
  margins: { top: number; right: number; bottom: number; left: number };
  /** welche Seite der Vorlage für das Deckblatt / die Folgeseiten verwendet wird (0-basiert) */
  coverPage: number;
  followPage: number;
  /** eigene Kopf-/Fußzeile der App zeichnen (bei Vorlagen mit fertiger Kopfzeile ausschalten) */
  drawHeader: boolean;
  drawPageNumbers: boolean;
  accentColor: string;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  contact: string;
  logoDataUrl: string;
}

export interface AiSettings {
  provider: 'none' | 'gemini';
  apiKey: string;
  model: string;
  /** Fotos dürfen zur Beschreibung an den KI-Dienst gesendet werden */
  allowPhotos: boolean;
  /** Sprachaufnahmen dürfen zur Transkription an den KI-Dienst gesendet werden */
  allowAudio: boolean;
}

export interface MailDefaults {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

export interface Settings {
  id: 'settings';
  company: CompanyInfo;
  defaultTemplateId: ID | null;
  categories: string[];
  ai: AiSettings;
  gps: { maxAccuracyM: number; locationConsent: boolean };
  micConsent: boolean;
  theme: 'auto' | 'light' | 'dark';
  user: User;
  mail: MailDefaults;
  defaultMapType: MapType;
  lineTypes: LineType[];
  /** Adresssuche über OpenStreetMap (Straßen, Hausnummern, Kreuzungen) */
  placeSearch: boolean;
}

export type JobType = 'voice-note' | 'voice-route';

/** Aufgaben, die eine Internetverbindung brauchen und später nachgeholt werden */
export interface PendingJob {
  id: ID;
  inspectionId: ID;
  type: JobType;
  audio: Blob;
  durationS: number;
  createdAt: number;
  attempts: number;
  lastError: string;
}

export interface Report {
  id: ID;
  inspectionId: ID;
  fileName: string;
  pdf: Blob;
  pageCount: number;
  createdAt: number;
}
