// Linien in ein Foto einzeichnen.
// Wort per Text oder Sprache („Tiefbau“, „Leerrohr“ …) → wählt Farbe + Beschriftung.
// Verlauf: mit dem Finger ziehen (Freihand oder gerade) oder als KI-Vorschlag.

import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Sparkles, Trash2, Undo2, Check, X, Spline, Minus, MapPin } from 'lucide-react';
import { firstPlace, placeLabel, type PlaceRef } from '../../places/placeParser';
import { resolvePlace } from '../../places/resolve';
import { nearestPoint } from '../../geo/geo';
import { pointDisplayName } from '../../model/factory';
import { useInspection } from '../../state/inspectionStore';
import { useApp, toast, errorText } from '../../state/appStore';
import type { PhotoAnnotation } from '../../model/types';
import { uid } from '../../model/factory';
import { usePhotoUrl } from '../../camera/photoUrls';
import { getPhotoBlob } from '../../storage/db';
import { AnnotationLayer } from '../../annotate/AnnotationLayer';
import { matchLineTypes, lineTypeOf, thinPoints, colorName } from '../../annotate/lines';
import { WavRecorder, ensureMicConsent, micSupported } from '../../speech/audioRecorder';
import { aiConfigured, getAi } from '../../ai/ai';
import { Seg, Sheet, Spinner } from '../../ui/kit';
import { useUi } from './actions';

type Mode = 'free' | 'straight';

export default function AnnotateSheet() {
  const id = useUi((s) => s.annotateId);
  if (!id) return null;
  return <AnnotateInner key={id} id={id} />;
}

