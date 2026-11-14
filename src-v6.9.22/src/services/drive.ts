/* ═══════════════════════════════════════════════════════════════
   La synchro par le Drive de la personne.

   Un seul petit fichier JSON, rangé dans l'espace de données de
   l'application (`appDataFolder`) : un dossier caché que Drive réserve
   à SoundBlend. La personne ne le voit pas dans son Drive, personne
   d'autre n'y a accès, et il suit son compte d'un appareil à l'autre.

   Ce qui voyage : les goûts, les avis, le portrait sonore, les blends
   récents, le mode clair/sombre et la clé Gemini si elle en a une.
   Ce qui ne voyage pas : les jetons, l'historique de navigation, rien
   d'autre.

   Pourquoi `appDataFolder` et pas un dossier visible : le scope
   `drive.appdata` est classé **non sensible** par Google. Il ne demande
   donc ni vérification de l'application, ni écran d'alerte, et il ne
   donne accès à rien d'autre qu'à ce fichier. C'est le plus petit
   droit possible pour faire ce travail.
   ═══════════════════════════════════════════════════════════════ */

import { youtubeService } from './youtube';
import {
  getStoredSettings, saveStoredSettings,
  getStoredTasteMemory, saveStoredTasteMemory,
  getStoredPortrait, saveStoredPortrait,
  getStoredBlends, writeStoredBlends,
  type SoundPortrait,
} from './storage';
import { getStoredRatings, writeStoredRatings, type TrackRating } from '../lib/track';
import { getMode, getModeAt, appliquerModeDistant } from '../context/prefs';
import type { TasteMemory, GeneratedBlend } from '../types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const NOM_FICHIER = 'soundblend.json';
const ID_KEY = 'soundblend_drive_id';
const APPAREIL_KEY = 'soundblend_appareil';

/* ── l'identité de cet appareil ──
   Elle ne sert qu'à raconter, dans le fichier, qui a écrit en dernier.
   Rien de personnel : un numéro tiré au hasard à la première ouverture. */
const appareil = (): string => {
  try {
    const v = localStorage.getItem(APPAREIL_KEY);
    if (v) return v;
    const id = `app-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(APPAREIL_KEY, id);
    return id;
  } catch { return 'app-inconnu'; }
};

/* ── ce que contient le fichier ── */
export type DonneesSync = {
  schema: 1;
  modifie: string;
  appareil: string;
  apparence?: { mode: 'light' | 'dark'; at: number };
  reglages?: { geminiApiKey?: string };
  gouts?: TasteMemory;
  avis?: Record<string, TrackRating>;
  portrait?: SoundPortrait | null;
  blends?: GeneratedBlend[];
};

/* ── l'état, pour l'écran Réglages ── */
export type EtatSync = {
  phase: 'inactif' | 'sans-portee' | 'pret' | 'envoi' | 'erreur';
  dernierEnvoi?: string;
  message?: string;
};

let etat: EtatSync = { phase: 'inactif' };
const abonnes = new Set<(e: EtatSync) => void>();

export const surEtatSync = (cb: (e: EtatSync) => void): (() => void) => {
  abonnes.add(cb);
  cb(etat);
  return () => { abonnes.delete(cb); };
};

const poserEtat = (e: Partial<EtatSync>) => {
  etat = { ...etat, ...e };
  abonnes.forEach((f) => f(etat));
};

export const etatSync = (): EtatSync => etat;

/* ── l'identifiant du fichier, gardé en mémoire et sur l'appareil ── */
let fichierId: string | null = null;
try { fichierId = localStorage.getItem(ID_KEY); } catch { /* ignore */ }

const garderId = (id: string | null) => {
  fichierId = id;
  try {
    if (id) localStorage.setItem(ID_KEY, id);
    else localStorage.removeItem(ID_KEY);
  } catch { /* ignore */ }
};

const jeton = async (): Promise<string | null> => {
  try { return await youtubeService.jeton(); } catch { return null; }
};

const echec = (r: Response): never => {
  throw new Error(`Drive ${r.status}`);
};

/* ── le fichier : le trouver, le lire, l'écrire ── */

const trouverFichier = async (t: string): Promise<string | null> => {
  if (fichierId) return fichierId;
  const url =
    `${API}/files?spaces=appDataFolder&pageSize=10` +
    `&fields=${encodeURIComponent('files(id,name,modifiedTime)')}` +
    `&q=${encodeURIComponent(`name='${NOM_FICHIER}' and trashed=false`)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) echec(r);
  const data = await r.json();
  const f = (data.files || [])[0];
  if (!f) return null;
  garderId(f.id);
  return f.id as string;
};

const lireDistant = async (t: string): Promise<DonneesSync | null> => {
  const id = await trouverFichier(t);
  if (!id) return null;
  const r = await fetch(`${API}/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (r.status === 404) { garderId(null); return null; }
  if (!r.ok) echec(r);
  const texte = await r.text();
  try {
    const d = JSON.parse(texte) as DonneesSync;
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
};

const ecrireDistant = async (t: string, donnees: DonneesSync): Promise<void> => {
  const id = await trouverFichier(t);
  const json = JSON.stringify(donnees);

  if (id) {
    const r = await fetch(`${UPLOAD}/files/${id}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: json,
    });
    if (r.status === 404) { garderId(null); return ecrireDistant(t, donnees); }
    if (!r.ok) echec(r);
    return;
  }

  /* première écriture : un envoi en deux parties, la fiche et le
     contenu. C'est la forme que Drive attend pour créer un fichier
     dans son espace d'application. */
  const limite = `sb${Math.random().toString(36).slice(2)}`;
  const fiche = JSON.stringify({
    name: NOM_FICHIER,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  });
  const corps =
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${fiche}\r\n` +
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n` +
    `--${limite}--`;

  const r = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': `multipart/related; boundary=${limite}`,
    },
    body: corps,
  });
  if (!r.ok) echec(r);
  const data = await r.json();
  if (data?.id) garderId(data.id);
};

