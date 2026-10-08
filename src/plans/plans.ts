// Pläne (z. B. Lageplan mit eingezeichneter Trasse) als Kartengrundlage.
//
// Ein Plan ersetzt die Landkarte: Punkte, Linien, Fotos und Notizen werden
// direkt auf dem Plan gesetzt (Koordinaten in Planpixeln). Ein Plan hat keinen
// GPS-Bezug – GPS, Adresssuche und „30 m nach Norden“ werden darauf nicht
// automatisch eingezeichnet. Längen gibt es erst mit Maßstab.

import { useEffect, useState } from 'react';
import type { Inspection, PlanSheet } from '../model/types';
import { uid } from '../model/factory';
import { getPlanBlob, savePlanBlob } from '../storage/db';
import { canvasToBlob, loadImage, scaleToCanvas } from '../camera/photo';
import { pdfPageCount, renderPdfPageImage } from '../pdf/preview';

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export async function planPageCount(file: File): Promise<number> {
  if (!isPdf(file)) return 1;
  try {
    return await pdfPageCount(await file.arrayBuffer());
  } catch {
    throw new Error('Die PDF konnte nicht gelesen werden (beschädigt oder passwortgeschützt?).');
  }
}

/** Plan aus Datei erzeugen und speichern (Bild bleibt auf dem Gerät). */
export async function createPlan(inspectionId: string, file: File, pageIndex: number, name: string): Promise<PlanSheet> {
  let blob: Blob;
  let width: number;
  let height: number;
  let ptPerPx: number | null = null;
  if (isPdf(file)) {
    const r = await renderPdfPageImage(await file.arrayBuffer(), pageIndex);
    ({ blob, width, height, ptPerPx } = r);
  } else {
    const img = await loadImage(file);
    const c = scaleToCanvas(img, 4096);
    blob = await canvasToBlob(c, 'image/jpeg', 0.92);
    width = c.width;
    height = c.height;
  }
  const plan: PlanSheet = {
    id: uid('pl'),
    name: name.trim() || file.name.replace(/\.[^.]+$/, '') || 'Plan',
    fileName: file.name + (isPdf(file) ? ` (Seite ${pageIndex + 1})` : ''),
    width,
    height,
    ptPerPx,
    metersPerPx: null,
    scaleNote: '',
    createdAt: Date.now(),
  };
  await savePlanBlob({ id: plan.id, inspectionId, image: blob });
  return plan;
}

/** Maßstab 1:x (nur bei PDF-Plänen, deren Papiergröße bekannt ist) */
export function metersPerPxFromRatio(plan: PlanSheet, denominator: number): number | null {
  if (!plan.ptPerPx || !(denominator > 0)) return null;
  const mmPerPx = plan.ptPerPx * (25.4 / 72);
  return (mmPerPx * denominator) / 1000;
}

/** aktueller Plan der Begehung oder null (= Landkarte) */
export function activePlan(insp: Inspection): PlanSheet | null {
  const b = insp.basemap;
  if (!b || b.kind !== 'plan') return null;
  return insp.plans?.find((p) => p.id === b.planId) ?? null;
}

const urls = new Map<string, string>();

export async function planUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const rec = await getPlanBlob(id);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.image);
  urls.set(id, u);
  return u;
}

export function usePlanUrl(id: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(id ? urls.get(id) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    void planUrl(id).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [id]);
  return url;
}

export async function planImage(id: string): Promise<HTMLImageElement | null> {
  const u = await planUrl(id);
  return u ? loadImage(u) : null;
}
