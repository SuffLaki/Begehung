// GPS: Standortdienst (Live-Position) und Trassen-Aufzeichnung.
//
// Grundlage ist die Geolocation-API des Browsers. Sie funktioniert nur über HTTPS
// und erst nach Freigabe durch den Benutzer. iOS liefert Positionen nur, solange
// die App im Vordergrund und der Bildschirm an ist – eine Aufzeichnung im
// Hintergrund oder bei gesperrtem Bildschirm ist mit Web-Apps nicht möglich.

import { create } from 'zustand';
import type { GeoFix, GpsTrack } from '../model/types';
import { confirmDialog, useApp } from '../state/appStore';
import { useInspection } from '../state/inspectionStore';
import { uid } from '../model/factory';
import { distance } from './geo';

export type GpsStatus = 'off' | 'searching' | 'active' | 'denied' | 'unavailable';

interface GpsState {
  status: GpsStatus;
  fix: GeoFix | null;
  error: string;
}

export const useGps = create<GpsState>(() => ({ status: 'off', fix: null, error: '' }));

type FixListener = (f: GeoFix) => void;
const listeners = new Set<FixListener>();
let watchId: number | null = null;

function toFix(p: GeolocationPosition): GeoFix {
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, timestamp: p.timestamp || Date.now() };
}

function geoError(e: GeolocationPositionError): string {
  if (e.code === e.PERMISSION_DENIED) return 'Standortzugriff verweigert. Unter iOS: Einstellungen → Datenschutz → Ortungsdienste → Safari-Websites → „Beim Verwenden“.';
  if (e.code === e.POSITION_UNAVAILABLE) return 'Kein GPS-Signal verfügbar.';
  return 'Standort konnte nicht rechtzeitig ermittelt werden.';
}

/** Fragt einmalig in der App nach, bevor der Browser die Systemabfrage zeigt. */
export async function ensureLocationConsent(): Promise<boolean> {
  const app = useApp.getState();
  if (app.settings.gps.locationConsent) return true;
  const ok = await confirmDialog({
    title: 'Standort verwenden?',
    message: 'Die App nutzt deinen Standort, um Trassenpunkte, Fotos und Notizen zu verorten. Die Koordinaten bleiben auf diesem Gerät und landen nur im Protokoll. Anschließend fragt iOS noch einmal nach.',
    confirmLabel: 'Standort erlauben',
    cancelLabel: 'Nicht jetzt',
  });
  if (ok) await app.updateSettings((s) => { s.gps.locationConsent = true; });
  return ok;
}

export function gpsSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

export async function startGps(): Promise<boolean> {
  if (!gpsSupported()) {
    useGps.setState({ status: 'unavailable', error: 'Dieses Gerät/dieser Browser bietet keine Standortbestimmung.' });
    return false;
  }
  if (watchId !== null) return true;
  if (!(await ensureLocationConsent())) return false;
  useGps.setState({ status: 'searching', error: '' });
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const f = toFix(p);
      useGps.setState({ status: 'active', fix: f, error: '' });
      listeners.forEach((l) => l(f));
    },
    (e) => {
      const denied = e.code === e.PERMISSION_DENIED;
      useGps.setState({ status: denied ? 'denied' : useGps.getState().fix ? 'active' : 'searching', error: geoError(e) });
      if (denied) stopGps();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 },
  );
  return true;
}

export function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (useGps.getState().status !== 'denied') useGps.setState({ status: 'off' });
}

export function onFix(l: FixListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Aktuelle Position – aus der Live-Position, wenn sie frisch genug ist, sonst neu gemessen. */
export async function currentFix(maxAgeMs = 20000, timeoutMs = 15000): Promise<GeoFix> {
  const cur = useGps.getState().fix;
  if (cur && Date.now() - cur.timestamp <= maxAgeMs) return cur;
  if (!gpsSupported()) throw new Error('Keine Standortbestimmung verfügbar.');
  if (!(await ensureLocationConsent())) throw new Error('Standort nicht freigegeben.');
  void startGps();
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const f = toFix(p);
        useGps.setState({ status: 'active', fix: f, error: '' });
        resolve(f);
      },
      (e) => reject(new Error(geoError(e))),
      { enableHighAccuracy: true, maximumAge: maxAgeMs, timeout: timeoutMs },
    );
  });
}

/** Position, falls schnell verfügbar – sonst null (für Fotos/Notizen, die nicht warten sollen). */
export async function fixIfAvailable(maxAgeMs = 60000): Promise<GeoFix | null> {
  const cur = useGps.getState().fix;
  if (cur && Date.now() - cur.timestamp <= maxAgeMs) return cur;
  if (!useApp.getState().settings.gps.locationConsent) return null;
  try {
    return await currentFix(maxAgeMs, 8000);
  } catch {
    return null;
  }
}

