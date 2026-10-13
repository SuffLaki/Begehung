// Dashboard: Begrüßung mit Standort, Start-Auswahl (Begehung / Baustelle),
// Kennzahlen, Mängel-Stand, offene Mängel, Trassen, letzte Aktivitäten.

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Spline, Camera, AlertTriangle, StickyNote, FileStack, Download, Share, X, FolderOpen, MapPin, Folder, HardHat } from 'lucide-react';
import type { Inspection } from '../model/types';
import { listAllInspections, summarize } from '../storage/db';
import { navigate } from '../router';
import { Banner, Empty, Row, Spinner, SyncPill } from '../ui/kit';
import AppTabs from '../ui/AppTabs';
import { StatusBadge, isIosSafariBrowser, relTime, statusOf } from './common';
import { useApp, toast, errorText } from '../state/appStore';
import { can } from '../model/permissions';
import { pickFile } from '../camera/photo';
import { importInspection } from '../storage/backup';
import { formatDistance } from '../geo/geo';
import { today } from '../model/factory';
import { formatDate } from '../pdf/generator';
import { PRIORITY } from './inspection/NotesTab';
import { StartCards } from '../ui/StartChooser';
import Donut from '../ui/Donut';
import { AppLogo } from '../ui/Splash';
import DefectCard from './DefectCard';
import { fixIfAvailable } from '../geo/gps';
import { reverseGeocode } from '../places/osm';
import { addressAllowed } from '../places/address';

interface Activity { t: number; icon: React.ReactNode; color: string; title: string; sub: string; go: string }

