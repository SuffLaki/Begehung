// Spracheingabe für Beobachtungen und Trassenverlauf.
//
// Wege zum Text:
//  a) Aufnahme-Taste → WAV → KI (Abschrift + Strukturierung in einem Schritt).
//     Offline: Aufnahme wird gespeichert und später automatisch ausgewertet.
//  b) Diktierfunktion der iPhone-Tastatur ins Textfeld (funktioniert auch ohne KI,
//     auf neueren iPhones sogar offline) → lokale Auswertung oder KI.
// Ergebnis ist immer ein editierbarer Vorschlag; nichts wird ungefragt übernommen.

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Sparkles, Wand2, MapPinned, Info, Trash2 } from 'lucide-react';
import { useInspection } from '../../state/inspectionStore';
import { useApp, toast, errorText } from '../../state/appStore';
import { WavRecorder, ensureMicConsent, micSupported } from '../../speech/audioRecorder';
import {
  applyLegs, assignLineTypes, legSummary, parseObservation, parseRouteText, refersToStart, DIRECTION_LABEL, TURN_LABEL,
  type Direction, type NoteDraft, type RouteLeg, type Turn,
} from '../../speech/parsers';
import { aiConfigured, getAi, isNetworkError } from '../../ai/ai';
import { queueVoiceJob } from '../../sync/jobs';
import { newNote, pointDisplayName } from '../../model/factory';
import { activeSegment, newEmptySegment } from '../../geo/routeOps';
import { fixIfAvailable, currentFix } from '../../geo/gps';
import { nearestPoint } from '../../geo/geo';
import { Banner, Field, Seg, SelectField, Sheet, Spinner, SwitchRow, fmtDuration } from '../../ui/kit';
import { useUi, type VoiceMode } from './actions';
import { navigate } from '../../router';
import type { GeoFix, LineType } from '../../model/types';
import { hasPlaces, parsePlaces, placeLabel } from '../../places/placeParser';
import { applyResolved, resolvePieces, type ResolvedPiece } from '../../places/resolve';
import { lineTypeOf } from '../../annotate/lines';

type Phase = 'input' | 'recording' | 'processing' | 'result';

export default function VoiceSheet() {
  const voice = useUi((s) => s.voice);
  if (!voice) return null;
  return <VoiceSheetInner key={`${voice.mode}-${voice.text ?? ''}`} initialMode={voice.mode} initialText={voice.text ?? ''} />;
}

