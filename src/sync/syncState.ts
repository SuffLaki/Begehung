// Abgleich-Zustand dieses Geräts: Geräte-ID, Stand der letzten Abgleiche je Begehung,
// gelöschte Begehungen (Grabsteine) und ein kurzes Protokoll.
// Liegt als eigener Datensatz im Store „settings“ (id „sync-state“), getrennt von den Einstellungen.

import { db } from '../storage/db';
import { uid } from '../model/factory';
import type { Inspection } from '../model/types';

export interface SyncLogEntry {
  at: number;
  kind: 'export' | 'import';
  /** Gegenstelle bzw. Dateiname */
  peer: string;
  summary: string;
}

export interface SyncState {
  id: 'sync-state';
  deviceId: string;
  deviceName: string;
  /** updatedAt einer Begehung beim letzten Abgleich (Export oder Import) */
  synced: Record<string, number>;
  /** gelöschte Begehungen, damit der Desktop sie ebenfalls entfernen kann */
  tombstones: { id: string; deletedAt: number }[];
  lastExportAt: number | null;
  lastImportAt: number | null;
  log: SyncLogEntry[];
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
  if (/Android/.test(ua)) return 'Android-Gerät';
  return 'Browser';
}

export async function getSyncState(): Promise<SyncState> {
  const d = await db();
  const rec = (await d.get('settings', 'sync-state')) as SyncState | undefined;
  if (rec) return rec;
  const fresh: SyncState = {
    id: 'sync-state', deviceId: uid('dev'), deviceName: defaultDeviceName(),
    synced: {}, tombstones: [], lastExportAt: null, lastImportAt: null, log: [],
  };
  await saveSyncState(fresh);
  return fresh;
}

export async function saveSyncState(s: SyncState): Promise<void> {
  s.log = s.log.slice(-30);
  // Grabsteine nach 180 Tagen vergessen
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
  s.tombstones = s.tombstones.filter((t) => t.deletedAt > cutoff);
  await (await db()).put('settings', s as never);
}

export async function addTombstone(id: string): Promise<void> {
  const s = await getSyncState();
  s.tombstones = [...s.tombstones.filter((t) => t.id !== id), { id, deletedAt: Date.now() }];
  delete s.synced[id];
  await saveSyncState(s);
}

/** Geändert seit dem letzten Abgleich (oder noch nie abgeglichen) */
export function isDirty(s: SyncState, insp: Pick<Inspection, 'id' | 'updatedAt'>): boolean {
  const at = s.synced[insp.id];
  return at === undefined || insp.updatedAt > at;
}

export async function renameDevice(name: string): Promise<void> {
  const s = await getSyncState();
  s.deviceName = name.trim() || defaultDeviceName();
  await saveSyncState(s);
}
