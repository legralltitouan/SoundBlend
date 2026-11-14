import { BlendConfig, TasteMemory, Track, TrackCategory } from '../types';
import { getStoredSettings, getSeenTracks, rememberSeenTrack, getStoredPortrait } from './storage';
import { youtubeService, withTimeout } from './youtube';
import { dedupeTracks, uniqueByVideo } from '../lib/dedupe';
import { matchesAsked, norm, cleanTitle } from '../lib/track';
import { verifyVideo, looksLikeVideoId, artistTracks, relatedArtists } from './search';
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
  /* Les variantes « agent / outil » : Antigravity, les modèles qui parlent
     par function-calls, les moteurs de navigation. Elles acceptent
     `generateContent` mais ne rendent pas la liste JSON qu'on attend —
     demander un blend à l'une d'elles, c'est une requête perdue. */
  if (/antigravity|computer-use|browser|code-assist|agentic|thinking-exp/.test(n)) return false;
  /* un modèle qui ne peut pas écrire un blend entier est écarté — mais
     seulement si l'API annonce la limite : on ne rejette pas un modèle
     parce qu'un champ manque */
  if (typeof m.outputTokenLimit === 'number' && m.outputTokenLimit > 0 && m.outputTokenLimit < 1500) return false;
  return true;
}

/**
 * La famille qu'on sait vraiment employer : `gemini-*`.
 *
 * La demande de l'auditeur est nette — « celle qui faisait hydrogen, puis
 * 3.8 flash, et tout » : les modèles Gemini **de sortie de texte**, dans
 * leur ordre de puissance, pas les `gemma`, pas les moteurs d'agent.
 * Les `gemma` restent dans la liste (ils peuvent écrire), mais **après**
 * tous les Gemini : ils sont la dernière réserve, jamais le premier choix.
 */
