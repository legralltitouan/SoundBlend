import { Playlist, Track, UserProfile } from '../types';
import { MOCK_PLAYLISTS } from '../data/mockData';
import { getStoredSettings } from './storage';
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

const decodeEntities = (s: string) =>
  (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
/* une vidéo vérifiée l'est pour une heure : ni quota, ni clé, mais pas
   besoin de la redemander à chaque morceau du blend non plus */
const jouableCache = new Map<string, { at: number; val: { ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string } }>();
const JOUABLE_TTL = 60 * 60 * 1000;
const TOKEN_KEY = 'soundblend_yt_token';
const TOKEN_EXP_KEY = 'soundblend_yt_token_exp';
const USER_KEY = 'soundblend_yt_user';

// Cache search queries to prevent burning YouTube API quota (100 units per search)
const searchCache = new Map<string, string>();
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
   * Initialize Google Identity Services OAuth Token Client
   */
  public async initOAuth(clientId: string): Promise<void> {
    if (typeof window === 'undefined') return;

    return new Promise((resolve) => {
      const checkGIS = () => {
        if (window.google?.accounts?.oauth2) {
          try {
            this.tokenClient = window.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/userinfo.profile',
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
   * Request user login with Google popup
   */
  public login(clientId?: string): Promise<string> {
    const settings = getStoredSettings();
    const effectiveClientId = clientId || settings.googleClientId;

    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error("Le script Google Identity Services n'est pas encore prêt. Vérifiez votre connexion."));
        return;
      }

      if (!effectiveClientId) {
        reject(new Error("Veuillez renseigner votre Google Client ID dans les Réglages."));
        return;
      }

      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: effectiveClientId,
        scope: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/userinfo.profile',
        callback: async (resp: any) => {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          if (resp.access_token) {
            this.accessToken = resp.access_token;
            const expiresIn = (resp.expires_in || 3600) * 1000;
            localStorage.setItem(TOKEN_KEY, resp.access_token);
            localStorage.setItem(TOKEN_EXP_KEY, (Date.now() + expiresIn).toString());
            await this.fetchUserProfile(resp.access_token);
            resolve(resp.access_token);
          } else {
            reject(new Error("Aucun jeton d'accès n'a été retourné par Google."));
          }
        },
      });

      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
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

    try {
      const allPlaylists: Playlist[] = [];
      let nextPageToken = '';

      do {
        const tokenQuery = nextPageToken ? `&pageToken=${nextPageToken}` : '';
        const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=50${tokenQuery}`;
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!resp.ok) {
          if (resp.status === 401) {
            this.logout();
            throw new Error("Session YouTube expirée. Veuillez vous reconnecter.");
          }
          const err = await resp.json();
          throw new Error(err.error?.message || "Erreur lors de la récupération des playlists");
        }

        const data = await resp.json();
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
        nextPageToken = data.nextPageToken || '';
      } while (nextPageToken && allPlaylists.length < 150);

      return allPlaylists;
    } catch (e) {
      console.warn("YouTube API error, fallback to mock data:", e);
      return MOCK_PLAYLISTS;
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
      return demo?.tracks || [];
    }

    try {
      const allTracks: Track[] = [];
      let nextPageToken = '';
      let pageCount = 0;

      do {
        pageCount++;
        const tokenQuery = nextPageToken ? `&pageToken=${nextPageToken}` : '';
        const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=50${tokenQuery}`;
        
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!resp.ok) {
          console.warn(`Error on page ${pageCount} of playlist ${playlistId}:`, await resp.text());
          break;
        }

        const data = await resp.json();
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
        nextPageToken = data.nextPageToken || '';
      } while (nextPageToken && allTracks.length < 500);

      playlistTracksCache.set(playlistId, allTracks);
      return allTracks;
    } catch (e) {
      console.warn("Error fetching playlist tracks with pagination:", e);
      return [];
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
    return found?.videoId ?? null;
  }

  /**
   * Cherche un morceau jouable et rend ce qu'on a réellement trouvé :
   * identifiant, titre propre, artiste, durée. Sert au remplacement, qui a
   * besoin de vérifier qu'une proposition existe avant de l'afficher.
   */
  public async findPlayable(
    title: string,
    artist: string,
  ): Promise<{ videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string; verifie?: boolean } | null> {
    const cacheKey = `find::${artist} - ${title}`.toLowerCase().trim();
    const cached = searchCache.get(cacheKey);
    if (cached !== undefined) {
      if (!cached) return null;
      return { videoId: cached, title, artist, verifie: true };
    }

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

    /* ── le dernier verrou : le morceau se lit-il vraiment ? ──
       Un identifiant trouvé n'est pas un morceau écoutable. Avant de le
       rendre, on demande au lecteur — sans clé, sans quota — s'il peut
       jouer cette vidéo depuis ce pays. Une réponse claire « non » (vidéo
       réservée, bloquée, retirée, direct) écarte le candidat et on
       cherche le suivant. C'est ce qui remplit la file du lecteur de
       morceaux qui sonnent au lieu de morceaux qu'on saute. */
    const jouable = async (v: { videoId: string; title?: string; artist?: string; durationSeconds?: number }) => {
      const test = await this.estJouable(v.videoId).catch(() => null);
      if (test && test.ok === false) {
        console.debug(`[YouTube] ${title} / ${artist} : « ${test.raison} » — écarté`);
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
        verifie: true,
      };
    };

    /* ── 1. l'API officielle, avec la clé ──
       C'est la voie normale. On ne la tente que s'il y a une clé. */
    if (apiKey) {
      for (const q of [`${artist} ${title} audio`, `${title} ${artist}`]) {
        try {
          const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(q)}&maxResults=5&key=${apiKey}`;
          const resp = await fetch(url, { headers: { Accept: 'application/json' } });
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
            const rawTitle = decodeEntities(item.snippet?.title || title);
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
                searchCache.set(cacheKey, ok.videoId);
                return ok;
              }
            }
          }
        } catch (err) {
          console.warn('Recherche YouTube (clé) impossible :', err);
          break;
        }
      }
    }

    if (this.isAuthenticated()) {
      try {
        const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(`${artist} ${title} audio`)}&maxResults=5`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
        });
        if (resp.ok) {
          const items: any[] = ((await resp.json()).items || []).filter((i: any) => i?.id?.videoId);
          for (const item of items) {
            const cleaned = cleanTitle(decodeEntities(item.snippet?.title || title));
            const cand = {
              videoId: item.id.videoId as string,
              title: cleaned.title || title,
              artist: cleaned.artist || artist,
            };
            if (matchesAsked(title, artist, cand.title, cand.artist)) {
              const ok = await jouable(cand);
              if (ok) {
                searchCache.set(cacheKey, ok.videoId);
                return ok;
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
      const hits = [
        ...vids.filter((v) => matchesAsked(title, artist, v.title, v.artist)),
        ...(q === title && vids[0] ? [vids[0]] : []),
      ];
      for (const hit of hits.slice(0, 4)) {
        const cleaned = cleanTitle(hit.title || title);
        const ok = await jouable({
          videoId: hit.videoId,
          title: cleaned.title || hit.title || title,
          artist: cleaned.artist || hit.artist || artist,
          durationSeconds: hit.durationSeconds,
        });
        if (ok) {
          searchCache.set(cacheKey, ok.videoId);
          return ok;
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
        searchCache.set(cacheKey, ok.videoId);
        return ok;
      }
    }

    searchCache.set(cacheKey, '');
    return null;
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
   * Deux contrôles, sans clé et sans quota :
   *   1. `oembed` dit que la vidéo existe et *peut être intégrée* ;
   *   2. `player` (la page publique de YouTube) dit si elle est lisible
   *      depuis ce pays : `playabilityStatus.status !== 'OK'` → le
   *      lecteur affichera un message, pas de la musique.
   *
   * `null` = on ne sait pas (réseau muet, page illisible). On ne jette
   * jamais un morceau sur un doute : seule une réponse claire « non »
   * l'écarte. Les deux réponses sont mises en cache une heure : une
   * vidéo qui bloque aujourd'hui ne bloquera pas forcément demain, mais
   * pas besoin de la redemander vingt fois pendant un blend.
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
       CORS, sans clé et sans quota, et rend exactement ce qui nous
       intéresse : 200 = la vidéo existe **et** accepte l'intégration
       (c'est sa raison d'être) ; 400/401/404 = elle a disparu, elle est
       privée, ou son propriétaire refuse l'iframe — dans les trois cas
       notre lecteur affichera un cadre vide.
       403/5xx/réseau muet = on ne sait pas : on ne condamne pas. */
    const meta = await verifyVideo(videoId).catch(() => null);
    const val: { ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string } = meta
      ? (meta.jouable === false
        ? { ok: false, raison: 'vidéo retirée, privée, ou intégration refusée' }
        : { ok: true, raison: '', titre: meta.title, artiste: meta.author })
      : { ok: null, raison: 'vérification impossible' };

    jouableCache.set(videoId, { at: Date.now() + JOUABLE_TTL, val });
    return val;
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
        if (matchesAsked(title, artist, t.title, t.artist)) {
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
        lastError = 'Recherche indisponible : ajoute une clé API YouTube dans Réglages → Clés & API.';
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
