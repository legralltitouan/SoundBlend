/* Synchronisation privée dans Google Drive appDataFolder.
   Chaque envoi relit puis fusionne le fichier : exclusions et suppressions
   ont une date/tombstone, les blends expirés disparaissent réellement du JSON.
   Google Drive v3 ne documente pas de verrou atomique pour un remplacement
   média : deux écritures exactement simultanées restent un cas de concurrence
   « best effort », récupéré au prochain échange tant que les deux appareils
   conservent leurs données locales. */
import { youtubeService } from './youtube';
import {
  getStoredSettings, saveStoredSettings, getSettingsAt,
  getStoredPortrait, saveStoredPortrait, getStoredBlends, writeStoredBlends, cleanBlend,
  getExclusionRecords, writeExclusionRecords, mergeExclusionRecords,
  getDiscoveryHistory, writeDiscoveryHistory, mergeDiscoveryHistory, learnDiscoveriesFromBlends,
  getBlendTombstones, writeBlendTombstones, mergeBlendTombstones,
  type SoundPortrait,
} from './storage';
import { getMode, getModeAt, appliquerModeDistant } from '../context/prefs';
import type { BlendTombstone, DiscoveryRecord, ExclusionRecord, GeneratedBlend } from '../types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'soundblend.json';
const ID_KEY = 'soundblend_drive_id';
const APPAREIL_KEY = 'soundblend_appareil';
const DIRTY_KEY = 'soundblend_sync_pending_v2';

