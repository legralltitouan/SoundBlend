/* ═══════════════════════════════════════════════════════════════
   Identité des morceaux.

   Un même titre peut venir de la playlist A, de la playlist B, du
   catalogue YouTube ou d'une suggestion de l'IA : son `id` change à
   chaque fois. On ne peut donc pas s'en servir pour savoir s'il est
   déjà coché. La clé ci-dessous est stable : elle repose sur le
   `videoId` quand il existe, sinon sur « artiste + titre » normalisés.
   ═══════════════════════════════════════════════════════════════ */

export const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const trackKey = (t: { videoId?: string; title?: string; artist?: string } | null | undefined) => {
  if (!t) return '';
  const vid = (t.videoId || '').trim();
  if (vid) return `v:${vid}`;
  return `m:${norm(t.artist || '')}|${norm(t.title || '')}`;
};

/* le même morceau, sous deux formes différentes ? */
export const sameTrack = (
  a: { videoId?: string; title?: string; artist?: string } | null | undefined,
  b: { videoId?: string; title?: string; artist?: string } | null | undefined,
) => {
  if (!a || !b) return false;
  const ka = trackKey(a);
  const kb = trackKey(b);
  if (ka && ka === kb) return true;
  /* un des deux n'a pas de videoId : on compare les textes */
  return norm(a.title || '') === norm(b.title || '') && norm(a.artist || '') === norm(b.artist || '');
};

/* la pochette d'un morceau : son image YouTube, sinon celle de la playlist */
export const thumbFor = (videoId?: string, fallback?: string) =>
  videoId
    ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
    : fallback || '';

/* durée lisible */
export const fmtTime = (s: number) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════
   Registre des avis (pouce levé / baissé / aucun).

   Un avis n'appartient pas à une ligne de liste : il appartient au
   morceau. On le range donc sous sa clé stable, dans localStorage, et
   tous les écrans lisent la même table. C'est ce qui fait qu'un vote
   donné dans le blend se voit aussitôt dans la barre du lecteur — et
   l'inverse.
   ═══════════════════════════════════════════════════════════════ */

export type TrackRating = 'liked' | 'disliked' | null;

const RATINGS_KEY = 'soundblend_ratings_v1';

export const ratingKey = (t: { videoId?: string; title?: string; artist?: string }) => trackKey(t);

export const getStoredRatings = (): Record<string, TrackRating> => {
  try {
    const raw = JSON.parse(localStorage.getItem(RATINGS_KEY) || '{}');
    const out: Record<string, TrackRating> = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
      if (v === 'liked' || v === 'disliked') out[k] = v;
    });
    return out;
  } catch {
    return {};
  }
};

export const writeStoredRatings = (r: Record<string, TrackRating>) => {
  try { localStorage.setItem(RATINGS_KEY, JSON.stringify(r)); } catch { /* plein */ }
};

/* ═══════════════════════════════════════════════════════════════
   Nettoyer un titre venu de YouTube.

   « Lomepal - Evidemment (lyrics video) », « Daft Punk - Voyager
   (Official Audio) », « M83 'Midnight City' Official video » : le
   nom d'une vidéo n'est pas un titre. On enlève les mentions de
   format, les guillemets, les crochets, les numéros de piste, et on
   sépare l'artiste quand le titre est du type « Artiste - Titre ».

   Sert deux fois : à l'affichage, et à retrouver la bonne pochette
   (une recherche sur « Evidemment (lyrics video) » ne donne rien).
   ═══════════════════════════════════════════════════════════════ */

const NOISE = /\b(official\s*(music\s*)?video|official\s*audio|official\s*lyric\s*video|lyric\s*video|lyrics?\s*video|clip\s*officiel|clip\s*off(iciel)?|audio\s*only|audio|visuali[sz]er|videoclip|music\s*video|full\s*album|hd|hq|4k|remaster(ed)?(?:\s*\d{4})?|explicit)\b/gi;

export const cleanTitle = (raw: string): { title: string; artist?: string } => {
  let s = (raw || '').trim();

  /* « Artiste - Titre » : on garde les deux, séparément */
  let artist: string | undefined;
  const dash = s.match(/^\s*(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && dash[1].length < 40) {
    artist = dash[1].replace(/\s*-\s*Topic$/i, '').trim();
    s = dash[2];
  }
  /* « Artiste 'Titre' » (style M83) */
  const quoted = s.match(/^(.{2,40}?)\s+['"“”](.+?)['"“”]/);
  if (!artist && quoted) {
    artist = quoted[1].trim();
    s = quoted[2];
  }

  s = s
    .replace(/\((?:[^()]*?(?:official|audio|video|clip|lyric|remix|version)[^()]*?)\)/gi, ' ')
    .replace(/\[(?:[^\[\]]*?(?:official|audio|video|clip|lyric|remix|version)[^\[\]]*?)\]/gi, ' ')
    .replace(/\((?:feat\.?|ft\.?|with)\s+[^()]*\)/gi, ' ')
    .replace(/\[(?:feat\.?|ft\.?|with)\s+[^\[\]]*\]/gi, ' ')
    .replace(/^\s*\d{1,2}\s*[-.)]\s*/, '')          // numéro de piste
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  /* un dernier passage pour les mentions restées nues */
  const stripped = s.replace(NOISE, ' ').replace(/\s{2,}/g, ' ').trim();
  if (stripped.length >= 2) s = stripped;
  s = s.replace(/^[\s'"“”\-–—]+|[\s'"“”\-–—]+$/g, '').trim();

  return { title: s || raw.trim(), artist };
};
