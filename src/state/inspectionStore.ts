// Zustand der geöffneten Begehung inkl. Undo/Redo und automatischem Speichern.
//
// Jede Änderung läuft über mutate(): Kopie erzeugen → ändern → speichern.
// Die Kopie vorher wandert in den Undo-Verlauf. GPS-Rohdaten werden beim
// Rückgängig-Machen bewusst NICHT zurückgedreht, damit keine Messungen verloren gehen.

import { create } from 'zustand';
import type { Inspection } from '../model/types';
import { deletePhotoBlob, db, getInspection, saveInspection } from '../storage/db';

const HISTORY_LIMIT = 60;
const SAVE_DELAY = 350;

interface InspectionState {
  insp: Inspection | null;
  past: Inspection[];
  future: Inspection[];
  dirty: boolean;
  saveError: string;
  lastSavedAt: number;
  load(id: string): Promise<boolean>;
  close(): Promise<void>;
  mutate(fn: (draft: Inspection) => void, opts?: { undoable?: boolean }): void;
  undo(): void;
  redo(): void;
  flush(): Promise<void>;
}

let saveTimer: number | undefined;

function keepTracks(target: Inspection, current: Inspection): Inspection {
  const convertedById = new Map(target.route.tracks.map((t) => [t.id, t.convertedSegmentId]));
  target.route.tracks = current.route.tracks.map((t) => ({
    ...t,
    convertedSegmentId: convertedById.has(t.id) ? convertedById.get(t.id)! : t.convertedSegmentId,
  }));
  return target;
}

export const useInspection = create<InspectionState>((set, get) => ({
  insp: null,
  past: [],
  future: [],
  dirty: false,
  saveError: '',
  lastSavedAt: 0,

  async load(id) {
    if (get().insp?.id === id) return true;
    await get().flush();
    const insp = await getInspection(id);
    if (!insp) return false;
    set({ insp, past: [], future: [], dirty: false, saveError: '' });
    void collectOrphanPhotos(insp);
    return true;
  },

  async close() {
    await get().flush();
    set({ insp: null, past: [], future: [] });
  },

  mutate(fn, opts = {}) {
    const cur = get().insp;
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    next.updatedAt = Date.now();
    const undoable = opts.undoable !== false;
    set((s) => ({
      insp: next,
      past: undoable ? [...s.past.slice(-HISTORY_LIMIT + 1), cur] : s.past,
      future: undoable ? [] : s.future,
      dirty: true,
    }));
    scheduleSave();
  },

  undo() {
    const { past, insp } = get();
    if (!past.length || !insp) return;
    const prev = keepTracks(structuredClone(past[past.length - 1]), insp);
    prev.updatedAt = Date.now();
    set({ insp: prev, past: past.slice(0, -1), future: [insp, ...get().future], dirty: true });
    scheduleSave();
  },

  redo() {
    const { future, insp } = get();
    if (!future.length || !insp) return;
    const next = keepTracks(structuredClone(future[0]), insp);
    next.updatedAt = Date.now();
    set({ insp: next, future: future.slice(1), past: [...get().past, insp], dirty: true });
    scheduleSave();
  },

  async flush() {
    window.clearTimeout(saveTimer);
    const { insp, dirty } = get();
    if (!insp || !dirty) return;
    try {
      await saveInspection(insp);
      // nur als gespeichert markieren, wenn seitdem nichts Neues kam
      if (get().insp === insp) set({ dirty: false, saveError: '', lastSavedAt: Date.now() });
    } catch (e) {
      set({ saveError: speicherFehler(e) });
    }
  },
}));

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void useInspection.getState().flush(), SAVE_DELAY);
}

function speicherFehler(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return 'Gerätespeicher voll – Änderungen konnten nicht gespeichert werden.';
  return 'Speichern fehlgeschlagen: ' + String((e as Error)?.message ?? e);
}

/** Fotos, die nicht mehr in der Begehung vorkommen (gelöscht, rückgängig gemacht …), freigeben. */
async function collectOrphanPhotos(insp: Inspection) {
  try {
    const keys = await (await db()).getAllKeysFromIndex('photos', 'byInspection', insp.id);
    const used = new Set(insp.photos.map((p) => p.id));
    for (const k of keys) if (!used.has(k)) await deletePhotoBlob(k);
  } catch { /* nicht kritisch */ }
}

// Beim Verlassen / in den Hintergrund gehen sofort speichern (iOS beendet Web-Apps ohne Vorwarnung).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void useInspection.getState().flush();
  });
  window.addEventListener('pagehide', () => void useInspection.getState().flush());
}
