// Objekt-URLs für Fotos aus IndexedDB, mit Cache (Fotos ändern sich nie).

import { useEffect, useState } from 'react';
import { getPhotoBlob } from '../storage/db';

const cache = new Map<string, string>();

export async function photoUrl(id: string, kind: 'thumb' | 'full'): Promise<string | null> {
  const key = `${kind}:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rec = await getPhotoBlob(id);
  if (!rec) return null;
  const url = URL.createObjectURL(kind === 'thumb' ? rec.thumb : rec.full);
  cache.set(key, url);
  return url;
}

export function usePhotoUrl(id: string | null | undefined, kind: 'thumb' | 'full' = 'thumb'): string | null {
  const [url, setUrl] = useState<string | null>(id ? cache.get(`${kind}:${id}`) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    void photoUrl(id, kind).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id, kind]);
  return url;
}
