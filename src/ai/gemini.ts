// Google Gemini als KI-Anbieter (REST, direkt vom Gerät).
// Der API-Schlüssel wird in den Einstellungen eingetragen und nur lokal gespeichert.
// Hinweis: Beim kostenlosen Gemini-Kontingent darf Google die Eingaben zur
// Produktverbesserung verwenden – für vertrauliche Projektdaten ein
// kostenpflichtiges Konto verwenden (siehe Einstellungen).

import type { AiProvider } from './ai';
import { guardLegs, guardLines, guardNote, LINES_PROMPT, NOTE_PROMPT, PHOTO_PROMPT, ROUTE_PROMPT, SUMMARY_PROMPT } from './ai';
import { blobToBase64 } from '../speech/audioRecorder';
import type { NoteDraft, RouteLeg } from '../speech/parsers';

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

const NOTE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' }, station: { type: 'STRING' }, category: { type: 'STRING' },
    description: { type: 'STRING' }, hint: { type: 'STRING' },
  },
  required: ['title', 'station', 'category', 'description', 'hint'],
};

const LEG_SCHEMA = {
  type: 'OBJECT',
  properties: {
    direction: { type: 'STRING', nullable: true }, turn: { type: 'STRING', nullable: true },
    distance_m: { type: 'NUMBER', nullable: true }, approx: { type: 'BOOLEAN' },
    landmark: { type: 'STRING' }, along: { type: 'STRING' }, note: { type: 'STRING' }, text: { type: 'STRING' },
  },
  required: ['direction', 'turn', 'distance_m', 'approx', 'landmark', 'along', 'note', 'text'],
};

const TRANSCRIBE = 'Schreibe in "transcript" wortgetreu auf, was in der Aufnahme gesagt wird (leer, wenn nichts Verständliches gesagt wird). Werte anschließend NUR diese Abschrift aus.';

export class GeminiProvider implements AiProvider {
  private thinkingOff = true;
  constructor(private key: string, private model: string) {}

  private async call(parts: Part[], system: string, schema: object | null, maxTokens = 1200): Promise<string> {
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.1,
        ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
      },
    };
    const post = () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify(body),
    });
    const gc = body.generationConfig as Record<string, unknown>;
    if (this.thinkingOff) gc.thinkingConfig = { thinkingBudget: 0 };
    let res = await post();
    if (res.status === 400 && this.thinkingOff) {
      // manche Modelle kennen thinkingBudget 0 nicht
      this.thinkingOff = false;
      delete gc.thinkingConfig;
      res = await post();
    }
    if (!res.ok) throw new Error(errorText(res.status, await res.text(), this.model));
    const data = await res.json();
    const out = (data?.candidates?.[0]?.content?.parts ?? []) as { text?: string; thought?: boolean }[];
    const text = out.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (!text) throw new Error('Die KI hat keine Antwort geliefert.');
    return text;
  }

  private async json<T>(parts: Part[], system: string, schema: object): Promise<T> {
    const raw = await this.call(parts, system, schema);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error('Antwort der KI war nicht lesbar.');
    }
  }

  async voiceNote(wav: Blob, categories: string[]) {
    const schema = { type: 'OBJECT', properties: { transcript: { type: 'STRING' }, note: NOTE_SCHEMA }, required: ['transcript', 'note'] };
    const r = await this.json<{ transcript: string; note: Partial<NoteDraft> }>(
      [{ inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }, { text: TRANSCRIBE }],
      NOTE_PROMPT(categories), schema,
    );
    const transcript = (r.transcript ?? '').trim();
    return { transcript, draft: guardNote(r.note ?? {}, transcript, categories) };
  }

  async structureNote(text: string, categories: string[]) {
    const r = await this.json<Partial<NoteDraft>>([{ text }], NOTE_PROMPT(categories), NOTE_SCHEMA);
    return guardNote(r, text, categories);
  }

  async voiceRoute(wav: Blob) {
    const schema = { type: 'OBJECT', properties: { transcript: { type: 'STRING' }, legs: { type: 'ARRAY', items: LEG_SCHEMA } }, required: ['transcript', 'legs'] };
    const r = await this.json<{ transcript: string; legs: unknown[] }>(
      [{ inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }, { text: TRANSCRIBE }],
      ROUTE_PROMPT, schema,
    );
    const transcript = (r.transcript ?? '').trim();
    return { transcript, legs: guardLegs((r.legs ?? []) as never[], transcript) };
  }

  async parseRoute(text: string): Promise<RouteLeg[]> {
    const schema = { type: 'OBJECT', properties: { legs: { type: 'ARRAY', items: LEG_SCHEMA } }, required: ['legs'] };
    const r = await this.json<{ legs: unknown[] }>([{ text }], ROUTE_PROMPT, schema);
    return guardLegs((r.legs ?? []) as never[], text);
  }

  async describePhoto(jpeg: Blob, context: string) {
    return this.call(
      [{ inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(jpeg) } }, { text: context ? `Kontext (nur zur Einordnung, nicht als Fakt übernehmen): ${context}` : 'Beschreibe das Foto.' }],
      PHOTO_PROMPT, null, 300,
    );
  }

  async summarize(material: string) {
    return this.call([{ text: material }], SUMMARY_PROMPT, null, 900);
  }

  async transcribe(wav: Blob) {
    const r = await this.json<{ transcript: string }>(
      [{ inlineData: { mimeType: 'audio/wav', data: await blobToBase64(wav) } }, { text: TRANSCRIBE }],
      'Schreibe wortgetreu auf Deutsch ab, was gesagt wird. Nichts ergänzen.',
      { type: 'OBJECT', properties: { transcript: { type: 'STRING' } }, required: ['transcript'] },
    );
    return (r.transcript ?? '').trim();
  }

  async suggestLines(jpeg: Blob, instruction: string, types: { key: string; label: string }[]) {
    const schema = {
      type: 'OBJECT',
      properties: {
        lines: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING' },
              points: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] } },
            },
            required: ['type', 'points'],
          },
        },
      },
      required: ['lines'],
    };
    const r = await this.json<{ lines: { type?: string; points?: { x?: number; y?: number }[] }[] }>(
      [{ inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(jpeg) } }, { text: `Anweisung: ${instruction}` }],
      LINES_PROMPT(types), schema,
    );
    return guardLines(r.lines ?? [], types);
  }

  async test() {
    await this.call([{ text: 'Antworte nur mit OK.' }], 'Antworte knapp.', null, 10);
  }
}

function errorText(status: number, body: string, model: string): string {
  let msg = '';
  try { msg = JSON.parse(body).error.message; } catch { msg = body.slice(0, 160); }
  if (status === 429) return 'KI-Kontingent erschöpft (zu viele Anfragen). Später erneut versuchen.';
  if (/API key/i.test(msg) || status === 401 || status === 403) return 'KI-Schlüssel ungültig – bitte in den Einstellungen prüfen.';
  if (status === 404) return `KI-Modell „${model}“ nicht gefunden – bitte in den Einstellungen prüfen.`;
  if (status === 503) return 'Der KI-Dienst ist gerade überlastet. Bitte gleich nochmal versuchen.';
  return `KI-Fehler ${status}: ${msg}`;
}
