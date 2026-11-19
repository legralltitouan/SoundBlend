import { accountRevision, assertAccountRevision, scopedStorageKey } from './accountScope';
import { youtubeService } from './youtube';
import type { AssistantMessage, AssistantReply } from './gemini';
import type { AssistantPlaylistDraft } from './assistantPlaylist';
import type { Track } from '../types';

export type VoicePreparationResult = {
  messages: AssistantMessage[]; answer: AssistantReply; catalog: Track[]; selected: string[];
  prepared: boolean; playlistDraft: AssistantPlaylistDraft | null;
  source: string; extraSources: string[]; instruction: string;
};
export type VoicePreparation = {
  owner: object; query: string; controller: AbortController; revision: number; serial: number;
  status: 'running' | 'done' | 'error'; result?: VoicePreparationResult; error?: string; journalKey: string;
};
const KEY = 'soundblend_assistant_voice_pending_v1';
const MAX_AGE = 30 * 60 * 1000;
let task: VoicePreparation | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
export function subscribeVoicePreparation(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getVoicePreparation(): VoicePreparation | null {
  return task && task.revision === accountRevision() && task.serial === youtubeService.sessionRevision() ? task : null;
}
/** Seulement la consigne textuelle acceptée, jamais de clé, audio ou historique.
 * Après destruction du processus, reprise en lecture seule sur bouton explicite. */
export function recoverVoiceQuery(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(KEY)) || 'null');
    if (typeof value?.query === 'string' && value.query.trim() && value.query.length <= 6000
      && Number.isFinite(value.at) && Date.now() >= value.at && Date.now() - value.at < MAX_AGE) return value.query;
    localStorage.removeItem(scopedStorageKey(KEY));
  } catch { /* stockage indisponible : la tâche en mémoire reste fonctionnelle */ }
  return null;
}
export function forgetVoiceQuery(): void { try { localStorage.removeItem(scopedStorageKey(KEY)); } catch { /* stockage indisponible */ } }
export function beginVoicePreparation(owner: object, query: string, controller: AbortController): VoicePreparation {
  if (getVoicePreparation()?.status === 'running') throw new Error('Une demande vocale est déjà en préparation.');
  task = { owner, query, controller, revision: accountRevision(), serial: youtubeService.sessionRevision(), status: 'running', journalKey: scopedStorageKey(KEY) };
  try { localStorage.setItem(task.journalKey, JSON.stringify({ query, at: Date.now() })); } catch { /* pas de fausse garantie de reprise */ }
  notify(); return task;
}
export function guardVoicePreparation(value: VoicePreparation): void {
  assertAccountRevision(value.revision);
  if (task !== value || value.controller.signal.aborted || value.serial !== youtubeService.sessionRevision()) throw new Error('Préparation vocale interrompue.');
}
export function completeVoicePreparation(value: VoicePreparation, result?: VoicePreparationResult, error?: string): void {
  try { guardVoicePreparation(value); } catch { return; }
  value.status = error ? 'error' : 'done'; value.result = result; value.error = error;
  if (!error) { try { localStorage.removeItem(value.journalKey); } catch { /* stockage indisponible */ } }
  notify();
}
export function ownsVoicePreparation(controller: AbortController | null): boolean { return !!controller && getVoicePreparation()?.controller === controller && task?.status === 'running'; }
export function cancelVoicePreparation(): void {
  if (task) { task.controller.abort(); try { localStorage.removeItem(task.journalKey); } catch { /* stockage indisponible */ } }
  task = null; forgetVoiceQuery(); notify();
}
if (typeof window !== 'undefined') {
  window.addEventListener('sb:auth-changing', cancelVoicePreparation);
  window.addEventListener('sb:auth-expired', cancelVoicePreparation);
}
