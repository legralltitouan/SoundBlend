import { AppSettings, GeneratedBlend, TasteMemory, Track } from '../types';

const SETTINGS_KEY = 'soundblend_settings';
const TASTE_MEMORY_KEY = 'soundblend_taste_memory';
const RECENT_BLENDS_KEY = 'soundblend_recent_blends';

/* Aucune clé n'est écrite ici, et **aucune n'est lue au moment du build**.

   Vite remplace `import.meta.env.VITE_*` par sa valeur à la compilation :
   la moindre variable laissée dans un `.env` local se retrouverait donc
   dans le fichier JavaScript publié, lisible par n'importe qui. Le code
   est public : on ne prend pas ce risque.

   Les clés viennent uniquement de ce que la personne saisit dans
   Réglages → Clés & API, et restent dans son navigateur. Vide, l'app
   demande les clés : elle ne casse pas. */
export const DEFAULT_SETTINGS: AppSettings = {
  googleClientId: '',
  youtubeApiKey: '',
  geminiApiKey: '',
};

export const getStoredSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      /* on ne garde que les trois clés utiles : les anciennes préférences
         (modèle Gemini, mode démo) sont ignorées sans casser le reste */
      return {
        googleClientId: parsed.googleClientId || DEFAULT_SETTINGS.googleClientId,
        youtubeApiKey: parsed.youtubeApiKey ?? DEFAULT_SETTINGS.youtubeApiKey,
        geminiApiKey: parsed.geminiApiKey ?? DEFAULT_SETTINGS.geminiApiKey,
        geminiApiKeys: Array.isArray(parsed.geminiApiKeys)
          ? parsed.geminiApiKeys.filter((k: unknown) => typeof k === 'string' && k.trim()).map((k: string) => k.trim())
          : [],
      };
    }
  } catch (e) {
    console.error('Error reading settings from localStorage:', e);
  }
  return DEFAULT_SETTINGS;
};

/**
 * Toutes les clés Gemini disponibles, la principale d'abord.
 *
 * Une clé gratuite a un quota par jour et **par modèle** : quand un
 * modèle est à sec, un autre modèle peut encore répondre avec la même
 * clé. Et quand toute la clé est à sec, une seconde clé (autre projet)
 * repart de zéro. On donne donc au moteur non pas une clé mais la liste,
 * dans l'ordre où les essayer.
 */
export const geminiKeys = (settings?: AppSettings): string[] => {
  const s = settings || getStoredSettings();
  const all = [s.geminiApiKey, ...(s.geminiApiKeys || [])]
    .map((k) => (k || '').trim())
    .filter(Boolean);
  return all.filter((k, i) => all.indexOf(k) === i);
};

export const saveStoredSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings to localStorage:', e);
  }
};

export const getStoredTasteMemory = (): TasteMemory => {
  try {
    const raw = localStorage.getItem(TASTE_MEMORY_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading taste memory:', e);
  }
  return {
    likedTracks: [],
    dislikedTracks: [],
    likedArtists: [],
    dislikedArtists: [],
    seenTracks: [],
  };
};

/**
 * Le journal des titres déjà proposés.
 *
 * Il n'a rien à voir avec les goûts : il retient simplement ce qui est
 * déjà sorti à l'écran, pour qu'un remplacement ne repropose jamais le
 * même morceau. Séparé du reste, il survit à une réinitialisation des
 * goûts — ce n'est pas un avis, c'est une mémoire de recherche.
 */
const SEEN_KEY = 'soundblend_seen_tracks';
const SEEN_MAX = 300;

export const getSeenTracks = (): string[] => {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export const rememberSeenTrack = (title: string, artist: string): void => {
  try {
    const k = `${title} — ${artist}`.toLowerCase().trim();
    const seen = getSeenTracks().filter((x) => x !== k);
    seen.push(k);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-SEEN_MAX)));
  } catch { /* stockage plein : on continue sans journal */ }
};

export const saveStoredTasteMemory = (memory: TasteMemory): void => {
  try {
    localStorage.setItem(TASTE_MEMORY_KEY, JSON.stringify(memory));
  } catch (e) {
    console.error('Error saving taste memory:', e);
  }
};

/* ═══════════════════════════════════════════════════════════════
   La mémoire des goûts suit le registre des avis, dans les deux sens.

   Avant, retirer un avis ne faisait que décocher le pouce : le morceau
   restait dans « Tes goûts ». Deux listes racontaient alors deux choses
   différentes. Désormais une seule fonction applique un avis — posé ou
   retiré — et retire aussi le morceau de l'autre liste.
   ═══════════════════════════════════════════════════════════════ */

const sameMemoryTrack = (a: { id?: string; title?: string; artist?: string }, b: { id?: string; title?: string; artist?: string }) => {
  if (a.id && b.id && a.id === b.id) return true;
  const ta = (a.title || '').trim().toLowerCase();
  const tb = (b.title || '').trim().toLowerCase();
  if (!ta || ta !== tb) return false;
  const aa = (a.artist || '').trim().toLowerCase();
  const ab = (b.artist || '').trim().toLowerCase();
  return !aa || !ab || aa === ab;
};

