// Lokaler Speicher (IndexedDB). Alles bleibt auf dem Gerät.
// Bilddaten liegen getrennt von den Begehungsdaten, damit Listen und
// Autosave schnell bleiben.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Inspection, InspectionSummaryRow, PendingJob, PdfTemplate, PhotoBlob, PlanBlob, Project, Report, Settings,
} from '../model/types';
import { defaultSettings, standardTemplate, STANDARD_TEMPLATE_ID } from '../model/factory';
import { routeLength } from '../geo/geo';

interface BegehungDB extends DBSchema {
  inspections: { key: string; value: Inspection; indexes: { byUpdated: number } };
  projects: { key: string; value: Project };
  photos: { key: string; value: PhotoBlob; indexes: { byInspection: string } };
  templates: { key: string; value: PdfTemplate };
  settings: { key: string; value: Settings };
  jobs: { key: string; value: PendingJob; indexes: { byInspection: string } };
  reports: { key: string; value: Report; indexes: { byInspection: string } };
  plans: { key: string; value: PlanBlob; indexes: { byInspection: string } };
}

let dbPromise: Promise<IDBPDatabase<BegehungDB>> | null = null;

export function db(): Promise<IDBPDatabase<BegehungDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BegehungDB>('begehungsprotokoll', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 2) d.createObjectStore('plans', { keyPath: 'id' }).createIndex('byInspection', 'inspectionId');
        if (oldVersion >= 1) return;
        const insp = d.createObjectStore('inspections', { keyPath: 'id' });
        insp.createIndex('byUpdated', 'updatedAt');
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('photos', { keyPath: 'id' }).createIndex('byInspection', 'inspectionId');
        d.createObjectStore('templates', { keyPath: 'id' });
        d.createObjectStore('settings', { keyPath: 'id' });
        d.createObjectStore('jobs', { keyPath: 'id' }).createIndex('byInspection', 'inspectionId');
        d.createObjectStore('reports', { keyPath: 'id' }).createIndex('byInspection', 'inspectionId');
      },
    });
  }
  return dbPromise;
}

/** Bittet den Browser, die Daten nicht bei Speicherknappheit zu löschen. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* nicht unterstützt */ }
  return false;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------- settings

export async function loadSettings(): Promise<Settings> {
  const d = await db();
  const s = await d.get('settings', 'settings');
  if (s) {
    // neue Felder aus späteren Versionen ergänzen
    const def = defaultSettings();
    return { ...def, ...s, company: { ...def.company, ...s.company }, ai: { ...def.ai, ...s.ai }, gps: { ...def.gps, ...s.gps }, mail: { ...def.mail, ...s.mail } };
  }
  const fresh = defaultSettings();
  await d.put('settings', fresh);
  return fresh;
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('settings', s);
}

// ---------------------------------------------------------------- inspections

export async function saveInspection(i: Inspection): Promise<void> {
  await (await db()).put('inspections', i);
}

export async function getInspection(id: string): Promise<Inspection | undefined> {
  return (await db()).get('inspections', id);
}

export function summarize(i: Inspection): InspectionSummaryRow {
  return {
    id: i.id,
    projectName: i.meta.projectName,
    projectNumber: i.meta.projectNumber,
    inspectionNumber: i.meta.inspectionNumber,
    date: i.meta.date,
    time: i.meta.time,
    inspector: i.meta.inspector,
    client: i.meta.client,
    site: i.meta.site,
    status: i.status,
    pointCount: i.route.points.filter((p) => p.kind === 'route').length,
    photoCount: i.photos.length,
    noteCount: i.notes.length,
    lengthM: routeLength(i.route, i.plans),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export async function listInspections(): Promise<InspectionSummaryRow[]> {
  const all = await (await db()).getAll('inspections');
  return all.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteInspection(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['inspections', 'photos', 'jobs', 'reports', 'plans'], 'readwrite');
  await tx.objectStore('inspections').delete(id);
  for (const store of ['photos', 'jobs', 'reports', 'plans'] as const) {
    const s = tx.objectStore(store);
    const keys = await s.index('byInspection').getAllKeys(id);
    for (const k of keys) await s.delete(k);
  }
  await tx.done;
}

// ---------------------------------------------------------------- projects

export async function listProjects(): Promise<Project[]> {
  return (await (await db()).getAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(p: Project): Promise<void> {
  await (await db()).put('projects', p);
}

// ---------------------------------------------------------------- photos

export async function savePhotoBlob(p: PhotoBlob): Promise<void> {
  await (await db()).put('photos', p);
}

export async function getPhotoBlob(id: string): Promise<PhotoBlob | undefined> {
  return (await db()).get('photos', id);
}

export async function deletePhotoBlob(id: string): Promise<void> {
  await (await db()).delete('photos', id);
}

// ---------------------------------------------------------------- templates

export async function listTemplates(): Promise<PdfTemplate[]> {
  const d = await db();
  let all = await d.getAll('templates');
  if (!all.some((t) => t.id === STANDARD_TEMPLATE_ID)) {
    const std = standardTemplate();
    await d.put('templates', std);
    all = [std, ...all];
  }
  return all.sort((a, b) => (a.builtin === b.builtin ? a.createdAt - b.createdAt : a.builtin ? -1 : 1));
}

export async function getTemplate(id: string | null): Promise<PdfTemplate> {
  const d = await db();
  if (id) {
    const t = await d.get('templates', id);
    if (t) return t;
  }
  return (await d.get('templates', STANDARD_TEMPLATE_ID)) ?? standardTemplate();
}

export async function saveTemplate(t: PdfTemplate): Promise<void> {
  await (await db()).put('templates', t);
}

export async function deleteTemplate(id: string): Promise<void> {
  if (id === STANDARD_TEMPLATE_ID) return;
  await (await db()).delete('templates', id);
}

// ---------------------------------------------------------------- jobs

export async function listJobs(inspectionId?: string): Promise<PendingJob[]> {
  const d = await db();
  const all = inspectionId ? await d.getAllFromIndex('jobs', 'byInspection', inspectionId) : await d.getAll('jobs');
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveJob(j: PendingJob): Promise<void> {
  await (await db()).put('jobs', j);
}

export async function deleteJob(id: string): Promise<void> {
  await (await db()).delete('jobs', id);
}

// ---------------------------------------------------------------- reports

export async function saveReport(r: Report): Promise<void> {
  await (await db()).put('reports', r);
}

export async function listReports(inspectionId: string): Promise<Report[]> {
  const all = await (await db()).getAllFromIndex('reports', 'byInspection', inspectionId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteReport(id: string): Promise<void> {
  await (await db()).delete('reports', id);
}

// ---------------------------------------------------------------- plans

export async function savePlanBlob(p: PlanBlob): Promise<void> {
  await (await db()).put('plans', p);
}

export async function getPlanBlob(id: string): Promise<PlanBlob | undefined> {
  return (await db()).get('plans', id);
}

export async function deletePlanBlob(id: string): Promise<void> {
  await (await db()).delete('plans', id);
}