const famille = (m: ApiModel | string): number => {
  const n = (typeof m === 'string' ? m : m.name).replace(/^models\//, '').toLowerCase();
  if (/^gemini-/.test(n)) return 0;         // la famille demandée, d'abord
  if (/^gemma-/.test(n)) return 1;          // réserve honnête, ensuite
  return 2;                                 // le reste : seulement s'il le faut
};

/** La puissance annoncée d'un modèle : ce qu'il peut écrire, en tokens. */
const powerOf = (m: ApiModel): number => {
  const out = m.outputTokenLimit || 0;
  const inp = m.inputTokenLimit || 0;
  return out * 10 + inp / 100;
};
function rankOf(m: ApiModel): number {
  const n = m.name.replace(/^models\//, '').toLowerCase();
  /* La version est le premier nombre du nom, quel que soit le préfixe.
     Avant, seule la forme `gemini-<n>` était reconnue : un modèle comme
     `gemma-4-27b` tombait à la version 0 et se retrouvait **dernier** de
     la file, derrière des modèles plus anciens — sans aucune raison. */
  const gen = (n.match(/(\d+(?:\.\d+)?)/) || [])[1];
  const version = parseFloat(gen || '0');
  /* pro = 0, flash = 1 : plus le chiffre est petit, plus le modèle est
     capable — et `rankOf` trie du plus petit au plus grand. Le signe
     comptait à l'envers : `flash` passait devant `pro`, alors que tout
     le reste du moteur promet le contraire. */
  const role = /-pro/.test(n) ? 0 : /-flash/.test(n) ? 1 : /-nerf|ultra/.test(n) ? 0.5 : 2;
  /* 1. la famille d'abord (Gemini avant Gemma avant le reste) ;
     2. puis la version, la plus récente en tête ;
     3. puis le rôle (pro avant flash, à version égale) ;
     4. puis ce que le modèle peut écrire.
     Le tout trié du plus petit au plus grand : chaque terme est pondéré
     pour que le précédent décide seul. */
  return famille(m) * 1e7 - version * 1e4 + role * 100 + (m.outputTokenLimit ? -Math.min(99, m.outputTokenLimit / 10000) : 0);
}

type Engine = { model: string; at: number; queue: string[] };
const engineCache = new Map<string, Engine>();
/** un modèle qui a refusé la requête (400/404) : on ne le rappelle pas */
const brokenModels = new Map<string, number>();
const ENGINE_TTL = 30 * 60 * 1000;

/* ─────────── les modèles à court de quota ───────────
   Le mur qu'on a vraiment rencontré : `gemini-2.5-pro` renvoie 429 sur
   l'offre gratuite, tout de suite, alors que `gemini-2.5-flash` répond
   parfaitement. Or le moteur demandait le plus puissant d'abord, à chaque
   fois — donc chaque blend perdait son analyse, ses faces cachées et ses
   découvertes sur le même refus, en le payant d'une requête à chaque
   appel. Un quota épuisé ne se répare pas en insistant : on met le
   modèle de côté un moment, et on le sait sans le redemander.
   C'est en mémoire seulement : un rechargement de page redonne sa chance
   au modèle (le quota a pu se rouvrir entre-temps). */
const quotaOut = new Map<string, number>();
/* Un quota **journalier** ne se rouvre pas en dix minutes : on écarte le
   modèle pour la journée (minuit, heure locale de l'auditeur). Un blocage
   de débit, lui, retombe en une minute — la distinction se fait sur le
   message de Google, voir `noteQuota`. */
const QUOTA_DAY = () => {
  const minuit = new Date();
  minuit.setHours(24, 0, 1, 0);
  return minuit.getTime();
};
const outOfQuota = (model: string) => {
  const until = quotaOut.get(model) || 0;
  if (until && Date.now() > until) { quotaOut.delete(model); return false; }
  return !!until;
};
const noteQuota = (model: string, journalier: boolean) =>
  quotaOut.set(model, journalier ? Math.min(QUOTA_DAY(), Date.now() + 24 * 3600 * 1000) : Date.now() + 60 * 1000);

/**
 * Les modèles de texte que cette clé peut appeler, du plus puissant au
 * plus léger.
 *
 * « Puissant » veut dire concret : la version la plus récente, la famille
 * `pro` avant `flash`, et à version égale celle qui peut écrire le plus
 * de tokens. Ce n'est pas un classement de goût, c'est ce que l'API dit.
 */
/* Pourquoi un modèle annoncé par la clé n'est pas dans la file : la
   même raison est montrée dans Réglages, pour qu'on ne se demande pas
   « pourquoi celui-là n'est jamais essayé ? ». */
const ecartesTable = new Map<string, Map<string, string>>();
const ecartesPour = (apiKey: string) => {
  let m = ecartesTable.get(apiKey);
  if (!m) { m = new Map(); ecartesTable.set(apiKey, m); }
  return m;
};
const ecarter = (apiKey: string, nom: string, raison: string) => {
  ecartesPour(apiKey).set(nom.replace(/^models\//, ''), raison);
};

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
  /* on note, pour l'écran, ce que la liste annonce mais qu'on n'utilise pas */
  ecartesPour(apiKey).clear();
  for (const m of all) {
    const n = m.name.replace(/^models\//, '');
    if (!canWriteText(m)) {
      ecarter(apiKey, n, /image|imagen|veo|tts|audio|embed|aqa/.test(n) ? 'génère autre chose que du texte'
        : /antigravity|computer|agentic/.test(n) ? 'moteur d’agent, pas un modèle d’écriture'
          : (m.supportedGenerationMethods || []).includes('generateContent') ? 'ne peut pas écrire un blend entier' : 'n’écrit pas de texte');
    } else if (famille(m) > 1) {
      ecarter(apiKey, n, 'famille inconnue — gardée en dernier recours');
    }
  }
  return all
    .filter(canWriteText)
    /* la famille Gemini de sortie de texte passe devant ; les autres
       (gemma, etc.) restent en réserve, jamais en tête */
    .filter((m) => famille(m) <= 1)
    .filter((m) => !brokenModels.has(m.name.replace(/^models\//, '')))
    .filter((m) => !outOfQuota(m.name.replace(/^models\//, '')))
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
    const parts = data.candidates?.[0]?.content?.parts || [];
    /* ── un modèle qui répond, mais pas en texte ──
       Certains modèles « texte » de la liste rendent en réalité autre
       chose (pixels, audio, un objet sans `text`). Ce n'est pas une
       panne de quota : c'est ce modèle-là qui ne sait pas écrire. On le
       signale, et l'appelant passe au suivant dans la même file. */
    const text = parts
      .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!text) {
      const fin = data.candidates?.[0]?.finishReason || '';
      throw Object.assign(new Error(`${model} : réponse sans texte${fin ? ` (${fin})` : ''}`), {
        status: 200, model, illisible: true,
      });
    }
    return text;
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


/**
 * Traduire un échec de l'API en une phrase utilisable.
 *
 * Avant, une clé refusée ou un modèle indisponible se soldait par un
 * blend réduit aux piliers, sans un mot d'explication. C'est ce qui
 * donnait l'impression que « ça ne marche pas » sans savoir pourquoi.
 */
/** le refus est-il une incarnation, pas un mur de quota ? */
const illisible = (e: any) => !!e?.illisible;

function explain(e: any): string {
  const st = e?.status;
  if (st === 403) return 'clé Gemini refusée (403) — vérifie la clé et que l’API Generative Language est autorisée';
  if (st === 401) return 'clé Gemini invalide (401)';
  if (st === 429) {
    /* Le message de Google distingue deux murs très différents : un débit
       (réessayer dans quelques secondes) et un quota journalier (attendre
       demain, ou changer de clé). Les confondre faisait dire « réessaie
       demain » pour un simple débit. */
    if (/per.?day|PerDay|daily/i.test(String(e?.detail || ''))) {
      return 'quota journalier Gemini atteint (429) — une autre clé, ou demain';
    }
    return 'Gemini limite le débit (429) — réessaie dans un instant';
  }
  if (st === 404) return 'modèle introuvable (404)';
  if (st === 400) return 'requête refusée par le modèle (400)';
  const m = String(e?.message || e || '');
  if (/abort|timeout/i.test(m)) return 'le modèle n’a pas répondu à temps';
  return m ? `erreur du modèle : ${m.slice(0, 90)}` : 'erreur inconnue du modèle';
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

/* ═══════════════════════════════════════════════════════════════
   La clé du moteur.

   Gemini ne prend **qu'une clé** (`AIza…` ou une « auth key » récente).
   Le jeton OAuth du compte Google ne marche pas : il ne porte pas les
   droits nécessaires, et Google répond 403 « insufficient authentication
   scopes ». Vérifié le 9 novembre, avec un blend réel : la requête est
   refusée et l'app retombe sur le voisinage. On ne fait donc plus semblant.

   Trois sources, dans cet ordre :

   1. la clé saisie par la personne (`Réglages`, ou l'introduction) ;
   2. la clé de l'application (`config/app.ts`), si celui qui héberge l'app
      en a mis une — c'est ce qui permet à tout le monde de ne rien saisir ;
   3. rien : l'app compose par voisinage, et le dit sur le blend.

   Le jeton du compte reste branché pour YouTube, où il fonctionne — c'est
   lui qui remplace la clé YouTube Data v3.
   ═══════════════════════════════════════════════════════════════ */
import { GEMINI_API_KEY } from '../config/app';

/** la clé à utiliser : la sienne, sinon celle de l'application */
const cleGemini = (cleSaisie: string): string => cleSaisie || GEMINI_API_KEY || '';

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
    const apiKey = cleGemini(getStoredSettings().geminiApiKey);

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
      /* Sans clé, on ne peut ni analyser ni nommer. Mais on peut encore
         **chercher** : les artistes qui figurent à côté des piliers sur
         YouTube sont de vrais voisins musicaux. On le dit, et on le fait
         au lieu de rendre les piliers en annonçant un échec. */
      onProgress?.('Aucune clé Gemini — analyse impossible. On compose autrement : par voisinage sur YouTube.');
      return this.parVoisinage(seedTracks, counts, tasteMemory, onProgress, 'aucune clé Gemini');
    }

    /* ── la réserve ──
       Un 429 sur `gemini-2.5-pro` ne dit rien des autres : le quota de
       l'offre gratuite est compté **par modèle**. On garde donc, pour
       cette clé, le premier modèle qui répond et UNE seule réserve —
       pas trois. Trois tentatives qui échouent sur le même mur, c'est
       ce qui remplissait la console de cinq 429 et donnait un blend
       réduit aux piliers sans qu'on sache pourquoi. */
    /* ── toute la file, pas seulement deux ──
       L'offre gratuite compte son quota **par modèle**. Quand le modèle
       phare est à sec, un modèle plus léger a souvent encore son quota
       entier (mesuré chez l'auditeur : Hydrogen 23/20, 3.8 Flash 33/20,
       3.6 Flash 22/20 — mais 3.5 Flash Lite 78/500, intact). S'arrêter
       après deux candidats, c'était renoncer au blend alors qu'il en
       restait six capables de le composer. On les essaie dans l'ordre,
       et on s'arrête au premier qui répond : en pratique un ou deux
       appels, pas huit. */
    /* `memeFamilleSeulement` : après un mur de quota, on ne réessaie que
       des Gemini — les autres familles échoueraient pareil (même quota
       de projet), c'est une requête perdue. */
    const chain: { model: string; key: string; famille: boolean }[] = [];
    try {
      const models = await engineQueue(apiKey);
      chain.push(...models.map((m) => ({ model: m, key: apiKey, famille: /^gemini-/.test(m) })));
    } catch { /* la liste n'a pas répondu : on le dira plus bas */ }
    if (!chain.length) {
      onProgress?.('Aucun modèle de texte disponible — on compose par voisinage sur YouTube.');
      return this.parVoisinage(seedTracks, counts, tasteMemory, onProgress, 'aucun modèle disponible');
    }

    /* état visible du mur, pour l'avouer à l'écran si tout tombe */
    let dernierMur = '';
    const epuisees = new Set<string>();

    /* ── la trace : par quel moyen ce blend est né ──
       posée au fil des appels, pas devinée à la fin : `answer` retient le
       modèle qui a réellement répondu, `dernierMur` la raison du silence. */
    let modeleQuiRepond = '';

    const call: CallModel = async (prompt, temperature, budgetMs) => {
      let last: any = null;
      let journalier = false;
      /* ── toute la file, jusqu'au dernier ──
         L'ordre : les Gemini de texte, du plus récent au plus ancien,
         puis les autres (gemma…) en réserve. On les essaie **tous**,
         dans cet ordre, et on s'arrête au premier qui écrit vraiment.
         Aucun plafond : la demande est explicite. */
      for (const step of chain) {
        /* un modèle déjà à sec n'est pas rappelé : sinon chaque appel du
           blend repayait un 429 sur le même modèle, cinq fois de suite */
        if (outOfQuota(step.model)) continue;
        try {
          const raw = await callModelResilient(step.model, step.key, prompt, temperature, { json: true, budgetMs });
          if (raw) {
            rememberEngine(step.key, step.model);
            modeleQuiRepond = step.model;
            return raw;
          }
        } catch (e: any) {
          last = e;
          const st = e?.status;
          /* quota : on met ce modèle de côté (10 min) et on essaie la
             réserve. La clé refusée ou invalide, elle, condamne le
             couple clé+modèle : c'est la clé qu'on abandonne. */
          if (st === 429) {
            /* « par jour » ou « par minute » : le message de Google le dit */
            journalier = /per.?day|PerDay|daily/i.test(String(e?.detail || ''));
            noteQuota(step.model, journalier);
            dernierMur = explain(e);
            continue;
          }
          if (st === 403 || st === 401) {
            /* la clé est morte : aucun autre modèle ne la ressuscitera */
            epuisees.add(step.key);
            dernierMur = explain(e);
            break;
          }
          if (illisible(e) || st === 400 || st === 404) {
            /* ce modèle-là ne sait pas écrire ce qu'on demande (ou
               n'existe plus sous ce nom) : c'est LUI qui est en cause,
               pas la clé. On l'écarte pour un moment et on passe au
               suivant — sans quoi il resterait en tête de file et
               coûterait un appel perdu à chaque blend. */
            brokenModels.set(step.model, Date.now());
            dernierMur = st === 404 ? 'un modèle introuvable (404)' : 'un modèle qui répond sans texte';
            continue;
          }
        }
      }
      /* Tout a échoué, mais pour du **débit** et non du quota du jour :
         le blocage retombe en une minute. Une seule attente, un seul
         nouvel essai — au-delà, insister serait la bagarre qu'on s'est
         interdite. */
      /* un refus de forme (modèle qui n'écrit pas) n'est pas du débit :
         attendre douze secondes ne le fera pas écrire */
      if (last && !journalier && epuisees.size === 0 && !illisible(last)) {
        onProgress?.('Le débit de Gemini est saturé — un instant, on réessaie.');
        quotaOut.clear();
        await new Promise((r) => setTimeout(r, 12000));
        for (const step of chain) {
          if (brokenModels.has(step.model)) continue;
          try {
            const raw = await callModelResilient(step.model, step.key, prompt, temperature, { json: true, budgetMs });
            if (raw) { rememberEngine(step.key, step.model); modeleQuiRepond = step.model; return raw; }
          } catch (e: any) {
            last = e;
            if (e?.status === 429) continue;
            if (illisible(e) || e?.status === 400 || e?.status === 404) { brokenModels.set(step.model, Date.now()); continue; }
            break;
          }
        }
      }
      if (last) throw last;
      return null;
    };

    /* ═══ 1. écouter ═══ */
    onProgress?.('Écoute des morceaux sélectionnés : genre, textures, énergie…');
    const known = portraitFor(tasteMemory);
    /* l'analyse est la première marche : si elle tombe, on continue avec
       le portrait enregistré OU avec une description neutre — jamais avec
       une exception qui emporte tout le blend */
    let analyseErreur = '';
    let analysis = parseAnalysis(
      await call(analysisPrompt(seedTracks, tasteMemory, known), 0.4, 26000)
        .catch((e) => { analyseErreur = explain(e); return null; }),
    );

    if (analysis) {
      /* on montre ce que le moteur a compris : c'est la preuve visible que
         la sélection part d'une écoute, pas d'un tirage */
      onProgress?.(`Ton fil : ${analysis.fil}`);
    } else {
      /* le modèle n'a rien rendu d'exploitable : on le dit franchement,
         avec la raison quand on la connaît, puis on continue */
      onProgress?.(
        analyseErreur
          ? `Analyse impossible — ${analyseErreur}. On continue sans elle.`
          : 'Analyse indisponible — on continue avec le profil enregistré.',
      );
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
    /* les propositions en réserve, par catégorie (voir `ask`) */
    const margeDe = new Map<TrackCategory, Pick[]>();

    const ask = async (role: TrackCategory, count: number) => {
      if (count <= 0) return [] as Pick[];
      const label = role === 'anchor' ? 'piliers' : role === 'deep_dive' ? 'faces cachées' : 'découvertes';
      onProgress?.(`Sélection des ${count} ${label}…`);
      let passe1 = '';
      let passe2 = '';
      /* On demande de la marge : le modèle propose plus que nécessaire,
         parce que la vérification YouTube en écartera une partie. Sans
         cette marge, deux titres introuvables laissaient deux trous. */
      const marge = Math.min(12, count + Math.max(2, Math.round(count * 0.6)));
      const raw = await call(listPrompt(role, marge, seedTracks, analysis!, tasteMemory, forbiddenList()), role === 'fresh' ? 0.85 : 0.7, 26000)
        .catch((e) => { passe1 = explain(e); return null; });
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
      /* ── la marge, gardée pour plus tard ──
         Le modèle propose plus de titres que nécessaire : c'est
         exactement ce qu'il faut quand un morceau ne se lit pas sur
         YouTube. On garde donc les propositions **non retenues** par
         catégorie ; la vérification pourra y puiser au lieu de laisser
         une place vide. Aucune n'est inventée : elles viennent toutes du
         modèle. */
      const dejaPris = new Set(clean.map((c) => `${c.artist} — ${c.title}`.toLowerCase().trim()));
      const resteCat = (margeDe.get(role) || []);
      for (const t of titres) {
        const k = `${t.artist} — ${t.title}`.toLowerCase().trim();
        if (dejaPris.has(k)) continue;
        if (resteCat.some((x) => `${x.artist} — ${x.title}`.toLowerCase().trim() === k)) continue;
        resteCat.push(t);
      }
      margeDe.set(role, resteCat);
      /* pas assez ? une seconde passe, une seule fois, avec les titres
         déjà retenus ajoutés aux interdits — le modèle ne peut donc pas
         répéter ce qu'il vient de proposer. C'est ce qui évite un blend
         à moitié vide alors que la clé et le modèle fonctionnent. */
      if (clean.length < count) {
        const reste = count - clean.length;
        /* une seconde passe ne doit jamais faire échouer la première */
        const raw2 = await call(listPrompt(role, reste + 2, seedTracks, analysis!, tasteMemory, forbiddenList()), 0.9, 24000)
          .catch((e) => { passe2 = explain(e); return null; });
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
        /* deux cas très différents : le modèle n'a pas répondu (on le dit
           avec la raison), ou il a répondu mais rien ne passait les
           contrôles (on dit lequel) */
        const raison = passe1 || passe2;
        onProgress?.(
          raison
            ? `Aucune ${label} : ${raison}. Le modèle n’a pas pu répondre.`
            : role === 'deep_dive'
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
       la personne — ils ne dépendent pas du modèle. Ils sont vérifiés
       comme les autres : un pilier dont la vidéo ne se lit plus est
       redemandé, puis retiré, jamais laissé muet dans la file. */
    const piliers = await this.piliersVerifies(seedTracks, counts.anchor);
    /* les titres déjà traités par la vérification : la marge ne doit pas
       reproposer le morceau qu'on vient d'écarter, ni un doublon */
    const titresTentes = new Set<string>();
    const cleTitre = (t: string, a: string) => `${norm(a)}|${norm(t)}`;
    const anchorPicks: Pick[] = piliers.map((t) => ({
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

    /* ── le mur, s'il est là ──
       Si les deux listes sont vides **et** que le modèle a refusé (429,
       clé, réseau), ce n'est pas « le modèle n'a rien trouvé » : c'est le
       moteur qui n'a pas répondu. Rendre les piliers en disant « aucune
       face cachée crédible » serait un mensonge. On compose alors par
       voisinage — un vrai blend, trouvé sur YouTube — et on dit lequel
       des deux chemins a servi. */
    if (!dives.length && !fresh.length && analyseErreur) {
      onProgress?.(`Le moteur n’a pas répondu (${analyseErreur}). On compose par voisinage à la place.`);
      const secours = await this.parVoisinage(seedTracks, counts, tasteMemory, onProgress, analyseErreur);
      if (secours.length > counts.anchor) return secours;
    }

    /* ═══ 4. vérifier sur YouTube, puis rassembler ═══ */
    onProgress?.('Vérification des titres sur YouTube…');


    /* Les pertes sont comptées : si des places restent vides, c'est
       presque toujours l'un de ces trois murs — et le dire à l'écran
       évite le « pourquoi seulement les piliers ? ». */
    const pertes = { introuvable: 0, titreDouteux: 0, doublon: 0 };
    const toTrack = async (p: Pick, cat: TrackCategory): Promise<Track | null> => {
      titresTentes.add(cleTitre(p.title, p.artist));
      /* le pilier a déjà été vérifié plus haut (et son identifiant
         éventuellement réparé) : on reprend CETTE version, sinon on
         ramènerait le vieil identifiant mort qu'on vient de remplacer */
      const seed = piliers.find(
        (s) => s.title.toLowerCase().trim() === p.title.toLowerCase().trim()
          && s.artist.toLowerCase().trim() === p.artist.toLowerCase().trim(),
      ) || seedTracks.find(
        (s) => s.title.toLowerCase().trim() === p.title.toLowerCase().trim()
          && s.artist.toLowerCase().trim() === p.artist.toLowerCase().trim(),
      );
      if (seed) return { ...seed, category: cat, rationale: p.rationale || seed.rationale };

      /* ── l'identifiant donné par le modèle ──
         Quand il le connaît, c'est la voie la plus directe : aucune
         recherche, aucun quota, aucune dépendance à la clé YouTube. Ce
         chemin-là fonctionne même quand tout le reste est muet. */
      if (looksLikeVideoId(p.videoId) && !seedTracks.some((s2) => s2.videoId === p.videoId)) {
        /* On VÉRIFIE l'identifiant avant de l'utiliser : l'endpoint oembed
           de YouTube répond sans clé et sans quota, et rend le vrai titre.
           Un identifiant inventé par le modèle était sinon une piste
           muette dans le blend — exactement le genre de faux succès qu'on
           veut éviter. Si la vérification est impossible (réseau muet),
           on fait confiance : le format seul est déjà un bon filtre. */
        const vid: string = p.videoId!;
        const check = await verifyVideo(vid).catch(() => null);
        const titreOfficiel = check?.title || '';
        const artOfficiel = check?.author || '';
        const credible = !check
          || matchesAsked(p.title, p.artist, titreOfficiel, artOfficiel)
          || matchesAsked(p.title, p.artist, titreOfficiel, p.artist);
        if (credible) {
        return {
          id: `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          videoId: p.videoId,
          title: p.title,
          artist: p.artist,
          thumbnailUrl: `https://i.ytimg.com/vi/${p.videoId}/mqdefault.jpg`,
          durationSeconds: 215,
          durationFormatted: '3:35',
          videoUrl: `https://www.youtube.com/watch?v=${p.videoId}`,
          category: cat,
          rationale: p.rationale || 'Choisi par la sélection.',
        } as Track;
        }
        pertes.titreDouteux += 1;
        console.debug(`[curateur] ${p.title} : identifiant ${p.videoId} écarté — YouTube dit « ${titreOfficiel} »`);
      }

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

    /* ── les places vides, comblées par la marge du modèle ──
       Chaque titre écarté (introuvable, ou pas lisible ici) coûtait une
       place. On reprend les propositions que le modèle avait faites
       au-delà du compte — elles sont déjà triées par lui pour ce rôle —
       et on les vérifie l'une après l'autre, jusqu'à remplir. Rien
       d'inventé, et jamais deux fois le même morceau. */
    const parCat: Record<string, { voulu: number; gardes: Track[] }> = {
      anchor: { voulu: counts.anchor, gardes: [] },
      deep_dive: { voulu: counts.deepDive, gardes: [] },
      fresh: { voulu: counts.fresh, gardes: [] },
    };
    resolved.forEach((t, i) => {
      const cat: TrackCategory = i < anchorPicks.length ? 'anchor'
        : i < anchorPicks.length + dives.length ? 'deep_dive' : 'fresh';
      if (t) parCat[cat].gardes.push(t);
    });

    for (const cat of ['anchor', 'deep_dive', 'fresh'] as TrackCategory[]) {
      const manquePour = () => parCat[cat].voulu - parCat[cat].gardes.length;
      const file = margeDe.get(cat) || [];
      let essais = 0;
      while (manquePour() > 0 && file.length && essais < 6) {
        essais += 1;
        const p = file.shift()!;
        if (titresTentes.has(cleTitre(p.title, p.artist))) continue;
        if (parCat[cat].gardes.some((g) => cleTitre(g.title, g.artist) === cleTitre(p.title, p.artist))) continue;
        const t = await toTrack(p, cat);
        if (t) parCat[cat].gardes.push(t);
      }
    }

    const rings = [...parCat.anchor.gardes, ...parCat.deep_dive.gardes, ...parCat.fresh.gardes];
    /* l'ordre du blend : les piliers d'abord, puis les faces cachées, puis
       les découvertes — un vrai enchaînement, pas un tirage */
    const blend = [
      ...rings.filter((t) => t.category === 'anchor'),
      ...rings.filter((t) => t.category === 'deep_dive'),
      ...rings.filter((t) => t.category === 'fresh'),
    ];
    const unique = uniqueByVideo(dedupeTracks(blend));

    /* ── le moyen, dit et gardé ──
       Le voisinage a servi si le chemin d'urgence a été emprunté, ou si
       aucune liste n'est revenue du modèle. On ne le devine pas : on
       regarde ce qui a effectivement produit des morceaux. */
    const parIA = this.derniereMethode === 'gemini'
      && !!(modeleQuiRepond && (dives.length || fresh.length));
    this.derniereMethode = parIA ? 'gemini' : 'voisinage';
    this.dernierModele = parIA ? modeleQuiRepond : '';
    this.derniereNote = parIA
      ? `Composé par ${modeleQuiRepond}.`
      : (dernierMur
        ? `Composé par voisinage YouTube (${dernierMur}). Aucun morceau n’a été inventé.`
        : 'Composé par voisinage YouTube, sans modèle d’IA. Aucun morceau n’a été inventé.');

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

  /**
   * Composer sans modèle : par voisinage.
   *
   * C'est la réponse au seul vrai mur qu'on ait trouvé — un moteur d'IA
   * à court de quota. Plutôt que de rendre les piliers en disant
   * « impossible », on interroge YouTube pour ce qu'il sait sans IA :
   *   · les **faces cachées** viennent de l'artiste des piliers lui-même
   *     (l'album, les faces B, les versions — ce que la recherche par
   *     titre ne montrait pas) ;
   *   · les **découvertes** viennent des artistes qui apparaissent à côté
   *     des piliers dans les résultats de recherche — de vrais voisins.
   *
   * Aucune de ces deux listes n'est inventée : chaque morceau a un
   * identifiant YouTube réel, et les doublons sont écartés. C'est moins
   * fin qu'un modèle, mais c'est un blend.
   */
  private async parVoisinage(
    seedTracks: Track[],
    counts: { anchor: number; deepDive: number; fresh: number },
    taste: TasteMemory,
    onProgress?: (m: string) => void,
    raison = '',
  ): Promise<Track[]> {
    this.derniereMethode = 'voisinage';
    /* La phrase de la trace est posée ici et non plus loin : ce chemin
       sort de `generateBlend` par un `return` anticipé, et la note serait
       restée vide — le blend aurait affiché « voisinage » sans dire
       pourquoi. */
    this.derniereNote = raison
      ? `Composé par voisinage YouTube (${raison}). Aucun morceau n’a été inventé.`
      : 'Composé par voisinage YouTube, sans modèle d’IA. Aucun morceau n’a été inventé.';
    /* les piliers passent le même contrôle que dans le chemin IA : une
       vidéo retirée depuis la playlist ne doit pas ouvrir le blend */
    onProgress?.('Vérification des morceaux sur YouTube…');
    const out: Track[] = await this.piliersVerifies(seedTracks, counts.anchor);
    const vus = new Set(out.map((t) => `${t.artist} — ${t.title}`.toLowerCase().trim()));
    const vusTitres = new Set(out.map((t) => t.title.toLowerCase().trim()));
    const videoIds = new Set(out.map((t) => t.videoId));
    const artistesAmorces = [...new Set(seedTracks.map((t) => t.artist))];

    /* ── les goûts, même sans IA ──
       Le voisinage ne devine pas : il reçoit les mêmes règles que le
       modèle. Un artiste écarté ne peut pas entrer, et un artiste aimé
       déjà présent dans le blend n'a pas à revenir — sinon « éviter
       David Guetta » ne servait à rien dès que Gemini tombait. */
    const artistesEcartes = new Set(
      [...taste.dislikedArtists, ...taste.dislikedTracks.map((t) => t.artist)]
        .map((a) => a.toLowerCase().trim()).filter(Boolean),
    );
    const artistesAimes = new Set(
      [...taste.likedArtists, ...taste.likedTracks.map((t) => t.artist)]
        .map((a) => a.toLowerCase().trim()).filter(Boolean),
    );
    /* les morceaux déjà aimés ne sont pas des découvertes : on les écarte
       des propositions (les remettre serait une redite, pas un cadeau) */
    const dejaAimes = new Set(taste.likedTracks.map((t) => t.title.toLowerCase().trim()));

    const ajoute = (vi: { videoId: string; title: string; artist: string }, cat: TrackCategory, pourquoi: string) => {
      /* Piped rend « Artiste - Titre (Official Audio) » et une chaîne du
         genre « KAVINSKY and Record Makers ». On sépare les deux avec le
         même outil que partout ailleurs : sans ça la liste affichait
         « Kavinsky - Nightcall (Drive… » en titre et la chaîne en
         artiste. */
      const propre = cleanTitle(vi.title || '');
      const chaine = (vi.artist || '').replace(/\s*-\s*Topic$/i, '')
        /* « KAVINSKY and Record Makers », « Mr.Kitty Official » : le nom
           de la chaîne est un nom d'artiste noyé dans des mots-clés.
           On coupe avant le premier « and / official / records ». */
        .replace(/\s+(?:and|&|official|records|music|topic)\b.*$/i, '')
        .trim();
      const titre = propre.title;
      const artiste = (propre.artist || chaine || vi.artist || '').trim();
      const k = `${artiste} — ${titre}`.toLowerCase().trim();
      if (!titre || !artiste || vus.has(k) || vusTitres.has(titre.toLowerCase().trim())) return false;
      /* Le voisinage sans IA ramène parfois du bruit : groupes de reprise,
         karaoké, « NYE Party Band », versions piano pour bébés. Ce n'est
         pas une découverte, c'est un remplissage. On les écarte. */
      const bruit = /\b(karaoke|karaoké|tribute|cover band|covers?|party band|nye|hits|8-bit|lullaby|berceuse|string quartet|piano version|piano cover|instrumental version|made famous|originally performed)\b/i;
      if (bruit.test(artiste) || bruit.test(titre)) return false;
      /* les goûts de la personne, appliqués ici aussi */
      if (artistesEcartes.has(artiste.toLowerCase().trim())) return false;
      if (dejaAimes.has(titre.toLowerCase().trim())) return false;
      if (videoIds.has(vi.videoId)) return false;
      vus.add(k); vusTitres.add(titre.toLowerCase().trim()); videoIds.add(vi.videoId);
      out.push({
        id: `voisin-${vi.videoId}`,
        videoId: vi.videoId,
        /* Piped ne rend que des vidéos du catalogue : elles existent et se
           lisent (le contrôle fin, lui, se fait à la lecture) */
        verifie: true,
        title: titre,
        artist: artiste,
        thumbnailUrl: `https://i.ytimg.com/vi/${vi.videoId}/hqdefault.jpg`,
        durationSeconds: 0,
        durationFormatted: '',
        videoUrl: `https://www.youtube.com/watch?v=${vi.videoId}`,
        category: cat,
        rationale: pourquoi,
      });
      return true;
    };

    /* 1. les faces cachées : le même artiste, un autre morceau */
    onProgress?.('Faces cachées : on fouille les artistes de ta sélection sur YouTube…');
    /* On répartit : deux morceaux par artiste avant de revenir au
       premier. Sinon les quatre faces cachées venaient toutes du même
       groupe, et le blend ressemblait à un album. */
    const listes = await Promise.all(
      artistesAmorces.slice(0, 4).map((a) => artistTracks(a).catch(() => [])),
    );
    for (let tour = 0; tour < 3; tour++) {
      for (let a = 0; a < listes.length; a++) {
        if (out.filter((t) => t.category === 'deep_dive').length >= counts.deepDive) break;
        const vi = listes[a][tour];
        if (vi) ajoute(vi, 'deep_dive', `Voisinage : un autre morceau de ${artistesAmorces[a]}, trouvé sur sa chaîne.`);
      }
    }

    /* 2. les découvertes : les artistes qui sortent à côté des piliers */
    onProgress?.('Découvertes : on cherche les artistes qui jouent dans la même cour…');
    const voisins: string[] = [];
    for (const artiste of artistesAmorces.slice(0, 2)) {
      const proches = await relatedArtists(artiste).catch(() => []);
      for (const p of proches) if (!voisins.includes(p)) voisins.push(p);
    }
    /* Un artiste aimé qui n'est pas dans les piliers passe devant : c'est
       le goût explicite de la personne, pas une déduction. */
    const prochesDesGouts = [...artistesAimes].filter((a) => !artistesAmorces.some((x) => x.toLowerCase().trim() === a));
    for (const a of prochesDesGouts) if (!voisins.includes(a)) voisins.unshift(a);

    for (const artiste of voisins) {
      if (out.filter((t) => t.category === 'fresh').length >= counts.fresh) break;
      const liste = await artistTracks(artiste).catch(() => []);
      for (const vi of liste.slice(0, 3)) {
        if (out.filter((t) => t.category === 'fresh').length >= counts.fresh) break;
        ajoute(vi, 'fresh', `Voisinage : ${artiste} apparaît aux côtés de ${artistesAmorces[0]}.`);
      }
    }

    const d = out.filter((t) => t.category === 'deep_dive').length;
    const f = out.filter((t) => t.category === 'fresh').length;
    onProgress?.(
      `Blend composé sans IA : ${out.length} morceaux — ${out.length - d - f} piliers, ${d} face${d > 1 ? 's' : ''} cachée${d > 1 ? 's' : ''}, ${f} découverte${f > 1 ? 's' : ''}. Trouvés sur YouTube, jamais inventés.`,
    );
    return out;
  }

  /* ── la trace de la composition ──
     « Par quel moyen ce blend est-il né ? » a une réponse, et elle est
     gardée : `methode` est posée par le chemin qui a réellement servi,
     `note` est la phrase à montrer. `DataContext` les attache au blend. */
  public derniereMethode: 'gemini' | 'voisinage' = 'gemini';
  /** le modèle qui a réellement répondu — `gemini-3.5-flash-lite`, pas « gemini » */
  public dernierModele = '';
  public derniereNote = '';

  /** Sans modèle : on ne fabrique rien, on rend au moins les amorces. */
  private anchorsOnly(seedTracks: Track[], anchorCount: number): Track[] {
    return seedTracks.slice(0, Math.max(1, anchorCount)).map((t) => ({
      ...t,
      category: 'anchor' as TrackCategory,
      rationale: 'Pilier : morceau de ta sélection.',
    }));
  }

  /**
   * Les piliers, vérifiés comme les autres.
   *
   * Un pilier vient d'une playlist de la personne : son identifiant
   * existe. Mais une vidéo de playlist peut avoir été retirée depuis —
   * et c'était l'autre moitié du problème, une file qui commence sur des
   * morceaux morts. On vérifie sans clé (oembed + lecteur), et on
   * redemande le morceau par son titre s'il ne se lit plus. Un pilier
   * qu'on ne retrouve pas est retiré : mieux vaut un blend plus court
   * qu'un blend qui saute.
   */
  private async piliersVerifies(seedTracks: Track[], anchorCount: number): Promise<Track[]> {
    const base = this.anchorsOnly(seedTracks, anchorCount);
    const out: Track[] = [];
    for (const t of base) {
      const test = await youtubeService.estJouable(t.videoId).catch(() => null);
      if (!test || test.ok !== false) { out.push({ ...t, verifie: true }); continue; }
      const neuf = await youtubeService.reparerVideoId(t.title, t.artist).catch(() => null);
      if (neuf) out.push({ ...t, videoId: neuf, verifie: true });
      else console.debug(`[pilier] ${t.title} / ${t.artist} : ${test.raison} — retiré du blend`);
    }
    return out;
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
    const apiKey = cleGemini(getStoredSettings().geminiApiKey);

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
  /** tous ceux que la clé annonce et qu'on a écartés, avec la raison */
  ecartes: { nom: string; raison: string }[];
  error?: string;
}> {
  try {
    const models = await listTextModels(apiKey);
    const ecartes = [...ecartesPour(apiKey).entries()].map(([nom, raison]) => ({ nom, raison }));
    return models.length
      ? { models, ecartes }
      : { models: [], ecartes, error: 'Aucun modèle de texte disponible pour cette clé.' };
  } catch (e: any) {
    return { models: [], ecartes: [], error: e?.message || 'models.list a échoué.' };
  }
}

export const geminiService = new GeminiService();