/* ── la fusion ──
   Deux appareils ne doivent jamais s'effacer l'un l'autre. Les goûts
   s'additionnent, les avis se cumulent (celui d'ici gagne en cas de
   contradiction), les blends se rangent par date, le portrait le plus
   récent l'emporte, et le mode suit le dernier choix explicite. */

const cleMorceau = (t: { id?: string; title?: string; artist?: string }) =>
  `${(t.title || '').trim().toLowerCase()}|${(t.artist || '').trim().toLowerCase()}`;

const fusionnerGouts = (local: TasteMemory, distant?: TasteMemory | null): TasteMemory => {
  if (!distant) return local;
  const union = (a: any[] = [], b: any[] = []) => {
    const vus = new Set<string>();
    const out: any[] = [];
    [...a, ...b].forEach((t) => {
      if (!t || typeof t !== 'object') return;
      const k = cleMorceau(t);
      if (k === '|' || vus.has(k)) return;
      vus.add(k);
      out.push(t);
    });
    return out.slice(0, 100);
  };
  const artistes = (a: string[] = [], b: string[] = []) => {
    const vus = new Set<string>();
    const out: string[] = [];
    [...a, ...b].forEach((x) => {
      const k = (x || '').trim().toLowerCase();
      if (!k || vus.has(k)) return;
      vus.add(k);
      out.push(x);
    });
    return out.slice(0, 50);
  };
  return {
    likedTracks: union(local.likedTracks, distant.likedTracks),
    dislikedTracks: union(local.dislikedTracks, distant.dislikedTracks),
    likedArtists: artistes(local.likedArtists, distant.likedArtists),
    dislikedArtists: artistes(local.dislikedArtists, distant.dislikedArtists),
    seenTracks: union(
      (local.seenTracks || []).map((x) => ({ title: x, artist: '' })),
      (distant.seenTracks || []).map((x) => ({ title: x, artist: '' })),
    ).map((t: any) => t.title),
  };
};

const fusionnerBlends = (a: GeneratedBlend[] = [], b: GeneratedBlend[] = []): GeneratedBlend[] => {
  const parId = new Map<string, GeneratedBlend>();
  [...a, ...b].forEach((x) => {
    if (!x || !x.id) return;
    const deja = parId.get(x.id);
    /* à identifiant égal, la version qui a le plus de morceaux est la
       plus complète : c'est celle-là qu'on garde */
    if (!deja || (x.tracks?.length || 0) > (deja.tracks?.length || 0)) parId.set(x.id, x);
  });
  return [...parId.values()]
    .sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))
    .slice(0, 20);
};

/* ── les deux gestes : recevoir, envoyer ── */

