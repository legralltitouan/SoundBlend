import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp, AudioLines, Bot, Check, ChevronDown, CircleHelp, ExternalLink, Globe2,
  Headphones, Library, ListMusic, Loader2, Mic, MicOff, Music2, Plus, ShieldCheck,
  Sparkles, Square, WandSparkles,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { geminiService, type AssistantMessage, type AssistantReply, type AssistantResearch, type AssistantSource, type GroundedResearch } from '../../services/gemini';
import { isSafeGoogleSuggestions, parseGoogleSuggestions } from '../../services/googleSuggestions';
import { GeminiLiveSession, type LivePhase, type LiveToolName } from '../../services/geminiLive';
import { prepareAssistantPlaylistDraft, assertAssistantSnapshot, type AssistantPlaylistDraft } from '../../services/assistantPlaylist';
import { searchEncyclopedia } from '../../services/assistantResearch';
import { beginExportAttempt, clearExportAttempt, getExportAttempt, rememberExportPlaylist } from '../../services/exportRecovery';
import { accountRevision, assertAccountRevision } from '../../services/accountScope';
import { isAssistantTrackExcluded, youtubeService } from '../../services/youtube';
import { getStoredBlends, getStoredSettings } from '../../services/storage';
import { GEMINI_API_KEY } from '../../config/app';
import { norm } from '../../lib/track';
import type { Playlist, Track } from '../../types';

const sourceKey = (s: AssistantSource) => `${s.type}:${s.id}`;
const playlistLink = (id: string) => `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`;
const videoLink = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
const rawVideoTitle = (t: Track) => {
  const raw = (t as Track & { youtubeTitle?: unknown }).youtubeTitle;
  return typeof raw === 'string' ? raw : '';
};
const copyJournalKey = (id: string) => `assistant-copy:${id}`;
const mergeTranscript = (old: string, next: string) => {
  if (!old) return next;
  if (next.startsWith(old)) return next;
  if (old.endsWith(next)) return old;
  return old + next;
};

const ResearchCard: React.FC<{ research: AssistantResearch }> = ({ research }) => <div className="sb-assistant-research">
  <div className="sb-assistant-card-kicker"><Globe2 size={14} /> Recherche encyclopédique · Wikipédia</div>
  <p className="sb-assistant-card-query">Sujet : {research.query}</p>
  {research.sources.length ? <ul>{research.sources.map((s) => <li key={s.url}>
    <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} <ExternalLink size={12} /></a>
    {s.extract && <p>{s.extract}</p>}
  </li>)}</ul> : <p>Aucune page pertinente renvoyée. Cela ne prouve pas que l’information n’existe pas.</p>}
  <div className="sb-assistant-card-foot">Extraits de Wikipédia ; ouvre les pages et recoupe les informations.
    {' '}<a href={`https://www.google.com/search?q=${encodeURIComponent(research.query)}`} target="_blank" rel="noopener noreferrer">Chercher plus largement sur le Web <ExternalLink size={11} /></a>
  </div>
</div>;

/** Fragment Google intact dans un Shadow DOM (et non une iframe), isolé du
    CSS de l'application. La validation refuse tout fragment dangereux plutôt
    que d'en modifier l'apparence. Le montage précède le premier affichage. */
