// PDF-Seiten als Bilder rendern (pdf.js) – für Vorschau und Vorlagen-Miniaturen.
// iOS zeigt PDFs in <iframe> nur unzuverlässig (oft nur Seite 1), daher eigenes Rendering.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  url: string;
  width: number;
  height: number;
}

export async function renderPdfPages(bytes: Uint8Array | ArrayBuffer, targetWidth: number, onPage?: (i: number, n: number) => void, maxPages = 200): Promise<RenderedPage[]> {
  // pdf.js übernimmt den Puffer → Kopie übergeben
  const data = new Uint8Array(bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const out: RenderedPage[] = [];
  try {
    const n = Math.min(pdf.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
      onPage?.(i, n);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = targetWidth / base.width;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Vorschau fehlgeschlagen'))), 'image/jpeg', 0.85));
      out.push({ url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
      page.cleanup();
    }
  } finally {
    void task.destroy();
  }
  return out;
}

export async function pdfPageCount(bytes: ArrayBuffer): Promise<number> {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes).slice() });
  const n = (await task.promise).numPages;
  void task.destroy();
  return n;
}

export function releasePages(pages: RenderedPage[]) {
  pages.forEach((p) => URL.revokeObjectURL(p.url));
}

/**
 * Eine PDF-Seite in hoher Auflösung als Bild (für Pläne). Begrenzung auf
 * 4096 px Kantenlänge / 16 Mio. Pixel – mehr erlaubt Safari auf dem iPhone nicht.
 */
export async function renderPdfPageImage(bytes: ArrayBuffer, pageIndex: number): Promise<{ blob: Blob; width: number; height: number; ptPerPx: number }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes).slice() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    let scale = 4096 / Math.max(base.width, base.height);
    if (base.width * base.height * scale * scale > 16e6) scale = Math.sqrt(16e6 / (base.width * base.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: g, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Plan konnte nicht umgewandelt werden.'))), 'image/jpeg', 0.92));
    page.cleanup();
    return { blob, width: canvas.width, height: canvas.height, ptPerPx: base.width / canvas.width };
  } finally {
    void task.destroy();
  }
}
