import { useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, User as UserIcon, X } from 'lucide-react';
import { useApp, toast, errorText, confirmDialog } from '../state/appStore';
import { navigate } from '../router';
import { Banner, Field, Nav, Seg, SelectField, SwitchRow, Spinner } from '../ui/kit';
import type { MapType, Role, Settings } from '../model/types';
import { DEFAULT_CATEGORIES } from '../model/factory';
import { ROLE_LABELS, can } from '../model/permissions';
import { MAP_TYPES } from '../map/providers';
import { pickFile, loadImage, scaleToCanvas } from '../camera/photo';
import { storageEstimate } from '../storage/db';
import { getAi } from '../ai/ai';
import { getSync } from '../sync/sync';

export default function SettingsScreen() {
  const s = useApp((x) => x.settings);
  const update = useApp((x) => x.updateSettings);
  const [newCat, setNewCat] = useState('');
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void storageEstimate().then(setUsage);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  // Textfelder: lokal halten, beim Verlassen speichern (vermeidet Schreiben bei jedem Tastendruck)
  const [draft, setDraft] = useState(() => ({ company: { ...s.company }, user: { ...s.user }, ai: { ...s.ai }, mail: { ...s.mail } }));
  const commit = (fn: (x: Settings) => void) => void update(fn);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const saveText = (dr = draftRef.current) => commit((x) => {
    x.company = { ...x.company, ...dr.company, logoDataUrl: x.company.logoDataUrl };
    x.user = { ...x.user, name: dr.user.name };
    x.ai = { ...x.ai, apiKey: dr.ai.apiKey.trim(), model: dr.ai.model.trim() };
    x.mail = { ...dr.mail };
  });
  useEffect(() => {
    const t = window.setTimeout(() => saveText(), 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  // beim Verlassen sofort speichern
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => saveText(), []);

  const co = (k: keyof Settings['company']) => (v: string) => setDraft((d) => ({ ...d, company: { ...d.company, [k]: v } }));
  const admin = can(s.user, 'company.manage');
  const catsAllowed = can(s.user, 'categories.manage');

  async function pickLogo() {
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      const c = scaleToCanvas(await loadImage(f), 600);
      const url = c.toDataURL('image/png');
      commit((x) => { x.company.logoDataUrl = url; });
    } catch (e) { toast(errorText(e), 'error'); }
  }

  async function testAi() {
    saveText();
    setTesting(true);
    try {
      await new Promise((r) => setTimeout(r, 50));
      await getAi().test();
      toast('KI-Verbindung funktioniert.', 'success');
    } catch (e) { toast(errorText(e), 'error'); } finally { setTesting(false); }
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`;

  return (
    <div className="screen">
      <Nav title="Einstellungen" backLabel="Start" onBack={() => { saveText(); navigate('/', true); }} />
      <div className="scroll">
        {/* ------------------------------------------------ Benutzer */}
        <div className="group-title">Benutzer</div>
        <div className="list">
          <Field label="Name (Standard-Begeher)" value={draft.user.name} onChange={(v) => setDraft((d) => ({ ...d, user: { ...d.user, name: v } }))} />
          <SelectField label="Rolle" value={s.user.role} onChange={(v) => commit((x) => { x.user.role = v as Role; })}
            options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        </div>
        <div className="group-foot"><UserIcon size={12} /> Ohne Login gilt die Rolle nur auf diesem Gerät (zum Ausprobieren). Mit späterem Login vergibt der Admin die Rollen.</div>

        {/* ------------------------------------------------ Firma */}
        <div className="group-title">Firmeninformationen</div>
        <div className="list">
          <div className="row">
            <div className="row-main">
              <div className="row-title">Firmenlogo</div>
              <div className="row-sub">erscheint auf dem Deckblatt</div>
            </div>
            {s.company.logoDataUrl ? (
              <>
                <img src={s.company.logoDataUrl} alt="Logo" style={{ maxHeight: 40, maxWidth: 110, background: '#fff', borderRadius: 6, padding: 2 }} />
                {admin && <button className="icon-btn" aria-label="Logo entfernen" onClick={() => commit((x) => { x.company.logoDataUrl = ''; })}><X size={18} /></button>}
              </>
            ) : admin ? <button className="btn sm" onClick={pickLogo}><ImagePlus size={16} />Wählen</button> : null}
          </div>
          <Field label="Firmenname" value={draft.company.name} onChange={co('name')} readOnly={!admin} />
          <Field label="Adresse" multiline rows={2} value={draft.company.address} onChange={co('address')} readOnly={!admin} />
          <Field label="Telefon" type="tel" value={draft.company.phone} onChange={co('phone')} readOnly={!admin} />
          <Field label="E-Mail" type="email" value={draft.company.email} onChange={co('email')} readOnly={!admin} />
          <Field label="Website" value={draft.company.website} onChange={co('website')} readOnly={!admin} />
          <Field label="Ansprechpartner" value={draft.company.contact} onChange={co('contact')} readOnly={!admin} />
        </div>
        <div className="group-foot"><Building2 size={12} /> Standard-PDF-Vorlage: unter <a href="#/templates">Vorlagen</a> mit ★ festlegen.</div>

        {/* ------------------------------------------------ Kategorien */}
        <div className="group-title">Kategorien</div>
        <div className="card">
          <div className="chips">
            {s.categories.map((c) => (
              <span key={c} className="chip">{c}{catsAllowed && <button aria-label={`${c} entfernen`} onClick={() => commit((x) => { x.categories = x.categories.filter((y) => y !== c); })}><X size={14} /></button>}</span>
            ))}
          </div>
          {catsAllowed && (
            <div className="hstack" style={{ marginTop: 12 }}>
              <input className="input grow" placeholder="Neue Kategorie" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter' && newCat.trim()) { commit((x) => { if (!x.categories.includes(newCat.trim())) x.categories.push(newCat.trim()); }); setNewCat(''); }
              }} />
              <button className="btn primary" style={{ flex: '0 0 52px', padding: 0 }} aria-label="Kategorie hinzufügen" onClick={() => { if (newCat.trim()) { commit((x) => { if (!x.categories.includes(newCat.trim())) x.categories.push(newCat.trim()); }); setNewCat(''); } }}><Plus size={22} /></button>
            </div>
          )}
          {catsAllowed && <button className="btn sm plain" style={{ marginTop: 6 }} onClick={async () => { if (await confirmDialog({ title: 'Standardkategorien wiederherstellen?', confirmLabel: 'Zurücksetzen' })) commit((x) => { x.categories = [...DEFAULT_CATEGORIES]; }); }}><RotateCcw size={14} />Standard wiederherstellen</button>}
        </div>

        {/* ------------------------------------------------ KI */}
        <div className="group-title">KI-Assistent</div>
        <div className="list">
          <SelectField label="Anbieter" value={s.ai.provider} onChange={(v) => commit((x) => { x.ai.provider = v as Settings['ai']['provider']; })}
            options={[{ value: 'none', label: 'Aus (nur lokale Auswertung)' }, { value: 'gemini', label: 'Google Gemini' }]} />
          {s.ai.provider !== 'none' && (
            <>
              <Field label="API-Schlüssel" type="password" value={draft.ai.apiKey} onChange={(v) => setDraft((d) => ({ ...d, ai: { ...d.ai, apiKey: v } }))} placeholder="hier einfügen (aistudio.google.com)" />
              <Field label="Modell" value={draft.ai.model} onChange={(v) => setDraft((d) => ({ ...d, ai: { ...d.ai, model: v } }))} />
              <SwitchRow title="Sprachaufnahmen an KI senden" sub="für Abschrift + Strukturierung" checked={s.ai.allowAudio} onChange={(v) => commit((x) => { x.ai.allowAudio = v; })} />
              <SwitchRow title="Fotos an KI senden" sub="nur auf Knopfdruck „Foto beschreiben“" checked={s.ai.allowPhotos} onChange={(v) => commit((x) => { x.ai.allowPhotos = v; })} />
            </>
          )}
        </div>
        {s.ai.provider !== 'none' && (
          <>
            <button className="btn block" style={{ marginTop: 10 }} onClick={testAi} disabled={testing || !draft.ai.apiKey.trim()}>{testing ? <Spinner /> : <><Sparkles size={18} />Verbindung testen</>}</button>
            <div style={{ marginTop: 10 }}>
              <Banner kind="info" icon={<ShieldCheck size={20} />}>
                Daten gehen nur bei aktiver KI-Funktion direkt vom iPhone an Google (verschlüsselt per HTTPS) – nie GPS-Koordinaten. <b>Achtung:</b> Beim kostenlosen Gemini-Kontingent darf Google Eingaben zur Verbesserung seiner Dienste nutzen. Für vertrauliche Projektdaten ein kostenpflichtiges Konto verwenden oder KI ausschalten.
              </Banner>
            </div>
          </>
        )}

        {/* ------------------------------------------------ GPS */}
        <div className="group-title">GPS</div>
        <div className="card stack">
          <div>Messungen ungenauer als … bei der Aufzeichnung verwerfen:</div>
          <Seg<string> value={String(s.gps.maxAccuracyM)} onChange={(v) => commit((x) => { x.gps.maxAccuracyM = Number(v); })}
            options={[10, 20, 30, 50].map((n) => ({ value: String(n), label: `±${n} m` }))} />
          <div className="small muted">Smartphone-GPS erreicht im Freien typisch ±3–10 m, im Wald/zwischen Gebäuden deutlich schlechter. Das ist keine Vermessung.</div>
          {s.gps.locationConsent && <button className="btn sm plain" onClick={() => commit((x) => { x.gps.locationConsent = false; })}>Standort-Freigabe in der App zurücknehmen</button>}
        </div>

        {/* ------------------------------------------------ Darstellung */}
        <div className="group-title">Darstellung</div>
        <div className="card stack">
          <Seg<Settings['theme']> value={s.theme} onChange={(v) => commit((x) => { x.theme = v; })} options={[{ value: 'auto', label: 'Automatisch' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }]} />
          <div className="small muted">Tipp: In praller Sonne ist „Hell“ meist besser lesbar.</div>
          <div>Standard-Kartenansicht</div>
          <Seg<MapType> value={s.defaultMapType} onChange={(v) => commit((x) => { x.defaultMapType = v; })} options={(Object.keys(MAP_TYPES) as MapType[]).map((k) => ({ value: k, label: MAP_TYPES[k].label }))} />
        </div>

        {/* ------------------------------------------------ E-Mail */}
        <div className="group-title">E-Mail-Vorlage</div>
        <div className="list">
          <Field label="Standard-Empfänger" type="email" value={draft.mail.to} onChange={(v) => setDraft((d) => ({ ...d, mail: { ...d.mail, to: v } }))} />
          <Field label="CC" type="email" value={draft.mail.cc} onChange={(v) => setDraft((d) => ({ ...d, mail: { ...d.mail, cc: v } }))} />
          <Field label="Betreff" value={draft.mail.subject} onChange={(v) => setDraft((d) => ({ ...d, mail: { ...d.mail, subject: v } }))} />
          <Field label="Text" multiline rows={5} value={draft.mail.body} onChange={(v) => setDraft((d) => ({ ...d, mail: { ...d.mail, body: v } }))} />
        </div>
        <div className="group-foot">Platzhalter: {'{projekt} {nummer} {datum} {begeher} {auftraggeber}'}</div>

        {/* ------------------------------------------------ Speicher */}
        <div className="group-title">Speicher & Datenschutz</div>
        <div className="list">
          <div className="row"><div className="row-main"><div className="row-title">Belegt</div></div><div className="row-value">{usage ? `${mb(usage.usage)}${usage.quota ? ` von ${mb(usage.quota)}` : ''}` : '–'}</div></div>
          <div className="row"><div className="row-main"><div className="row-title">Dauerhaft gespeichert</div><div className="row-sub">Schutz vor automatischem Löschen durch iOS</div></div><div className="row-value">{persisted === null ? 'unbekannt' : persisted ? 'ja' : 'nein'}</div></div>
          <div className="row"><div className="row-main"><div className="row-title">Synchronisierung</div></div><div className="row-value">{getSync().label}</div></div>
        </div>
        <div className="group-foot">
          Alle Begehungen, Fotos und Standortdaten liegen nur in diesem Browser-Speicher auf dem Gerät (durch die iPhone-Gerätesperre verschlüsselt). iOS kann Daten von Web-Apps löschen, die lange nicht geöffnet wurden – daher als App zum Home-Bildschirm hinzufügen und regelmäßig Sicherungen bzw. PDFs teilen.
        </div>

        <div className="group-title">Über</div>
        <div className="card small muted">
          Begehungsprotokoll v1.0 · Karten © OpenStreetMap-Mitwirkende, Luftbild © Esri u. a. · PDF mit pdf-lib, Vorschau mit pdf.js.
        </div>
        {s.user.role === 'viewer' && (
          <div style={{ marginTop: 12 }}><Banner kind="info">Als „Lesender Benutzer“ sind Bearbeitungen gesperrt. Rolle oben zurückstellen, um wieder zu bearbeiten.</Banner></div>
        )}
        <button className="btn danger block" style={{ marginTop: 20 }} onClick={async () => {
          if (await confirmDialog({ title: 'KI-Schlüssel löschen?', confirmLabel: 'Löschen', destructive: true })) {
            setDraft((d) => ({ ...d, ai: { ...d.ai, apiKey: '' } }));
            commit((x) => { x.ai.apiKey = ''; });
          }
        }}><Trash2 size={16} />KI-Schlüssel vom Gerät löschen</button>
      </div>
    </div>
  );
}
