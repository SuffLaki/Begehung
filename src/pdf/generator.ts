// Baut das Begehungsprotokoll als PDF (pdf-lib, läuft komplett im Browser).
// Reihenfolge: Deckblatt → Übersichtskarte → Begehungspunkte → Beobachtungen/Notizen
// → weitere Fotos → Koordinatenliste → Abschluss (Zusammenfassung, offene Punkte,
// Aufgaben, Unterschrift). Seitenzahlen/Kopfzeilen werden am Ende ergänzt.

import { PDFDocument, rgb, type PDFImage } from 'pdf-lib';
import type { Inspection, Note, PdfTemplate, PhotoMeta, RoutePoint, Settings } from '../model/types';
import { Layout, MM, C, hex, san } from './layout';
import { endpoints, isRelevantPoint, orderedPoints } from '../geo/routeOps';
import { formatDistance, pathLength, routeLength, segmentPositions } from '../geo/geo';
import { pointDisplayName } from '../model/factory';
import { getPhotoBlob } from '../storage/db';
import { canvasToBlob, loadImage, scaleToCanvas } from '../camera/photo';
import { renderStaticMap } from '../map/staticMap';
import { drawAnnotations, legendText } from '../annotate/lines';

export const MAP_ASPECT = 4 / 3;

export interface PdfResult {
  bytes: Uint8Array;
  pageCount: number;
  warnings: string[];
}

const SOURCE_LABEL: Record<RoutePoint['source'], string> = { gps: 'GPS', voice: 'Sprache (geschätzt)', manual: 'manuell gesetzt', auto: 'automatisch' };
const STATUS_LABEL: Record<Note['status'], string> = { open: 'offen', done: 'erledigt', info: 'zur Info' };

export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

