// Fotos exportieren (Galerie / Dateien) – wahlweise mit Standort-Stempel im Bild.
//
// iPhone: Web-Apps dürfen nicht direkt in die Fotos-App schreiben. Über das
// Teilen-Menü („Bilder sichern“ bzw. „X Bilder sichern“) landen sie aber in der
// Galerie. Am PC werden die Bilder heruntergeladen.

import type { Inspection, PhotoMeta, Settings } from '../model/types';
import { getPhotoBlob } from '../storage/db';
import { canvasToBlob, loadImage, scaleToCanvas } from './photo';
import { drawAnnotations } from '../annotate/lines';
import { pointDisplayName } from '../model/factory';
import { download } from '../share/share';

export function stampLines(f: PhotoMeta, insp: Inspection): string[] {
  const when = new Date(f.takenAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pos = f.position ? `${f.position.lat.toFixed(6)}, ${f.position.lng.toFixed(6)}${f.position.accuracy ? ` (±${Math.round(f.position.accuracy)} m)` : ''}${f.positionSource === 'address' ? ' – aus Adresse' : ''}` : 'ohne GPS-Position';
  const note = f.noteId ? insp.notes.find((n) => n.id === f.noteId) : null;
  const pt = f.pointId ? insp.route.points.find((p) => p.id === f.pointId) : null;
  const what = [note ? `${note.kind === 'observation' ? 'Mangel' : 'Notiz'}: ${note.title || note.category || ''}` : '', pt ? pointDisplayName(pt) + (pt.title ? ` ${pt.title}` : '') : '', f.description].filter(Boolean).join(' · ');
  return [
    `${when}  ·  Foto ${f.number}`,
    ...(f.address || f.placeLabel ? [`📍 ${f.address || f.placeLabel}`] : []),
    `GPS ${pos}`,
    [insp.meta.projectName, insp.meta.site].filter(Boolean).join(' – ') + (what ? `  ·  ${what}` : ''),
  ].filter((l) => l.trim());
}

/** Foto als JPEG, optional mit Linien und Info-Band unten */
export async function renderPhoto(f: PhotoMeta, insp: Inspection, settings: Settings, stamp: boolean): Promise<Blob> {
  const rec = await getPhotoBlob(f.id);
  if (!rec) throw new Error(`Foto ${f.number} nicht gefunden.`);
  if (!stamp && !(f.annotations?.length)) return rec.full;
  const img = await loadImage(rec.full);
  const base = scaleToCanvas(img, 2048);
  const w = base.width;
  const lines = stamp ? stampLines(f, insp) : [];
  const fs = Math.max(16, Math.round(w * 0.024));
  const band = lines.length ? Math.round(lines.length * fs * 1.4 + fs * 0.9) : 0;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = base.height + band;
  const g = c.getContext('2d')!;
  g.drawImage(base, 0, 0);
  if (f.annotations?.length) drawAnnotations(g, f.annotations, w, base.height, settings.lineTypes);
  if (band) {
    g.fillStyle = '#111';
    g.fillRect(0, base.height, w, band);
    g.textBaseline = 'top';
    lines.forEach((l, i) => {
      g.font = `${i === 0 ? '700 ' : ''}${fs}px -apple-system, Helvetica, Arial, sans-serif`;
      g.fillStyle = i === 0 ? '#fff' : 'rgba(255,255,255,0.86)';
      let s = l;
      while (s.length > 4 && g.measureText(s).width > w - fs * 1.2) s = s.slice(0, -2) + '…';
      g.fillText(s, fs * 0.6, base.height + fs * 0.45 + i * fs * 1.4);
    });
  }
  return canvasToBlob(c, 'image/jpeg', 0.9);
}

export function photoFileName(f: PhotoMeta, insp: Inspection): string {
  const d = new Date(f.takenAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  const proj = (insp.meta.projectNumber || insp.meta.projectName || 'Begehung').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 30);
  return `${proj}_Foto${String(f.number).padStart(3, '0')}_${ts}.jpg`;
}

/** Fotos vorbereiten (kann dauern) – danach mit shareOrDownload ausgeben */
export async function preparePhotos(photos: PhotoMeta[], insp: Inspection, settings: Settings, stamp: boolean, onProgress?: (i: number, n: number) => void): Promise<File[]> {
  const files: File[] = [];
  for (const [i, f] of photos.entries()) {
    onProgress?.(i + 1, photos.length);
    const blob = await renderPhoto(f, insp, settings, stamp);
    files.push(new File([blob], photoFileName(f, insp), { type: 'image/jpeg' }));
  }
  return files;
}

/** Muss direkt im Klick-Handler aufgerufen werden (iOS verlangt eine Benutzeraktion). */
export async function shareOrDownload(files: File[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
      throw new Error('Teilen nicht möglich: ' + ((e as Error).message || e));
    }
  }
  files.forEach((f, i) => window.setTimeout(() => download(f, f.name), i * 350));
  return 'downloaded';
}
