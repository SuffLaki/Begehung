// Warteschlange für Aufgaben, die Internet brauchen (Sprachaufnahmen → KI).
//
// Im Funkloch aufgenommene Sprache wird lokal gespeichert und automatisch
// ausgewertet, sobald wieder eine Verbindung besteht. Das Ergebnis landet als
// unbestätigte Notiz in der Begehung (zur Kontrolle durch den Benutzer).
//
// Hinweis Synchronisierung: Es gibt (noch) keinen Server. Alle Begehungsdaten
// liegen ausschließlich auf dem Gerät. Ein späterer Server-Abgleich wird über
// die Schnittstelle SyncAdapter (sync.ts) angebunden.

import { deleteJob, getInspection, listJobs, saveInspection, saveJob } from '../storage/db';
import { useApp } from '../state/appStore';
import { useInspection } from '../state/inspectionStore';
import { aiConfigured, getAi, isNetworkError } from '../ai/ai';
import { newNote, uid } from '../model/factory';
import type { Inspection, JobType, Note } from '../model/types';

export async function refreshPendingCount() {
  try {
    useApp.getState().setPendingJobs((await listJobs()).length);
  } catch { /* ignore */ }
}

export async function queueVoiceJob(inspectionId: string, type: JobType, audio: Blob, durationS: number) {
  await saveJob({ id: uid('j'), inspectionId, type, audio, durationS, createdAt: Date.now(), attempts: 0, lastError: '' });
  await refreshPendingCount();
}

let running = false;

/** Arbeitet die Warteschlange ab. Gibt die Anzahl erledigter Aufträge zurück. */
export async function processJobs(): Promise<number> {
  if (running || !navigator.onLine || !aiConfigured()) return 0;
  running = true;
  let done = 0;
  try {
    const app = useApp.getState();
    for (const job of await listJobs()) {
      try {
        const ai = getAi();
        let note: Note;
        if (job.type === 'voice-note') {
          const r = await ai.voiceNote(job.audio, app.settings.categories);
          note = newNote({
            kind: 'observation', origin: 'voice', transcript: r.transcript, aiStructured: true, confirmed: false,
            title: r.draft.title, station: r.draft.station, category: r.draft.category, description: r.draft.description || r.transcript, hint: r.draft.hint,
            createdAt: job.createdAt,
          });
        } else {
          const r = await ai.voiceRoute(job.audio);
          note = newNote({
            kind: 'note', origin: 'voice', transcript: r.transcript, confirmed: false, category: 'Trassenverlauf',
            title: 'Trassenbeschreibung (Sprache)', description: r.transcript, status: 'info', createdAt: job.createdAt,
          });
        }
        await addNoteTo(job.inspectionId, note);
        await deleteJob(job.id);
        done++;
      } catch (e) {
        if (isNetworkError(e)) break; // wieder offline → später weiter
        job.attempts++;
        job.lastError = (e as Error).message ?? String(e);
        await saveJob(job);
        if (/Kontingent|Schlüssel|nicht gefunden/.test(job.lastError)) break;
      }
    }
  } finally {
    running = false;
    await refreshPendingCount();
  }
  if (done) useApp.getState().toast(`${done} Sprachaufnahme(n) ausgewertet – bitte in den Notizen prüfen.`, 'success');
  return done;
}

async function addNoteTo(inspectionId: string, note: Note) {
  const store = useInspection.getState();
  if (store.insp?.id === inspectionId) {
    store.mutate((d) => { d.notes.push(note); });
    return;
  }
  const insp: Inspection | undefined = await getInspection(inspectionId);
  if (!insp) return; // Begehung inzwischen gelöscht
  insp.notes.push(note);
  insp.updatedAt = Date.now();
  await saveInspection(insp);
}

export function startJobWatcher() {
  const tick = () => void processJobs();
  window.addEventListener('online', () => { useApp.getState().setOnline(true); tick(); });
  window.addEventListener('offline', () => useApp.getState().setOnline(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  window.setInterval(tick, 60_000);
  void refreshPendingCount().then(tick);
}
