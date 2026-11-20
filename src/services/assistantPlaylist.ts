import type { Playlist, Track } from '../types';
import { accountRevision, assertAccountRevision } from './accountScope';
import { isExcluded } from './storage';
import { cleanTitle, norm } from '../lib/track';
import { isAssistantTrackExcluded, matchesVideoIdentity, youtubeService, type AssistantCatalogTrack, type PlaylistMove, type PlaylistSnapshotItem } from './youtube';

/** Une écriture YouTube mérite un filtre plus strict que les suggestions de
    découverte : titre nettoyé identique et pas de version alternative non
    demandée. L'utilisateur doit encore vérifier la vidéo dans l'aperçu. */
export const matchesAddition = (title: string, artist: string, hit: AssistantCatalogTrack): boolean => {
  const requested = norm(cleanTitle(title).title), actual = norm(cleanTitle(hit.youtubeTitle).title);
  if (!requested || requested !== actual || !matchesVideoIdentity(title, artist, hit.youtubeTitle, hit.youtubeChannel)) return false;
  const variants = /\b(remix|cover|karaoke|tribute|instrumental|live|acoustic|acoustique|nightcore|slowed|sped[ -]?up)\b/gi;
  const asked = new Set((`${title} ${artist}`.match(variants) || []).map((v) => v.toLowerCase().replace(/[ -]/g, '')));
  return (hit.youtubeTitle.match(variants) || []).every((v) => asked.has(v.toLowerCase().replace(/[ -]/g, '')));
};

/** Proposition du modèle : uniquement des identifiants déjà lus et des
    suggestions à rechercher. Ce n'est jamais une commande exécutable brute. */
export type AssistantPlaylistEdits = {
  removeItemIds: string[];
  moves: PlaylistMove[];
  additions: { title: string; artist: string }[];
};
export type AssistantPlaylistDraft = {
  playlistId: string;
  title: string;
  snapshot: PlaylistSnapshotItem[];
  before: Track[];
  after: Track[];
  removals: Track[];
  moves: (PlaylistMove & { title: string; artist: string })[];
  additions: Track[];
};

/** Lit à nouveau les deux représentations complètes, puis les compare. Une
    vidéo privée/effacée, une page manquante ou une playlist modifiée entre
    les deux lectures doit bloquer l'aperçu plutôt qu'effacer des éléments. */
export async function prepareAssistantPlaylistDraft(playlist: Playlist, edits: AssistantPlaylistEdits): Promise<AssistantPlaylistDraft> {
  const revision = accountRevision(), serial = youtubeService.sessionRevision();
  const guard = () => {
    assertAccountRevision(revision);
    if (serial !== youtubeService.sessionRevision() || !youtubeService.isAuthenticated()) throw new Error('La session Google a changé pendant la préparation.');
  };
  if (!youtubeService.isAuthenticated() || playlist.id.startsWith('demo-pl-')) throw new Error('Connecte ton compte pour modifier une vraie playlist.');
  const snapshot = await youtubeService.getPlaylistItems(playlist.id); guard();
  if (snapshot.length > 5000 || new Set(snapshot.map((item) => item.itemId)).size !== snapshot.length
    || snapshot.some((item) => !item.itemId || item.itemId.length > 300 || !/^[A-Za-z0-9_-]{11}$/.test(item.videoId))) {
    throw new Error('La playlist contient des identifiants invalides ou répétés, ou plus de 5 000 éléments. Aucune modification préparée.');
  }
  const before = await youtubeService.fetchPlaylistTracks(playlist.id, undefined, { fresh: true }); guard();
  if (snapshot.length !== before.length || snapshot.some((item, i) => item.itemId !== before[i]?.id || item.videoId !== before[i]?.videoId)) {
    throw new Error('La playlist a changé pendant sa lecture ou contient des titres inaccessibles. Aucun changement n’a été préparé ; vérifie-la sur YouTube.');
  }
  if (!Array.isArray(edits.removeItemIds) || !Array.isArray(edits.moves) || !Array.isArray(edits.additions)) {
    throw new Error('La proposition de modification est incomplète. Demande une nouvelle proposition.');
  }
  const removeIds = edits.removeItemIds;
  if (new Set(removeIds).size !== removeIds.length || removeIds.some((id) => !snapshot.some((x) => x.itemId === id))) {
    throw new Error('Un retrait proposé ne correspond pas à un élément réel. Aucune modification envoyée.');
  }
  if (edits.additions.length > 5 || removeIds.length + edits.moves.length + edits.additions.length > 25) {
    throw new Error('Proposition trop importante : demande au maximum cinq ajouts et 25 changements à la fois.');
  }
  const removals = before.filter((t) => removeIds.includes(t.id));
  const after = before.filter((t) => !removeIds.includes(t.id));
  const moves: AssistantPlaylistDraft['moves'] = [];
  for (const move of edits.moves) {
    const at = after.findIndex((t) => t.id === move.itemId);
    if (at < 0 || !Number.isInteger(move.position) || move.position < 0 || move.position >= after.length) {
      throw new Error('Un déplacement proposé est invalide. Aucune modification envoyée.');
    }
    const [t] = after.splice(at, 1); after.splice(move.position, 0, t);
    if (at !== move.position) moves.push({ itemId: move.itemId, position: move.position, title: t.title, artist: t.artist });
  }
  const additions: Track[] = [];
  const existingVideos = new Set(after.map((t) => t.videoId));
  for (const request of edits.additions) {
    const title = request?.title?.trim().slice(0, 120), artist = request?.artist?.trim().slice(0, 120);
    if (!title || !artist) throw new Error('Un ajout doit préciser le titre et l’artiste. Aucune modification envoyée.');
    if (isExcluded({ title, artist })) throw new Error(`« ${title} » ou son artiste est bloqué dans tes exclusions.`);
    const candidates = await youtubeService.searchAssistantCatalog(`${artist} ${title}`); guard();
    const found = candidates.find((t) => matchesAddition(title, artist, t));
    if (!found) throw new Error(`Aucun résultat YouTube suffisamment précis pour « ${title} — ${artist} ». Reformule ou choisis un autre titre.`);
    if (isAssistantTrackExcluded(found)) throw new Error(`Le résultat « ${found.title} — ${found.artist} » est bloqué dans tes exclusions.`);
    if (existingVideos.has(found.videoId)) throw new Error(`« ${found.title} » est déjà présent dans la proposition. Précise un autre ajout.`);
    existingVideos.add(found.videoId); additions.push(found); after.push(found);
  }
  if (!removals.length && !moves.length && !additions.length) throw new Error('Aucun changement concret n’a été identifié. Précise les titres à ajouter, retirer ou déplacer.');
  return { playlistId: playlist.id, title: playlist.title, snapshot, before, after, removals, moves, additions };
}

/** Vérifie à nouveau l'origine juste avant de créer une copie. Il reste une
    fenêtre non atomique : un autre appareil peut toujours modifier YouTube. */
export async function assertAssistantSnapshot(draft: AssistantPlaylistDraft): Promise<void> {
  const revision = accountRevision(), serial = youtubeService.sessionRevision();
  const current = await youtubeService.getPlaylistItems(draft.playlistId);
  assertAccountRevision(revision);
  if (serial !== youtubeService.sessionRevision() || JSON.stringify(current) !== JSON.stringify(draft.snapshot)) {
    throw new Error('La playlist a changé depuis l’aperçu. Demande une nouvelle proposition avant de créer une copie.');
  }
}
