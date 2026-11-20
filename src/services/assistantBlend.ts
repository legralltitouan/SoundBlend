import type { GeneratedBlend, Track } from '../types';
import { accountRevision, assertAccountRevision } from './accountScope';
import { getStoredBlends, isExcluded } from './storage';
import { isAssistantTrackExcluded, youtubeService } from './youtube';
import { matchesAddition } from './assistantPlaylist';

export type AssistantBlendEdits = {
  mode: 'tracks' | 'regenerate';
  title?: string; description?: string;
  removeTrackIds: string[]; moves: { trackId: string; position: number }[];
  additions: { title: string; artist: string }[];
};
export type AssistantBlendDraft = {
  blendId: string; signature: string; revision: number; serial: number;
  before: GeneratedBlend; after: GeneratedBlend; mode: AssistantBlendEdits['mode'];
  removals: Track[]; additions: Track[]; moves: { trackId: string; title: string; position: number }[];
};
/** L'expiration et les métadonnées d'export appartiennent à l'original.
 * Toute modification depuis l'aperçu impose une nouvelle confirmation. */
export const assistantBlendSignature = (blend: GeneratedBlend): string => JSON.stringify({ ...blend, _pending: undefined });
export function assertAssistantBlendCurrent(id: string, signature: string): GeneratedBlend {
  const current = getStoredBlends().find(b => b.id === id && Date.parse(b.expiresAt) > Date.now());
  if (!current || assistantBlendSignature(current) !== signature) throw new Error('Ce blend a changé, a expiré ou a été supprimé depuis l’aperçu. Demande une nouvelle proposition.');
  return current;
}
export function assertAssistantBlendDraft(draft: AssistantBlendDraft): GeneratedBlend {
  assertAccountRevision(draft.revision);
  if (draft.serial !== youtubeService.sessionRevision()) throw new Error('La session a changé. Demande un nouvel aperçu.');
  const current = assertAssistantBlendCurrent(draft.blendId, draft.signature);
  if (draft.additions.some(isAssistantTrackExcluded)) throw new Error('Un ajout est désormais bloqué par tes exclusions. Demande un nouvel aperçu.');
  return current;
}
export async function prepareAssistantBlendDraft(id: string, edits: AssistantBlendEdits): Promise<AssistantBlendDraft> {
  const revision = accountRevision(), serial = youtubeService.sessionRevision();
  const before = getStoredBlends().find(b => b.id === id && Date.parse(b.expiresAt) > Date.now());
  if (!before) throw new Error('Ce blend est introuvable ou expiré.');
  const signature = assistantBlendSignature(before);
  const guard = () => { assertAccountRevision(revision); if (serial !== youtubeService.sessionRevision()) throw new Error('Session modifiée.'); assertAssistantBlendCurrent(id, signature); };
  if (!edits || !['tracks', 'regenerate'].includes(edits.mode) || !Array.isArray(edits.removeTrackIds) || !Array.isArray(edits.moves) || !Array.isArray(edits.additions)) throw new Error('Proposition de modification de blend incomplète.');
  if (new Set(before.tracks.map(t => t.id)).size !== before.tracks.length) throw new Error('Ce blend contient des identifiants répétés. Aucune modification préparée.');
  const title = edits.title?.trim().slice(0, 80) || before.title;
  const description = edits.description?.trim().slice(0, 1000) || before.description;
  const removals: Track[] = [], moves: AssistantBlendDraft['moves'] = [], additions: Track[] = [];
  let tracks = [...before.tracks];
  if (edits.mode === 'tracks') {
    if (edits.additions.length > 5 || edits.removeTrackIds.length + edits.moves.length + edits.additions.length > 25) throw new Error('Limite : cinq ajouts et 25 changements à la fois.');
    if (new Set(edits.removeTrackIds).size !== edits.removeTrackIds.length || edits.removeTrackIds.some(id => !tracks.some(t => t.id === id))) throw new Error('Un retrait ne correspond pas à un titre réel du blend.');
    removals.push(...tracks.filter(t => edits.removeTrackIds.includes(t.id)));
    tracks = tracks.filter(t => !edits.removeTrackIds.includes(t.id));
    for (const move of edits.moves) {
      const index = tracks.findIndex(t => t.id === move.trackId);
      if (index < 0 || !Number.isInteger(move.position) || move.position < 0 || move.position >= tracks.length) throw new Error('Un déplacement de titre est invalide.');
      const [track] = tracks.splice(index, 1); tracks.splice(move.position, 0, track);
      if (index !== move.position) moves.push({ ...move, title: track.title });
    }
    for (const request of edits.additions) {
      const title = request?.title?.trim(), artist = request?.artist?.trim();
      if (!title || !artist || isExcluded({ title, artist })) throw new Error('Ajout imprécis ou bloqué par les exclusions.');
      const found = (await youtubeService.searchAssistantCatalog(`${artist} ${title}`)).find(t => matchesAddition(title, artist, t)); guard();
      if (!found || isAssistantTrackExcluded(found)) throw new Error(`Aucun résultat vérifié et autorisé pour « ${title} ». Précise un autre titre.`);
      if (tracks.some(t => t.videoId === found.videoId)) throw new Error('Le titre proposé est déjà présent.');
      const added = { ...found, id: `assistant-${crypto.randomUUID()}` };
      additions.push(added); tracks.push(added);
    }
    if (!tracks.length) throw new Error('Un blend doit conserver au moins un titre.');
    if (!removals.length && !moves.length && !additions.length && title === before.title && description === before.description) throw new Error('Aucun changement concret identifié. Précise ce que tu souhaites modifier.');
  } else if (edits.removeTrackIds.length || edits.moves.length || edits.additions.length) throw new Error('Une régénération et des changements précis ne peuvent pas être mélangés dans le même aperçu.');
  guard();
  return { blendId: id, signature, revision, serial, mode: edits.mode, before, after: { ...before, title, description, tracks }, removals, moves, additions };
}
