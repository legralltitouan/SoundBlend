import { TasteMemory, Track, TrackCategory } from '../types';
import { getStoredPortrait, saveStoredPortrait, type SoundPortrait } from './storage';

/* ═══════════════════════════════════════════════════════════════
   Le raisonnement du curateur.

   Le problème qu'on corrige ici n'était pas un manque de puissance du
   modèle : c'était un prompt. On demandait « génère N morceaux » avec la
   liste des amorces, et le modèle répondait à la question posée — la
   plupart du temps avec les titres les plus connus de ces artistes, et
   toujours les mêmes. Le catalogue de secours, lui, était écrit à la main
   avec une demi-douzaine de morceaux : d'où l'impression de retrouver les
   « morceaux d'office de la démo ».

   Ce fichier découpe la tâche en trois moments distincts, comme le ferait
   un vrai curateur :

     1. ÉCOUTER — décrire ce que les amorces ont en commun : genre,
        textures, époque, énergie, production. Et lire les goûts de la
        personne (aimés / rejetés).
     2. COMPRENDRE — en déduire un portrait : la ligne du blend, ce qui
        relie les morceaux, et ce qu'il faut éviter.
     3. CHOISIR — trois sélections distinctes :
          · anchor    : uniquement parmi les amorces choisies ;
          · deep_dive : d'autres morceaux des MÊMES artistes (faces B,
                        albums, raretés) — pas les singles connus ;
          · fresh     : des artistes ABSENTS de la sélection et déjà
                        présents dans le blend, du même monde sonore.

   Chaque étape est vérifiée : un titre déjà dans le blend, un titre déjà
   proposé, un artiste rejeté sont écartés avant d'arriver à l'écran.
   Si une étape ne rend rien d'exploitable, on ne fabrique pas : on le dit.
   ═══════════════════════════════════════════════════════════════ */

export type CallModel = (prompt: string, temperature: number, budgetMs: number) => Promise<string | null>;

/* ─────────────── 1. écouter ─────────────── */

/** Ce que le modèle comprend des amorces, en une passe. */
export type Analysis = {
  /** la phrase qui décrit le fil rouge */
  fil: string;
  genres: string[];
  textures: string[];
  epoques: string[];
  energie: string;
  /** ce qui, dans les goûts de la personne, confirme ou nuance */
  gout: string;
  /** les artistes à éviter, en plus de ceux déjà refusés */
  eviter: string[];
};

const arr = (v: any, max = 8): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter((x) => x.length > 0 && x.length < 60).slice(0, max)
    : [];

export const analysisPrompt = (seeds: Track[], taste: TasteMemory, portrait: SoundPortrait | null) => `
Tu es un curateur musical. Un auditeur a choisi quelques morceaux d'amorce ; ton premier travail est de les ÉCOUTER, pas encore de proposer quoi que ce soit.

═══ LES AMORCES ═══
${seeds.map((t) => `- "${t.title}" — ${t.artist}`).join('\n')}

═══ CE QUE L'ON SAIT DE SES GOÛTS ═══
Artistes aimés : ${taste.likedArtists.join(', ') || 'non renseigné'}
Morceaux aimés : ${taste.likedTracks.slice(0, 12).map((t) => `${t.title} — ${t.artist}`).join(', ') || 'aucun'}
Artistes écartés (INTERDITS) : ${taste.dislikedArtists.join(', ') || 'aucun'}
Morceaux écartés (INTERDITS) : ${taste.dislikedTracks.slice(0, 12).map((t) => `${t.title} — ${t.artist}`).join(', ') || 'aucun'}
${portrait ? `Portrait établi lors d'une écoute précédente : ${portrait.style}` : ''}

═══ TA TÂCHE ═══
Décris ce que ces morceaux ont en commun, avec les mots d'un critique musical — pas des étiquettes creuses.
- le fil rouge : ce qui relie vraiment ces morceaux (instrumentation, façon de produire, époque, climat)
- les genres et micro-genres précis
- les textures et couleurs de production (analogique, saturé, aérien, sec…)
- l'énergie et le tempo ressenti
- ce que les goûts de l'auditeur confirment, ou au contraire nuancent : s'il aime des choses éloignées des amorces, dis-le
- les artistes à éviter : ceux qu'il a rejetés, plus ceux qui traîneraient artificiellement dans le même coin et ruineraient le blend

