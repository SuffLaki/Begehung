import type {
  Inspection, InspectionMeta, Note, PdfSettings, PdfTemplate, PhotoMeta, RoutePoint, RouteSegment, Settings, Task, User,
} from './types';

export function uid(prefix = ''): string {
  const rnd = crypto.getRandomValues(new Uint8Array(10));
  const s = Array.from(rnd, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  return prefix + Date.now().toString(36) + s;
}

export const DEFAULT_CATEGORIES = [
  'Trassenverlauf', 'Weg', 'Wirtschaftsweg', 'Straße', 'Gewässer', 'Graben', 'Gebäude', 'Grundstück',
  'Baum/Bewuchs', 'Leitung', 'Mast', 'Schacht', 'Hindernis', 'Kreuzung', 'Besonderheit', 'Sonstiges',
];

/** Farben für Trassenabschnitte – gut sichtbar auf Straßenkarte und Luftbild */
export const SEGMENT_COLORS = ['#FF9F0A', '#0A84FF', '#FF375F', '#30D158', '#BF5AF2', '#FFD60A', '#64D2FF', '#FFFFFF'];

/** Symbole für freie Markierungen */
export const SYMBOLS: Record<string, { label: string; glyph: string }> = {
  pin: { label: 'Markierung', glyph: '●' },
  warn: { label: 'Hindernis', glyph: '!' },
  cross: { label: 'Kreuzung', glyph: '✕' },
  water: { label: 'Gewässer', glyph: '≈' },
  tree: { label: 'Baum', glyph: '♣' },
  pole: { label: 'Mast', glyph: 'T' },
  shaft: { label: 'Schacht', glyph: 'S' },
  line: { label: 'Leitung', glyph: '⚡' },
  house: { label: 'Gebäude', glyph: '▲' },
  info: { label: 'Info', glyph: 'i' },
};

export function today(): { date: string; time: string } {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

export function emptyMeta(): InspectionMeta {
  const { date, time } = today();
  return {
    projectName: '', projectNumber: '', inspectionNumber: '', date, time, inspector: '', client: '',
    contactPerson: '', site: '', description: '', startPoint: '', remarks: '',
  };
}

export function defaultPdfSettings(templateId: string | null, mapType: PdfSettings['mapType'] = 'streets'): PdfSettings {
  return {
    templateId,
    mapType,
    mapView: null,
    showGpsPoints: true,
    showPhotoMarkers: true,
    showNumbers: true,
    colored: true,
    showMarkers: true,
    include: { cover: true, map: true, points: true, notes: true, photos: true, closing: true, coordTable: true },
  };
}

export function newSegment(index: number, pointIds: string[] = [], source: RouteSegment['source'] = 'manual'): RouteSegment {
  return {
    id: uid('s'),
    name: `Abschnitt ${index + 1}`,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    pointIds,
    source,
    createdAt: Date.now(),
  };
}

export function newInspection(meta: InspectionMeta, projectId: string, user: User, templateId: string | null, mapType: PdfSettings['mapType']): Inspection {
  const now = Date.now();
  const seg = newSegment(0);
  return {
    id: uid('i'),
    schemaVersion: 1,
    projectId,
    meta,
    status: 'in_progress',
    route: { points: [], segments: [seg], tracks: [] },
    notes: [],
    photos: [],
    tasks: [],
    summary: null,
    signature: null,
    pdfSettings: defaultPdfSettings(templateId, mapType),
    activeSegmentId: seg.id,
    counters: { point: 0, photo: 0 },
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

export function newPoint(partial: Partial<RoutePoint> & Pick<RoutePoint, 'number'>): RoutePoint {
  const now = Date.now();
  return {
    id: uid('p'),
    kind: 'route',
    position: null,
    accuracy: null,
    label: '',
    title: '',
    description: '',
    category: '',
    symbol: 'pin',
    station: '',
    source: 'manual',
    confirmed: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newNote(partial: Partial<Note> = {}): Note {
  const now = Date.now();
  return {
    id: uid('n'),
    kind: 'note',
    title: '',
    description: '',
    category: '',
    station: '',
    hint: '',
    pointId: null,
    position: null,
    status: 'open',
    origin: 'text',
    transcript: '',
    aiStructured: false,
    confirmed: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newPhotoMeta(partial: Partial<PhotoMeta> & Pick<PhotoMeta, 'number'>): PhotoMeta {
  return {
    id: uid('f'),
    takenAt: Date.now(),
    position: null,
    pointId: null,
    noteId: null,
    pointAutoAssigned: false,
    category: '',
    description: '',
    aiSuggestion: '',
    width: 0,
    height: 0,
    ...partial,
  };
}

export function newTask(text = ''): Task {
  return { id: uid('t'), text, assignee: '', due: '', done: false, createdAt: Date.now() };
}

export const STANDARD_TEMPLATE_ID = 'tpl-standard';

export function standardTemplate(): PdfTemplate {
  const now = Date.now();
  return {
    id: STANDARD_TEMPLATE_ID,
    name: 'Standard',
    kind: 'standard',
    file: null,
    fileName: '',
    pageCount: 1,
    margins: { top: 26, right: 16, bottom: 20, left: 18 },
    coverPage: 0,
    followPage: 0,
    drawHeader: true,
    drawPageNumbers: true,
    accentColor: '#1F4E79',
    builtin: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    company: { name: '', address: '', phone: '', email: '', website: '', contact: '', logoDataUrl: '' },
    defaultTemplateId: STANDARD_TEMPLATE_ID,
    categories: [...DEFAULT_CATEGORIES],
    ai: { provider: 'none', apiKey: '', model: 'gemini-3.5-flash-lite', allowPhotos: false, allowAudio: false },
    gps: { maxAccuracyM: 30, locationConsent: false },
    micConsent: false,
    theme: 'auto',
    user: { id: uid('u'), name: '', role: 'admin' },
    mail: {
      to: '',
      cc: '',
      subject: 'Begehungsprotokoll {projekt} – {datum}',
      body: 'Guten Tag,\n\nanbei das Begehungsprotokoll {projekt} vom {datum}.\n\nMit freundlichen Grüßen\n{begeher}',
    },
    defaultMapType: 'streets',
  };
}

/** Anzeigename eines Punktes: Beschriftung, sonst Start/Ende/Nummer */
export function pointDisplayName(p: RoutePoint): string {
  if (p.label) return p.label;
  if (p.kind === 'marker') return `M${p.number}`;
  return `P${p.number}`;
}
