// Sync-Paket: Datei-Austausch mit der (späteren) Trasso-Desktop-App.
// Format und Regeln sind in docs/SYNC.md beschrieben – die Desktop-App liest und schreibt genau dieses Format.
//
// Export: alle Begehungen, die sich seit dem letzten Abgleich geändert haben (oder alle), mit Fotos,
//         Plänen, Projekten und gelöschten Begehungen.
// Import: Begehungen vom Desktop übernehmen. Wurde dieselbe Begehung auf beiden Seiten geändert,
//         bleibt die Version auf dem Gerät erhalten und die Desktop-Version kommt als Kopie dazu.

import type { Inspection, Project } from '../model/types';
import {
  deleteInspection, deletePhotoBlob, deletePlanBlob, getInspection, getPhotoBlob, getPlanBlob,
  listAllInspections, listProjects, saveInspection, savePhotoBlob, savePlanBlob, saveProject,
} from '../storage/db';
import { b64ToBlob, copyWithNewIds } from '../storage/backup';
import { blobToBase64 } from '../speech/audioRecorder';
import { getSyncState, isDirty, saveSyncState, type SyncState } from './syncState';

export const SYNC_FORMAT = 'trasso-sync';
export const SYNC_VERSION = 1;
export const APP_VERSION = '1.5';

export interface SyncPhoto { id: string; full: string; thumb: string }
export interface SyncPlan { id: string; image: string; type?: string }

export interface SyncPackage {
  format: typeof SYNC_FORMAT;
  version: number;
  createdAt: number;
  source: { deviceId: string; deviceName: string; app: 'Trasso' | 'Trasso Desktop'; appVersion: string };
  /** true = nur Änderungen seit dem letzten Abgleich dieses Geräts */
  changesOnly: boolean;
  inspections: { inspection: Inspection; photos: SyncPhoto[]; plans: SyncPlan[] }[];
  projects: Project[];
  deleted: { id: string; deletedAt: number }[];
}

export interface ExportResult { blob: Blob; fileName: string; count: number; photos: number; deleted: number }

/** Wie viele Begehungen seit dem letzten Abgleich geändert wurden */
export async function pendingChanges(): Promise<{ changed: number; deleted: number; total: number; state: SyncState }> {
  const [state, all] = await Promise.all([getSyncState(), listAllInspections()]);
  const deleted = state.tombstones.filter((t) => state.lastExportAt === null || t.deletedAt > state.lastExportAt).length;
  return { changed: all.filter((i) => isDirty(state, i)).length, deleted, total: all.length, state };
}

export async function exportSyncPackage(opts: { changesOnly: boolean }): Promise<ExportResult> {
  const state = await getSyncState();
  const all = await listAllInspections();
  const chosen = opts.changesOnly ? all.filter((i) => isDirty(state, i)) : all;
  const deleted = opts.changesOnly && state.lastExportAt !== null ? state.tombstones.filter((t) => t.deletedAt > state.lastExportAt!) : state.tombstones;
  if (!chosen.length && !deleted.length) throw new Error('Keine Änderungen seit dem letzten Abgleich.');

  const items: SyncPackage['inspections'] = [];
  let photoCount = 0;
  for (const insp of chosen) {
    const photos: SyncPhoto[] = [];
    for (const f of insp.photos) {
      const rec = await getPhotoBlob(f.id);
      if (rec) photos.push({ id: f.id, full: await blobToBase64(rec.full), thumb: await blobToBase64(rec.thumb) });
    }
    const plans: SyncPlan[] = [];
    for (const pl of insp.plans ?? []) {
      const rec = await getPlanBlob(pl.id);
      if (rec) plans.push({ id: pl.id, image: await blobToBase64(rec.image), type: rec.image.type || 'image/jpeg' });
    }
    photoCount += photos.length;
    items.push({ inspection: insp, photos, plans });
  }
  const now = Date.now();
  const pkg: SyncPackage = {
    format: SYNC_FORMAT, version: SYNC_VERSION, createdAt: now,
    source: { deviceId: state.deviceId, deviceName: state.deviceName, app: 'Trasso', appVersion: APP_VERSION },
    changesOnly: opts.changesOnly,
    inspections: items,
    projects: await listProjects(),
    deleted,
  };

  // Stand merken: diese Fassungen gelten jetzt als abgeglichen
  for (const i of chosen) state.synced[i.id] = i.updatedAt;
  state.lastExportAt = now;
  const stamp = new Date(now);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const fileName = `Trasso-Sync_${state.deviceName.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${stamp.getFullYear()}${p2(stamp.getMonth() + 1)}${p2(stamp.getDate())}_${p2(stamp.getHours())}${p2(stamp.getMinutes())}.json`;
  state.log.push({ at: now, kind: 'export', peer: fileName, summary: `${items.length} Begehung(en), ${photoCount} Foto(s), ${deleted.length} gelöscht` });
  await saveSyncState(state);
  return { blob: new Blob([JSON.stringify(pkg)], { type: 'application/json' }), fileName, count: items.length, photos: photoCount, deleted: deleted.length };
}

