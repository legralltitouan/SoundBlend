import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   Lire les couleurs d'une pochette.

   La pochette est chargée dans un canvas hors écran (les serveurs
   YouTube autorisent la lecture des pixels), puis réduite à quelques
   points : on en tire trois teintes représentatives, du plus clair au
   plus profond. C'est ce qui rend l'ambiance fidèle au morceau, plutôt
   qu'une couleur calculée au hasard.
   ═══════════════════════════════════════════════════════════════ */

export type Palette = { hues: [number, number, number]; sat: number; light: number };

const FALLBACK: Palette = { hues: [352, 312, 20], sat: 62, light: 48 };

const cache = new Map<string, Palette>();

/* l'image vient d'un CDN : si le CORS échoue (hors ligne, proxy), on retombe
   sur une palette neutre sans casser la page */
const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

export async function readPalette(src: string): Promise<Palette> {
  if (!src) return FALLBACK;
  const hit = cache.get(src);
  if (hit) return hit;

  const img = await loadImage(src);
  if (!img) { cache.set(src, FALLBACK); return FALLBACK; }

  try {
    const N = 24;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return FALLBACK;
    ctx.drawImage(img, 0, 0, N, N);
    const data = ctx.getImageData(0, 0, N, N).data;

    /* on garde les pixels assez colorés et assez lumineux, puis on les
       répartit en douze familles de teintes */
    const buckets = new Map<number, { n: number; s: number; l: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 200) continue;
      const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 18 || l < 12 || l > 92) continue;
      const key = Math.round(h / 30) * 30 % 360;
      const b = buckets.get(key) ?? { n: 0, s: 0, l: 0 };
      b.n += 1; b.s += s; b.l += l;
      buckets.set(key, b);
    }

    const ranked = [...buckets.entries()]
      .map(([h, b]) => ({ h, n: b.n, s: b.s / b.n, l: b.l / b.n }))
      .sort((a, b) => b.n - a.n);

    const main = ranked[0];
    if (!main) { cache.set(src, FALLBACK); return FALLBACK; }

    /* deux voisines : la plus proche en teinte, et une franchement différente */
    const near = ranked.slice(1).sort((a, b) => Math.abs(a.h - main.h) - Math.abs(b.h - main.h))[0];
    const far = ranked.slice(1).sort((a, b) => Math.abs(b.h - main.h) - Math.abs(a.h - main.h))[0];

    const palette: Palette = {
      hues: [main.h, near?.h ?? (main.h + 24) % 360, far?.h ?? (main.h + 300) % 360],
      sat: Math.max(38, Math.min(78, Math.round(main.s))),
      light: Math.max(34, Math.min(60, Math.round(main.l))),
    };
    cache.set(src, palette);
    return palette;
  } catch {
    cache.set(src, FALLBACK);
    return FALLBACK;
  }
}

/* ─────────── le hook : palette du morceau courant ─────────── */

export function usePalette(src?: string | null): Palette {
  const [pal, setPal] = useState<Palette>(() => (src && cache.get(src)) || FALLBACK);
  const asked = useRef<string>('');

  useEffect(() => {
    if (!src || asked.current === src) return;
    asked.current = src;
    let alive = true;
    void readPalette(src).then((p) => { if (alive) setPal(p); });
    return () => { alive = false; };
  }, [src]);

  return useMemo(() => pal, [pal.hues[0], pal.hues[1], pal.hues[2], pal.sat, pal.light]);
}

/* les trois couleurs prêtes à peindre */
export const paletteToCss = (p: Palette): React.CSSProperties => ({
  '--p1': `hsl(${p.hues[0]} ${p.sat}% ${p.light}%)`,
  '--p2': `hsl(${p.hues[1]} ${Math.max(40, p.sat - 6)}% ${Math.max(30, p.light - 8)}%)`,
  '--p3': `hsl(${p.hues[2]} ${Math.max(40, p.sat - 2)}% ${Math.min(64, p.light + 8)}%)`,
  '--p-h': `${p.hues[0]}`,
  '--p-s': `${p.sat}%`,
  '--p-l': `${p.light}%`,
} as React.CSSProperties);

/* une clé courte : deux palettes identiques ne doivent pas relancer d'effet */
export const paletteKey = (p: Palette) =>
  `${p.hues[0]}|${p.hues[1]}|${p.hues[2]}|${p.sat}|${p.light}`;
