// Kamera & Fotoverarbeitung.
// Auf dem iPhone öffnet <input type="file" accept="image/*" capture="environment">
// direkt die Kamera. Das ist zuverlässiger als ein eigener Kamera-Sucher per
// getUserMedia (volle Kameraqualität, Fokus, Blitz, HDR).

import type { GeoFix, PhotoMeta } from '../model/types';
import { newPhotoMeta } from '../model/factory';
import { savePhotoBlob } from '../storage/db';
import { useInspection } from '../state/inspectionStore';
import { fixIfAvailable } from '../geo/gps';
import { nearestPoint } from '../geo/geo';

const FULL_MAX = 2048;
const THUMB_MAX = 360;
/** Fotos innerhalb dieses Abstands werden automatisch dem nächsten Trassenpunkt zugeordnet */
export const AUTO_ASSIGN_M = 30;

/** Muss direkt im Klick-Handler aufgerufen werden (iOS verlangt eine Benutzeraktion). */
export function pickImages(opts: { camera: boolean; multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (opts.camera) input.setAttribute('capture', 'environment');
    if (opts.multiple) input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => { input.remove(); resolve(input.files?.[0] ?? null); });
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.click();
  });
}

export function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    img.onload = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden (Format nicht unterstützt?).')); };
    img.src = url;
  });
}

export function scaleToCanvas(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/jpeg', q = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden.'))), type, q));
}

/** Verkleinert ein Foto (spart Speicher) und erzeugt ein Vorschaubild. EXIF-Drehung übernimmt der Browser. */
export async function processPhoto(file: Blob): Promise<{ full: Blob; thumb: Blob; width: number; height: number }> {
  const img = await loadImage(file);
  const fullC = scaleToCanvas(img, FULL_MAX);
  const thumbC = scaleToCanvas(img, THUMB_MAX);
  const [full, thumb] = await Promise.all([canvasToBlob(fullC, 'image/jpeg', 0.85), canvasToBlob(thumbC, 'image/jpeg', 0.75)]);
  return { full, thumb, width: fullC.width, height: fullC.height };
}

/**
 * Speichert aufgenommene Fotos in der geöffneten Begehung.
 * Position = aktuelle GPS-Position (falls freigegeben); Zuordnung zum nächsten
 * Trassenpunkt im Umkreis von 30 m – als „automatisch zugeordnet“ markiert.
 */
export async function addPhotos(files: File[], opts: { pointId?: string | null; noteId?: string | null; fixPromise?: Promise<GeoFix | null> } = {}): Promise<PhotoMeta[]> {
  const store = useInspection.getState();
  const insp = store.insp;
  if (!insp || !files.length) return [];
  const fix = await (opts.fixPromise ?? fixIfAvailable());
  const added: PhotoMeta[] = [];
  for (const file of files) {
    const { full, thumb, width, height } = await processPhoto(file);
    const cur = useInspection.getState().insp!;
    let pointId = opts.pointId ?? null;
    let auto = false;
    if (!pointId && fix) {
      const near = nearestPoint(cur.route.points, fix, AUTO_ASSIGN_M);
      if (near) { pointId = near.id; auto = true; }
    }
    const meta = newPhotoMeta({
      number: cur.counters.photo + 1,
      takenAt: file.lastModified && Math.abs(Date.now() - file.lastModified) < 5 * 60_000 ? file.lastModified : Date.now(),
      position: fix,
      pointId,
      noteId: opts.noteId ?? null,
      pointAutoAssigned: auto,
      width,
      height,
    });
    await savePhotoBlob({ id: meta.id, inspectionId: cur.id, full, thumb });
    useInspection.getState().mutate((d) => {
      d.counters.photo = Math.max(d.counters.photo, meta.number);
      d.photos.push(meta);
    });
    added.push(meta);
  }
  return added;
}