function VoiceSheetInner({ initialMode, initialText }: { initialMode: VoiceMode; initialText: string }) {
  const insp = useInspection((s) => s.insp)!;
  const settings = useApp((s) => s.settings);
  const online = useApp((s) => s.online);
  const [mode, setMode] = useState<VoiceMode>(initialMode);
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState(initialText);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [via, setVia] = useState<'ai' | 'local'>('local');
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [pointId, setPointId] = useState<string>('');
  const [startRef, setStartRef] = useState<string>('');
  const [places, setPlaces] = useState<ResolvedPiece[] | null>(null);
  const [placeError, setPlaceError] = useState('');
  const [progress, setProgress] = useState('');
  const [followStreets, setFollowStreets] = useState(true);
  const [preferLegs, setPreferLegs] = useState(false);
  const types = settings.lineTypes;
  const rec = useRef<WavRecorder | null>(null);
  const audioUsed = useRef(false);

  const aiReady = aiConfigured(settings.ai);
  const audioAllowed = aiReady && settings.ai.allowAudio;
  const canRecord = micSupported() && audioAllowed;

  useEffect(() => {
    void fixIfAvailable().then((f) => {
      setFix(f);
      if (f) {
        const near = nearestPoint(insp.route.points, f, 30);
        if (near) setPointId(near.id);
      }
    });
    // Standard-Startpunkt für Trassenbeschreibung: Ende des aktiven Abschnitts
    const seg = insp.route.segments.find((s) => s.id === insp.activeSegmentId) ?? insp.route.segments[0];
    const lastId = seg?.pointIds[seg.pointIds.length - 1];
    const last = lastId ? insp.route.points.find((p) => p.id === lastId) : null;
    setStartRef(last?.position ? last.id : 'gps');
    return () => rec.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    rec.current?.cancel();
    useUi.getState().set({ voice: null });
  }

  async function startRec() {
    if (!(await ensureMicConsent())) return;
    const r = new WavRecorder();
    r.onLevel = (l, s) => { setLevel(l); setSecs(s); };
    r.onLimit = () => void stopRec();
    try {
      await r.start();
      rec.current = r;
      setPhase('recording');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function stopRec() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    const { wav, seconds } = await r.stop();
    if (seconds < 0.8) { setPhase('input'); toast('Aufnahme zu kurz.', 'error'); return; }
    audioUsed.current = true;
    if (!navigator.onLine) {
      await queueVoiceJob(insp.id, mode === 'note' ? 'voice-note' : 'voice-route', wav, seconds);
      toast('Offline: Aufnahme gespeichert. Sie wird ausgewertet, sobald Internet da ist, und erscheint dann unter Notizen.', 'success');
      close();
      return;
    }
    setPhase('processing');
    try {
      const ai = getAi();
      if (mode === 'note') {
        const r2 = await ai.voiceNote(wav, settings.categories);
        setText(r2.transcript);
        setNote(r2.draft);
      } else {
        const r2 = await ai.voiceRoute(wav);
        setText(r2.transcript);
        setLegs(assignLineTypes(r2.legs, types));
        pickStartFromText(r2.transcript);
        await tryPlaces(r2.transcript);
      }
      setVia('ai');
      setPhase('result');
    } catch (e) {
      if (isNetworkError(e)) {
        await queueVoiceJob(insp.id, mode === 'note' ? 'voice-note' : 'voice-route', wav, seconds);
        toast('Verbindung unterbrochen: Aufnahme gespeichert und wird später ausgewertet.', 'success');
        close();
        return;
      }
      toast(errorText(e), 'error');
      setPhase('input');
    }
  }

  async function analyze() {
    const t = text.trim();
    if (!t) { toast('Bitte zuerst etwas sprechen oder eingeben.', 'error'); return; }
    setPhase('processing');
    let usedAi = false;
    if (aiReady && online) {
      try {
        const ai = getAi();
        if (mode === 'note') setNote(await ai.structureNote(t, settings.categories));
        else setLegs(assignLineTypes(await ai.parseRoute(t), types));
        usedAi = true;
      } catch (e) {
        toast(`KI nicht verfügbar (${errorText(e)}) – lokale Auswertung.`, 'error');
      }
    }
    if (!usedAi) {
      if (mode === 'note') setNote(parseObservation(t, settings.categories));
      else setLegs(parseRouteText(t, types));
    }
    setVia(usedAi ? 'ai' : 'local');
    pickStartFromText(t);
    await tryPlaces(t);
    setPhase('result');
  }

  // ------------------------------------------------ Straßen / Hausnummern / Kreuzungen
  function startContext(ref = startRef) {
    const sp = ref && ref !== 'gps' && ref !== 'none' ? insp.route.points.find((p) => p.id === ref && p.position) : null;
    if (sp) return { pos: sp.position!, label: `${pointDisplayName(sp)}${sp.title ? ' – ' + sp.title : ''}`, pointId: sp.id };
    if (ref === 'gps' && fix) return { pos: { lat: fix.lat, lng: fix.lng }, label: 'Mein Standort (GPS)', pointId: null };
    return null;
  }

  async function tryPlaces(t: string, ref = startRef, follow = followStreets) {
    setPlaceError('');
    if (mode !== 'route' || !settings.placeSearch || !hasPlaces(t)) { setPlaces(null); return; }
    const pieces = parsePlaces(t, types);
    if (!pieces.length) { setPlaces(null); return; }
    if (!navigator.onLine) {
      setPlaces(null);
      setPlaceError('Straßen/Hausnummern erkannt – die Adresssuche braucht aber Internet. Bitte später erneut „Auswerten“.');
      return;
    }
    setPhase('processing');
    try {
      const start = startContext(ref);
      const near = start?.pos ?? (fix ? { lat: fix.lat, lng: fix.lng } : null) ?? insp.route.points.find((p) => p.position)?.position ?? null;
      setPlaces(await resolvePieces(pieces, { near, city: insp.meta.site, start, followStreets: follow, onProgress: setProgress }));
    } catch (e) {
      setPlaces(null);
      setPlaceError(errorText(e));
    } finally {
      setProgress('');
      setPhase('result');
    }
  }

  function applyPlaces() {
    if (!places) return;
    let res = { segments: 0, points: 0 };
    useInspection.getState().mutate((d) => { res = applyResolved(d, places, types); });
    toast(`${res.segments} farbige${res.segments === 1 ? 'r Abschnitt' : ' Abschnitte'} mit ${res.points} Punkten eingezeichnet (automatisch ermittelt).`, 'success', {
      label: 'Rückgängig', run: () => useInspection.getState().undo(),
    });
    close();
    navigate(`/i/${insp.id}/map`, true);
  }

  /** „Vom Startpunkt …“ → am Startpunkt der Trasse beginnen */
  function pickStartFromText(t: string) {
    if (mode !== 'route' || !refersToStart(t)) return;
    const first = insp.route.segments.find((s) => s.pointIds.length)?.pointIds[0];
    const p = first ? insp.route.points.find((x) => x.id === first) : null;
    if (p?.position) setStartRef(p.id);
  }

  function saveNote() {
    if (!note) return;
    const n = newNote({
      kind: 'observation', origin: audioUsed.current || initialText ? 'voice' : 'text', transcript: text.trim(), aiStructured: via === 'ai',
      confirmed: true, // vom Benutzer in diesem Dialog geprüft
      title: note.title, station: note.station, category: note.category, description: note.description || text.trim(), hint: note.hint,
      pointId: pointId || null, position: fix, status: note.hint ? 'open' : 'info',
    });
    useInspection.getState().mutate((d) => { d.notes.push(n); });
    toast('Beobachtung gespeichert.', 'success', { label: 'Öffnen', run: () => useUi.getState().set({ noteId: n.id }) });
    close();
  }

  async function applyRoute() {
    if (!legs.length) return;
    let startFix: GeoFix | null = null;
    if (startRef === 'gps') {
      try { startFix = await currentFix(15000); } catch (e) { toast(`Kein GPS-Startpunkt: ${errorText(e)}`, 'error'); }
    }
    let created = 0;
    let unplaced = 0;
    useInspection.getState().mutate((d) => {
      if (startRef !== 'gps' && startRef !== 'none') {
        const r = applyLegs(d, legs, startRef, null, types);
        created = r.created.length; unplaced = r.unplaced;
      } else {
        // bei leerem aktiven Abschnitt dort beginnen, sonst neuen Abschnitt anlegen
        if (activeSegment(d).pointIds.length) newEmptySegment(d);
        const r = applyLegs(d, legs, null, startRef === 'gps' ? startFix : null, types);
        created = r.created.length; unplaced = r.unplaced;
      }
    });
    toast(`${created} Punkte als „automatisch ermittelt“ eingezeichnet${unplaced ? ` – ${unplaced} ohne Position, bitte auf der Karte setzen` : ''}.`, 'success', {
      label: 'Rückgängig', run: () => useInspection.getState().undo(),
    });
    close();
    navigate(`/i/${insp.id}/map`, true);
  }

  const routePts = insp.route.points.filter((p) => p.kind === 'route' && p.position);
  const startOptions = [
    ...routePts.slice().reverse().map((p) => ({ value: p.id, label: `Ab ${pointDisplayName(p)}${p.title ? ' – ' + p.title : ''}` })),
    { value: 'gps', label: 'Ab meinem GPS-Standort' },
    { value: 'none', label: 'Ohne Bezugspunkt (Punkte ohne Position)' },
  ];

  return (
    <Sheet open full onClose={close} title={mode === 'note' ? 'Beobachtung sprechen' : 'Trassenverlauf sprechen'}>
      <div className="stack">
        {phase !== 'recording' && phase !== 'processing' && (
          <Seg<VoiceMode> value={mode} onChange={(m) => { setMode(m); setPhase('input'); setNote(null); setLegs([]); }} options={[{ value: 'note', label: 'Beobachtung' }, { value: 'route', label: 'Trassenverlauf' }]} />
        )}

        {(phase === 'input' || phase === 'recording') && (
          <>
            {canRecord ? (
              <div className="voice-wrap">
                <button className={`mic-big${phase === 'recording' ? ' rec' : ''}`} onClick={() => (phase === 'recording' ? void stopRec() : void startRec())} aria-label={phase === 'recording' ? 'Aufnahme beenden' : 'Aufnahme starten'}>
                  {phase === 'recording' && <span className="ring" style={{ transform: `scale(${1 + level * 0.35})` }} />}
                  {phase === 'recording' ? <Square size={36} fill="#fff" /> : <Mic size={44} />}
                </button>
                <div className="voice-time">{phase === 'recording' ? fmtDuration(secs * 1000) : 'Tippen zum Sprechen'}</div>
                {phase === 'recording' && <div className="small muted">Erneut tippen zum Beenden (max. 2 Minuten)</div>}
                {!online && phase === 'input' && <div className="small muted center">Offline – die Aufnahme wird gespeichert und später ausgewertet.</div>}
              </div>
            ) : (
              <Banner kind="info" icon={<Info size={20} />}>
                Tippe ins Textfeld und nutze das <b>Mikrofon der iPhone-Tastatur</b> zum Diktieren.
                {!aiReady && ' Für Sprachaufnahmen mit automatischer Abschrift den KI-Assistenten in den Einstellungen einrichten.'}
                {aiReady && !settings.ai.allowAudio && ' Für direkte Sprachaufnahmen in den Einstellungen „Sprachaufnahmen an KI senden“ erlauben.'}
              </Banner>
            )}

            {phase === 'input' && (
              <>
                <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} rows={5}
                  placeholder={mode === 'note'
                    ? 'z. B. „Bei Station 125 befindet sich ein Wirtschaftsweg. Die Trasse muss hier wahrscheinlich unter dem Weg durchgeführt werden.“'
                    : 'z. B. „Vom Startpunkt ungefähr 30 Meter nach Norden, dann links entlang des Feldweges für etwa 80 Meter, anschließend nach Südosten bis zum Graben.“'} />
                <button className="btn primary big block" onClick={analyze} disabled={!text.trim()}>
                  {aiReady && online ? <><Sparkles size={20} />Mit KI auswerten</> : <><Wand2 size={20} />Auswerten</>}
                </button>
                {!(aiReady && online) && <div className="small muted center">Lokale Auswertung (ohne KI): erkennt Richtungen, Entfernungen, Stationen und Kategorien aus dem Text.</div>}
              </>
            )}
          </>
        )}

        {phase === 'processing' && <div className="loading-full"><Spinner large /><div>{progress || 'Wird ausgewertet …'}</div></div>}

        {phase === 'result' && (
          <>
            <div className="card">
              <div className="small muted" style={{ marginBottom: 4 }}>{audioUsed.current ? 'Abschrift' : 'Eingabe'} (wörtlich)</div>
              <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
              <button className="btn sm" style={{ marginTop: 8 }} onClick={analyze}>Neu auswerten</button>
            </div>
            <div className="small muted">{via === 'ai' ? 'Von der KI strukturiert' : 'Lokal ausgewertet'} – nur Angaben aus dem Text, nichts ergänzt. Bitte prüfen.</div>

            {mode === 'note' && note && (
              <NoteResult note={note} setNote={setNote} categories={settings.categories} />
            )}
            {mode === 'note' && (
              <div className="list">
                <SelectField label="Trassenpunkt" value={pointId} onChange={setPointId}
                  options={[{ value: '', label: '– keiner –' }, ...insp.route.points.map((p) => ({ value: p.id, label: `${pointDisplayName(p)}${p.title ? ' – ' + p.title : ''}` }))]} />
              </div>
            )}
            {mode === 'note' && <button className="btn primary big block" onClick={saveNote}>Beobachtung speichern</button>}

            {mode === 'route' && placeError && <Banner>{placeError}</Banner>}
            {mode === 'route' && places && places.length > 0 && !preferLegs && (
              <PlaceResults places={places} types={types}
                onType={(id, key) => setPlaces(places.map((p) => (p.piece.id === id ? { ...p, piece: { ...p.piece, lineType: key || null, lineWord: key ? lineTypeOf(types, key).label : '' } } : p)))}
                onRemove={(id) => setPlaces(places.filter((p) => p.piece.id !== id))}
                startRef={startRef} startOptions={startOptions}
                onStart={(v) => { setStartRef(v); void tryPlaces(text, v, followStreets); }}
                follow={followStreets} onFollow={(v) => { setFollowStreets(v); void tryPlaces(text, startRef, v); }}
                onApply={applyPlaces}
                onLegs={legs.length ? () => setPreferLegs(true) : null} />
            )}
            {mode === 'route' && (!places || !places.length || preferLegs) && (
              <>
                {legs.length === 0 ? (
                  <Banner>Im Text wurden keine Wegabschnitte erkannt. Formulierung wie „30 Meter nach Norden, dann links 80 Meter“ verwenden.</Banner>
                ) : (
                  <div className="list">
                    {legs.map((l, i) => <LegEditor key={l.id} n={i + 1} leg={l} types={types} onChange={(nl) => setLegs(legs.map((x) => (x.id === l.id ? nl : x)))} onRemove={() => setLegs(legs.filter((x) => x.id !== l.id))} />)}
                  </div>
                )}
                <div className="list">
                  <SelectField label="Beginnen" value={startRef} onChange={setStartRef} options={startOptions} />
                </div>
                <Banner icon={<MapPinned size={20} />}>
                  Die Punkte werden aus Richtung und Entfernung <b>geschätzt</b> und als <b>„automatisch ermittelt“</b> markiert (gestrichelt). Abschnitte ohne Richtung oder Entfernung werden ohne Position angelegt.
                </Banner>
                <button className="btn primary big block" disabled={!legs.length} onClick={() => void applyRoute()}>Auf Karte übernehmen</button>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function NoteResult({ note, setNote, categories }: { note: NoteDraft; setNote: (n: NoteDraft) => void; categories: string[] }) {
  const f = (k: keyof NoteDraft) => (v: string) => setNote({ ...note, [k]: v });
  return (
    <div className="list">
      <Field label="Titel" value={note.title} onChange={f('title')} />
      <Field label="Station" value={note.station} onChange={f('station')} placeholder="nicht genannt" />
      <SelectField label="Kategorie" value={note.category} onChange={f('category')} options={[{ value: '', label: '– keine –' }, ...categories.map((c) => ({ value: c, label: c }))]} />
      <Field label="Beschreibung" multiline value={note.description} onChange={f('description')} />
      <Field label="Hinweis" value={note.hint} onChange={f('hint')} placeholder="nicht genannt" />
    </div>
  );
}

const DIRS = Object.keys(DIRECTION_LABEL) as Direction[];
const TURNS = Object.keys(TURN_LABEL) as Turn[];

function LegEditor({ n, leg, types, onChange, onRemove }: { n: number; leg: RouteLeg; types: LineType[]; onChange: (l: RouteLeg) => void; onRemove: () => void }) {
  const dirValue = leg.direction ? `d:${leg.direction}` : leg.turn ? `t:${leg.turn}` : '';
  const lt = leg.lineType ? lineTypeOf(types, leg.lineType) : null;
  return (
    <div className="leg">
      <div className="leg-n" style={lt ? { background: lt.color, color: '#fff', borderColor: '#fff' } : undefined}>{n}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{legSummary(leg)}</div>
        {leg.text && <div className="small muted">„{leg.text}“</div>}
        {leg.note && <div className="small muted">{leg.note}</div>}
        <div className="leg-edit">
          <select value={dirValue} aria-label="Richtung" onChange={(e) => {
            const v = e.target.value;
            onChange({ ...leg, direction: v.startsWith('d:') ? (v.slice(2) as Direction) : null, turn: v.startsWith('t:') ? (v.slice(2) as Turn) : null });
          }}>
            <option value="">Richtung ?</option>
            <optgroup label="Himmelsrichtung">{DIRS.map((d) => <option key={d} value={`d:${d}`}>{DIRECTION_LABEL[d]}</option>)}</optgroup>
            <optgroup label="Relativ">{TURNS.map((t) => <option key={t} value={`t:${t}`}>{TURN_LABEL[t]}</option>)}</optgroup>
          </select>
          <input inputMode="decimal" placeholder="Meter ?" aria-label="Entfernung in Metern" value={leg.distanceM ?? ''} onChange={(e) => {
            const v = parseFloat(e.target.value.replace(',', '.'));
            onChange({ ...leg, distanceM: isFinite(v) && v > 0 ? v : null });
          }} />
          <select style={{ gridColumn: '1 / -1' }} aria-label="Linienart" value={leg.lineType ?? ''} onChange={(e) => onChange({ ...leg, lineType: e.target.value || null, lineWord: e.target.value ? lineTypeOf(types, e.target.value).label : '' })}>
            <option value="">Linienart: Standard</option>
            {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <input style={{ gridColumn: '1 / -1' }} placeholder="Wegmarke (z. B. Graben)" aria-label="Wegmarke" value={leg.landmark} onChange={(e) => onChange({ ...leg, landmark: e.target.value })} />
        </div>
      </div>
      <button className="icon-btn" aria-label="Abschnitt entfernen" onClick={onRemove}><Trash2 size={18} color="var(--danger)" /></button>
    </div>
  );
}

function PlaceResults(props: {
  places: ResolvedPiece[]; types: LineType[]; startRef: string; startOptions: { value: string; label: string }[]; follow: boolean;
  onType: (id: string, key: string) => void; onRemove: (id: string) => void; onStart: (v: string) => void; onFollow: (v: boolean) => void;
  onApply: () => void; onLegs: (() => void) | null;
}) {
  const usable = props.places.filter((p) => p.path.length > 0);
  return (
    <>
      <div className="list">
        {props.places.map((r, i) => {
          const t = r.piece.lineType ? lineTypeOf(props.types, r.piece.lineType) : null;
          return (
            <div key={r.piece.id} className="leg">
              <div className="leg-n" style={{ background: t?.color ?? 'var(--route)', color: '#fff', borderColor: '#fff' }}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.piece.lineWord || t?.label || 'Trasse'}: {r.from?.label ?? '–'} → {r.to?.label ?? (placeLabel(r.piece.to) || '–')}</div>
                <div className="small muted">„{r.piece.text}“</div>
                {r.piece.along && <div className="small muted">entlang {r.piece.along}{r.routed ? ' · folgt dem Wegenetz' : ''}</div>}
                {[r.from?.note, r.to?.note].filter(Boolean).map((n) => <div key={n} className="small muted">{n}</div>)}
                {r.problems.map((p) => <div key={p} className="small" style={{ color: 'var(--warn)' }}>⚠ {p}</div>)}
                <div className="leg-edit">
                  <select style={{ gridColumn: '1 / -1' }} aria-label="Linienart" value={r.piece.lineType ?? ''} onChange={(e) => props.onType(r.piece.id, e.target.value)}>
                    <option value="">Linienart: Standard</option>
                    {props.types.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                </div>
              </div>
              <button className="icon-btn" aria-label="Stück entfernen" onClick={() => props.onRemove(r.piece.id)}><Trash2 size={18} color="var(--danger)" /></button>
            </div>
          );
        })}
      </div>
      <div className="list">
        <SelectField label="Beginnen (wenn kein „von …“ genannt)" value={props.startRef} onChange={props.onStart} options={props.startOptions} />
        <SwitchRow title="Dem Straßenverlauf folgen" sub="Linie entlang des Wegenetzes statt gerade" checked={props.follow} onChange={props.onFollow} />
      </div>
      <Banner icon={<MapPinned size={20} />}>
        Orte aus <b>OpenStreetMap</b>. Die Linien sind <b>automatisch ermittelt</b> (gestrichelt) – die tatsächliche Lage der Leitung vor Ort prüfen und bestätigen.
      </Banner>
      <button className="btn primary big block" disabled={!usable.length} onClick={props.onApply}>Auf Karte übernehmen ({usable.length})</button>
      {props.onLegs && <button className="btn sm plain block" onClick={props.onLegs}>Stattdessen als Richtungsangaben auswerten</button>}
    </>
  );
}