export default function Home() {
  const [all, setAll] = useState<Inspection[] | null>(null);
  const user = useApp((s) => s.settings.user);
  const company = useApp((s) => s.settings.company.name);
  const [hideInstall, setHideInstall] = useState(() => { try { return localStorage.getItem('hideInstall') === '1'; } catch { return false; } });

  const [place, setPlace] = useState<string | null>(null);

  useEffect(() => { void listAllInspections().then(setAll); }, []);
  // Ort im Kopf: nur mit vorhandener Standort-Freigabe, ohne neue Abfrage zu erzwingen
  useEffect(() => {
    let alive = true;
    void fixIfAvailable(5 * 60000).then(async (fix) => {
      if (!fix || !addressAllowed()) return;
      const a = await reverseGeocode(fix).catch(() => null);
      const city = a?.split(', ').pop() ?? null;
      if (alive && city) setPlace(city.replace(/^\d{5}\s+/, ''));
    });
    return () => { alive = false; };
  }, []);

  const defects = useMemo(() => (all ?? []).flatMap((i) => i.notes.filter((n) => n.kind === 'observation' && (n.priority || n.status === 'open' || n.status === 'progress')).map((n) => ({ n, i }))), [all]);
  const dOpen = defects.filter((d) => d.n.status === 'open').length;
  const dProg = defects.filter((d) => d.n.status === 'progress').length;
  const dDone = defects.filter((d) => d.n.status === 'done').length;
  const todo = defects.filter((d) => d.n.status === 'open' || d.n.status === 'progress')
    .sort((a, b) => (a.n.dueDate || '9999').localeCompare(b.n.dueDate || '9999') || b.n.createdAt - a.n.createdAt).slice(0, 4);
  const projects = new Set((all ?? []).map((i) => i.projectId || i.meta.projectNumber || i.meta.projectName)).size;
  const sites = (all ?? []).filter((i) => i.kind === 'baustelle').length;
  const walks = (all ?? []).length - sites;

  const rows = useMemo(() => (all ?? []).map(summarize), [all]);
  const todayStr = today().date;
  const plannedToday = rows.filter((r) => r.date === todayStr && r.status !== 'completed').length;
  const openCount = rows.filter((r) => r.status !== 'completed').length;
  const current = rows.find((r) => r.status !== 'completed');
  const firstName = (user.name || '').trim().split(/\s+/)[0];

  const activities = useMemo<Activity[]>(() => {
    const out: Activity[] = [];
    for (const i of all ?? []) {
      const name = i.meta.projectName || 'Begehung';
      for (const f of i.photos) out.push({ t: f.takenAt, icon: <Camera size={16} />, color: 'var(--accent)', title: 'Foto hinzugefügt', sub: name, go: `/i/${i.id}/photos` });
      for (const n of i.notes) {
        const defect = n.kind === 'observation' && (n.priority || n.status === 'open');
        out.push({ t: n.createdAt, icon: defect ? <AlertTriangle size={16} /> : <StickyNote size={16} />, color: defect ? PRIORITY[n.priority ?? 'medium'].color : '#d68a17', title: defect ? 'Mangel gemeldet' : 'Notiz erstellt', sub: `${n.title || n.category || 'Notiz'} · ${name}`, go: `/i/${i.id}/notes?note=${n.id}` });
      }
      for (const p of i.route.points) if (p.check && p.check !== 'open') {
        out.push({ t: p.updatedAt, icon: <MapPin size={16} />, color: p.check === 'ok' ? '#23824f' : '#d0352b', title: p.check === 'ok' ? `${p.label || 'P' + p.number} geprüft – OK` : `${p.label || 'P' + p.number}: Mangel`, sub: name, go: `/i/${i.id}/map` });
      }
    }
    return out.sort((a, b) => b.t - a.t).slice(0, 5);
  }, [all]);

  async function doImport() {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
      const insp = await importInspection(f);
      toast('Begehung importiert.', 'success');
      navigate(`/i/${insp.id}`);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  return (
    <div className="screen">
      <div className="scroll with-tabs" style={{ padding: 0 }}>
        <div className="home-hero">
          <div className="hero-top">
            <span className="hero-place"><AppLogo size={30} /><b>Trasso</b>{place ? <><span style={{ opacity: 0.5 }}>·</span><MapPin size={15} />{place}</> : company ? <><span style={{ opacity: 0.5 }}>·</span>{company}</> : null}</span>
            <SyncPill />
          </div>
          <h1>Hallo{firstName ? ` ${firstName}` : ''}</h1>
          <p>{!all ? ' ' : plannedToday ? `Heute ${plannedToday === 1 ? 'ist 1 Termin' : `sind ${plannedToday} Termine`} geplant.` : dOpen ? `${dOpen} offene${dOpen === 1 ? 'r Mangel' : ' Mängel'}.` : openCount ? `${openCount} offene Vorgänge.` : 'Alles erledigt.'}</p>
        </div>

        {current ? (
          <button className="next-card" onClick={() => navigate(`/i/${current.id}`)}>
            <span className="nc-icon"><CalendarDays size={24} /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <small>{current.kind === 'baustelle' ? 'Laufende Baustellenkontrolle' : current.date === todayStr ? 'Aktuelle Begehung' : statusOf(current) === 'draft' ? 'Nächste Begehung' : 'Offene Begehung'}</small>
              <b className="ellipsis">{current.projectName || 'Ohne Projektname'}{current.site ? ` – ${current.site}` : ''}</b>
              <small>{current.date === todayStr ? 'Heute' : formatDate(current.date)}{current.time ? `, ${current.time} Uhr` : ''}</small>
            </span>
            <ChevronRight size={20} color="var(--text-3)" />
          </button>
        ) : null}

        <div style={{ padding: '0 16px' }}>
          {isIosSafariBrowser() && !hideInstall && (
            <div style={{ marginTop: 14 }}>
              <Banner kind="info" icon={<Share size={20} />}>
                <div className="hstack" style={{ alignItems: 'flex-start' }}>
                  <div className="grow"><b>Als App installieren:</b> unten auf <b>Teilen</b> tippen → <b>„Zum Home-Bildschirm“</b>.</div>
                  <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Hinweis ausblenden" onClick={() => { setHideInstall(true); try { localStorage.setItem('hideInstall', '1'); } catch { /* egal */ } }}><X size={16} /></button>
                </div>
              </Banner>
            </div>
          )}

          {can(user, 'inspection.create') && (
            <>
              <div className="section-head"><h2>Neu starten</h2></div>
              <StartCards />
            </>
          )}

          {all && all.length > 0 && (
            <div className="kpis" style={{ marginTop: 14 }}>
              <button className="kpi" onClick={() => navigate('/list', true)}><span className="ki"><Folder size={18} /></span><b>{projects}</b><span>{projects === 1 ? 'Projekt' : 'Projekte'}</span></button>
              <button className="kpi" onClick={() => navigate('/list', true)}><span className="ki"><Spline size={18} /></span><b>{walks}</b><span>{walks === 1 ? 'Begehung' : 'Begehungen'}</span></button>
              <button className="kpi" onClick={() => navigate('/list', true)}><span className="ki"><HardHat size={18} /></span><b>{sites}</b><span>{sites === 1 ? 'Baustelle' : 'Baustellen'}</span></button>
            </div>
          )}

          {defects.length > 0 && (
            <>
              <div className="section-head"><h2>Mängel</h2><button onClick={() => navigate('/meldungen', true)}>Alle anzeigen</button></div>
              <div className="card">
                <Donut parts={[
                  { label: 'Offen', value: dOpen, color: '#d0352b' },
                  { label: 'In Bearbeitung', value: dProg, color: '#e0a100' },
                  { label: 'Erledigt', value: dDone, color: '#23824f' },
                ]} totalLabel="Mängel" size={130} />
              </div>
            </>
          )}

          {todo.length > 0 && (
            <>
              <div className="section-head"><h2>To do</h2></div>
              <div className="list">
                {todo.map(({ n, i }) => <DefectCard key={n.id} n={n} insp={i} showProject onClick={() => navigate(`/i/${i.id}/notes?note=${n.id}`)} />)}
              </div>
            </>
          )}

          <div className="section-head"><h2>Meine Trassen &amp; Baustellen</h2>{rows.length > 0 && <button onClick={() => navigate('/list', true)}>Alle anzeigen</button>}</div>
          {!all ? <div className="center" style={{ padding: 24 }}><Spinner /></div> : rows.length === 0 ? (
            <div className="list"><Empty icon={<FolderOpen size={40} />} title="Noch keine Begehungen" text="Unten auf + tippen, um die erste Begehung anzulegen." /></div>
          ) : (
            <div className="list">
              {rows.slice(0, 5).map((r) => (
                <Row key={r.id} className="trasse-row" icon={r.kind === 'baustelle' ? <HardHat size={18} /> : <Spline size={18} />}
                  title={<span className="hstack"><span className="ellipsis grow">{r.projectName || 'Ohne Projektname'}</span><StatusBadge status={statusOf(r)} /></span>}
                  sub={<span className="hstack"><span className="ellipsis grow">{r.site || r.projectNumber || formatDate(r.date)}</span><span>{r.lengthM ? formatDistance(r.lengthM) : ''}</span></span>}
                  onClick={() => navigate(`/i/${r.id}`)} />
              ))}
            </div>
          )}

          {activities.length > 0 && (
            <>
              <div className="section-head"><h2>Letzte Aktivitäten</h2></div>
              <div className="list">
                {activities.map((a, i) => (
                  <Row key={i} icon={a.icon} iconBg={a.color} title={a.title} sub={<span className="ellipsis" style={{ display: 'block' }}>{a.sub}</span>}
                    right={<span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{relTime(a.t)}</span>} chevron={false} onClick={() => navigate(a.go)} />
                ))}
              </div>
            </>
          )}

          <div className="quick-links">
            <button onClick={() => navigate('/templates')}><FileStack size={20} />Vorlagen</button>
            <button onClick={doImport}><Download size={20} />Importieren</button>
            <button onClick={() => navigate('/meldungen', true)}><AlertTriangle size={20} />Meldungen</button>
          </div>
        </div>
      </div>
      <AppTabs active="home" />
    </div>
  );
}