const GoogleSuggestions: React.FC<{ html: string }> = ({ html }) => {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current, fragment = parseGoogleSuggestions(html); if (!el || !fragment) return;
    const shadow = el.shadowRoot || el.attachShadow({ mode: 'open' });
    // Réutiliser les nœuds vérifiés, sans une seconde analyse HTML qui
    // pourrait interpréter différemment une balise mal formée.
    shadow.replaceChildren(fragment);
    return () => { shadow.replaceChildren(); };
  }, [html]);
  return <div ref={host} className="sb-google-suggestions" aria-label="Suggestions de recherche Google" />;
};
const GoogleResearchCard: React.FC<{ result: GroundedResearch }> = ({ result }) => {
  // Ne jamais afficher une réponse sans ses suggestions associées.
  if (!isSafeGoogleSuggestions(result.suggestions)) return <p>Suggestions Google indisponibles : la réponse Web ne peut pas être affichée.</p>;
  return <article className="sb-google-result" aria-label="Réponse issue de Google Search">
    <div className="sb-assistant-card-kicker"><Globe2 size={14} /> Réponse Web de Gemini · Google Search</div>
    <p className="sb-google-answer">{result.text}</p>
    <GoogleSuggestions html={result.suggestions} />
    <div className="sb-google-sources"><strong>Sources indiquées par Google</strong>
      <ul>{result.sources.map((s, i) => <li key={`${i}:${s.url}`}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || 'Source Web'} <ExternalLink size={12} /></a></li>)}</ul>
    </div>
    <p className="sb-assistant-card-foot">Réponse et sources à vérifier. Ce résultat n’est pas utilisé automatiquement pour modifier une playlist.</p>
  </article>;
};

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

/** Conversation et recherches sans effet de bord ; chaque écriture YouTube et
    chaque génération passent par leur propre bouton de confirmation. */