Réponds STRICTEMENT en JSON, sans texte autour :
{
  "fil": "une phrase sur ce qui relie ces morceaux",
  "genres": ["…", "…"],
  "textures": ["…", "…"],
  "epoques": ["…", "…"],
  "energie": "…",
  "gout": "…",
  "eviter": ["nom d'artiste", "…"]
}`;

export const parseAnalysis = (raw: string | null): Analysis | null => {
  const v = firstJson(raw);
  if (!v || typeof v !== 'object') return null;
  const fil = typeof v.fil === 'string' ? v.fil.trim() : '';
  if (!fil) return null;
  return {
    fil,
    genres: arr(v.genres),
    textures: arr(v.textures),
    epoques: arr(v.epoques),
    energie: typeof v.energie === 'string' ? v.energie.trim() : '',
    gout: typeof v.gout === 'string' ? v.gout.trim() : '',
    eviter: arr(v.eviter),
  };
};

/* ─────────────── 2. comprendre ─────────────── */

/** Le portrait de la personne : déduit de son analyse + de son historique. */
export const toPortrait = (a: Analysis, taste: TasteMemory): SoundPortrait => ({
  style: [a.fil, a.gout].filter(Boolean).join(' '),
  genres: a.genres,
  textures: a.textures,
  energy: a.energie,
  avoid: [...a.eviter, ...taste.dislikedArtists].filter((x, i, all) => all.indexOf(x) === i).slice(0, 12),
  at: new Date().toISOString(),
});

/** Le portrait enregistré (il reste valable jusqu'à ce qu'un blend le
    réécrive). */
export const portraitFor = (_taste: TasteMemory): SoundPortrait | null =>
  getStoredPortrait() || null;

/* ─────────────── le remplacement : un seul rôle, mais le même raisonnement ─────────────── */

/**
 * La requête du remplacement.
 *
 * Elle réutilise TOUT ce que le curateur a déjà compris — le fil du
 * blend, ses genres, ses textures, l'énergie, les goûts, les interdits —
 * et y ajoute le contexte local : la place du morceau, ses voisins, son
 * rôle. C'est ce qui manquait : la recherche partait du seul titre à
 * remplacer, sans le monde sonore autour.
 */
export const replacePrompt = (args: {
  target: Track;
  role: TrackCategory;
  index: number;
  total: number;
  before?: Track;
  after?: Track;
  seeds: Track[];
  all: Track[];
  taste: TasteMemory;
  portrait: SoundPortrait | null;
  forbidden: string[];
}) => {
  const { target, role, index, total, before, after, seeds, all, taste, portrait, forbidden } = args;
  const roleText: Record<TrackCategory, string> = {
    anchor: `« ANCHOR » — un pilier. Choisis UNIQUEMENT parmi les amorces de l'auditeur
(liste ci-dessous) un morceau qui n'est pas déjà dans le blend.`,
    deep_dive: `« DEEP DIVE » — une face cachée. Choisis un morceau d'un des ARTISTES DES
AMORCES, mais pas leur single le plus connu : un titre d'album, une face B, un
instrumental, une collaboration. Ce que la personne n'a probablement pas en playlist.`,
    fresh: `« DÉCOUVERTE » — un inconnu qui tombera juste. Choisis un morceau d'un artiste
ABSENT des amorces et absent du blend, dans le même monde sonore.`,
  };

  return `
Tu es le curateur musical de SoundBlend AI. On te demande de remplacer UN morceau dans un blend déjà composé, et le choix doit se justifier musicalement.

═══ CE QUE TU AS COMPRIS DU BLEND ═══
${portrait ? `Fil sonore : ${portrait.style}
Genres : ${portrait.genres.join(', ') || '—'}
Textures / production : ${portrait.textures.join(', ') || '—'}
Énergie : ${portrait.energy || '—'}` : `Amorces de l'auditeur : ${seeds.map((t) => `« ${t.title} » — ${t.artist}`).join(' · ')}`}

═══ LE MORCEAU À REMPLACER ═══
« ${target.title} » — ${target.artist}
rôle : ${roleText[role]}
raison de sa présence : ${target.rationale || 'non précisée'}
place : ${index + 1} sur ${total}
${before ? `juste avant : « ${before.title} » — ${before.artist} (${before.category})` : 'c’est le premier morceau'}
${after ? `juste après : « ${after.title} » — ${after.artist} (${after.category})` : 'c’est le dernier morceau'}

