import { BlendConfig, TasteMemory, Track, TrackCategory } from '../types';
import { getStoredSettings, getSeenTracks, rememberSeenTrack, getStoredPortrait } from './storage';
import { youtubeService, withTimeout } from './youtube';
import { dedupeTracks, uniqueByVideo } from '../lib/dedupe';
import { matchesAsked, norm } from '../lib/track';
import {
  analysisPrompt, parseAnalysis, toPortrait, rememberPortrait, portraitFor,
  listPrompt, parsePicks, splitCounts, replacePrompt,
  type Pick, type CallModel,
} from './curator';

/* Les étapes d'un remplacement : le bandeau à l'écran les raconte une par
   une, pour qu'on sache toujours où en est la recherche. */
export type ReplaceStep = 'taste' | 'thinking' | 'comparing' | 'finding' | 'artwork';

interface GeminiTrackSuggestion {
  title: string;
  artist: string;
  category: TrackCategory;
  rationale: string;
}

/* ═══════════════════════════════════════════════════════════════
   Choisir un moteur — mais un moteur qui sait écrire.

   La version 6.9 demandait à `models.list` la liste des modèles de la
   clé, puis prenait le premier qui contenait « flash ». Grave erreur :
   dans cette liste figurent aussi `gemini-2.5-flash-image` (un générateur
   d'images) et `gemini-2.5-flash-preview-tts` (un synthétiseur vocal).
   Tous deux acceptent `generateContent`… mais répondent en pixels ou en
   audio, jamais en JSON. Le modèle choisi ne renvoyait donc aucune liste
   de morceaux, et c'est le catalogue de secours — écrit à la main — qui
   sortait à l'écran : toujours les mêmes titres, sans lien avec la
   demande. D'où l'impression, exacte, d'une recherche au hasard.

   Désormais la sélection est stricte : on ne garde que les modèles de
   **texte** (`gemini-x.y-flash`, `gemini-x.y-pro`), on écarte tout ce qui
   est image, audio, vidéo, embedding ou spécialisé, et on vérifie que la
   réponse contient bien du JSON avant de l'accepter. Si un modèle ne sait
   pas écrire, il est écarté — on ne « devine » plus.
   ═══════════════════════════════════════════════════════════════ */

/* ── les modèles : on les demande à Google, on ne les devine pas ──

   `GET /v1beta/models?key=…` renvoie, pour cette clé et à cet instant,
   tout ce qu'elle a le droit d'appeler : le nom, les méthodes supportées
   (`generateContent`, `embedContent`, `predict`…), les limites de tokens,
   la description et la liste des paramètres acceptés.

   C'est cette réponse — et elle seule — qui décide de ce qu'on utilise.
   Aucune version n'est écrite en dur : le jour où Google publie un
   nouveau modèle, il apparaît tout seul dans la file. */

type ApiModel = {
  name: string;                        // "models/gemini-3.8-flash"
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  thinking?: boolean;
};

/** Ce qu'on veut faire : écrire du texte structuré en JSON. */
type ModelTask = 'text';

/**
 * Un modèle sait-il écrire du texte ?
 *
 * On ne se fie pas au nom — les noms changent, les variantes abondent
 * (`-preview`, `-001`, `-latest`, `-exp`). On regarde ce que l'API dit de
 * lui : il doit supporter `generateContent`, ne pas être un modèle dédié
 * à l'image, l'audio, l'embedding ou la traduction, et pouvoir sortir
 * assez de tokens pour un blend entier.
 */