/** applique un avis au souvenir : `null` = on oublie ce morceau. */
export const applyRatingToTaste = (
  track: { id?: string; videoId?: string; title?: string; artist?: string },
  rating: 'liked' | 'disliked' | null,
): TasteMemory => {
  const current = getStoredTasteMemory();
  const now = new Date().toISOString();
  const seed = { id: (track as any).id || `${track.title}-${track.artist}`, title: track.title || '', artist: track.artist || '' };

  /* 1. on retire le morceau des deux listes, quelle que soit la note */
  let likedTracks = current.likedTracks.filter((t) => !sameMemoryTrack(t, seed));
  let dislikedTracks = current.dislikedTracks.filter((t) => !sameMemoryTrack(t, seed));

  /* 2. on le remet, dans la bonne liste, en tête */
  if (rating === 'liked') likedTracks = [{ ...seed, addedAt: now }, ...likedTracks];
  if (rating === 'disliked') dislikedTracks = [{ ...seed, addedAt: now }, ...dislikedTracks];

  /* 3. les artistes : un artiste aimé ne peut pas être « évité », et
     inversement. Sans avis, il quitte les deux seulement s'il n'a plus
     aucun morceau noté. */
  const artist = (seed.artist || '').trim();
  const sameArtist = (x: string) => x.trim().toLowerCase() === artist.toLowerCase();
  let likedArtists = current.likedArtists.filter((a) => !sameArtist(a));
  let dislikedArtists = current.dislikedArtists.filter((a) => !sameArtist(a));
  if (artist) {
    const stillLiked = likedTracks.some((t) => t.artist.trim().toLowerCase() === artist.toLowerCase());
    const stillDisliked = dislikedTracks.some((t) => t.artist.trim().toLowerCase() === artist.toLowerCase());
    if (stillLiked) likedArtists = [...likedArtists, artist];
    if (stillDisliked) dislikedArtists = [...dislikedArtists, artist];
  }

  const updated: TasteMemory = {
    likedTracks: likedTracks.slice(0, 100),
    dislikedTracks: dislikedTracks.slice(0, 100),
    likedArtists: likedArtists.slice(0, 50),
    dislikedArtists: dislikedArtists.slice(0, 50),
  };
  saveStoredTasteMemory(updated);
  return updated;
};

/** compatibilité : un pouce posé */
export const recordTrackRating = (track: Track, rating: 'liked' | 'disliked'): TasteMemory =>
  applyRatingToTaste(track, rating);

export const getStoredBlends = (): GeneratedBlend[] => {
  try {
    const raw = localStorage.getItem(RECENT_BLENDS_KEY);
    if (raw) {
      const blends: GeneratedBlend[] = JSON.parse(raw);
      const now = new Date().getTime();
      return blends.filter(b => new Date(b.expiresAt).getTime() > now);
    }
  } catch (e) {
    console.error('Error reading recent blends:', e);
  }
  return [];
};

export const saveBlendToStorage = (blend: GeneratedBlend): void => {
  try {
    const existing = getStoredBlends();
    const filtered = existing.filter(b => b.id !== blend.id);
    filtered.unshift(blend);
    localStorage.setItem(RECENT_BLENDS_KEY, JSON.stringify(filtered.slice(0, 20)));
  } catch (e) {
    console.error('Error saving blend to storage:', e);
  }
};

export const writeStoredBlends = (blends: GeneratedBlend[]): void => {
  try {
    localStorage.setItem(RECENT_BLENDS_KEY, JSON.stringify(blends));
  } catch (e) {
    console.error('Error writing recent blends:', e);
  }
};

export const deleteStoredBlend = (id: string): void => {
  try {
    const existing = getStoredBlends();
    const filtered = existing.filter(b => b.id !== id);
    localStorage.setItem(RECENT_BLENDS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Error deleting blend:', e);
  }
};

/* ═══════════════════════════════════════════════════════════════
   Le portrait sonore : ce que l'IA a compris du style de l'auditeur.

   Il ne remplace pas la mémoire des goûts, il la résume : une phrase de
   style, les genres et les textures dominantes, ce qu'il faut éviter. Ce
   résumé est réutilisé d'une génération à l'autre — il évite de repayer
   une analyse complète à chaque fois, et il donne au modèle une
   description stable de la personne, pas seulement une liste de titres.
   ═══════════════════════════════════════════════════════════════ */

const PORTRAIT_KEY = 'soundblend_portrait_v1';

export type SoundPortrait = {
  /** une phrase : le style de l'auditeur, en français */
  style: string;
  /** les familles musicales dominantes */
  genres: string[];
  /** les textures, instruments, couleurs de production */
  textures: string[];
  /** ce qu'il faut éviter */
  avoid: string[];
  /** la signature rythmique / énergétique */
  energy: string;
  /** la date de l'analyse, pour savoir si on la refait */
  at: string;
};

export const getStoredPortrait = (): SoundPortrait | null => {
  try {
    const raw = localStorage.getItem(PORTRAIT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as SoundPortrait;
    return p && typeof p.style === 'string' ? p : null;
  } catch { return null; }
};

export const saveStoredPortrait = (p: SoundPortrait): void => {
  try { localStorage.setItem(PORTRAIT_KEY, JSON.stringify(p)); } catch { /* ignore */ }
};
