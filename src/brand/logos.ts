// App-Symbole von Trasso (SVG, 512 × 512, vollflächig – die Rundung macht iOS bzw. CSS).
// Inhalt bleibt im inneren Bereich, damit auch runde Masken (Android „maskable“) nichts abschneiden.

export type LogoGroup = 'breitband' | 'allgemein';

export interface AppLogo {
  id: string;
  name: string;
  group: LogoGroup;
  /** Hintergrundverlauf (Startbildschirm) */
  bg: [string, string];
  svg: string;
}

// Animations-Klassen für den Startbildschirm (wirken nur, wenn das SVG inline steht – siehe design.css):
// a-draw = Linie zeichnen (pathLength=1), a-pop = aufploppen, a-drop = hereinfallen, a-fade = einblenden,
// a-glow = pulsierendes Leuchten. Reihenfolge über --i. Als <img> ist das Logo einfach das fertige Bild.

export const DEFAULT_LOGO = 'glasfaser';

const GREEN: [string, string] = ['#2a7457', '#0d2a21'];
const MAGENTA: [string, string] = ['#f0168a', '#6e003f'];

function wrap(bg: [string, string], body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
    + `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient>`
    + `<radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="512" height="512" fill="url(#bg)"/>${body}</svg>`;
}

/** Glasfaserbündel: Fasern kommen aus dem Rohr und enden als Lichtpunkte */
function fiber(bg: [string, string], colors: string[], duct: string): string {
  const strands = colors.map((c, i) => {
    const y0 = 330 + i * 16;
    const y1 = 108 + i * 52;
    return `<path class="a-draw" style="--i:${i}" pathLength="1" d="M120 ${y0} C 236 ${y0}, 250 ${y1}, 372 ${y1}" fill="none" stroke="${c}" stroke-width="13" stroke-linecap="round"/>`
      + `<g class="a-pop" style="--i:${i}"><circle class="a-glow" cx="392" cy="${y1}" r="34" fill="url(#glow)"/><circle cx="388" cy="${y1}" r="15" fill="${c}" stroke="#fff" stroke-width="5"/></g>`;
  }).join('');
  return wrap(bg, strands + `<g class="a-fade"><rect x="78" y="304" width="72" height="128" rx="22" fill="${duct}" stroke="#fff" stroke-width="8"/>`
    + `<path d="M150 330 v76" stroke="rgba(255,255,255,0.35)" stroke-width="6"/></g>`);
}

/** Mikrorohrverband im Querschnitt (Speedpipe) */
function microduct(bg: [string, string], jacket: string): string {
  const inner = '#0e271f';
  const colors = ['#e5322d', '#2fb35a', '#2f7de1', '#f4c430', '#f2f2f2', '#9aa0a6'];
  const tubes = colors.map((c, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    const x = (256 + 88 * Math.cos(a)).toFixed(1), y = (256 + 88 * Math.sin(a)).toFixed(1);
    return `<g class="a-pop" style="--i:${i}"><circle cx="${x}" cy="${y}" r="40" fill="${c}"/><circle cx="${x}" cy="${y}" r="21" fill="${inner}"/></g>`;
  }).join('');
  return wrap(bg, `<circle cx="256" cy="256" r="140" fill="${inner}"/>`
    + `<circle class="a-draw" pathLength="1" cx="256" cy="256" r="150" fill="none" stroke="${jacket}" stroke-width="20" transform="rotate(-90 256 256)"/>`
    + tubes + `<g class="a-pop" style="--i:6"><circle cx="256" cy="256" r="40" fill="#22c4c4"/><circle cx="256" cy="256" r="21" fill="${inner}"/></g>`
    + `<g class="a-fade" style="--i:8"><circle class="a-glow" cx="256" cy="256" r="8" fill="#fff"/><circle cx="256" cy="168" r="6" fill="#fff"/><circle cx="332" cy="300" r="6" fill="#fff"/></g>`);
}

/** Trassenverlauf mit Netzknoten-Pin */
function routePin(bg: [string, string], node: string): string {
  const d = 'M112 404 C 176 392, 156 330, 214 318 S 282 300, 306 270';
  return wrap(bg, `<path class="a-draw" pathLength="1" d="${d}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="22" stroke-linecap="round"/>`
    + `<path class="a-fade" style="--i:5" d="${d}" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 26"/>`
    + `<circle class="a-pop" style="--i:-3" cx="112" cy="404" r="20" fill="#fff"/><circle class="a-pop" style="--i:0" cx="214" cy="318" r="14" fill="#fff"/>`
    + `<g class="a-drop" style="--i:4"><path d="M340 330 C 300 282, 270 252, 270 210 A 70 70 0 1 1 410 210 C 410 252, 380 282, 340 330 Z" fill="#fff"/>`
    + `<circle cx="340" cy="210" r="34" fill="${node}"/><circle class="a-glow" cx="340" cy="210" r="12" fill="#fff"/></g>`);
}