function AnnotateInner({ id }: { id: string }) {
  const insp = useInspection((s) => s.insp)!;
  const settings = useApp((s) => s.settings);
  const online = useApp((s) => s.online);
  const types = settings.lineTypes;
  const photo = insp.photos.find((f) => f.id === id);
  const url = usePhotoUrl(id, 'full');
  const [anns, setAnns] = useState<PhotoAnnotation[]>(() => structuredClone(photo?.annotations ?? []));
  const [typeKey, setTypeKey] = useState(types[0]?.key ?? '');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>('free');
  const [text, setText] = useState('');
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const [suggestions, setSuggestions] = useState<PhotoAnnotation[]>([]);
  const [busy, setBusy] = useState<'ai' | 'rec' | 'stt' | 'place' | null>(null);
  const [place, setPlace] = useState<PlaceRef | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const recRef = useRef<WavRecorder | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => () => recRef.current?.cancel(), []);
  if (!photo) return null;

  const W = photo.width || 1000;
  const H = photo.height || 750;
  const ratio = W / H;
  const current = lineTypeOf(types, typeKey);
  const currentLabel = labels[typeKey] ?? current.label;
  const matches = matchLineTypes(text, types);
  const aiReady = aiConfigured(settings.ai);
  const canRecord = micSupported() && aiReady && settings.ai.allowAudio;
  const canSuggest = aiReady && settings.ai.allowPhotos && online;

  const close = () => useUi.getState().set({ annotateId: null, photoId: id });
  function save() {
    useInspection.getState().mutate((d) => {
      const f = d.photos.find((x) => x.id === id);
      if (f) f.annotations = anns;
    });
    if (suggestions.length) toast('Nicht übernommene KI-Vorschläge wurden verworfen.');
    close();
  }

  /** Text/Sprache auswerten: Wort → Linienart */
  function applyText(t: string, announce = true) {
    setText(t);
    const m = matchLineTypes(t, types);
    if (!m.length) {
      if (announce) toast('Kein bekanntes Wort erkannt (z. B. „Tiefbau“, „Leerrohr“). Weitere Wörter: Einstellungen → Linienarten.', 'error');
      return;
    }
    // Straße/Hausnummer/Kreuzung im selben Satz → in die Beschriftung übernehmen
    const pl = settings.placeSearch ? firstPlace(t, types) : null;
    setPlace(pl);
    const where = pl ? ` – ${placeLabel(pl)}` : '';
    setTypeKey(m[0].type.key);
    setLabels((l) => ({ ...l, ...Object.fromEntries(m.map((x) => [x.type.key, x.word + where])) }));
    if (announce) toast(`Linie „${m[0].word}“ (${colorName(m[0].type.color)}) – jetzt mit dem Finger einzeichnen.`, 'success');
  }

  async function toggleRec() {
    if (recRef.current) {
      const r = recRef.current;
      recRef.current = null;
      const { wav, seconds } = await r.stop();
      if (seconds < 0.6) { setBusy(null); return; }
      setBusy('stt');
      try {
        const t = await getAi().transcribe(wav);
        applyText(t);
      } catch (e) {
        toast(errorText(e), 'error');
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!canRecord) {
      textRef.current?.focus();
      toast('Tippe auf das Mikrofon der iPhone-Tastatur und sprich z. B. „Tiefbau“.');
      return;
    }
    if (!(await ensureMicConsent())) return;
    const r = new WavRecorder();
    r.onLevel = (_l, s) => setRecSecs(s);
    r.onLimit = () => void toggleRec();
    try {
      await r.start();
      recRef.current = r;
      setBusy('rec');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  /** Foto dem genannten Ort zuordnen: nächster Trassenpunkt (≤ 30 m) bzw. Position aus der Adresse */
  async function locatePhoto() {
    if (!place || !photo) return;
    setBusy('place');
    try {
      const near = photo.position ?? insp.route.points.find((p) => p.position)?.position ?? null;
      const r = await resolvePlace(place, near ? { lat: near.lat, lng: near.lng } : null, insp.meta.site);
      if (!r.result) { toast(r.error, 'error'); return; }
      const pos = r.result.pos;
      const pt = nearestPoint(insp.route.points, pos, 30);
      useInspection.getState().mutate((d) => {
        const f = d.photos.find((x) => x.id === id);
        if (!f) return;
        f.placeLabel = r.result!.label;
        if (pt) { f.pointId = pt.id; f.pointAutoAssigned = false; }
        if (!f.position) { f.position = { lat: pos.lat, lng: pos.lng, accuracy: null, timestamp: Date.now() }; f.positionSource = 'address'; }
      });
      const precision = r.result.precision === 'street' ? ' (nur Straße gefunden – Lage ungenau)' : '';
      toast(pt ? `Foto ${photo.number} → ${pointDisplayName(pt)} (${r.result.label})${precision}` : photo.position ? `Ort „${r.result.label}“ vermerkt – kein Trassenpunkt in 30 m Nähe.` : `Foto ${photo.number} bei „${r.result.label}“ verortet${precision}.`, 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function suggest() {
    const found = matchLineTypes(text, types);
    if (!found.length) { toast('Bitte zuerst sagen/schreiben, was eingezeichnet werden soll (z. B. „Leerrohr entlang der Mauer“).', 'error'); return; }
    setBusy('ai');
    try {
      const rec = await getPhotoBlob(id);
      if (!rec) throw new Error('Foto nicht gefunden.');
      const lines = await getAi().suggestLines(rec.full, text, found.map((m) => ({ key: m.type.key, label: m.type.label })));
      if (!lines.length) {
        toast('Die KI konnte den Verlauf auf dem Foto nicht eindeutig erkennen – bitte mit dem Finger einzeichnen.', 'error');
        return;
      }
      setSuggestions(lines.map((l) => ({
        id: uid('a'), type: l.type, points: l.points, source: 'ai', createdAt: Date.now(),
        label: found.find((m) => m.type.key === l.type)?.word ?? lineTypeOf(types, l.type).label,
      })));
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------ Zeichnen
  function toNorm(e: React.PointerEvent): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }
  function down(e: React.PointerEvent) {
    if (!typeKey) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = toNorm(e);
    setDrawing([p, p]);
  }
  function move(e: React.PointerEvent) {
    if (!drawing) return;
    const p = toNorm(e);
    setDrawing((d) => (d ? (mode === 'straight' ? [d[0], p] : [...d, p]) : d));
  }
  function up() {
    if (!drawing) return;
    const pts = mode === 'straight' ? [drawing[0], drawing[drawing.length - 1]] : thinPoints(drawing);
    const a = pts[0];
    const b = pts[pts.length - 1];
    const len = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], (p[1] - pts[i - 1][1]) / ratio) : 0), 0);
    setDrawing(null);
    if (len < 0.03 && Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.03) return; // nur angetippt
    setAnns((list) => [...list, { id: uid('a'), type: typeKey, label: currentLabel, points: pts, source: 'manual', createdAt: Date.now() }]);
  }

  const draftAnn: PhotoAnnotation[] = drawing ? [{ id: 'draft', type: typeKey, label: '', points: drawing, source: 'manual', createdAt: 0 }] : [];

  return (
    <Sheet open full onClose={save} title={`Foto ${photo.number} markieren`}
      left={<button className="nav-btn" style={{ marginTop: 8 }} onClick={close}>Abbrechen</button>}
      right={<button className="nav-btn" style={{ fontWeight: 600, marginTop: 8 }} onClick={save}>Fertig</button>}>
      <div className="stack">
        <div className="annotated editing" style={{ aspectRatio: String(ratio), maxWidth: `calc(46vh * ${ratio})` }}>
          {url ? <img src={url} alt={`Foto ${photo.number}`} draggable={false} /> : <div className="center" style={{ paddingTop: '30%' }}><Spinner /></div>}
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrawing(null)}>
            <AnnotationLayer anns={anns} w={W} h={H} types={types} />
            <AnnotationLayer anns={suggestions} w={W} h={H} types={types} dashed />
            <AnnotationLayer anns={draftAnn} w={W} h={H} types={types} labels={false} />
          </svg>
        </div>

        {suggestions.length > 0 && (
          <div className="banner info">
            <Sparkles size={20} />
            <div className="grow">
              <b>KI-Vorschlag</b> (gestrichelt) – Lage geschätzt, bitte prüfen.
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn sm primary" onClick={() => { setAnns((l) => [...l, ...suggestions]); setSuggestions([]); }}><Check size={16} />Übernehmen</button>
                <button className="btn sm" onClick={() => setSuggestions([])}><X size={16} />Verwerfen</button>
              </div>
            </div>
          </div>
        )}

        {/* Wort per Text/Sprache */}
        <div className="hstack" style={{ alignItems: 'stretch' }}>
          <textarea ref={textRef} className="input grow" rows={2} style={{ minHeight: 56 }} value={text}
            placeholder="Was einzeichnen? z. B. „Tiefbau“ oder „Leerrohr entlang der Mauer“"
            onChange={(e) => applyText(e.target.value, false)}
            onBlur={() => text.trim() && !matches.length && applyText(text)} />
          <button className={`btn${busy === 'rec' ? ' danger solid' : ''}`} style={{ flex: '0 0 60px', padding: 0, minHeight: 56 }} aria-label={busy === 'rec' ? 'Aufnahme beenden' : 'Sprechen'} onClick={() => void toggleRec()} disabled={busy === 'stt' || busy === 'ai'}>
            {busy === 'stt' ? <Spinner /> : busy === 'rec' ? <Square size={20} fill="#fff" /> : <Mic size={24} color="#ff375f" />}
          </button>
        </div>
        {busy === 'rec' && <div className="small center" style={{ color: 'var(--danger)' }}>Aufnahme läuft · {Math.floor(recSecs)} s – erneut tippen zum Beenden</div>}
        {matches.length > 0 && (
          <div className="small muted">Erkannt: {matches.map((m) => `${m.word} (${colorName(m.type.color)})`).join(', ')}{place ? ` · Ort: ${placeLabel(place)}` : ''}</div>
        )}
        {place && (
          <button className="btn block" onClick={() => void locatePhoto()} disabled={busy !== null || !online}>
            {busy === 'place' ? <><Spinner />Ort wird gesucht …</> : <><MapPin size={18} />Foto „{placeLabel(place)}“ zuordnen</>}
          </button>
        )}
        {place && !online && <div className="small muted">Ortssuche braucht Internet.</div>}
        {canSuggest ? (
          <button className="btn block" onClick={suggest} disabled={!matches.length || busy !== null}>
            {busy === 'ai' ? <><Spinner />KI sucht den Verlauf …</> : <><Sparkles size={18} />Verlauf von KI vorschlagen lassen</>}
          </button>
        ) : (
          <div className="small muted">Linie mit dem Finger über das Foto ziehen.{aiReady && !settings.ai.allowPhotos ? ' KI-Vorschläge: in den Einstellungen „Fotos an KI senden“ erlauben.' : ''}</div>
        )}

        {/* Linienart + Modus */}
        <div className="chips">
          {types.map((t) => (
            <button key={t.key} className={`chip${t.key === typeKey ? ' on' : ''}`} style={t.key === typeKey ? { background: t.color, color: '#fff' } : undefined} onClick={() => setTypeKey(t.key)}>
              <span className="color-dot" style={{ background: t.color, width: 14, height: 14, border: '2px solid #fff' }} />{labels[t.key] ?? t.label}
            </button>
          ))}
        </div>
        <div className="hstack">
          <div className="grow">
            <Seg<Mode> value={mode} onChange={setMode} options={[{ value: 'free', label: <><Spline size={14} /> Freihand</> }, { value: 'straight', label: <><Minus size={14} /> Gerade</> }]} />
          </div>
          <button className="btn sm" disabled={!anns.length} onClick={() => setAnns((l) => l.slice(0, -1))} aria-label="Letzte Linie entfernen"><Undo2 size={16} /></button>
        </div>

        {anns.length > 0 && (
          <div className="list">
            {anns.map((a) => {
              const t = lineTypeOf(types, a.type);
              return (
                <div key={a.id} className="row">
                  <span className="seg-swatch" style={{ background: t.color, width: 28, height: 6 }} />
                  <input className="grow" style={{ border: 0, background: 'transparent', fontSize: 16, outline: 0 }} value={a.label} aria-label="Beschriftung"
                    onChange={(e) => setAnns((l) => l.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)))} />
                  {a.source === 'ai' && <span className="badge accent">KI</span>}
                  <button className="icon-btn" aria-label="Linie löschen" onClick={() => setAnns((l) => l.filter((x) => x.id !== a.id))}><Trash2 size={18} color="var(--danger)" /></button>
                </div>
              );
            })}
          </div>
        )}
        <div className="small muted">Die Linien liegen über dem Foto – das Original bleibt unverändert. Im PDF werden sie mit Legende eingezeichnet.</div>
      </div>
    </Sheet>
  );
}