export interface ImportResult {
  added: number;
  updated: number;
  unchanged: number;
  /** auf beiden Seiten geändert → Desktop-Fassung als Kopie */
  conflicts: string[];
  deleted: number;
  /** Löschung vom Desktop, aber auf dem Gerät inzwischen geändert → behalten */
  keptDespiteDelete: string[];
}

function parse(text: string): SyncPackage {
  let pkg: SyncPackage;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges Sync-Paket.');
  }
  if (pkg?.format !== SYNC_FORMAT) throw new Error('Die Datei ist kein Trasso-Sync-Paket.');
  if (typeof pkg.version !== 'number' || pkg.version > SYNC_VERSION) throw new Error(`Das Sync-Paket hat Version ${pkg.version} – bitte Trasso aktualisieren.`);
  if (!Array.isArray(pkg.inspections)) throw new Error('Das Sync-Paket ist unvollständig.');
  return pkg;
}

async function replaceBlobs(insp: Inspection, photos: SyncPhoto[], plans: SyncPlan[], old?: Inspection) {
  for (const p of photos) await savePhotoBlob({ id: p.id, inspectionId: insp.id, full: b64ToBlob(p.full, 'image/jpeg'), thumb: b64ToBlob(p.thumb, 'image/jpeg') });
  for (const pl of plans) await savePlanBlob({ id: pl.id, inspectionId: insp.id, image: b64ToBlob(pl.image, pl.type || 'image/jpeg') });
  if (old) {
    const keepPhotos = new Set(insp.photos.map((f) => f.id));
    for (const f of old.photos) if (!keepPhotos.has(f.id)) await deletePhotoBlob(f.id);
    const keepPlans = new Set((insp.plans ?? []).map((p) => p.id));
    for (const p of old.plans ?? []) if (!keepPlans.has(p.id)) await deletePlanBlob(p.id);
  }
}

export async function importSyncPackage(file: Blob, fileName = 'Sync-Paket'): Promise<ImportResult> {
  const pkg = parse(await file.text());
  const state = await getSyncState();
  if (pkg.source?.deviceId === state.deviceId) throw new Error('Dieses Paket stammt von diesem Gerät selbst – bitte das Paket vom Desktop einlesen.');
  const res: ImportResult = { added: 0, updated: 0, unchanged: 0, conflicts: [], deleted: 0, keptDespiteDelete: [] };

  for (const p of pkg.projects ?? []) await saveProject(p);

  for (const item of pkg.inspections) {
    const remote = item.inspection;
    if (!remote?.id) continue;
    const local = await getInspection(remote.id);
    if (!local) {
      await replaceBlobs(remote, item.photos ?? [], item.plans ?? []);
      await saveInspection(remote);
      state.synced[remote.id] = remote.updatedAt;
      res.added++;
      continue;
    }
    const base = state.synced[remote.id] ?? 0;
    const localChanged = local.updatedAt > base;
    const remoteChanged = remote.updatedAt > base;
    if (remote.updatedAt === local.updatedAt || !remoteChanged) {
      res.unchanged++;
    } else if (!localChanged) {
      await replaceBlobs(remote, item.photos ?? [], item.plans ?? [], local);
      await saveInspection(remote);
      state.synced[remote.id] = remote.updatedAt;
      res.updated++;
    } else {
      // beidseitig geändert: nichts überschreiben, Desktop-Fassung als Kopie ablegen
      const ids = copyWithNewIds(remote, ' (Desktop-Fassung)');
      await replaceBlobs(remote, (item.photos ?? []).map((f) => ({ ...f, id: ids.get(f.id) ?? f.id })), (item.plans ?? []).map((p) => ({ ...p, id: ids.get(p.id) ?? p.id })));
      remote.updatedAt = Date.now();
      await saveInspection(remote);
      state.synced[remote.id] = remote.updatedAt;
      res.conflicts.push(local.meta.projectName || local.id);
    }
  }

  const toDelete: string[] = [];
  for (const t of pkg.deleted ?? []) {
    const local = await getInspection(t.id);
    if (!local) continue;
    if (local.updatedAt > (state.synced[t.id] ?? 0) && local.updatedAt > t.deletedAt) {
      res.keptDespiteDelete.push(local.meta.projectName || local.id);
      continue;
    }
    toDelete.push(t.id);
  }
  await saveSyncState(state);
  for (const id of toDelete) {
    await deleteInspection(id); // legt selbst einen Grabstein an und vergisst den Abgleich-Stand
    res.deleted++;
  }

  const after = await getSyncState();
  after.lastImportAt = Date.now();
  after.log.push({ at: after.lastImportAt, kind: 'import', peer: `${fileName} (${pkg.source?.deviceName ?? 'unbekannt'})`, summary: `${res.added} neu, ${res.updated} aktualisiert, ${res.conflicts.length} Konflikt(e), ${res.deleted} gelöscht` });
  await saveSyncState(after);
  return res;
}
