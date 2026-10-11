// Pläne (z. B. Lageplan mit eingezeichneter Trasse) als Kartengrundlage.
//
// Ein Plan ersetzt die Landkarte: Punkte, Linien, Fotos und Notizen werden
// direkt auf dem Plan gesetzt (Koordinaten in Planpixeln). Ein Plan hat keinen
// GPS-Bezug – GPS, Adresssuche und „30 m nach Norden“ werden darauf nicht
// automatisch eingezeichnet. Längen gibt es erst mit Maßstab.

import { useEffect, useState } from 'react';
import type { Inspection, LatLng, PlanGeoref, PlanSheet } from '../model/types';
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

// ================================================================ Einpassung auf die Landkarte
//
// Ein Plan wird über drei Ecken (oben links, oben rechts, unten links) auf die
// Karte gelegt. Für Pläne bis einige Kilometer ist eine lineare Abbildung in
// Grad ausreichend genau (Abweichung im Zentimeterbereich).

const M_PER_DEG_LAT = 110_574;
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Planpixel (u nach rechts, v nach unten) → Kartenposition */
export function planToGeo(g: PlanGeoref, plan: Pick<PlanSheet, 'width' | 'height'>, u: number, v: number): LatLng {
  const fu = u / plan.width, fv = v / plan.height;
  return {
    lat: g.tl.lat + fu * (g.tr.lat - g.tl.lat) + fv * (g.bl.lat - g.tl.lat),
    lng: g.tl.lng + fu * (g.tr.lng - g.tl.lng) + fv * (g.bl.lng - g.tl.lng),
  };
}

/** Kartenposition → Planpixel */
export function geoToPlan(g: PlanGeoref, plan: Pick<PlanSheet, 'width' | 'height'>, p: LatLng): { u: number; v: number } {
  const a = g.tr.lat - g.tl.lat, b = g.bl.lat - g.tl.lat;
  const c = g.tr.lng - g.tl.lng, d = g.bl.lng - g.tl.lng;
  const det = a * d - b * c;
  const y = p.lat - g.tl.lat, x = p.lng - g.tl.lng;
  const fu = (y * d - b * x) / det;
  const fv = (a * x - c * y) / det;
  return { u: fu * plan.width, v: fv * plan.height };
}

export function georefCenter(g: PlanGeoref): LatLng {
  // Mitte = Mittelpunkt der Diagonale tr–bl
  return { lat: (g.tr.lat + g.bl.lat) / 2, lng: (g.tr.lng + g.bl.lng) / 2 };
}

export function georefBR(g: PlanGeoref): LatLng {
  return { lat: g.tr.lat + g.bl.lat - g.tl.lat, lng: g.tr.lng + g.bl.lng - g.tl.lng };
}

/** Erste Einpassung: nach Norden ausgerichtet, mittig, Größe aus Maßstab oder Bildausschnitt */
export function initialGeoref(plan: PlanSheet, center: LatLng, viewWidthM: number): PlanGeoref {
  const widthM = plan.metersPerPx ? plan.width * plan.metersPerPx : viewWidthM * 0.8;
  const heightM = widthM * (plan.height / plan.width);
  const dLng = widthM / 2 / mPerDegLng(center.lat);
  const dLat = heightM / 2 / M_PER_DEG_LAT;
  return {
    tl: { lat: center.lat + dLat, lng: center.lng - dLng },
    tr: { lat: center.lat + dLat, lng: center.lng + dLng },
    bl: { lat: center.lat - dLat, lng: center.lng - dLng },
  };
}

/** Verschieben um Meter (Ost, Nord) */
export function moveGeoref(g: PlanGeoref, eastM: number, northM: number): PlanGeoref {
  const c = georefCenter(g);
  const dLat = northM / M_PER_DEG_LAT, dLng = eastM / mPerDegLng(c.lat);
  const mv = (p: LatLng) => ({ lat: p.lat + dLat, lng: p.lng + dLng });
  return { tl: mv(g.tl), tr: mv(g.tr), bl: mv(g.bl) };
}

