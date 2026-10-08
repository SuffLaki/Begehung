// Abschluss-Prüfung der Begehung.

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, X, Info, FileText, Flag } from 'lucide-react';
import { useInspection } from '../state/inspectionStore';
import { useApp, confirmDialog, toast } from '../state/appStore';
import { navigate } from '../router';
import { Loading, Nav } from '../ui/kit';
import { listJobs } from '../storage/db';
import { useRecorder } from '../geo/gps';

type Level = 'ok' | 'warn' | 'bad' | 'info';
interface Check { level: Level; title: string; text?: string; go?: string }

export default function FinishCheck({ id }: { id: string }) {
  const insp = useInspection((s) => s.insp);
  const saveError = useInspection((s) => s.saveError);
  const user = useApp((s) => s.settings.user);
  const recording = useRecorder((s) => s.trackId);
  const [jobs, setJobs] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      await useInspection.getState().load(id);
      await useInspection.getState().flush();
      setJobs((await listJobs(id)).length);
    })();
  }, [id]);

  if (!insp || insp.id !== id || jobs === null) return <div className="screen"><Nav title="Abschließen" /><Loading /></div>;

  const m = insp.meta;
  const missing = [!m.projectName && 'Projektname', !m.date && 'Datum', !m.inspector && 'Begeher'].filter(Boolean);
  const routePts = insp.route.points.filter((p) => p.kind === 'route' && p.position);
  const autoPts = insp.route.points.filter((p) => !p.confirmed);
  const unplaced = insp.route.points.filter((p) => !p.position);
  const loose = insp.photos.filter((f) => !f.pointId && !f.noteId);
  const autoPhotos = insp.photos.filter((f) => f.pointAutoAssigned);
  const aiNotes = insp.notes.filter((n) => !n.confirmed);
  const openTracks = insp.route.tracks.filter((t) => t.endedAt && !t.convertedSegmentId && t.fixes.length >= 2);
  const base = `/i/${id}`;

  const checks: Check[] = [
    missing.length ? { level: 'bad', title: 'Pflichtangaben fehlen', text: missing.join(', '), go: `${base}/meta` } : { level: 'ok', title: 'Projektdaten vollständig' },
    recording ? { level: 'bad', title: 'GPS-Aufzeichnung nicht beendet', text: 'Bitte zuerst beenden (auch wenn pausiert).', go: base } : { level: 'ok', title: 'Keine laufende Aufzeichnung' },
    saveError ? { level: 'bad', title: 'Ungespeicherte Änderungen', text: saveError } : { level: 'ok', title: 'Alle Änderungen gespeichert' },
    routePts.length >= 2 ? { level: 'ok', title: `Trasse erfasst (${routePts.length} Punkte)` } : { level: 'warn', title: 'Kaum Trassenverlauf erfasst', text: 'Weniger als 2 verortete Punkte.', go: `${base}/map` },
    autoPts.length ? { level: 'warn', title: `${autoPts.length} automatisch ermittelte Punkte nicht bestätigt`, text: unplaced.length ? `${unplaced.length} davon ohne Position.` : 'Lage prüfen und bestätigen.', go: `${base}/map` } : { level: 'ok', title: 'Keine unbestätigten Punkte' },
    loose.length ? { level: 'warn', title: `${loose.length} ${loose.length === 1 ? 'Foto' : 'Fotos'} nicht zugeordnet`, go: `${base}/photos` } : { level: 'ok', title: 'Alle Fotos zugeordnet' },
    autoPhotos.length ? { level: 'info', title: `${autoPhotos.length} ${autoPhotos.length === 1 ? 'Foto' : 'Fotos'} automatisch zugeordnet`, text: 'Zuordnung zum nächsten Punkt prüfen.', go: `${base}/photos` } : null,
    aiNotes.length ? { level: 'warn', title: `${aiNotes.length} KI-Notizen nicht bestätigt`, go: `${base}/notes` } : { level: 'ok', title: 'Keine unbestätigten KI-Inhalte' },
    insp.summary && !insp.summary.confirmed ? { level: 'warn', title: 'Zusammenfassung nicht bestätigt', text: 'Wird sonst nicht ins Protokoll übernommen.', go: `${base}/more` } : null,
    jobs ? { level: 'warn', title: `${jobs} Sprachaufnahmen noch nicht ausgewertet`, text: 'Warten auf Internetverbindung.' } : null,
    openTracks.length ? { level: 'warn', title: 'GPS-Aufzeichnung nicht in Trasse übernommen', go: base } : null,
    !insp.signature ? { level: 'info', title: 'Keine Unterschrift', text: 'Optional – unter „Mehr“.', go: `${base}/more` } : { level: 'ok', title: 'Unterschrieben' },
  ].filter(Boolean) as Check[];

  const bad = checks.filter((c) => c.level === 'bad').length;
  const warn = checks.filter((c) => c.level === 'warn').length;

  async function finish() {
    if (warn && !(await confirmDialog({ title: `Trotz ${warn} Hinweis${warn === 1 ? '' : 'en'} abschließen?`, message: 'Die Begehung wird schreibgeschützt. Du kannst sie später wieder öffnen.', confirmLabel: 'Abschließen' }))) return;
    useInspection.getState().mutate((d) => { d.status = 'completed'; d.completedAt = Date.now(); });
    await useInspection.getState().flush();
    toast('Begehung abgeschlossen.', 'success');
    setDone(true);
  }

  const icon = (l: Level) => l === 'ok' ? <Check size={16} /> : l === 'bad' ? <X size={16} /> : l === 'warn' ? <AlertTriangle size={14} /> : <Info size={14} />;

  return (
    <div className="screen">
      <Nav title="Begehung abschließen" backLabel="Zurück" onBack={() => navigate(base, true)} />
      <div className="scroll">
        {done || insp.status === 'completed' ? (
          <div className="empty">
            <div className="check"><span className="ci ok" style={{ width: 64, height: 64, borderRadius: 32 }}><Check size={36} /></span></div>
            <b>Begehung abgeschlossen</b>
            <div>Status: Abgeschlossen. Jetzt das Protokoll erstellen.</div>
            <button className="btn primary big block" onClick={() => navigate(`${base}/pdf`, true)}><FileText size={20} />Begehungsprotokoll erstellen</button>
            <button className="btn block" onClick={() => navigate(base, true)}>Zur Begehung</button>
          </div>
        ) : (
          <>
            <div className="group-title">Prüfung</div>
            <div className="list">
              {checks.map((c, i) => (
                <button key={i} className="check" style={{ width: '100%', textAlign: 'left' }} disabled={!c.go} onClick={() => c.go && navigate(c.go, true)}>
                  <span className={`ci ${c.level === 'ok' ? 'ok' : c.level === 'bad' ? 'bad' : 'warn'}`} style={c.level === 'info' ? { background: '#8e8e93' } : undefined}>{icon(c.level)}</span>
                  <div className="grow"><b>{c.title}</b>{c.text && <div className="small muted">{c.text}</div>}</div>
                </button>
              ))}
            </div>
            <div className="group-foot">{bad ? 'Rote Punkte müssen vor dem Abschluss behoben werden.' : warn ? 'Gelbe Hinweise können bestätigt werden.' : 'Alles bereit.'}</div>
            <div style={{ marginTop: 20 }}>
              <button className="btn primary big block" disabled={!!bad || user.role === 'viewer'} onClick={finish}><Flag size={20} />Begehung abschließen</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