export function accuracyLabel(acc: number | null | undefined): { text: string; level: 'good' | 'ok' | 'bad' | 'none' } {
  if (acc == null) return { text: 'Genauigkeit unbekannt', level: 'none' };
  const level = acc <= 8 ? 'good' : acc <= 25 ? 'ok' : 'bad';
  return { text: `±${Math.round(acc)} m`, level };
}

// ================================================================ Aufzeichnung

interface RecorderState {
  trackId: string | null;
  paused: boolean;
  /** Beginn des aktuellen (nicht pausierten) Abschnitts */
  runStartedAt: number | null;
}

export const useRecorder = create<RecorderState>(() => ({ trackId: null, paused: false, runStartedAt: null }));

let unsubscribeFix: (() => void) | null = null;
let wakeLock: { release(): Promise<void> } | null = null;

async function lockScreen() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (wl) wakeLock = await wl.request('screen');
  } catch { /* nicht unterstützt – Hinweis wird in der UI angezeigt */ }
}

function unlockScreen() {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function recordFix(f: GeoFix) {
  const { trackId, paused } = useRecorder.getState();
  if (!trackId || paused) return;
  const maxAcc = useApp.getState().settings.gps.maxAccuracyM;
  useInspection.getState().mutate((d) => {
    const t = d.route.tracks.find((x) => x.id === trackId);
    if (!t) return;
    if (f.accuracy != null && f.accuracy > maxAcc) {
      t.rejected += 1;
      return;
    }
    const last = t.fixes[t.fixes.length - 1];
    // kleine Bewegungen innerhalb des Messrauschens ignorieren
    if (last && distance(last, f) < Math.max(3, (f.accuracy ?? 5) * 0.5)) return;
    t.fixes.push({ lat: f.lat, lng: f.lng, acc: f.accuracy, t: f.timestamp });
  }, { undoable: false });
}

export async function startRecording(): Promise<boolean> {
  if (!(await startGps())) return false;
  const track: GpsTrack = { id: uid('g'), startedAt: Date.now(), endedAt: null, durationMs: 0, fixes: [], rejected: 0, convertedSegmentId: null };
  useInspection.getState().mutate((d) => { d.route.tracks.push(track); }, { undoable: false });
  useRecorder.setState({ trackId: track.id, paused: false, runStartedAt: Date.now() });
  unsubscribeFix?.();
  unsubscribeFix = onFix(recordFix);
  const cur = useGps.getState().fix;
  if (cur && Date.now() - cur.timestamp < 5000) recordFix(cur);
  await lockScreen();
  return true;
}

function addRunTime() {
  const { trackId, runStartedAt } = useRecorder.getState();
  if (!trackId || !runStartedAt) return;
  const add = Date.now() - runStartedAt;
  useInspection.getState().mutate((d) => {
    const t = d.route.tracks.find((x) => x.id === trackId);
    if (t) t.durationMs += add;
  }, { undoable: false });
}

export function pauseRecording() {
  addRunTime();
  useRecorder.setState({ paused: true, runStartedAt: null });
  unlockScreen();
}

export async function resumeRecording(trackId?: string) {
  if (!(await startGps())) return;
  const id = trackId ?? useRecorder.getState().trackId;
  if (!id) return;
  useRecorder.setState({ trackId: id, paused: false, runStartedAt: Date.now() });
  unsubscribeFix?.();
  unsubscribeFix = onFix(recordFix);
  await lockScreen();
}

export function stopRecording() {
  const { trackId, paused } = useRecorder.getState();
  if (!trackId) return;
  if (!paused) addRunTime();
  useInspection.getState().mutate((d) => {
    const t = d.route.tracks.find((x) => x.id === trackId);
    if (t) t.endedAt = Date.now();
  }, { undoable: false });
  unsubscribeFix?.();
  unsubscribeFix = null;
  useRecorder.setState({ trackId: null, paused: false, runStartedAt: null });
  unlockScreen();
}

/** Nach Neustart der App: offene Aufzeichnung als pausiert anbieten. */
export function adoptOpenTrack(tracks: GpsTrack[]) {
  if (useRecorder.getState().trackId) return;
  const open = tracks.find((t) => t.endedAt === null);
  if (open) useRecorder.setState({ trackId: open.id, paused: true, runStartedAt: null });
}

export function resetRecorder() {
  if (useRecorder.getState().trackId && !useRecorder.getState().paused) pauseRecording();
  unsubscribeFix?.();
  unsubscribeFix = null;
  useRecorder.setState({ trackId: null, paused: false, runStartedAt: null });
}

document.addEventListener('visibilitychange', () => {
  // Wake Lock geht beim Wechsel in den Hintergrund verloren → beim Zurückkommen erneuern
  if (document.visibilityState === 'visible' && useRecorder.getState().trackId && !useRecorder.getState().paused) void lockScreen();
});