/** Drehen (Grad, im Uhrzeigersinn) und Skalieren um die Planmitte */
export function rotateScaleGeoref(g: PlanGeoref, deg: number, factor: number): PlanGeoref {
  const c = georefCenter(g);
  const kx = mPerDegLng(c.lat), ky = M_PER_DEG_LAT;
  const r = (-deg * Math.PI) / 180; // Uhrzeigersinn auf der Karte
  const tf = (p: LatLng): LatLng => {
    const x = (p.lng - c.lng) * kx, y = (p.lat - c.lat) * ky;
    const x2 = factor * (x * Math.cos(r) - y * Math.sin(r));
    const y2 = factor * (x * Math.sin(r) + y * Math.cos(r));
    return { lat: c.lat + y2 / ky, lng: c.lng + x2 / kx };
  };
  return { tl: tf(g.tl), tr: tf(g.tr), bl: tf(g.bl) };
}

/** Drehung/Skalierung so, dass ein Griff von „from“ nach „to“ wandert (um die Planmitte) */
export function dragHandleGeoref(g: PlanGeoref, from: LatLng, to: LatLng): PlanGeoref {
  const c = georefCenter(g);
  const kx = mPerDegLng(c.lat), ky = M_PER_DEG_LAT;
  const v0 = [(from.lng - c.lng) * kx, (from.lat - c.lat) * ky];
  const v1 = [(to.lng - c.lng) * kx, (to.lat - c.lat) * ky];
  const l0 = Math.hypot(v0[0], v0[1]), l1 = Math.hypot(v1[0], v1[1]);
  if (l0 < 0.01 || l1 < 0.01) return g;
  const ang = Math.atan2(v1[1], v1[0]) - Math.atan2(v0[1], v0[0]);
  // ein einzelner Zug darf den Plan höchstens 5-fach vergrößern/verkleinern
  return rotateScaleGeoref(g, (-ang * 180) / Math.PI, Math.min(5, Math.max(0.2, l1 / l0)));
}

/** Meter je Planpixel aus der Einpassung (Breite des Plans auf der Karte / Pixelbreite) */
export function metersPerPxFromGeoref(g: PlanGeoref, plan: Pick<PlanSheet, 'width'>): number {
  const kx = mPerDegLng(g.tl.lat);
  const w = Math.hypot((g.tr.lng - g.tl.lng) * kx, (g.tr.lat - g.tl.lat) * M_PER_DEG_LAT);
  return w / plan.width;
}

/** Drehung des Plans gegenüber Norden in Grad (für die Anzeige) */
export function georefRotation(g: PlanGeoref): number {
  const kx = mPerDegLng(g.tl.lat);
  const ang = Math.atan2((g.tr.lat - g.tl.lat) * M_PER_DEG_LAT, (g.tr.lng - g.tl.lng) * kx);
  return Math.round(((-ang * 180) / Math.PI) * 10) / 10;
}

/** Plan, der gerade als Ebene über der Karte liegt (nur wenn eingepasst) */
export function overlayPlan(insp: Inspection): PlanSheet | null {
  const o = insp.overlay;
  if (!o || !o.visible || activePlan(insp)) return null;
  return insp.plans?.find((p) => p.id === o.planId && p.georef) ?? null;
}

/** Punkte, die direkt auf dem Plan gesetzt wurden, mit der Einpassung auf die Landkarte übertragen */
export function convertPlanPointsToMap(d: Inspection, planId: string): number {
  const plan = d.plans?.find((p) => p.id === planId);
  if (!plan?.georef) return 0;
  let n = 0;
  for (const p of d.route.points) {
    if (p.planId !== planId) continue;
    if (p.position) p.position = planToGeo(plan.georef, plan, p.position.lng, -p.position.lat);
    delete p.planId;
    p.updatedAt = Date.now();
    n++;
  }
  return n;
}

/** Plan so verschieben, dass seine Mitte auf „to“ liegt */
export function recenterGeoref(g: PlanGeoref, to: LatLng): PlanGeoref {
  const c = georefCenter(g);
  const dLat = to.lat - c.lat, dLng = to.lng - c.lng;
  const mv = (p: LatLng) => ({ lat: p.lat + dLat, lng: p.lng + dLng });
  return { tl: mv(g.tl), tr: mv(g.tr), bl: mv(g.bl) };
}