═══ LES AMORCES DE L'AUDITEUR ═══
${seeds.map((t) => `- « ${t.title} » — ${t.artist}`).join('\n')}

═══ LE RESTE DU BLEND (ne rien reproposer) ═══
${all.filter((t) => t.id !== target.id).map((t) => `- « ${t.title} » — ${t.artist}`).join('\n') || '- (aucun)'}

═══ SES GOÛTS ═══
Aimés : ${[...taste.likedArtists, ...taste.likedTracks.slice(0, 12).map((t) => `${t.title} — ${t.artist}`)].join(', ') || 'non renseigné'}
À éviter absolument : ${[...taste.dislikedArtists, ...taste.dislikedTracks.slice(0, 12).map((t) => `${t.title} — ${t.artist}`)].join(', ') || 'aucun'}

═══ DÉJÀ INTERDIT ═══
${forbidden.length ? forbidden.slice(-60).map((f) => `- ${f}`).join('\n') : '- (rien)'}

═══ TA TÂCHE ═══
Réfléchis d'abord à ce que ce morceau apporte à cet endroit précis : son énergie, son tempo
ressenti, sa texture, son époque, la transition avec ses deux voisins. Puis propose CINQ
morceaux qui pourraient le remplacer, du plus évident au plus audacieux.

Chacun doit :
1. tenir le même rôle (${roleText[role].split('—')[0].trim()}) ;
2. assurer une transition crédible avec le voisin d'avant et celui d'après ;
3. être un VRAI morceau, vrai titre et vrai artiste — aucune invention ;
4. ne figurer ni dans le blend, ni dans les interdits ;
5. exister en écoute sur YouTube ;
6. être justifié précisément (un instrument, une couleur de production, une filiation).

Réponds STRICTEMENT en JSON, sans texte autour :
{ "analyse": "une phrase sur ce que ce morceau apporte à cet endroit du blend",
  "suggestions": [ { "title": "…", "artist": "…", "rationale": "…" } ] }`;
};

export const rememberPortrait = (p: SoundPortrait): void => saveStoredPortrait(p);

/* ─────────────── 3. choisir ─────────────── */

export type PickCounts = { anchor: number; deepDive: number; fresh: number };

export const listPrompt = (
  role: TrackCategory,
  count: number,
  seeds: Track[],
  analysis: Analysis,
  taste: TasteMemory,
  forbidden: string[],
) => {
  const roleText: Record<TrackCategory, string> = {
    anchor: `« ANCHOR » — les piliers du blend.
Choisis-les UNIQUEMENT parmi les amorces ci-dessus. Tu en proposes ${count} de plus
que l'auditeur n'en a coché, ou tu complètes la sélection s'il y en a moins : dans
tous les cas, chaque titre que tu cites doit figurer MOT POUR MOT dans la liste des
amorces, et n'être proposé qu'une seule fois.`,
    deep_dive: `« DEEP DIVE » — les faces cachées.
Choisis ${count} morceaux d'ARTISTES FIGURANT DANS LES AMORCES, mais PAS les singles
les plus connus de ces artistes : des titres d'album, des faces B, des instrumentaux,
des collaborations, des reprises méconnues — ce que la personne n'a probablement pas
mis dans ses playlists. Interdits : les titres déjà dans les amorces.`,
    fresh: `« DÉCOUVERTE » — les inconnus qui tomberont juste.
