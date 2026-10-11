// Teilnehmer der Begehung (Name, Betrieb, Telefon, E-Mail).
// Bekannte Personen aus früheren Begehungen werden beim Tippen vorgeschlagen.

import { Plus, Trash2, UserRound } from 'lucide-react';
import type { Participant } from '../model/types';
import { uid } from '../model/factory';
import { useApp } from '../state/appStore';

export function newParticipant(): Participant {
  return { id: uid('tn'), name: '', company: '', phone: '', email: '' };
}

export default function ParticipantsEditor({ value, onChange, readOnly }: { value: Participant[]; onChange: (v: Participant[]) => void; readOnly?: boolean }) {
  const known = useApp((s) => s.settings.contacts);
  const contacts = known ?? [];
  const set = (id: string, k: keyof Participant, v: string) => onChange(value.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p, [k]: v };
    // bekannten Kontakt beim Namen automatisch ergänzen
    if (k === 'name') {
      const c = contacts.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
      if (c) return { ...next, company: next.company || c.company, phone: next.phone || c.phone, email: next.email || c.email };
    }
    return next;
  }));

  return (
    <>
      <datalist id="known-contacts">{contacts.map((c) => <option key={c.id} value={c.name}>{c.company}</option>)}</datalist>
      {value.length === 0 && <div className="small muted" style={{ margin: '0 4px 8px' }}>Noch keine Teilnehmer eingetragen.</div>}
      {value.map((p, i) => (
        <div key={p.id} className="list" style={{ marginBottom: 10 }}>
          <div className="row" style={{ minHeight: 40, paddingTop: 6, paddingBottom: 0 }}>
            <UserRound size={18} color="var(--text-3)" />
            <div className="row-main"><div className="small muted">Teilnehmer {i + 1}</div></div>
            {!readOnly && <button className="icon-btn" aria-label={`Teilnehmer ${i + 1} entfernen`} onClick={() => onChange(value.filter((x) => x.id !== p.id))}><Trash2 size={18} color="var(--danger)" /></button>}
          </div>
          <div className="field">
            <label htmlFor={`tn-name-${p.id}`}>Name</label>
            <input id={`tn-name-${p.id}`} list="known-contacts" value={p.name} readOnly={readOnly} autoComplete="off" onChange={(e) => set(p.id, 'name', e.target.value)} placeholder="Vor- und Nachname" />
          </div>
          <div className="field">
            <label htmlFor={`tn-company-${p.id}`}>Betrieb / Firma</label>
            <input id={`tn-company-${p.id}`} value={p.company} readOnly={readOnly} onChange={(e) => set(p.id, 'company', e.target.value)} placeholder="z. B. Netze BW, Tiefbau Müller" />
          </div>
          <div className="hstack" style={{ alignItems: 'stretch' }}>
            <div className="field grow">
              <label htmlFor={`tn-phone-${p.id}`}>Telefon</label>
              <input id={`tn-phone-${p.id}`} type="tel" inputMode="tel" value={p.phone} readOnly={readOnly} onChange={(e) => set(p.id, 'phone', e.target.value)} placeholder="0171 …" />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`tn-mail-${p.id}`}>E-Mail</label>
            <input id={`tn-mail-${p.id}`} type="email" inputMode="email" value={p.email} readOnly={readOnly} onChange={(e) => set(p.id, 'email', e.target.value)} placeholder="name@firma.de" />
          </div>
        </div>
      ))}
      {!readOnly && <button className="btn block" onClick={() => onChange([...value, newParticipant()])}><Plus size={18} />Teilnehmer hinzufügen</button>}
    </>
  );
}

/** Teilnehmer in die Kontaktliste übernehmen (für Vorschläge bei späteren Begehungen) */
export function mergeContacts(known: Participant[], add: Participant[]): Participant[] {
  const out = [...known];
  for (const p of add) {
    if (!p.name.trim()) continue;
    const i = out.findIndex((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    const entry = { ...p, id: i >= 0 ? out[i].id : uid('ct'), name: p.name.trim() };
    if (i >= 0) out[i] = { ...out[i], ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v)) } as Participant;
    else out.push(entry);
  }
  return out.slice(-200);
}
