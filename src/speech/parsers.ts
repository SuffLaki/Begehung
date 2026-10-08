// Regelbasierte Auswertung von Sprache/Text – funktioniert offline und ohne KI.
// Grundsatz: Es wird nur übernommen, was wörtlich im Text steht. Was fehlt,
// bleibt leer (z. B. Entfernung unbekannt → Punkt wird nicht platziert).

import type { Inspection, LatLng, LineType, RoutePoint } from '../model/types';
import { activeSegment, addRoutePoint, headingInto, newEmptySegment, segmentEndingAt, branchFrom } from '../geo/routeOps';
import { lineTypeOf, matchLineTypes } from '../annotate/lines';
import { destination, compass } from '../geo/geo';

export type Direction = 'N' | 'NO' | 'O' | 'SO' | 'S' | 'SW' | 'W' | 'NW';
export type Turn = 'left' | 'right' | 'halfleft' | 'halfright' | 'straight' | 'back';

export interface RouteLeg {
  id: string;
  /** Originaltext dieses Abschnitts */
  text: string;
  direction: Direction | null;
  turn: Turn | null;
  distanceM: number | null;
  approx: boolean;
  /** Ziel / Wegmarke („bis zum Graben“) */
  landmark: string;
  /** Verlauf entlang … („entlang des Feldweges“) */
  along: string;
  note: string;
  /** Linienart (Farbe), z. B. „tiefbau“ – aus Schlüsselwort oder vom vorigen Abschnitt übernommen */
  lineType?: string | null;
  lineWord?: string;
}

export const DIRECTION_DEG: Record<Direction, number> = { N: 0, NO: 45, O: 90, SO: 135, S: 180, SW: 225, W: 270, NW: 315 };
export const DIRECTION_LABEL: Record<Direction, string> = {
  N: 'Norden', NO: 'Nordosten', O: 'Osten', SO: 'Südosten', S: 'Süden', SW: 'Südwesten', W: 'Westen', NW: 'Nordwesten',
};
export const TURN_LABEL: Record<Turn, string> = {
  left: 'links', right: 'rechts', halfleft: 'halb links', halfright: 'halb rechts', straight: 'geradeaus', back: 'zurück',
};
const TURN_DEG: Record<Turn, number> = { left: -90, right: 90, halfleft: -45, halfright: 45, straight: 0, back: 180 };

// ---------------------------------------------------------------- Zahlen

const ONES: Record<string, number> = {
  ein: 1, eins: 1, einen: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
  zehn: 10, elf: 11, zwölf: 12, zwoelf: 12, fünfzehn: 15, zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40,
  fünfzig: 50, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90, hundert: 100, einhundert: 100,
  zweihundert: 200, dreihundert: 300, vierhundert: 400, fünfhundert: 500, tausend: 1000, eintausend: 1000,
};

/** ersetzt einfache Zahlwörter („dreißig Meter“) durch Ziffern */
export function wordsToDigits(text: string): string {
  return text.replace(/\b([a-zäöüß]+?)und([a-zäöüß]+)\b/gi, (m, a: string, b: string) => {
    const x = ONES[a.toLowerCase()];
    const y = ONES[b.toLowerCase()];
    return x && y && x < 10 && y >= 20 && y < 100 ? String(x + y) : m;
  }).replace(/\b[a-zäöüß]+\b/gi, (w) => {
    const v = ONES[w.toLowerCase()];
    // „ein/eine“ nur vor Einheiten als Zahl lesen
    if (v === undefined || ['ein', 'eine', 'einen'].includes(w.toLowerCase())) return w;
    return String(v);
  });
}

/** alle Zahlen, die im Text vorkommen (zum Abgleich von KI-Ergebnissen) */
export function numbersIn(text: string): number[] {
  return [...wordsToDigits(text).matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => parseFloat(m[0].replace(',', '.')));
}

// ---------------------------------------------------------------- Trasse

/** Abkürzungspunkte entfernen, damit „ca. 30 m“ nicht als Satzende zählt */
export function stripAbbrevDots(text: string): string {
  return text.replace(/\b(ca|bzw|evtl|ggf|inkl|nr|str|st|stat|max|min|z\.\s?b|u\.\s?a|d\.\s?h)\./gi, (m) => m.replace(/\./g, ''));
}

