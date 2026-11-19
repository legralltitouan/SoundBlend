import { accountRevision, assertAccountRevision } from './accountScope';
import { getStoredSettings } from './storage';
import { youtubeService } from './youtube';
import { cleanTitle } from '../lib/track';
import type { Track } from '../types';

export type AssistantMention =
  | { kind: 'track'; id: string; title: string; artist: string; channelId: string; channelTitle: string; youtubeTitle: string; thumbnailUrl: string }
  | { kind: 'artist'; id: string; title: string; thumbnailUrl: string };
export const MAX_ASSISTANT_MENTIONS = 8;
export const mentionKey = (mention: AssistantMention) => `${mention.kind}:${mention.id}`;
// Une délimitation explicite permet de supprimer le texte d'une mention sans
// perdre les autres, y compris deux titres homonymes d'artistes différents.
export const mentionToken = (mention: AssistantMention) => mention.kind === 'artist'
  ? `@«${mention.title}»` : `#«${mention.title} · ${mention.artist}»`;
export const mentionUrl = (mention: AssistantMention) => mention.kind === 'artist'
  ? `https://www.youtube.com/channel/${encodeURIComponent(mention.id)}` : `https://www.youtube.com/watch?v=${encodeURIComponent(mention.id)}`;
export const mentionTrack = (mention: AssistantMention): Track | null => mention.kind === 'track' ? {
  id: `yt-${mention.id}`, videoId: mention.id, title: mention.title, artist: mention.artist,
  thumbnailUrl: mention.thumbnailUrl, durationSeconds: 0, videoUrl: mentionUrl(mention),
  // Les noms bruts restent disponibles pour le contrôle des exclusions.
  ...{ youtubeTitle: mention.youtubeTitle, youtubeChannel: mention.channelTitle },
} : null;
export const compactMention = (mention: AssistantMention) => mention.kind === 'artist'
  ? { type: 'chaine_artiste', channelId: mention.id, nom: mention.title, mention: mentionToken(mention) }
  : { type: 'morceau', videoId: mention.id, titre: mention.title, artiste: mention.artist,
    channelId: mention.channelId, chaine: mention.channelTitle, titreYouTube: mention.youtubeTitle, mention: mentionToken(mention) };
const decode = (value: unknown) => String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 200);
const thumbnail = (value: unknown) => {
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(url.hostname) ? url.href : ''; } catch { return ''; }
};

/** Recherche déclenchée uniquement par une validation explicite dans la modal.
 * Aucune réponse en cache persistant, écriture YouTube ou génération Gemini. */
export async function searchAssistantMentions(query: string, kind: AssistantMention['kind'], signal?: AbortSignal): Promise<AssistantMention[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 180) throw new Error('Saisis entre 2 et 180 caractères.');
  const revision = accountRevision(), serial = youtubeService.sessionRevision();
  const token = youtubeService.getAccessToken(), key = getStoredSettings().youtubeApiKey?.trim();
  if (!token && !key) throw new Error('Connecte ton compte Google ou ajoute ta clé API YouTube dans les réglages pour rechercher.');
  const controller = new AbortController(); const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
  const guard = () => {
    assertAccountRevision(revision);
    if (serial !== youtubeService.sessionRevision()) throw new Error('Le compte a changé pendant la recherche.');
    if (controller.signal.aborted) throw new DOMException('Recherche interrompue', 'AbortError');
  };
  try {
    guard();
    const params = new URLSearchParams({ part: 'snippet', type: kind === 'artist' ? 'channel' : 'video', maxResults: '12', q });
    if (kind === 'track') params.set('videoCategoryId', '10');
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      signal: controller.signal, headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { 'x-goog-api-key': key! }) },
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    guard();
    if (response.status === 401) { if (token) youtubeService.invalidateToken(token); throw new Error('Session YouTube expirée. Reconnecte ton compte Google dans les réglages.'); }
    if (response.status === 403 || response.status === 429) throw new Error('Recherche refusée par YouTube : vérifie les quotas et les droits du compte ou de la clé API.');
    if (!response.ok) throw new Error(`YouTube est indisponible (HTTP ${response.status}). Réessaie plus tard.`);
    const data = await response.json(); guard();
    if (!Array.isArray(data?.items)) throw new Error('La réponse de YouTube est illisible.');
    const seen = new Set<string>();
    return data.items.slice(0, 30).flatMap((item: any): AssistantMention[] => {
      const id = kind === 'artist' ? item?.id?.channelId : item?.id?.videoId;
      if (typeof id !== 'string' || !(kind === 'artist' ? /^UC[A-Za-z0-9_-]{22}$/ : /^[A-Za-z0-9_-]{11}$/).test(id) || seen.has(id)) return [];
      const title = decode(item.snippet?.title); if (!title.trim()) return [];
      seen.add(id);
      const thumbnailUrl = thumbnail(item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url);
      if (kind === 'artist') return [{ kind, id, title, thumbnailUrl }];
      const channelTitle = decode(item.snippet?.channelTitle), cleaned = cleanTitle(title);
      return [{ kind, id, title: cleaned.title || title, artist: cleaned.artist || channelTitle.replace(/\s*-\s*Topic$/i, '') || 'Artiste non renseigné',
        channelId: /^UC[A-Za-z0-9_-]{22}$/.test(item.snippet?.channelId) ? item.snippet.channelId : '', channelTitle, youtubeTitle: title, thumbnailUrl }];
    });
  } catch (error) {
    if (timedOut) throw new Error('La recherche YouTube a dépassé le délai. Réessaie.');
    if (signal?.aborted) throw new DOMException('Recherche interrompue', 'AbortError');
    if (error instanceof TypeError) throw new Error('Impossible de joindre YouTube. Vérifie ta connexion.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
