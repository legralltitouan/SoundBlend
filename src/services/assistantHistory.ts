import { accountRevision, assertAccountRevision, scopedGetItem, scopedSetItem, scopedStorageKey } from './accountScope';
import type { AssistantMessage, AssistantReply } from './gemini';
import type { AssistantMention } from './assistantMentions';
import type { Track } from '../types';

export const HISTORY_KEY = 'soundblend_assistant_history_v1';
const ACTIVE_KEY = 'soundblend_assistant_active_v1';
export const ASSISTANT_HISTORY_LIMIT = 3;
export const ASSISTANT_MESSAGE_LIMIT = 120;
export const newConversationId = () => `chat-${crypto.randomUUID()}`;
export const assistantRuntime = `page-${crypto.randomUUID()}`;
export type ConversationSnapshot = {
  text: string; draftMentions: AssistantMention[]; plan: AssistantReply | null;
  catalog: Track[]; selected: string[]; source: string; extraSources: string[];
  instruction: string; minutes: number; needsRefresh: boolean;
};
export type ConversationRun = {
  id: string; runtime: string; startedAt: number; status: 'running' | 'done' | 'error' | 'cancelled'; stage: string; error: string;
};
export type AssistantConversation = {
  id: string; createdAt: number; updatedAt: number; version: string;
  messages: AssistantMessage[]; snapshot: ConversationSnapshot; run: ConversationRun | null; _pending?: boolean;
};
export const emptyConversationSnapshot = (): ConversationSnapshot => ({ text: '', draftMentions: [], plan: null, catalog: [], selected: [], source: '', extraSources: [], instruction: '', minutes: 45, needsRefresh: false });
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max = 16000): v is string => typeof v === 'string' && v.length <= max;
const time = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < Number.MAX_SAFE_INTEGER - 2;
const id = (v: unknown): v is string => string(v, 150) && /^[\w-]+$/.test(v);
const safeImage = (v: unknown) => {
  if (!string(v, 2048)) return '';
  try { const u = new URL(v); return u.protocol === 'https:' && /(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(u.hostname) ? u.href : ''; } catch { return ''; }
};
const cleanTrack = (v: unknown): Track | null => {
  if (!object(v) || !string(v.id, 200) || !string(v.videoId, 100) || !string(v.title, 1000) || !string(v.artist, 1000)) return null;
  return { id: v.id, videoId: v.videoId, title: v.title, artist: v.artist, thumbnailUrl: safeImage(v.thumbnailUrl), durationSeconds: typeof v.durationSeconds === 'number' && Number.isFinite(v.durationSeconds) && v.durationSeconds >= 0 ? v.durationSeconds : 0,
    ...(string(v.youtubeTitle, 1000) ? { youtubeTitle: v.youtubeTitle } : {}), ...(string(v.youtubeChannel, 1000) ? { youtubeChannel: v.youtubeChannel } : {}) };
};
const tracks = (v: unknown): Track[] => Array.isArray(v) ? v.slice(0, 24).map(cleanTrack).filter((t): t is Track => !!t) : [];
const mentions = (v: unknown): AssistantMention[] => Array.isArray(v) ? v.slice(0, 8).flatMap((m): AssistantMention[] => {
  if (!object(m) || !['artist', 'track'].includes(m.kind) || !string(m.id, 100) || !string(m.title, 1000)) return [];
  const base = { id: m.id, title: m.title, thumbnailUrl: safeImage(m.thumbnailUrl) };
  return m.kind === 'artist' ? [{ ...base, kind: 'artist' }] : [{ ...base, kind: 'track', artist: string(m.artist, 1000) ? m.artist : '', channelId: string(m.channelId, 100) ? m.channelId : '', channelTitle: string(m.channelTitle, 1000) ? m.channelTitle : '', youtubeTitle: string(m.youtubeTitle, 1000) ? m.youtubeTitle : '' }];
}) : [];
const source = (v: unknown): AssistantReply['source'] => object(v) && ['playlist','blend'].includes(v.type) && string(v.id,200) ? { type: v.type, id: v.id } : null;
/** Only a creation preview is portable. Historical write previews never grant permission. */
const plan = (v: unknown): AssistantReply | null => {
  if (!object(v) || v.action !== 'blend' || !string(v.instruction, 6000)) return null;
  return { action: 'blend', reply: string(v.reply) ? v.reply : '', title: string(v.title, 1000) ? v.title : '', source: source(v.source), extraSources: Array.isArray(v.extraSources) ? v.extraSources.slice(0,3).map(source).filter((s): s is NonNullable<AssistantReply['source']> => !!s) : [], instruction: v.instruction,
    durationMinutes: Number.isInteger(v.durationMinutes) ? Math.max(10, Math.min(180,v.durationMinutes)) : 45, catalogQueries: [], catalogVideoIds: [], researchQuery: '', playlistEdits: null,
    followUps: Array.isArray(v.followUps) ? v.followUps.filter((s: unknown) => string(s, 300)).slice(0,4) : [] };
};
export function cleanConversationSnapshot(v: Partial<ConversationSnapshot>): ConversationSnapshot {
  return { text: string(v.text,6000) ? v.text : '', draftMentions: mentions(v.draftMentions), plan: plan(v.plan), catalog: tracks(v.catalog), selected: Array.isArray(v.selected) ? v.selected.filter(s=>string(s,100)).slice(0,24) : [], source: string(v.source,250) ? v.source : '', extraSources: Array.isArray(v.extraSources) ? v.extraSources.filter(s=>string(s,250)).slice(0,3) : [], instruction: string(v.instruction,6000) ? v.instruction : '', minutes: Number.isInteger(v.minutes) ? Math.max(10,Math.min(180,v.minutes!)) : 45, needsRefresh: !!v.needsRefresh || !!v.plan && v.plan.action !== 'blend' };
}
let messageClock=0;
export function stampAssistantMessage(m: AssistantMessage): AssistantMessage {
  messageClock=Math.max(messageClock,time(m.at)?m.at:Date.now());
  const at=time(m.at)?m.at:++messageClock;
  return { id: id(m.id) ? m.id : `msg-${crypto.randomUUID()}`, at, role: m.role, text: m.text.slice(0,16000), ...(m.references?.length ? { references: mentions(m.references) } : {}), ...(m.catalog ? { catalog: tracks(m.catalog) } : {}) };
}
const stable = (v: any): string => JSON.stringify(v, (_key,value)=>object(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const strip = (c: AssistantConversation): AssistantConversation => { const { _pending: _p, ...data } = c; return data; };
export const conversationForDrive = strip;
export const conversationFingerprint = (c: AssistantConversation) => JSON.stringify(strip(c));
export function validAssistantConversations(v: unknown): v is AssistantConversation[] {
  return Array.isArray(v) && v.length <= 3 && new Set(v.map(c=>c?.id)).size === v.length && v.every(c => object(c) && id(c.id) && time(c.createdAt) && time(c.updatedAt) && c.updatedAt >= c.createdAt && string(c.version,200)
    && Object.keys(c).every(k=>['id','createdAt','updatedAt','version','messages','snapshot','run'].includes(k))
    && Array.isArray(c.messages) && c.messages.length <= ASSISTANT_MESSAGE_LIMIT && c.messages.every((m: any)=>object(m) && id(m.id) && time(m.at) && ['user','assistant'].includes(m.role) && string(m.text)
      && Object.keys(m).every(k=>['id','at','role','text','references','catalog'].includes(k))
      && (m.references === undefined || Array.isArray(m.references) && m.references.length<=8 && stable(mentions(m.references))===stable(m.references))
      && (m.catalog === undefined || Array.isArray(m.catalog) && m.catalog.length<=24 && stable(tracks(m.catalog))===stable(m.catalog)))
    && object(c.snapshot) && stable(cleanConversationSnapshot(c.snapshot))===stable(c.snapshot)
    && (c.run === null || object(c.run) && id(c.run.id) && id(c.run.runtime) && time(c.run.startedAt) && ['running','done','error','cancelled'].includes(c.run.status) && string(c.run.stage,500) && string(c.run.error,2000) && Object.keys(c.run).every(k=>['id','runtime','startedAt','status','stage','error'].includes(k))));
}
const fallback = new Map<string, AssistantConversation[]>();
let storageWarning = '';
export const assistantHistoryWarning = () => storageWarning;
const key = () => scopedStorageKey(HISTORY_KEY);
const unsaved = new Set<string>();
export function getAssistantConversations(): AssistantConversation[] {
  if(unsaved.has(key()))return fallback.get(key()) || [];
  try {
    const raw = scopedGetItem(HISTORY_KEY); const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed) || !validAssistantConversations(parsed.map(strip))) throw new Error('Historique local illisible ; il n’a pas été remplacé.');
    messageClock=Math.max(messageClock,...parsed.flatMap((c: AssistantConversation)=>c.messages.map(m=>m.at || 0)));
    storageWarning = ''; return parsed;
  } catch (e) { storageWarning = e instanceof Error ? e.message : 'Historique local indisponible.'; return fallback.get(key()) || []; }
}
function store(rows: AssistantConversation[], remote = false): void {
  fallback.set(key(),rows);
  try { scopedSetItem(HISTORY_KEY,JSON.stringify(rows)); unsaved.delete(key()); storageWarning = ''; }
  catch { unsaved.add(key()); storageWarning = 'Historique gardé en mémoire uniquement : stockage local indisponible. Ne ferme pas cette page avant la synchronisation.'; }
  window.dispatchEvent(new CustomEvent(remote ? 'sb:assistant-history-remote' : 'sb:assistant-history-changed'));
  if (!remote) window.dispatchEvent(new CustomEvent('sb:assistant-history-dirty'));
}
export function mergeAssistantConversations(a: AssistantConversation[], b: AssistantConversation[]): AssistantConversation[] {
  const map = new Map<string,AssistantConversation>();
  for (const c of [...a,...b]) {
    const prev = map.get(c.id); if (!prev) { map.set(c.id,{...c,messages:c.messages.slice(-ASSISTANT_MESSAGE_LIMIT)}); continue; }
    const win = c.updatedAt > prev.updatedAt || c.updatedAt === prev.updatedAt && c.version > prev.version ? c : prev;
    const msgs = new Map<string,AssistantMessage>();
    for (const m of [...prev.messages,...c.messages]) {
      const before = msgs.get(m.id!); if (!before || JSON.stringify(m)>JSON.stringify(before)) msgs.set(m.id!,m);
    }
    const messages = [...msgs.values()].sort((x,y)=>x.at!-y.at! || x.id!.localeCompare(y.id!)).slice(-ASSISTANT_MESSAGE_LIMIT);
    let run=win.run || prev.run || c.run;
    if(prev.run && c.run) {
      if(prev.run.id===c.run.id) {
        // A terminal state cannot regress to an old running snapshot. For
        // actual progress updates, use the newest record, not alphabetic text.
        if((prev.run.status==='running')!==(c.run.status==='running'))run=prev.run.status==='running'?c.run:prev.run;
      } else run=c.run.startedAt>prev.run.startedAt || c.run.startedAt===prev.run.startedAt && c.run.id>prev.run.id ? c.run : prev.run;
    }
    map.set(c.id,{ ...win, run, createdAt: Math.min(c.createdAt,prev.createdAt), messages, ...((c._pending || prev._pending) ? { _pending:true } : {}) });
  }
  return [...map.values()].sort((x,y)=>y.updatedAt-x.updatedAt || y.id.localeCompare(x.id)).slice(0,ASSISTANT_HISTORY_LIMIT);
}
export function mergeRemoteAssistantConversations(remote: AssistantConversation[]): void {
  const local = getAssistantConversations(); const merged = mergeAssistantConversations(local,remote);
  if (JSON.stringify(local)!==JSON.stringify(merged)) store(merged,true);
}
export function saveAssistantConversation(conversationId: string, patch: Partial<Pick<AssistantConversation,'messages'|'snapshot'|'run'>>, revision = accountRevision()): AssistantConversation | null {
  assertAccountRevision(revision);
  const rows = getAssistantConversations(); const old = rows.find(c=>c.id===conversationId);
  const snap = patch.snapshot ? cleanConversationSnapshot(patch.snapshot) : old?.snapshot || emptyConversationSnapshot();
  const messages = patch.messages ? patch.messages.map(stampAssistantMessage).slice(-ASSISTANT_MESSAGE_LIMIT) : old?.messages || [];
  if (!old && !messages.length && !snap.text.trim()) return null;
  const run = patch.run === undefined ? old?.run || null : patch.run;
  if (old && JSON.stringify([old.messages,old.snapshot,old.run])===JSON.stringify([messages,snap,run])) return old;
  const at = Math.max(Date.now(),...rows.map(c=>c.updatedAt+1));
  const next: AssistantConversation = { id:conversationId, createdAt:old?.createdAt || at, updatedAt:at, version:`${at}-${crypto.randomUUID()}`, messages, snapshot:snap, run, _pending:true };
  const merged=mergeAssistantConversations(rows,[next]);store(merged);return merged.find(c=>c.id===conversationId) || next;
}
export function confirmAssistantConversations(sent: AssistantConversation[]): void {
  const rows=getAssistantConversations();const next=rows.map(c=>sent.some(s=>conversationFingerprint(s)===conversationFingerprint(c)) ? strip(c) : c);
  if(JSON.stringify(rows)!==JSON.stringify(next))store(next,true);
}
export function getActiveConversationId(): string {
  try { const value=scopedGetItem(ACTIVE_KEY); if(value && id(value) && getAssistantConversations().some(c=>c.id===value))return value; } catch { /* use latest */ }
  return getAssistantConversations()[0]?.id || newConversationId();
}
export function setActiveConversationId(value: string): void { try { scopedSetItem(ACTIVE_KEY,value); } catch { /* selection stays in memory */ } }
