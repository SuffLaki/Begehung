// Erkennt Straßennamen, Hausnummern und Kreuzungen in gesprochenem/getipptem Text.
//
// Beispiel: „Tiefbau von der Hauptstraße 12 bis zur Kreuzung Bahnhofstraße,
//            dann Leerrohr entlang der Lindenstraße bis Hausnummer 40“
// → Stück 1: Tiefbau, von Adresse Hauptstraße 12, bis Kreuzung (Hauptstraße × Bahnhofstraße)
// → Stück 2: Leerrohr, ab Ende Stück 1, entlang Lindenstraße, bis Lindenstraße 40
//
// Es wird nur erkannt, was im Text steht. Die Koordinaten kommen danach aus
// OpenStreetMap (places/osm.ts) – nichts wird geraten.

import type { LineType } from '../model/types';
import { matchLineTypes } from '../annotate/lines';
import { stripAbbrevDots, wordsToDigits } from '../speech/parsers';

export type PlaceRef =
  | { kind: 'address'; street: string; number: string }
  | { kind: 'street'; street: string }
  | { kind: 'intersection'; a: string; b: string | null };

export interface PlacePiece {
  id: string;
  text: string;
  /** Linienart (Farbe), aus Schlüsselwort oder vom vorherigen Stück übernommen */
  lineType: string | null;
  lineWord: string;
  from: PlaceRef | null;
  to: PlaceRef | null;
  /** Straße, entlang der die Linie verläuft */
  along: string | null;
}

const SUFFIX = '(?:straße|strasse|str|weg|gasse|allee|platz|ring|damm|ufer|steige|steig|pfad|chaussee|markt|graben|berg|halde|anger|zeile|wall|brücke|tor|park|gärten|hof|feld|wiesen|acker|kamp)';
const PREFIX = '(?:Am|An der|An den|Auf der|Auf dem|Im|In der|In den|Zum|Zur|Hinter der|Hinter dem|Unter den|Untere|Obere|Alte|Neue|Große|Kleine|Lange|Hohe|Sankt|St)';
const CAP = '[A-ZÄÖÜ][\\p{L}-]*';

// „Hauptstraße“, „Karl-Benz-Straße“, „Neue Straße“, „Am Lindenhof“, „Ulmer Weg“
const STREET_SRC = `(?:${PREFIX}\\s+${CAP}(?:\\s+${CAP})?|${CAP}${SUFFIX}|${CAP}\\s+(?:Straße|Strasse|Weg|Gasse|Allee|Platz|Ring|Steige))`;
const NUMBER_SRC = '\\d{1,4}\\s?[a-zA-Z]?\\b';

/** Allgemeine Wörter, die wie Straßennamen aussehen, aber keine sind */
const GENERIC = new Set([
  'feldweg', 'wirtschaftsweg', 'gehweg', 'radweg', 'fußweg', 'fussweg', 'waldweg', 'weg', 'straße', 'strasse', 'graben',
  'feld', 'acker', 'berg', 'hof', 'park', 'platz', 'brücke', 'damm', 'ufer', 'wall', 'tor', 'wiesen', 'markt', 'bauhof',
  'parkplatz', 'spielplatz', 'sportplatz', 'friedhof', 'bahnhof', 'radwegbrücke', 'straßengraben', 'entwässerungsgraben',
  'grünstreifen', 'umspannwerk', 'betriebshof', 'innenhof',
]);

function cleanStreet(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
    .replace(/str\.?$/i, 'straße')
    .replace(/Strasse$/i, 'straße')
    .replace(/(\p{L})str$/iu, '$1straße');
}

const NOT_NAME = /^(kreuzung|ecke|einmündung|abzweigung|tiefbau|leerrohr|bestandsrohr|hausnummer|nummer|bis|von|ab|entlang|dann)\s/i;

function isGeneric(s: string): boolean {
  if (NOT_NAME.test(s)) return true;
  return GENERIC.has(s.toLowerCase().replace(/^(am|an der|im|zum|zur)\s+/i, ''));
}

/** alle Straßennamen im Text (Position, Name, ggf. Hausnummer direkt dahinter) */
function findStreets(t: string): { index: number; end: number; street: string; number: string }[] {
  const re = new RegExp(`(${STREET_SRC})(?:\\s+(?:Nr\\s*|Nummer\\s*)?(${NUMBER_SRC}))?`, 'gu');
  const out: { index: number; end: number; street: string; number: string }[] = [];
  for (const m of t.matchAll(re)) {
    const street = cleanStreet(m[1]);
    if (isGeneric(street)) continue;
    out.push({ index: m.index!, end: m.index! + m[0].length, street, number: (m[2] ?? '').replace(/\s+/g, '') });
  }
  return out;
}

export function hasPlaces(text: string): boolean {
  const t = prep(text);
  return findStreets(t).length > 0;
}

function prep(text: string): string {
  return stripAbbrevDots(wordsToDigits(text.replace(/\s+/g, ' ').trim()));
}

const SPLIT = /\s*(?:;|\.(?=\s|$)|,?\s*\b(?:und\s+)?(?:dann|danach|anschließend|anschliessend|daraufhin|von dort(?:\s+aus)?|ab dort)\b)\s*/i;