const appareil = (): string => {
  try {
    const old = localStorage.getItem(APPAREIL_KEY);
    if (old) return old;
    const id = `app-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    localStorage.setItem(APPAREIL_KEY, id); return id;
  } catch { return 'app-inconnu'; }
};

export type DonneesSync = {
  schema: 2;
  modifie: string;
  appareil: string;
  apparence?: { mode: 'light' | 'dark'; at: number };
  reglages?: { geminiApiKey?: string; at?: number };
  exclusions?: ExclusionRecord[];
  decouvertes?: DiscoveryRecord[];
  suppressionsBlends?: Record<string, BlendTombstone>;
  portrait?: SoundPortrait | null;
  blends?: GeneratedBlend[];
};
export type EtatSync = {
  phase: 'inactif' | 'sans-portee' | 'pret' | 'envoi' | 'erreur';
  dernierEnvoi?: string;
  message?: string;
};
let etat: EtatSync = { phase: 'inactif' };
const abonnes = new Set<(e: EtatSync) => void>();
export const surEtatSync = (cb: (e: EtatSync) => void): (() => void) => {
  abonnes.add(cb); cb(etat); return () => { abonnes.delete(cb); };
};
const poserEtat = (e: Partial<EtatSync>) => { etat = { ...etat, ...e }; abonnes.forEach((f) => f(etat)); };
export const etatSync = (): EtatSync => etat;
let fichierId: string | null = null;
try { fichierId = localStorage.getItem(ID_KEY); } catch { /* mode privé */ }
const garderId = (id: string | null) => {
  fichierId = id;
  try { if (id) localStorage.setItem(ID_KEY, id); else localStorage.removeItem(ID_KEY); } catch { /* ignore */ }
};
const echec = (r: Response): never => { throw new Error(`Drive ${r.status}`); };
/** Re-listage à chaque cycle : deux premières connexions simultanées
    peuvent créer deux fichiers du même nom ; on les réunit ensuite. */
const listerFichiers = async (t: string): Promise<string[]> => {
  let token = ''; const ids: string[] = [];
  do {
    const url = `${API}/files?spaces=appDataFolder&pageSize=100&fields=${encodeURIComponent('nextPageToken,files(id,name,modifiedTime)')}&q=${encodeURIComponent(`name='${FILE_NAME}' and trashed=false`)}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
    if (!r.ok) echec(r);
    const data = await r.json();
    for (const f of data.files || []) if (f?.id && !ids.includes(String(f.id))) ids.push(String(f.id));
    token = data.nextPageToken || '';
  } while (token);
  ids.sort(); garderId(ids[0] || null); return ids;
};
const lireFichier = async (t: string, id: string): Promise<DonneesSync | null> => {
  const r = await fetch(`${API}/files/${encodeURIComponent(id)}?alt=media`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) echec(r);
  try {
    const d = JSON.parse(await r.text());
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('format');
    return d as DonneesSync;
  } catch { throw new Error('Le fichier Drive est illisible ; il n’a pas été écrasé.'); }
};
const supprimerFichier = async (t: string, id: string): Promise<void> => {
  const r = await fetch(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok && r.status !== 404) echec(r);
};
const ecrireDistant = async (t: string, data: DonneesSync): Promise<void> => {
  const id = fichierId;
  const json = JSON.stringify(data);
  if (id) {
    const r = await fetch(`${UPLOAD}/files/${id}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: json,
    });
    if (r.status === 404) { garderId(null); return ecrireDistant(t, data); }
    if (!r.ok) echec(r);
    return;
  }
  const boundary = `sb${Math.random().toString(36).slice(2)}`;
  const fiche = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${fiche}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--`;
  const r = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!r.ok) echec(r);
  const d = await r.json(); if (d?.id) garderId(d.id);
};

/** Exporté aussi pour les essais de fusion, sans requête réseau. */
export const fusionnerBlends = (a: GeneratedBlend[] = [], b: GeneratedBlend[] = [], deleted: Record<string, BlendTombstone> = {}): GeneratedBlend[] => {
  const map = new Map<string, GeneratedBlend>();
  for (const raw of [...a, ...b]) {
    if (!raw?.id || deleted[raw.id] || !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= Date.now()) continue;
    const x = cleanBlend(raw);
    const prev = map.get(x.id);
    const at = x.updatedAt || Date.parse(x.createdAt) || 0;
    const prevAt = prev?.updatedAt || Date.parse(prev?.createdAt || '') || 0;
    if (!prev || at > prevAt) map.set(x.id, x);
  }
  return [...map.values()].sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
};
const composer = (): DonneesSync => ({
  schema: 2, modifie: new Date().toISOString(), appareil: appareil(),
  apparence: { mode: getMode(), at: getModeAt() },
  reglages: { geminiApiKey: getStoredSettings().geminiApiKey || '', at: getSettingsAt() },
  exclusions: getExclusionRecords(), decouvertes: getDiscoveryHistory(),
  suppressionsBlends: getBlendTombstones(), portrait: getStoredPortrait(), blends: getStoredBlends(),
});
const appliquerDistant = (d: DonneesSync): void => {
  writeExclusionRecords(mergeExclusionRecords(getExclusionRecords(), Array.isArray(d.exclusions) ? d.exclusions : []));
  writeDiscoveryHistory(mergeDiscoveryHistory(getDiscoveryHistory(), Array.isArray(d.decouvertes) ? d.decouvertes : []));
  const deleted = mergeBlendTombstones(getBlendTombstones(), d.suppressionsBlends || {});
  writeBlendTombstones(deleted);
  const blends = fusionnerBlends(getStoredBlends(), Array.isArray(d.blends) ? d.blends : [], deleted);
  writeStoredBlends(blends);
  learnDiscoveriesFromBlends(blends);
  const here = getStoredPortrait();
  // Un ancien portrait peut contenir des goûts déduits des pouces : ne pas le migrer.
  if (Number(d.schema) >= 2 && d.portrait && (!here || (d.portrait.at || '') > (here.at || ''))) saveStoredPortrait(d.portrait);
  const settings = getStoredSettings();
  const remoteAt = Number(d.reglages?.at || 0);
  const remoteKey = d.reglages?.geminiApiKey;
  if (typeof remoteKey === 'string' && (remoteAt > getSettingsAt() || (!getSettingsAt() && !settings.geminiApiKey && remoteKey))) {
    saveStoredSettings({ ...settings, geminiApiKey: remoteKey }, remoteAt);
  }
  if (d.apparence?.mode && (d.apparence.at || 0) > getModeAt()) appliquerModeDistant(d.apparence.mode, d.apparence.at);
  window.dispatchEvent(new CustomEvent('sb:sync-applied'));
};
const signalerErreur = (e: any) => {
  const msg = String(e?.message || e || '');
  const sansDroit = msg.includes('401') || msg.includes('403');
  poserEtat({ phase: sansDroit ? 'sans-portee' : 'erreur', message: sansDroit
    ? 'La connexion Google actuelle ne couvre pas le Drive. Reconnecte-toi pour activer la synchro.'
    : (msg.includes('illisible') ? msg : 'La synchro n’a pas abouti. Les données restent sur cet appareil et seront réessayées.') });
};

let aEnvoyer = false;
try { aEnvoyer = localStorage.getItem(DIRTY_KEY) === '1'; } catch { /* ignore */ }
let generation = 0;
let minuteur: ReturnType<typeof setTimeout> | null = null;
let expiration: ReturnType<typeof setTimeout> | null = null;
let veille: ReturnType<typeof setInterval> | null = null;
let enCours: Promise<boolean> | null = null;
let session = 0;
const dirty = (on: boolean) => {
  aEnvoyer = on;
  try { if (on) localStorage.setItem(DIRTY_KEY, '1'); else localStorage.removeItem(DIRTY_KEY); } catch { /* ignore */ }
};
const armerExpiration = () => {
  if (expiration) clearTimeout(expiration);
  const dates = getStoredBlends().map((b) => Date.parse(b.expiresAt)).filter((n) => n > Date.now());
  if (!dates.length) { expiration = null; return; }
  const delay = Math.max(20, Math.min(...dates) - Date.now() + 30);
  expiration = setTimeout(() => {
    getStoredBlends();
    window.dispatchEvent(new CustomEvent('sb:sync-applied'));
    planifierEnvoi();
  }, Math.min(delay, 2147483000));
};
const armerVeille = () => {
  if (!veille) veille = setInterval(() => {
    if (!youtubeService.isAuthenticated()) return;
    // Relire aussi lorsque cet appareil est inchangé : un autre a pu écrire.
    void demarrerSync();
  }, 3 * 60 * 1000);
  armerExpiration();
};

/** Relit AVANT tout envoi. Une écriture locale arrivée pendant la requête
    reste marquée comme à envoyer et n'est pas perdue. */
const cycle = (): Promise<boolean> => {
  if (enCours) return enCours;
  if (!youtubeService.isAuthenticated()) { poserEtat({ phase: 'inactif' }); return Promise.resolve(false); }
  const thisSession = session;
  enCours = (async () => {
    const t = await youtubeService.jeton();
    if (!t || thisSession !== session) return false;
    poserEtat({ phase: 'envoi', message: undefined });
    try {
      const initialIds = await listerFichiers(t);
      for (const id of initialIds) {
        const d = await lireFichier(t, id);
        if (thisSession !== session) return false;
        if (d) appliquerDistant(d);
      }
      const before = generation;
      await ecrireDistant(t, composer());
      if (thisSession !== session) return false;
      // Relecture après écriture : si un autre appareil vient d'écrire, on
      // fusionne à nouveau. Cela réduit la fenêtre de course, sans promettre
      // de verrou atomique que Drive v3 ne documente pas.
      const ids = await listerFichiers(t);
      let canonical: DonneesSync | null = null;
      const duplicatesRead: { id: string; snapshot: string }[] = [];
      for (const id of ids) {
        const d = await lireFichier(t, id);
        if (thisSession !== session) return false;
        if (!d) continue;
        if (id === ids[0]) canonical = d; else duplicatesRead.push({ id, snapshot: JSON.stringify(d) });
        appliquerDistant(d);
      }
      const fingerprint = (d: DonneesSync | null) => d ? JSON.stringify({
        schema: d.schema, apparence: d.apparence, reglages: d.reglages,
        exclusions: d.exclusions, decouvertes: d.decouvertes, suppressionsBlends: d.suppressionsBlends,
        portrait: d.portrait, blends: d.blends,
      }) : '';
      const merged = composer();
      let retryNeeded = false;
      if (fingerprint(canonical) !== fingerprint(merged) || duplicatesRead.length) {
        await ecrireDistant(t, merged);
        // Revoir chaque copie juste avant de la supprimer : si un autre
        // appareil y a écrit entre-temps, ne pas effacer sa modification.
        // Ce contrôle réduit la fenêtre de course, sans être un verrou
        // atomique entre la dernière lecture et DELETE dans Drive v3.
        for (const copy of duplicatesRead) {
          const latest = await lireFichier(t, copy.id);
          if (thisSession !== session) return false;
          if (latest && JSON.stringify(latest) === copy.snapshot) await supprimerFichier(t, copy.id);
          else if (latest) retryNeeded = true;
        }
      }
      if (thisSession !== session) return false;
      if (generation === before && !retryNeeded) dirty(false);
      else { dirty(true); if (minuteur) clearTimeout(minuteur); minuteur = setTimeout(() => { void envoyerSync(); }, 1200); }
      armerVeille();
      poserEtat({ phase: 'pret', dernierEnvoi: new Date().toISOString(), message: undefined });
      return true;
    } catch (e) { dirty(true); signalerErreur(e); return false; }
  })().finally(() => { enCours = null; });
  return enCours;
};
export const surveillerExpirations = (): void => armerExpiration();
export const demarrerSync = (): Promise<boolean> => { armerVeille(); return cycle(); };
export const envoyerSync = (): Promise<boolean> => cycle();
export const planifierEnvoi = (): void => {
  generation += 1; dirty(true); armerExpiration();
  if (!youtubeService.isAuthenticated()) return;
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => { void envoyerSync(); }, 2500);
};
export const oublierSync = (): void => {
  session += 1;
  if (minuteur) clearTimeout(minuteur);
  if (veille) clearInterval(veille);
  if (expiration) clearTimeout(expiration);
  minuteur = null; veille = null; expiration = null;
  garderId(null);
  poserEtat({ phase: 'inactif', dernierEnvoi: undefined, message: undefined });
};
export const enAttente = (): boolean => aEnvoyer;
