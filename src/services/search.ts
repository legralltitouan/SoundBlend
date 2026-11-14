/* ═══════════════════════════════════════════════════════════════
   Retrouver un morceau sur YouTube, et composer sans modèle.

   Trois voies seulement, essayées dans cet ordre par `youtube.ts` :

     1. l'API Data v3, avec la clé de la personne ;
     2. le jeton OAuth de la session ;
     3. Piped — le même catalogue, lu par un service public : ni clé,
        ni quota. Deux hôtes vivants, deux en dernier recours.

   S'y ajoutent deux outils qui ne servent qu'aux cas dégradés :
   `verifyVideo()` (contrôler un identifiant donné par le modèle, sans
   clé) et le voisinage (`artistTracks`, `relatedArtists`), utilisé
   seulement quand aucun modèle ne répond.

   Ce fichier ne décide de rien : il cherche et rend des candidats.
   ═══════════════════════════════════════════════════════════════ */

export type Video = { videoId: string; title: string; artist: string; durationSeconds?: number };

/* ─────────────── Piped : la recherche sans clé ─────────────── */

/* Vérifiés vivants : deux seulement répondent encore en 2026. Les autres
   sont gardés en dernier recours — un hôte mort coûte une coupure de 9 s
   et une erreur CORS dans la console, donc ils passent après. */
const PIPED_HOSTS = [
  'https://pipedapi.ducks.party',
  'https://api.piped.private.coffee',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
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

/* ─────────────── vérifier une vidéo, sans clé ─────────────── */

const oembedCache = new Map<string, { at: number; ok: boolean; title: string; author: string; jouable: boolean; duree?: number }>();
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
): Promise<{ ok: boolean; title: string; author: string; jouable?: boolean; duree?: number } | null> => {
  const hit = oembedCache.get(videoId);
  if (hit && Date.now() - hit.at < OEMBED_TTL) return { ok: hit.ok, title: hit.title, author: hit.author, jouable: hit.jouable, duree: hit.duree };
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  const res = await cut(
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((r) => {
        /* 400 / 401 / 404 : YouTube ne connaît plus cette vidéo, ou elle
           est privée — c'est un « non » franc. Un 403, un 5xx ou une page
           de pare-feu ne disent rien du morceau : ce n'est pas à eux de
           le condamner. */
        if (!r.ok) return { __ko: r.status };
        return r.json();
      })
      .catch(() => null),
    6000,
    null as any,
  );
  if (!res) return null;                       // réseau muet : on ne sait pas
  if (res.__ko) {
    const mort = res.__ko === 400 || res.__ko === 401 || res.__ko === 404 || res.__ko === 410;
    if (!mort) return null;                    // 403, 5xx : on ne sait pas
    const out = { ok: false, title: '', author: '', jouable: false };
    oembedCache.set(videoId, { at: Date.now(), ...out });
    return out;
  }
  const out = { ok: true, title: String(res.title || ''), author: String(res.author_name || ''), jouable: true };
  oembedCache.set(videoId, { at: Date.now(), ...out });
  return out;
};

/** L'identifiant a-t-il la forme d'un identifiant YouTube ? */
export const looksLikeVideoId = (v?: string) => !!v && /^[A-Za-z0-9_-]{11}$/.test(v);

/* ─────────────── les voisins d'un artiste ───────────────

   Quand aucun modèle ne répond, il reste une vérité exploitable sans
   aucune IA : les morceaux qui **vont ensemble** sont souvent sur la même
   chaîne, dans la même playlist, ou à côté dans les résultats de
   recherche. On demande donc à Piped les morceaux d'un artiste proche de
   celui des piliers — jamais l'artiste des piliers lui-même pour les
   découvertes — et on garde ce qui ressemble.

   Ce n'est pas du goût, c'est du voisinage : moins fin qu'un modèle, mais
   réel, vérifiable, et disponible même quand Gemini est à sec. */

const voisinCache = new Map<string, { at: number; items: Video[] }>();
const VOISIN_TTL = 30 * 60 * 1000;

/** Des morceaux de cet artiste. Le tri (déjà vus, doublons) se fait chez
    l'appelant : le cache garde la liste brute, donc il sert à tout. */
export const artistTracks = async (artist: string): Promise<Video[]> => {
  const key = artist.toLowerCase().trim();
  const hit = voisinCache.get(key);
  if (hit && Date.now() - hit.at < VOISIN_TTL) return hit.items;
  /* `music_songs` est le catalogue de YouTube Music : titres propres
     (« Nightcall »), artiste exact dans `uploaderName`. `videos` ramenait
     des conférences et des cours de philosophie pour « Justice » — le
     filtre par chaîne attrapait « Justice » n'importe où. On prend donc
     le catalogue d'abord, et les vidéos seulement s'il ne dit rien.
     (`pipedSearch` rend déjà des `Video` : les repasser par `toVideos`
     les vidait, il attend la forme brute de Piped.) */
  let found = await pipedSearch(artist, 'music_songs');
  /* l'artiste doit être celui qu'on a demandé : « Kevinsky » n'est pas
     « Kavinsky », et un homonyme n'est pas une face cachée */
  let items = found.filter((v) => {
    const up = (v.artist || '').toLowerCase();
    return up.includes(key);
  });
  if (items.length < 3) {
    found = await pipedSearch(`${artist} topic`, 'videos');
    items = found.filter((v) => (v.artist || '').toLowerCase().includes(key));
  }
  voisinCache.set(key, { at: Date.now(), items });
  return items;
};

/** Les artistes proches d'un nom, quand on n'a pas de modèle pour les nommer. */
export const relatedArtists = async (artist: string): Promise<string[]> => {
  const q = await pipedSearch(`${artist} mix`, 'music_songs');
  const counts = new Map<string, number>();
  for (const v of q) {
    const a = (v.artist || '').replace(/\s*-\s*topic$/i, '').trim();
    if (!a || a.toLowerCase() === artist.toLowerCase().trim()) continue;
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  return [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([a]) => a);
};
