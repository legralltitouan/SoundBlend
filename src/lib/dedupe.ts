/* ═══════════════════════════════════════════════════════════════
   Reconnaître un morceau, et ne jamais le proposer deux fois.

   Deux morceaux sont « le même » si l'un de ces signes concorde :

   · l'identifiant vidéo YouTube — le plus sûr, mais connu seulement
     après la recherche ;
   · le couple titre + artiste, une fois nettoyés des suffixes qui ne
     changent pas le morceau : « (Official Audio) », « - Remastered
     2011 », « [Clip officiel] », « Radio Edit », « Live »…

   Le titre seul sert de dernier filet : « Nightcall » deux fois avec
   deux orthographes d'artiste, c'est encore un doublon pour l'oreille.
   ═══════════════════════════════════════════════════════════════ */

export const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s[-–—]\s.*$/, ' ')
    .replace(/\b(?:remaster(?:ed)?|version|edit|live|official|audio|video|clip|mv|lyrics?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export type MaybeTrack = { videoId?: string; title?: string; artist?: string };

export const trackKeys = (t: MaybeTrack) => {
  const keys: string[] = [];
  if (t.videoId && t.videoId.length > 5) keys.push(`v:${t.videoId}`);
  const ti = norm(t.title || '');
  const ar = norm(t.artist || '');
  if (ti && ar) keys.push(`ta:${ti}|${ar}`);
  if (ti) keys.push(`t:${ti}`);
  return keys;
};

/** garde le premier de chaque morceau, dans l'ordre reçu */
export const dedupeTracks = <T extends MaybeTrack>(tracks: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tracks) {
    const keys = trackKeys(t);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(t);
  }
  return out;
};

/**
 * Le dernier verrou, une fois les identifiants vidéo connus.
 *
 * La recherche YouTube peut renvoyer **la même vidéo** pour deux titres
 * différents (« Something About Us » et sa version « Love Theme »).
 * Deux entrées, un seul morceau : c'est encore un doublon.
 */
export const uniqueByVideo = <T extends { videoId?: string }>(tracks: T[]): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of tracks) {
    const v = (t.videoId || '').trim();
    if (v) {
      if (seen.has(v)) continue;
      seen.add(v);
    }
    out.push(t);
  }
  return out;
};

/** les deux verrous, dans l'ordre : titres puis identifiants vidéo */
export const uniqueTracks = <T extends MaybeTrack>(tracks: T[]): T[] =>
  uniqueByVideo(dedupeTracks(tracks));
