// KI-Schnittstelle. Die App spricht nur mit diesem Modul – welcher Anbieter
// dahinter steckt, entscheidet die Einstellung. Neuer Anbieter = neue Klasse,
// die AiProvider implementiert, und ein Eintrag in getAi().
//
// Regeln für alle KI-Funktionen:
//  * Die KI strukturiert nur, sie erfindet nichts. Fehlende Angaben bleiben leer.
//  * Zahlen (Entfernungen, Stationen), die nicht im gesprochenen Text vorkommen,
//    werden nach der Antwort verworfen (siehe guard*-Funktionen).
//  * Ergebnisse sind Vorschläge und müssen vom Benutzer bestätigt werden.

import type { AiSettings, LineType } from '../model/types';
import { useApp } from '../state/appStore';
import { GeminiProvider } from './gemini';
import { numbersIn, type Direction, type NoteDraft, type RouteLeg, type Turn } from '../speech/parsers';

export interface AiProvider {
  /** Audio → wörtliche Abschrift + strukturierte Beobachtung */
  voiceNote(wav: Blob, categories: string[]): Promise<{ transcript: string; draft: NoteDraft }>;
  /** Text → strukturierte Beobachtung */
  structureNote(text: string, categories: string[]): Promise<NoteDraft>;
  /** Audio → Abschrift + Trassenabschnitte */
  voiceRoute(wav: Blob): Promise<{ transcript: string; legs: RouteLeg[] }>;
  /** Text → Trassenabschnitte */
  parseRoute(text: string): Promise<RouteLeg[]>;
  /** Foto → Beschreibungsvorschlag */
  describePhoto(jpeg: Blob, context: string): Promise<string>;
  /** Notizen → Zusammenfassung */
  summarize(material: string): Promise<string>;
  /** Audio → wörtliche Abschrift */
  transcribe(wav: Blob): Promise<string>;
  /** Foto + Anweisung → Linienvorschläge (normiert 0..1), nur für eindeutig sichtbare Elemente */
  suggestLines(jpeg: Blob, instruction: string, types: { key: string; label: string }[]): Promise<{ type: string; points: [number, number][] }[]>;
  test(): Promise<void>;
}

export class AiUnavailableError extends Error {}

export function aiConfigured(s: AiSettings = useApp.getState().settings.ai): boolean {
  return s.provider !== 'none' && !!s.apiKey.trim();
}

export function getAi(): AiProvider {
  const s = useApp.getState().settings.ai;
  if (!aiConfigured(s)) throw new AiUnavailableError('KI ist nicht eingerichtet (Einstellungen → KI-Assistent).');
  if (!navigator.onLine) throw new AiUnavailableError('Keine Internetverbindung – KI-Funktionen sind offline nicht verfügbar.');
  switch (s.provider) {
    case 'gemini':
      return new GeminiProvider(s.apiKey.trim(), s.model.trim() || 'gemini-3.5-flash-lite');
    default:
      throw new AiUnavailableError('Unbekannter KI-Anbieter.');
  }
}

/** Netzwerkfehler (Funkloch) von inhaltlichen Fehlern unterscheiden → Auftrag später wiederholen */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof AiUnavailableError && !navigator.onLine);
}

// ---------------------------------------------------------------- Prompts

export const RULES = `Du unterstützt einen Bauleiter bei einer Trassenbegehung (Leitungsbau, Tiefbau).
Strikte Regeln:
- Übernimm ausschließlich Informationen, die im Text/der Aufnahme ausdrücklich vorkommen.
- Erfinde keine technischen Fakten, Maße, Entfernungen, Stationen, Koordinaten oder Beobachtungen.
- Wenn eine Angabe fehlt, lass das Feld leer (bzw. null). Rate nicht.
- Schreibe sachlich, knapp, auf Deutsch, im Stil eines Begehungsprotokolls.`;

export const NOTE_PROMPT = (categories: string[]) => `${RULES}
Strukturiere die Beobachtung in folgende Felder:
- title: kurzer Titel (max. 6 Wörter) aus dem Gesagten
- station: Stationsangabe nur wenn genannt (z. B. "125" oder "0+125"), sonst ""
- category: genau eine passende aus dieser Liste, sonst "": ${categories.join(', ')}
- description: was beobachtet wurde, sachlich umformuliert, ohne neue Inhalte
- hint: nur wenn der Sprecher eine Vermutung, Aufgabe oder offene Frage äußert, als knapper Prüfhinweis (z. B. "Unterquerung prüfen"), sonst ""`;

export const ROUTE_PROMPT = `${RULES}
Zerlege die gesprochene Beschreibung eines Trassenverlaufs in aufeinanderfolgende Abschnitte (legs).
Pro Abschnitt:
- direction: Himmelsrichtung nur wenn genannt: N, NO, O, SO, S, SW, W, NW – sonst null
- turn: relative Richtung nur wenn genannt: left, right, halfleft, halfright, straight, back – sonst null
- distance_m: Entfernung in Metern nur wenn genannt, sonst null
- approx: true wenn die Entfernung als ungefähr bezeichnet wurde
- landmark: Ziel/Wegmarke am Ende des Abschnitts (z. B. "Graben"), sonst ""
- along: entlang welchem Objekt der Abschnitt verläuft (z. B. "Feldweg"), sonst ""
- note: weitere Bemerkungen zu diesem Abschnitt, sonst ""
- text: der zugehörige Originalwortlaut`;

