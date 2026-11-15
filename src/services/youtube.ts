import { Playlist, Track, UserProfile } from '../types';
import { MOCK_PLAYLISTS } from '../data/mockData';
import { artistMatches, getStoredSettings, isExcluded } from './storage';
import { cleanTitle, matchesAsked, norm } from '../lib/track';
import type { Video } from './search';
import { pipedSearch, verifyVideo } from './search';

/* Aucun appel réseau ne doit pouvoir pendre indéfiniment : au-delà de
   dix secondes, on considère que c'est perdu et on passe à la suite. */
export const withTimeout = async <T,>(p: Promise<T>, ms = 10000, fallback: T): Promise<T> => {
  let timer: any;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Limiter toute la lecture, corps JSON compris : recevoir les en-têtes
    ne doit pas laisser l’assistant attendre indéfiniment une page bloquée. */
const fetchLibrary = async (url: string, init: RequestInit): Promise<{ resp: Response; data: any }> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Délai YouTube dépassé', 'AbortError'));
    }, 12000);
  });
  try {
    const read = (async () => {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      return { resp, data: resp.ok ? await resp.json() : null };
    })();
    return await Promise.race([read, deadline]);
  } finally { clearTimeout(timer!); }
};

const decodeEntities = (s: string) =>
  (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<');

/* Les droits demandés, en un seul endroit.
   `drive.appdata` ne donne accès qu'à un dossier caché réservé à cette
   application : ni les fichiers de la personne, ni son Drive visible.
   Google le classe « non sensible » — pas de vérification, pas d'écran
   d'alerte. C'est ce scope qui permet à la synchro d'exister. */
const SCOPE_YOUTUBE =
  'https://www.googleapis.com/auth/youtube ' +
  'https://www.googleapis.com/auth/drive.appdata ' +
  'https://www.googleapis.com/auth/userinfo.profile';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
/* une vidéo vérifiée l'est pour une heure : ni quota, ni clé, mais pas
   besoin de la redemander à chaque morceau du blend non plus */
const jouableCache = new Map<string, { at: number; val: { ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string } }>();
const JOUABLE_TTL = 60 * 60 * 1000;
const TOKEN_KEY = 'soundblend_yt_token';
const TOKEN_EXP_KEY = 'soundblend_yt_token_exp';
const USER_KEY = 'soundblend_yt_user';

/* ── la mémoire des clips : un morceau ne change pas de clip d'une
   écoute à l'autre, et on ne refait pas la recherche à chaque ouverture du
   lecteur. Une heure suffit — et un « pas de clip » se retente plus tard,
   parce que les clips sortent. ── */
const clipCache = new Map<string, { at: number; val: string | null }>();
const clipEnCours = new Map<string, Promise<string | null>>();
const CLIP_TTL = 60 * 60 * 1000;

/* la comparaison de titres : sans accents, sans casse, sans ponctuation —
   « Stomp!" et « stomp » sont le même morceau */
const normaliser = (t: string): string =>
  (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(official|video|clip|hd|hq|version|single|album|feat|ft)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Cache des recherches libres, distinct de celui des morceaux résolus.
const searchCache = new Map<string, string>();
export type PlayableVideo = {
  videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string; verifie?: boolean;
  /** Identité renvoyée par YouTube, à contrôler aussi après résolution. */
  sourceTitle?: string; sourceArtist?: string;
};
const findCache = new Map<string, { at: number; val: PlayableVideo | null }>();
const FIND_TTL = 60 * 60 * 1000;

/** Le titre doit correspondre et, quand la vidéo nomme explicitement un
    artiste ou une chaîne « Topic », celui-ci ne doit pas être différent.
    Une chaîne de label, moins précise, ne suffit pas à conclure. */
export const matchesVideoIdentity = (askedTitle: string, askedArtist: string, videoTitle: string, videoAuthor = ''): boolean => {
  if (!videoTitle.trim() || !matchesAsked(askedTitle, askedArtist, videoTitle, videoAuthor)) return false;
  if (!askedArtist.trim()) return true;
  const namedArtist = cleanTitle(videoTitle).artist || '';
  const topic = /[-–—]\s*topic$/i.test(videoAuthor) ? videoAuthor : '';
  const agrees = (candidate: string) => artistMatches(candidate, askedArtist) || artistMatches(askedArtist, candidate);
  return [namedArtist, topic].filter(Boolean).every(agrees);
};
// Cache playlist tracks
const playlistTracksCache = new Map<string, Track[]>();

declare global {
  interface Window {
    google?: any;
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

export class YouTubeService {
  private accessToken: string | null = null;
  private tokenClient: any = null;

  constructor() {
    this.restoreToken();
  }

  private restoreToken(): void {
    const token = localStorage.getItem(TOKEN_KEY);
    const exp = localStorage.getItem(TOKEN_EXP_KEY);
    if (token && exp) {
      const expTime = parseInt(exp, 10);
      if (Date.now() < expTime) {
        this.accessToken = token;
      } else {
        this.logout();
      }
    }
  }

  public isAuthenticated(): boolean {
    if (!this.accessToken) return false;
    const exp = localStorage.getItem(TOKEN_EXP_KEY);
    if (!exp) return false;
    return Date.now() < parseInt(exp, 10);
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public getUserProfile(): UserProfile | null {
    try {
      const user = localStorage.getItem(USER_KEY);
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  }

  /**
   * Préparer la fenêtre de connexion Google.
   *
   * Le même identifiant de jeton sert à deux choses : lire les playlists
   * YouTube, et ranger un petit fichier de goûts dans l'espace privé du
   * Drive (voir `drive.ts`). Un seul consentement pour les deux.
   */
  public async initOAuth(clientId: string): Promise<void> {
    if (typeof window === 'undefined') return;

    return new Promise((resolve) => {
      const checkGIS = () => {
        if (window.google?.accounts?.oauth2) {
          try {
            this.tokenClient = window.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: SCOPE_YOUTUBE,
              callback: async (resp: any) => {
                if (resp.access_token) {
                  this.accessToken = resp.access_token;
                  const expiresIn = (resp.expires_in || 3600) * 1000;
                  localStorage.setItem(TOKEN_KEY, resp.access_token);
                  localStorage.setItem(TOKEN_EXP_KEY, (Date.now() + expiresIn).toString());

                  // Fetch basic user profile
                  await this.fetchUserProfile(resp.access_token);
                }
              },
            });
            resolve();
          } catch (e) {
            console.warn('GIS initTokenClient warning:', e);
            resolve();
          }
        } else {
          setTimeout(checkGIS, 150);
        }
      };
      checkGIS();
    });
  }

  private async fetchUserProfile(token: string): Promise<UserProfile | null> {
    try {
      const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        const profile: UserProfile = {
          name: data.name || 'Utilisateur YouTube',
          email: data.email || '',
          avatarUrl: data.picture || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
        };
        localStorage.setItem(USER_KEY, JSON.stringify(profile));
        return profile;
      }
    } catch (e) {
      console.warn('Failed to fetch user profile:', e);
    }
    return null;
  }

  /**
   * Ouvrir la fenêtre Google et attendre le consentement.
   */
  public login(clientId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      /* la promesse n'est réglée qu'une fois : soit le jeton arrive, soit
         Google refuse en le disant. Une promesse qui ne se règle jamais
         laisserait l'écran tourner indéfiniment sur « connexion en
         cours » — c'est exactement ce qui arrivait quand la fenêtre
         Google se refermait sans rien renvoyer. */
      let regle = false;
      const reussi = (t: string) => { if (!regle) { regle = true; resolve(t); } };
      const echoue = (e: Error) => { if (!regle) { regle = true; reject(e); } };

      const settings = getStoredSettings();
      const effectiveClientId = clientId || settings.googleClientId;
      if (!window.google?.accounts?.oauth2) {
        echoue(new Error("La fenêtre Google n'est pas encore prête. Vérifie ta connexion, puis réessaie."));
        return;
      }

      if (!effectiveClientId) {
        echoue(new Error("Cette installation n'a pas d'identifiant Google : la connexion ne peut pas s'ouvrir."));
        return;
      }

      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: effectiveClientId,
        scope: SCOPE_YOUTUBE,
        callback: async (resp: any) => {
          if (resp.error) {
            echoue(new Error(resp.error_description || resp.error));
            return;
          }
          if (resp.access_token) {
            this.accessToken = resp.access_token;
            const expiresIn = (resp.expires_in || 3600) * 1000;
            localStorage.setItem(TOKEN_KEY, resp.access_token);
            localStorage.setItem(TOKEN_EXP_KEY, (Date.now() + expiresIn).toString());
            await this.fetchUserProfile(resp.access_token);
            reussi(resp.access_token);
          } else {
            echoue(new Error("Google n'a pas renvoyé de jeton d'accès."));
          }
        },
      });

      /* la fenêtre Google peut aussi être simplement fermée : dans ce
         cas aucun retour n'arrive, et l'écran ne doit pas rester bloqué */
      setTimeout(() => echoue(new Error("La connexion a été interrompue avant la fin. Réessaie.")), 90000);

      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  /* ── le jeton, offert à qui en a besoin ──
     La synchro du Drive passe par ici : elle réclame le jeton seulement
     quand elle en a un usage, et seulement s'il existe. */
  public async jeton(): Promise<string | null> {
    return this.isAuthenticated() ? this.accessToken : null;
  }

  public logout(): void {
    if (this.accessToken && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch (e) {
        console.warn('Revoke token error:', e);
      }
    }
    this.accessToken = null;
    playlistTracksCache.clear();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * Fetch all user playlists via YouTube Data API v3
   */
  public async fetchPlaylists(): Promise<Playlist[]> {
    if (!this.isAuthenticated()) {
      return MOCK_PLAYLISTS;
    }

    const token = this.accessToken;
    try {
      const allPlaylists: Playlist[] = [];
      let nextPageToken = '';
      let pageCount = 0;
      const seenPages = new Set<string>();

      do {
        pageCount++;
        const tokenQuery = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : '';
        const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=50${tokenQuery}`;
        const { resp, data } = await fetchLibrary(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!resp.ok) {
          if (resp.status === 401) {
            if (this.accessToken === token) this.logout();
            throw new Error("Session YouTube expirée. Veuillez vous reconnecter.");
          }
          throw new Error(`Impossible de lire la bibliothèque YouTube (HTTP ${resp.status}). Vérifie les autorisations du compte, puis réessaie.`);
        }

        const pageItems: Playlist[] = (data.items || []).map((item: any) => ({
          id: item.id,
          title: item.snippet.title,
          description: item.snippet.description || 'Playlist YouTube Music',
          thumbnailUrl: item.snippet.thumbnails?.medium?.url ||
                        item.snippet.thumbnails?.default?.url ||
                        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
          trackCount: item.contentDetails?.itemCount || 0,
        }));

        allPlaylists.push(...pageItems);
        if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') {
          throw new Error('Impossible de lire la bibliothèque YouTube en entier : pagination invalide. Réessaie.');
        }
        nextPageToken = data.nextPageToken || '';
        if (nextPageToken && (seenPages.has(nextPageToken) || pageCount >= 150)) {
          throw new Error('Impossible de lire la bibliothèque YouTube en entier : pagination invalide ou trop longue. Réessaie.');
        }
        if (nextPageToken) seenPages.add(nextPageToken);
      } while (nextPageToken);

      if (this.accessToken !== token || !this.isAuthenticated()) throw new Error('La session Google a changé pendant la lecture de la bibliothèque. Reconnecte-toi et réessaie.');
      return allPlaylists;
    } catch (e) {
      console.warn('Impossible de charger les playlists YouTube :', e);
      if (e instanceof Error && /Impossible de lire la bibliothèque|Session YouTube expirée|La session Google/.test(e.message)) throw e;
      throw new Error('Impossible de lire la bibliothèque YouTube. Vérifie la connexion, puis réessaie.');
    }
  }

  /**
   * Fetch ALL tracks from a specific playlist with complete pagination
   */
  public async fetchPlaylistTracks(
    playlistId: string,
    onProgress?: (loaded: number) => void
  ): Promise<Track[]> {
    if (playlistTracksCache.has(playlistId)) {
      return playlistTracksCache.get(playlistId)!;
    }

    const demo = MOCK_PLAYLISTS.find(p => p.id === playlistId);
    if (demo && demo.tracks) {
      return demo.tracks;
    }

    if (!this.isAuthenticated()) {
      throw new Error('Connecte ton compte Google pour lire cette playlist YouTube.');
    }

    const token = this.accessToken;
    try {
      const allTracks: Track[] = [];
      let nextPageToken = '';
      let pageCount = 0;
      const seenPages = new Set<string>();

      do {
        pageCount++;
        const tokenQuery = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : '';
        const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50${tokenQuery}`;

        const { resp, data } = await fetchLibrary(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!resp.ok) {
          // Une page refusée ne doit pas être mémorisée comme playlist vide
          // ou complète : l’assistant doit pouvoir signaler l’échec et réessayer.
          if (resp.status === 401) {
            if (this.accessToken === token) this.logout();
            throw new Error('Session YouTube expirée. Veuillez vous reconnecter.');
          }
          throw new Error(`Impossible de lire la playlist YouTube (page ${pageCount}, HTTP ${resp.status}). Vérifie la connexion et les autorisations, puis réessaie.`);
        }

        const pageTracks: Track[] = (data.items || [])
          .filter((item: any) => item.snippet?.title !== 'Deleted video' && item.snippet?.title !== 'Private video')
          .map((item: any) => {
            const rawTitle = decodeEntities(item.snippet.title || 'Titre inconnu');
            const cleaned = cleanTitle(rawTitle);
            const artist = cleaned.artist
              || decodeEntities(item.snippet.videoOwnerChannelTitle?.replace(' - Topic', '') || 'Artiste inconnu');
            const title = cleaned.title;

            const videoId = item.contentDetails?.videoId || item.snippet.resourceId?.videoId;

            return {
              id: item.id || videoId,
              videoId: videoId,
              title: title,
              artist: artist,
              thumbnailUrl: item.snippet.thumbnails?.medium?.url ||
                            item.snippet.thumbnails?.default?.url ||
                            (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ''),
              durationSeconds: 210,
              durationFormatted: '3:30',
              videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
            };
          });

        allTracks.push(...pageTracks);
        onProgress?.(allTracks.length);
        if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') {
          throw new Error('Impossible de lire la playlist YouTube en entier : pagination invalide. Réessaie.');
        }
        nextPageToken = data.nextPageToken || '';
        if (nextPageToken && (seenPages.has(nextPageToken) || pageCount >= 150)) {
          throw new Error('Impossible de lire la playlist YouTube en entier : pagination invalide ou trop longue. Réessaie.');
        }
        if (nextPageToken) seenPages.add(nextPageToken);
      } while (nextPageToken);

      // Une déconnexion pendant la lecture ne doit pas réintroduire dans
      // le cache les morceaux du compte précédent.
      if (this.accessToken !== token || !this.isAuthenticated()) throw new Error('La session Google a changé pendant la lecture de la playlist. Reconnecte-toi et réessaie.');
      playlistTracksCache.set(playlistId, allTracks);
      return allTracks;
    } catch (e) {
      console.warn('Impossible de lire les morceaux de la playlist :', e);
      if (e instanceof Error && /Impossible de lire la playlist|Session YouTube expirée|La session Google/.test(e.message)) throw e;
      throw new Error('Impossible de lire la playlist YouTube. Vérifie la connexion, puis réessaie.');
    }
  }

  /**
   * L'identifiant d'une vidéo pour un titre donné, ou `null`.
   *
   * `null` est une réponse à part entière : elle dit « ce morceau n'existe
   * pas sur YouTube avec cette clé ». Avant, on renvoyait un identifiant
   * tiré au hasard dans une liste de secours — et on le mettait en cache,
   * si bien que le même titre recevait toujours la même vidéo, sans aucun
   * rapport avec ce qu'on cherchait. C'était le « morceau aléatoire » du
   * remplacement. Un morceau qu'on ne trouve pas n'est pas un morceau :
   * il faut en proposer un autre.
   */
  public async resolveVideoId(title: string, artist: string): Promise<string | null> {
    const found = await this.findPlayable(title, artist);
    return found?.videoId ?? null;
  }

  /**
   * ─────────── réparer un identifiant mort ───────────
   *
   * Le cas de l'auditeur : un blend composé il y a quelques jours, dont
   * une partie des vidéos ne se lit plus — retirées, bloquées, ou
   * réservées. Le lecteur les traversait une par une, en silence.
   *
   * On redemande donc à YouTube le morceau, par son titre et son
   * artiste, et on garde le premier résultat **réellement jouable**.
   * `null` = rien à faire : ce morceau-là ne s'écoute pas ici. On ne
   * remplace jamais par autre chose que le même morceau.
   */
  public async reparerVideoId(title: string, artist: string): Promise<string | null> {
    const found = await this.findPlayable(title, artist).catch(() => null);
    if (!found || isExcluded(found) || isExcluded({
      videoId: found.videoId,
      title: found.sourceTitle || found.title,
      artist: found.sourceArtist || found.artist,
    })) return null;
    return found.videoId;
  }

  /**
   * Cherche un morceau jouable et rend ce qu'on a réellement trouvé :
   * identifiant, titre propre, artiste, durée. Sert au remplacement, qui a
   * besoin de vérifier qu'une proposition existe avant de l'afficher.
   */
  public async findPlayable(
    title: string,
    artist: string,
  ): Promise<PlayableVideo | null> {
    const cacheKey = `find::${artist} - ${title}`.toLowerCase().trim();
    const cached = findCache.get(cacheKey);
    if (cached && Date.now() - cached.at < FIND_TTL) return cached.val ? { ...cached.val } : null;
    const remember = (val: PlayableVideo | null): PlayableVideo | null => {
      // Un réseau muet ou une recherche vide ne doit pas empoisonner les
      // prochains essais ; ne mémoriser qu'une identité confirmée.
      if (val?.verifie) findCache.set(cacheKey, { at: Date.now(), val });
      return val;
    };

    const settings = getStoredSettings();
    const apiKey = settings.youtubeApiKey;

    const fmt = (v: Video) => ({
      videoId: v.videoId,
      title: v.title || title,
      artist: v.artist || artist,
      durationSeconds: v.durationSeconds,
      durationFormatted: v.durationSeconds
        ? `${Math.floor(v.durationSeconds / 60)}:${String(v.durationSeconds % 60).padStart(2, '0')}`
        : undefined,
    });

    /* oEmbed aide à reconnaître le titre et à écarter une vidéo signalée
       comme indisponible. Il ne garantit pas la lecture réelle : les
       restrictions, le pays et le compte restent décidés par YouTube. */
    const jouable = async (v: { videoId: string; title?: string; artist?: string; durationSeconds?: number }) => {
      const test = await this.estJouable(v.videoId).catch(() => null);
      if (test && test.ok === false) {
        console.debug(`[YouTube] ${title} / ${artist} : « ${test.raison} » — écarté`);
        return null;
      }
      if (test?.titre && !matchesVideoIdentity(title, artist, test.titre, test.artiste)) {
        console.debug(`[YouTube] ${title} / ${artist} : identité officielle différente — écarté`);
        return null;
      }
      /* la durée réelle, quand on l'apprend là : le blend compte juste */
      return {
        videoId: v.videoId,
        title: v.title || title,
        artist: v.artist || artist,
        durationSeconds: v.durationSeconds || test?.duree,
        durationFormatted: (v.durationSeconds || test?.duree)
          ? `${Math.floor((v.durationSeconds || test!.duree!) / 60)}:${String((v.durationSeconds || test!.duree!) % 60).padStart(2, '0')}`
          : undefined,
        sourceTitle: test?.titre || undefined,
        sourceArtist: test?.artiste || undefined,
        verifie: test?.ok === true,
      };
    };

    /* ── 1. l'API officielle, avec la clé ou avec le jeton du compte ──
       Google l'écrit noir sur blanc : `key` est « required **unless**
       you provide an OAuth 2.0 token ». Une personne connectée n'a donc
       pas besoin de clé YouTube — c'est ce qui permet de ne plus la
       demander. */
    const jwt = this.isAuthenticated() ? this.accessToken : null;
    if (apiKey || jwt) {
      for (const q of [`${artist} ${title} audio`, `${title} ${artist}`]) {
        try {
          const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(q)}&maxResults=5`
            + (apiKey ? `&key=${apiKey}` : '');
          const resp = await fetch(url, jwt && !apiKey
            ? { headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' } }
            : { headers: { Accept: 'application/json' } });
          if (!resp.ok) {
            console.warn(`Recherche YouTube (clé) : ${resp.status}`);
            break;
          }
          const data = await resp.json();
          /* ── les chaînes « Artiste - Topic » d'abord ──
             C'est le catalogue officiel de YouTube Music : pochette
             propre, durée, et surtout des vidéos **qui s'intègrent
             toujours**. Un clip déposé par un label peut, lui, refuser
             l'iframe. On trie donc avant de choisir, sans changer le
             nombre de requêtes. */
          const items: any[] = (data.items || [])
            .filter((i: any) => i?.id?.videoId)
            .sort((a: any, b: any) =>
              Number(/-\s*Topic$/.test(String(b?.snippet?.videoOwnerChannelTitle || b?.snippet?.channelTitle || '')))
              - Number(/-\s*Topic$/.test(String(a?.snippet?.videoOwnerChannelTitle || a?.snippet?.channelTitle || ''))));
          /* plusieurs résultats : on garde celui qui correspond au titre
             demandé, pas forcément le premier de la liste */
          for (const item of items) {
            const rawTitle = decodeEntities(item.snippet?.title || '');
            const author = decodeEntities(item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || '');
            if (!matchesVideoIdentity(title, artist, rawTitle, author)) continue;
            const cleaned = cleanTitle(rawTitle);
            const cand = {
              videoId: item.id.videoId as string,
              /* le titre demandé reste le titre : YouTube rend souvent
                 « M83 - Quatrieme (Official Audio) », et c'est ce texte-là
                 qui finissait dans le blend au lieu du nom du morceau.
                 On nettoie, mais on préfère le titre demandé quand la
                 vidéo le confirme (matchesAsked ci-dessous le vérifie). */
              title: (cleaned.title && norm(cleaned.title) !== norm(title) ? cleaned.title : title),
              artist: cleaned.artist
                || decodeEntities(item.snippet?.videoOwnerChannelTitle?.replace(' - Topic', '')
                  || item.snippet?.channelTitle?.replace(' - Topic', '')
                  || artist),
            };
            if (matchesAsked(title, artist, cand.title, cand.artist)) {
              const ok = await jouable(cand);
              if (ok) {
                return remember(ok);
              }
            }
          }
        } catch (err) {
          console.warn('Recherche YouTube (clé) impossible :', err);
          break;
        }
      }
    }

    /* ── 2. la même API, avec le jeton du compte ──
       Plus de clé à fournir : Google accepte le jeton à la place. */
    if (this.isAuthenticated()) {
      try {
        const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(`${artist} ${title} audio`)}&maxResults=5`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
        });
        if (resp.ok) {
          const items: any[] = ((await resp.json()).items || []).filter((i: any) => i?.id?.videoId);
          for (const item of items) {
            const rawTitle = decodeEntities(item.snippet?.title || '');
            const author = decodeEntities(item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || '');
            if (!matchesVideoIdentity(title, artist, rawTitle, author)) continue;
            const cleaned = cleanTitle(rawTitle);
            const cand = {
              videoId: item.id.videoId as string,
              title: cleaned.title || title,
              artist: cleaned.artist || author.replace(/\s*-\s*Topic$/i, '') || artist,
            };
            if (matchesAsked(title, artist, cand.title, cand.artist)) {
              const ok = await jouable(cand);
              if (ok) {
                return remember(ok);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Recherche YouTube (jeton) impossible :', err);
      }
    }

    /* ── 2. une instance Piped : le même catalogue, sans clé ──
       C'est la voie qui a manqué jusqu'ici : sans clé YouTube (ou avec
       un quota épuisé), tous les titres proposés par le modèle étaient
       déclarés introuvables, et le blend ne gardait que les piliers.
       On essaie trois formulations, du plus précis au plus large. */
    for (const q of [`${artist} ${title}`, `${title} ${artist}`, title]) {
      const vids = await pipedSearch(q, 'music_songs');
      /* on essaie les candidats dans l'ordre : le premier n'est pas
         toujours le bon, et le bon n'est pas toujours lisible ici */
      // Ne jamais accepter le premier résultat par défaut : il peut être
      // un autre titre ou le même titre d'un artiste clairement différent.
      const hits = vids.filter((v) => matchesVideoIdentity(title, artist, v.title, v.artist));
      for (const hit of hits.slice(0, 4)) {
        const cleaned = cleanTitle(hit.title || title);
        const ok = await jouable({
          videoId: hit.videoId,
          title: cleaned.title || hit.title || title,
          artist: cleaned.artist || hit.artist || artist,
          durationSeconds: hit.durationSeconds,
        });
        if (ok) {
          return remember(ok);
        }
      }
    }

    /* ── 3. dans les listes déjà chargées (1 unité de quota) ──
       Le pont final : une playlist contient déjà les identifiants, on
       n'a qu'à y chercher le titre. C'est ce qui rattrape les morceaux
       que les recherches ne trouvent pas. */
    const fromLists = this.searchLoadedLists(title, artist);
    if (fromLists) {
      const ok = await jouable(fromLists);
      if (ok) {
        return remember(ok);
      }
    }

    return remember(null);
  }

  /**
   * ─────────── le morceau est-il vraiment **jouable** ? ───────────
   *
   * C'est la différence entre « trouvé » et « écoutable ». Une recherche
   * peut rendre un identifiant dont la vidéo est protégée, bloquée dans
   * le pays, retirée, ou réservée à un abonnement : le lecteur intégré
   * n'affichera alors rien du tout, et le morceau sera sauté — c'est
   * exactement ce que montrait la console de l'auditeur, une liste
   * entière traversée sans qu'une seule note ne sorte.
   *
   * Le contrôle utilisable ici est `oembed` : il renseigne le titre et
   * la chaîne, et peut signaler une vidéo supprimée ou privée. Il ne dit
   * pas si elle sera effectivement lisible dans ce pays ou ce compte.
   * `null` = on ne sait pas (réseau muet, page illisible) ; seul un refus
   * clair est écarté. Les réponses concluantes sont mises en cache une
   * heure, pas les échecs réseau temporaires.
   */
  public async estJouable(videoId: string): Promise<{
    ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string;
  }> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return { ok: false, raison: 'identifiant invalide' };
    const memo = jouableCache.get(videoId);
    if (memo && Date.now() < memo.at) return memo.val;

    /* ── le seul juge utilisable depuis un navigateur : oembed ──
       `youtubei/v1/player` (la page publique du lecteur) dirait tout —
       statut de lecture, blocage pays, refus d'intégration — mais il
       répond 403 à un navigateur et n'envoie aucun en-tête CORS : c'est
       une voie morte, on ne la prend pas. `oembed`, lui, répond avec
       CORS, sans clé et sans quota : une réponse 200 fournit l'identité,
       tandis qu'un 400/401/404 peut signaler une vidéo inaccessible.
       Même avec 200, la lecture intégrée peut échouer pour d'autres raisons.
       403/5xx/réseau muet = on ne sait pas : on ne condamne pas. */
    const meta = await verifyVideo(videoId).catch(() => null);
    const val: { ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string } = meta
      ? (meta.jouable === false
        ? { ok: false, raison: 'vidéo retirée, privée, ou intégration refusée' }
        : { ok: true, raison: '', titre: meta.title, artiste: meta.author })
      : { ok: null, raison: 'vérification impossible' };

    // Un réseau muet est un état temporaire, pas un avis d'une heure.
    if (val.ok !== null) jouableCache.set(videoId, { at: Date.now() + JOUABLE_TTL, val });
    return val;
  }

  /**
   * ─────────── un VRAI clip, pour l'image ───────────
   *
   * Beaucoup de morceaux de la file pointent vers une vidéo « audio » (la
   * piste seule, une pochette fixe, publiée par un compte « - Topic »).
   * Pour écouter, c'est parfait ; pour *regarder*, c'est une image
   * immobile. On cherche donc, une fois par morceau et seulement quand on
   * le demande, une vidéo qui montre quelque chose :
   *
   *   1. une recherche « artiste titre official video », sans clé ;
   *   2. on écarte tout ce qui est un « Topic », un « audio », un
   *      « lyrics », un concert d'une heure ou une version accélérée ;
   *   3. on exige que le titre et l'artiste se retrouvent dans le
   *      résultat — on ne remplace pas un morceau par un autre ;
   *   4. `oembed` confirme qu'elle existe et accepte l'intégration.
   *
   * `null` veut dire « pas de clip connu » — et ce n'est pas une erreur :
   * on gardera alors la pochette, sans jamais rien inventer.
   */
  public async trouverClip(track: { title: string; artist: string; videoId: string; durationSeconds?: number }): Promise<string | null> {
    /* la clé comprend l'identifiant : deux morceaux homonymes (une version
       studio, un live) ne doivent pas se partager la même réponse */
    const cle = `${track.videoId}::${track.artist}::${track.title}`.toLowerCase();
    const memo = clipCache.get(cle);
    if (memo && Date.now() < memo.at) return memo.val;
    if (clipEnCours.has(cle)) return clipEnCours.get(cle)!;

    const travail = (async (): Promise<string | null> => {
      /* la vidéo d'origine est peut-être déjà un clip : on regarde ce que
         YouTube dit d'elle avant de chercher ailleurs */
      const propre = await verifyVideo(track.videoId).catch(() => null);
      const nomPropre = `${propre?.author || ''}`.toLowerCase();
      const dejaUnClip = !!propre?.ok && !!nomPropre && !/topic|vevo\s*-?\s*topic/.test(nomPropre);

      const requete = `${track.artist} ${track.title} official video`;
      const vus: Video[] = [];
      try {
        const api = await this.searchTracks(requete, 8);
        for (const t of api.tracks) {
          if (t.videoId) vus.push({ videoId: t.videoId, title: t.title, artist: t.artist });
        }
      } catch { /* la recherche du compte peut manquer : Piped prend la suite */ }
      if (!vus.length) {
        const p = await pipedSearch(requete, 'music_songs').catch(() => []);
        vus.push(...p);
      }

      const mots = normaliser(track.title);
      const artiste = normaliser(track.artist);
      const mauvais = /\b(audio|lyrics?|paroles|topic|instrumental|karaoke|reaction|cover|live|concert|remix|sped up|slowed|nightcore)\b/;
      /* la longueur : un clip qui dure 30 s ou 1 h 20 n'est pas la même
         chanson — et, surtout, il déplacerait la barre de progression.
         On exige donc une durée comparable quand on la connaît. */
      const duree = track.durationSeconds || 0;
      const dureeOk = (d?: number) => !duree || !d || Math.abs(d - duree) <= Math.max(25, duree * 0.22);

      for (const v of vus) {
        if (!v.videoId || v.videoId === track.videoId) continue;
        const titre = normaliser(v.title);
        const auteur = normaliser(v.artist);
        if (mauvais.test(titre) || mauvais.test(auteur)) continue;
        /* le titre du morceau doit se retrouver dans le résultat, et
           l'artiste aussi : sinon c'est une autre chanson */
        if (!titre.includes(mots) && !mots.includes(titre.slice(0, Math.max(4, mots.length)))) continue;
        if (artiste && !titre.includes(artiste) && !auteur.includes(artiste)) continue;
        if (!dureeOk(v.durationSeconds)) continue;
        /* `oembed` tranche : intégration acceptée, ou rien */
        const ok = await verifyVideo(v.videoId).catch(() => null);
        if (ok?.ok && ok.jouable !== false) return v.videoId;
      }

      /* ═══ ce qui ne compte PAS comme un clip ═══
         Avant, on rendait `candidat` même quand `oembed` n'avait pas
         confirmé : un identifiant jamais vérifié devenait « le clip » du
         morceau. C'est exactement ce qui affichait une vidéo sans rapport.
         Désormais : pas de confirmation, pas de clip. */
      /* et si la vidéo qu'on écoute est DÉJÀ un clip (un vrai compte
         d'artiste, pas un « - Topic »), on la renvoie telle quelle */
      if (dejaUnClip && propre?.ok) return track.videoId;
      return null;
    })();

    clipEnCours.set(cle, travail);
    try {
      const val = await travail;
      clipCache.set(cle, { at: Date.now() + CLIP_TTL, val });
      return val;
    } finally {
      clipEnCours.delete(cle);
    }
  }

  /**
   * Cherche un morceau dans les listes de lecture **déjà en mémoire**
   * (aucun appel réseau, aucun quota). Sert de dernier recours, et de
   * premier recours quand la clé YouTube manque.
   */
  public searchLoadedLists(title: string, artist: string): { videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string; verifie?: boolean } | null {
    for (const tracks of playlistTracksCache.values()) {
      for (const t of tracks) {
        if (!t.videoId) continue;
        if (matchesAsked(title, artist, t.title, t.artist)
          && (!artist || artistMatches(t.artist, artist) || artistMatches(artist, t.artist))) {
          return {
            videoId: t.videoId,
            title: t.title,
            artist: t.artist,
            durationSeconds: t.durationSeconds,
            durationFormatted: t.durationFormatted,
            verifie: true,
          };
        }
      }
    }
    return null;
  }

  /**
   * Recherche libre dans le catalogue YouTube (hors playlists de l'utilisateur).
   * Utilise la clé API si elle existe, sinon le jeton OAuth de la session.
   * Coût : 100 unités de quota par appel → mise en cache.
   */
  public async searchTracks(query: string, maxResults = 20): Promise<{ tracks: Track[]; error: string | null }> {
    const q = query.trim();
    if (q.length < 2) return { tracks: [], error: null };

    const cacheKey = `search::${q.toLowerCase()}`;
    if (searchCache.has(cacheKey)) {
      try { return { tracks: JSON.parse(searchCache.get(cacheKey)!) as Track[], error: null }; } catch { /* ignore */ }
    }

    const settings = getStoredSettings();
    const apiKey = settings.youtubeApiKey;
    const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=${maxResults}&q=${encodeURIComponent(q)}`;

    const parse = (data: any): Track[] =>
      (data.items || [])
        .map((item: any) => {
          const videoId = item.id?.videoId;
          if (!videoId) return null;
          const rawTitle = decodeEntities(item.snippet?.title || 'Titre inconnu');
          /* « Lomepal - Evidemment (lyrics video) » devient « Evidemment » */
          const cleaned = cleanTitle(rawTitle);
          let artist = cleaned.artist
            || decodeEntities(item.snippet?.videoOwnerChannelTitle?.replace(' - Topic', '')
              || item.snippet?.channelTitle?.replace(' - Topic', '')
              || 'Artiste inconnu');
          let title = cleaned.title;
          return {
            id: `yt-${videoId}`,
            videoId,
            title,
            artist,
            thumbnailUrl: item.snippet?.thumbnails?.medium?.url ||
                          item.snippet?.thumbnails?.default?.url ||
                          `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            durationSeconds: 0, // inconnu tant que la vidéo n'a pas été lue
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          } as Track;
        })
        .filter(Boolean) as Track[];

    let lastError: string | null = null;
    try {
      if (apiKey) {
        const resp = await fetch(`${url}&key=${apiKey}`, { headers: { Accept: 'application/json' } });
        if (resp.ok) {
          const tracks = parse(await resp.json());
          searchCache.set(cacheKey, JSON.stringify(tracks));
          return { tracks, error: null };
        }
        lastError = resp.status === 403
          ? 'La clé YouTube refuse cette adresse (restriction de référent) ou le quota est épuisé.'
          : `YouTube a répondu ${resp.status}.`;
      }
      if (this.isAuthenticated()) {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
        });
        if (resp.ok) {
          const tracks = parse(await resp.json());
          searchCache.set(cacheKey, JSON.stringify(tracks));
          return { tracks, error: null };
        }
        if (!lastError) lastError = `YouTube a répondu ${resp.status} pour cette recherche.`;
      }
      if (!apiKey && !this.isAuthenticated()) {
        lastError = 'Recherche YouTube indisponible : connecte ton compte Google (Réglages → Compte YouTube).';
      }
    } catch (e) {
      console.warn('YouTube search failed:', e);
      lastError = 'Recherche impossible : le réseau a bloqué la requête.';
    }
    return { tracks: [], error: lastError };
  }

  /**
   * Create a new YouTube playlist
   */
  public async createPlaylist(title: string, description: string, isPrivate: boolean = true): Promise<string> {
    if (!this.isAuthenticated()) {
      return 'mock-created-pl-' + Date.now();
    }

    const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,status`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
        },
        status: {
          privacyStatus: isPrivate ? 'private' : 'public',
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error?.message || "Impossible de créer la playlist sur YouTube");
    }

    const data = await resp.json();
    return data.id;
  }

  /**
   * Renommer une playlist, et/ou changer sa visibilité.
   *
   * YouTube ne sépare pas les deux : la même requête `playlists.update`
   * porte le titre (snippet) et la confidentialité (status). On envoie
   * donc les deux à chaque fois — c'est aussi ce qui garantit qu'un
   * renommage ne rend pas publique une playlist privée par accident.
   */
  public async updatePlaylistMeta(
    playlistId: string,
    meta: { title: string; privacy?: 'private' | 'public'; description?: string },
  ): Promise<boolean> {
    if (!this.isAuthenticated() || playlistId.startsWith('mock-')) return false;
    const body: any = { id: playlistId, snippet: { title: meta.title } };
    if (meta.description) body.snippet.description = meta.description;
    if (meta.privacy) body.status = { privacyStatus: meta.privacy };

    const resp = await fetch(`${YOUTUBE_API_BASE}/playlists?part=snippet,status`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.warn('updatePlaylistMeta a échoué', await resp.text());
      return false;
    }
    return true;
  }

  /**
   * Add tracks to a playlist
   */
  public async addTracksToPlaylist(
    playlistId: string,
    tracks: Track[],
    onProgress?: (index: number, total: number) => void
  ): Promise<void> {
    if (!this.isAuthenticated() || playlistId.startsWith('mock-')) {
      for (let i = 0; i < tracks.length; i++) {
        await new Promise((r) => setTimeout(r, 120));
        onProgress?.(i + 1, tracks.length);
      }
      return;
    }

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      let videoId = track.videoId;

      if (!videoId) {
        const resolved = await this.resolveVideoId(track.title, track.artist);
        /* introuvable : on saute ce morceau plutôt que d'envoyer une vidéo
           qui n'a rien à voir dans la playlist de l'utilisateur */
        if (!resolved) { onProgress?.(i + 1, tracks.length); continue; }
        videoId = resolved;
      }

      const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            playlistId: playlistId,
            resourceId: {
              kind: 'youtube#video',
              videoId: videoId,
            },
          },
        }),
      });

      if (!resp.ok) {
        console.warn(`Failed to add track ${track.title} to playlist:`, await resp.text());
      }

      onProgress?.(i + 1, tracks.length);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Les morceaux actuellement dans une playlist distante (pour la comparer). */
  public async getPlaylistItems(playlistId: string): Promise<{ itemId: string; videoId: string }[]> {
    if (!this.isAuthenticated() || playlistId.startsWith('mock-')) return [];
    const out: { itemId: string; videoId: string }[] = [];
    let pageToken = '';
    for (let page = 0; page < 4; page++) {
      const url = `${YOUTUBE_API_BASE}/playlistItems?part=id,snippet&playlistId=${playlistId}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
      if (!resp.ok) break;
      const data = await resp.json();
      (data.items || []).forEach((it: any) => {
        const vid = it?.snippet?.resourceId?.videoId;
        if (vid) out.push({ itemId: it.id, videoId: vid });
      });
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
    return out;
  }

  public async removePlaylistItem(itemId: string): Promise<boolean> {
    if (!this.isAuthenticated()) return false;
    const resp = await fetch(`${YOUTUBE_API_BASE}/playlistItems?id=${itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    return resp.ok;
  }

  /**
   * Remet une playlist distante au diapason du blend — contenu ET ordre.
   *
   * · un morceau ajouté dans le blend est ajouté à la playlist ;
   * · un morceau retiré est retiré ;
   * · un morceau déplacé est déplacé.
   *
   * YouTube n'a pas de « déplacer » : pour réordonner, on retire l'élément
   * puis on le réinsère à son rang (position 0, 1, 2…). Les identifiants
   * d'éléments changeant à chaque mutation, on relit la playlist avant
   * chaque geste : un identifiant périmé supprimerait le mauvais morceau.
   */
  public async syncPlaylist(
    playlistId: string,
    tracks: Track[],
    onProgress?: (message: string, pct: number) => void,
  ): Promise<{ added: number; removed: number; moved: number }> {
    /* la cible : les morceaux du blend, dans l'ordre, sans doublon */
    const target: string[] = [];
    const seen = new Set<string>();
    tracks.forEach((t) => {
      if (!t.videoId || seen.has(t.videoId)) return;
      seen.add(t.videoId);
      target.push(t.videoId);
    });

    /* 1. les morceaux qui ne sont plus voulus partent d'abord */
    let removed = 0;
    const initial = await this.getPlaylistItems(playlistId);
    const toRemove = initial.filter((c) => !seen.has(c.videoId));
    for (let i = 0; i < toRemove.length; i++) {
      if (await this.removePlaylistItem(toRemove[i].itemId)) removed++;
      onProgress?.('Retrait des morceaux qui ne sont plus dans le blend…', Math.round(((i + 1) / Math.max(1, toRemove.length + target.length)) * 100));
      await new Promise((r) => setTimeout(r, 150));
    }

    /* 2. on replace chaque morceau à son rang, en relisant l'état courant */
    let added = 0;
    let moved = 0;
    for (let i = 0; i < target.length; i++) {
      const want = target[i];
      const list = await this.getPlaylistItems(playlistId);
      const ids = list.map((x) => x.videoId);
      if (ids[i] === want) continue;                    // déjà à sa place

      const at = ids.indexOf(want);
      if (at >= 0) {
        await this.removePlaylistItem(list[at].itemId);  // présent mais ailleurs
        moved++;
      } else {
        added++;                                         // absent
      }
      await this.insertPlaylistItem(playlistId, want, i);
      onProgress?.('Mise à jour de la playlist YouTube Music…', Math.round(((i + 1) / Math.max(1, target.length)) * 100));
      await new Promise((r) => setTimeout(r, 120));
    }

    return { added, removed, moved };
  }

  /** Insère un morceau à une position précise ; renvoie l'élément créé. */
  private async insertPlaylistItem(playlistId: string, videoId: string, position: number): Promise<string | null> {
    if (!this.isAuthenticated()) return null;
    const resp = await fetch(`${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          playlistId,
          position,
          resourceId: { kind: 'youtube#video', videoId },
        },
      }),
    });
    if (!resp.ok) {
      console.warn('insertPlaylistItem a échoué', await resp.text());
      return null;
    }
    const data = await resp.json();
    return data?.id ?? null;
  }
}

export const youtubeService = new YouTubeService();

