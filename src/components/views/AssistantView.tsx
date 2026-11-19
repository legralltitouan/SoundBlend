import { createPortal } from 'react-dom';
import { AssistantPrivacy } from './AssistantPrivacy';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp, ArrowUpRight, AudioLines, Check, ChevronDown, ChevronRight, ExternalLink,
  Keyboard, ListMusic, Loader2, Mic, MicOff, Music2, Plus, Settings2, ShieldCheck,
  Sparkles, X, WandSparkles,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { usePlayer } from '../../context/PlayerContext';
import { PlaylistArt } from '../ui/Art';
import { blendInstruction, mergeLiveTranscript, uniqueAssistantTracks } from '../../services/assistantConversation';
import './AssistantView.css';
import { useUI } from '../../context/UIContext';
import { geminiService, type AssistantMessage, type AssistantReply, type AssistantSource } from '../../services/gemini';
import { GeminiLiveSession, type LivePhase, type LiveToolName } from '../../services/geminiLive';
import { prepareAssistantPlaylistDraft, assertAssistantSnapshot, type AssistantPlaylistDraft } from '../../services/assistantPlaylist';
import { beginExportAttempt, clearExportAttempt, getExportAttempt, rememberExportPlaylist } from '../../services/exportRecovery';
import { accountRevision, assertAccountRevision } from '../../services/accountScope';
import { isAssistantTrackExcluded, youtubeService } from '../../services/youtube';
import { getStoredBlends, getStoredSettings } from '../../services/storage';
import { GEMINI_API_KEY } from '../../config/app';
import { norm } from '../../lib/track';
import type { GeneratedBlend, Playlist, Track } from '../../types';