function canWriteText(m: ApiModel): boolean {
  const methods = m.supportedGenerationMethods || [];
  if (!methods.includes('generateContent')) return false;
  const n = m.name.replace(/^models\//, '').toLowerCase();
  /* les familles qui génèrent du contenu mais pas du texte exploitable */
  if (/embed|aqa|imagen|image|veo|video|tts|audio|speech|live|native|computer|robotics|deep-research/.test(n)) return false;
  /* un modèle qui ne peut pas écrire un blend entier est écarté — mais
     seulement si l'API annonce la limite : on ne rejette pas un modèle
     parce qu'un champ manque */
  if (typeof m.outputTokenLimit === 'number' && m.outputTokenLimit > 0 && m.outputTokenLimit < 1500) return false;
  return true;
}

/** La puissance annoncée d'un modèle : ce qu'il peut écrire, en tokens. */
const powerOf = (m: ApiModel): number => {
  const out = m.outputTokenLimit || 0;
  const inp = m.inputTokenLimit || 0;
  return out * 10 + inp / 100;
};
function rankOf(m: ApiModel): number {
  const n = m.name.replace(/^models\//, '').toLowerCase();
  /* la génération arrive en tête : les versions numériques récentes
     d'abord, les variantes génériques (`latest`) ensuite, le reste après */
  const gen = (n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1];
  const version = parseFloat(gen || '0');
  const family = /-pro/.test(n) ? 0 : /-flash/.test(n) ? 1 : /-nerf|ultra/.test(n) ? 0.5 : 2;
  /* on préfère le plus puissant : ce qui peut écrire le plus passe devant */
  return -version * 100 - family * 10 - Math.min(99, powerOf(m) / 4000);
}

type Engine = { model: string; at: number; queue: string[] };
const engineCache = new Map<string, Engine>();
/** un modèle qui a refusé la requête (400/404) : on ne le rappelle pas */
const brokenModels = new Map<string, number>();
const ENGINE_TTL = 30 * 60 * 1000;

/**
 * Les modèles de texte que cette clé peut appeler, du plus puissant au
 * plus léger.
 *
 * « Puissant » veut dire concret : la version la plus récente, la famille
 * `pro` avant `flash`, et à version égale celle qui peut écrire le plus
 * de tokens. Ce n'est pas un classement de goût, c'est ce que l'API dit.
 */
async function listTextModels(apiKey: string): Promise<string[]> {
  const all: ApiModel[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}&key=${apiKey}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`models.list ${res.status}`);
    const data = await res.json();
    all.push(...(data.models || []));
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return all
    .filter(canWriteText)
    .filter((m) => !brokenModels.has(m.name.replace(/^models\//, '')))
    .sort((a, b) => rankOf(a) - rankOf(b))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n, i, arr) => arr.indexOf(n) === i);
}

/**
 * La file d'attente des modèles pour cette clé.
 *
 * Le premier est le plus puissant disponible ; les suivants servent de
 * secours si son quota est épuisé. Si le listing échoue (clé invalide,
 * réseau), on rend une file vide : l'appelant le sait et le dit, plutôt
 * que de faire semblant avec un nom de modèle inventé.
 */
async function engineQueue(apiKey: string): Promise<string[]> {
  const listed = await listTextModels(apiKey);
  const cached = engineCache.get(apiKey);
  if (!listed.length) {
    return cached && Date.now() - cached.at < ENGINE_TTL
      ? [cached.model, ...cached.queue.filter((m) => m !== cached.model)]
      : [];
  }
  /* celui qui vient de répondre garde la main s'il est toujours là */
  const preferred = cached && listed.includes(cached.model) ? cached.model : listed[0];
  const queue = [preferred, ...listed.filter((m) => m !== preferred)];
  engineCache.set(apiKey, { model: preferred, at: Date.now(), queue });
  return queue;
}

/** Note le modèle qui vient de répondre : il passera devant les autres. */
function rememberEngine(apiKey: string, model: string): void {
  const cached = engineCache.get(apiKey);
  engineCache.set(apiKey, {
    model,
    at: Date.now(),
    queue: cached ? [model, ...cached.queue.filter((m) => m !== model)] : [model],
  });
}

/** Un appel `generateContent` avec un budget de temps ferme. */
async function callModel(
  model: string,
  apiKey: string,
  prompt: string,
  temperature: number,
  opts: {
    json?: boolean; budgetMs?: number; signal?: AbortSignal;
    /** sans limite de sortie imposée : le modèle prend son défaut */
    light?: boolean;
    /** sans aucun réglage de génération : juste le prompt */
    plain?: boolean;
  } = {},
): Promise<string | null> {
  const budget = opts.budgetMs ?? 22000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budget);
  const abort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          /* un modèle récent peut refuser un réglage qu'un ancien
             acceptait : `plain` retire tout, `light` retire la limite */
          ...(opts.plain ? {} : {
            generationConfig: {
              temperature,
              topP: 0.95,
              ...(opts.light ? {} : { maxOutputTokens: 4096 }),
              /* le JSON est contraint côté serveur : le modèle ne peut pas
                 répondre autre chose qu'un objet exploitable */
              ...(opts.json ? { responseMimeType: 'application/json' } : {}),
            },
          }),
        }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error(`${model} ${res.status}`), { status: res.status, detail, model });
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    return text || null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
}

/**
 * Un appel qui pardonne.
 *
 * Un nouveau modèle peut refuser une requête que l'ancien acceptait :
 * `maxOutputTokens` au-delà de sa limite, `responseMimeType` qu'il ne
 * connaît pas encore, un champ de génération qu'il n'a pas. Plutôt que de
 * passer au modèle suivant — donc de perdre le plus puissant pour une
 * broutille — on relit l'erreur et on retire ce qui a été refusé.
 *
 * Si le modèle refuse même la version nue, il est noté comme cassé et
 * retiré de la file : plus jamais deux requêtes perdues avec lui.
 */
async function callModelResilient(
  model: string,
  apiKey: string,
  prompt: string,
  temperature: number,
  opts: { json?: boolean; budgetMs?: number; signal?: AbortSignal } = {},
): Promise<string | null> {
  try {
    return await callModel(model, apiKey, prompt, temperature, opts);
  } catch (e: any) {
    const status = e?.status;
    const detail = String(e?.detail || '');
    /* quota, clé invalide, réseau : inutile d'insister sur la forme */
    if (status === 429 || status === 403 || status === 401) throw e;

    /* 400 : on cherche ce qui déplaît et on le retire */
    if (status === 400) {
      const blamesJson = /responseMimeType|response_mime_type|responseSchema|MIME/i.test(detail);
      const blamesTokens = /maxOutputTokens|max_output_tokens|token/i.test(detail);
      const blamesTemp = /temperature|topP|top_p|topK/i.test(detail);
      if (blamesJson || blamesTokens || blamesTemp) {
        try {
          return await callModel(model, apiKey, prompt, temperature, {
            ...opts,
            json: blamesJson ? false : opts.json,
            light: blamesTokens,
            plain: blamesTemp,
          });
        } catch (e2: any) {
          if (e2?.status !== 400) throw e2;
        }
      }
      /* refus net : ce modèle n'accepte pas nos requêtes, on l'oublie */
      brokenModels.set(model, Date.now());
      engineCache.delete(apiKey);
    }
    throw e;
  }
}

