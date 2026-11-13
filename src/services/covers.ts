/* ═══════════════════════════════════════════════════════════════
   Pochettes d'album, les vraies.

   YouTube ne donne que la vignette de la vidéo — et celle-ci manque
   souvent (vidéo retirée, miniature absente). Pour avoir la vraie
   pochette de l'album, on interroge le catalogue public d'iTunes
   (API ouverte, CORS `*`), qui renvoie l'artwork officiel jusqu'à
   1000 × 1000 px.

   Quatre garanties :
   · aucune requête en double (cache + requêtes en vol dédupliquées) ;
   · le résultat est mémorisé dans localStorage pendant sept jours ;
   · une seule requête à la fois, espacées : iTunes renvoie 429 dès qu'on
     le presse, et une pochette manquante n'a jamais rien cassé ;
   · un échec n'est pas réessayé à chaque rendu — il est noté pour un
     moment, sinon chaque survol relançait la même requête refusée.
   ═══════════════════════════════════════════════════════════════ */

export type Cover = { small: string; large: string; album?: string; source: 'itunes' | 'youtube' };

const MEM_KEY = 'soundblend_covers_v1';
const TTL = 7 * 24 * 3600 * 1000;

type Entry = { c: Cover; at: number };
let store: Record<string, Entry> | null = null;
const inFlight = new Map<string, Promise<Cover | null>>();

const load = (): Record<string, Entry> => {
  if (store) return store;
  try {
    store = JSON.parse(localStorage.getItem(MEM_KEY) || '{}') as Record<string, Entry>;
  } catch {
    store = {};
  }
  return store!;
};

const persist = () => {
  try {
    const mem = load();
    /* on ne garde que les entrées récentes et un volume raisonnable */
    const now = Date.now();
    const kept = Object.entries(mem)
      .filter(([, v]) => now - v.at < TTL)
      .slice(-400);
    localStorage.setItem(MEM_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* stockage plein ou refusé : sans gravité */ }
};

const keyOf = (artist: string, title: string) =>
  `${(artist || '').toLowerCase().trim()}|${(title || '').toLowerCase().trim()}`;

/* ── le robinet ──────────────────────────────────────────────────
   iTunes public limite durement : trois requêtes simultanées suffisent à
   déclencher des 429. On n'en lance donc qu'une à la fois, avec un
   intervalle mini de 350 ms, et on abandonne pour un moment les titres
   qui ont été refusés. Une pochette est un agrément ; elle ne doit jamais
   coûter une rafale de requêtes dans la console. */
const MIN_GAP_MS = 350;
const RETRY_AFTER_MS = 6 * 60 * 1000;

let active = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];
/** les titres refusés récemment : on ne les redemande pas tout de suite */
const refused = new Map<string, number>();
/* un 429 d'iTunes vise le service entier, pas le titre : quand il tombe,
   on laisse le catalogue tranquille une minute. Une pochette est un
   agrément — mieux vaut un dégradé local qu'une rafale de refus. */
const HOST_QUIET_MS = 60_000;
let hostQuietUntil = 0;

const acquire = () =>
  new Promise<void>((resolve) => {
    const run = () => {
      const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastStart));
      setTimeout(() => {
        active++;
        lastStart = Date.now();
        resolve();
      }, wait);
    };
    if (active < 1) run();
    else waiting.push(run);
  });
const release = () => {
  active--;
  const next = waiting.shift();
  if (next) next();
};

const fetchWithTimeout = async (url: string, ms = 6000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
};

/* d'une URL iTunes 100 px, on fabrique la version 600 et 1000 px */
const resize = (url: string, px: number) => url.replace(/\d+x\d+bb\.(jpg|png)$/, `${px}x${px}bb.$1`);

