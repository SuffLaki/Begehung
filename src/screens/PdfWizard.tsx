// PDF-Assistent: Vorlage/Hintergrund, Inhalte und Kartenausschnitt wählen.

import { useEffect, useRef, useState } from 'react';
import { Eye, Plus, Maximize, FileText, Image as ImageIcon } from 'lucide-react';
import { useInspection } from '../state/inspectionStore';
import { useApp, toast, errorText } from '../state/appStore';
import { navigate } from '../router';
import { Banner, Loading, Nav, Seg, SwitchRow } from '../ui/kit';
import type { MapBounds, MapType, PdfSettings, PdfTemplate } from '../model/types';
import { listTemplates } from '../storage/db';
import { MAP_TYPES } from '../map/providers';
import RouteMap from '../map/RouteMap';
import { contentBounds, frameBounds } from '../map/staticMap';
import { activePlan } from '../plans/plans';
import { MAP_ASPECT } from '../pdf/generator';
import { TemplateThumb, createTemplateFromFile } from './Templates';
import { pickFile } from '../camera/photo';
import { can } from '../model/permissions';

export default function PdfWizard({ id }: { id: string }) {
  const insp = useInspection((s) => s.insp);
  const user = useApp((s) => s.settings.user);
  const [templates, setTemplates] = useState<PdfTemplate[] | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    void useInspection.getState().load(id);
    void listTemplates().then(setTemplates);
  }, [id]);

  if (!insp || insp.id !== id || !templates) return <div className="screen"><Nav title="Protokoll" /><Loading /></div>;
  const ps = insp.pdfSettings;
  const setPs = (fn: (p: PdfSettings) => void) => useInspection.getState().mutate((d) => fn(d.pdfSettings), { undoable: false });
  const tplId = templates.some((t) => t.id === ps.templateId) ? ps.templateId : templates[0]?.id;
  const plan = activePlan(insp);
  const cb = plan ? null : contentBounds(insp);
  // Plan: ganzer Plan; Karte: auf die Trasse eingepasst
  const autoFrame = plan ? { south: -plan.height, west: 0, north: 0, east: plan.width } : cb ? frameBounds(cb, MAP_ASPECT) : null;
  const autoPoints = insp.route.points.filter((p) => !p.confirmed).length;
  const autoNotes = insp.notes.filter((n) => !n.confirmed).length;

  async function addTemplate() {
    const f = await pickFile('application/pdf,image/png,image/jpeg');
    if (!f) return;
    try {
      const t = await createTemplateFromFile(f);
      setTemplates(await listTemplates());
      setPs((p) => { p.templateId = t.id; });
      toast(`Vorlage „${t.name}“ hinzugefügt. Ränder ggf. unter „Vorlagen“ anpassen.`, 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const inc = ps.include;
  const setInc = (k: keyof PdfSettings['include']) => (v: boolean) => setPs((p) => { p.include[k] = v; });

  return (
    <div className="screen">
      <Nav title="Protokoll erstellen" backLabel="Zurück" onBack={() => navigate(`/i/${id}`, true)} />
      <div className="scroll">
        {(autoPoints > 0 || autoNotes > 0) && (
          <Banner>Noch nicht bestätigt: {[autoPoints && `${autoPoints} automatisch ermittelte Punkte`, autoNotes && `${autoNotes} KI-Notizen`].filter(Boolean).join(', ')}. Sie erscheinen im PDF als „nicht bestätigt“ gekennzeichnet.</Banner>
        )}

        <div className="group-title">Vorlage / Hintergrund</div>
        <div className="tpl-grid compact">
          {templates.map((t) => (
            <button key={t.id} className={`tpl-card${t.id === tplId ? ' on' : ''}`} onClick={() => setPs((p) => { p.templateId = t.id; })}>
              <TemplateThumb tpl={t} />
              <b className="ellipsis">{t.name}</b>
              <span>{t.kind === 'standard' ? 'Eingebaut' : t.kind === 'pdf' ? <><FileText size={11} /> PDF-Hintergrund</> : <><ImageIcon size={11} /> Bild-Hintergrund</>}</span>
            </button>
          ))}
          {can(user, 'templates.manage') && (
            <button className="tpl-card" onClick={addTemplate}>
              <div className="tpl-thumb" style={{ background: 'var(--fill)', flexDirection: 'column', gap: 6 }}><Plus size={30} /><span className="small">PDF oder Bild</span></div>
              <b>Eigener Hintergrund</b>
              <span>hochladen</span>
            </button>
          )}
        </div>

        <div className="group-title">Inhalte</div>
        <div className="list">
          <SwitchRow title="Deckblatt" sub="Logo, Projektdaten, Kennzahlen" checked={inc.cover} onChange={setInc('cover')} />
          <SwitchRow title="Übersichtskarte" sub="mit Trasse und Legende" checked={inc.map} onChange={setInc('map')} />
          <SwitchRow title="Begehungspunkte" sub="Details je Punkt mit Fotos" checked={inc.points} onChange={setInc('points')} />
          <SwitchRow title="Beobachtungen & Notizen" checked={inc.notes} onChange={setInc('notes')} />
          <SwitchRow title="Fotos" sub="in Punkten/Notizen und „Weitere Fotos“" checked={inc.photos} onChange={setInc('photos')} />
          <SwitchRow title="Koordinatenliste" sub="alle Wegpunkte mit WGS84-Koordinaten" checked={inc.coordTable} onChange={setInc('coordTable')} />
          <SwitchRow title="Abschluss" sub="Zusammenfassung, offene Punkte, Aufgaben, Unterschrift" checked={inc.closing} onChange={setInc('closing')} />
        </div>

        {inc.map && (
          <>
            <div className="group-title">{plan ? `Plan im PDF: ${plan.name}` : 'Karte im PDF'}</div>
            <div className="stack">
              {!plan && <Seg<MapType> value={ps.mapType} onChange={(v) => setPs((p) => { p.mapType = v; })} options={(Object.keys(MAP_TYPES) as MapType[]).map((k) => ({ value: k, label: MAP_TYPES[k].label }))} />}
              {autoFrame ? (
                <>
                  <div className="frame-map">
                    <RouteMap
                      key={`${mapKey}-${plan?.id ?? 'map'}`}
                      plan={plan ? { id: plan.id, width: plan.width, height: plan.height } : null}
                      viewKey={`pdf-${insp.id}-${mapKey}`}
                      insp={insp}
                      mapType={ps.mapType}
                      editMode={false}
                      tool="none"
                      selectedId={null}
                      showPhotos={ps.showPhotoMarkers}
                      showTracks={false}
                      gpsFix={null}
                      liveTrackId={null}
                      fitSignal={0}
                      centerOn={null}
                      initialBounds={ps.mapView ?? autoFrame}
                      onViewChange={(b: MapBounds) => {
                        if (Date.now() - mountedAt.current < 900) return; // Anfangs-Einpassen ignorieren
                        setPs((p) => { p.mapView = b; });
                      }}
                      onTapMap={() => undefined}
                      onTapLine={() => undefined}
                      onSelectPoint={() => undefined}
                      onSelectPhoto={() => undefined}
                      onMovePoint={() => undefined}
                    />
                  </div>
                  <div className="hstack">
                    <div className="small muted grow">{ps.mapView ? `Eigener Ausschnitt – so erscheint ${plan ? 'der Plan' : 'die Karte'} im PDF.` : plan ? 'Ganzer Plan. Zoomen/verschieben, um einen Ausschnitt festzulegen.' : 'Automatisch eingepasst. Verschieben/zoomen, um den Ausschnitt festzulegen.'}</div>
                    {ps.mapView && <button className="btn sm" onClick={() => { setPs((p) => { p.mapView = null; }); mountedAt.current = Date.now(); setMapKey((k) => k + 1); }}><Maximize size={16} />Automatisch</button>}
                  </div>
                </>
              ) : (
                <Banner kind="info">Noch keine verorteten Punkte – die Kartenseite entfällt.</Banner>
              )}
              <div className="list">
                <SwitchRow title="Wegpunkte anzeigen" sub="GPS-/Trassenpunkte als Kreise" checked={ps.showGpsPoints} onChange={(v) => setPs((p) => { p.showGpsPoints = v; })} />
                <SwitchRow title="Punktnummern anzeigen" checked={ps.showNumbers} onChange={(v) => setPs((p) => { p.showNumbers = v; })} />
                <SwitchRow title="Fotosymbole anzeigen" checked={ps.showPhotoMarkers} onChange={(v) => setPs((p) => { p.showPhotoMarkers = v; })} />
                <SwitchRow title="Markierungen anzeigen" checked={ps.showMarkers} onChange={(v) => setPs((p) => { p.showMarkers = v; })} />
                <SwitchRow title="Trasse farbig" sub="aus: einheitlich schwarz" checked={ps.colored} onChange={(v) => setPs((p) => { p.colored = v; })} />
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: 22 }}>
          <button className="btn primary big block" onClick={() => {
            if (tplId && tplId !== ps.templateId) setPs((p) => { p.templateId = tplId; });
            navigate(`/i/${id}/preview`);
          }}><Eye size={20} />Vorschau anzeigen</button>
        </div>
      </div>
    </div>
  );
}
