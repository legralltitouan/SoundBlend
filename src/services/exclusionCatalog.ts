import { PIPED_HOSTS } from './search';

/* Recherche réservée à la gestion des exclusions. Contrairement à la
   recherche de sélection, elle ne filtre PAS les titres déjà exclus : on
   doit pouvoir les reconnaître et éviter les doublons. Piped lit les
   filtres music_songs / music_artists de YouTube Music ; ce sont des
   instances publiques indépendantes, pas une API officielle de Google. */
export type CatalogTrack = {
  kind: 'track'; title: string; artist: string; videoId: string;
  thumbnail?: string; durationSeconds?: number;
};
export type CatalogArtist = { kind: 'artist'; artist: string; id: string; thumbnail?: string };
export type CatalogResult = CatalogTrack | CatalogArtist;

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const image = (value: unknown) => {
  const url = text(value);
  return /^https:\/\//i.test(url) ? url : undefined;
};
const videoId = (url: unknown) => {
  const match = text(url).match(/[?&]v=([A-Za-z0-9_-]{11})(?:[&#]|$)/);
  return match?.[1] || '';
};
const withoutTopic = (value: string) => value.replace(/\s*[-–—]\s*topic$/i, '').trim();
const aborted = () => new DOMException('Recherche annulée', 'AbortError');

/** Limite également la lecture du JSON, pas seulement l'arrivée des en-têtes. */
const request = async (url: string, signal: AbortSignal): Promise<unknown[]> => {
  if (signal.aborted) throw aborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(aborted()); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Délai dépassé')); }, 5000);
  });
  try {
    const read = (async () => {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Recherche indisponible (${response.status})`);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !Array.isArray((data as { items?: unknown }).items)) {
        throw new Error('Réponse de recherche invalide');
      }
      return (data as { items: unknown[] }).items;
    })();
    return await Promise.race([read, cancelled, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
};

/** Une liste vide est un vrai résultat ; une panne reste une erreur visible. */
export const searchExclusionCatalog = async (
  query: string, kind: 'track' | 'artist', signal: AbortSignal,
): Promise<CatalogResult[]> => {
  const q = query.trim();
  if (!q) return [];
  const filter = kind === 'track' ? 'music_songs' : 'music_artists';
  let items: unknown[] | null = null;
  // Deux instances distinctes : 5 s maximum par hôte, puis message et nouvel essai.
  for (const host of PIPED_HOSTS.slice(0, 2)) {
    try {
      items = await request(`${host}/search?q=${encodeURIComponent(q)}&filter=${filter}`, signal);
      break;
    } catch {
      if (signal.aborted) throw aborted();
    }
  }
  if (!items) throw new Error('Recherche indisponible. Vérifie ta connexion et réessaie.');

  const results: CatalogResult[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (kind === 'track' && item.type === 'stream') {
      const id = videoId(item.url);
      const title = text(item.title);
      const artist = withoutTopic(text(item.uploaderName));
      if (!id || !title || !artist || seen.has(id)) continue;
      seen.add(id);
      const seconds = typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0 ? item.duration : undefined;
      results.push({ kind: 'track', title, artist, videoId: id, thumbnail: image(item.thumbnail), durationSeconds: seconds });
    } else if (kind === 'artist' && item.type === 'channel') {
      const name = withoutTopic(text(item.name));
      if (!name) continue;
      const id = text(item.url) || name;
      const key = id.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ kind: 'artist', artist: name, id, thumbnail: image(item.thumbnail) });
    }
    if (results.length >= 30) break;
  }
  return results;
};
