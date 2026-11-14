/* ═══════════════════════════════════════════════════════════════
   Retrouver un morceau sur YouTube, sans dépendre d'une seule voie.

   Trois façons, essayées dans cet ordre, indépendantes les unes des
   autres :

     1. l'API Data v3, avec la clé de la personne — la voie normale ;
     2. une instance Piped — le même catalogue, sans clé ;
     3. les listes de lecture (celle de l'auditeur, plus une poignée de
        playlists publiques « Topic », qui rassemblent les albums des
        artistes). Une playlist est lue avec **1 unité** de quota là où
        une recherche en coûte 100 : c'est la voie de secours qui ne
        s'épuise pas, et qui connaît les faces B.

   Ce fichier ne décide de rien : il cherche et rend des candidats.
   ═══════════════════════════════════════════════════════════════ */

export type Video = { videoId: string; title: string; artist: string; durationSeconds?: number };

/* ─────────────── Piped : la recherche sans clé ─────────────── */

const PIPED_HOSTS = [
  'https://pipedapi.ducks.party',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt',
];

const hostDown = new Map<string, number>();
const alive = (h: string) => {
  const until = hostDown.get(h) || 0;
  if (until && Date.now() > until) { hostDown.delete(h); return true; }
  return !until;
};

const cut = async <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let t: any;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { t = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(t);
  }
};

type PipedItem = { url?: string; title?: string; uploaderName?: string; duration?: number; type?: string };

const idOf = (item: PipedItem): string => {
  const u = item.url || '';
  const m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/\/([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : '';
};

const toVideos = (items: PipedItem[]): Video[] =>
  items
    .filter((i) => i.type !== 'channel' && i.type !== 'playlist')
    .map((i) => ({
      videoId: idOf(i),
      title: i.title || '',
      artist: i.uploaderName || '',
      durationSeconds: i.duration || undefined,
    }))
    .filter((v) => !!v.videoId);

/** Recherche libre, sans clé. `filter` : music_songs (catalogue) ou videos. */
export const pipedSearch = async (query: string, filter: 'music_songs' | 'videos' = 'music_songs'): Promise<Video[]> => {
  for (const host of PIPED_HOSTS) {
    if (!alive(host)) continue;
    const url = `${host}/search?q=${encodeURIComponent(query)}&filter=${filter}`;
    const res = await cut(
      fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      9000,
      null as any,
    );
    if (!res) { hostDown.set(host, Date.now() + 10 * 60 * 1000); continue; }
    const items: PipedItem[] = Array.isArray(res.items) ? res.items : [];
    const vids = toVideos(items);
    if (vids.length) return vids;
  }
  return [];
};

/* ─────────────── les listes de lecture, à 1 unité de quota ─────────────── */

/**
 * Le cache des morceaux par liste : une liste lue une fois sert pour
 * toutes les recherches de la session.
 */
const listCache = new Map<string, { at: number; items: Video[] }>();
const LIST_TTL = 30 * 60 * 1000;

export type ListFetcher = (playlistId: string) => Promise<Video[]>;

/** Cherche dans des listes déjà connues, sans appel réseau si elles sont en cache. */
export const searchInLists = async (
  lists: string[],
  fetchList: ListFetcher,
  predicate: (v: Video) => boolean,
): Promise<Video[]> => {
  const out: Video[] = [];
  for (const id of lists) {
    let entry = listCache.get(id);
    if (!entry || Date.now() - entry.at > LIST_TTL) {
      const items = await fetchList(id).catch(() => [] as Video[]);
      entry = { at: Date.now(), items };
      listCache.set(id, entry);
    }
    for (const v of entry.items) if (predicate(v)) out.push(v);
    if (out.length >= 6) break;
  }
  return out;
};

export const peekList = (id: string): Video[] | null => listCache.get(id)?.items || null;

/* ─────────────── vérifier une vidéo, sans clé ─────────────── */

const oembedCache = new Map<string, { at: number; ok: boolean; title: string; author: string }>();
const OEMBED_TTL = 60 * 60 * 1000;

/**
 * Cette vidéo existe-t-elle vraiment, et est-ce bien ce morceau ?
 *
 * L'endpoint `oembed` de YouTube répond en JSON **avec CORS**, sans clé,
 * et ne consomme aucun quota. Il rend le titre et la chaîne : de quoi
 * confirmer qu'un identifiant donné par le modèle n'est ni inventé, ni
 * celui d'un autre morceau. C'est ce qui rend l'identifiant-fourni-par-
 * le-modèle fiable : on ne fait plus confiance, on vérifie.
 */
export const verifyVideo = async (
  videoId: string,
): Promise<{ ok: boolean; title: string; author: string } | null> => {
  const hit = oembedCache.get(videoId);
  if (hit && Date.now() - hit.at < OEMBED_TTL) return { ok: hit.ok, title: hit.title, author: hit.author };
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await cut(
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    6000,
    null as any,
  );
  if (!res) return null;                       // réseau muet : on ne sait pas
  const out = { ok: true, title: String(res.title || ''), author: String(res.author_name || '') };
  oembedCache.set(videoId, { at: Date.now(), ...out });
  return out;
};

/** L'identifiant a-t-il la forme d'un identifiant YouTube ? */
export const looksLikeVideoId = (v?: string) => !!v && /^[A-Za-z0-9_-]{11}$/.test(v);
