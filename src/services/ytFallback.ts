/* ═══════════════════════════════════════════════════════════════
   La recherche YouTube sans clé.

   Pourquoi ce fichier existe : le moteur demande à YouTube de vérifier
   chaque titre qu'il a proposé. Cette vérification passait uniquement par
   l'API Data v3, qui exige une clé dans *Réglages → Clés & API*. Sans
   clé — ou une clé dont le quota du jour est épuisé — `findPlayable`
   rendait `null` pour **tous** les titres, et le blend retombait sur les
   seuls piliers, qui n'ont pas besoin d'être cherchés puisqu'ils
   viennent des morceaux déjà choisis. C'était exactement le symptôme :
   « seuls les anchors ».

   Une instance Piped renvoie le même genre de résultats, sans clé, avec
   les en-têtes CORS qu'il faut. Elle sert de **deuxième voie**, jamais de
   première : si la clé fonctionne, on ne la sollicite pas.
   ═══════════════════════════════════════════════════════════════ */

const PIPED_HOSTS = [
  'https://pipedapi.ducks.party',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://api.piped.yt',
];

export type FoundVideo = {
  videoId: string;
  title: string;
  artist: string;
  durationSeconds?: number;
};

const cache = new Map<string, FoundVideo | null>();
const HOST_TTL = 10 * 60 * 1000;
const deadHosts = new Map<string, number>();

const hostAlive = (h: string) => {
  const until = deadHosts.get(h) || 0;
  if (until && Date.now() > until) { deadHosts.delete(h); return true; }
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

type PipedItem = {
  url?: string;
  title?: string;
  uploaderName?: string;
  duration?: number;
  type?: string;
};

const videoIdOf = (item: PipedItem): string => {
  const u = item.url || '';
  const m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/\/([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : '';
};

/**
 * Cherche un morceau et rend le premier résultat exploitable.
 *
 * `music_songs` d'abord : c'est le catalogue musical de YouTube, celui
 * qui donne « Genesis » par Justice plutôt que le dixième repiquage.
 * `videos` ensuite, pour les titres qui n'y sont pas référencés.
 */
export const searchWithoutKey = async (
  query: string,
  opts: { minMs?: number; maxMs?: number } = {},
): Promise<FoundVideo | null> => {
  const key = query.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key)!;

  const minMs = opts.minMs ?? 0;
  const maxMs = opts.maxMs ?? 15 * 60 * 1000; // au-delà, c'est un album, pas une piste

  for (const host of PIPED_HOSTS) {
    if (!hostAlive(host)) continue;
    for (const filter of ['music_songs', 'videos']) {
      const url = `${host}/search?q=${encodeURIComponent(query)}&filter=${filter}`;
      const res = await cut(
        fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        9000,
        null as any,
      );
      if (!res) { deadHosts.set(host, Date.now() + HOST_TTL); break; }

      const items: PipedItem[] = Array.isArray(res.items) ? res.items : [];
      const found = items
        .filter((i) => i.type !== 'channel' && i.type !== 'playlist')
        .map((i) => ({ ...i, id: videoIdOf(i) }))
        .find((i) => {
          if (!i.id) return false;
          const d = (i.duration || 0) * 1000;
          return d === 0 || (d >= minMs && d <= maxMs);
        });

      if (found) {
        const v: FoundVideo = {
          videoId: found.id,
          title: found.title || query,
          artist: found.uploaderName || '',
          durationSeconds: found.duration || undefined,
        };
        cache.set(key, v);
        return v;
      }
    }
  }

  cache.set(key, null);
  return null;
};

/** La même recherche, mais on veut tous les résultats (remplacement). */
export const searchManyWithoutKey = async (query: string, limit = 12): Promise<FoundVideo[]> => {
  for (const host of PIPED_HOSTS) {
    if (!hostAlive(host)) continue;
    const url = `${host}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
    const res = await cut(
      fetch(url, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      9000,
      null as any,
    );
    if (!res) { deadHosts.set(host, Date.now() + HOST_TTL); continue; }
    const items: PipedItem[] = Array.isArray(res.items) ? res.items : [];
    return items
      .map((i) => ({ ...i, id: videoIdOf(i) }))
      .filter((i) => !!i.id)
      .slice(0, limit)
      .map((i) => ({
        videoId: i.id,
        title: i.title || '',
        artist: i.uploaderName || '',
        durationSeconds: i.duration || undefined,
      }));
  }
  return [];
};

/** Combien de temps on attend avant de considérer une voie muette. */
export const SEARCH_FALLBACK_BUDGET = 9000;