/** Le premier bloc JSON d'une réponse, tableau ou objet. */
function firstJson(raw: string): any | null {
  if (!raw) return null;
  /* le cas normal d'abord : la réponse entière est le JSON. Sans ça, une
     réponse en objet contenant un tableau était découpée au tableau, et
     tout ce qui l'entourait — l'analyse, par exemple — était perdu. */
  try { return JSON.parse(raw.trim()); } catch { /* on tente les extraits */ }
  const arr = raw.match(/\[[\s\S]*\]/);
  const obj = raw.match(/\{[\s\S]*\}/);
  for (const candidate of [obj?.[0], arr?.[0]]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* on essaie l'autre */ }
  }
  return null;
}

/* Combien de titres proposés ressemblent vraiment à ce qu'on attendait :
   sert à rejeter une réponse hors sujet (liste vide, doublons, charabia). */

/* ─────────── l'unicité ───────────
   Un blend ne contient jamais deux fois le même morceau. On compare sur
   trois clés, de la plus sûre à la plus tolérante :
   · l'identifiant vidéo YouTube — deux fois le même fichier ;
   · le titre + artiste normalisés — la même chanson sous un autre envoi ;
   · le titre normalisé seul, quand l'artiste est écrit différemment.
   Accents, casse, « (Live) », « - Remastered » et ponctuation sont
   ignorés : « Get Lucky — Radio Edit » et « Get Lucky », c'est le même. */
/* les outils d'unicité vivent dans `lib/dedupe` : le stockage en a
   besoin aussi, et il ne peut pas importer ce service (cycle). */
export { norm, trackKeys, dedupeTracks, uniqueByVideo, uniqueTracks } from '../lib/dedupe';

function usableCount(items: any): number {
  if (!Array.isArray(items)) return 0;
  return items.filter((i) => i && typeof i.title === 'string' && i.title.length > 1
    && typeof i.artist === 'string' && i.artist.length > 1).length;
}