const sourceKey = (s: AssistantSource) => `${s.type}:${s.id}`;
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
  const { playlists, recentBlends, exclusions, loadPlaylistTracks, refreshLibrary, generate, generating, userProfile, setCurrentBlend } = useData();
  const { setView, showToast } = useUI();
  const { currentTrack, isPlaying, togglePlay } = usePlayer();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [responding, setResponding] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [plan, setPlan] = useState<AssistantReply | null>(null);
  const [playlistDraft, setPlaylistDraft] = useState<AssistantPlaylistDraft | null>(null);
  const [destination, setDestination] = useState<'' | 'original' | 'copy'>('');
  const [recoveryRefresh, setRecoveryRefresh] = useState(0);
  const [source, setSource] = useState('');
  const [extraSources, setExtraSources] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Track[]>([]);
  const [catalogSelected, setCatalogSelected] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [minutes, setMinutes] = useState(45);
  const [createdBlend, setCreatedBlend] = useState<GeneratedBlend | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [liveQuote, setLiveQuote] = useState('');
  const liveOrb = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [livePhase, setLivePhase] = useState<LivePhase>('off');
  const [liveDetail, setLiveDetail] = useState('');
  const partialRef = useRef({ user: '', assistant: '' });
  const liveRef = useRef<GeminiLiveSession | null>(null);
  const alive = useRef(true), operation = useRef(0), busyRef = useRef(false);
  const actionAbort = useRef<AbortController | null>(null);
  const planRef = useRef<HTMLElement | null>(null);
  const latest = useRef<any>(null);
  const hasDemo = playlists.some((p) => p.id.startsWith('demo-pl-'));
  const recovery = playlistDraft ? getExportAttempt(copyJournalKey(playlistDraft.playlistId)) : null;
  void recoveryRefresh; // changement explicite après écriture/effacement du journal

  const append = (m: AssistantMessage) => {
    if (!alive.current) return;
    messagesRef.current = [...messagesRef.current, m]; setMessages(messagesRef.current);
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
      liveRef.current?.stop(); liveRef.current = null;
      partialRef.current = { user: '', assistant: '' };
      setPlan(null); setPlaylistDraft(null); setDestination('');
      setBusy(false); setResponding(false); setBusyLabel(''); setLiveOpen(false); setCreatedBlend(null); setSpeaking(false); setLiveQuote('');
      if (event.type === 'sb:auth-changing') {
        // Une conversation peut contenir les titres et noms privés d'un compte.
        // Ne jamais les montrer ou les renvoyer à Gemini dans le compte suivant.
        messagesRef.current = []; setMessages([]); setText(''); setCatalog([]); setCatalogSelected([]);
        setSource(''); setExtraSources([]); setInstruction(''); setNotice(null); setError('');
        setPrivacyOpen(false);
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && liveRef.current) {
        flushVoice(); liveRef.current.stop(); liveRef.current = null;
        if (alive.current) { setNotice({ text: 'Vocal arrêté parce que l’application est passée en arrière-plan.' }); setLiveOpen(false); }
      }
    };
    window.addEventListener('sb:auth-changing', stopForAuth);
    window.addEventListener('sb:auth-expired', stopForAuth);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      alive.current = false; operation.current++; actionAbort.current?.abort(); actionAbort.current = null; liveRef.current?.stop(); liveRef.current = null;
      window.removeEventListener('sb:auth-changing', stopForAuth);
      window.removeEventListener('sb:auth-expired', stopForAuth);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

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

  const validSource = (s: AssistantSource | null, pls: Playlist[]) => !!s && (s.type === 'playlist'
    ? pls.some((p) => p.id === s.id) : getStoredBlends().some((b) => b.id === s.id && Date.parse(b.expiresAt) > Date.now()));
  const guardFor = (op: number, revision: number, serial: number, signal?: AbortSignal) => {
    assertAccountRevision(revision);
    if (!alive.current || op !== operation.current || signal?.aborted || serial !== youtubeService.sessionRevision()) {
      throw new Error('Préparation interrompue ou session modifiée.');
    }
  };

  const send = async (raw = text, opts: { voice?: boolean; signal?: AbortSignal } = {}): Promise<boolean> => {
    const request = raw.trim();
    if (!request || request.length > 6000 || busyRef.current || generating || (liveRef.current && !opts.voice)) return false;
    stickToBottom.current = true;
    const op = ++operation.current, revision = accountRevision(), serial = youtubeService.sessionRevision();
    const controller = new AbortController(); actionAbort.current = controller;
    let timedOut = false;
    const responseTimer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 90000);
    const cancel = () => controller.abort();
    if (opts.signal?.aborted) controller.abort(); else opts.signal?.addEventListener('abort', cancel, { once: true });
    const guard = () => guardFor(op, revision, serial, controller.signal);
    busyRef.current = true; setBusy(true); setResponding(true); setError(''); setNotice(null);
    if (!opts.voice) setText('');
    append({ role: 'user', text: opts.voice ? `Demande vocale à préparer : ${request}` : request });
    const conversation = [...messagesRef.current];
    const activeProposal = plan?.action === 'blend' ? { title: plan.title, source: source === 'catalog' ? null : (() => { const i = source.indexOf(':'); return { type: source.slice(0, i) as 'playlist' | 'blend', id: source.slice(i + 1) }; })(),
      extraSources: extraSources.map((key) => { const i = key.indexOf(':'); return { type: key.slice(0, i) as 'playlist' | 'blend', id: key.slice(i + 1) }; }), instruction, durationMinutes: minutes } : undefined;
    let prepared = false;
    try {
      setBusyLabel('Lecture de ton contexte musical…');
      let contextPlaylists = playlists.map((p) => ({ ...p }));
      const namedText = norm(conversation.filter((m) => m.role === 'user').map((m) => m.text).join(' '));
      const named = contextPlaylists.filter((p) => norm(p.title).length >= 3 && namedText.includes(norm(p.title)) && !p.tracks);
      for (const p of named.slice(0, 3)) {
        const tracks = await loadPlaylistTracks(p.id); guard();
        contextPlaylists = contextPlaylists.map((x) => x.id === p.id ? { ...x, tracks } : x);
      }
      const ask = async (catalogData: Track[] = []) => {
        guard(); setBusyLabel('Gemini réfléchit à ta demande…');
        const r = await geminiService.converse(conversation, contextPlaylists, getStoredBlends(), exclusions,
          { catalog: catalogData, proposal: activeProposal, signal: controller.signal });
        guard(); return r;
      };
      const previousCatalog = catalog.filter((track) => catalogSelected.includes(track.videoId) && !isAssistantTrackExcluded(track));
      let answer = await ask(previousCatalog);
      // Une source devinée par son nom doit être lue entièrement avant de
      // proposer quoi que ce soit, même quand elle n'était pas nommée.
      const loadChosen = async (r: AssistantReply): Promise<boolean> => {
        const needed = [r.source, ...r.extraSources].filter((s): s is AssistantSource => !!s && s.type === 'playlist');
        let loaded = false;
        for (const s of needed.slice(0, 4)) {
          const p = contextPlaylists.find((x) => x.id === s.id);
          if (p && !p.tracks) {
            setBusyLabel(`Lecture de « ${p.title} » sur YouTube…`);
            const tracks = await loadPlaylistTracks(p.id); guard();
            contextPlaylists = contextPlaylists.map((x) => x.id === p.id ? { ...x, tracks } : x); loaded = true;
          }
        }
        return loaded;
      };
      if (await loadChosen(answer)) answer = await ask(previousCatalog);
      guard();
      const warnings: string[] = [];
      let found: Track[] = [...previousCatalog];
      if (answer.catalogQueries.length) {
        if (!youtubeService.isAuthenticated()) warnings.push('Connecte ton compte Google pour rechercher des morceaux sur YouTube.');
        else {
          setBusyLabel('Recherche musicale sur YouTube…');
          for (const query of answer.catalogQueries.slice(0, 2)) {
            try {
              const result = await youtubeService.searchAssistantCatalog(query); guard();
              found.push(...result.filter((t) => !found.some((x) => x.videoId === t.videoId)));
            } catch (e: any) { guard(); warnings.push(e?.message || 'Recherche YouTube indisponible.'); break; }
          }
        }
      }
      if (found.some((track) => !previousCatalog.some((old) => old.videoId === track.videoId))) {
        answer = await ask(found);
        if (await loadChosen(answer)) answer = await ask(found);
      }
      guard(); setCatalog(found);
      const recommended = [...new Set([...answer.catalogVideoIds, ...catalogSelected])].filter((id) => found.some((t) => t.videoId === id && !isAssistantTrackExcluded(t)));
      setCatalogSelected(recommended);
      if (answer.source && !validSource(answer.source, contextPlaylists)) {
        answer = { ...answer, action: 'none', source: null,
          reply: `${answer.reply}\n\nJe ne retrouve pas cette source dans ta bibliothèque. Précise son nom.` };
      }
      const replyText = `${answer.reply}${warnings.length ? `\n\n${warnings.join(' ')}` : ''}`;
      append({ role: 'assistant', text: replyText, ...(answer.catalogQueries.length || found.length ? { catalog: found } : {}) });
      if (answer.action === 'playlist_edit') {
        if (!answer.source || answer.source.type !== 'playlist' || !answer.playlistEdits) {
          setError('Il me manque la playlist ou les changements précis. Demande une nouvelle proposition en indiquant les titres.');
        } else {
          const p = contextPlaylists.find((x) => x.id === answer.source!.id);
          if (!p) throw new Error('Cette playlist n’est plus disponible.');
          setBusyLabel('Vérification complète de la playlist et préparation de l’aperçu…');
          const proposal = await prepareAssistantPlaylistDraft(p, answer.playlistEdits); guard();
          setCreatedBlend(null); setPlaylistDraft(proposal); setPlan(answer); setDestination(''); prepared = true;
        }
      } else if (answer.action === 'blend' && (validSource(answer.source, contextPlaylists) || recommended.length)) {
        setCreatedBlend(null); setPlan(answer); setPlaylistDraft(null); setDestination('');
        setSource(answer.source && validSource(answer.source, contextPlaylists) ? sourceKey(answer.source) : 'catalog');
        setExtraSources([...new Set(answer.extraSources.filter((s) => validSource(s, contextPlaylists) && (!answer.source || sourceKey(s) !== sourceKey(answer.source))).map(sourceKey))].slice(0, 3));
        setInstruction(blendInstruction(answer.instruction, conversation.filter((m) => m.role === 'user').map((m) => m.text)));
        setMinutes(answer.durationMinutes); prepared = true;
      }
      // L'aperçu reste en place pendant le Live ; aucun défilement forcé.
      return prepared;
    } catch (e: any) {
      if (alive.current && op === operation.current && (timedOut || !controller.signal.aborted)) setError(timedOut ? 'La réponse a dépassé le délai. Ta proposition précédente est conservée ; tu peux réessayer.' : e?.message || 'Impossible de préparer la réponse.');
      return false;
    } finally {
      clearTimeout(responseTimer);
      opts.signal?.removeEventListener('abort', cancel);
      if (actionAbort.current === controller) actionAbort.current = null;
      if (alive.current && op === operation.current) { busyRef.current = false; setBusy(false); setResponding(false); setBusyLabel(''); }
    }
  };

  const prepareFromCatalog = (tracks: Track[]) => {
    const selected = tracks.filter((t) => catalogSelected.includes(t.videoId) && !isAssistantTrackExcluded(t));
    if (!selected.length || busyRef.current || generating) return;
    setCreatedBlend(null); setCatalog(tracks); setCatalogSelected(selected.map((t) => t.videoId)); setPlaylistDraft(null); setDestination(''); setError('');
    setSource('catalog'); setExtraSources([]); setMinutes(45);
    const request = [...messagesRef.current].reverse().find((m) => m.role === 'user')?.text || 'Composer à partir des titres sélectionnés.';
    setInstruction(`Demandes de l’auditeur :\n${request}`.slice(0, 6000));
    setPlan({ reply: 'Blend préparé à partir des titres sélectionnés.', action: 'blend', source: null, extraSources: [], instruction: request,
      durationMinutes: 45, catalogQueries: [], catalogVideoIds: selected.map((t) => t.videoId), researchQuery: '', playlistEdits: null });
    window.setTimeout(() => { if (alive.current) planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
  };

  const launchBlend = async () => {
    if (!plan || plan.action !== 'blend' || !source || busyRef.current || generating) return;
    const op = ++operation.current, revision = accountRevision(), serial = youtubeService.sessionRevision();
    const guard = () => guardFor(op, revision, serial);
    busyRef.current = true; setBusy(true); setError('');
    try {
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
      const blend = await generate({ durationMinutes: minutes, ratio: { anchor: 30, deepDive: 30, fresh: 40 }, instruction: instruction.trim() }, { seeds: allowed });
      guard();
      if (blend) { setCreatedBlend(blend); setPlan(null); showToast(`Blend enregistré : ${blend.tracks.length} titres.`); append({ role: 'assistant', text: 'Ton blend est prêt et enregistré dans tes blends. Tu peux maintenant découvrir la sélection.' }); }
      else throw new Error('Aucun blend n’a été enregistré. Vérifie tes sources puis réessaie.');
    } catch (e: any) { if (alive.current && op === operation.current) setError(e?.message || 'La génération a échoué.'); }
    finally { if (alive.current && op === operation.current) { busyRef.current = false; setBusy(false); setBusyLabel(''); } }
  };

  const applyPlaylist = async () => {
    const draft = playlistDraft, choice = destination;
    if (!draft || !choice || busyRef.current || generating || recovery) return;
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
      setPlan(null); setPlaylistDraft(null); setDestination('');
      void refreshLibrary().catch(() => {});
    } catch (e: any) {
      if (alive.current && op === operation.current) {
        const problem = e?.message || 'L’opération YouTube a échoué.';
        setError(`${problem}${started ? ' L’opération peut être partielle : vérifie YouTube avant toute nouvelle tentative.' : ''}`);
        if (choice === 'original' && started) { setNotice({ text: 'Vérifie l’état actuel de la playlist avant de demander un nouvel aperçu.', url: playlistLink(draft.playlistId) }); setPlan(null); setPlaylistDraft(null); setDestination(''); }
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
      const ok = await send(query, { voice: true, signal }); guard();
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
    setError(''); setNotice(null); partialRef.current = { user: '', assistant: '' }; setLiveQuote('');
    const key = getStoredSettings().geminiApiKey || GEMINI_API_KEY;
    if (!key.trim()) { setError('Ajoute une clé Gemini dans Réglages avant d’ouvrir le vocal.'); return; }
    if (isPlaying) togglePlay();
    const context = JSON.stringify({ playlists: playlists.slice(0, 60).map((p) => ({ titre: p.title, nombre: p.trackCount })),
      conversation: messagesRef.current.filter((m) => !m.grounded).slice(-10).map((m) => ({ role: m.role, text: m.text.slice(-800) })),
      propositionEnCours: plan ? { titre: plan.title, source, consigne: instruction.slice(-2000), dureeMinutes: minutes } : null,
      blends: recentBlends.slice(0, 20).map((b) => ({ titre: b.title, nombre: b.tracks.length })),
      exclusions: { artistes: exclusions.artists, titres: exclusions.tracks.map((t) => ({ titre: t.title, artiste: t.artist })) } });
    const session = new GeminiLiveSession({
      onPhase: (phase, detail) => { if (alive.current && liveRef.current === session) { setLivePhase(phase); setLiveDetail(detail || ''); } },
      onTranscript: (role, part, finished) => {
        if (!alive.current || liveRef.current !== session) return;
        partialRef.current[role] = mergeLiveTranscript(partialRef.current[role], part);
        setLiveQuote(partialRef.current[role]);
        if (finished) flushVoice(role);
      },
      onTurnComplete: () => { if (alive.current && liveRef.current === session) flushVoice(); },
      onSpeaking: (value) => { if (alive.current && liveRef.current === session) setSpeaking(value); },
      onLevel: (level) => { if (liveRef.current === session) liveOrb.current?.style.setProperty('--voice-level', String(level)); },
      onTool: (name, query, signal) => latest.current.handleVoiceTool(name, query, signal),
      onError: (message) => { if (alive.current && liveRef.current === session) { flushVoice(); liveRef.current = null; setError(message); } },
    });
    liveRef.current = session;
    try { await session.start(key, context, { encyclopedia: false, web: false, catalog: youtubeService.isAuthenticated() }); }
    catch (e: any) {
      if (liveRef.current === session) { liveRef.current = null; if (alive.current) setError(e?.message || 'Impossible de démarrer le vocal.'); }
    }
  };
  const stopVoice = () => { flushVoice(); liveRef.current?.stop(); liveRef.current = null; setLivePhase('off'); setSpeaking(false); };
  const closeLive = () => { stopVoice(); setLiveOpen(false); requestAnimationFrame(() => composerRef.current?.focus()); };
  useEffect(() => {
    if (!liveOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.sa-privacy[open]')) latest.current.closeLive(); };
    document.addEventListener('keydown', escape);
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('sb-live-close')?.focus();
    return () => document.removeEventListener('keydown', escape);
  }, [liveOpen]);
  useLayoutEffect(() => { latest.current = { handleVoiceTool, closeLive }; });
  const toggleCatalog = (id: string) => setCatalogSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id].slice(0, 20));
  const toggleExtra = (value: string) => setExtraSources((old) => old.includes(value) ? old.filter((x) => x !== value) : [...old, value].slice(0, 3));
  const setExample = (value: string) => { setText(value); composerRef.current?.focus({ preventScroll: true }); };

  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const validBlends = recentBlends.filter((blend) => Date.parse(blend.expiresAt) > clock);
  const sourceTracks = uniqueAssistantTracks([
    ...[source, ...extraSources].flatMap((key) => key.startsWith('playlist:') ? playlists.find((p) => `playlist:${p.id}` === key)?.tracks || []
      : key.startsWith('blend:') ? validBlends.find((b) => `blend:${b.id}` === key)?.tracks || [] : []),
    ...catalog.filter((track) => catalogSelected.includes(track.videoId)),
  ], isAssistantTrackExcluded);
  const sourceTitle = source.startsWith('playlist:') ? playlists.find((p) => `playlist:${p.id}` === source)?.title
    : source.startsWith('blend:') ? validBlends.find((b) => `blend:${b.id}` === source)?.title : 'Ta sélection YouTube';
  const resetConversation = () => {
    if (busyRef.current || generating || liveRef.current) return;
    messagesRef.current = []; setMessages([]); setPlan(null); setPlaylistDraft(null); setCreatedBlend(null);
    setCatalog([]); setCatalogSelected([]); setSource(''); setExtraSources([]); setInstruction(''); setMinutes(45);
    setNotice(null); setError(''); setText(''); setLiveQuote(''); composerRef.current?.focus({ preventScroll: true });
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
        {!liveOpen && <button type="button" className="sa-icon" disabled={busy || generating || livePhase !== 'off'} onClick={resetConversation} aria-label="Nouvelle conversation" title="Nouvelle conversation"><Plus size={21} /></button>}
        <button type="button" className="sa-icon sa-privacy-trigger" onClick={() => setPrivacyOpen(true)} aria-label="Confidentialité de l’assistant" aria-haspopup="dialog" title="Confidentialité"><ShieldCheck size={18} /></button>
      </div>
    </header>
    {privacyOpen && <AssistantPrivacy onClose={() => setPrivacyOpen(false)} />}

    {liveOpen && <section className="sa-live" aria-label="Mode vocal en direct">
      <div className="sa-live-state" role="status"><i data-active={livePhase === 'listening'} /> {busy ? 'ON PRÉPARE TON ENVIE' : livePhase === 'connecting' ? 'CONNEXION EN COURS' : speaking ? 'L’ASSISTANT TE RÉPOND' : livePhase === 'muted' ? 'MICRO EN PAUSE' : livePhase === 'off' ? 'À VOIX HAUTE' : 'À TON ÉCOUTE'}</div>
      <h2>{livePhase === 'connecting' ? 'On se retrouve…' : livePhase === 'muted' ? 'Prends ton temps.' : 'On suit ton envie.'}</h2>
      <div ref={liveOrb} className={`sa-orb sa-orb--live ${speaking ? 'is-speaking' : ''} ${livePhase === 'listening' ? 'is-listening' : ''}`} aria-hidden="true"><div className="sa-wave">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ '--i': i } as React.CSSProperties} />)}</div></div>
      <div className="sa-live-words" aria-live="polite"><blockquote>{liveQuote ? `« ${liveQuote.slice(-500)} »` : '« Un peu plus de groove, et garde cette ambiance. »'}</blockquote>
        <p>{busy ? busyLabel : livePhase === 'off' ? 'Une humeur, un artiste… Dis-le simplement.' : liveDetail || 'Parle naturellement, je m’occupe du reste.'}</p></div>
      {error && <p className="sb-assistant-error" role="alert">{error}</p>}
      {plan && <button type="button" className="sa-live-proposal" onClick={closeLive}><span className="sa-orb sa-orb--tiny" /><span><b>{plan.title || 'Ta proposition musicale'}</b><small>Aperçu prêt · à vérifier dans la conversation</small></span><ChevronRight size={17} /></button>}
      {livePhase === 'off' ? <div className="sa-live-consent"><p><ShieldCheck size={14} /> En démarrant, tu autorises l’envoi du micro à Google via ta clé Gemini. Quotas et frais possibles. Un casque est conseillé.</p>
        <button type="button" className="sa-primary" onClick={() => void startVoice()} disabled={busy || generating}><Mic size={17} /> Démarrer le vocal</button></div>
        : <div className="sa-live-controls">
          <button type="button" disabled={livePhase === 'connecting'} aria-label={livePhase === 'muted' ? 'Rouvrir le microphone' : 'Couper le microphone'} aria-pressed={livePhase === 'muted'} onClick={() => liveRef.current?.setMuted(livePhase !== 'muted')}><span>{livePhase === 'muted' ? <MicOff size={21} /> : <Mic size={21} />}</span><small>{livePhase === 'muted' ? 'Micro coupé' : 'Micro activé'}</small></button>
          <button type="button" className="sa-live-end" onClick={closeLive}><span><X size={24} /></span><small>Terminer</small></button>
          <button type="button" onClick={closeLive}><span><Keyboard size={20} /></span><small>Écrire</small></button>
        </div>}
      <p className="sa-live-foot">Tu peux m’interrompre à tout moment.<br />Aucune action sans confirmation à l’écran.</p>
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
          {m.role === 'assistant' && <span className="sb-chat-label"><span className="sa-orb sa-orb--dot" /> Assistant</span>}<p>{m.text}</p>
          {m.catalog && <CatalogCard tracks={m.catalog} selected={catalogSelected} onToggle={toggleCatalog} onPrepare={() => prepareFromCatalog(m.catalog!)} />}
        </div>)}
        {busy && !generating && <div className="sb-chat-thinking"><Loader2 size={15} className="anim-spin" /> {busyLabel || 'Un instant…'}</div>}
      </div>
      {error && <p className="sb-assistant-error" role="alert">{error}</p>}
      {notice && <div className="sb-assistant-notice" role="status"><Check size={16} /><span>{notice.text}{notice.url && <> <a href={notice.url} target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube <ExternalLink size={12} /></a></>}</span></div>}

      {plan?.action === 'blend' && <>
        <section ref={planRef} className="sb-assistant-plan sa-blend-card" aria-label="Proposition de blend">
          <div className="sa-blend-heading"><div className="sa-cover"><span>{(plan.title || 'TON BLEND').slice(0, 45)}</span><small>SOUNDBLEND</small></div>
            <div><span className="sa-kicker">BLEND POUR TOI</span><h2>{plan.title || 'À ta façon'}</h2><p>Objectif : {minutes} min · à composer</p></div></div>
          <p className="sa-direction">{plan.instruction || 'Une sélection à ton image, entre repères et découvertes.'}</p>
          <div className="sa-seeds-label">Points de départ · {sourceTitle || 'Source à choisir'}</div>
          {sourceTracks.length > 0 ? <ol className="sa-track-preview">{sourceTracks.slice(0, 3).map((track, i) => <li key={track.videoId}><span>{String(i + 1).padStart(2, '0')}</span><div><b>{track.title}</b><small>{track.artist}</small></div><time>{track.durationFormatted || (track.durationSeconds ? `${Math.floor(track.durationSeconds / 60)}:${String(track.durationSeconds % 60).padStart(2, '0')}` : '—')}</time></li>)}</ol>
            : <p className="sa-small">Les morceaux de cette source seront chargés à la génération.</p>}
          <p className="sa-small">Ces titres inspirent le blend : ce n’est pas la sélection finale.</p>
          <details className="sa-adjust"><summary><Settings2 size={14} /> Ajuster les sources et la durée <ChevronDown size={14} /></summary>
            <fieldset disabled={busy || generating}>
              <label>Source principale<select aria-label="Source du blend" value={source} onChange={(e) => { setSource(e.target.value); setExtraSources((old) => old.filter((key) => key !== e.target.value)); }}><option value="" disabled>Choisir une source</option>
                <optgroup label={hasDemo ? 'Playlists de démonstration' : 'Playlists YouTube Music'}>{playlists.map((p) => <option key={p.id} value={`playlist:${p.id}`}>{p.title}</option>)}</optgroup>
                <optgroup label="Blends valides">{validBlends.map((b) => <option key={b.id} value={`blend:${b.id}`}>{b.title}</option>)}</optgroup>
                {catalogSelected.length > 0 && <option value="catalog">Titres YouTube sélectionnés ({catalogSelected.length})</option>}</select></label>
              {(playlists.length + validBlends.length > 1) && <details className="sb-assistant-extra"><summary>Autres sources ({extraSources.filter((key) => key !== source).length}/3) <ChevronDown size={14} /></summary>
                <div>{[...playlists.map((p) => ({ value: `playlist:${p.id}`, label: p.title })), ...validBlends.map((b) => ({ value: `blend:${b.id}`, label: b.title }))].filter((x) => x.value !== source).map((x) => <label key={x.value}><input type="checkbox" checked={extraSources.includes(x.value)} disabled={!extraSources.includes(x.value) && extraSources.length >= 3} onChange={() => toggleExtra(x.value)} /> {x.label}</label>)}</div></details>}
              <label>Consigne transmise à Gemini<textarea aria-label="Consigne transmise à Gemini" value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4} maxLength={6000} /></label>
              <label>Durée souhaitée<select aria-label="Durée du blend" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[20, 45, 60, 120].map((n) => <option key={n} value={n}>{n} min</option>)}{![20, 45, 60, 120].includes(minutes) && <option value={minutes}>{minutes} min</option>}</select></label>
            </fieldset>
          </details>
          <button type="button" className="sa-primary" disabled={busy || generating || !source || !instruction.trim() || (source === 'catalog' && !catalogSelected.length)} onClick={() => void launchBlend()}><WandSparkles size={16} /> Générer et ajouter à mes blends</button>
          <p className="sa-small sa-center">Rien ne sera modifié sur YouTube. Tes exclusions sont respectées.</p>
        </section>
        <div className="sa-followups" aria-label="Affiner ce blend">{(plan.followUps?.length ? plan.followUps : ['Plus jazzy', 'Plus de découvertes', 'Plus d’énergie']).map((followUp) => <button type="button" key={followUp} disabled={busy || generating} onClick={() => void send(followUp)}>{followUp}</button>)}</div>
      </>}

      {createdBlend && <section className="sb-assistant-plan sa-blend-card" aria-label="Blend enregistré"><div className="sa-blend-heading"><PlaylistArt tracks={createdBlend.tracks} title={createdBlend.title} size={70} radius={12} /><div><span className="sa-kicker"><Check size={12} /> DANS TES BLENDS</span><h2>{createdBlend.title}</h2><p>{createdBlend.tracks.length} titres · {Math.round(createdBlend.tracks.reduce((sum, t) => sum + (t.durationSeconds || 0), 0) / 60)} min</p></div></div>
        <ol className="sa-track-preview">{createdBlend.tracks.slice(0, 3).map((track, i) => <li key={track.id}><span>{String(i + 1).padStart(2, '0')}</span><div><b>{track.title}</b><small>{track.artist}</small></div><time>{track.durationFormatted || '—'}</time></li>)}</ol>
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
        <div className="sb-assistant-plan-bottom"><button type="button" className="sb-plan-cancel" disabled={busy} onClick={() => { setPlan(null); setPlaylistDraft(null); setDestination(''); }}>Annuler la proposition</button>
          <button type="button" className="btn" disabled={busy || generating || !destination || !!recovery} onClick={() => void applyPlaylist()}>
            <Check size={16} /> {destination === 'original' ? 'Confirmer : modifier l’originale' : destination === 'copy' ? 'Confirmer : créer la copie' : 'Choisis une destination'}</button></div>
      </section>}

      <div ref={chatEnd} className="sa-chat-end" />
      {createPortal(<div ref={dockRef} className={`sa-floating-compose${currentTrack ? ' has-player' : ''}`} hidden={liveOpen}>
      <form className="sa-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="sb-assistant-input">Ton message à l’assistant</label>
        <textarea ref={composerRef} id="sb-assistant-input" rows={1} maxLength={6000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Décris ton envie musicale…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <div className="sa-compose-tools">
          <button type="button" className="sa-live-button" disabled={busy || generating} onClick={() => { setLiveOpen(true); setError(''); }}><AudioLines size={15} /> Live</button>
          {responding && !generating && <button type="button" className="sa-send" aria-label="Arrêter la réponse" onClick={() => { operation.current++; actionAbort.current?.abort(); actionAbort.current = null; busyRef.current = false; setBusy(false); setResponding(false); setBusyLabel(''); setNotice({ text: 'Réponse interrompue. Tu peux reformuler ta demande.' }); }}><X size={18} /></button>}
          <button type="submit" className="sa-send" disabled={!text.trim() || busy || generating} aria-label="Envoyer à l’assistant"><ArrowUp size={19} /></button>
        </div>
      </form>
      </div>, document.getElementById('root') || document.body)}
    </div>
  </div>;
};