let seq = 0;

/** Zerlegt den Text in Stücke mit Linienart, Start, Ziel und Verlauf. */
export function parsePlaces(input: string, types: LineType[]): PlacePiece[] {
  const text = prep(input);
  const chunks = text.split(SPLIT).map((c) => c.trim()).filter((c) => c.length > 2);
  const pieces: PlacePiece[] = [];
  let lastType: { key: string; word: string } | null = null;
  let lastStreet: string | null = null;

  for (const chunk of chunks) {
    const lt = matchLineTypes(chunk, types)[0];
    if (lt) lastType = { key: lt.type.key, word: lt.word };
    const streets = findStreets(chunk);
    const piece: PlacePiece = { id: `pp${++seq}`, text: chunk, lineType: lastType?.key ?? null, lineWord: lastType?.word ?? '', from: null, to: null, along: null };

    // entlang / in / auf der X
    const alongRe = new RegExp(`(?:entlang\\s+(?:der|des|dem|den)\\s+|(?:die|der|den)\\s+)(${STREET_SRC})(?:\\s+entlang)?|(?:in|auf)\\s+der\\s+(${STREET_SRC})`, 'u');
    const am = chunk.match(alongRe);
    if (am && (/entlang/i.test(am[0]) || /^(in|auf)\s/i.test(am[0]))) {
      const s = cleanStreet(am[1] ?? am[2]);
      if (!isGeneric(s)) piece.along = s;
    }

    // Kreuzung / Ecke / Einmündung
    const kreuz = /\b(kreuzung|ecke|einmündung|abzweigung)\b/i.exec(chunk);
    const kreuzRef = (): PlaceRef | null => {
      if (!kreuz) return null;
      const after = streets.filter((s) => s.index > kreuz.index);
      if (after.length >= 2 && /\s*(?:\/|und|mit|x|×|-)\s*(?:der\s+)?$/i.test(chunk.slice(after[0].end, after[1].index))) {
        return { kind: 'intersection', a: after[0].street, b: after[1].street };
      }
      if (after.length >= 1) {
        const before = streets.filter((s) => s.index < kreuz.index).map((s) => s.street);
        const other = piece.along ?? before[before.length - 1] ?? lastStreet;
        return { kind: 'intersection', a: after[0].street, b: other && other !== after[0].street ? other : null };
      }
      return null;
    };

    // „bis …“ markiert das Ziel, „von/ab …“ den Start
    const bisIdx = chunk.search(/\bbis\b/i);
    const vonIdx = chunk.search(/\b(von|ab|vom)\b/i);
    const refAt = (from: number, to: number): PlaceRef | null => {
      if (kreuz && kreuz.index >= from && kreuz.index < to) return kreuzRef();
      const s = streets.find((x) => x.index >= from && x.index < to && x.street !== piece.along) ?? streets.find((x) => x.index >= from && x.index < to);
      if (s) return s.number ? { kind: 'address', street: s.street, number: s.number } : { kind: 'street', street: s.street };
      // „bis Hausnummer 40“ → Nummer in der aktuellen Straße
      const nr = chunk.slice(from, to).match(new RegExp(`\\b(?:hausnummer|nummer|nr)\\s*(${NUMBER_SRC})`, 'i'));
      const st = piece.along ?? lastStreet;
      if (nr && st) return { kind: 'address', street: st, number: nr[1].replace(/\s+/g, '') };
      return null;
    };

    if (bisIdx >= 0) {
      piece.to = refAt(bisIdx, chunk.length);
      if (vonIdx >= 0 && vonIdx < bisIdx) piece.from = refAt(vonIdx, bisIdx);
      else if (!piece.along || streets.some((s) => s.index < bisIdx && s.street !== piece.along)) piece.from = refAt(0, bisIdx);
    } else if (vonIdx >= 0) {
      piece.from = refAt(vonIdx, chunk.length);
    } else if (kreuz) {
      piece.to = kreuzRef();
    } else {
      // „Tiefbau Hauptstraße 12“ ohne von/bis → einzelner Ort
      const s = streets.find((x) => x.street !== piece.along);
      if (s) piece.to = s.number ? { kind: 'address', street: s.street, number: s.number } : { kind: 'street', street: s.street };
    }

    const mentioned = piece.along ?? (piece.to && piece.to.kind !== 'intersection' ? piece.to.street : null) ?? (piece.from && piece.from.kind !== 'intersection' ? piece.from.street : null);
    if (mentioned) lastStreet = mentioned;
    if (piece.from || piece.to || piece.along) pieces.push(piece);
  }
  return pieces;
}

export function placeLabel(p: PlaceRef | null): string {
  if (!p) return '';
  if (p.kind === 'address') return `${p.street} ${p.number}`;
  if (p.kind === 'street') return p.street;
  return p.b ? `Kreuzung ${p.a} / ${p.b}` : `Kreuzung ${p.a}`;
}

/** erster erkannter Ort im Text (für Foto-Linien) */
export function firstPlace(text: string, types: LineType[]): PlaceRef | null {
  const p = parsePlaces(text, types)[0];
  return p ? p.to ?? p.from ?? (p.along ? { kind: 'street', street: p.along } : null) : null;
}
