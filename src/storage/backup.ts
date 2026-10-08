// Export/Import einer Begehung als Datei (inkl. Fotos).
// Dient als Datensicherung und zur Übergabe an ein anderes Gerät, solange es
// keinen Server-Abgleich gibt.

import type { Inspection } from '../model/types';
import { getInspection, getPhotoBlob, getPlanBlob, saveInspection, savePhotoBlob, savePlanBlob } from './db';
import { blobToBase64 } from '../speech/audioRecorder';
import { uid } from '../model/factory';

interface BackupFile {
  format: 'begehungsprotokoll-backup';
  version: 1;
  exportedAt: number;
  inspection: Inspection;
  photos: { id: string; full: string; thumb: string }[];
  plans?: { id: string; image: string }[];
}

export async function exportInspection(id: string): Promise<{ blob: Blob; fileName: string }> {
  const insp = await getInspection(id);
  if (!insp) throw new Error('Begehung nicht gefunden.');
  const photos: BackupFile['photos'] = [];
  for (const f of insp.photos) {
    const rec = await getPhotoBlob(f.id);
    if (rec) photos.push({ id: f.id, full: await blobToBase64(rec.full), thumb: await blobToBase64(rec.thumb) });
  }
  const plans: NonNullable<BackupFile['plans']> = [];
  for (const pl of insp.plans ?? []) {
    const rec = await getPlanBlob(pl.id);
    if (rec) plans.push({ id: pl.id, image: await blobToBase64(rec.image) });
  }
  const data: BackupFile = { format: 'begehungsprotokoll-backup', version: 1, exportedAt: Date.now(), inspection: insp, photos, plans };
  const name = `Begehung_${insp.meta.projectNumber || insp.meta.projectName || 'Projekt'}_${insp.meta.date}`.replace(/[^\wäöüÄÖÜß.-]+/g, '_');
  return { blob: new Blob([JSON.stringify(data)], { type: 'application/json' }), fileName: `${name}.json` };
}

function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Importiert eine Sicherung. Existiert die Begehung schon, wird eine Kopie mit neuer ID angelegt. */
export async function importInspection(file: Blob): Promise<Inspection> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Die Datei ist keine gültige Sicherung.');
  }
  if (data?.format !== 'begehungsprotokoll-backup' || !data.inspection?.id) throw new Error('Die Datei ist keine Begehungs-Sicherung.');
  const insp = data.inspection;
  const newIds = new Map<string, string>();
  if (await getInspection(insp.id)) {
    // Kopie: neue IDs, damit sich Original und Kopie keine Fotos teilen
    insp.id = uid('i');
    insp.meta.projectName = `${insp.meta.projectName} (Kopie)`;
    for (const f of insp.photos) {
      const nid = uid('f');
      newIds.set(f.id, nid);
      f.id = nid;
    }
    for (const pl of insp.plans ?? []) {
      const nid = uid('pl');
      newIds.set(pl.id, nid);
      pl.id = nid;
    }
    for (const p of insp.route.points) if (p.planId) p.planId = newIds.get(p.planId) ?? p.planId;
    if (insp.basemap?.kind === 'plan') insp.basemap = { kind: 'plan', planId: newIds.get(insp.basemap.planId) ?? insp.basemap.planId };
  }
  for (const pl of data.plans ?? []) {
    await savePlanBlob({ id: newIds.get(pl.id) ?? pl.id, inspectionId: insp.id, image: b64ToBlob(pl.image, 'image/jpeg') });
  }
  for (const p of data.photos ?? []) {
    await savePhotoBlob({ id: newIds.get(p.id) ?? p.id, inspectionId: insp.id, full: b64ToBlob(p.full, 'image/jpeg'), thumb: b64ToBlob(p.thumb, 'image/jpeg') });
  }
  insp.updatedAt = Date.now();
  await saveInspection(insp);
  return insp;
}