export class GeminiService {
  /**
   * Generate an intelligent blended playlist using Google Gemini with automatic model fallback
   */
  public async generateBlend(
    seedTracks: Track[],
    config: BlendConfig,
    tasteMemory: TasteMemory,
    onProgress?: (message: string) => void
  ): Promise<Track[]> {
    const settings = getStoredSettings();
    const apiKey = settings.geminiApiKey;

    /* la durée demandée, en morceaux de ~3,5 min */
    const targetCount = Math.max(4, Math.round(config.durationMinutes / 3.5));
    const counts = splitCounts(targetCount, config.ratio, seedTracks.length);

    /* tout ce qui ne doit jamais ressortir : les amorces, les morceaux
       déjà écoutés ou proposés, ceux que la personne a rejetés */
    const forbidden = new Set<string>();
    const forbid = (title?: string, artist?: string) => {
      if (title && artist) forbidden.add(`${artist} — ${title}`);
      if (title) forbidden.add(title);
    };
    seedTracks.forEach((t) => forbid(t.title, t.artist));
    tasteMemory.dislikedTracks.forEach((t) => forbid(t.title, t.artist));
    getSeenTracks().slice(-60).forEach((ligne) => forbidden.add(ligne));
    const bannedArtists = new Set(
      tasteMemory.dislikedArtists.map((a) => a.toLowerCase().trim()).filter(Boolean),
    );
    const seedArtistSet = new Set(seedTracks.map((t) => t.artist.toLowerCase().trim()));

    if (!apiKey) {
      /* Sans clé, on le dit franchement. Le catalogue de secours a été
         vidé de ses « morceaux d'office » : il ne contient plus que les
         amorces et des suggestions neutres, et il est annoncé comme tel. */
      onProgress?.('Aucune clé Gemini : impossible d’analyser les morceaux. Ajoute une clé dans Réglages → Clés & API.');
      await new Promise((r) => setTimeout(r, 900));
      return this.anchorsOnly(seedTracks, counts.anchor);
    }

    const models = (await engineQueue(apiKey)).slice(0, 3);
    if (!models.length) {
      onProgress?.('Aucun modèle de texte disponible pour cette clé — analyse impossible.');
      await new Promise((r) => setTimeout(r, 700));
      return this.anchorsOnly(seedTracks, counts.anchor);
    }

    const call: CallModel = async (prompt, temperature, budgetMs) => {
      let last: any = null;
      for (const m of models) {
        try {
          const raw = await callModelResilient(m, apiKey, prompt, temperature, { json: true, budgetMs });
          if (raw) { rememberEngine(apiKey, m); return raw; }
        } catch (e: any) {
          last = e;
          if (e?.status === 429 || e?.status === 403 || e?.status === 401) throw e;
        }
      }
      if (last) throw last;
      return null;
    };

    /* ═══ 1. écouter ═══ */
    onProgress?.('Écoute des morceaux sélectionnés : genre, textures, énergie…');
    const known = portraitFor(tasteMemory);
    let analysis = parseAnalysis(await call(analysisPrompt(seedTracks, tasteMemory, known), 0.4, 26000).catch(() => null));

    if (analysis) {
      /* on montre ce que le moteur a compris : c'est la preuve visible que
         la sélection part d'une écoute, pas d'un tirage */
      onProgress?.(`Ton fil : ${analysis.fil}`);
    } else {
      /* le modèle n'a rien rendu d'exploitable : on le dit, et on se
         rabat sur une description neutre pour ne pas bloquer la suite */
      onProgress?.('Analyse indisponible — on continue avec le profil enregistré.');
      analysis = known
        ? { fil: known.style, genres: known.genres, textures: known.textures, epoques: [], energie: known.energy, gout: '', eviter: known.avoid }
        : { fil: `Autour de ${seedTracks.map((t) => t.artist).slice(0, 3).join(', ')}`, genres: [], textures: [], epoques: [], energie: '', gout: '', eviter: [] };
      rememberPortrait(toPortrait(analysis, tasteMemory));
    }
    /* les artistes que l'analyse elle-même conseille d'éviter */
    analysis.eviter.forEach((a) => bannedArtists.add(a.toLowerCase().trim()));

    /* ═══ 2. et 3. choisir — trois sélections distinctes ═══ */
    const picked: { cat: TrackCategory; picks: Pick[] }[] = [];
    const forbiddenList = () => Array.from(forbidden).slice(-80);

    const ask = async (role: TrackCategory, count: number) => {
      if (count <= 0) return [] as Pick[];
      const label = role === 'anchor' ? 'piliers' : role === 'deep_dive' ? 'faces cachées' : 'découvertes';
      onProgress?.(`Sélection des ${count} ${label}…`);
      /* On demande de la marge : le modèle propose plus que nécessaire,
         parce que la vérification YouTube en écartera une partie. Sans
         cette marge, deux titres introuvables laissaient deux trous. */
      const marge = Math.min(12, count + Math.max(2, Math.round(count * 0.6)));
      const raw = await call(listPrompt(role, marge, seedTracks, analysis!, tasteMemory, forbiddenList()), role === 'fresh' ? 0.85 : 0.7, 26000)
        .catch(() => null);
      const { analyse, titres } = parsePicks(raw);
      if (analyse) onProgress?.(analyse);
      /* on écarte ce qui est interdit, doublon ou déjà proposé AVANT de
         le présenter : le modèle ne décide pas de ce qui s'affiche */
      const clean: Pick[] = [];
      for (const p of titres) {
        const keyA = `${p.artist} — ${p.title}`.toLowerCase().trim();
        const keyB = p.title.toLowerCase().trim();
        if (forbidden.has(keyA) || forbidden.has(keyB)) continue;
        if (bannedArtists.has(p.artist.toLowerCase().trim())) continue;
        /* anchor : uniquement des amorces ; fresh : jamais un artiste des amorces */
        if (role === 'anchor' && !seedTracks.some((s) => s.title.toLowerCase().trim() === keyB)) continue;
        if (role === 'fresh' && seedArtistSet.has(p.artist.toLowerCase().trim())) continue;
        if (role === 'deep_dive' && !seedArtistSet.has(p.artist.toLowerCase().trim())) continue;
        if (clean.some((c) => `${c.artist} — ${c.title}`.toLowerCase() === keyA)) continue;
        clean.push(p);
        forbidden.add(keyA);
        forbidden.add(keyB);
        rememberSeenTrack(p.title, p.artist);
        if (clean.length >= count) break;
      }
      console.debug(`[curateur] ${role} : ${titres.length} proposés, ${clean.length} retenus (demandé ${count})`,
        titres.map((t) => `${t.title}/${t.artist}`));
      /* pas assez ? une seconde passe, une seule fois, avec les titres
         déjà retenus ajoutés aux interdits — le modèle ne peut donc pas
         répéter ce qu'il vient de proposer. C'est ce qui évite un blend
         à moitié vide alors que la clé et le modèle fonctionnent. */
      if (clean.length < count) {
        const reste = count - clean.length;
        const raw2 = await call(listPrompt(role, reste + 2, seedTracks, analysis!, tasteMemory, forbiddenList()), 0.9, 24000)
          .catch(() => null);
        const suite = parsePicks(raw2).titres;
        for (const p of suite) {
          const keyA = `${p.artist} — ${p.title}`.toLowerCase().trim();
          const keyB = p.title.toLowerCase().trim();
          if (forbidden.has(keyA) || forbidden.has(keyB)) continue;
          if (bannedArtists.has(p.artist.toLowerCase().trim())) continue;
          if (role === 'anchor' && !seedTracks.some((s2) => s2.title.toLowerCase().trim() === keyB)) continue;
          if (role === 'fresh' && seedArtistSet.has(p.artist.toLowerCase().trim())) continue;
          if (role === 'deep_dive' && !seedArtistSet.has(p.artist.toLowerCase().trim())) continue;
          if (clean.some((c) => `${c.artist} — ${c.title}`.toLowerCase() === keyA)) continue;
          clean.push(p);
          forbidden.add(keyA); forbidden.add(keyB);
          rememberSeenTrack(p.title, p.artist);
          if (clean.length >= count) break;
        }
        if (suite.length) console.debug(`[curateur] ${role} : 2e passe, ${suite.length} de plus, total ${clean.length}/${count}`);
      }
      if (!clean.length) {
        onProgress?.(
          role === 'deep_dive'
            ? 'Le modèle n’a proposé aucune face cachée crédible — on ne remplit pas avec du connu.'
            : role === 'fresh'
              ? 'Le modèle n’a proposé aucune découverte crédible — on ne remplit pas avec du hasard.'
              : 'Aucun pilier exploitable dans cette réponse.',
        );
      }
      picked.push({ cat: role, picks: clean });
      return clean;
    };

    /* les piliers d'abord : ce sont des morceaux réels, déjà choisis par
       la personne — ils ne dépendent pas du modèle */
    const anchorPicks: Pick[] = seedTracks.slice(0, counts.anchor).map((t) => ({
      title: t.title,
      artist: t.artist,
      rationale: 'Pilier : morceau de ta sélection.',
    }));
    anchorPicks.forEach((p) => { forbidden.add(`${p.artist} — ${p.title}`); forbidden.add(p.title.toLowerCase()); });

    /* deep dives et découvertes : en parallèle, ce sont deux requêtes
       indépendantes — les faire en série doublerait l'attente */
    const [dives, fresh] = await Promise.all([
      ask('deep_dive', counts.deepDive),
      ask('fresh', counts.fresh),
    ]);

    /* ═══ 4. vérifier sur YouTube, puis rassembler ═══ */
    onProgress?.('Vérification des titres sur YouTube…');
    /* Les pertes sont comptées : si des places restent vides, c'est
       presque toujours l'un de ces trois murs — et le dire à l'écran
       évite le « pourquoi seulement les piliers ? ». */
    const pertes = { introuvable: 0, titreDouteux: 0, doublon: 0 };
    const toTrack = async (p: Pick, cat: TrackCategory): Promise<Track | null> => {
      const seed = seedTracks.find(
        (s) => s.title.toLowerCase().trim() === p.title.toLowerCase().trim()
          && s.artist.toLowerCase().trim() === p.artist.toLowerCase().trim(),
      );
      if (seed) return { ...seed, category: cat, rationale: p.rationale || seed.rationale };
      const found = await youtubeService.findPlayable(p.title, p.artist).catch(() => null);
      if (!found?.videoId) {
        pertes.introuvable += 1;
        console.debug(`[curateur] ${p.title} / ${p.artist} : introuvable sur YouTube`);
        return null;
      }
      /* Le titre rendu doit correspondre à celui demandé — sinon la
         recherche renvoie le tube de l'artiste (« Genesis » demandé,
         « D.A.N.C.E. » rendu), qui sera ensuite éliminé comme doublon :
         une place perdue, sans explication.

         Mais la comparaison doit être TOLÉRANTE : « So » demandé face à
         « So Why? » rendu, « Territory » face à « TERRITORY (Official
         Video) » ou « Waters of Nazareth » face à sa version « WWW » ne
         sont pas des erreurs. On refuse donc seulement un résultat qui
         n'a manifestement rien à voir : ni le titre, ni l'artiste. */
      if (!matchesAsked(p.title, p.artist, found.title || '', found.artist || '')) {
        pertes.titreDouteux += 1;
        console.debug(`[curateur] ${p.title} / ${p.artist} : YouTube a rendu « ${found.title} » — écarté`);
        return null;
      }
      if (seedTracks.some((s2) => s2.videoId && s2.videoId === found.videoId)) {
        pertes.doublon += 1;
        return null;
      }
      return {
        id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        videoId: found.videoId,
        title: found.title || p.title,
        artist: found.artist || p.artist,
        thumbnailUrl: `https://i.ytimg.com/vi/${found.videoId}/mqdefault.jpg`,
        durationSeconds: found.durationSeconds || 215,
        durationFormatted: found.durationFormatted || '3:35',
        videoUrl: `https://www.youtube.com/watch?v=${found.videoId}`,
        category: cat,
        rationale: p.rationale || 'Choisi par la sélection.',
      } as Track;
    };

    const resolved = await Promise.all([
      ...anchorPicks.map((p) => toTrack(p, 'anchor')),
      ...dives.map((p) => toTrack(p, 'deep_dive')),
      ...fresh.map((p) => toTrack(p, 'fresh')),
    ]);

    const rings = resolved.filter((t): t is Track => !!t);
    /* l'ordre du blend : les piliers d'abord, puis les faces cachées, puis
       les découvertes — un vrai enchaînement, pas un tirage */
    const blend = [
      ...rings.filter((t) => t.category === 'anchor'),
      ...rings.filter((t) => t.category === 'deep_dive'),
      ...rings.filter((t) => t.category === 'fresh'),
    ];
    const unique = uniqueByVideo(dedupeTracks(blend));

    /* les comptes sont ceux du résultat FINAL, pas des intentions */
    const n = (c: TrackCategory) => unique.filter((t) => t.category === c).length;
    const plur = (k: number, un: string, des: string) => `${k} ${k > 1 ? des : un}`;
    const manque = targetCount - unique.length;
    onProgress?.(
      `${plur(unique.length, 'morceau retenu', 'morceaux retenus')} : `
      + `${plur(n('anchor'), 'pilier', 'piliers')}, `
      + `${plur(n('deep_dive'), 'face cachée', 'faces cachées')}, `
      + `${plur(n('fresh'), 'découverte', 'découvertes')}.`
      + (manque > 0 ? ` ${plur(manque, 'place reste vide', 'places restent vides')} — ${raisonDesVides(pertes)}.` : ''),
    );
    return unique;
  }

