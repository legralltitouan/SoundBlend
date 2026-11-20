import { getLiveVoiceVolume, setLiveVoiceVolume, subscribeLiveVoiceVolume } from '../../services/liveVoiceOutput';
import { prepareAssistantConversation } from '../../services/assistantPreparation';
import { AssistantHistoryPanel } from './AssistantHistoryPanel';
import { assistantHistoryWarning, assistantRuntime, cleanConversationSnapshot, getActiveConversationId, getAssistantConversations, newConversationId, saveAssistantConversation, setActiveConversationId, stampAssistantMessage, emptyConversationSnapshot } from '../../services/assistantHistory';
import { createPortal } from 'react-dom';
import { promptWithTags } from './AssistantPrompt';
import { AssistantMentionPicker } from './AssistantMentionPicker';
import { MAX_ASSISTANT_MENTIONS, compactMention, mentionKey, mentionToken, mentionUrl, type AssistantMention } from '../../services/assistantMentions';
import { AssistantMosaic, AssistantSeedPreview, AssistantInstruction, AssistantDuration, AssistantSourcePalette, AssistantThinking, type AssistantSourceChoice } from './AssistantBlendDesign';
import { assertAssistantBlendDraft, type AssistantBlendDraft } from '../../services/assistantBlend';
import { AssistantPrivacy } from './AssistantPrivacy';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpRight, AudioLines, Check, ChevronDown, ChevronRight, ExternalLink,
  Keyboard, ListMusic, Mic, MicOff, Music2, Plus, Settings2, ShieldCheck,
  Sparkles, X, WandSparkles, Volume2,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { usePlayer } from '../../context/PlayerContext';
import { PlaylistArt } from '../ui/Art';
import { mergeLiveTranscript, uniqueAssistantTracks } from '../../services/assistantConversation';
import './AssistantView.css';
import { useUI } from '../../context/UIContext';
import { type AssistantMessage, type AssistantReply } from '../../services/gemini';
import { GeminiLiveSession, type LivePhase, type LiveToolName, type LiveCaptureStatus } from '../../services/geminiLive';
import { assertAssistantSnapshot, type AssistantPlaylistDraft } from '../../services/assistantPlaylist';
import { beginExportAttempt, clearExportAttempt, getExportAttempt, rememberExportPlaylist } from '../../services/exportRecovery';
import { beginVoicePreparation, cancelVoicePreparation, runVoicePreparation, getVoicePreparation, ownsVoicePreparation, recoverVoiceQuery, forgetVoiceQuery, subscribeVoicePreparation } from '../../services/assistantVoiceTask';
import { accountRevision, assertAccountRevision } from '../../services/accountScope';
import { isAssistantTrackExcluded, youtubeService } from '../../services/youtube';
import { getStoredBlends, getStoredSettings } from '../../services/storage';
import { GEMINI_API_KEY } from '../../config/app';
import type { GeneratedBlend, Track } from '../../types';

const playlistLink = (id: string) => `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
const videoLink = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
const rawVideoTitle = (t: Track) => {
  const raw = (t as Track & { youtubeTitle?: unknown }).youtubeTitle;
  return typeof raw === 'string' ? raw : '';
};
const copyJournalKey = (id: string) => `assistant-copy:${id}`;


const CatalogCard: React.FC<{
  tracks: Track[]; selected: string[]; onToggle: (id: string) => void; onPrepare: () => void;
}> = ({ tracks, selected, onToggle, onPrepare }) => <div className="sb-assistant-catalog">
  <div className="sb-assistant-card-kicker"><Music2 size={14} /> Résultats YouTube</div>
  {tracks.length ? <ul>{tracks.map((t) => <li key={t.videoId}>
    <label><input type="checkbox" checked={selected.includes(t.videoId)} onChange={() => onToggle(t.videoId)} />
      <span><strong>{t.title}</strong><small>{t.artist}</small>{rawVideoTitle(t) && <small>Vidéo : {rawVideoTitle(t)}</small>}</span></label>
    <a href={videoLink(t.videoId)} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir ${t.title} sur YouTube`}><ExternalLink size={15} /></a>
  </li>)}</ul> : <p>Aucun résultat musical accessible pour cette recherche.</p>}
  {tracks.length > 0 && <button type="button" className="sb-assistant-inline-button" onClick={onPrepare} disabled={!tracks.some((t) => selected.includes(t.videoId))}>
    <Plus size={14} /> Préparer un blend avec la sélection
  </button>}
  <p className="sb-assistant-card-foot">Résultats à vérifier : la présence d’une vidéo ne garantit pas qu’elle soit lisible.</p>
</div>;

/** Conversation sans effet de bord ; chaque écriture YouTube et
    chaque génération passent par leur propre bouton de confirmation. */
export const AssistantView: React.FC = () => {
  const [id,setId]=useState(getActiveConversationId);
  const [scope,setScope]=useState(accountRevision);
  const explicit=useRef(false);
  useEffect(()=>{
    const account=()=>{explicit.current=false;setScope(accountRevision());setId(getActiveConversationId());};
    const remote=()=>{if(!explicit.current && !getAssistantConversations().some(c=>c.id===id)){const latest=getAssistantConversations()[0];if(latest){setId(latest.id);setActiveConversationId(latest.id);}}};
    window.addEventListener('sb:account-changed',account);window.addEventListener('sb:assistant-history-remote',remote);
    return ()=>{window.removeEventListener('sb:account-changed',account);window.removeEventListener('sb:assistant-history-remote',remote);};
  },[id]);
  const select=(next:string)=>{explicit.current=true;setActiveConversationId(next);setId(next);};
  return <AssistantSession key={`${scope}:${id}`} conversationId={id} onSelectConversation={select} />;
};

