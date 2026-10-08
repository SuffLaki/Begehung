// Schnellaktionen der Begehung (Standort, Foto, Sprache, Notiz) und der
// Zustand der Bearbeitungs-Sheets. Von allen Tabs aus nutzbar.

import { create } from 'zustand';
import { useInspection } from '../../state/inspectionStore';
import { confirmDialog, errorText, toast, useApp } from '../../state/appStore';
import { currentFix, fixIfAvailable } from '../../geo/gps';
import { addRoutePoint } from '../../geo/routeOps';
import { addPhotos, pickImages } from '../../camera/photo';
import { pointDisplayName } from '../../model/factory';

export type VoiceMode = 'note' | 'route';

interface UiState {
  pointId: string | null;
  photoId: string | null;
  /** 'new' = neue Notiz */
  noteId: string | null;
  notePrefill: { pointId?: string | null } | null;
  voice: { mode: VoiceMode; text?: string } | null;
  segmentsOpen: boolean;
  recorderOpen: boolean;
  set(p: Partial<UiState>): void;
}

export const useUi = create<UiState>((set) => ({
  pointId: null,
  photoId: null,
  noteId: null,
  notePrefill: null,
  voice: null,
  segmentsOpen: false,
  recorderOpen: false,
  set: (p) => set(p),
}));

export function resetUi() {
  useUi.setState({ pointId: null, photoId: null, noteId: null, notePrefill: null, voice: null, segmentsOpen: false, recorderOpen: false });
}

/** 📍 Aktuelle GPS-Position als nächsten Trassenpunkt setzen */
export async function actionLocation() {
  const maxAcc = useApp.getState().settings.gps.maxAccuracyM;
  let fix;
  try {
    toast('Standort wird ermittelt …');
    fix = await currentFix(10000, 20000);
  } catch (e) {
    toast(errorText(e), 'error');
    return;
  }
  if (fix.accuracy != null && fix.accuracy > maxAcc) {
    const ok = await confirmDialog({
      title: 'Ungenaue Position',
      message: `Das GPS meldet nur ±${Math.round(fix.accuracy)} m Genauigkeit (Grenze: ${maxAcc} m). Trotzdem setzen? Du kannst den Punkt später verschieben.`,
      confirmLabel: 'Trotzdem setzen',
    });
    if (!ok) return;
  }
  let label = '';
  let id = '';
  useInspection.getState().mutate((d) => {
    const p = addRoutePoint(d, fix, { source: 'gps', accuracy: fix.accuracy });
    label = pointDisplayName(p);
    id = p.id;
  });
  toast(`${label} gesetzt${fix.accuracy ? ` (±${Math.round(fix.accuracy)} m)` : ''}`, 'success', {
    label: 'Bearbeiten',
    run: () => useUi.getState().set({ pointId: id }),
  });
}

/** 📷 Kamera öffnen. Muss synchron im Klick-Handler starten (iOS). */
export function actionPhoto(opts: { pointId?: string | null; noteId?: string | null; library?: boolean } = {}) {
  const fixPromise = fixIfAvailable();
  const picking = pickImages({ camera: !opts.library, multiple: !!opts.library });
  void (async () => {
    const files = await picking;
    if (!files.length) return;
    try {
      const added = await addPhotos(files, { pointId: opts.pointId, noteId: opts.noteId, fixPromise });
      if (!added.length) return;
      const insp = useInspection.getState().insp!;
      const last = added[added.length - 1];
      const pt = last.pointId ? insp.route.points.find((p) => p.id === last.pointId) : null;
      const msg = added.length > 1
        ? `${added.length} Fotos gespeichert`
        : `Foto ${last.number} gespeichert${pt ? ` · ${pointDisplayName(pt)}${last.pointAutoAssigned ? ' (automatisch)' : ''}` : ''}${last.position ? '' : ' · ohne GPS'}`;
      toast(msg, 'success', { label: 'Bearbeiten', run: () => useUi.getState().set({ photoId: last.id }) });
    } catch (e) {
      toast(`Foto konnte nicht gespeichert werden: ${errorText(e)}`, 'error');
    }
  })();
}

export function actionVoice(mode: VoiceMode = 'note', text?: string) {
  useUi.getState().set({ voice: { mode, text } });
}

export function actionNote(pointId: string | null = null) {
  useUi.getState().set({ noteId: 'new', notePrefill: { pointId } });
}