  /** Sans modèle : on ne fabrique rien, on rend au moins les amorces. */
  private anchorsOnly(seedTracks: Track[], anchorCount: number): Track[] {
    return seedTracks.slice(0, Math.max(1, anchorCount)).map((t) => ({
      ...t,
      category: 'anchor' as TrackCategory,
      rationale: 'Pilier : morceau de ta sélection.',
    }));
  }

  /**
   * Remplace un titre par une proposition réellement trouvée.
   *
   * Trois sources, dans cet ordre, et la première qui donne un morceau
   * **vérifiable sur YouTube** gagne :
   *
   *   1. le modèle de texte : il propose cinq idées (pas une seule, pour
   *      avoir de quoi piocher si l'une est déjà dans le blend) ;
   *   2. une recherche YouTube ciblée — « artiste du morceau + audio »,
   *      puis les voisins du même genre. C'est ce qui se passait avant,
   *      et c'est ce qui donne des résultats variés et réels ;
   *   3. un catalogue local, mais **filtré** : on écarte ce qui est déjà
   *      présent, ce qui est déjà dans le blend et ce que l'auditeur a
   *      écarté. Plus jamais deux fois le même titre.
   *
   * Un remplacement ne rend jamais un identifiant vidéo vide : si le
   * morceau ne peut pas être écouté, ce n'est pas un remplacement.
   */
  /**
   * Ce que le moteur est en train de comprendre, dit en clair.
   *
   * Le remplacement était si rapide qu'il semblait ne rien faire. Ce
   * n'était pas un manque de réflexion, mais un manque de trace : le
   * modèle lit le contexte en une seule requête, et rien ne le montrait.
   * On garde donc ses mots — l'analyse du morceau et le nom du modèle qui
   * a répondu — pour que le bandeau de progression les affiche.
   */
  private lastEngineNote = '';
  public takeEngineNote(): string {
    const note = this.lastEngineNote;
    this.lastEngineNote = '';
    return note;
  }