const AssistantSession: React.FC<{conversationId:string;onSelectConversation:(id:string)=>void}> = ({conversationId,onSelectConversation}) => {
  const [initial]=useState(()=>getAssistantConversations().find(c=>c.id===conversationId));
  const [historyOpen,setHistoryOpen]=useState(false);
  const [needsRefresh,setNeedsRefresh]=useState(initial?.snapshot.needsRefresh || false);
  const sessionRevision=useRef(accountRevision());
  const [historyVersion,setHistoryVersion]=useState(0);
  const saved=initial?.snapshot || emptyConversationSnapshot();
  const persistedContent=useRef('');

  const { playlists, recentBlends, exclusions, loadPlaylistTracks, refreshLibrary, generate, generating, userProfile, setCurrentBlend, updateBlend, syncState, syncNow } = useData();
  const { setView, showToast } = useUI();
  const { currentTrack, isPlaying, togglePlay } = usePlayer();
  const [messages, setMessages] = useState<AssistantMessage[]>(initial?.messages || []);
  const messagesRef = useRef<AssistantMessage[]>(initial?.messages || []);
  const [text, setText] = useState(saved.text);
  const [draftMentions, setDraftMentions] = useState<AssistantMention[]>(saved.draftMentions);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [responding, setResponding] = useState(false);
  const [longResponse, setLongResponse] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [plan, setPlan] = useState<AssistantReply | null>(saved.plan);
  const [blendDraft, setBlendDraft] = useState<AssistantBlendDraft | null>(null);
  const [playlistDraft, setPlaylistDraft] = useState<AssistantPlaylistDraft | null>(null);
  const [destination, setDestination] = useState<'' | 'original' | 'copy'>('');
  const [recoveryRefresh, setRecoveryRefresh] = useState(0);
  const [source, setSource] = useState(saved.source);
  const [extraSources, setExtraSources] = useState<string[]>(saved.extraSources);
  const [catalog, setCatalog] = useState<Track[]>(saved.catalog);
  const [catalogSelected, setCatalogSelected] = useState<string[]>(saved.selected);
  const [instruction, setInstruction] = useState(saved.instruction);
  const [minutes, setMinutes] = useState(saved.minutes);
  const [createdBlend, setCreatedBlend] = useState<GeneratedBlend | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(getLiveVoiceVolume);
  useEffect(()=>subscribeLiveVoiceVolume(()=>setVoiceVolume(getLiveVoiceVolume())),[]);
  const [audioActivationRequired, setAudioActivationRequired] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<LiveCaptureStatus | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [liveQuote, setLiveQuote] = useState('');
  const liveOrb = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const promptDecorRef = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [livePhase, setLivePhase] = useState<LivePhase>('off');
  const [liveDetail, setLiveDetail] = useState('');
  const partialRef = useRef({ user: '', assistant: '' });
  const liveRef = useRef<GeminiLiveSession | null>(null);
  const taskOwner = useRef<object>({});
  const restoredTask = useRef<object | null>(null);
  const observedTask = useRef<ReturnType<typeof getVoicePreparation>>(null);
  const [recoveryQuery, setRecoveryQuery] = useState<string | null>(() => initial?.run || getVoicePreparation(conversationId) ? null : recoverVoiceQuery());
  const finishingLive = useRef<GeminiLiveSession | null>(null);
  const alive = useRef(true), operation = useRef(0), busyRef = useRef(false);
  const actionAbort = useRef<AbortController | null>(null);
  const planRef = useRef<HTMLElement | null>(null);
  const latest = useRef<any>(null);
  const recovery = playlistDraft ? getExportAttempt(copyJournalKey(playlistDraft.playlistId)) : null;
  void recoveryRefresh; // changement explicite après écriture/effacement du journal

  const append = (m: AssistantMessage) => {
    if (!alive.current) return;
    messagesRef.current = [...messagesRef.current, stampAssistantMessage(m)]; setMessages(messagesRef.current);
  };
  const flushVoice = (role?: 'user' | 'assistant') => {
    const roles: ('user' | 'assistant')[] = role ? [role] : ['user', 'assistant'];
    for (const r of roles) {
      const value = partialRef.current[r].trim();
      if (value) append({ role: r, text: value });
      partialRef.current[r] = '';
    }
  };

  useEffect(() => {
    alive.current = true;
    const stopForAuth = (event: Event) => {
      operation.current++; busyRef.current = false; actionAbort.current?.abort(); actionAbort.current = null;
      liveRef.current?.stop(); liveRef.current = null; finishingLive.current?.stop(); finishingLive.current = null;
      partialRef.current = { user: '', assistant: '' };
      setPlan(null); setBlendDraft(null); setPlaylistDraft(null); setDestination(''); setMentionPickerOpen(false); setDraftMentions([]); setCaptureStatus(null); setAudioActivationRequired(false);
      setBusy(false); setResponding(false); setBusyLabel(''); setFinishing(false); setRecoveryQuery(null); restoredTask.current = null; setLiveOpen(false); setCreatedBlend(null); setSpeaking(false); setLiveQuote('');
      if (event.type === 'sb:auth-changing') {
        // Une conversation peut contenir les titres et noms privés d'un compte.
        // Ne jamais les montrer ou les renvoyer à Gemini dans le compte suivant.
        messagesRef.current = []; setMessages([]); setText(''); setCatalog([]); setCatalogSelected([]);
        setSource(''); setExtraSources([]); setInstruction(''); setNotice(null); setError('');
        setPrivacyOpen(false);
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && liveRef.current?.hasMicrophone()) {
        latest.current.stopVoice();
        if (alive.current) { setNotice({ text: 'Micro coupé en arrière-plan. La demande déjà transmise continue tant que le navigateur reste actif.' }); setLiveOpen(false); }
      }
    };
    window.addEventListener('sb:auth-changing', stopForAuth);
    window.addEventListener('sb:auth-expired', stopForAuth);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      alive.current = false; operation.current++;
      if (!ownsVoicePreparation(actionAbort.current)) actionAbort.current?.abort(); actionAbort.current = null;
      // Même la navigation vers une autre vue coupe seulement les dispositifs.
      // Le service garde ses propres gardes de compte et son délai de fin.
      liveRef.current?.finishInput(); liveRef.current = null; finishingLive.current = null;
      window.removeEventListener('sb:auth-changing', stopForAuth);
      window.removeEventListener('sb:auth-expired', stopForAuth);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  useEffect(() => {
    const restore = () => {
      const task = getVoicePreparation(conversationId);
      if (!task) {
        if(observedTask.current && actionAbort.current===observedTask.current.controller){busyRef.current=false;actionAbort.current=null;setBusy(false);setResponding(false);setLongResponse(false);setBusyLabel('');restoredTask.current=null;observedTask.current=null;}
        setHistoryVersion(v=>v+1); return;
      }
      const storedRun=getAssistantConversations().find(c=>c.id===conversationId)?.run;
      if (task.status === 'running') {
        observedTask.current=task;
        if(storedRun && storedRun.id!==task.run.id)return;
        busyRef.current = true; actionAbort.current = task.controller;
        setBusy(true); setResponding(true); setLongResponse(Date.now()-task.run.startedAt>=30000); setBusyLabel(task.run.stage || 'Gemini termine ta demande…');
        return;
      }
      if (restoredTask.current === task) return;
      busyRef.current = false; actionAbort.current = null; setBusy(false); setResponding(false); setLongResponse(false); setBusyLabel('');
      restoredTask.current = task;
      if(storedRun && storedRun.id!==task.run.id)return;
      if (task.error) { setError(task.run.status==='cancelled'?'':task.error); setRecoveryQuery(task.run.status==='cancelled'?null:recoverVoiceQuery()); return; }
      const result = task.result; if (!result) return;
      if(initial?.run?.id===task.run.id && initial.run.status==='done') {
        if(initial.snapshot.needsRefresh && result.prepared){setPlan(result.answer);setPlaylistDraft(result.playlistDraft);setBlendDraft(result.blendDraft || null);setNeedsRefresh(false);}
        return;
      }
      setNeedsRefresh(false);if(result.prepared)setCreatedBlend(null);
      messagesRef.current = result.messages; setMessages(result.messages);
      setCatalog(result.catalog); setCatalogSelected(result.selected);
      if (result.prepared) {
        setPlan(result.answer); setPlaylistDraft(result.playlistDraft); setBlendDraft(result.blendDraft || null); setDestination('');
        setSource(result.source); setExtraSources(result.extraSources); setInstruction(result.instruction); setMinutes(result.answer.durationMinutes);
      }
    };
    const unsubscribe = subscribeVoicePreparation(restore); restore(); return unsubscribe;
  }, [conversationId,initial]);

  useLayoutEffect(() => {
    if(sessionRevision.current!==accountRevision())return;
    const snapshot=cleanConversationSnapshot({text,draftMentions,plan,catalog,selected:catalogSelected,source,extraSources,instruction,minutes,needsRefresh:needsRefresh || !!plan && plan.action!=='blend'});
    persistedContent.current=JSON.stringify([messagesRef.current.map(stampAssistantMessage),snapshot]);
    saveAssistantConversation(conversationId,{messages:messagesRef.current,snapshot},sessionRevision.current);
  },[conversationId,messages,text,draftMentions,plan,catalog,catalogSelected,source,extraSources,instruction,minutes,needsRefresh]);
  useEffect(()=>{
    const remote=()=>{
      setHistoryVersion(v=>v+1);
      if(getVoicePreparation(conversationId)?.status==='running')return;
      const row=getAssistantConversations().find(c=>c.id===conversationId);if(!row)return;
      if(persistedContent.current===JSON.stringify([row.messages,row.snapshot]))return;
      persistedContent.current=JSON.stringify([row.messages,row.snapshot]);
      messagesRef.current=row.messages;setMessages(row.messages);
      const snap=row.snapshot;setText(snap.text);setDraftMentions(snap.draftMentions);setPlan(snap.plan);setCatalog(snap.catalog);setCatalogSelected(snap.selected);setSource(snap.source);setExtraSources(snap.extraSources);setInstruction(snap.instruction);setMinutes(snap.minutes);setNeedsRefresh(snap.needsRefresh);
      setBlendDraft(null);setPlaylistDraft(null);setDestination('');setCreatedBlend(null);
    };
    window.addEventListener('sb:assistant-history-remote',remote);
    return ()=>window.removeEventListener('sb:assistant-history-remote',remote);
  },[conversationId]);
  void historyVersion;
  const historicalRun=getAssistantConversations().find(c=>c.id===conversationId)?.run;
  const localTask=getVoicePreparation(conversationId);
  const detachedRun=historicalRun?.status==='running' && (localTask?.status!=='running' || localTask.run.id!==historicalRun.id);
  useEffect(()=>{
    if(!detachedRun || !youtubeService.isAuthenticated())return;
    const timer=window.setInterval(()=>{if(document.visibilityState!=='hidden')void syncNow();},15000);
    return ()=>clearInterval(timer);
  },[detachedRun,syncNow]);
  const interruptedRun=historicalRun && ['error','cancelled'].includes(historicalRun.status) && !busy;
  const relaunch=()=>{const query=[...messagesRef.current].reverse().find(m=>m.role==='user')?.text;if(query){setNeedsRefresh(false);void send(query.replace(/^Demande vocale à préparer : /,''),{voice:query.startsWith('Demande vocale à préparer : ')});}};

  // Ne pas arracher la lecture d'un ancien message lors d'une réponse.
  useEffect(() => {
    const onScroll = () => { stickToBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (stickToBottom.current && messages.length) chatEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [messages.length, busyLabel, plan]);
  useEffect(() => {
    const input = composerRef.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 144)}px`; }
    if (input && promptDecorRef.current) promptDecorRef.current.scrollTop = input.scrollTop;
  }, [text, liveOpen]);

  // Le portail échappe au transform de transition du Shell : fixed reste
  // relatif au viewport, même sur une conversation très longue.
  useLayoutEffect(() => {
    const dock = dockRef.current, page = pageRef.current;
    if (!dock || !page || liveOpen) return;
    const measure = () => page.style.setProperty('--sa-compose-height', `${dock.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure); observer.observe(dock); measure();
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      const keyboard = inset > 100;
      dock.dataset.keyboard = String(keyboard);
      dock.style.setProperty('--sa-keyboard', `${inset}px`);
    };
    viewport?.addEventListener('resize', updateViewport); viewport?.addEventListener('scroll', updateViewport); updateViewport();
    return () => { observer.disconnect(); viewport?.removeEventListener('resize', updateViewport); viewport?.removeEventListener('scroll', updateViewport); };
  }, [liveOpen]);

  const guardFor = (op: number, revision: number, serial: number, signal?: AbortSignal) => {
    assertAccountRevision(revision);
    if (!alive.current || op !== operation.current || signal?.aborted || serial !== youtubeService.sessionRevision()) {
      throw new Error('Préparation interrompue ou session modifiée.');
    }
  };

  const send = async (raw = text, opts: { voice?: boolean; signal?: AbortSignal; attachDraft?: boolean } = {}): Promise<boolean> => {
    const request = raw.trim();
    if (!request || request.length > 6000 || (getVoicePreparation(conversationId)?.status === 'running') || busyRef.current || generating || ((liveRef.current || finishingLive.current) && !opts.voice)) return false;
    if (!opts.voice) cancelVoicePreparation(conversationId);
    stickToBottom.current = true;
    const op = ++operation.current, revision = accountRevision();
    const controller = new AbortController(); actionAbort.current = controller;
    setLongResponse(false);
    // Information uniquement : ne pas annuler une analyse longue en cours.
    const responseTimer = window.setTimeout(() => { if (alive.current && op === operation.current && !controller.signal.aborted) setLongResponse(true); }, 30000);
    const cancel = () => controller.abort();
    if (opts.signal?.aborted) controller.abort(); else opts.signal?.addEventListener('abort', cancel, { once: true });
    const voiceTask = beginVoicePreparation(taskOwner.current, request, controller, conversationId, !!opts.voice);
    busyRef.current = true; setBusy(true); setResponding(true); setError(''); setNotice(null);
    const references = opts.attachDraft || opts.voice ? [...draftMentions] : [];
    if (!opts.voice && opts.attachDraft) { setText(''); setDraftMentions([]); }
    else if (!opts.voice && !draftMentions.length) setText('');
    const requestMessage = stampAssistantMessage({ role: 'user', text: opts.voice ? `Demande vocale à préparer : ${request}` : request, ...(references.length ? { references } : {}) });
    if (alive.current) append(requestMessage);
    else messagesRef.current = [...messagesRef.current, requestMessage];
    const conversation = [...messagesRef.current];
    saveAssistantConversation(conversationId,{messages:conversation,run:voiceTask.run},revision);
    setActiveConversationId(conversationId);
    const activeProposal = plan && (plan.action === 'blend' || plan.action === 'blend_edit') ? { action: plan.action, blendEdits: plan.blendEdits, title: plan.title, source: plan.action === 'blend_edit' && blendDraft ? { type: 'blend' as const, id: blendDraft.blendId } : source === 'catalog' ? null : (() => { const i = source.indexOf(':'); return { type: source.slice(0, i) as 'playlist' | 'blend', id: source.slice(i + 1) }; })(),
      extraSources: extraSources.map((key) => { const i = key.indexOf(':'); return { type: key.slice(0, i) as 'playlist' | 'blend', id: key.slice(i + 1) }; }), instruction, durationMinutes: minutes } : undefined;
    try {
      const result=await runVoicePreparation(voiceTask,()=>prepareAssistantConversation(voiceTask,{
        conversation,playlists,exclusions,proposal:activeProposal,catalog,selected:catalogSelected,references,loadPlaylistTracks,
      }));
      return !!result?.prepared;
    } finally {
      clearTimeout(responseTimer);opts.signal?.removeEventListener('abort',cancel);
      // Subscribers restore this task in whichever view is currently mounted.
      if(actionAbort.current===controller)actionAbort.current=null;
    }
  };

  const prepareFromCatalog = (tracks: Track[]) => {
    const selected = tracks.filter((t) => catalogSelected.includes(t.videoId) && !isAssistantTrackExcluded(t));
    if (!selected.length || busyRef.current || generating) return;
    setCreatedBlend(null); setBlendDraft(null); setCatalog(tracks); setCatalogSelected(selected.map((t) => t.videoId)); setPlaylistDraft(null); setDestination(''); setError('');
    setSource('catalog'); setExtraSources([]); setMinutes(45);
    const request = [...messagesRef.current].reverse().find((m) => m.role === 'user')?.text || 'Composer à partir des titres sélectionnés.';
    setInstruction(`Demandes de l’auditeur :\n${request}`.slice(0, 6000));
    setPlan({ reply: 'Blend préparé à partir des titres sélectionnés.', action: 'blend', source: null, extraSources: [], instruction: request,
      durationMinutes: 45, catalogQueries: [], catalogVideoIds: selected.map((t) => t.videoId), researchQuery: '', playlistEdits: null });
    window.setTimeout(() => { if (alive.current) planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
  };

  const launchBlend = async () => {
    if (!plan || (plan.action !== 'blend' && !(plan.action === 'blend_edit' && blendDraft?.mode === 'regenerate')) || !source || busyRef.current || generating) return;
    cancelVoicePreparation(conversationId);
    const op = ++operation.current, revision = accountRevision(), serial = youtubeService.sessionRevision();
    const guard = () => guardFor(op, revision, serial);
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (blendDraft) assertAssistantBlendDraft(blendDraft);
      const keys = [...new Set([source, ...extraSources])]; let tracks: Track[] = [];
      for (const key of keys) {
        if (key === 'catalog') { tracks.push(...catalog.filter((t) => catalogSelected.includes(t.videoId))); continue; }
        const colon = key.indexOf(':'), kind = key.slice(0, colon), id = key.slice(colon + 1);
        if (kind === 'playlist') {
          const p = playlists.find((x) => x.id === id); if (!p) throw new Error('Une playlist choisie n’est plus disponible.');
          setBusyLabel(`Lecture de « ${p.title} » sur YouTube…`);
          tracks.push(...(p.tracks || await loadPlaylistTracks(id))); guard();
        } else if (kind === 'blend') {
          const b = getStoredBlends().find((x) => x.id === id && Date.parse(x.expiresAt) > Date.now()); if (!b) throw new Error('Un blend choisi a expiré ou a été supprimé.');
          tracks.push(...b.tracks);
        }
      }
      // Les titres sélectionnés dans le catalogue peuvent compléter toute source.
      if (source !== 'catalog') tracks.push(...catalog.filter((t) => catalogSelected.includes(t.videoId)));
      const allowed = uniqueAssistantTracks(tracks, isAssistantTrackExcluded);
      if (!allowed.length) throw new Error('Les sources sont vides ou tous leurs titres sont bloqués.');
      if (!instruction.trim()) throw new Error('Précise ta consigne avant de générer.');
      const blend = await generate({ durationMinutes: minutes, ratio: { anchor: 30, deepDive: 30, fresh: 40 }, instruction: instruction.trim() }, { seeds: allowed, ...(blendDraft ? { replace: { id: blendDraft.blendId, signature: blendDraft.signature, title: blendDraft.after.title, description: blendDraft.after.description } } : {}) });
      guard();
      if (blend) { setCreatedBlend(blend); setPlan(null); setBlendDraft(null); showToast(`Blend enregistré : ${blend.tracks.length} titres.`); append({ role: 'assistant', text: blendDraft ? 'Ton blend a été modifié en place. Son identifiant est conservé ; son éventuelle playlist YouTube est inchangée.' : 'Ton blend est prêt et enregistré dans tes blends. Tu peux maintenant découvrir la sélection.' }); }
      else throw new Error('Aucun blend n’a été enregistré. Vérifie tes sources puis réessaie.');
    } catch (e: any) { if (alive.current && op === operation.current) setError(e?.message || 'La génération a échoué.'); }
    finally { if (alive.current && op === operation.current) { busyRef.current = false; setBusy(false); setBusyLabel(''); } }
  };

  const applyBlendEdits = () => {
    if (!blendDraft || blendDraft.mode !== 'tracks' || busyRef.current || generating) return;
    try {
      assertAssistantBlendDraft(blendDraft); updateBlend(blendDraft.after);
      const saved = getStoredBlends().find(b => b.id === blendDraft.blendId);
      cancelVoicePreparation(conversationId); setCreatedBlend(saved || null); setPlan(null); setBlendDraft(null); setError('');
      setNotice({ text: 'Blend modifié en place dans SoundBlend. Son identifiant et son expiration sont conservés. Rien n’a été envoyé à YouTube.' });
      append({ role: 'assistant', text: 'Les changements confirmés sont enregistrés dans ton blend existant.' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de modifier ce blend.'); }
  };

  const applyPlaylist = async () => {
    const draft = playlistDraft, choice = destination;
    if (!draft || !choice || busyRef.current || generating || recovery) return;
    cancelVoicePreparation(conversationId);
    const op = ++operation.current, revision = accountRevision(), serial = youtubeService.sessionRevision();
    const controller = new AbortController(); actionAbort.current = controller;
    const guard = () => guardFor(op, revision, serial, controller.signal);
    busyRef.current = true; setBusy(true); setError(''); setNotice(null);
    let started = false;
    try {
      if (draft.additions.some((t) => isAssistantTrackExcluded(t))) throw new Error('Un ajout a été bloqué depuis l’aperçu. Demande une nouvelle proposition.');
      if (choice === 'original') {
        setBusyLabel('Vérification puis application sur la playlist originale…'); started = true;
        const result = await youtubeService.applyAssistantPlaylistEdits(draft.playlistId, draft.snapshot,
          { removeItemIds: draft.removals.map((t) => t.id), moves: draft.moves.map(({ itemId, position }) => ({ itemId, position })), additions: draft.additions },
          (label) => { if (alive.current && op === operation.current) setBusyLabel(label); }, controller.signal);
        guard(); setNotice({ text: `Playlist originale vérifiée : ${result.added} ajout(s), ${result.removed} retrait(s), ${result.moved} déplacement(s).`, url: playlistLink(draft.playlistId) });
      } else {
        if (draft.after.length > 150) throw new Error('La copie est limitée à 150 titres pour éviter un trop grand nombre de requêtes.');
        if (draft.after.some((t) => !/^[A-Za-z0-9_-]{11}$/.test(t.videoId || ''))) throw new Error('Un titre de la copie est inaccessible.');
        setBusyLabel('Vérification de la playlist originale…');
        await assertAssistantSnapshot(draft); guard();
        const title = `${draft.title.slice(0, 115)} (copie SoundBlend)`;
        // Journal durable AVANT le POST : si la réponse se perd, pas de
        // création automatique d'un doublon au rechargement.
        let attempt = beginExportAttempt(copyJournalKey(draft.playlistId), title, 'private');
        setRecoveryRefresh((n) => n + 1); guard(); started = true;
        setBusyLabel('Création de la copie privée sur YouTube…');
        const id = await youtubeService.createPlaylist(title, `Copie préparée dans SoundBlend à partir de ${draft.title}.`, true);
        // Même si la vue vient d'être quittée, conserver le lien reçu pour ce
        // compte avant d'arrêter ; ne jamais l'enregistrer dans un autre.
        assertAccountRevision(revision);
        if (serial !== youtubeService.sessionRevision()) throw new Error('La session a changé pendant la création. Vérifie YouTube.');
        attempt = rememberExportPlaylist(attempt, id);
        if (alive.current && op === operation.current) setRecoveryRefresh((n) => n + 1);
        guard();
        await youtubeService.fillAssistantCopy(id, draft.after,
          (done, total) => { if (alive.current && op === operation.current) setBusyLabel(`Copie privée : ${done}/${total} titres…`); }, draft.additions, controller.signal);
        guard();
        const meta = await youtubeService.getPlaylistMeta(id); guard();
        if (meta.title !== title || meta.privacy !== 'private') throw new Error('YouTube n’a pas confirmé le nom et la confidentialité de la copie. Vérifie-la.');
        clearExportAttempt(attempt); setRecoveryRefresh((n) => n + 1);
        setNotice({ text: `Copie privée créée et vérifiée : ${draft.after.length} titre(s). La playlist originale est conservée.`, url: playlistLink(id) });
      }
      setPlan(null); setBlendDraft(null); setPlaylistDraft(null); setDestination('');
      void refreshLibrary().catch(() => {});
    } catch (e: any) {
      if (alive.current && op === operation.current) {
        const problem = e?.message || 'L’opération YouTube a échoué.';
        setError(`${problem}${started ? ' L’opération peut être partielle : vérifie YouTube avant toute nouvelle tentative.' : ''}`);
        if (choice === 'original' && started) { setNotice({ text: 'Vérifie l’état actuel de la playlist avant de demander un nouvel aperçu.', url: playlistLink(draft.playlistId) }); setPlan(null); setBlendDraft(null); setPlaylistDraft(null); setDestination(''); }
        setRecoveryRefresh((n) => n + 1);
      }
    } finally {
      if (actionAbort.current === controller) actionAbort.current = null;
      if (alive.current && op === operation.current) { busyRef.current = false; setBusy(false); setBusyLabel(''); }
    }
  };

  const clearRecovery = () => {
    if (!recovery || busyRef.current) return;
    try { clearExportAttempt(recovery); setRecoveryRefresh((n) => n + 1); setError('');
      setNotice({ text: 'Journal réinitialisé après vérification. Une nouvelle création demandera à nouveau ta confirmation.' }); }
    catch (e: any) { setError(e?.message || 'Impossible de réinitialiser ce journal.'); }
  };

  const handleVoiceTool = async (name: LiveToolName, query: string, signal: AbortSignal): Promise<Record<string, unknown>> => {
    if (signal.aborted) throw new Error('Demande vocale annulée.');
    const revision = accountRevision(), serial = youtubeService.sessionRevision();
    const guard = () => {
      assertAccountRevision(revision);
      if (!alive.current || signal.aborted || serial !== youtubeService.sessionRevision()) throw new Error('Demande vocale interrompue.');
    };
    if (name === 'proposer_action_musicale') {
      flushVoice();
      // Une demande acceptée appartient au chat, pas au dispositif micro.
      const ok = await send(query, { voice: true });
      assertAccountRevision(revision);
      if (serial !== youtubeService.sessionRevision()) throw new Error('Préparation interrompue.');
      return ok ? { statut: 'aperçu préparé', instruction: 'Ne prétends pas que l’action est faite. La personne doit vérifier puis cliquer sur le bouton.' }
        : { statut: 'aucun aperçu exécutable', instruction: 'Demande une précision ou signale que la préparation n’a pas abouti.' };
    }
    if (name === 'rechercher_morceaux') {
      if (!youtubeService.isAuthenticated()) throw new Error('Connecte le compte Google pour rechercher sur YouTube.');
      const tracks = await youtubeService.searchAssistantCatalog(query); guard();
      setCatalog(tracks); setCatalogSelected([]);
      append({ role: 'assistant', text: `Résultats YouTube pour « ${query} ».`, catalog: tracks });
      return { resultats: tracks.slice(0, 6).map((t) => ({ titre: t.title, artiste: t.artist, videoId: t.videoId })),
        precision: 'Résultats affichés à l’écran ; disponibilité réelle non garantie.' };
    }
    throw new Error('Outil vocal inconnu.');
  };

  const startVoice = async () => {
    if (liveRef.current || busyRef.current || generating) return;
    if (finishingLive.current) { setNotice({ text: 'La demande vocale précédente est encore en cours. Attends sa réponse avant de relancer le Live.' }); return; }
    setError(''); setNotice(null); setCaptureStatus(null); setAudioActivationRequired(false); partialRef.current = { user: '', assistant: '' }; setLiveQuote('');
    const key = getStoredSettings().geminiApiKey || GEMINI_API_KEY;
    if (!key.trim()) { setError('Ajoute une clé Gemini dans Réglages avant d’ouvrir le vocal.'); return; }
    if (isPlaying) togglePlay();
    const context = JSON.stringify({ playlists: playlists.slice(0, 60).map((p) => ({ titre: p.title, nombre: p.trackCount })),
      conversation: messagesRef.current.filter((m) => !m.grounded).slice(-10).map((m) => ({ role: m.role, text: m.text.slice(-800), referencesYouTube: (m.references || []).map(compactMention) })),
      referencesDuBrouillon: draftMentions.map(compactMention),
      texteDuBrouillon: draftMentions.length ? text.slice(-1000) : '',
      propositionEnCours: plan ? { titre: plan.title, source, consigne: instruction.slice(-2000), dureeMinutes: minutes } : null,
      blends: recentBlends.slice(0, 20).map((b) => ({ titre: b.title, nombre: b.tracks.length })),
      exclusions: { artistes: exclusions.artists, titres: exclusions.tracks.map((t) => ({ titre: t.title, artiste: t.artist })) } });
    const session = new GeminiLiveSession({
      onPhase: (phase, detail) => { if (alive.current && liveRef.current === session) { setLivePhase(phase); setLiveDetail(detail || ''); } },
      onTranscript: (role, part, finished) => {
        if (!alive.current || (liveRef.current !== session && finishingLive.current !== session)) return;
        partialRef.current[role] = mergeLiveTranscript(partialRef.current[role], part);
        setLiveQuote(partialRef.current[role]);
        if (finished) flushVoice(role);
      },
      onTurnComplete: () => { if (alive.current && (liveRef.current === session || finishingLive.current === session)) flushVoice(); },
      onDrained: (timedOut) => {
        if (finishingLive.current !== session) return;
        finishingLive.current = null; setFinishing(false);
        if (alive.current) { flushVoice(); setNotice(null); if (timedOut && !busyRef.current) setError('La réponse Live n’est pas arrivée à temps. Ta transcription est conservée ; renvoie-la dans le chat pour réessayer.'); }
      },
      onSpeaking: (value) => { if (alive.current && liveRef.current === session) setSpeaking(value); },
      onAudioActivationRequired: (required) => { if (alive.current && liveRef.current === session) setAudioActivationRequired(required); },
      onCaptureStatus: (status) => { if (alive.current && liveRef.current === session) setCaptureStatus(status); },
      onLevel: (level) => { if (liveRef.current === session) liveOrb.current?.style.setProperty('--voice-level', String(level)); },
      onTool: (name, query, signal) => latest.current.handleVoiceTool(name, query, signal),
      onError: (message) => { if (alive.current && (liveRef.current === session || finishingLive.current === session)) { flushVoice(); if (liveRef.current === session) liveRef.current = null; if (finishingLive.current === session) { finishingLive.current = null; setFinishing(false); } setError(message); } },
    });
    liveRef.current = session;
    try { await session.start(key, context, { encyclopedia: false, web: false, catalog: youtubeService.isAuthenticated() }); }
    catch (e: any) {
      session.stop();
      if (liveRef.current === session) { liveRef.current = null; if (alive.current) setError(e?.message || 'Impossible de démarrer le vocal.'); }
    }
  };
  const stopVoice = () => {
    flushVoice(); const session = liveRef.current;
    if (session) {
      finishingLive.current = session;
      const continues = session.finishInput(); liveRef.current = null;
      setFinishing(continues);
      if (!continues) finishingLive.current = null;
      else setNotice({ text: 'Micro coupé. Gemini termine la demande dans la conversation ; aucune action ne sera appliquée sans confirmation.' });
    }
    setLivePhase('off'); setSpeaking(false); setCaptureStatus(null); setAudioActivationRequired(false);
  };
  const closeLive = () => { stopVoice(); setLiveOpen(false); requestAnimationFrame(() => composerRef.current?.focus()); };
  useEffect(() => {
    if (!liveOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.sa-privacy[open], .sa-mention-picker[open]')) latest.current.closeLive(); };
    document.addEventListener('keydown', escape);
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('sb-live-close')?.focus();
    return () => document.removeEventListener('keydown', escape);
  }, [liveOpen]);
  useEffect(() => {
    if (!audioActivationRequired || !liveOpen || document.querySelector('.sa-privacy[open]')) return;
    const button = document.getElementById('sa-activate-audio');
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [audioActivationRequired, liveOpen]);
  useLayoutEffect(() => { latest.current = { handleVoiceTool, closeLive, stopVoice }; });
  const toggleCatalog = (id: string) => setCatalogSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id].slice(0, 20));
  const setExample = (value: string) => { setText(`${value}${draftMentions.length ? ` ${draftMentions.map(mentionToken).join(' ')}` : ''}`); composerRef.current?.focus({ preventScroll: true }); };

  const closeMentionPicker = () => {
    setMentionPickerOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
  };
  const removeDraftMention = (mention: AssistantMention) => {
    setDraftMentions((old) => old.filter((item) => mentionKey(item) !== mentionKey(mention)));
    if (!draftMentions.some((item) => mentionKey(item) !== mentionKey(mention) && mentionToken(item) === mentionToken(mention))) {
      setText((old) => old.split(mentionToken(mention)).join(''));
    }
  };
  const toggleDraftMention = (mention: AssistantMention) => {
    if (draftMentions.some((item) => mentionKey(item) === mentionKey(mention))) { removeDraftMention(mention); return; }
    if (draftMentions.length >= MAX_ASSISTANT_MENTIONS) return;
    const token = mentionToken(mention);
    if (text.length + token.length + 1 > 6000) { showToast('Ton message est trop long pour ajouter une référence.'); return; }
    setDraftMentions((old) => old.some((item) => mentionKey(item) === mentionKey(mention)) ? old : [...old, mention].slice(0, MAX_ASSISTANT_MENTIONS));
    setText((old) => old.includes(token) ? old : `${old}${old && !/\s$/.test(old) ? ' ' : ''}${token} `);
  };
  const changePrompt = (value: string) => {
    setText(value);
    setDraftMentions((old) => old.filter((mention) => value.includes(mentionToken(mention))));
  };

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const validBlends = recentBlends.filter((blend) => Date.parse(blend.expiresAt) > clock);
  const sourceTracks = uniqueAssistantTracks([
    ...[source, ...extraSources].flatMap((key) => key.startsWith('playlist:') ? playlists.find((p) => `playlist:${p.id}` === key)?.tracks || []
      : key.startsWith('blend:') ? validBlends.find((b) => `blend:${b.id}` === key)?.tracks || [] : []),
    ...catalog.filter((track) => catalogSelected.includes(track.videoId)),
  ], isAssistantTrackExcluded);
  const sourceChoices: AssistantSourceChoice[] = [
    ...playlists.map(p => ({ key: `playlist:${p.id}`, title: p.title, kind: 'playlist' as const, count: p.trackCount, tracks: p.tracks || [], thumbnail: p.thumbnailUrl })),
    ...validBlends.map(b => ({ key: `blend:${b.id}`, title: b.title, kind: 'blend' as const, count: b.tracks.length, tracks: b.tracks })),
    ...(catalogSelected.length ? [{ key: 'catalog', title: 'Tes titres YouTube choisis', kind: 'catalog' as const, count: catalogSelected.length, tracks: catalog.filter(t => catalogSelected.includes(t.videoId)) }] : []),
  ];
  const selectedSourceKey = [source, ...extraSources].join('|');
  const requestedSources = useRef(new Set<string>());
  useEffect(() => {
    if (!plan || !['blend', 'blend_edit'].includes(plan.action)) return;
    let active = true;
    for (const key of selectedSourceKey.split('|')) {
      const playlist = key.startsWith('playlist:') ? playlists.find(p => `playlist:${p.id}` === key) : null;
      const requestKey = `${youtubeService.sessionRevision()}:${key}`;
      if (!playlist || playlist.tracks || requestedSources.current.has(requestKey)) continue;
      requestedSources.current.add(requestKey);
      void loadPlaylistTracks(playlist.id).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Source indisponible.'); });
    }
    return () => { active = false; };
  }, [selectedSourceKey, plan, playlists, loadPlaylistTracks]);
  const sourceTitle = source.startsWith('playlist:') ? playlists.find((p) => `playlist:${p.id}` === source)?.title
    : source.startsWith('blend:') ? validBlends.find((b) => `blend:${b.id}` === source)?.title : 'Ta sélection YouTube';
  const resetConversation = () => {
    if (generating || liveRef.current || finishingLive.current) return;
    onSelectConversation(newConversationId());
  };
  const openCreatedBlend = () => {
    const saved = createdBlend && getStoredBlends().find((b) => b.id === createdBlend.id && Date.parse(b.expiresAt) > Date.now());
    if (!saved) { setError('Ce blend a expiré ou a été supprimé.'); return; }
    setCurrentBlend(saved); setView('blend');
  };

  return <div ref={pageRef} className={`ytm-page sb-assistant sb-assistant-studio${currentTrack ? ' has-player' : ''}${liveOpen ? ' is-live' : ''}`}>
    <header className="sa-header">
      {liveOpen && <button id="sb-live-close" type="button" className="sa-icon" onClick={closeLive} aria-label="Fermer le mode Live"><X size={20} /></button>}
      <div><h1>{liveOpen ? 'Assistant Live' : 'Assistant'}</h1><p>{liveOpen ? 'La musique, à voix haute' : 'Le son de tes envies'}</p></div>
      <div className="sa-header-actions">
        {!liveOpen && <button type="button" className="sa-icon" disabled={finishing || generating || livePhase !== 'off'} onClick={() => { setHistoryOpen(true); void syncNow(); }} aria-label="Nouvelle conversation" title="Discussions et nouvelle conversation" aria-haspopup="dialog"><Plus size={21} /></button>}
        <button type="button" className="sa-icon sa-privacy-trigger" onClick={() => setPrivacyOpen(true)} aria-label="Confidentialité de l’assistant" aria-haspopup="dialog" title="Confidentialité"><ShieldCheck size={18} /></button>
      </div>
    </header>
    {historyOpen && <AssistantHistoryPanel activeId={conversationId} onSelect={id=>{setHistoryOpen(false);onSelectConversation(id);}} onNew={resetConversation} onClose={()=>setHistoryOpen(false)} onRefresh={()=>void syncNow()} syncing={syncState.phase==='envoi'} syncLabel={!youtubeService.isAuthenticated()?'Conservé sur cet appareil. Connecte le même compte Google pour synchroniser.':syncState.phase==='pret'?'Discussions synchronisées avec ce compte Google.':syncState.message || 'Synchronisation du compte en cours…'}/>}
    {privacyOpen && <AssistantPrivacy onClose={() => setPrivacyOpen(false)} />}
    {mentionPickerOpen && <AssistantMentionPicker selected={draftMentions} onToggle={toggleDraftMention} onClose={closeMentionPicker} />}

    {liveOpen && <section className="sa-live" aria-label="Mode vocal en direct">
      <div className="sa-live-state" role="status"><i data-active={livePhase === 'listening'} /> {audioActivationRequired ? 'ACTIVATION AUDIO' : busy ? 'ON PRÉPARE TON ENVIE' : livePhase === 'connecting' ? 'CONNEXION EN COURS' : speaking ? 'L’ASSISTANT TE RÉPOND' : livePhase === 'muted' ? 'MICRO EN PAUSE' : livePhase === 'off' ? 'À VOIX HAUTE' : 'À TON ÉCOUTE'}</div>
      <h2>{audioActivationRequired ? 'Active l’audio.' : livePhase === 'connecting' ? 'On se retrouve…' : livePhase === 'muted' ? 'Prends ton temps.' : 'On suit ton envie.'}</h2>
      <div ref={liveOrb} className={`sa-orb sa-orb--live ${speaking ? 'is-speaking' : ''} ${livePhase === 'listening' ? 'is-listening' : ''}`} aria-hidden="true"><div className="sa-wave">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div></div>
      <div className="sa-live-words" aria-live="polite"><blockquote>{liveQuote ? `« ${liveQuote.slice(-500)} »` : livePhase === 'connecting' ? 'Juste un instant…' : 'Dis-moi ton envie musicale.'}</blockquote>
        <p>{busy ? busyLabel : liveDetail || (livePhase === 'off' ? 'Une humeur, un artiste… Dis-le simplement.' : '') || 'Parle naturellement, je m’occupe du reste.'}</p></div>
      {error && <p className="sb-assistant-error" role="alert">{error}</p>}
      {audioActivationRequired && <div className="sa-audio-activation"><p id="sa-audio-activation-hint">Le micro est autorisé, mais le moteur audio reste en pause. Essaie de le réactiver par un appui direct.</p><button type="button" className="sa-primary" id="sa-activate-audio" aria-describedby="sa-audio-activation-hint" onClick={event => liveRef.current?.activateAudio(event.isTrusted)}><AudioLines size={17} /> Activer l’audio</button></div>}
      {plan && <button type="button" className="sa-live-proposal" onClick={closeLive}><span className="sa-orb sa-orb--tiny" /><span><b>{plan.title || 'Ta proposition musicale'}</b><small>Aperçu prêt · à vérifier dans la conversation</small></span><ChevronRight size={17} /></button>}
      {captureStatus && livePhase !== 'off' && <p className="sa-live-signal" data-signal={captureStatus.signal && livePhase === 'listening'}><i />{livePhase === 'muted' ? 'Micro en pause' : audioActivationRequired ? 'Audio en pause' : captureStatus.signal ? 'Signal micro reçu' : 'En attente de signal micro'}</p>}
      {livePhase === 'off' ? <div className="sa-live-consent"><button type="button" className="sa-primary" onClick={() => void startVoice()} disabled={busy || generating}><Mic size={17} /> Réessayer le Live</button></div>
        : <div className="sa-live-controls">
          <button type="button" disabled={livePhase === 'connecting'} aria-label={livePhase === 'muted' ? 'Rouvrir le microphone' : 'Couper le microphone'} aria-pressed={livePhase === 'muted'} onClick={() => liveRef.current?.setMuted(livePhase !== 'muted')}><span>{livePhase === 'muted' ? <MicOff size={21} /> : <Mic size={21} />}</span><small>{livePhase === 'muted' ? 'Micro coupé' : livePhase === 'connecting' ? 'Micro autorisé' : 'Micro activé'}</small></button>
          <button type="button" className="sa-live-end" onClick={closeLive}><span><X size={24} /></span><small>Terminer</small></button>
          <button type="button" onClick={closeLive}><span><Keyboard size={20} /></span><small>Écrire</small></button>
        </div>}
      <details className="sa-live-volume">
        <summary><Volume2 size={14}/>{voiceVolume<1 ? `Son de la voix · ${Math.round(voiceVolume*100)} %` : 'Voix trop forte ?'}</summary>
        <p>Essaie d’abord les boutons du téléphone pendant que l’IA parle. Si cela ne suffit pas, ce réglage atténue uniquement sa voix sur cet appareil, pas ta musique ni le micro.</p>
        <div><label htmlFor="sa-live-voice-volume">Volume de secours de la voix IA</label><output htmlFor="sa-live-voice-volume">{Math.round(voiceVolume*100)} %</output></div>
        <input id="sa-live-voice-volume" type="range" min={0} max={100} step={1} value={Math.round(voiceVolume*100)} aria-label="Volume de secours de la voix IA" aria-valuetext={`${Math.round(voiceVolume*100)} pour cent`} onChange={e=>setLiveVoiceVolume(Number(e.target.value)/100)} style={{'--fill':`${voiceVolume*100}%`} as React.CSSProperties}/>
        <button type="button" className="sb-assistant-inline-button" onClick={()=>setLiveVoiceVolume(1)}>Réinitialiser l’atténuation</button>
        <p>Le navigateur peut utiliser le volume d’appel pendant que le micro est ouvert. Ce réglage local ne change pas les volumes du téléphone.</p>
      </details>
      <details className="sa-live-help"><summary>Le micro ne réagit pas ?</summary><p>Audio Live · révision 8</p>
        {captureStatus && <p className="sa-capture-diagnostic">Capture : {captureStatus.engine || 'initialisation'} · moteur {captureStatus.context}<br />Blocs reçus : {captureStatus.chunks} · envoyés : {captureStatus.sent}<br />{captureStatus.trackMuted ? 'Le périphérique signale un micro muet.' : captureStatus.signal ? 'Un signal audio a été reçu récemment.' : 'Aucun signal sonore mesuré récemment.'}</p>}
        <p>Si le moteur indique « suspended », utilise « Activer l’audio » : ce n’est pas un refus de permission. Une permission accordée ne garantit pas qu’un signal audio arrive. Si les blocs reçus augmentent mais que le signal reste nul, vérifie le coupe-micro Android, le casque/Bluetooth et les autres apps audio. Le Live essaie automatiquement un moteur de capture de secours.</p><p>Le Live nécessite une adresse HTTPS et une clé Gemini enregistrée sur cet appareil. Les réglages du PC ne sont pas automatiquement ceux du mobile.</p><p>Dans Chrome : ouvre les informations du site → Autorisations → Microphone → Autoriser. Sur Android, vérifie aussi Réglages → Applications → Chrome (ou l’app installée) → Autorisations → Microphone.</p><p>Si tu utilises un aperçu intégré, ouvre l’app dans un onglet Chrome normal. Une autorisation déjà accordée n’affiche pas forcément une nouvelle demande. Le statut ci-dessus indique l’étape en cours.</p></details>
      <p className="sa-live-foot">Micro transmis à Google via ta clé Gemini · quotas possibles.<br />Tu peux interrompre et terminer à tout moment. Aucune action sans confirmation à l’écran.</p>
    </section>}

    <div hidden={liveOpen} className={`sa-conversation${messages.length === 0 ? ' is-welcome' : ''}`}>
      {messages.length === 0 && <section className="sa-welcome" aria-label="Bienvenue dans l’assistant">
        <span className="sa-orb" aria-hidden="true" />
        <p className="sa-greeting">Bonjour{userProfile?.name?.trim() ? ` ${userProfile.name.trim().split(/\s+/)[0]}` : ''}.</p>
        <h2>Et si on trouvait<br />ton prochain son ?</h2>
        <p className="sa-intro">Une humeur, un artiste, quelques mots.<br />On en fait un blend qui te ressemble.</p>
        <div className="sa-inspiration"><h3>UN PEU D’INSPIRATION</h3>
          <button type="button" onClick={() => setExample('Fais-moi un blend jazz qui colle à mes goûts.')}><AudioLines size={18} /><span>Du jazz, mais à ma façon</span><ArrowUpRight size={16} /></button>
          <button type="button" onClick={() => setExample('Propose-moi un blend de pépites à découvrir à partir de ma bibliothèque.')}><Sparkles size={18} /><span>Des pépites à découvrir</span><ArrowUpRight size={16} /></button>
          <button type="button" onClick={() => setExample('Crée un blend pour ma soirée, avec une montée progressive en énergie.')}><Music2 size={18} /><span>La bande-son de ma soirée</span><ArrowUpRight size={16} /></button>
        </div>
      </section>}
      <div className="sb-chat" role="log" aria-label="Conversation avec l’assistant" aria-live="polite" aria-relevant="additions text">
        {messages.map((m, i) => <div className={`sb-chat-message sb-chat-message--${m.role}`} key={i}>
          {m.role === 'assistant' && <span className="sb-chat-label"><span className="sa-orb sa-orb--dot" /> Assistant</span>}<p>{m.references?.length ? promptWithTags(m.text, m.references) : m.text}</p>
          {!!m.references?.length && <div className="sa-message-mentions" aria-label="Références YouTube du message">{m.references.map((mention) => <a key={mentionKey(mention)} href={mentionUrl(mention)} target="_blank" rel="noopener noreferrer">{mention.kind === 'artist' ? '@' : '#'}{mention.title}<ExternalLink size={10} /></a>)}</div>}
          {m.catalog && <CatalogCard tracks={m.catalog} selected={catalogSelected} onToggle={toggleCatalog} onPrepare={() => prepareFromCatalog(m.catalog!)} />}
        </div>)}
        {busy && !generating && <AssistantThinking stage={busyLabel || 'Lecture de ton contexte musical…'} long={longResponse} />}
      </div>
      {assistantHistoryWarning() && <p className="sb-assistant-error" role="alert">{assistantHistoryWarning()}</p>}
      {(detachedRun || interruptedRun || needsRefresh) && !busy && <div className="sb-assistant-notice" role="status"><span>{detachedRun ? (historicalRun.runtime===assistantRuntime ? 'Cette demande n’est plus active dans cette page.' : 'Demande lancée dans une autre page ou sur un autre appareil. Elle peut continuer là-bas tant que son navigateur reste actif. Actualise pour récupérer son résultat ; aucune tâche ne s’exécute ici.') : needsRefresh ? 'Discussion restaurée. Pour ta sécurité, l’ancienne proposition de modification doit être préparée à nouveau avant une confirmation.' : historicalRun?.error || 'Cette demande a été interrompue.'}
        <button type="button" className="sb-assistant-inline-button" onClick={()=>void syncNow()}>Actualiser le résultat</button>
        <button type="button" className="sb-assistant-inline-button" disabled={generating || getVoicePreparation(conversationId)?.status==='running'} onClick={relaunch}>{needsRefresh?'Repréparer la proposition':'Relancer la demande ici'}</button>
      </span></div>}
      {error && <p className="sb-assistant-error" role="alert">{error}</p>}
      {recoveryQuery && <div className="sb-assistant-notice" role="status"><span>
        Une demande vocale a été interrompue : « {recoveryQuery} ». Seule sa consigne a été conservée, pas l’audio.
        <button type="button" className="sb-assistant-inline-button" disabled={busy || finishing || generating} onClick={() => { const query = recoveryQuery; setRecoveryQuery(null); void send(query, { voice: true }); }}>Reprendre la demande vocale</button>
        <button type="button" className="sb-assistant-inline-button" onClick={() => { forgetVoiceQuery(); setRecoveryQuery(null); }}>Oublier cette demande</button>
      </span></div>}
      {notice && <div className="sb-assistant-notice" role="status"><Check size={16} /><span>{notice.text}{notice.url && <> <a href={notice.url} target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube <ExternalLink size={12} /></a></>}</span></div>}

      {(plan?.action === 'blend' || (plan?.action === 'blend_edit' && blendDraft?.mode === 'regenerate')) && <>
        <section ref={planRef} className="sb-assistant-plan sa-blend-card" aria-label="Proposition de blend">
          <div className="sa-blend-heading"><AssistantMosaic tracks={sourceTracks} /><div><span className="sa-kicker">{blendDraft ? 'NOUVELLE DIRECTION · MÊME BLEND' : 'BLEND POUR TOI'}</span><h2>{blendDraft?.after.title || plan.title || 'À ta façon'}</h2><p>{blendDraft ? 'Remplacera le contenu du blend existant après confirmation' : `Objectif : ${minutes} min · à composer`}</p></div></div>
          <p className="sa-direction">{plan.instruction || 'Une sélection à ton image, entre repères et découvertes.'}</p>
          <div className="sa-seeds-label">Points de départ · {sourceTitle || 'Source à choisir'}</div>
          {sourceTracks.length > 0 ? <AssistantSeedPreview tracks={sourceTracks} /> : <p className="sa-small">Les pochettes s’affichent après le chargement des sources.</p>}
          <p className="sa-small">Ces titres inspirent le blend : ce n’est pas la sélection finale.</p>
          <details className="sa-adjust"><summary><Settings2 size={14} /> Ajuster les sources et la durée <ChevronDown size={14} /></summary>
            <fieldset disabled={busy || generating}>
              <AssistantSourcePalette choices={sourceChoices} primary={source} extras={extraSources} onChange={(primary, extras) => { setSource(primary); setExtraSources(extras); }} disabled={busy || generating} />
              <AssistantInstruction value={instruction} onChange={setInstruction} />
              <AssistantDuration minutes={minutes} onChange={setMinutes} />
            </fieldset>
          </details>
          <button type="button" className="sa-primary" disabled={busy || generating || !source || !instruction.trim() || (source === 'catalog' && !catalogSelected.length)} onClick={() => void launchBlend()}><WandSparkles size={16} /> {blendDraft ? 'Confirmer : recomposer ce blend' : 'Générer et ajouter à mes blends'}</button>
          <p className="sa-small sa-center">{blendDraft ? 'Le contenu actuel sera remplacé, sans copie et sans prolonger son expiration. Sa playlist YouTube reste inchangée.' : 'Rien ne sera modifié sur YouTube. Tes exclusions sont respectées.'}</p>
        </section>
        <div className="sa-followups" aria-label="Affiner ce blend">{(plan.followUps?.length ? plan.followUps : ['Plus jazzy', 'Plus de découvertes', 'Plus d’énergie']).map((followUp) => <button type="button" key={followUp} disabled={busy || generating} onClick={() => void send(followUp)}>{followUp}</button>)}</div>
      </>}

      {blendDraft?.mode === 'tracks' && plan?.action === 'blend_edit' && <section ref={planRef} className="sb-assistant-plan sa-blend-card" aria-label="Proposition de modification de blend">
        <div className="sa-blend-heading"><AssistantMosaic tracks={blendDraft.after.tracks} /><div><span className="sa-kicker">TON BLEND · AJUSTÉ, PAS DUPLIQUÉ</span><h2>{blendDraft.after.title}</h2><p>{blendDraft.before.tracks.length} → {blendDraft.after.tracks.length} titres · même identifiant</p></div></div>
        {blendDraft.before.title !== blendDraft.after.title && <p className="sa-direction">Nouveau nom : « {blendDraft.after.title} » (avant : « {blendDraft.before.title} »).</p>}
        {blendDraft.before.description !== blendDraft.after.description && <p className="sa-direction">Description proposée : {blendDraft.after.description}</p>}
        <div className="sb-plan-diff">{blendDraft.removals.map(t => <div key={t.id}><span className="sb-plan-sign sb-plan-sign--remove">−</span><p>Retirer <b>{t.title}</b> · {t.artist}</p></div>)}{blendDraft.moves.map((m, i) => <div key={`${m.trackId}-${i}`}><span className="sb-plan-sign">↕</span><p>Déplacer <b>{m.title}</b> → position {m.position + 1}</p></div>)}{blendDraft.additions.map(t => <div key={t.id}><span className="sb-plan-sign sb-plan-sign--add">+</span><p>Ajouter <b>{t.title}</b> · {t.artist} <a href={videoLink(t.videoId)} target="_blank" rel="noopener noreferrer">Vérifier <ExternalLink size={12} /></a></p></div>)}</div>
        <AssistantSeedPreview tracks={blendDraft.after.tracks} />
        <details className="sa-adjust"><summary>Voir les {blendDraft.after.tracks.length} titres après modification <ChevronDown size={14} /></summary><ol className="sb-plan-order">{blendDraft.after.tracks.map(t => <li key={t.id}>{t.title} <small>· {t.artist}</small></li>)}</ol></details>
        <p className="sa-small">L’original sera mis à jour dans SoundBlend. Son expiration et son export connu sont conservés ; aucun changement sur YouTube sans une action distincte.</p>
        <button type="button" className="sa-primary" disabled={busy || generating} onClick={applyBlendEdits}><Check size={16} /> Confirmer : modifier ce blend</button>
        <button type="button" className="sb-assistant-inline-button" disabled={busy || generating} onClick={() => { setPlan(null); setBlendDraft(null); }}>Annuler la modification</button>
      </section>}

      {createdBlend && <section className="sb-assistant-plan sa-blend-card" aria-label="Blend enregistré"><div className="sa-blend-heading"><PlaylistArt tracks={createdBlend.tracks} title={createdBlend.title} size={70} radius={12} /><div><span className="sa-kicker"><Check size={12} /> DANS TES BLENDS</span><h2>{createdBlend.title}</h2><p>{createdBlend.tracks.length} titres · enregistré dans SoundBlend</p></div></div>
        <AssistantSeedPreview tracks={createdBlend.tracks} />
        {createdBlend.tracks.length > 3 && <p className="sa-small">+ {createdBlend.tracks.length - 3} titres à découvrir</p>}
        {createdBlend.generation?.warning && <p className="sb-assistant-note">{createdBlend.generation.warning}</p>}
        <button type="button" className="sa-primary" onClick={openCreatedBlend}>Découvrir mon blend <ChevronRight size={16} /></button>
      </section>}

      {playlistDraft && plan?.action === 'playlist_edit' && <section ref={planRef} className="sb-assistant-plan sb-assistant-playlist-plan" aria-label="Proposition de modification de playlist">
        <div className="sb-assistant-plan-heading"><span><ListMusic size={18} /></span><div><strong>Proposition pour « {playlistDraft.title} »</strong><p>Rien n’a encore été modifié. Contrôle les changements et leur destination.</p></div></div>
        <div className="sb-plan-stats"><span>Avant <b>{playlistDraft.before.length}</b></span><span>Après <b>{playlistDraft.after.length}</b></span><span>Changements <b>{playlistDraft.removals.length + playlistDraft.moves.length + playlistDraft.additions.length}</b></span></div>
        <div className="sb-plan-diff">
          {playlistDraft.removals.map((t) => <div key={`rm-${t.id}`}><span className="sb-plan-sign sb-plan-sign--remove">−</span><p><b>Retirer</b> {t.title} <small>· {t.artist}</small></p></div>)}
          {playlistDraft.moves.map((m, i) => <div key={`move-${m.itemId}-${i}`}><span className="sb-plan-sign">↕</span><p><b>Déplacer</b> {m.title} <small>· {m.artist} → position {m.position + 1} à cette étape</small></p></div>)}
          {playlistDraft.additions.map((t) => <div key={`add-${t.videoId}`}><span className="sb-plan-sign sb-plan-sign--add">+</span><p><b>Ajouter en fin</b> {t.title} <small>· {t.artist}</small> <a href={videoLink(t.videoId)} target="_blank" rel="noopener noreferrer">Vérifier <ExternalLink size={12} /></a>{rawVideoTitle(t) && <small className="sb-plan-video-title">Titre YouTube : {rawVideoTitle(t)}</small>}</p></div>)}
        </div>
        <details className="sb-assistant-extra"><summary>Voir l’ordre complet proposé ({playlistDraft.after.length}) <ChevronDown size={14} /></summary>
          <ol className="sb-plan-order">{playlistDraft.after.map((t, i) => <li key={`${t.id}-${i}`}>{t.title} <small>· {t.artist}</small></li>)}</ol></details>
        <fieldset className="sb-plan-destination" disabled={busy || generating}><legend>Où appliquer cette proposition ?</legend>
          <label><input type="radio" name="sb-playlist-destination" checked={destination === 'original'} onChange={() => setDestination('original')} /> <span><b>Modifier l’originale</b><small>Les changements seront envoyés à la playlist YouTube existante.</small></span></label>
          <label><input type="radio" name="sb-playlist-destination" checked={destination === 'copy'} disabled={playlistDraft.after.length > 150} onChange={() => setDestination('copy')} /> <span><b>Créer une copie privée</b><small>L’originale reste intacte ; limite de 150 titres pour cette copie.</small></span></label>
        </fieldset>
        <p className="sb-assistant-note">Les écritures YouTube sont successives, consomment du quota et peuvent être partielles en cas de panne. Une modification simultanée sur un autre appareil peut échapper au contrôle. Les titres déjà présents sont conservés dans la copie, même s’ils figurent dans tes exclusions ; aucun titre bloqué n’est ajouté.</p>
        {recovery && !busy && <div className="sb-assistant-recovery" role="status"><strong>Une précédente création reste à vérifier</strong>
          <p>Une copie a peut-être été créée ou partiellement remplie. Aucune nouvelle création ne sera lancée automatiquement.</p>
          {recovery.playlistId && <a href={playlistLink(recovery.playlistId)} target="_blank" rel="noopener noreferrer">Ouvrir la copie connue <ExternalLink size={12} /></a>}
          <button type="button" onClick={clearRecovery} disabled={busy}>J’ai vérifié YouTube : autoriser une nouvelle tentative</button>
        </div>}
        <div className="sb-assistant-plan-bottom"><button type="button" className="sb-plan-cancel" disabled={busy} onClick={() => { setPlan(null); setBlendDraft(null); setPlaylistDraft(null); setDestination(''); }}>Annuler la proposition</button>
          <button type="button" className="btn" disabled={busy || generating || !destination || !!recovery} onClick={() => void applyPlaylist()}>
            <Check size={16} /> {destination === 'original' ? 'Confirmer : modifier l’originale' : destination === 'copy' ? 'Confirmer : créer la copie' : 'Choisis une destination'}</button></div>
      </section>}

      <div ref={chatEnd} className="sa-chat-end" />
      {createPortal(<div ref={dockRef} className={`sa-floating-compose${currentTrack ? ' has-player' : ''}`} hidden={liveOpen}>
      <form className="sa-compose" onSubmit={(e) => { e.preventDefault(); void send(text, { attachDraft: true }); }}>
        <label className="sr-only" htmlFor="sb-assistant-input">Ton message à l’assistant</label>
        <div className={`sa-prompt-field${draftMentions.length ? ' has-tags' : ''}`}>
          {draftMentions.length > 0 && <div ref={promptDecorRef} className="sa-prompt-decoration" aria-hidden="true">{promptWithTags(text, draftMentions)}{'\n'}</div>}
          <textarea ref={composerRef} id="sb-assistant-input" rows={1} maxLength={6000} value={text} onChange={(e) => changePrompt(e.target.value)} onScroll={(e) => { if (promptDecorRef.current) { promptDecorRef.current.scrollTop = e.currentTarget.scrollTop; promptDecorRef.current.scrollLeft = e.currentTarget.scrollLeft; } }} placeholder="Décris ton envie musicale…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text, { attachDraft: true }); } }} />
        </div>
        <div className="sa-compose-tools">
          <button type="button" className="sa-icon sa-mention-add" aria-label="Ajouter une référence YouTube" aria-haspopup="dialog" disabled={busy || generating} onClick={() => setMentionPickerOpen(true)}><Plus size={20} /></button>
          <button type="button" className="sa-live-button" disabled={busy || finishing || generating} aria-describedby="sa-live-disclosure" onClick={() => { setLiveOpen(true); void startVoice(); }}><span className="sa-orb sa-orb--trigger" aria-hidden="true" /> Live</button>
          <span id="sa-live-disclosure" className="sr-only">Démarrer le micro et le Live avec Google via ta clé Gemini. Quotas possibles. Tu peux arrêter à tout moment.</span>
          {responding && !generating && <button type="button" className="sa-send" aria-label="Arrêter la réponse" onClick={() => { operation.current++; cancelVoicePreparation(conversationId); setRecoveryQuery(null); finishingLive.current?.stop(); finishingLive.current = null; setFinishing(false); actionAbort.current?.abort(); actionAbort.current = null; busyRef.current = false; setBusy(false); setResponding(false); setBusyLabel(''); setNotice({ text: 'Réponse interrompue. Tu peux reformuler ta demande.' }); }}><X size={18} /></button>}
          <button type="submit" className="sa-send" disabled={!text.trim() || busy || finishing || generating} aria-label="Envoyer à l’assistant"><ArrowUp size={19} /></button>
        </div>
      </form>
      </div>, document.getElementById('root') || document.body)}
    </div>
  </div>;
};