const composer = (): DonneesSync => {
  const gouts = getStoredTasteMemory();
  const portrait = getStoredPortrait();
  return {
    schema: 1,
    modifie: new Date().toISOString(),
    appareil: appareil(),
    apparence: { mode: getMode(), at: getModeAt() },
    reglages: { geminiApiKey: getStoredSettings().geminiApiKey || '' },
    gouts,
    avis: getStoredRatings(),
    portrait,
    blends: getStoredBlends().slice(0, 20),
  };
};

const appliquerDistant = (d: DonneesSync): void => {
  /* 1. les goûts s'additionnent */
  saveStoredTasteMemory(fusionnerGouts(getStoredTasteMemory(), d.gouts));

  /* 2. les avis : les deux registres se cumulent, celui d'ici gagne */
  writeStoredRatings({ ...(d.avis || {}), ...getStoredRatings() });

  /* 3. les blends : les deux histoires se rejoignent */
  writeStoredBlends(fusionnerBlends(getStoredBlends(), d.blends));

  /* 4. le portrait : le plus récent gagne */
  const ici = getStoredPortrait();
  if (d.portrait && (!ici || (d.portrait.at || '') > (ici.at || ''))) saveStoredPortrait(d.portrait);

  /* 5. la clé Gemini : elle suit le compte, mais une clé saisie ici
        n'est jamais écrasée par une absence */
  const reglages = getStoredSettings();
  const cleDistante = d.reglages?.geminiApiKey || '';
  if (!reglages.geminiApiKey && cleDistante) {
    saveStoredSettings({ ...reglages, geminiApiKey: cleDistante });
  }

  /* 6. l'apparence : seulement si l'autre appareil a choisi plus
        récemment que moi */
  if (d.apparence?.mode && (d.apparence.at || 0) > getModeAt()) {
    appliquerModeDistant(d.apparence.mode, d.apparence.at);
  }

  /* les écrans relisent ce qui vient d'arriver */
  window.dispatchEvent(new CustomEvent('sb:sync-applied'));
};

const signalerErreur = (e: any) => {
  const msg = String(e?.message || e || '');
  const sansDroit = msg.includes('401') || msg.includes('403');
  poserEtat({
    phase: sansDroit ? 'sans-portee' : 'erreur',
    message: sansDroit
      ? 'La connexion Google actuelle ne couvre pas le Drive. Reconnecte-toi pour activer la synchro.'
      : 'La synchro n’a pas abouti. Les données restent sur cet appareil.',
  });
};

/** reçoit ce qui existe, fusionne, puis renvoie le tout */
export const demarrerSync = async (): Promise<boolean> => {
  if (!youtubeService.isAuthenticated()) { poserEtat({ phase: 'inactif' }); return false; }
  const t = await jeton();
  if (!t) { poserEtat({ phase: 'inactif' }); return false; }

  poserEtat({ phase: 'envoi', message: undefined });
  try {
    const distant = await lireDistant(t);
    if (distant) appliquerDistant(distant);
    await ecrireDistant(t, composer());
    poserEtat({ phase: 'pret', dernierEnvoi: new Date().toISOString(), message: undefined });
    return true;
  } catch (e) {
    signalerErreur(e);
    return false;
  }
};

/** envoie l'état courant (après une modification locale) */
export const envoyerSync = async (): Promise<boolean> => {
  if (!youtubeService.isAuthenticated()) return false;
  const t = await jeton();
  if (!t) return false;
  try {
    poserEtat({ phase: 'envoi', message: undefined });
    await ecrireDistant(t, composer());
    poserEtat({ phase: 'pret', dernierEnvoi: new Date().toISOString(), message: undefined });
    return true;
  } catch (e) {
    signalerErreur(e);
    return false;
  }
};

/* ── l'envoi différé ──
   Un pouce par-ci, un réglage par-là : on ne fait pas un aller-retour
   par clic. Quatre secondes après le dernier geste, un seul envoi part.
   Sans compte connecté, il ne se passe rien du tout. */
let minuteur: any = null;

export const planifierEnvoi = (): void => {
  if (!youtubeService.isAuthenticated()) return;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { void envoyerSync(); }, 4000);
};

/** coupe la synchro quand la personne se déconnecte */
export const oublierSync = (): void => {
  clearTimeout(minuteur);
  garderId(null);
  poserEtat({ phase: 'inactif', dernierEnvoi: undefined, message: undefined });
};
