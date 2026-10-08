// Minimales Hash-Routing (#/pfad) – funktioniert auf GitHub Pages und offline.

import { useEffect, useState } from 'react';

function current(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string[] {
  const [path, setPath] = useState(current());
  useEffect(() => {
    const on = () => setPath(current());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path.split('?')[0].split('/').filter(Boolean);
}

export function navigate(to: string, replace = false) {
  const url = '#' + to;
  if (replace) window.location.replace(url);
  else window.location.hash = to;
}

/** Eine Ebene nach oben (feste Hierarchie statt Browser-Verlauf – verlässlicher in der Home-Bildschirm-App). */
export function back(fallback = '/') {
  navigate(fallback, true);
}
