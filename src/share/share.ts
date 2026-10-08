// Teilen & E-Mail.
//
// Web-Apps können unter iOS keine E-Mail mit Anhang direkt versenden:
// mailto: kennt keine Anhänge. Deshalb:
//  1. „Teilen“ öffnet das iOS-Teilen-Menü mit der PDF (Web Share API, iOS 15+).
//     Dort „Mail“ wählen → Mail öffnet sich mit PDF-Anhang und Nachrichtentext.
//     Empfänger werden vorher in die Zwischenablage kopiert (in Mail einfügen).
//  2. Alternativ: mailto-Entwurf mit Empfänger/CC/Betreff/Text, aber ohne Anhang.

import type { Inspection, MailDefaults } from '../model/types';
import { formatDate } from '../pdf/generator';

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded';

export function canShareFiles(): boolean {
  try {
    const f = new File([new Blob(['x'], { type: 'application/pdf' })], 'test.pdf', { type: 'application/pdf' });
    return !!navigator.canShare?.({ files: [f] });
  } catch {
    return false;
  }
}

/** Muss direkt in einem Klick-Handler aufgerufen werden (kein await davor!). */
export async function shareFile(blob: Blob, fileName: string, opts: { title?: string; text?: string } = {}): Promise<ShareOutcome> {
  const file = new File([blob], fileName, { type: blob.type || 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opts.title, text: opts.text });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
      throw new Error('Teilen nicht möglich: ' + ((e as Error).message || e));
    }
  }
  download(blob, fileName);
  return 'downloaded';
}

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function fillTemplate(tpl: string, insp: Inspection): string {
  return tpl
    .replace(/\{projekt\}/g, insp.meta.projectName || '')
    .replace(/\{nummer\}/g, insp.meta.projectNumber || '')
    .replace(/\{datum\}/g, formatDate(insp.meta.date))
    .replace(/\{begeher\}/g, insp.meta.inspector || '')
    .replace(/\{auftraggeber\}/g, insp.meta.client || '');
}

export function mailDraft(defaults: MailDefaults, insp: Inspection): MailDefaults {
  return {
    to: defaults.to,
    cc: defaults.cc,
    subject: fillTemplate(defaults.subject, insp),
    body: fillTemplate(defaults.body, insp),
  };
}

export function mailtoUrl(m: MailDefaults): string {
  const q: string[] = [];
  if (m.cc) q.push('cc=' + encodeURIComponent(m.cc));
  if (m.subject) q.push('subject=' + encodeURIComponent(m.subject));
  if (m.body) q.push('body=' + encodeURIComponent(m.body + '\n\n(PDF bitte anhängen)'));
  return `mailto:${encodeURIComponent(m.to).replace(/%40/g, '@').replace(/%2C/gi, ',')}?${q.join('&')}`;
}

export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}
