import { Playlist, Track, UserProfile } from '../types';
import { MOCK_PLAYLISTS } from '../data/mockData';
import { getStoredSettings } from './storage';
import { cleanTitle, matchesAsked } from '../lib/track';
import type { Video } from './search';
import { pipedSearch } from './search';

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
   * Cherche un morceau jouable et rend ce qu'on a réellement trouvé :
   * identifiant, titre propre, artiste, durée. Sert au remplacement, qui a
   * besoin de vérifier qu'une proposition existe avant de l'afficher.
   */
  public async findPlayable(
    title: string,
    artist: string,
  ): Promise<{ videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string } | null> {
    const cacheKey = `find::${artist} - ${title}`.toLowerCase().trim();
    const cached = searchCache.get(cacheKey);
    if (cached !== undefined) {
      if (!cached) return null;
      return { videoId: cached, title, artist };
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
          const items: any[] = (data.items || []).filter((i: any) => i?.id?.videoId);
          /* plusieurs résultats : on garde celui qui correspond au titre
             demandé, pas forcément le premier de la liste */
          for (const item of items) {
            const rawTitle = decodeEntities(item.snippet?.title || title);
            const cleaned = cleanTitle(rawTitle);
            const cand = {
              videoId: item.id.videoId as string,
              title: cleaned.title || title,
              artist: cleaned.artist
                || decodeEntities(item.snippet?.videoOwnerChannelTitle?.replace(' - Topic', '')
                  || item.snippet?.channelTitle?.replace(' - Topic', '')
                  || artist),
            };
            if (matchesAsked(title, artist, cand.title, cand.artist)) {
              searchCache.set(cacheKey, cand.videoId);
              return cand;
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
              searchCache.set(cacheKey, cand.videoId);
              return cand;
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
      const hit = vids.find((v) => matchesAsked(title, artist, v.title, v.artist))
        || (q === title ? vids[0] : undefined);
      if (hit) {
        const cleaned = cleanTitle(hit.title || title);
        const out = {
          videoId: hit.videoId,
          title: cleaned.title || hit.title || title,
          artist: cleaned.artist || hit.artist || artist,
          durationSeconds: hit.durationSeconds,
          durationFormatted: hit.durationSeconds
            ? `${Math.floor(hit.durationSeconds / 60)}:${String(hit.durationSeconds % 60).padStart(2, '0')}`
            : undefined,
        };
        searchCache.set(cacheKey, out.videoId);
        return out;
      }
    }

    /* ── 3. dans les listes déjà chargées (1 unité de quota) ──
       Le pont final : une playlist contient déjà les identifiants, on
       n'a qu'à y chercher le titre. C'est ce qui rattrape les morceaux
       que les recherches ne trouvent pas. */
    const fromLists = this.searchLoadedLists(title, artist);
    if (fromLists) {
      searchCache.set(cacheKey, fromLists.videoId);
      return fromLists;
    }

    searchCache.set(cacheKey, '');
    return null;
  }

  /**
   * Cherche un morceau dans les listes de lecture **déjà en mémoire**
   * (aucun appel réseau, aucun quota). Sert de dernier recours, et de
   * premier recours quand la clé YouTube manque.
   */
  public searchLoadedLists(title: string, artist: string): { videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string } | null {
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