/** Bauhelm mit Haken – Baustellenkontrolle */
function helmet(bg: [string, string]): string {
  return wrap(bg, `<g class="a-drop"><path d="M140 330 A116 116 0 0 1 372 330 Z" fill="#f6c026"/>`
    + `<rect x="240" y="206" width="32" height="116" rx="12" fill="#d9a400"/>`
    + `<rect x="112" y="320" width="288" height="38" rx="19" fill="#d9a400"/></g>`
    + `<circle class="a-pop" style="--i:4" cx="362" cy="372" r="62" fill="#23a35a" stroke="${bg[1]}" stroke-width="12"/>`
    + `<path class="a-draw" style="--i:12" pathLength="1" d="M330 372 l22 22 l40 -44" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`);
}

/** Strommast (bisheriges Motiv) */
function mast(bg: [string, string]): string {
  return wrap(bg, `<g transform="translate(96 92) scale(5)" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">`
    + `<path class="a-draw a-slow" pathLength="1" d="M32 4 L24 60 M32 4 L40 60 M18 16 H46 M14 26 H50 M26.3 44 H37.7 M28 30 L36 44 M36 30 L28 44 M29.7 16 L35 26 M34.3 16 L29 26"/>`
    + `<path class="a-fade" style="--i:6" d="M18 16 v4 M46 16 v4 M14 26 v4 M50 26 v4"/></g>`);
}

const FIBER_COLORS = ['#4da3ff', '#ff9f1a', '#3ddc84', '#ff5a5f', '#ffffff'];

export const LOGOS: AppLogo[] = [
  { id: 'glasfaser', name: 'Glasfaser', group: 'breitband', bg: GREEN, svg: fiber(GREEN, FIBER_COLORS, '#0b241c') },
  { id: 'glasfaser-magenta', name: 'Glasfaser Magenta', group: 'breitband', bg: MAGENTA, svg: fiber(MAGENTA, ['#ffffff', '#ffd1e8', '#ffffff', '#ffd1e8', '#ffffff'], '#4d002c') },
  { id: 'mikrorohr', name: 'Mikrorohr', group: 'breitband', bg: ['#1d4d3c', '#0b1f18'], svg: microduct(['#1d4d3c', '#0b1f18'], '#ff7a00') },
  { id: 'netzknoten', name: 'Trasse & Knoten', group: 'breitband', bg: GREEN, svg: routePin(GREEN, '#ff7a00') },
  { id: 'baustelle', name: 'Baustelle', group: 'allgemein', bg: ['#36404a', '#14181c'], svg: helmet(['#36404a', '#14181c']) },
  { id: 'mast', name: 'Strommast', group: 'allgemein', bg: GREEN, svg: mast(GREEN) },
];

export function getLogo(id: string | undefined): AppLogo {
  return LOGOS.find((l) => l.id === id) ?? LOGOS.find((l) => l.id === DEFAULT_LOGO)!;
}

export function logoDataUrl(l: AppLogo): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`;
}

/** Rendert das Logo als PNG (für das Home-Bildschirm-Symbol und Favicon) */
export function logoPng(l: AppLogo, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d')!.drawImage(img, 0, 0, size, size);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Logo konnte nicht gezeichnet werden.'));
    img.src = logoDataUrl(l);
  });
}

/**
 * Setzt Favicon und apple-touch-icon auf das gewählte Logo. iOS übernimmt das Symbol
 * beim (erneuten) „Zum Home-Bildschirm“ – ein bereits abgelegtes Symbol ändert iOS nicht.
 */
export async function applyLogo(id: string | undefined) {
  const l = getLogo(id);
  if (l.id === DEFAULT_LOGO) {
    setLink('apple-touch-icon', 'icons/apple-touch-icon.png');
    setLink('icon', 'icons/icon-192.png');
    return;
  }
  try {
    const [touch, fav] = await Promise.all([logoPng(l, 180), logoPng(l, 64)]);
    setLink('apple-touch-icon', touch);
    setLink('icon', fav);
  } catch { /* Standard-Symbol bleibt */ }
}

function setLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  el.href = href;
}