  public async replaceSingleTrack(
    trackToReplace: Track,
    allTracks: Track[],
    seedTracks: Track[],
    tasteMemory: TasteMemory,
    opts?: { avoidArtists?: string[]; onStep?: (step: ReplaceStep) => void; nonce?: number },
  ): Promise<Track | null> {
    const step = (s: ReplaceStep) => opts?.onStep?.(s);
    this.lastEngineNote = '';
    const category = trackToReplace.category || 'fresh';
    step('taste');
    const settings = getStoredSettings();
    const apiKey = settings.geminiApiKey;

    /* tout ce qui est déjà dans le blend ou déjà écarté est interdit */
    const key = (t: { title: string; artist: string }) => `${t.artist} ${t.title}`.toLowerCase().trim();
    const banned = new Set<string>([
      ...allTracks.map((t) => key(t)),
      ...allTracks.map((t) => t.title.toLowerCase().trim()),
      ...tasteMemory.dislikedTracks.map((t) => key(t)),
      ...tasteMemory.dislikedTracks.map((t) => t.title.toLowerCase().trim()),
    ]);
    const bannedArtists = new Set<string>([
      ...tasteMemory.dislikedArtists.map((a) => a.toLowerCase().trim()),
      ...(opts?.avoidArtists || []).map((a) => a.toLowerCase().trim()),
    ]);
    /* ce qui a déjà été proposé, toutes recherches confondues */
    const seenSet = new Set(getSeenTracks());
    const takenTitle = (title: string) => banned.has(title.toLowerCase().trim());
    const alreadyShown = (title: string, artist: string) =>
      seenSet.has(`${title} — ${artist}`.toLowerCase().trim());
    const taken = (title: string, artist: string) =>
      banned.has(`${artist} ${title}`.toLowerCase().trim()) ||
      banned.has(title.toLowerCase().trim()) ||
      bannedArtists.has(artist.toLowerCase().trim());

    /* ── ce qu'on sait du blend, pour que la proposition soit réfléchie ──
       On ne demande pas « un morceau dans le genre » : on transmet au
       modèle la place exacte que ce morceau occupe (position, voisins,
       rôle), les amorces, les goûts, les interdits — tout ce que le
       curateur a compris du blend (curator.ts, replacePrompt). */
    const idx = Math.max(0, allTracks.findIndex((t) => t.id === trackToReplace.id));
    const before = allTracks[idx - 1];
    const after = allTracks[idx + 1];
    const seen = getSeenTracks();

    /* ── 1. le modèle de texte, s'il y en a un ── */
    if (apiKey) {
      const forbiddenReplace: string[] = [
        ...allTracks.map((t) => `${t.artist} — ${t.title}`),
        ...tasteMemory.dislikedTracks.map((t) => `${t.artist} — ${t.title}`),
        ...tasteMemory.dislikedArtists,
        ...seen.slice(-40),
      ];
      const prompt = replacePrompt({
        target: trackToReplace,
        role: category,
        index: idx,
        total: allTracks.length,
        before,
        after,
        seeds: seedTracks.length ? seedTracks : allTracks.slice(0, 4),
        all: allTracks,
        taste: tasteMemory,
        portrait: getStoredPortrait(),
        forbidden: forbiddenReplace,
      });

      /* le modèle le plus puissant disponible en premier ; le second
         n'entre en jeu que si le premier ne rend rien d'exploitable */
      let ranked: string[] = [];
      try { ranked = await engineQueue(apiKey); } catch { ranked = []; }
      const models = ranked.slice(0, 2);

      /* sans modèle, inutile de faire semblant : on le dit et on laisse
         la recherche YouTube prendre le relais, honnêtement */
      if (!models.length) {
        step('finding');
        this.lastEngineNote = 'Aucun modèle de texte disponible pour cette clé — recherche YouTube directe.';
      }

      for (const currentModel of models) {
        try {
          step('thinking');
          /* on laisse le temps au modèle de réfléchir : le JSON est
             contraint côté serveur, il n'a rien à rédiger autour */
          const raw = await callModelResilient(currentModel, apiKey, prompt, 0.55, {
            json: true, budgetMs: 26000,
          });
          const data = firstJson(raw || '');
          const list: GeminiTrackSuggestion[] = Array.isArray(data)
            ? data
            : (data?.suggestions || []);
          const ideas = list.filter((i) =>
            i && i.title && i.artist && !taken(i.title, i.artist) && !alreadyShown(i.title, i.artist));
          if (!ideas.length) continue;

          /* on dit ce que le modèle a compris avant de proposer : c'est
             la preuve, à l'écran, qu'il a lu le contexte et pas seulement
             le titre à remplacer */
          const analysis = typeof data?.analyse === 'string' ? data.analyse.trim() : '';
          console.debug(`[curateur] remplacement : ${ideas.length} idées pour « ${trackToReplace.title} »`, ideas.map((i) => `${i.title}/${i.artist}`));
          this.lastEngineNote = analysis
            ? `${analysis} · proposé par ${currentModel}`
            : `Proposition de ${currentModel}.`;
          /* on le montre tout de suite : c'est pendant la vérification
             YouTube que l'auditeur a le temps de le lire */
          if (this.lastEngineNote) step(this.lastEngineNote as any);

          rememberEngine(apiKey, currentModel);
          step('comparing');

          /* on ne s'arrête pas à la première idée : on la vérifie. Un
             titre que YouTube ne trouve pas ne sert à rien à l'auditeur. */
          for (const idea of ideas.slice(0, 5)) {
            step('finding');
            /* un titre peut être trouvé sous une autre casse ou avec un
               suffixe : on retient aussi la clé normalisée de l'idée */
            rememberSeenTrack(idea.title, idea.artist);
            let found = null;
            try {
              found = await youtubeService.findPlayable(idea.title, idea.artist);
            } catch {
              /* un titre introuvable n'est pas une erreur : on essaie
                 l'idée suivante, sans bruit dans la console */
              continue;
            }
            if (!found) continue;
            step('artwork');
            /* le morceau entre dans le journal : il ne ressortira plus
               pour un autre remplacement, fût-il relancé dix fois */
            rememberSeenTrack(found.title || idea.title, found.artist || idea.artist);
            return {
              id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              videoId: found.videoId,
              title: found.title || idea.title,
              artist: found.artist || idea.artist,
              thumbnailUrl: `https://i.ytimg.com/vi/${found.videoId}/mqdefault.jpg`,
              durationSeconds: found.durationSeconds || trackToReplace.durationSeconds || 215,
              durationFormatted: found.durationFormatted || trackToReplace.durationFormatted || '3:35',
              videoUrl: `https://www.youtube.com/watch?v=${found.videoId}`,
              category,
              rationale: idea.rationale || trackToReplace.rationale || `Trouvé autour de « ${trackToReplace.title} ».`,
            };
          }
        } catch (e: any) {
          /* 429 / 403 : la clé ou le quota est en cause, insister ne sert à rien */
          if (e?.status === 429 || e?.status === 403) break;
          console.warn(`Remplacement — ${currentModel} : ${e?.message || e}`);
        }
      }
    }

    /* ── 2. une vraie recherche YouTube, celle qui marchait avant ──
       On interroge plusieurs formulations jusqu'à trouver un morceau qui
       n'est pas déjà là. C'est ce chemin qui donne des résultats variés
       quand l'IA n'est pas disponible. */
    step('finding');
    const sameArtist = (seedTracks.length ? seedTracks : [trackToReplace])
      .map((t) => t.artist)
      .filter(Boolean);
    /* Pour une découverte, on ne cherche plus une liste d'artistes écrite
       en dur (c'était les mêmes noms à chaque fois) : on part du portrait
       sonore établi par le modèle — ses genres, ses textures — et des
       artistes aimés de la personne. La requête décrit le monde sonore,
       pas un nom propre. */
    const portrait = getStoredPortrait();
    const styleWords = [...(portrait?.genres || []), ...(portrait?.textures || [])]
      .filter((x) => x && x.length < 40)
      .slice(0, 4);
    const likedArtists = tasteMemory.likedArtists.filter((a) => !bannedArtists.has(a.toLowerCase()));

    const neighbours: Record<string, string[]> = {
      anchor: [...sameArtist, 'live session'],
      deep_dive: [...sameArtist, 'album track', 'b-side', 'instrumental'],
      fresh: [...styleWords, ...likedArtists, 'similar'],
    };

    const queries: string[] = [];
    if (category === 'fresh') {
      const pool = (neighbours.fresh || []).filter((a) => !bannedArtists.has(a.toLowerCase()));
      const start = Math.floor(Math.random() * Math.max(1, pool.length));
      for (let i = 0; i < Math.min(6, pool.length); i++) queries.push(`${pool[(start + i) % pool.length]} mix`);
    } else {
      const artists = neighbours[category] || sameArtist;
      for (const a of artists.slice(0, 4)) queries.push(`${a} ${category === 'deep_dive' ? 'album track' : 'audio'}`);
    }
    /* et une formulation directe, au cas où */
    queries.push(`${trackToReplace.artist} similar ${category === 'deep_dive' ? 'deep cut' : 'song'}`);

    for (const query of queries.slice(0, 6)) {
      try {
        const res = await withTimeout(
          youtubeService.searchTracks(query, 12),
          9000,
          { tracks: [], error: null },
        );
        /* on parcourt la page entière : le premier résultat est souvent
           celui qu'on a déjà, le troisième ou le quatrième est la pépite */
        const hit = (res.tracks || []).find(
          (t) => t.videoId
            && !takenTitle(t.title)
            && !bannedArtists.has((t.artist || '').toLowerCase())
            && !alreadyShown(t.title, t.artist || ''),
        );
        if (hit) {
          step('artwork');
          rememberSeenTrack(hit.title, hit.artist || '');
          return {
            ...hit,
            id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            category,
            rationale: `Trouvé autour de « ${trackToReplace.title} », dans la même veine.`,
          };
        }
      } catch { /* on passe à la requête suivante */ }
    }

    /* ── 3. dernier recours : une recherche YouTube guidée par le style ──
       On ne pioche plus dans un catalogue écrit à la main (c'était lui,
       les « morceaux d'office » qu'on retrouvait à chaque fois). On
       interroge YouTube avec des requêtes construites à partir du rôle,
       du fil sonore du blend et des artistes déjà là — puis on prend le
       premier résultat réellement écoutable qui n'est pas déjà pris.
       Si rien ne sort, on rend `null` : mieux vaut dire « rien trouvé »
       que d'afficher un titre qui n'a aucun rapport. */
    step('comparing');
    const guides = [
      ...(category === 'deep_dive' ? sameArtist : []),
      ...styleWords,
      ...likedArtists,
    ].filter(Boolean);
    for (const g of guides.slice(0, 4)) {
      const query = `${g} ${category === 'deep_dive' ? 'album track' : 'similar artists'} mix`;
      try {
        const res = await withTimeout(youtubeService.searchTracks(query, 12), 9000, { tracks: [], error: null });
        const hit = (res.tracks || []).find(
          (t) => t.videoId
            && !takenTitle(t.title)
            && !bannedArtists.has((t.artist || '').toLowerCase())
            && !alreadyShown(t.title, t.artist || ''),
        );
        if (hit) {
          step('artwork');
          rememberSeenTrack(hit.title, hit.artist || '');
          return {
            ...hit,
            id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            category,
            rationale: `Trouvé dans la lignée de « ${trackToReplace.title} ».`,
          };
        }
      } catch { /* requête suivante */ }
    }

    return null;
  }
}



