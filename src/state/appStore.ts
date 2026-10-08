// App-weiter Zustand: Einstellungen, Verbindungsstatus, Toasts, Bestätigungsdialoge.

import { create } from 'zustand';
import type { Settings } from '../model/types';
import { defaultSettings } from '../model/factory';
import { loadSettings, saveSettings } from '../storage/db';

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

interface AppState {
  settings: Settings;
  settingsLoaded: boolean;
  online: boolean;
  pendingJobs: number;
  toasts: Toast[];
  confirmReq: ConfirmRequest | null;
  initSettings(): Promise<void>;
  updateSettings(fn: (s: Settings) => void): Promise<void>;
  setOnline(v: boolean): void;
  setPendingJobs(n: number): void;
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: number): void;
}

let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  settings: defaultSettings(),
  settingsLoaded: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingJobs: 0,
  toasts: [],
  confirmReq: null,

  async initSettings() {
    const s = await loadSettings();
    set({ settings: s, settingsLoaded: true });
  },

  async updateSettings(fn) {
    const next = structuredClone(get().settings);
    fn(next);
    set({ settings: next });
    await saveSettings(next);
  },

  setOnline: (v) => set({ online: v }),
  setPendingJobs: (n) => set({ pendingJobs: n }),

  toast(text, kind = 'info', action) {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-1), { id, text, kind, action }] }));
    window.setTimeout(() => get().dismissToast(id), action ? 5000 : kind === 'error' ? 6000 : 2500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, kind?: Toast['kind'], action?: Toast['action']) => useApp.getState().toast(text, kind, action);

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useApp.setState({
      confirmReq: {
        ...opts,
        resolve: (ok) => {
          useApp.setState({ confirmReq: null });
          resolve(ok);
        },
      },
    });
  });
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