Choisis ${count} morceaux d'ARTISTES ABSENTS de la liste des amorces, en te fondant sur
le fil sonore décrit plus haut (mêmes textures, même époque, même énergie) ET sur les
goûts de la personne (ce qu'elle a aimé guide le choix, ce qu'elle a rejeté l'exclut).
Aucun de ces artistes ne doit déjà figurer dans les amorces.`,
  };

  return `
Tu es le curateur musical de SoundBlend AI. Tu as déjà écouté les amorces ; voici ce que tu en as conclu.

═══ LE FIL DU BLEND ═══
${analysis.fil}
Genres : ${analysis.genres.join(', ') || '—'}
Textures / production : ${analysis.textures.join(', ') || '—'}
Époque : ${analysis.epoques.join(', ') || '—'}
Énergie : ${analysis.energie || '—'}

═══ LES AMORCES DE L'AUDITEUR ═══
${seeds.map((t) => `- "${t.title}" — ${t.artist}`).join('\n')}

═══ SES GOÛTS ═══
Aimés : ${[...taste.likedArtists, ...taste.likedTracks.slice(0, 10).map((t) => `${t.title} — ${t.artist}`)].join(', ') || 'non renseigné'}
À éviter absolument : ${[...taste.dislikedArtists, ...taste.dislikedTracks.slice(0, 10).map((t) => `${t.title} — ${t.artist}`)].join(', ') || 'aucun'}

═══ DÉJÀ INTERDIT ═══
Ne propose aucun de ces titres ni aucun morceau du même artiste si l'artiste est listé :
${forbidden.length ? forbidden.map((f) => `- ${f}`).join('\n') : '- (rien)'}

═══ TA SÉLECTION ═══
${roleText[role]}

Règles pour CHAQUE titre :
· c'est un vrai morceau, avec son vrai titre et son vrai artiste — aucune invention,
  aucun remix imaginaire, aucun « à paraître » ;
· il doit exister en écoute sur YouTube ;
· il ne figure ni dans les amorces, ni dans les interdits ci-dessus ;
· la justification dit ce qui relie le morceau à ce blend précis (un instrument, une
  couleur de production, un tempo ressenti, une filiation) — pas « même ambiance ».

Réponds STRICTEMENT en JSON, sans texte autour :
{ "analyse": "une phrase sur le choix de cette liste",
  "titres": [ { "title": "…", "artist": "…", "rationale": "…" } ] }`;
};

export type Pick = { title: string; artist: string; rationale: string };

export const parsePicks = (raw: string | null): { analyse: string; titres: Pick[] } => {
  const v = firstJson(raw);
  const list = Array.isArray(v) ? v : Array.isArray(v?.titres) ? v.titres : Array.isArray(v?.suggestions) ? v.suggestions : [];
  const titres: Pick[] = list
    .filter((i: any) => i && typeof i.title === 'string' && typeof i.artist === 'string')
    .map((i: any) => ({
      title: String(i.title).trim().slice(0, 120),
      artist: String(i.artist).trim().slice(0, 120),
      rationale: String(i.rationale || '').trim().slice(0, 260),
    }))
    .filter((p: Pick) => p.title.length > 1 && p.artist.length > 1);
  return {
    analyse: typeof v?.analyse === 'string' ? v.analyse.trim() : '',
    titres,
  };
};

/* le premier bloc JSON d'une réponse — même règle que dans gemini.ts */
export function firstJson(raw: string | null): any | null {
  if (!raw) return null;
  try { return JSON.parse(raw.trim()); } catch { /* extraits */ }
  const arr = raw.match(/\[[\s\S]*\]/);
  const obj = raw.match(/\{[\s\S]*\}/);
  for (const c of [obj?.[0], arr?.[0]]) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* suivant */ }
  }
  return null;
}

/* ─────────────── l'ordre des rôles ─────────────── */

/**
 * La répartition demandée, ajustée pour rester honnête : on ne peut pas
 * mettre en anchor plus de morceaux qu'il n'y a d'amorces. Si le compte
 * ne tombe pas juste, on décale les places restantes vers les découvertes,
 * qui sont toujours possibles.
 */
export const splitCounts = (
  total: number,
  ratio: { anchor: number; deepDive: number; fresh: number },
  seedCount: number,
): PickCounts => {
  const sum = ratio.anchor + ratio.deepDive + ratio.fresh || 100;
  const wanted = (p: number) => Math.round((total * p) / sum);
  let anchor = Math.min(seedCount, Math.max(1, wanted(ratio.anchor)));
  let deepDive = Math.max(1, wanted(ratio.deepDive));
  let fresh = Math.max(1, total - anchor - deepDive);
  /* si le compte dépasse le total, on retire d'abord aux deep dives */
  while (anchor + deepDive + fresh > total) {
    if (deepDive > 1) deepDive--;
    else if (fresh > 1) fresh--;
    else break;
  }
  /* et s'il en manque, on complète en découvertes */
  fresh += Math.max(0, total - (anchor + deepDive + fresh));
  return { anchor, deepDive, fresh };
};
