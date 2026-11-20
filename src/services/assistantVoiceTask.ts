import { accountRevision, assertAccountRevision, scopedStorageKey } from './accountScope';
import { youtubeService } from './youtube';
import type { AssistantMessage, AssistantReply } from './gemini';
import type { AssistantPlaylistDraft } from './assistantPlaylist';
import type { AssistantBlendDraft } from './assistantBlend';
import type { Track } from '../types';
import { assistantRuntime, cleanConversationSnapshot, getAssistantConversations, saveAssistantConversation, type ConversationRun } from './assistantHistory';

export type VoicePreparationResult = {
  messages: AssistantMessage[]; answer: AssistantReply; catalog: Track[]; selected: string[];
  prepared: boolean; playlistDraft: AssistantPlaylistDraft | null; blendDraft?: AssistantBlendDraft | null;
  source: string; extraSources: string[]; instruction: string;
};
export type VoicePreparation = {
  owner: object; query: string; controller: AbortController; revision: number; serial: number;
  status: 'running' | 'done' | 'error'; result?: VoicePreparationResult; error?: string; journalKey: string;
  conversationId?: string; run: ConversationRun;
};
const KEY = 'soundblend_assistant_voice_pending_v1';
const MAX_AGE = 30 * 60 * 1000;
const tasks = new Map<string,VoicePreparation>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
export function subscribeVoicePreparation(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getVoicePreparation(conversationId?: string): VoicePreparation | null {
  const value = conversationId ? tasks.get(conversationId) : [...tasks.values()].at(-1);
  return value && value.revision === accountRevision() && value.serial === youtubeService.sessionRevision() ? value : null;
}
/** Legacy voice-only crash journal. Conversation history is stored separately, by account. */
export function recoverVoiceQuery(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(KEY)) || 'null');
    if (typeof value?.query === 'string' && value.query.trim() && value.query.length <= 6000
      && Number.isFinite(value.at) && Date.now() >= value.at && Date.now() - value.at < MAX_AGE) return value.query;
    localStorage.removeItem(scopedStorageKey(KEY));
  } catch { /* memory task remains functional */ }
  return null;
}
export function forgetVoiceQuery(): void { try { localStorage.removeItem(scopedStorageKey(KEY)); } catch { /* unavailable */ } }
export function beginVoicePreparation(owner: object, query: string, controller: AbortController, conversationId?: string, voice = true): VoicePreparation {
  if (getVoicePreparation(conversationId)?.status === 'running') throw new Error('Une demande est déjà en préparation dans cette discussion.');
  const previous=getAssistantConversations().find(c=>c.id===conversationId);
  // Logical ordering survives a second device whose clock is behind.
  const startedAt=Math.max(Date.now(),(previous?.updatedAt || 0)+1,(previous?.run?.startedAt || 0)+1);
  const value: VoicePreparation = { owner, query, controller, revision: accountRevision(), serial: youtubeService.sessionRevision(), status: 'running', journalKey: voice ? scopedStorageKey(KEY) : '', conversationId,
    run: { id:`run-${crypto.randomUUID()}`, runtime:assistantRuntime, startedAt,status:'running',stage:'Lecture de ton contexte musical…',error:'' } };
  const retained=new Set(getAssistantConversations().map(c=>c.id));
  for(const [key,old] of tasks)if(old.status!=='running' && old.conversationId && !retained.has(old.conversationId))tasks.delete(key);
  tasks.set(conversationId || 'legacy',value);
  if (voice) try { localStorage.setItem(value.journalKey, JSON.stringify({ query, at: Date.now() })); } catch { /* no false recovery guarantee */ }
  if (conversationId) saveAssistantConversation(conversationId,{run:value.run},value.revision);
  const abort=()=>completeVoicePreparation(value,undefined,'Demande interrompue. Tu peux la relancer.');
  controller.signal.addEventListener('abort',abort,{once:true});
  if(controller.signal.aborted)abort();
  notify(); return value;
}
export function guardVoicePreparation(value: VoicePreparation): void {
  assertAccountRevision(value.revision);
  if (tasks.get(value.conversationId || 'legacy') !== value || value.status !== 'running' || value.controller.signal.aborted || value.serial !== youtubeService.sessionRevision()) throw new Error('Préparation interrompue.');
}
export function updateVoicePreparation(value: VoicePreparation, stage: string): void {
  guardVoicePreparation(value);
  if (value.run.stage === stage) return;
  value.run = {...value.run,stage:stage.slice(0,500)};
  if (value.conversationId) saveAssistantConversation(value.conversationId,{run:value.run},value.revision);
  notify();
}
export function completeVoicePreparation(value: VoicePreparation, result?: VoicePreparationResult, error?: string): void {
  if(tasks.get(value.conversationId || 'legacy')!==value || value.status!=='running')return;
  if(!error)try{guardVoicePreparation(value);}catch(e){error=e instanceof Error?e.message:'Préparation interrompue.';}
  value.status = error ? 'error' : 'done'; value.result = result; value.error = error;
  value.run={...value.run,status:value.controller.signal.aborted?'cancelled':error?'error':'done',error:(error || '').slice(0,2000),stage:''};
  try {
    // An abort is terminal too. Never leave a running marker just because
    // the normal success guard rejects an aborted signal or an old session.
    if (value.conversationId && value.revision===accountRevision() && value.serial===youtubeService.sessionRevision()) {
      const old = getAssistantConversations().find(c=>c.id===value.conversationId);
      saveAssistantConversation(value.conversationId,{run:value.run,...(result && !error ? {messages:result.messages,snapshot:cleanConversationSnapshot({...(old?.snapshot || {}),plan:result.prepared ? result.answer : old?.snapshot.plan,catalog:result.catalog,selected:result.selected,source:result.source,extraSources:result.extraSources,instruction:result.instruction,minutes:result.answer.durationMinutes,needsRefresh:result.prepared && result.answer.action!=='blend'})} : {})},value.revision);
    }
    if (!error && value.journalKey) try { localStorage.removeItem(value.journalKey); } catch { /* unavailable */ }
  } catch(e) {
    value.status='error';value.error=e instanceof Error?e.message:'Impossible de conserver la réponse.';
    value.run={...value.run,status:'error',error:value.error.slice(0,2000)};
  } finally { notify(); }
}
/** The promise and all finalization belong to the task, never a React view. */
export async function runVoicePreparation(value:VoicePreparation, execute:()=>Promise<VoicePreparationResult>):Promise<VoicePreparationResult | null> {
  let abort=()=>{};
  const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new DOMException('Préparation interrompue.','AbortError'));if(value.controller.signal.aborted)abort();else value.controller.signal.addEventListener('abort',abort,{once:true});});
  try {
    const work=Promise.resolve().then(()=>{guardVoicePreparation(value);return execute();});
    const result=await Promise.race([work,cancelled]);guardVoicePreparation(value);completeVoicePreparation(value,result);return value.status==='done'?result:null;
  } catch(e){completeVoicePreparation(value,undefined,e instanceof Error?e.message:'Impossible de préparer la réponse.');return null;}
  finally {value.controller.signal.removeEventListener('abort',abort);}
}

export function ownsVoicePreparation(controller: AbortController | null): boolean { return !!controller && [...tasks.values()].some(t=>t.controller===controller && t.revision===accountRevision() && t.serial===youtubeService.sessionRevision() && t.status==='running'); }
export function cancelVoicePreparation(conversationId?: string): void {
  for (const [key,value] of tasks) {
    if (conversationId && value.conversationId!==conversationId) continue;
    value.controller.abort();
    if (value.journalKey) try { localStorage.removeItem(value.journalKey); } catch { /* unavailable */ }
    if (value.status==='running' && value.conversationId) try { saveAssistantConversation(value.conversationId,{run:{...value.run,status:'cancelled',stage:'',error:'Demande interrompue. Tu peux la relancer.'}},value.revision); } catch { /* never write into another account */ }
    tasks.delete(key);
  }
  if (!conversationId) forgetVoiceQuery(); notify();
}
if (typeof window !== 'undefined') {
  window.addEventListener('sb:auth-changing', () => cancelVoicePreparation());
  window.addEventListener('sb:auth-expired', () => cancelVoicePreparation());
}
