/* Préférences visuelles : un seul langage (YouTube Music) × mode (clair / sombre).
   Appliquées sur <html> via data-mode, lues par les CSS. */

export type Design = 'ytm';
export type Mode = 'light' | 'dark';

const THEME_KEY = 'soundblend_theme';
const MODE_KEY = 'soundblend_mode';

/* Design unique : le langage visuel de l'app mobile (YouTube Music).
   Les anciennes peaux Apple / Material ont disparu — on force 'ytm'
   même si un ancien réglage traîne dans le navigateur. */
export function getDesign(): Design {
  return 'ytm';
}

export function getMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(design: Design, mode: Mode) {
  const html = document.documentElement;
  html.dataset.mode = mode;
  html.classList.toggle('dark', mode === 'dark');   // pour les composants Tailwind (NoiseBackground)
  html.style.colorScheme = mode;
  try {
    localStorage.setItem(THEME_KEY, design);
    localStorage.setItem(MODE_KEY, mode);
  } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = mode === 'dark';
    meta.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
  }
}

// applique immédiatement au premier import (évite un flash de thème)
applyTheme(getDesign(), getMode());