export const PHOTO_PROMPT = `${RULES}
Beschreibe in 1–2 Sätzen sachlich, was auf dem Foto sichtbar ist (z. B. Wegeart, Bewuchs, Gewässer, Bauwerke, Leitungen, Masten, Schächte).
Nur Sichtbares beschreiben – keine Vermutungen über Maße, Eigentümer, Leitungsarten oder Ursachen.
Beginne mit "Auf dem Foto ist …" oder "Zu sehen ist …".`;

export const SUMMARY_PROMPT = `${RULES}
Fasse die folgenden Begehungsnotizen in einem kurzen Fließtext (max. 8 Sätze) zusammen.
Nenne wesentliche Beobachtungen und offene Punkte. Übernimm Stationen/Maße nur, wenn sie in den Notizen stehen.
Keine Empfehlungen oder Bewertungen hinzufügen, die nicht in den Notizen stehen.`;

export const LINES_PROMPT = (types: { key: string; label: string }[]) => `${RULES}
Du markierst auf einem Baustellenfoto den Verlauf von Elementen als Linie.
Linienarten (Feld "type"): ${types.map((t) => `"${t.key}" = ${t.label}`).join(', ')}.
Zeichne nur Linien für Elemente, die in der Anweisung genannt werden UND auf dem Foto eindeutig zu sehen sind
(z. B. Graben/Aufgrabung, sichtbares Rohr). Ist der Verlauf nicht erkennbar, gib für dieses Element keine Linie zurück.
Folgt die Anweisung einer Ortsangabe („entlang der Mauer“, „links am Weg“), orientiere dich daran.
Punkte: 2 bis 8 Punkte entlang des Verlaufs, x und y jeweils 0–1000 (0,0 = oben links).`;

/** KI-Linien prüfen: nur bekannte Arten, mind. 2 Punkte, Koordinaten begrenzen */
export function guardLines(raw: { type?: string; points?: { x?: number; y?: number }[] }[], types: Pick<LineType, 'key'>[]): { type: string; points: [number, number][] }[] {
  const keys = new Set(types.map((t) => t.key));
  return raw
    .filter((r) => r && keys.has(r.type ?? ''))
    .map((r) => ({
      type: r.type!,
      points: (r.points ?? [])
        .filter((p) => typeof p.x === 'number' && typeof p.y === 'number' && isFinite(p.x) && isFinite(p.y))
        .slice(0, 12)
        .map((p) => [Math.min(1, Math.max(0, p.x! / 1000)), Math.min(1, Math.max(0, p.y! / 1000))] as [number, number]),
    }))
    .filter((l) => l.points.length >= 2);
}

// ---------------------------------------------------------------- Prüfung der KI-Ergebnisse

const DIRS: Direction[] = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const TURNS: Turn[] = ['left', 'right', 'halfleft', 'halfright', 'straight', 'back'];

interface RawLeg {
  direction?: string | null; turn?: string | null; distance_m?: number | null; approx?: boolean;
  landmark?: string; along?: string; note?: string; text?: string;
}

/** Verwirft Entfernungen, die so nicht im Originaltext vorkommen. */
export function guardLegs(raw: RawLeg[], sourceText: string): RouteLeg[] {
  const nums = numbersIn(sourceText);
  const hasNumber = (n: number) => nums.some((x) => Math.abs(x - n) < 0.01 || Math.abs(x * 1000 - n) < 0.5);
  return raw.map((r, i) => {
    let dist = typeof r.distance_m === 'number' && isFinite(r.distance_m) && r.distance_m > 0 ? r.distance_m : null;
    let note = (r.note ?? '').trim();
    if (dist !== null && !hasNumber(dist)) {
      note = [note, `KI-Entfernung ${dist} m verworfen (nicht im Text genannt)`].filter(Boolean).join('; ');
      dist = null;
    }
    const dir = (r.direction ?? '').toUpperCase().replace('E', 'O') as Direction;
    const turn = (r.turn ?? '') as Turn;
    return {
      id: `ai${Date.now()}${i}`,
      text: (r.text ?? '').trim(),
      direction: DIRS.includes(dir) ? dir : null,
      turn: TURNS.includes(turn) ? turn : null,
      distanceM: dist,
      approx: !!r.approx,
      landmark: (r.landmark ?? '').trim(),
      along: (r.along ?? '').trim(),
      note,
    };
  });
}

/** Station nur übernehmen, wenn die Zahl im Text vorkommt; Kategorie nur aus der Liste. */
export function guardNote(d: Partial<NoteDraft>, sourceText: string, categories: string[]): NoteDraft {
  const nums = numbersIn(sourceText);
  let station = (d.station ?? '').trim();
  if (station) {
    const stNums = numbersIn(station);
    if (!stNums.length || !stNums.every((n) => nums.includes(n))) station = '';
  }
  const category = categories.find((c) => c.toLowerCase() === (d.category ?? '').trim().toLowerCase()) ?? '';
  return {
    title: (d.title ?? '').trim(),
    station,
    category,
    description: (d.description ?? '').trim(),
    hint: (d.hint ?? '').trim(),
  };
}