/**
 * Pourquoi des places sont restées vides ?
 *
 * Presque toujours l'un de ces trois murs : YouTube ne trouve pas le
 * titre, il rend un autre morceau, ou c'est déjà un doublon. Le dire
 * franchement vaut mieux qu'un « faute de titres crédibles » qui laisse
 * penser que le moteur n'a rien tenté.
 */
function raisonDesVides(p: { introuvable: number; titreDouteux: number; doublon: number }): string {
  const murs: string[] = [];
  if (p.introuvable) murs.push(`${p.introuvable} introuvable${p.introuvable > 1 ? 's' : ''} sur YouTube`);
  if (p.titreDouteux) murs.push(`${p.titreDouteux} résultat${p.titreDouteux > 1 ? 's' : ''} qui ne correspondai${p.titreDouteux > 1 ? 'ent' : 't'} pas au titre`);
  if (p.doublon) murs.push(`${p.doublon} déjà présent${p.doublon > 1 ? 's' : ''}`);
  if (!murs.length) return 'aucun titre proposé n’a passé les vérifications';
  return murs.join(', ');
}

/**
 * Le diagnostic des modèles, pour l'écran Réglages : ce que la clé peut
 * faire, ici et maintenant. On rend la liste triée telle qu'elle est
 * utilisée, et l'erreur éventuelle — jamais une liste inventée.
 */
export async function inspectModels(apiKey: string): Promise<{
  models: string[];
  error?: string;
}> {
  try {
    const models = await listTextModels(apiKey);
    return models.length
      ? { models }
      : { models: [], error: 'Aucun modèle de texte disponible pour cette clé.' };
  } catch (e: any) {
    return { models: [], error: e?.message || 'models.list a échoué.' };
  }
}

export const geminiService = new GeminiService();
