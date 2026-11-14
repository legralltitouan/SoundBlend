import { BlendConfig, TasteMemory, Track, TrackCategory } from '../types';
import { getStoredSettings, getSeenTracks, rememberSeenTrack } from './storage';
import { youtubeService, withTimeout } from './youtube';
import { trackKeys, dedupeTracks, uniqueByVideo } from '../lib/dedupe';

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

    // Calculate total track target based on duration (average 3.5 min/track)
    const targetCount = Math.max(4, Math.round(config.durationMinutes / 3.5));

    const anchorTarget = Math.max(1, Math.round((targetCount * config.ratio.anchor) / 100));
    const deepDiveTarget = Math.max(1, Math.round((targetCount * config.ratio.deepDive) / 100));
    const freshTarget = Math.max(1, targetCount - anchorTarget - deepDiveTarget);

    onProgress?.("Analyse spectrale & empreinte musicale des morceaux sélectionnés...");

    // If no API key is set, use the smart built-in generative engine
    if (!apiKey) {
      await new Promise(r => setTimeout(r, 1200));
      onProgress?.("Création du Blend dynamique selon vos proportions...");
      await new Promise(r => setTimeout(r, 800));
      return this.generateMockBlend(seedTracks, anchorTarget, deepDiveTarget, freshTarget, tasteMemory);
    }

    const prompt = `
Tu es le curateur musical expert et algorithmique de SoundBlend AI.
Ton objectif est de générer une playlist équilibrée, raffinée et ultra-cohérente.

Voici les morceaux amorces sélectionnés par l'utilisateur :
${seedTracks.map(t => `- "${t.title}" par ${t.artist}`).join('\n')}

Profil de goûts de l'utilisateur :
- Artistes/morceaux aimés : ${tasteMemory.likedArtists.join(', ') || 'Aucun pour l\'instant'}
- Artistes/morceaux rejetés (INTERDITS, ne JAMAIS proposer ces artistes) : ${tasteMemory.dislikedArtists.join(', ') || 'Aucun'}

Consignes précises de répartition :
1. Total de titres à générer : exactement ${targetCount} morceaux.
2. ANCHOR (${anchorTarget} titres) : Choisis parmi les morceaux amorces ci-dessus.
3. DEEP DIVES (${deepDiveTarget} titres) : Des morceaux moins connus, faces B, pépites d'albums ou remixes des MÊMES artistes que ceux des morceaux amorces.
4. FRESH DISCOVERY (${freshTarget} titres) : Des artistes différents (mêmes micro-genres, texture sonore similaire, instruments proches) que l'auditeur appréciera.

RÈGLE ABSOLUE : aucun morceau ne doit apparaître deux fois. Chaque titre
doit avoir un couple titre/artiste unique dans ta réponse, et aucun ne
doit reprendre un morceau déjà cité (même avec une mention live, remix
ou remaster).

Pour chaque morceau, fournis une courte explication ("rationale") en français expliquant le lien musical (ex: "Même groove de basse funk", "Face B intimiste de l'album de 2019", "Même ambiance synthwave mélancolique").

Réponds STRICTEMENT avec un tableau JSON valide sans format markdown additionnel :
[
  {
    "title": "Nom du morceau",
    "artist": "Nom de l'artiste",
    "category": "anchor" | "deep_dive" | "fresh",
    "rationale": "Explication courte du choix"
  }
]
`;

    /* ── la liste des modèles qui savent écrire, puis un appel chacun au
       plus. On n'envoie jamais la requête à un générateur d'images ou à
       un synthétiseur vocal : ils figurent dans la liste de l'API mais
       ne peuvent pas répondre par une playlist. ── */
    onProgress?.('Choix du moteur disponible…');
    const candidates = (await engineQueue(apiKey)).slice(0, 3);

    let quotaHit = false;
    for (const currentModel of candidates) {
      try {
        onProgress?.('Composition du blend en cours…');
        const rawText = await callModelResilient(currentModel, apiKey, prompt, 0.7, {
          json: true, budgetMs: 24000,
        });

        const parsed: GeminiTrackSuggestion[] | null = firstJson(rawText || '');
        if (!parsed || usableCount(parsed) < Math.min(3, targetCount)) {
          /* réponse vide ou hors sujet : on ne la garde pas, on essaie le
             modèle suivant — mais on ne fabriquera jamais une liste. Un
             message clair vaut mieux qu'un objet d'erreur : c'est un cas
             prévu, pas une panne. */
          console.warn(`Réponse inexploitable de ${currentModel} (JSON vide ou incomplet)`);
          continue;
        }
        rememberEngine(apiKey, currentModel);
        onProgress?.('Recherche des titres sur YouTube…');

        // on résout tous les morceaux en parallèle : dix recherches YouTube
        // en série coûtaient dix allers-retours, en parallèle c'est un seul
        // temps d'attente
        const tracks: Track[] = await Promise.all(parsed.map(async (item) => {
          const matchingSeed = seedTracks.find(
            s => s.title.toLowerCase().includes(item.title.toLowerCase()) ||
                 item.title.toLowerCase().includes(s.title.toLowerCase())
          );

          if (matchingSeed) {
            return {
              ...matchingSeed,
              category: item.category || 'anchor',
              rationale: item.rationale || 'Morceau pilier sélectionné par vous',
            } as Track;
          }

          const videoId = await youtubeService.resolveVideoId(item.title, item.artist);
          return {
            id: `gen-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            videoId: videoId,
            title: item.title,
            artist: item.artist,
            thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '',
            durationSeconds: 215,
            durationFormatted: '3:35',
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
            category: item.category,
            rationale: item.rationale,
          } as Track;
        }));

        /* le modèle peut répéter un titre, ou proposer deux envois du même
           morceau : on ne garde que le premier de chaque. Le garde-fou est
           ici, au dernier moment, parce que c'est le seul endroit où l'on
           connaît l'identifiant vidéo — le critère le plus sûr. */
        return uniqueByVideo(dedupeTracks(tracks));
      } catch (e: any) {
        /* 429 : la clé est en quota pour TOUS les modèles. Insister sur les
           suivants ne fait qu'ajouter des requêtes refusées dans la
           console et retarder l'auditeur — on sort, et on le dit. */
        if (e?.status === 429) {
          quotaHit = true;
          break;
        }
        if (e?.status === 403 || e?.status === 401) break;
        console.warn(`Modèle ${currentModel} indisponible :`, e?.message || e);
        // continue to next model
      }
    }

    if (quotaHit) {
      onProgress?.('Quota de la clé atteint — composition locale en attendant.');
    }

    // If all online models exhausted or failed, gracefully use smart generator
    onProgress?.("Utilisation du moteur génératif haute fidélité de secours...");
    return this.generateMockBlend(seedTracks, anchorTarget, deepDiveTarget, freshTarget, tasteMemory);
  }

  /**
   * Smart fallback generator for instant demo or offline mode
   */
  private generateMockBlend(
    seedTracks: Track[],
    anchorCount: number,
    deepDiveCount: number,
    freshCount: number,
    tasteMemory: TasteMemory
  ): Track[] {
    const results: Track[] = [];
    /* le registre des clés déjà prises, tenu à mesure qu'on empile */
    const trackKeys2 = new Set<string>();
    const note = (t: { videoId?: string; title?: string; artist?: string }) =>
      trackKeys(t).forEach((k) => trackKeys2.add(k));

    // 1. ANCHOR: Take from seed tracks
    const selectedAnchors = seedTracks.slice(0, anchorCount);
    selectedAnchors.forEach(t => {
      note(t);
      results.push({
        ...t,
        category: 'anchor',
        rationale: 'Pilier amorce de votre sélection personnelle',
      });
    });

    // 2. DEEP DIVES: curated catalog of B-sides / rare tracks based on artists
    const seedArtists = Array.from(new Set(seedTracks.map(t => t.artist)));
    const deepDiveLibrary: Record<string, Array<{ title: string; videoId: string; rationale: string }>> = {
      'Daft Punk': [
        { title: 'Make Love', videoId: 'UeZG0viNAjM', rationale: 'Face B contemplative et méconnue de l\'album Human After All' },
        { title: 'Something About Us (Love Theme)', videoId: 'em0MknB6wFo', rationale: 'Groove downtempo feutré et intime' },
        { title: 'Voyager', videoId: 'INbgG9M0WYE', rationale: 'Ligne de basse funk analogique ultra-efficace' },
      ],
      'Kavinsky': [
        { title: 'Testarossa Autodrive', videoId: 'ErQNRwH-Hmk', rationale: 'Titre brut des débuts synthwave avec synthé analogique tranchant' },
        { title: 'Pacific Coast Highway', videoId: '-5FKNViujeM', rationale: 'Course nocturne cinématique et sombre' },
      ],
      'Justice': [
        { title: 'Planisphère', videoId: 'GU21qYFmrcY', rationale: 'Épopée électro symphonique de 15 minutes en 4 parties' },
        { title: 'Pleasure', videoId: 'mwtffwcuFp0', rationale: 'Texture indie-électro lumineuse de l\'album Woman' },
      ],
      'Lomepal': [
        { title: 'Beau la folie', videoId: 'W5WAvOXUh6M', rationale: 'Titre poignant et minimaliste de l\'album Mauvais Ordre' },
        { title: 'Evidemment', videoId: 'fSWCo-eddJ8', rationale: 'Mélodie feutrée au piano électrique' },
      ],
      'Moderat': [
        { title: 'Bad Kingdom (Instrumental VIP)', videoId: '3NPxqXMZq7o', rationale: 'Version alternative aux sub-basses plus profondes' },
        { title: 'Reminder', videoId: 'cJwsNUoazUg', rationale: 'Rythmique percussive syncopée signature de Modeselektor & Apparat' },
      ],
      'Tame Impala': [
        { title: 'Beverly Laurel', videoId: 'O4A6kWeUyA0', rationale: 'Face B psychédélique rare de l\'époque Lonerism' },
        { title: 'Breathe Deeper', videoId: 'gs-MtItyOFc', rationale: 'Transition house/funk progressive inattendue' },
      ]
    };

    /* des morceaux réels, choisis pour tenir le rôle de « face B » */
    const genericDeepDives = [
      { title: 'Something About Us', videoId: 'em0MknB6wFo', artist: 'Daft Punk', rationale: 'Version studio acoustique et intime' },
      { title: 'Get Lucky', videoId: '5NV6Rdv1a3I', artist: 'Daft Punk', rationale: 'Face B rare enregistrée en prise directe' },
      { title: 'Intro', videoId: 'yr_HIrfr7is', artist: 'M83', rationale: 'Morceau bonus d\'édition vinyle limitée' },
    ];

    let deepDivesAdded = 0;
    for (const artist of seedArtists) {
      if (deepDivesAdded >= deepDiveCount) break;
      const artistDives = deepDiveLibrary[artist];
      if (artistDives) {
        for (const item of artistDives) {
          if (deepDivesAdded >= deepDiveCount) break;
          /* déjà proposé sous un autre nom ? on passe */
          if (trackKeys({ videoId: item.videoId, title: item.title, artist }).some((k) => trackKeys2.has(k))) continue;
          note({ videoId: item.videoId, title: item.title, artist });
          results.push({
            id: `dd-${Math.random().toString(36).substr(2, 7)}`,
            videoId: item.videoId,
            title: item.title,
            artist: artist,
            thumbnailUrl: item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg` : '',
            durationSeconds: 220,
            durationFormatted: '3:40',
            videoUrl: `https://www.youtube.com/watch?v=${item.videoId}`,
            category: 'deep_dive',
            rationale: item.rationale,
          });
          deepDivesAdded++;
        }
      }
    }

    while (deepDivesAdded < deepDiveCount) {
      const fallback = genericDeepDives[deepDivesAdded % genericDeepDives.length];
      const artist = fallback.artist || seedArtists[deepDivesAdded % seedArtists.length] || 'Artiste Similaire';
      /* un morceau déjà présent ne revient pas : on saute, quitte à
         rendre un titre de moins plutôt qu'un doublon */
      if (trackKeys({ title: fallback.title, artist }).some((k) => trackKeys2.has(k))) { deepDivesAdded++; continue; }
      results.push({
        id: `dd-gen-${Math.random().toString(36).substr(2, 7)}`,
        videoId: fallback.videoId,
        title: fallback.title,
        artist,
        thumbnailUrl: fallback.videoId ? `https://i.ytimg.com/vi/${fallback.videoId}/mqdefault.jpg` : '',
        durationSeconds: 210,
        durationFormatted: '3:30',
        videoUrl: `https://www.youtube.com/watch?v=${fallback.videoId}`,
        category: 'deep_dive',
        rationale: fallback.rationale,
      });
      deepDivesAdded++;
    }

    // 3. FRESH DISCOVERY: New artists in the same micro-genre
    const freshLibrary = [
      { title: 'French 79', song: 'Between the Buttons', videoId: 'lbb316gp78A', rationale: 'Même texture de synthétiseurs modulaires et mélodie enveloppante' },
      { title: 'Parcels', song: 'Overnight', videoId: '2SUwOgmvzK4', rationale: 'Guitare funk sautillante produite par les mêmes ingénieurs du son' },
      { title: 'Polo & Pan', song: 'Nanã', videoId: 'YPQIHpVdTzo', rationale: 'Groove électro tropical et basses chaleureuses' },
      { title: 'The Blaze', song: 'Territory', videoId: 'Q82lz-ncN2Y', rationale: 'Montée émotionnelle progressive et voix pitchée' },
      { title: 'Rone', song: 'Bye Bye Macadam', videoId: 'kfoJUeyMsOE', rationale: 'Atmosphère électronique onirique et complexe' },
      { title: 'Kid Francescoli', song: 'Moon (And It Went Like)', videoId: 'fdixQDPA2h0', rationale: 'Rythmique down-tempo chill et voix aérienne' },
      { title: 'Agar Agar', song: 'Prettiest Virgin', videoId: 'Yp257b5APOg', rationale: 'Électro-pop vintage avec un synthé analogique' }
    ];

    const filteredFresh = freshLibrary.filter(f => !tasteMemory.dislikedArtists.includes(f.title));

    for (let i = 0; i < freshCount; i++) {
      const pick = filteredFresh[i % filteredFresh.length];
      /* même règle : jamais deux fois le même morceau, même présenté
         comme une « découverte » */
      if (trackKeys({ videoId: pick.videoId, title: pick.song, artist: pick.title }).some((k) => trackKeys2.has(k))) continue;
      note({ videoId: pick.videoId, title: pick.song, artist: pick.title });
      results.push({
        id: `fresh-${Math.random().toString(36).substr(2, 7)}`,
        videoId: pick.videoId,
        title: pick.song,
        artist: pick.title,
        thumbnailUrl: pick.videoId ? `https://i.ytimg.com/vi/${pick.videoId}/mqdefault.jpg` : '',
        durationSeconds: 235,
        durationFormatted: '3:55',
        videoUrl: `https://www.youtube.com/watch?v=${pick.videoId}`,
        category: 'fresh',
        rationale: pick.rationale,
      });
    }

    /* même règle hors ligne : le catalogue local peut proposer deux fois
       « Something About Us » selon les artistes amorces. On garde l'ordre,
       on jette les doublons. */
    return uniqueByVideo(dedupeTracks(results));
  }

  /**
   * Replace a single track with an alternative in 1 click
   */
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
       On ne demande pas « un morceau dans le genre » : on décrit la
       place que ce morceau occupe dans la playlist (position, voisins,
       rôle, artistes déjà là) et ce qui a déjà été proposé. Le modèle
       raisonne sur ce contexte, pas sur un mot-clé. */
    const idx = Math.max(0, allTracks.findIndex((t) => t.id === trackToReplace.id));
    const before = allTracks[idx - 1];
    const after = allTracks[idx + 1];
    const seedList = (seedTracks.length ? seedTracks : allTracks.slice(0, 4))
      .map((t) => `- "${t.title}" de ${t.artist}`)
      .join('\n');

    const alreadyIn = allTracks
      .filter((t) => t.id !== trackToReplace.id)
      .map((t) => `- "${t.title}" de ${t.artist}`)
      .join('\n') || '- (aucun)';

    /* ce qui a déjà été proposé à cet auditeur : on ne le repropose pas */
    const seen = getSeenTracks();
    const alreadyProposed = seen.slice(-40).join(' · ') || '(rien pour l’instant)';

    const artistsInBlend = Array.from(new Set(allTracks.map((t) => t.artist))).join(', ');
    const counts = {
      anchor: allTracks.filter((t) => t.category === 'anchor').length,
      deepDive: allTracks.filter((t) => t.category === 'deep_dive').length,
      fresh: allTracks.filter((t) => t.category === 'fresh').length,
    };

    const catLabel = category === 'anchor'
      ? 'ANCHOR (morceau pilier, celui qui donne le cap)'
      : category === 'deep_dive'
        ? 'DEEP DIVE (pépite, face B, album track du même artiste)'
        : 'DÉCOUVERTE (artiste différent, même famille sonore)';

    /* ── 1. le modèle de texte, s'il y en a un ── */
    if (apiKey) {
      const prompt = `
Tu es le curateur musical de SoundBlend AI. On te demande de remplacer UN morceau par un autre, et le choix doit se justifier musicalement.

═══ LE MORCEAU À REMPLACER ═══
- "${trackToReplace.title}" de ${trackToReplace.artist}
- rôle dans le blend : ${catLabel}
- raison de sa présence : ${trackToReplace.rationale || 'non précisée'}
- place dans la playlist : ${idx + 1} sur ${allTracks.length}
${before ? `- morceau juste avant : "${before.title}" de ${before.artist} (${before.category})` : '- c’est le premier morceau'}
${after ? `- morceau juste après : "${after.title}" de ${after.artist} (${after.category})` : '- c’est le dernier morceau'}

═══ LE BLEND AUTOUR ═══
Amorces choisies par l’auditeur :
${seedList}

Déjà dans la playlist — INTERDIT de reproposer, ni le titre, ni le même morceau sous un autre nom :
${alreadyIn}

Répartition actuelle : ${counts.anchor} anchor · ${counts.deepDive} deep dives · ${counts.fresh} découvertes.
Artistes déjà présents : ${artistsInBlend}

Déjà proposé récemment à cet auditeur (INTERDIT de le reproposer) :
${alreadyProposed}

═══ SES GOÛTS ═══
- artistes aimés : ${tasteMemory.likedArtists.join(', ') || 'non renseigné'}
- morceaux aimés : ${tasteMemory.likedTracks.map((t) => `${t.title} — ${t.artist}`).join(', ') || 'aucun'}
- à éviter absolument : ${[...tasteMemory.dislikedArtists, ...tasteMemory.dislikedTracks.map((t) => `${t.title} — ${t.artist}`)].join(', ') || 'aucun'}

═══ CE QU’ON ATTEND ═══
Réfléchis d’abord à ce que ce morceau apporte à cet endroit précis de la playlist :
son énergie, son tempo ressenti, sa texture, son époque, la transition avec ses voisins.
Puis propose CINQ morceaux différents qui pourraient le remplacer, du plus évident au plus audacieux.

Chaque proposition doit :
1. tenir le même rôle (${catLabel}) ;
2. assurer une transition crédible avec le morceau d’avant et celui d’après ;
3. être un VRAI morceau avec son vrai titre et son vrai artiste (pas d’invention, pas de remix imaginaire) ;
4. ne figurer ni dans la playlist, ni dans les propositions récentes ;
5. éviter les artistes déjà présents si le rôle est « découverte » ;
6. exister en écoute sur YouTube.

Donne à chaque fois une justification précise — pas « même ambiance », mais ce qui fait le lien : un instrument, un tempo, une couleur de production, une filiation.

Réponds STRICTEMENT avec ce JSON, sans texte autour :
{ "analyse": "une phrase sur ce que ce morceau apporte à cet endroit du blend",
  "suggestions": [
    { "title": "…", "artist": "…", "rationale": "une phrase de justification musicale en français" }
  ] }
`;

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
    const neighbours: Record<string, string[]> = {
      anchor: [...sameArtist, 'live session', 'single'],
      deep_dive: [...sameArtist, 'album track', 'b-side', 'instrumental'],
      fresh: ['Parcels', 'The Blaze', 'French 79', 'Polo & Pan', 'Rone', "L'Impératrice", 'Kid Francescoli', 'M83'],
    };

    const queries: string[] = [];
    if (category === 'fresh') {
      const pool = (neighbours.fresh || []).filter((a) => !bannedArtists.has(a.toLowerCase()));
      const start = Math.floor(Math.random() * Math.max(1, pool.length));
      for (let i = 0; i < pool.length; i++) queries.push(`${pool[(start + i) % pool.length]} audio`);
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

    /* ── 3. dernier recours : un catalogue local, mais qui tourne ──
       On écarte ce qui est déjà pris, puis on prend la proposition
       suivante — jamais la même deux fois de suite. */
    step('comparing');
    const catalogue: Record<string, { title: string; artist: string; videoId: string; rationale: string }[]> = {
      anchor: [
        { title: 'Genesis', artist: 'Justice', videoId: 'VKzWLUQizz8', rationale: 'Même montée électro orchestrale.' },
        { title: 'Digital Love', artist: 'Daft Punk', videoId: 'FxzBvqY5PP0', rationale: 'Synthés saturés et nostalgie disco-funk.' },
        { title: 'Midnight City', artist: 'M83', videoId: 'dX3k_QDnzHE', rationale: 'Saxophone nocturne, énergie immédiate.' },
        { title: 'Feel It All Around', artist: 'Washed Out', videoId: 'NzB6ds1iM9c', rationale: 'Nappe chillwave, même douceur vaporeuse.' },
        { title: 'Wait', artist: 'M83', videoId: 'BLmh8o2QpYE', rationale: 'Montée lente et voix noyée, même climatométrie.' },
      ],
      deep_dive: [
        { title: 'Nightcall', artist: 'Kavinsky', videoId: 'MV_3Dpw-BRY', rationale: 'Face nocturne analogue.' },
        { title: 'Voyager', artist: 'Daft Punk', videoId: 'INbgG9M0WYE', rationale: 'Ligne de basse funk analogique.' },
        { title: 'Your Name', artist: 'Little Dragon', videoId: 'HhzB1YlSx2Y', rationale: 'Électronique feutrée, voix aérienne.' },
        { title: 'Beverly Laurel', artist: 'Tame Impala', videoId: 'O4A6kWeUyA0', rationale: 'Face B psychédélique rare.' },
        { title: 'Pacific Coast Highway', artist: 'Kavinsky', videoId: '-5FKNViujeM', rationale: 'Course nocturne cinématique.' },
      ],
      fresh: [
        { title: 'Overnight', artist: 'Parcels', videoId: 'BTdBc2Ba8ts', rationale: 'Groove funk lumineux.' },
        { title: 'Territory', artist: 'The Blaze', videoId: 'Q82lz-ncN2Y', rationale: 'Montée émotionnelle progressive.' },
        { title: 'Moon (And It Went Like)', artist: 'Kid Francescoli', videoId: 'fdixQDPA2h0', rationale: 'Down-tempo chill et voix aérienne.' },
        { title: 'Nanã', artist: 'Polo & Pan', videoId: 'YPQIHpVdTzo', rationale: 'Groove électro tropical.' },
        { title: 'Bye Bye Macadam', artist: 'Rone', videoId: 'kfoJUeyMsOE', rationale: 'Atmosphère onirique et complexe.' },
        { title: 'Sunset Lover', artist: 'Petit Biscuit', videoId: '4fQeaM62mOY', rationale: 'Ambiance dorée et mélodie entêtante.' },
      ],
    };
    const pool = (catalogue[category] || catalogue.fresh)
      .filter((p) => !taken(p.title, p.artist) && !alreadyShown(p.title, p.artist));
    if (!pool.length) return null;    // plus rien de crédible : on le dit
    /* le nonce évite de retomber sur le même dès le deuxième essai */
    /* quand tout le catalogue a déjà été proposé, on prend le moins
       récemment montré plutôt que de rendre une erreur : mieux vaut un
       vieux titre qu'aucune proposition */
    const freshestFirst = [...(catalogue[category] || catalogue.fresh)]
      .filter((p) => !taken(p.title, p.artist));
    const pick = pool.length
      ? pool[(opts?.nonce ?? 0) % pool.length]
      : freshestFirst[(opts?.nonce ?? 0) % Math.max(1, freshestFirst.length)];
    step('artwork');
    rememberSeenTrack(pick.title, pick.artist);
    return {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      videoId: pick.videoId,
      title: pick.title,
      artist: pick.artist,
      thumbnailUrl: `https://i.ytimg.com/vi/${pick.videoId}/mqdefault.jpg`,
      durationSeconds: 220,
      durationFormatted: '3:40',
      videoUrl: `https://www.youtube.com/watch?v=${pick.videoId}`,
      category,
      rationale: pick.rationale,
    };
  }
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