const lookupItunes = async (artist: string, title: string): Promise<Cover | null> => {
  const term = encodeURIComponent(`${artist} ${title}`.trim());
  if (!term) return null;
  /* refusé récemment : on n'insiste pas */
  const k = keyOf(artist, title);
  const until = refused.get(k);
  if (until && Date.now() < until) return null;
  if (Date.now() < hostQuietUntil) return null;

  await acquire();
  try {
    const resp = await fetchWithTimeout(`https://itunes.apple.com/search?term=${term}&entity=song&limit=25`);
    if (!resp.ok) {
      /* 429 : on met ce titre de côté un moment, et on laisse la console
         tranquille — c'est un agrément, pas une panne */
      if (resp.status === 429 || resp.status === 403) {
        refused.set(k, Date.now() + RETRY_AFTER_MS);
        hostQuietUntil = Date.now() + HOST_QUIET_MS;
      }
      return null;
    }
    const data = await resp.json();
    const items: any[] = data?.results || [];
    if (!items.length) return null;

    const nArtist = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const nTitle = (s: string) => (s || '')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

    /* Une pochette fausse est pire que pas de pochette : on n'accepte un
       résultat que si l'artiste figure vraiment dedans — de préférence avec
       le titre exact. Les reprises et homonymes sont écartés. */
    const wantArtist = nArtist(artist).replace(/[^a-z0-9]+/g, ' ').trim();
    const firstWord = wantArtist.split(' ')[0] || '';
    const artistOf = (r: any) => nArtist(`${r.artistName || ''} ${r.collectionArtistName || ''}`).replace(/[^a-z0-9]+/g, ' ');
    const matches = items.filter((r) => wantArtist && artistOf(r).includes(wantArtist));
    const exact = matches.find((r) => nTitle(r.trackName || '') === nTitle(title));
    const loose = items.find(
      (r) => firstWord.length > 2 && artistOf(r).includes(firstWord) && nTitle(r.trackName || '') === nTitle(title),
    );
    const hit = exact || matches[0] || loose || null;
    const art: string | undefined = hit?.artworkUrl100;
    if (!art) return null;
    return {
      small: resize(art, 600),
      large: resize(art, 2000),
      album: hit?.collectionName,
      source: 'itunes',
    };
  } catch {
    return null;
  } finally {
    release();
  }
};

/* ─────────── l'API publique ─────────── */

export const coverKey = keyOf;

export const getCachedCover = (artist: string, title: string): Cover | null => {
  const e = load()[keyOf(artist, title)];
  if (!e) return null;
  if (Date.now() - e.at > TTL) return null;
  return e.c;
};

export const resolveCover = (artist: string, title: string): Promise<Cover | null> => {
  const k = keyOf(artist, title);
  const cached = getCachedCover(artist, title);
  if (cached) return Promise.resolve(cached);
  const running = inFlight.get(k);
  if (running) return running;

  const p = lookupItunes(artist, title)
    .then((cover) => {
      if (cover) {
        load()[k] = { c: cover, at: Date.now() };
        persist();
      }
      return cover;
    })
    .finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
};

/* la pochette YouTube, seule information toujours disponible sans requête */
export const youtubeThumb = (videoId?: string, px: 120 | 320 | 480 | 1280 = 320) => {
  if (!videoId) return '';
  const name = px <= 120 ? 'default' : px <= 320 ? 'mqdefault' : px <= 480 ? 'hqdefault' : 'maxresdefault';
  return `https://i.ytimg.com/vi/${videoId}/${name}.jpg`;
};

/* on vérifie qu'une image existe réellement (les vidéos mortes renvoient 404) */
const checked = new Map<string, boolean>();
export const imageExists = (url: string): Promise<boolean> => {
  if (checked.has(url)) return Promise.resolve(checked.get(url)!);
  return new Promise((resolve) => {
    const img = new Image();
    const done = (ok: boolean) => { checked.set(url, ok); resolve(ok); };
    img.onload = () => done(img.naturalWidth > 20);
    img.onerror = () => done(false);
    img.src = url;
    setTimeout(() => { if (!checked.has(url)) done(false); }, 5000);
  });
};