export const AssistantView: React.FC = () => {
  const { playlists, recentBlends, exclusions, isAuthenticated, libraryError, loadPlaylistTracks, refreshLibrary, generate, generating } = useData();
  const { setView, showToast } = useUI();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; url?: string } | null>(null);
  const [webEnabled, setWebEnabled] = useState(false);
  const [googleWebEnabled, setGoogleWebEnabled] = useState(false);
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
  const [livePhase, setLivePhase] = useState<LivePhase>('off');
  const [liveDetail, setLiveDetail] = useState('');
  const [voicePartial, setVoicePartial] = useState({ user: '', assistant: '' });
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
    if (alive.current) setVoicePartial({ ...partialRef.current });
  };

  useEffect(() => {
    alive.current = true;
    const stopForAuth = (event: Event) => {
      operation.current++; busyRef.current = false; actionAbort.current?.abort(); actionAbort.current = null;
      liveRef.current?.stop(); liveRef.current = null;
      partialRef.current = { user: '', assistant: '' };
      setVoicePartial({ user: '', assistant: '' }); setPlan(null); setPlaylistDraft(null); setDestination('');
      setBusy(false); setBusyLabel('');
      if (event.type === 'sb:auth-changing') {
        // Une conversation peut contenir les titres et noms privés d'un compte.
        // Ne jamais les montrer ou les renvoyer à Gemini dans le compte suivant.
        messagesRef.current = []; setMessages([]); setText(''); setCatalog([]); setCatalogSelected([]);
        setSource(''); setExtraSources([]); setInstruction(''); setNotice(null); setError('');
        setWebEnabled(false); setGoogleWebEnabled(false);
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && liveRef.current) {
        flushVoice(); liveRef.current.stop(); liveRef.current = null;
        if (alive.current) setNotice({ text: 'Vocal arrêté parce que l’application est passée en arrière-plan.' });
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

  const validSource = (s: AssistantSource | null, pls: Playlist[]) => !!s && (s.type === 'playlist'
    ? pls.some((p) => p.id === s.id) : getStoredBlends().some((b) => b.id === s.id));
  const guardFor = (op: number, revision: number, serial: number, signal?: AbortSignal) => {
    assertAccountRevision(revision);
    if (!alive.current || op !== operation.current || signal?.aborted || serial !== youtubeService.sessionRevision()) {
      throw new Error('Préparation interrompue ou session modifiée.');
    }
  };

  const send = async (raw = text, opts: { voice?: boolean; signal?: AbortSignal } = {}): Promise<boolean> => {
    const request = raw.trim();
    if (!request || busyRef.current || generating) return false;
    const op = ++operation.current, revision = accountRevision(), serial = youtubeService.sessionRevision();
    const controller = new AbortController(); actionAbort.current = controller;
    const cancel = () => controller.abort();
    if (opts.signal?.aborted) controller.abort(); else opts.signal?.addEventListener('abort', cancel, { once: true });
    const guard = () => guardFor(op, revision, serial, controller.signal);
    busyRef.current = true; setBusy(true); setError(''); setNotice(null); setPlan(null); setPlaylistDraft(null); setDestination('');
    if (!opts.voice) setText('');
    append({ role: 'user', text: opts.voice ? `Demande vocale à préparer : ${request}` : request });
    const conversation = [...messagesRef.current];
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
      const ask = async (catalogData: Track[] = [], researchData = '') => {
        guard(); setBusyLabel('Gemini réfléchit à ta demande…');
        const r = await geminiService.converse(conversation, contextPlaylists, getStoredBlends(), exclusions,
          { catalog: catalogData, research: researchData, signal: controller.signal });
        guard(); return r;
      };
      let answer = await ask();
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
      if (await loadChosen(answer)) answer = await ask();
      guard();
      let research: AssistantResearch | undefined;
      const warnings: string[] = [];
      if (webEnabled) {
        setBusyLabel('Recherche de sources sur Wikipédia…');
        try { research = await searchEncyclopedia(answer.researchQuery || request, controller.signal); guard(); }
        catch (e: any) { guard(); warnings.push(e?.message || 'Recherche encyclopédique indisponible.'); }
      }
      let found: Track[] = [];
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
      if (research || found.length) {
        const excerpts = research?.sources.map((s) => `${s.title} (${s.url}) : ${s.extract}`).join('\n') || '';
        answer = await ask(found, excerpts);
        if (await loadChosen(answer)) answer = await ask(found, excerpts);
      }
      // Le résultat Google Search reste une réponse distincte, non réinjectée
      // dans le modèle de planification musicale. En vocal, la recherche est
      // appelée explicitement par son outil dédié, pas par une action musicale.
      let grounded: GroundedResearch | undefined;
      if (googleWebEnabled && !opts.voice) {
        setBusyLabel('Recherche Web avec Google Search…');
        try { grounded = await geminiService.searchWeb(request, controller.signal); guard(); }
        catch (e: any) { guard(); warnings.push(e?.message || 'Recherche Web Google indisponible.'); }
      }
      guard(); setCatalog(found);
      const recommended = answer.catalogVideoIds.filter((id) => found.some((t) => t.videoId === id));
      setCatalogSelected(recommended);
      if (answer.source && !validSource(answer.source, contextPlaylists)) {
        answer = { ...answer, action: 'none', source: null,
          reply: `${answer.reply}\n\nJe ne retrouve pas cette source dans ta bibliothèque. Précise son nom.` };
      }
      const replyText = `${answer.reply}${warnings.length ? `\n\n${warnings.join(' ')}` : ''}`;
      if (!grounded || answer.action !== 'none' || research || found.length || answer.catalogQueries.length || warnings.length) {
        append({ role: 'assistant', text: replyText, ...(research ? { research } : {}), ...(answer.catalogQueries.length || found.length ? { catalog: found } : {}) });
      }
      // Seul ce libellé générique entre dans le contexte des prochains tours :
      // le texte Search et ses suggestions ne sont ni sauvegardés ni réutilisés.
      if (grounded) append({ role: 'assistant', text: 'Une réponse Web a été affichée séparément avec ses sources.', grounded });
      if (answer.action === 'playlist_edit') {
        if (!answer.source || answer.source.type !== 'playlist' || !answer.playlistEdits) {
          setError('Il me manque la playlist ou les changements précis. Demande une nouvelle proposition en indiquant les titres.');
        } else {
          const p = contextPlaylists.find((x) => x.id === answer.source!.id);
          if (!p) throw new Error('Cette playlist n’est plus disponible.');
          setBusyLabel('Vérification complète de la playlist et préparation de l’aperçu…');
          const proposal = await prepareAssistantPlaylistDraft(p, answer.playlistEdits); guard();
          setPlaylistDraft(proposal); setPlan(answer); setDestination(''); prepared = true;
        }
      } else if (answer.action === 'blend' && (validSource(answer.source, contextPlaylists) || recommended.length)) {
        setPlan(answer); setPlaylistDraft(null);
        setSource(answer.source && validSource(answer.source, contextPlaylists) ? sourceKey(answer.source) : 'catalog');
        setExtraSources(answer.extraSources.filter((s) => validSource(s, contextPlaylists)).map(sourceKey));
        const requests = conversation.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
        setInstruction(`Demandes de l’auditeur :\n${requests}${answer.instruction ? `\n\nSynthèse : ${answer.instruction}` : ''}`.slice(0, 6000));
        setMinutes(answer.durationMinutes); prepared = true;
      }
      if (prepared) window.setTimeout(() => { if (alive.current) planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
      return prepared;
    } catch (e: any) {
      if (alive.current && op === operation.current && !controller.signal.aborted) setError(e?.message || 'Impossible de préparer la réponse.');
      return false;
    } finally {
      opts.signal?.removeEventListener('abort', cancel);
      if (actionAbort.current === controller) actionAbort.current = null;
      if (alive.current && op === operation.current) { busyRef.current = false; setBusy(false); setBusyLabel(''); }
    }
  };

  const prepareFromCatalog = (tracks: Track[]) => {
    const selected = tracks.filter((t) => catalogSelected.includes(t.videoId) && !isAssistantTrackExcluded(t));
    if (!selected.length || busyRef.current || generating) return;
    setCatalog(tracks); setCatalogSelected(selected.map((t) => t.videoId)); setPlaylistDraft(null); setDestination(''); setError('');
    setSource('catalog'); setExtraSources([]); setMinutes(45);
    const request = [...messagesRef.current].reverse().find((m) => m.role === 'user')?.text || 'Composer à partir des titres sélectionnés.';
    setInstruction(`Demandes de l’auditeur :\n${request}`.slice(0, 6000));
    setPlan({ reply: 'Blend préparé à partir des titres sélectionnés.', action: 'blend', source: null, extraSources: [], instruction: request,
      durationMinutes: 45, catalogQueries: [], catalogVideoIds: selected.map((t) => t.videoId), researchQuery: '', playlistEdits: null });
    window.setTimeout(() => planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
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
          const b = getStoredBlends().find((x) => x.id === id); if (!b) throw new Error('Un blend choisi a expiré ou a été supprimé.');
          tracks.push(...b.tracks);
        }
      }
      // Les titres sélectionnés dans le catalogue peuvent compléter toute source.
      if (source !== 'catalog') tracks.push(...catalog.filter((t) => catalogSelected.includes(t.videoId)));
      const allowed = tracks.filter((t) => !isAssistantTrackExcluded(t));
      if (!allowed.length) throw new Error('Les sources sont vides ou tous leurs titres sont bloqués.');
      if (!instruction.trim()) throw new Error('Précise ta consigne avant de générer.');
      const blend = await generate({ durationMinutes: minutes, ratio: { anchor: 30, deepDive: 30, fresh: 40 }, instruction: instruction.trim() }, { seeds: allowed });
      guard();
      if (blend) { setView('blend'); showToast(`Blend prêt : ${blend.tracks.length} titres.`); }
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
      const ok = await send(query, { voice: true, signal }); guard();
      return ok ? { statut: 'aperçu préparé', instruction: 'Ne prétends pas que l’action est faite. La personne doit vérifier puis cliquer sur le bouton.' }
        : { statut: 'aucun aperçu exécutable', instruction: 'Demande une précision ou signale que la préparation n’a pas abouti.' };
    }
    if (name === 'rechercher_wikipedia') {
      if (!webEnabled) throw new Error('La recherche encyclopédique n’est pas activée.');
      const research = await searchEncyclopedia(query, signal); guard();
      append({ role: 'assistant', text: 'Voici les pages encyclopédiques consultées pour notre échange vocal.', research });
      return { sujet: research.query, sources: research.sources, precision: 'Extraits à vérifier ; les pages sont visibles à l’écran.' };
    }
    if (name === 'rechercher_web') {
      if (!googleWebEnabled) throw new Error('La recherche Web Google n’est pas activée.');
      const grounded = await geminiService.searchWeb(query, signal); guard();
      append({ role: 'assistant', text: 'Une réponse Web a été affichée séparément avec ses sources.', grounded });
      // Ne pas transformer ni recycler le résultat : il est affiché tel que
      // reçu avec ses suggestions Google, tandis que le vocal le signale.
      return { statut: 'résultat Web et sources affichés à l’écran', instruction: 'Invite la personne à les lire. Tu n’as pas reçu le contenu : ne l’invente pas.' };
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
  latest.current = { handleVoiceTool };

  const startVoice = async () => {
    if (liveRef.current || busyRef.current) return;
    setError(''); setNotice(null); partialRef.current = { user: '', assistant: '' }; setVoicePartial({ user: '', assistant: '' });
    const key = getStoredSettings().geminiApiKey || GEMINI_API_KEY;
    const context = JSON.stringify({ playlists: playlists.slice(0, 60).map((p) => ({ titre: p.title, nombre: p.trackCount })),
      blends: recentBlends.slice(0, 30).map((b) => ({ titre: b.title, nombre: b.tracks.length })),
      exclusions: { artistes: exclusions.artists, titres: exclusions.tracks.map((t) => ({ titre: t.title, artiste: t.artist })) } });
    const session = new GeminiLiveSession({
      onPhase: (phase, detail) => { if (alive.current) { setLivePhase(phase); setLiveDetail(detail || ''); } },
      onTranscript: (role, part, finished) => {
        if (!alive.current) return;
        partialRef.current[role] = mergeTranscript(partialRef.current[role], part);
        setVoicePartial({ ...partialRef.current }); if (finished) flushVoice(role);
      },
      onTurnComplete: () => { if (alive.current) flushVoice(); },
      onTool: (name, query, signal) => latest.current.handleVoiceTool(name, query, signal),
      onError: (message) => { if (alive.current) { flushVoice(); liveRef.current = null; setError(message); } },
    });
    liveRef.current = session;
    try { await session.start(key, context, { encyclopedia: webEnabled, web: googleWebEnabled, catalog: youtubeService.isAuthenticated() }); }
    catch (e: any) {
      if (liveRef.current === session) { liveRef.current = null; if (alive.current) setError(e?.message || 'Impossible de démarrer le vocal.'); }
    }
  };
  const stopVoice = () => { flushVoice(); liveRef.current?.stop(); liveRef.current = null; };
  const toggleCatalog = (id: string) => setCatalogSelected((old) => old.includes(id) ? old.filter((x) => x !== id) : [...old, id].slice(0, 20));
  const toggleExtra = (value: string) => setExtraSources((old) => old.includes(value) ? old.filter((x) => x !== value) : [...old, value].slice(0, 3));
  const setExample = (value: string, web = false) => { setText(value); if (web) { setWebEnabled(true); setGoogleWebEnabled(false); } document.getElementById('sb-assistant-input')?.focus(); };

  return <div className="ytm-page sb-assistant">
    <header className="sb-assistant-hero">
      <div><span className="sb-assistant-eyebrow"><Sparkles size={13} /> TON COPILOTE MUSICAL</span><h1>Assistant</h1>
        <p>Une idée en tête ? Parlons musique, trouvons des pistes et imaginons la suite ensemble.</p></div>
      <div className="sb-assistant-hero-art" aria-hidden="true"><span className="sb-assistant-ring sb-assistant-ring--one" /><span className="sb-assistant-ring sb-assistant-ring--two" /><AudioLines size={34} /></div>
    </header>
    <div className="sb-assistant-context"><span><Library size={14} /> {isAuthenticated && !hasDemo ? `${playlists.length} playlist(s) YouTube` : 'Bibliothèque de démonstration'}</span>
      <span><Sparkles size={14} /> {recentBlends.length} blend(s)</span><span><ShieldCheck size={14} /> {exclusions.tracks.length + exclusions.artists.length} exclusion(s)</span></div>
    {(!isAuthenticated || hasDemo || libraryError) && <p className="sb-assistant-note">{libraryError || 'Connecte ton compte Google dans Réglages pour utiliser tes propres playlists.'}</p>}

    <section className={`sb-live-card ${livePhase !== 'off' ? 'is-active' : ''}`} aria-label="Mode vocal en direct">
      <div className="sb-live-icon"><AudioLines size={23} /></div>
      <div className="sb-live-copy"><div className="sb-live-title"><strong>Parlons en direct</strong><span className={`sb-live-indicator sb-live-indicator--${livePhase}`}><i /> {livePhase === 'off' ? 'VOCAL LIVE' : livePhase === 'connecting' ? 'CONNEXION' : livePhase === 'muted' ? 'MICRO COUPÉ' : 'EN DIRECT'}</span></div>
        <p>{livePhase === 'off' ? 'Un vrai dialogue vocal avec Gemini. Tu gardes la main sur chaque action.' : liveDetail || 'Session vocale en cours.'}</p>
      </div>
      <div className="sb-live-actions">{livePhase === 'off' ? <button type="button" className="sb-live-start" disabled={busy || generating} onClick={() => void startVoice()}><Mic size={16} /> Démarrer le vocal</button>
        : <>{livePhase !== 'connecting' && <button type="button" className="sb-live-secondary" onClick={() => liveRef.current?.setMuted(livePhase !== 'muted')} aria-label={livePhase === 'muted' ? 'Rouvrir le microphone' : 'Couper le microphone'}>{livePhase === 'muted' ? <Mic size={16} /> : <MicOff size={16} />}{livePhase === 'muted' ? 'Rouvrir' : 'Couper le micro'}</button>}
          <button type="button" className="sb-live-stop" onClick={stopVoice}><Square size={14} fill="currentColor" /> Arrêter</button></>}</div>
      {(voicePartial.user || voicePartial.assistant) && <div className="sb-live-transcript" aria-live="polite">{voicePartial.user && <p><b>Toi</b> {voicePartial.user}</p>}{voicePartial.assistant && <p><b>Assistant</b> {voicePartial.assistant}</p>}</div>}
      <details className="sb-live-privacy"><summary><ShieldCheck size={13} /> Confidentialité et conditions du vocal <ChevronDown size={13} /></summary>
        <p>Le microphone envoie ta voix à Google tant qu’il est ouvert ; la session s’arrête en quittant cette page ou en arrière-plan. Permission micro et HTTPS sont nécessaires. La clé personnelle est utilisée directement et reste accessible dans le navigateur ; le vocal consomme tes quotas et peut être facturé. Utilise un casque pour limiter l’écho.</p>
      </details>
    </section>

    <div className="sb-assistant-layout"><div className="sb-assistant-main">
      <div className="sb-chat-head"><div><span className="sb-section-kicker">NOTRE CONVERSATION</span><h2>À toi de jouer</h2></div>
        {messages.length > 0 && <button type="button" className="sb-chat-reset" disabled={busy || livePhase !== 'off'} onClick={() => { messagesRef.current = []; setMessages([]); setPlan(null); setPlaylistDraft(null); setCatalog([]); setCatalogSelected([]); setNotice(null); setError(''); }}>Nouvelle conversation</button>}</div>
      <div className="sb-chat" aria-live="polite">
        {messages.length === 0 && <div className="sb-chat-empty"><span><Bot size={22} /></span><h3>Qu’aimerais-tu écouter ?</h3>
          <p>Décris une ambiance, pose une question ou prépare une modification : on regarde tout ensemble avant d’agir.</p>
          <div className="sb-chat-examples"><button type="button" onClick={() => setExample('Reprends ma playlist Chill Voiture, ajoute du jazz et rends-la plus énergique.')}>Un trajet plus jazz <span>↗</span></button>
            <button type="button" onClick={() => setExample('Aide-moi à découvrir des artistes proches de Daft Punk.')}>Découvrir des artistes <span>↗</span></button>
            <button type="button" onClick={() => setExample('Propose-moi des changements précis pour une de mes playlists.')}>Améliorer une playlist <span>↗</span></button></div>
        </div>}
        {messages.map((m, i) => <div className={`sb-chat-message sb-chat-message--${m.role}${m.grounded ? ' sb-chat-message--grounded' : ''}`} key={i}>
          <span className="sb-chat-label">{m.role === 'user' ? 'Toi' : 'Assistant'}</span>{!m.grounded && <p>{m.text}</p>}
          {m.grounded && <GoogleResearchCard result={m.grounded} />}
          {m.research && <ResearchCard research={m.research} />}
          {m.catalog && <CatalogCard tracks={m.catalog} selected={catalogSelected} onToggle={toggleCatalog} onPrepare={() => prepareFromCatalog(m.catalog!)} />}
        </div>)}
        {busy && !generating && <div className="sb-chat-thinking"><Loader2 size={15} className="anim-spin" /> {busyLabel || 'Un instant…'}</div>}
      </div>
      {error && <p className="sb-assistant-error" role="alert">{error}</p>}
      {notice && <div className="sb-assistant-notice" role="status"><Check size={16} /><span>{notice.text}{notice.url && <> <a href={notice.url} target="_blank" rel="noopener noreferrer">Ouvrir sur YouTube <ExternalLink size={12} /></a></>}</span></div>}

      {plan?.action === 'blend' && <section ref={planRef} className="sb-assistant-plan" aria-label="Proposition de blend">
        <div className="sb-assistant-plan-heading"><span><WandSparkles size={18} /></span><div><strong>Proposition de blend</strong><p>Un aperçu de la direction ; la liste finale sera composée après ton accord.</p></div></div>
        <label>Source principale<select aria-label="Source du blend" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="" disabled>Choisir une source</option>
          <optgroup label={hasDemo ? 'Playlists de démonstration' : 'Playlists YouTube Music'}>{playlists.map((p) => <option key={p.id} value={`playlist:${p.id}`}>{p.title}</option>)}</optgroup>
          <optgroup label="Blends valides">{recentBlends.map((b) => <option key={b.id} value={`blend:${b.id}`}>{b.title}</option>)}</optgroup>
          {catalogSelected.length > 0 && <option value="catalog">Titres YouTube sélectionnés ({catalogSelected.length})</option>}
        </select></label>
        {(playlists.length + recentBlends.length > 1) && <details className="sb-assistant-extra"><summary>Ajouter d’autres sources ({extraSources.length}/3) <ChevronDown size={14} /></summary>
          <div>{[...playlists.map((p) => ({ value: `playlist:${p.id}`, label: p.title })), ...recentBlends.map((b) => ({ value: `blend:${b.id}`, label: b.title }))]
            .filter((x) => x.value !== source).map((x) => <label key={x.value}><input type="checkbox" checked={extraSources.includes(x.value)} disabled={!extraSources.includes(x.value) && extraSources.length >= 3} onChange={() => toggleExtra(x.value)} /> {x.label}</label>)}</div>
        </details>}
        {catalogSelected.length > 0 && <p className="sb-assistant-note">{catalogSelected.length} résultat(s) YouTube sélectionné(s) serviront aussi d’amorces.</p>}
        <label>Consigne transmise à Gemini<textarea aria-label="Consigne transmise à Gemini" value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4} maxLength={6000} /></label>
        <div className="sb-assistant-plan-bottom"><label>Durée<select aria-label="Durée du blend" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[20, 45, 60, 120].map((n) => <option key={n} value={n}>{n} min</option>)}{![20, 45, 60, 120].includes(minutes) && <option value={minutes}>{minutes} min</option>}</select></label>
          <button className="btn" disabled={busy || generating || !source || !instruction.trim() || (source === 'catalog' && !catalogSelected.length)} onClick={() => void launchBlend()}><Sparkles size={16} /> Générer ce blend</button></div>
        <p className="sb-assistant-note">Les titres bloqués sont retirés des amorces. La génération ne modifie pas tes playlists YouTube.</p>
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
        <fieldset className="sb-plan-destination"><legend>Où appliquer cette proposition ?</legend>
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

      <form className="sb-chat-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="sb-assistant-input">Ton message à l’assistant</label>
        <textarea id="sb-assistant-input" rows={2} maxLength={6000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Décris ton idée musicale…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button type="submit" disabled={!text.trim() || busy || generating} aria-label="Envoyer à l’assistant"><ArrowUp size={19} /></button>
      </form>
      <div className="sb-compose-options sb-search-options">
        <label><input type="checkbox" checked={webEnabled} disabled={livePhase !== 'off' || busy} onChange={(e) => { setWebEnabled(e.target.checked); if (e.target.checked) setGoogleWebEnabled(false); }} /><Globe2 size={14} /> Chercher des sources sur Wikipédia</label>
        <label><input type="checkbox" checked={googleWebEnabled} disabled={livePhase !== 'off' || busy} onChange={(e) => { setGoogleWebEnabled(e.target.checked); if (e.target.checked) setWebEnabled(false); }} /><Globe2 size={14} /> Recherche Web Google (quota / coût)</label>
        <span>Entrée pour envoyer · Maj + Entrée pour une ligne</span>
      </div>
      {googleWebEnabled && <p className="sb-assistant-disclaimer sb-search-disclaimer">La question est envoyée à Google Search via ta clé Gemini ; la recherche peut être facturée et nécessite les droits appropriés. En vocal, la réponse sourcée est affichée à l’écran, pas lue automatiquement. Évite les informations sensibles : Google indique conserver les données 30 jours pour ce service. <a href="https://aistudio.google.com/docs/terms#grounding-with-google-search" target="_blank" rel="noopener noreferrer">Conditions Google</a> · <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noopener noreferrer">Tarifs</a>.</p>}
      <p className="sb-assistant-disclaimer">Gemini reçoit la conversation, les noms et titres chargés, les blends et les exclusions. Si Wikipédia est activée, le sujet lui est envoyé. Une recherche YouTube utilise du quota. Vérifie toujours les résultats.</p>
    </div>
    <aside className="sb-assistant-aside" aria-label="Conseils de l’assistant"><div className="sb-assistant-aside-card"><span className="sb-section-kicker">FAIS-EN PLUS</span><h3>Quelques idées</h3>
      <button type="button" onClick={() => setExample('Crée un blend à partir de deux de mes playlists, avec une montée progressive en énergie.')}><span><Sparkles size={16} /></span><div><b>Imaginer un mix</b><small>Mélange tes univers</small></div><span>↗</span></button>
      <button type="button" onClick={() => setExample('Propose des modifications précises pour ma playlist : demande-moi laquelle si nécessaire.')}><span><ListMusic size={16} /></span><div><b>Repenser une playlist</b><small>Un aperçu avant action</small></div><span>↗</span></button>
      <button type="button" onClick={() => setExample('Que sais-tu de Daft Punk et de la French touch ?', true)}><span><Globe2 size={16} /></span><div><b>Explorer une histoire</b><small>Sources encyclopédiques</small></div><span>↗</span></button>
    </div><div className="sb-assistant-aside-help"><CircleHelp size={16} /><p><b>Tu décides.</b><br />Les propositions ne changent rien avant confirmation. Les recherches et les réponses peuvent contenir des erreurs.</p></div>
      <button type="button" className="sb-assistant-settings-link" onClick={() => setView('settings')}><Headphones size={15} /> Connexion et clé Gemini <ExternalLink size={12} /></button>
    </aside></div>
  </div>;
};