const CONNECTORS = /\s*(?:[.;]|,?\s*\b(?:und\s+)?(?:dann|danach|anschließend|anschliessend|daraufhin|von dort(?:\s+aus)?|ab dort|weiter(?=\s+(?:nach|für|ca|etwa|ungefähr|rund|\d)))\b)\s*/i;

function parseDirection(t: string): Direction | null {
  const comp = t.match(/\b(nord|süd|sued)\s*-?\s*(ost|west)(?:en|lich|lichen|liche|licher)?\b/i);
  if (comp) {
    const ns = comp[1].toLowerCase().startsWith('n') ? 'N' : 'S';
    const ew = comp[2].toLowerCase() === 'ost' ? 'O' : 'W';
    return (ns + ew) as Direction;
  }
  if (/\b(norden|nördlich\w*|noerdlich\w*|richtung nord)\b/i.test(t)) return 'N';
  if (/\b(süden|sueden|südlich\w*|suedlich\w*|richtung süd)\b/i.test(t)) return 'S';
  if (/(?<![\p{L}])(osten|östlich\p{L}*|oestlich\p{L}*|richtung ost)(?![\p{L}])/iu.test(t)) return 'O';
  if (/\b(westen|westlich\w*|richtung west)\b/i.test(t)) return 'W';
  return null;
}

function parseTurn(t: string): Turn | null {
  if (/\bhalb\s*links\b|\bhalblinks\b|leicht links/i.test(t)) return 'halfleft';
  if (/\bhalb\s*rechts\b|\bhalbrechts\b|leicht rechts/i.test(t)) return 'halfright';
  if (/\b(nach\s+)?links\b|\blinks(ab|herum)\b/i.test(t)) return 'left';
  if (/\b(nach\s+)?rechts\b|\brechts(ab|herum)\b/i.test(t)) return 'right';
  if (/\bgeradeaus\b|\bweiter gerade\b|\bgerade weiter\b/i.test(t)) return 'straight';
  if (/\bzurück\b|\bumdrehen\b|\bkehrt\b/i.test(t)) return 'back';
  return null;
}

function parseDistance(t: string): { m: number | null; approx: boolean } {
  const approx = /\b(ungefähr|ungefaehr|etwa|ca\.?|circa|zirka|rund|knapp|gut|grob|geschätzt)\b/i.test(t);
  const km = t.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kilometer)\b/i);
  if (km) return { m: parseFloat(km[1].replace(',', '.')) * 1000, approx };
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|meter|metern|metre)\b/i);
  if (m) return { m: parseFloat(m[1].replace(',', '.')), approx };
  return { m: null, approx };
}

const ARTICLE = '(?:zum|zur|zu\\s+(?:dem|der|den)|an\\s+(?:den|die|das)|ans|vor\\s+(?:den|die|das)|in\\s+(?:den|die|das)|ins|auf\\s+(?:den|die|das))';