function time(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function coord(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export async function generatePdf(insp: Inspection, settings: Settings, tpl: PdfTemplate, onProgress: (m: string) => void = () => undefined): Promise<PdfResult> {
  const warnings: string[] = [];
  const ps = insp.pdfSettings;
  const doc = await PDFDocument.create();
  doc.setTitle(san(`Begehungsprotokoll ${insp.meta.projectName}`));
  doc.setAuthor(san(insp.meta.inspector || settings.company.name));
  doc.setCreator('Begehungsprotokoll-App');
  doc.setCreationDate(new Date());

  const L = new Layout(doc, tpl);
  await L.init(tpl.file ? await tpl.file.arrayBuffer() : null, tpl.file?.type ?? '');
  const { startIds, endIds } = endpoints(insp);
  const pointsInOrder = orderedPoints(insp);
  const relevant = pointsInOrder.filter((p) => isRelevantPoint(insp, p, startIds, endIds));
  const photoCache = new Map<string, PDFImage | null>();

  async function photoImage(id: string): Promise<PDFImage | null> {
    if (photoCache.has(id)) return photoCache.get(id)!;
    let img: PDFImage | null = null;
    try {
      const rec = await getPhotoBlob(id);
      if (rec) {
        const c = scaleToCanvas(await loadImage(rec.full), 1400);
        const anns = insp.photos.find((f) => f.id === id)?.annotations ?? [];
        if (anns.length) drawAnnotations(c.getContext('2d')!, anns, c.width, c.height, settings.lineTypes);
        img = await doc.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.8)).arrayBuffer()));
      }
    } catch { /* Foto fehlt */ }
    if (!img) warnings.push(`Ein Foto konnte nicht geladen werden.`);
    photoCache.set(id, img);
    return img;
  }

  const pointName = (id: string | null) => {
    const p = id ? insp.route.points.find((x) => x.id === id) : null;
    return p ? `${pointDisplayName(p)}${p.title ? ` (${p.title})` : ''}` : '';
  };

  /** Fotos in zwei Spalten mit Bildunterschrift */
  async function photoGrid(photos: PhotoMeta[]) {
    if (!ps.include.photos || !photos.length) return;
    const gap = 10;
    const colW = (L.width - gap) / 2;
    for (let i = 0; i < photos.length; i += 2) {
      const row = photos.slice(i, i + 2);
      const imgs = await Promise.all(row.map((f) => photoImage(f.id)));
      const heights = row.map((f) => Math.min(colW * (f.height && f.width ? f.height / f.width : 0.75), 72 * MM));
      const capH = Math.max(...row.map((f) => L.textHeight(caption(f), 7.5, L.font, colW))) + 4;
      const rowH = Math.max(...heights) + capH + 8;
      L.ensure(rowH);
      const top = L.y;
      row.forEach((f, j) => {
        const x = L.left + j * (colW + gap);
        const img = imgs[j];
        const h = heights[j];
        if (img) {
          const scale = Math.min(colW / img.width, h / img.height);
          const w = img.width * scale;
          const hh = img.height * scale;
          L.page.drawImage(img, { x: x + (colW - w) / 2, y: top - hh - 2, width: w, height: hh });
        } else {
          L.page.drawRectangle({ x, y: top - h - 2, width: colW, height: h, color: C.soft, borderColor: C.line, borderWidth: 0.5 });
          L.at('Foto nicht verfügbar', x + 6, top - 16, 8, L.font, C.muted);
        }
        const lines = L.wrap(caption(f), L.font, 7.5, colW);
        let yy = top - h - 6;
        for (const ln of lines) {
          yy -= 7.5 * 1.32;
          L.at(ln, x, yy + 2, 7.5, L.font, C.muted);
        }
      });
      L.y = top - rowH;
    }
  }

  function caption(f: PhotoMeta): string {
    const parts = [`Foto ${f.number}`, time(f.takenAt)];
    if (f.placeLabel) parts.push(f.placeLabel);
    if (f.position) parts.push(`${f.positionSource === 'address' ? 'Position aus Adresse' : 'GPS'} ${coord(f.position.lat, f.position.lng)}${f.position.accuracy ? ` (±${Math.round(f.position.accuracy)} m)` : ''}`);
    if (f.pointId) parts.push(`Punkt ${pointName(f.pointId)}`);
    const lines = f.annotations?.length ? `\nEingezeichnet: ${legendText(f.annotations, settings.lineTypes)}` : '';
    return parts.join(' · ') + (f.description ? `\n${f.description}` : '') + lines;
  }

  // ==================================================== Deckblatt
  onProgress('Deckblatt …');
  if (ps.include.cover) {
    L.newPage(true);
    const m = insp.meta;
    if (tpl.drawHeader && settings.company.logoDataUrl) {
      try {
        const logo = await embedDataUrl(doc, settings.company.logoDataUrl);
        const s = Math.min((50 * MM) / logo.width, (20 * MM) / logo.height);
        L.page.drawImage(logo, { x: L.right - logo.width * s, y: L.top - logo.height * s, width: logo.width * s, height: logo.height * s });
      } catch { warnings.push('Firmenlogo konnte nicht eingebettet werden.'); }
    }
    L.y = L.top - (tpl.drawHeader && settings.company.logoDataUrl ? 26 : 8) * MM;
    L.at('BEGEHUNGSPROTOKOLL', L.left, L.y, 10, L.bold, L.accent);
    L.y -= 30;
    L.text(m.projectName || 'Ohne Projektname', { size: 24, font: L.bold, after: 2 });
    L.text(['Trassenbegehung', m.site].filter(Boolean).join(' · '), { size: 12, color: C.muted, after: 10 });
    L.page.drawRectangle({ x: L.left, y: L.y, width: L.width, height: 2, color: L.accent });
    L.y -= 16;
    L.kv([
      ['Projekt-/Auftragsnr.', m.projectNumber],
      ['Begehungsnr.', m.inspectionNumber],
      ['Datum / Uhrzeit', `${formatDate(m.date)}${m.time ? `, ${m.time} Uhr` : ''}`],
      ['Begeher', m.inspector],
      ['Auftraggeber', m.client],
      ['Ansprechpartner', m.contactPerson],
      ['Baustelle / Bereich', m.site],
      ['Startpunkt', m.startPoint],
      ['Status', insp.status === 'completed' ? `abgeschlossen${insp.completedAt ? ` am ${time(insp.completedAt)}` : ''}` : 'in Bearbeitung (Entwurf)'],
    ], 125, 10);
    if (m.description) {
      L.space(10);
      L.text('Beschreibung', { size: 9, font: L.bold, color: C.muted, after: 2 });
      L.text(m.description, { size: 10 });
    }
    // Kennzahlen
    const stats: [string, string][] = [
      ['Trassenlänge', formatDistance(routeLength(insp.route))],
      ['Wegpunkte', String(insp.route.points.filter((p) => p.kind === 'route').length)],
      ['Fotos', String(insp.photos.length)],
      ['Offene Punkte', String(insp.notes.filter((n) => n.status === 'open').length)],
    ];
    L.space(14);
    L.ensure(52);
    const bw = (L.width - 3 * 8) / 4;
    stats.forEach(([k, v], i) => {
      const x = L.left + i * (bw + 8);
      L.page.drawRectangle({ x, y: L.y - 44, width: bw, height: 44, color: C.soft });
      L.page.drawRectangle({ x, y: L.y - 44, width: 2.5, height: 44, color: L.accent });
      L.at(v, x + 10, L.y - 22, 15, L.bold, C.text, bw - 14);
      L.at(k, x + 10, L.y - 36, 8, L.font, C.muted, bw - 14);
    });
    L.y -= 58;
    const unconfirmed = insp.route.points.filter((p) => !p.confirmed).length;
    if (unconfirmed) {
      L.text(`Hinweis: ${unconfirmed} Punkt(e) wurden automatisch aus einer Sprachbeschreibung geschätzt und sind nicht bestätigt. Sie sind in Karte und Liste gestrichelt bzw. mit „?“ gekennzeichnet.`, { size: 8.5, color: C.warn, after: 6 });
    }
    // Firmenblock unten
    const co = settings.company;
    if (tpl.drawHeader && co.name) {
      const lines = [co.name, co.address, [co.phone && `Tel. ${co.phone}`, co.email].filter(Boolean).join(' · '), co.website].filter(Boolean);
      let yy = L.bottom + lines.length * 11;
      L.page.drawLine({ start: { x: L.left, y: yy + 8 }, end: { x: L.right, y: yy + 8 }, thickness: 0.5, color: C.line });
      for (const [i, ln] of lines.entries()) {
        L.at(ln, L.left, yy - 4, i === 0 ? 9 : 8, i === 0 ? L.bold : L.font, i === 0 ? C.text : C.muted, L.width);
        yy -= 11;
      }
    }
  }

  // ==================================================== Karte
  if (ps.include.map) {
    onProgress('Karte …');
    const map = await renderStaticMap(insp, ps, MAP_ASPECT, onProgress);
    if (!map) {
      warnings.push('Keine Kartenseite: Es sind noch keine verorteten Punkte vorhanden.');
    } else {
      L.newPage(false);
      L.heading('Übersichtskarte');
      const img = await doc.embedJpg(map.jpeg);
      let w = L.width;
      let h = w / MAP_ASPECT;
      const maxH = (L.y - L.bottom) * 0.68;
      if (h > maxH) { h = maxH; w = h * MAP_ASPECT; }
      L.page.drawImage(img, { x: L.left, y: L.y - h, width: w, height: h });
      L.page.drawRectangle({ x: L.left, y: L.y - h, width: w, height: h, borderColor: C.line, borderWidth: 0.6 });
      L.y -= h + 12;
      if (!map.tilesOk) warnings.push('Kartenhintergrund war nicht verfügbar (offline?) – die Karte zeigt nur die Trassengeometrie.');

      // Legende
      L.text('Legende', { size: 9, font: L.bold, after: 3 });
      for (const seg of insp.route.segments) {
        if (seg.pointIds.length < 2) continue;
        L.ensure(14);
        L.y -= 12;
        const c = ps.colored ? hex(seg.color) : rgb(0.07, 0.07, 0.07);
        L.page.drawRectangle({ x: L.left, y: L.y + 2, width: 22, height: 4, color: c });
        L.at(`${seg.name} – ${formatDistance(pathLength(segmentPositions(insp.route, seg.pointIds)))}, ${seg.pointIds.length} Punkte`, L.left + 30, L.y, 8.5);
      }
      // Bedeutung der Farben (Linienarten)
      const usedTypes = [...new Set(insp.route.segments.map((s) => s.lineType).filter(Boolean))] as string[];
      if (usedTypes.length && ps.colored) {
        L.y -= 4;
        const parts = usedTypes.map((k) => settings.lineTypes.find((t) => t.key === k)).filter(Boolean);
        let x = L.left;
        L.ensure(14);
        L.y -= 12;
        for (const t of parts) {
          L.page.drawRectangle({ x, y: L.y + 1, width: 18, height: 6, color: hex(t!.color) });
          L.at(t!.label, x + 24, L.y, 8.5, L.bold);
          x += 24 + L.bold.widthOfTextAtSize(san(t!.label), 8.5) + 18;
        }
      }
      L.y -= 6;
      L.ensure(30);
      const items: [string, (x: number, y: number) => void][] = [
        ['Start', (x, y) => L.page.drawCircle({ x: x + 5, y: y + 3, size: 5, color: rgb(0.12, 0.56, 0.24) })],
        ['Ende', (x, y) => L.page.drawCircle({ x: x + 5, y: y + 3, size: 5, color: rgb(0.77, 0.13, 0.12) })],
        ['Wegpunkt', (x, y) => L.page.drawCircle({ x: x + 5, y: y + 3, size: 4, color: C.white, borderColor: C.text, borderWidth: 1.2 })],
        ['automatisch ermittelt (geschätzt)', (x, y) => L.page.drawLine({ start: { x, y: y + 3 }, end: { x: x + 22, y: y + 3 }, thickness: 2.5, color: C.text, dashArray: [4, 3] })],
        ['Foto', (x, y) => { L.page.drawRectangle({ x, y: y - 1, width: 16, height: 9, color: rgb(0.11, 0.11, 0.12) }); }],
        ['Markierung', (x, y) => L.page.drawRectangle({ x: x + 2, y: y - 1, width: 8, height: 8, borderColor: C.text, borderWidth: 1.2 })],
      ];
      const colW = L.width / 3;
      items.forEach(([lbl, draw], i) => {
        const x = L.left + (i % 3) * colW;
        const y = L.y - 12 - Math.floor(i / 3) * 14;
        draw(x, y);
        L.at(lbl, x + 28, y, 8.5, L.font, C.text, colW - 30);
      });
      L.y -= 12 + Math.ceil(items.length / 3) * 14 + 6;
      L.text(`Koordinaten: WGS84. Positionen stammen aus dem GPS des Smartphones (Genauigkeit je Punkt angegeben), manueller Platzierung oder Sprachbeschreibung (geschätzt) – keine Vermessung.${map.attribution ? ` Kartengrundlage: ${map.attribution}.` : ''}`, { size: 7.5, color: C.muted });
    }
  }

  // ==================================================== Punkte
  if (ps.include.points && relevant.length) {
    onProgress('Begehungspunkte …');
    L.newPage(false);
    L.heading('Begehungspunkte');
    for (const p of relevant) {
      const seg = insp.route.segments.find((s) => s.pointIds.includes(p.id));
      const notes = insp.notes.filter((n) => n.pointId === p.id);
      const photos = insp.photos.filter((f) => f.pointId === p.id);
      L.ensure(70);
      L.y -= 4;
      const barH = 20;
      L.page.drawRectangle({ x: L.left, y: L.y - barH, width: L.width, height: barH, color: C.soft });
      L.page.drawRectangle({ x: L.left, y: L.y - barH, width: 3, height: barH, color: seg && ps.colored ? hex(seg.color) : L.accent });
      const role = startIds.has(p.id) ? 'Start · ' : endIds.has(p.id) ? 'Ende · ' : '';
      L.at(`${role}${pointDisplayName(p)}${p.title ? ` – ${p.title}` : ''}`, L.left + 10, L.y - 14, 10.5, L.bold, C.text, L.width * 0.68);
      if (p.category) L.at(p.category, L.right - 8, L.y - 14, 8.5, L.font, C.muted, L.width * 0.3, 'right');
      L.y -= barH + 4;
      if (!p.confirmed) L.text('Automatisch ermittelt – Lage geschätzt, nicht bestätigt.', { size: 8.5, font: L.bold, color: C.warn, after: 2 });
      L.kv([
        ['Koordinaten (WGS84)', p.position ? `${coord(p.position.lat, p.position.lng)}${p.accuracy ? `  (±${Math.round(p.accuracy)} m)` : ''}` : 'nicht verortet'],
        ['Station', p.station],
        ['Abschnitt', seg?.name ?? (p.kind === 'marker' ? 'Markierung' : '')],
        ['Quelle', SOURCE_LABEL[p.source]],
        ['Erfasst', time(p.createdAt)],
        ['Beschreibung', p.description],
      ], 110, 9);
      for (const n of notes) {
        L.space(3);
        L.text(`• ${n.title || n.category || 'Notiz'}${n.station && !n.title.includes(n.station) ? ` (Station ${n.station})` : ''}: ${n.description}${n.hint ? `\n  Hinweis: ${n.hint}` : ''}`, { size: 9, x: L.left + 6 });
      }
      L.space(6);
      await photoGrid(photos);
      L.space(8);
    }
  }

  // ==================================================== Notizen
  const notes = insp.notes;
  if (ps.include.notes && notes.length) {
    onProgress('Notizen …');
    L.newPage(false);
    L.heading('Beobachtungen und Notizen');
    for (const n of notes) {
      L.ensure(50);
      L.y -= 4;
      L.text(`${n.title || n.category || 'Notiz'}`, { size: 10.5, font: L.bold, width: L.width - 70 });
      L.at(STATUS_LABEL[n.status], L.right, L.y + 3, 8.5, L.bold, n.status === 'open' ? C.warn : C.muted, 70, 'right');
      const meta = [n.kind === 'observation' ? 'Beobachtung' : 'Notiz', n.category, n.station && `Station ${n.station}`, n.pointId && `Punkt ${pointName(n.pointId)}`, time(n.createdAt), n.origin === 'voice' ? 'per Sprache erfasst' : '']
        .filter(Boolean).join(' · ');
      L.text(meta, { size: 8, color: C.muted, after: 2 });
      if (n.position) L.text(`GPS ${coord(n.position.lat, n.position.lng)}${n.position.accuracy ? ` (±${Math.round(n.position.accuracy)} m)` : ''}`, { size: 8, color: C.muted, after: 2 });
      if (!n.confirmed) L.text('Automatisch strukturiert – nicht bestätigt.', { size: 8.5, font: L.bold, color: C.warn, after: 2 });
      L.text(n.description, { size: 9.5, after: 2 });
      if (n.hint) L.text(`Hinweis: ${n.hint}`, { size: 9.5, font: L.oblique, after: 2 });
      await photoGrid(insp.photos.filter((f) => f.noteId === n.id && f.pointId !== n.pointId));
      L.space(6);
      L.hr();
      L.space(4);
    }
  }

  // ==================================================== weitere Fotos
  const loose = insp.photos.filter((f) => !f.pointId && !f.noteId);
  if (ps.include.photos && loose.length) {
    onProgress('Fotos …');
    L.newPage(false);
    L.heading('Weitere Fotos');
    await photoGrid(loose);
  }

  // ==================================================== Koordinatenliste
  const located = pointsInOrder.filter((p) => p.position);
  if (ps.include.coordTable && located.length) {
    L.newPage(false);
    L.heading('Koordinatenliste');
    const cols = [0, 46, 190, 280, 370, 420];
    const head = ['Nr.', 'Bezeichnung', 'Breite', 'Länge', 'Genauigk.', 'Quelle'];
    const drawHead = () => {
      L.y -= 14;
      head.forEach((h, i) => L.at(h, L.left + cols[i] * (L.width / 500), L.y, 8, L.bold, C.muted));
      L.y -= 4;
      L.hr();
    };
    drawHead();
    for (const p of located) {
      if (L.y - 13 < L.bottom) { L.newPage(false); drawHead(); }
      L.y -= 12;
      const vals = [pointDisplayName(p), p.title || (startIds.has(p.id) ? 'Start' : endIds.has(p.id) ? 'Ende' : ''), p.position!.lat.toFixed(6), p.position!.lng.toFixed(6), p.accuracy ? `±${Math.round(p.accuracy)} m` : '–', SOURCE_LABEL[p.source]];
      vals.forEach((v, i) => L.at(v, L.left + cols[i] * (L.width / 500), L.y, 8, L.font, p.confirmed ? C.text : C.warn, ((cols[i + 1] ?? 500) - cols[i]) * (L.width / 500) - 4));
    }
  }

  // ==================================================== Abschluss
  if (ps.include.closing) {
    onProgress('Abschluss …');
    L.newPage(false);
    L.heading('Abschluss');
    if (insp.summary?.text && insp.summary.confirmed) {
      L.heading('Zusammenfassung', 2);
      L.text(insp.summary.text, { after: 6 });
    } else if (insp.summary?.text) {
      warnings.push('Die Zusammenfassung ist nicht bestätigt und wurde nicht in die PDF übernommen.');
    }
    if (insp.meta.remarks) {
      L.heading('Allgemeine Bemerkungen', 2);
      L.text(insp.meta.remarks, { after: 6 });
    }
    const open = insp.notes.filter((n) => n.status === 'open');
    L.heading('Offene Punkte', 2);
    if (!open.length) L.text('Keine offenen Punkte.', { color: C.muted, after: 6 });
    for (const n of open) L.text(`• ${n.title || n.category || 'Notiz'}${n.pointId ? ` (${pointName(n.pointId)})` : ''}${n.station && !n.title.includes(n.station) ? `, Station ${n.station}` : ''}: ${n.hint || n.description}`, { x: L.left + 4, after: 2 });
    if (insp.tasks.length) {
      L.space(6);
      L.heading('Aufgaben', 2);
      for (const t of insp.tasks) {
        L.text(`${t.done ? '[x]' : '[  ]'}  ${t.text}${t.assignee ? ` – zuständig: ${t.assignee}` : ''}${t.due ? ` – bis ${formatDate(t.due)}` : ''}`, { x: L.left + 4, after: 2 });
      }
    }

    // Unterschriften
    L.space(10);
    L.ensure(130);
    L.heading('Unterschrift / Freigabe', 2);
    const colW = (L.width - 30) / 2;
    const top = L.y - 8;
    const sig = insp.signature;
    const boxes: [string, string, string, string | null][] = [
      ['Begeher', sig?.name || insp.meta.inspector, sig ? `${sig.place ? sig.place + ', ' : ''}${time(sig.signedAt)}` : '', sig?.dataUrl || null],
      ['Freigabe Auftraggeber', insp.meta.contactPerson || insp.meta.client, '', null],
    ];
    for (const [i, [title, name, when, img]] of boxes.entries()) {
      const x = L.left + i * (colW + 30);
      L.at(title, x, top - 10, 8.5, L.bold, C.muted);
      if (img) {
        try {
          const pi = await embedDataUrl(doc, img);
          const s = Math.min(colW / pi.width, 50 / pi.height);
          L.page.drawImage(pi, { x, y: top - 70, width: pi.width * s, height: pi.height * s });
        } catch { warnings.push('Unterschrift konnte nicht eingebettet werden.'); }
      }
      L.page.drawLine({ start: { x, y: top - 74 }, end: { x: x + colW, y: top - 74 }, thickness: 0.8, color: C.text });
      L.at(['Ort, Datum, Unterschrift', when].filter(Boolean).join(' – '), x, top - 84, 7.5, L.font, C.muted, colW);
      if (name) L.at(name + (i === 0 && sig?.role ? `, ${sig.role}` : ''), x, top - 96, 9, L.font, C.text, colW);
    }
    L.y = top - 106;
  }

  if (!L.pages.length) L.newPage(true);

  // ==================================================== Kopf-/Fußzeilen
  onProgress('Seitenzahlen …');
  const total = L.pages.length;
  L.pages.forEach((page, i) => {
    const w = page.getWidth();
    const bottom = (tpl.margins.bottom * MM) / 2;
    const left = tpl.margins.left * MM;
    const right = w - tpl.margins.right * MM;
    if (tpl.drawHeader && !L.coverIndex.has(i)) {
      const top = page.getHeight() - (tpl.margins.top * MM) / 2;
      const head = settings.company.name || 'Begehungsprotokoll';
      page.drawText(san(head), { x: left, y: top, size: 8.5, font: L.bold, color: C.text });
      const r = san(`${insp.meta.projectName}${insp.meta.date ? ' · ' + formatDate(insp.meta.date) : ''}`);
      const rw = L.font.widthOfTextAtSize(r, 8.5);
      page.drawText(r, { x: right - rw, y: top, size: 8.5, font: L.font, color: C.muted });
      page.drawLine({ start: { x: left, y: top - 6 }, end: { x: right, y: top - 6 }, thickness: 0.5, color: C.line });
    }
    if (tpl.drawHeader) {
      const f = san(`Begehungsprotokoll ${insp.meta.projectNumber || insp.meta.projectName}`.trim());
      page.drawText(f, { x: left, y: bottom, size: 7.5, font: L.font, color: C.muted });
    }
    if (tpl.drawPageNumbers) {
      const t = `Seite ${i + 1} von ${total}`;
      const tw = L.font.widthOfTextAtSize(t, 7.5);
      page.drawText(t, { x: right - tw, y: bottom, size: 7.5, font: L.font, color: C.muted });
    }
  });

  onProgress('PDF wird gespeichert …');
  const bytes = await doc.save();
  return { bytes, pageCount: total, warnings: [...new Set(warnings)] };
}

async function embedDataUrl(doc: PDFDocument, dataUrl: string): Promise<PDFImage> {
  const [head, b64] = dataUrl.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return head.includes('png') ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

export function reportFileName(insp: Inspection): string {
  const base = `Begehungsprotokoll_${insp.meta.projectNumber || insp.meta.projectName || 'Projekt'}_${insp.meta.date}`;
  return base.replace(/[^\wäöüÄÖÜß.-]+/g, '_').replace(/_+/g, '_') + '.pdf';
}
