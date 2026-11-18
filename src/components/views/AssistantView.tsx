import React, { useState } from 'react';
import { ArrowUp, Bot, Sparkles, Loader2, ListMusic } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { geminiService, type AssistantMessage, type AssistantReply } from '../../services/gemini';
import { getStoredBlends, isExcluded } from '../../services/storage';
import { norm } from '../../lib/track';
import type { Playlist, Track } from '../../types';

/** La conversation conseille ; seule une pression sur « Générer » agit. */
export const AssistantView: React.FC = () => {
  const { playlists, recentBlends, exclusions, isAuthenticated, libraryError, loadPlaylistTracks, generate, generating } = useData();
  const { setView, showToast } = useUI();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<AssistantReply | null>(null);
  const [source, setSource] = useState('');
  const [instruction, setInstruction] = useState('');
  const [minutes, setMinutes] = useState(45);
  const hasDemo = playlists.some((p) => p.id.startsWith('demo-pl-'));

  const validSource = (r: AssistantReply, pls: Playlist[]) => {
    if (!r.source) return false;
    return r.source.type === 'playlist' ? pls.some((p) => p.id === r.source!.id)
      : getStoredBlends().some((b) => b.id === r.source!.id);
  };

  const send = async (text = draft) => {
    text = text.trim();
    if (!text || busy || generating) return;
    const conversation: AssistantMessage[] = [...messages, { role: 'user', text }];
    setMessages(conversation); setDraft(''); setError(''); setPlan(null); setBusy(true);
    try {
      setBusyLabel('Lecture du contexte musical…');
      let contextPlaylists = playlists.map((p) => ({ ...p }));
      // Si le nom est cité, charger cette playlist réelle avant de répondre.
      const query = norm(conversation.filter((m) => m.role === 'user').map((m) => m.text).join(' '));
      const named = contextPlaylists.filter((p) => norm(p.title).length >= 3 && query.includes(norm(p.title)) && !p.tracks);
      for (const p of named.slice(0, 3)) {
        const tracks = await loadPlaylistTracks(p.id);
        contextPlaylists = contextPlaylists.map((x) => x.id === p.id ? { ...x, tracks } : x);
      }
      setBusyLabel('Gemini réfléchit à ta demande…');
      let answer = await geminiService.converse(conversation, contextPlaylists, getStoredBlends(), exclusions);
      // S'il reconnaît une source non encore chargée, lui fournir son vrai contenu.
      if (validSource(answer, contextPlaylists) && answer.source?.type === 'playlist') {
        const p = contextPlaylists.find((x) => x.id === answer.source!.id);
        if (p && !p.tracks) {
          setBusyLabel(`Lecture de « ${p.title} » sur YouTube…`);
          const tracks = await loadPlaylistTracks(p.id);
          contextPlaylists = contextPlaylists.map((x) => x.id === p.id ? { ...x, tracks } : x);
          setBusyLabel('Gemini affine sa proposition…');
          answer = await geminiService.converse(conversation, contextPlaylists, getStoredBlends(), exclusions);
        }
      }
      const ok = validSource(answer, contextPlaylists);
      if (answer.source && !ok) answer = { ...answer, source: null, reply: `${answer.reply}\n\nJe ne retrouve pas cette source dans ta bibliothèque. Précise son nom.` };
      setMessages((old) => [...old, { role: 'assistant', text: answer.reply }]);
      if (answer.source && ok) {
        setPlan(answer);
        setSource(`${answer.source.type}:${answer.source.id}`);
        // Le texte original, pas seulement une reformulation, atteint le curateur.
        const actualRequests = conversation.filter((m) => m.role === 'user').map((m) => m.text).join('\n');
        setInstruction(`Demandes de l’auditeur :\n${actualRequests}${answer.instruction ? `\n\nSynthèse : ${answer.instruction}` : ''}`.slice(0, 6000));
        setMinutes(answer.durationMinutes);
      }
    } catch (e: any) { setError(e?.message || 'Impossible de joindre Gemini.'); }
    finally { setBusy(false); setBusyLabel(''); }
  };

  const launch = async () => {
    if (!plan || !source || busy || generating) return;
    setError(''); setBusy(true);
    try {
      const colon = source.indexOf(':');
      const kind = source.slice(0, colon), id = source.slice(colon + 1);
      let tracks: Track[] = [];
      if (kind === 'playlist') {
        const p = playlists.find((x) => x.id === id);
        if (!p) throw new Error('Cette playlist n’est plus disponible.');
        setBusyLabel(`Lecture de « ${p.title} » sur YouTube…`);
        tracks = p.tracks || await loadPlaylistTracks(id);
      } else if (kind === 'blend') {
        const b = getStoredBlends().find((x) => x.id === id);
        if (!b) throw new Error('Ce blend a expiré ou a été supprimé.');
        tracks = b.tracks;
      }
      const allowed = tracks.filter((t) => !isExcluded(t));
      if (!allowed.length) throw new Error('La source est vide ou tous ses titres sont bloqués.');
      if (!instruction.trim()) throw new Error('Précise ta consigne avant de générer.');
      const blend = await generate({ durationMinutes: minutes, ratio: { anchor: 30, deepDive: 30, fresh: 40 }, instruction: instruction.trim() }, { seeds: allowed });
      if (blend) { setView('blend'); showToast(`Blend prêt : ${blend.tracks.length} titres.`); }
    } catch (e: any) { setError(e?.message || 'La génération a échoué.'); }
    finally { setBusy(false); setBusyLabel(''); }
  };

  return <div className="ytm-page sb-assistant">
    <header className="sb-hero sb-hero--compact"><h1>Assistant</h1>
      <p>Une idée, une playlist, une nouvelle direction ? Parlons-en avant de composer.</p>
    </header>
    <div className="sb-assistant-context"><Sparkles size={15} />
      <span>{isAuthenticated && !hasDemo ? `${playlists.length} playlist(s) YouTube Music` : 'Playlists de démonstration'} · {recentBlends.length} blend(s) valides · {exclusions.tracks.length + exclusions.artists.length} exclusion(s)</span>
    </div>
    {(!isAuthenticated || hasDemo || libraryError) && <p className="sb-assistant-note">{libraryError || 'Connecte ton compte Google dans Réglages pour utiliser tes propres playlists.'}</p>}
    <p className="sb-assistant-note">Pour répondre, Gemini reçoit le contexte affiché : noms des playlists, titres disponibles, blends valides, exclusions et conversation. Aucune génération ne démarre sans ton accord.</p>

    <div className="sb-chat" aria-live="polite">
      {messages.length === 0 && <div className="sb-chat-empty"><span><Bot size={22} /></span><h2>Que veux-tu écouter ?</h2>
        <p>Je peux m’appuyer sur tes playlists et tes blends, puis te proposer une direction.</p>
        <button className="chip" onClick={() => setDraft('Reprends ma playlist Chill Voiture, ajoute du jazz et rends-la plus énergique.')}>Un trajet plus jazz et énergique</button>
      </div>}
      {messages.map((m, i) => <div className={`sb-chat-message sb-chat-message--${m.role}`} key={i}>
        <span className="sb-chat-label">{m.role === 'user' ? 'Toi' : 'Assistant'}</span><p>{m.text}</p>
      </div>)}
      {busy && !generating && <div className="sb-chat-thinking"><Loader2 size={15} className="anim-spin" /> {busyLabel || 'Un instant…'}</div>}
    </div>
    {error && <p className="sb-assistant-error" role="alert">{error}</p>}
    {plan && <section className="sb-assistant-plan" aria-label="Proposition de blend">
      <div className="sb-assistant-plan-heading"><ListMusic size={18} /><div><strong>Proposition de blend</strong><p>Vérifie ou modifie avant de lancer.</p></div></div>
      <label>Source
        <select aria-label="Source du blend" value={source} onChange={(e) => setSource(e.target.value)}>
          <optgroup label={hasDemo ? 'Playlists de démonstration' : 'Playlists YouTube Music'}>{playlists.map((p) => <option key={p.id} value={`playlist:${p.id}`}>{p.title}</option>)}</optgroup>
          <optgroup label="Blends valides">{recentBlends.map((b) => <option key={b.id} value={`blend:${b.id}`}>{b.title}</option>)}</optgroup>
        </select>
      </label>
      <label>Consigne transmise à Gemini<textarea aria-label="Consigne transmise à Gemini" value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4} maxLength={6000} /></label>
      <div className="sb-assistant-plan-bottom"><label>Durée
        <select aria-label="Durée du blend" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[20, 45, 60, 120].map((n) => <option key={n} value={n}>{n} min</option>)}
          {![20, 45, 60, 120].includes(minutes) && <option value={minutes}>{minutes} min</option>}
        </select>
      </label><button className="btn" disabled={busy || generating || !source || !instruction.trim()} onClick={launch}><Sparkles size={16} /> Générer ce blend</button></div>
      <p className="sb-assistant-note">Les titres bloqués sont exclus de la source. Les découvertes récentes ne seront pas reproposées ; des amorces choisies peuvent revenir.</p>
    </section>}
    <form className="sb-chat-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="sr-only" htmlFor="sb-assistant-input">Ton message à l’assistant</label>
      <textarea id="sb-assistant-input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Décris ton idée musicale…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <button type="submit" disabled={!draft.trim() || busy || generating} aria-label="Envoyer à l’assistant"><ArrowUp size={19} /></button>
    </form>
  </div>;
};
