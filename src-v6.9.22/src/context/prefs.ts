/* Préférences visuelles : un seul langage (YouTube Music) × mode (clair / sombre).
   Appliquées sur <html> via data-mode, lues par les CSS. */

export type Design = 'ytm';
export type Mode = 'light' | 'dark';

const THEME_KEY = 'soundblend_theme';
const MODE_KEY = 'soundblend_mode';
/* quand le mode a été choisi, à la main, sur cet appareil. C'est ce qui
   permet à la synchro de trancher entre deux appareils sans écraser un
   choix récent par un réglage ancien. */
const MODE_AT_KEY = 'soundblend_mode_at';

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

/** l'heure du dernier choix de mode fait sur cet appareil (0 = jamais) */
export function getModeAt(): number {
  try { return parseInt(localStorage.getItem(MODE_AT_KEY) || '0', 10) || 0; } catch { return 0; }
}

export function applyTheme(design: Design, mode: Mode) {
  const html = document.documentElement;
  html.dataset.mode = mode;
  html.classList.toggle('dark', mode === 'dark');   // pour les composants Tailwind (NoiseBackground)
  html.style.colorScheme = mode;
  try {
    localStorage.setItem(THEME_KEY, design);
    localStorage.setItem(MODE_KEY, mode);
    /* pas de date ici : appliquer un thème au démarrage n'est pas un
       choix. Seul un clic compte (voir plus bas). */
  } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = mode === 'dark';
    meta.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
  }
}

/** un clic sur l'interrupteur : le choix est daté, il gagnera la synchro */
export function choisirMode(mode: Mode) {
  applyTheme(getDesign(), mode);
  try { localStorage.setItem(MODE_AT_KEY, String(Date.now())); } catch { /* ignore */ }
}

/** le mode vient d'un autre appareil : on l'applique en reprenant
    **sa** date, si bien que les deux appareils s'accordent et qu'aucun
    des deux ne « gagne » indéfiniment en réécrivant l'autre. */
export function appliquerModeDistant(mode: Mode, at?: number) {
  applyTheme(getDesign(), mode);
  if (at && at > 0) {
    try { localStorage.setItem(MODE_AT_KEY, String(at)); } catch { /* ignore */ }
  }
}

// applique immédiatement au premier import (évite un flash de thème)
applyTheme(getDesign(), getMode());
