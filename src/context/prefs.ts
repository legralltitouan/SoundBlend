/* Préférences visuelles indépendantes pour chaque compte et pour l'espace
   local sans compte. Le thème n'est jamais copié d'un espace à l'autre. */
import { scopedGetItem, scopedSetItem } from '../services/accountScope';

export type Design = 'ytm';
export type Mode = 'light' | 'dark';
const MODE_KEY = 'soundblend_mode';
const MODE_AT_KEY = 'soundblend_mode_at';
const MODE_RECORD = 'soundblend_mode_v2';
type ModeRecord = { mode: Mode; at: number; pending?: boolean };

export function getDesign(): Design { return 'ytm'; }
const modeRecord = (): ModeRecord | null => {
  try {
    const value = JSON.parse(scopedGetItem(MODE_RECORD) || 'null');
    if ((value?.mode === 'light' || value?.mode === 'dark') && Number.isFinite(value.at)) return value;
  } catch { /* ancienne préférence, ou stockage indisponible */ }
  return null;
};
const saveMode = (r: ModeRecord): void => {
  try { scopedSetItem(MODE_RECORD, JSON.stringify(r)); }
  catch { throw new Error('Stockage local indisponible ou plein : choix du thème non enregistré.'); }
};
export function getMode(): Mode {
  const record = modeRecord();
  if (record) return record.mode;
  try {
    const old = scopedGetItem(MODE_KEY);
    if (old === 'dark' || old === 'light') return old;
  } catch { /* utiliser le mode de l'appareil */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function getModeAt(): number {
  const record = modeRecord();
  if (record) return record.at;
  try { return parseInt(scopedGetItem(MODE_AT_KEY) || '0', 10) || 0; } catch { return 0; }
}
export function modeEnAttente(): boolean { return !!modeRecord()?.pending; }

/** Appliquer au DOM ne constitue pas une écriture ni un choix utilisateur. */
export function applyTheme(_design: Design, mode: Mode): void {
  const html = document.documentElement;
  html.dataset.mode = mode;
  html.classList.toggle('dark', mode === 'dark');
  html.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0a0a0a' : '#ffffff');
}
export function choisirMode(mode: Mode): void {
  // Valeur, horloge et marque d'envoi dans une seule écriture locale.
  saveMode({ mode, at: Math.max(Date.now(), getModeAt() + 1), pending: true });
  applyTheme(getDesign(), mode);
  window.dispatchEvent(new CustomEvent('sb:data-changed'));
}
export function appliquerModeDistant(mode: Mode, at = 0): void {
  saveMode({ mode, at });
  applyTheme(getDesign(), mode);
}
/** Un choix local non envoyé ne disparaît pas devant une horloge distante
    plus rapide : il est placé après la version qu'on vient d'observer. */
export function rebaserMode(at: number): void {
  saveMode({ mode: getMode(), at, pending: true });
}
export function confirmerMode(at: number): void {
  const r = modeRecord();
  if (r?.pending && r.at === at) saveMode({ mode: r.mode, at: r.at });
}
applyTheme(getDesign(), getMode());