function cap(s: string): string {
  s = s.trim().replace(/[,.]+$/, '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function parseLandmark(t: string): string {
  const m = t.match(new RegExp(`\\bbis\\s+${ARTICLE}?\\s*(.+?)(?:\\s*,|$)`, 'i'));
  if (m) return cap(m[1].replace(/\b(für|ca|etwa|ungefähr)\b.*$/i, ''));
  return '';
}

function parseAlong(t: string): string {
  const a = t.match(/\bentlang\s+(?:des|der|dem|den)\s+([\wäöüß-]+(?:\s+[\wäöüß-]+)?)/i);
  if (a) return cap(a[1].replace(/\s+(für|ca|etwa|ungefähr|bis|nach)$/i, '').replace(/\s+(für|ca|etwa|ungefähr|bis|nach)\b.*$/i, ''));
  const b = t.match(/\b(?:am|an\s+der|an\s+dem|dem|der|den)\s+([\wäöüß-]+)\s+entlang\b/i);
  if (b) return cap(b[1]);
  return '';
}

/** „Vom Startpunkt …“ → Beschreibung bezieht sich auf den Start der Trasse */
export function refersToStart(text: string): boolean {
  return /^\s*(?:vom|ab(?:\s+dem)?|von\s+dem)\s+(?:startpunkt|start|anfang|ausgangspunkt)\b/i.test(text);
}

let legSeq = 0;

export function parseRouteText(input: string, types: LineType[] = []): RouteLeg[] {
  const text = stripAbbrevDots(wordsToDigits(input.replace(/\s+/g, ' ').trim()));
  if (!text) return [];
  const chunks = text.split(CONNECTORS).map((c) => c.trim()).filter((c) => c.length > 1);
  const legs: RouteLeg[] = [];
  let lastType: { key: string; word: string } | null = null;
  for (const chunk of chunks) {
    const lt = matchLineTypes(chunk, types)[0];
    if (lt) lastType = { key: lt.type.key, word: lt.word };
    const clean = chunk.replace(/^(vom|von\s+(?:dem|der))\s+(startpunkt|start|anfang|ausgangspunkt)\s*/i, '');
    const dist = parseDistance(clean);
    const leg: RouteLeg = {
      id: `leg${++legSeq}`,
      text: chunk,
      direction: parseDirection(clean),
      turn: parseTurn(clean),
      distanceM: dist.m,
      approx: dist.approx,
      landmark: parseLandmark(clean),
      along: parseAlong(clean),
      note: '',
      lineType: lastType?.key ?? null,
      lineWord: lastType?.word ?? '',
    };
    // Bruchstücke ohne jede verwertbare Angabe an den vorigen Abschnitt hängen
    const empty = !leg.direction && !leg.turn && leg.distanceM === null && !leg.landmark && !leg.along;
    if (empty && legs.length) {
      const prev = legs[legs.length - 1];
      prev.text += ', ' + chunk;
      prev.note = cap((prev.note ? prev.note + '; ' : '') + chunk);
      continue;
    }
    if (empty) leg.note = cap(chunk);
    legs.push(leg);
  }
  return legs;
}

/** Linienart je Abschnitt aus dem Originaltext bestimmen (z. B. nach KI-Auswertung) */
export function assignLineTypes(legs: RouteLeg[], types: LineType[]): RouteLeg[] {
  let last: { key: string; word: string } | null = null;
  return legs.map((l) => {
    const m = matchLineTypes(l.text, types)[0];
    if (m) last = { key: m.type.key, word: m.word };
    return { ...l, lineType: last?.key ?? null, lineWord: last?.word ?? '' };
  });
}

export function legSummary(l: RouteLeg): string {
  const parts: string[] = [];
  if (l.turn) parts.push(TURN_LABEL[l.turn]);
  if (l.direction) parts.push('nach ' + DIRECTION_LABEL[l.direction]);
  if (l.distanceM !== null) parts.push(`${l.approx ? 'ca. ' : ''}${Math.round(l.distanceM)} m`);
  if (l.along) parts.push('entlang ' + l.along);
  if (l.landmark) parts.push('bis ' + l.landmark);
  return parts.join(' · ') || l.note || l.text;
}

export interface ApplyResult {
  created: RoutePoint[];
  unplaced: number;
}

/**
 * Wandelt die Abschnitte in Trassenpunkte um. Alle Punkte sind
 * „automatisch ermittelt“ (confirmed = false). Kann eine Position nicht
 * berechnet werden (Richtung oder Entfernung fehlt), wird der Punkt ohne
 * Position angelegt – ebenso alle folgenden, weil der Bezug fehlt.
 */
export function applyLegs(d: Inspection, legs: RouteLeg[], startPointId: string | null, startFix: LatLng | null, types: LineType[] = []): ApplyResult {
  const created: RoutePoint[] = [];
  let unplaced = 0;
  let prevPos: LatLng | null = null;
  let prevId: string | null = null;
  let heading: number | null = null;

  if (startPointId) {
    const sp = d.route.points.find((p) => p.id === startPointId);
    prevPos = sp?.position ?? null;
    prevId = startPointId;
    heading = headingInto(d, startPointId);
    // am gewählten Punkt weiterzeichnen: passender Abschnitt oder Abzweig
    const seg = segmentEndingAt(d, startPointId) ?? branchFrom(d, startPointId);
    d.activeSegmentId = seg.id;
  } else if (startFix) {
    const sp = addRoutePoint(d, startFix, { source: 'gps', title: 'Startpunkt (GPS)', planId: null });
    created.push(sp);
    prevPos = startFix;
    prevId = sp.id;
  }

  for (const l of legs) {
    // Wechsel der Linienart (z. B. Tiefbau → Leerrohr) = neuer, farbiger Abschnitt ab dem letzten Punkt
    if (l.lineType) {
      const seg = activeSegment(d);
      if (seg.lineType !== l.lineType) {
        const t = lineTypeOf(types, l.lineType);
        const target = seg.pointIds.length > (prevId && seg.pointIds[0] === prevId ? 1 : 0) ? newEmptySegment(d) : seg;
        if (target !== seg && prevId) target.pointIds.push(prevId);
        target.color = t.color;
        target.lineType = t.key;
        target.name = `${l.lineWord || t.label} ${d.route.segments.filter((s) => s.lineType === t.key).length}`;
      }
    }
    let bear: number | null = null;
    if (l.direction) bear = DIRECTION_DEG[l.direction];
    else if (l.turn && heading !== null) bear = (heading + TURN_DEG[l.turn] + 360) % 360;
    else if (!l.turn && heading !== null && l.distanceM !== null) bear = heading; // „weiter 50 m“

    const canPlace = prevPos !== null && bear !== null && l.distanceM !== null;
    const pos = canPlace ? destination(prevPos!, bear!, l.distanceM!) : null;
    if (!pos) unplaced++;

    const why: string[] = [];
    if (bear === null) why.push(l.turn ? 'Abbiegerichtung ohne bekannte Laufrichtung' : 'keine Richtung genannt');
    if (l.distanceM === null) why.push('keine Entfernung genannt');
    if (prevPos === null) why.push('vorheriger Punkt ohne Position');

    const desc = [
      l.along ? `Verlauf entlang ${l.along} – Linie nur schematisch.` : '',
      l.note,
      pos ? `Lage aus Sprachbeschreibung geschätzt (${legSummary(l)}${bear !== null ? `, Richtung ${compass(bear)}` : ''}).` : `Nicht platziert: ${why.join(', ')}. Bitte auf der Karte setzen.`,
    ].filter(Boolean).join('\n');

    const p = addRoutePoint(d, pos, {
      source: 'voice',
      confirmed: false,
      title: l.landmark || (l.distanceM !== null ? `${l.approx ? 'ca. ' : ''}${Math.round(l.distanceM)} m` : 'Wegpunkt'),
    });
    p.description = desc;
    p.estimate = { text: l.text, fromPointId: prevId, bearingDeg: bear, distanceM: l.distanceM };
    if (l.landmark) p.category = '';
    created.push(p);

    prevPos = pos;
    prevId = p.id;
    if (bear !== null) heading = bear;
  }
  return { created, unplaced };
}

// ---------------------------------------------------------------- Beobachtung

export interface NoteDraft {
  title: string;
  station: string;
  category: string;
  description: string;
  hint: string;
}

const HINT_WORDS = /\b(muss|müssen|muesste|müsste|sollte|sollten|prüfen|pruefen|klären|klaeren|wahrscheinlich|vermutlich|eventuell|evtl|ggf|gegebenenfalls|achtung|beachten|abstimmen|nachfragen)\b/i;

export function parseStation(text: string): string {
  const t = wordsToDigits(text);
  const km = t.match(/\b(?:station|stat\.?|km)\s*(\d+\s*[+,.]\s*\d+|\d+)/i);
  return km ? km[1].replace(/\s+/g, '') : '';
}

export function parseObservation(input: string, categories: string[]): NoteDraft {
  const text = stripAbbrevDots(input.replace(/\s+/g, ' ').trim());
  const lower = text.toLowerCase();
  const station = parseStation(text);
  // längste passende Kategorie zuerst („Wirtschaftsweg“ vor „Weg“)
  const sorted = [...categories].sort((a, b) => b.length - a.length);
  let category = '';
  for (const c of sorted) {
    const stems = c.toLowerCase().split('/').map((s) => s.trim()).filter((s) => s.length >= 3);
    if (stems.some((s) => lower.includes(s))) { category = c; break; }
  }
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const hintSentences = sentences.filter((s) => HINT_WORDS.test(s));
  const descSentences = sentences.filter((s) => !HINT_WORDS.test(s));
  const description = cap((descSentences.length ? descSentences : sentences).join(' '));
  const titleBase = category || (descSentences[0] ?? sentences[0] ?? '').split(/[,.]/)[0].slice(0, 50);
  return {
    title: cap(titleBase),
    station,
    category,
    description,
    hint: cap(hintSentences.join(' ')),
  };
}
