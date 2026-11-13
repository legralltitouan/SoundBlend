import { AppSettings, GeneratedBlend, TasteMemory, Track } from '../types';

const SETTINGS_KEY = 'soundblend_settings';
const TASTE_MEMORY_KEY = 'soundblend_taste_memory';
const RECENT_BLENDS_KEY = 'soundblend_recent_blends';

/* Aucune clé n'est écrite ici, ni en secours.
   Le code est public : la moindre clé laissée dans un fichier source
   part avec le dépôt. Les valeurs viennent de `.env` en local — fichier
   qui n'est jamais envoyé — et, une fois en ligne, de ce que la personne
   saisit dans Réglages → Clés & API (gardé dans son navigateur).
   Vide, l'app demande les clés : elle ne casse pas. */
export const DEFAULT_SETTINGS: AppSettings = {
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  youtubeApiKey: import.meta.env.VITE_YOUTUBE_API_KEY || '',
  geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
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
      };
    }
  } catch (e) {
    console.error('Error reading settings from localStorage:', e);
  }
  return DEFAULT_SETTINGS;
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

export const recordTrackRating = (track: Track, rating: 'liked' | 'disliked'): TasteMemory => {
  const current = getStoredTasteMemory();
  const now = new Date().toISOString();

  const likedTracks = current.likedTracks.filter(t => t.id !== track.id && t.title.toLowerCase() !== track.title.toLowerCase());
  const dislikedTracks = current.dislikedTracks.filter(t => t.id !== track.id && t.title.toLowerCase() !== track.title.toLowerCase());
  let likedArtists = [...current.likedArtists];
  let dislikedArtists = [...current.dislikedArtists];

  if (rating === 'liked') {
    likedTracks.unshift({
      id: track.id,
      title: track.title,
      artist: track.artist,
      addedAt: now,
    });
    if (!likedArtists.includes(track.artist)) {
      likedArtists.push(track.artist);
    }
    dislikedArtists = dislikedArtists.filter(a => a.toLowerCase() !== track.artist.toLowerCase());
  } else {
    dislikedTracks.unshift({
      id: track.id,
      title: track.title,
      artist: track.artist,
      addedAt: now,
    });
    if (!dislikedArtists.includes(track.artist)) {
      dislikedArtists.push(track.artist);
    }
    likedArtists = likedArtists.filter(a => a.toLowerCase() !== track.artist.toLowerCase());
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
