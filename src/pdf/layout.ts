// Seitenlayout für pdf-lib: Hintergrund (Vorlage), Inhaltsbereich, Textumbruch,
// automatischer Seitenumbruch. Koordinaten in pt, Ursprung unten links.

import { PDFDocument, PDFFont, PDFImage, PDFPage, PDFEmbeddedPage, rgb, StandardFonts, type RGB } from 'pdf-lib';
import type { PdfTemplate } from '../model/types';

export const MM = 72 / 25.4;
export const A4: [number, number] = [595.28, 841.89];

export function hex(c: string): RGB {
  const m = c.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(0.12, 0.31, 0.47);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

export const C = {
  text: rgb(0.1, 0.11, 0.13),
  muted: rgb(0.38, 0.41, 0.45),
  line: rgb(0.82, 0.84, 0.87),
  soft: rgb(0.95, 0.96, 0.97),
  warn: rgb(0.72, 0.29, 0.0),
  white: rgb(1, 1, 1),
};

// WinAnsi-Zeichen, die die Standardschrift (Helvetica) darstellen kann
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const REPLACE: Record<string, string> = {
  '→': '->', '←': '<-', '↑': '^', '↓': 'v', '≈': '~', '≤': '<=', '≥': '>=', '✕': 'x', '✓': 'OK', '♣': '', '⚡': '',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '‐': '-', '‑': '-', '″': '"', '′': "'",
};

/** Text auf darstellbare Zeichen reduzieren (sonst bricht pdf-lib ab). */
export function san(s: string): string {
  let out = '';
  for (const ch of s.replace(/\t/g, ' ')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (REPLACE[ch] !== undefined) out += REPLACE[ch];
    else if (/\p{Extended_Pictographic}/u.test(ch) || code === 0xfe0f) continue;
    else out += '?';
  }
  return out;
}

export interface TextOpts {
  size?: number;
  font?: PDFFont;
  color?: RGB;
  x?: number;
  width?: number;
  lineGap?: number;
  after?: number;
}

type Background = { kind: 'page'; page: PDFEmbeddedPage } | { kind: 'image'; img: PDFImage } | null;

export class Layout {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  font!: PDFFont;
  bold!: PDFFont;
  oblique!: PDFFont;
  accent: RGB;
  private bgCover: Background = null;
  private bgFollow: Background = null;
  coverIndex = new Set<number>();

  constructor(public doc: PDFDocument, public tpl: PdfTemplate) {
    this.accent = hex(tpl.accentColor || '#1F4E79');
  }

  async init(templateBytes: ArrayBuffer | null, templateMime: string) {
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.oblique = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    if (!templateBytes || this.tpl.kind === 'standard') return;
    if (this.tpl.kind === 'pdf') {
      let src: PDFDocument;
      try {
        src = await PDFDocument.load(templateBytes);
      } catch (e) {
        if (String(e).includes('encrypted')) throw new Error('Die PDF-Vorlage ist verschlüsselt/geschützt und kann nicht als Hintergrund verwendet werden. Bitte eine ungeschützte PDF hochladen.');
        throw new Error('Die PDF-Vorlage konnte nicht gelesen werden.');
      }
      const n = src.getPageCount();
      const ci = Math.min(this.tpl.coverPage, n - 1);
      const fi = Math.min(this.tpl.followPage, n - 1);
      const [cover, follow] = await this.doc.embedPdf(src, [ci, fi]);
      this.bgCover = { kind: 'page', page: cover };
      this.bgFollow = { kind: 'page', page: follow };
    } else {
      const bytes = new Uint8Array(templateBytes);
      const img = templateMime.includes('png') ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      this.bgCover = this.bgFollow = { kind: 'image', img };
    }
  }

  get pageW() { return this.page.getWidth(); }
  get pageH() { return this.page.getHeight(); }
  get left() { return this.tpl.margins.left * MM; }
  get right() { return this.pageW - this.tpl.margins.right * MM; }
  get width() { return this.right - this.left; }
  get top() { return this.pageH - this.tpl.margins.top * MM; }
  get bottom() { return this.tpl.margins.bottom * MM; }

  newPage(cover = false) {
    const bg = cover ? this.bgCover : this.bgFollow;
    let size: [number, number] = A4;
    if (bg?.kind === 'page') size = [bg.page.width, bg.page.height];
    this.page = this.doc.addPage(size);
    if (bg?.kind === 'page') this.page.drawPage(bg.page, { x: 0, y: 0, width: size[0], height: size[1] });
    if (bg?.kind === 'image') this.page.drawImage(bg.img, { x: 0, y: 0, width: size[0], height: size[1] });
    if (cover) this.coverIndex.add(this.pages.length);
    this.pages.push(this.page);
    this.y = this.top;
  }

  /** Seitenumbruch, wenn weniger als h pt Platz bleiben */
  ensure(h: number) {
    if (this.y - h < this.bottom) this.newPage(false);
  }

  space(h: number) {
    this.y -= h;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of san(text).split('\n')) {
      if (!para.trim()) { lines.push(''); continue; }
      let line = '';
      for (const word of para.split(/ +/)) {
        const cand = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(cand, size) <= width) { line = cand; continue; }
        if (line) lines.push(line);
        // sehr lange Wörter hart umbrechen
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Fließtext mit Umbruch über Seitengrenzen hinweg */
  text(str: string, o: TextOpts = {}) {
    if (!str) return;
    const size = o.size ?? 9.5;
    const font = o.font ?? this.font;
    const x = o.x ?? this.left;
    const width = o.width ?? this.right - x;
    const lh = size * 1.32 + (o.lineGap ?? 0);
    for (const line of this.wrap(str, font, size, width)) {
      this.ensure(lh);
      this.y -= lh;
      if (line) this.page.drawText(line, { x, y: this.y + size * 0.28, size, font, color: o.color ?? C.text });
    }
    this.y -= o.after ?? 0;
  }

  textHeight(str: string, size: number, font: PDFFont, width: number): number {
    return this.wrap(str, font, size, width).length * size * 1.32;
  }

  /** einzeilig an fester Position (Kopf-/Fußzeilen, Tabellen) */
  at(str: string, x: number, y: number, size: number, font: PDFFont = this.font, color: RGB = C.text, maxW?: number, align: 'left' | 'right' | 'center' = 'left') {
    let s = san(str).replace(/\n/g, ' ');
    if (maxW) while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -2) + '…';
    const w = font.widthOfTextAtSize(s, size);
    const dx = align === 'right' ? -w : align === 'center' ? -w / 2 : 0;
    this.page.drawText(s, { x: x + dx, y, size, font, color });
  }

  heading(str: string, level: 1 | 2 = 1) {
    const size = level === 1 ? 15 : 11.5;
    this.ensure(size * 3.2);
    if (this.y < this.top - 4) this.y -= level === 1 ? 12 : 8;
    this.y -= size * 1.25;
    this.at(str, this.left, this.y, size, this.bold, level === 1 ? this.accent : C.text);
    this.y -= level === 1 ? 6 : 4;
    if (level === 1) {
      this.page.drawRectangle({ x: this.left, y: this.y, width: 36, height: 2.2, color: this.accent });
      this.y -= 10;
    }
  }

  hr(color = C.line) {
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.right, y: this.y }, thickness: 0.6, color });
  }

  /** Label-Wert-Tabelle (zweispaltig) */
  kv(rows: [string, string][], labelW = 120, size = 9.5) {
    for (const [k, v] of rows) {
      if (!v) continue;
      const lines = this.wrap(v, this.font, size, this.width - labelW);
      const h = lines.length * size * 1.32 + 6;
      this.ensure(h);
      const top = this.y;
      this.at(k, this.left, top - size * 1.1, size - 0.5, this.font, C.muted);
      let yy = top;
      for (const l of lines) {
        yy -= size * 1.32;
        this.at(l, this.left + labelW, yy + size * 0.28, size, this.font, C.text);
      }
      this.y = top - h;
      this.page.drawLine({ start: { x: this.left, y: this.y + 2 }, end: { x: this.right, y: this.y + 2 }, thickness: 0.4, color: C.line });
    }
  }
}
