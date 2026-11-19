import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ExternalLink, Loader2, Music2, Search, UserRound, X } from 'lucide-react';
import { MAX_ASSISTANT_MENTIONS, mentionKey, mentionUrl, searchAssistantMentions, type AssistantMention } from '../../services/assistantMentions';

export const AssistantMentionPicker: React.FC<{
  selected: AssistantMention[];
  onToggle: (mention: AssistantMention) => void;
  onClose: () => void;
}> = ({ selected, onToggle, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<AssistantMention['kind']>('track');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssistantMention[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = 'hidden'; inputRef.current?.focus();
    return () => { requestRef.current?.abort(); dialog?.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  const resetSearch = () => { requestRef.current?.abort(); requestRef.current = null; setLoading(false); setResults([]); setSearched(false); setError(''); };
  const search = async (event: React.FormEvent) => {
    event.preventDefault(); if (query.trim().length < 2 || loading) return;
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError(''); setResults([]); setSearched(false);
    try {
      const found = await searchAssistantMentions(query, kind, controller.signal);
      if (requestRef.current !== controller || controller.signal.aborted) return;
      setResults(found); setSearched(true);
    } catch (failure) {
      if (requestRef.current === controller && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Recherche indisponible.');
    } finally { if (requestRef.current === controller) { requestRef.current = null; setLoading(false); } }
  };
  const changeKind = (next: AssistantMention['kind']) => { if (next !== kind) { resetSearch(); setKind(next); } };
  return createPortal(<dialog ref={dialogRef} className="sa-mention-picker" aria-labelledby="sa-picker-title" aria-describedby="sa-picker-intro" onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header className="sa-picker-heading"><div><h2 id="sa-picker-title">Une référence en tête ?</h2><p id="sa-picker-intro">Ajoute un morceau ou un artiste à ton message.</p></div><button type="button" className="sa-icon" aria-label="Fermer la recherche YouTube" onClick={onClose}><X size={20} /></button></header>
    <div className="sa-picker-tabs" role="tablist" aria-label="Type de référence" onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'track' : event.key === 'End' ? 'artist' : kind === 'track' ? 'artist' : 'track'; changeKind(next); document.getElementById(`sa-picker-tab-${next}`)?.focus(); } }}>
      <button type="button" role="tab" id="sa-picker-tab-track" aria-controls="sa-picker-panel" aria-selected={kind === 'track'} tabIndex={kind === 'track' ? 0 : -1} onClick={() => changeKind('track')}><Music2 size={15} /> Morceaux</button>
      <button type="button" role="tab" id="sa-picker-tab-artist" aria-controls="sa-picker-panel" aria-selected={kind === 'artist'} tabIndex={kind === 'artist' ? 0 : -1} onClick={() => changeKind('artist')}><UserRound size={15} /> Artistes</button>
    </div>
    <form className="sa-picker-search" onSubmit={(event) => void search(event)}>
      <label className="sr-only" htmlFor="sa-picker-query">Rechercher sur YouTube</label>
      <Search size={17} aria-hidden="true" /><input ref={inputRef} id="sa-picker-query" autoComplete="off" maxLength={180} value={query} onChange={(event) => { resetSearch(); setQuery(event.target.value); }} placeholder={kind === 'track' ? 'Un titre et son artiste…' : 'Le nom d’un artiste…'} />
      <button type="submit" aria-label="Lancer la recherche YouTube" disabled={query.trim().length < 2 || loading}>{loading ? <Loader2 size={17} className="anim-spin" /> : <Search size={17} />}</button>
    </form>
    <p className="sa-picker-hint">{kind === 'artist' ? 'Chaînes YouTube : vérifie qu’il s’agit bien de l’artiste souhaité.' : 'Résultats musicaux YouTube. Choisis la bonne version.'}</p>
    <div className="sa-picker-results" role="tabpanel" id="sa-picker-panel" aria-labelledby={`sa-picker-tab-${kind}`} tabIndex={0}>
      {error && <p className="sa-picker-error" role="alert">{error}</p>}
      {loading && <p className="sa-picker-empty" role="status"><Loader2 size={22} className="anim-spin" /> Recherche sur YouTube…</p>}
      {!loading && !error && results.length === 0 && <div className="sa-picker-empty" role="status"><span>{kind === 'track' ? <Music2 size={26} /> : <UserRound size={26} />}</span><p>{searched ? 'Aucun résultat. Essaie un titre ou un nom plus précis.' : 'Cherche, puis sélectionne tes références.'}</p></div>}
      {results.length > 0 && <ul aria-label="Résultats YouTube">{results.map((mention) => {
        const checked = selected.some((item) => mentionKey(item) === mentionKey(mention));
        return <li key={mentionKey(mention)}><button type="button" className="sa-picker-result" aria-pressed={checked} disabled={!checked && selected.length >= MAX_ASSISTANT_MENTIONS} onClick={() => onToggle(mention)}>
          <span className={`sa-picker-art ${mention.kind === 'artist' ? 'is-artist' : ''}`}><span aria-hidden="true">{mention.kind === 'artist' ? <UserRound size={18} /> : <Music2 size={18} />}</span>{mention.thumbnailUrl && <img src={mention.thumbnailUrl} loading="lazy" alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</span>
          <span className="sa-picker-result-copy"><b>{mention.title}</b><small>{mention.kind === 'track' ? `${mention.artist} · ${mention.channelTitle}` : 'Chaîne YouTube'}</small></span>
          <span className="sa-picker-check" aria-hidden="true">{checked ? <Check size={15} /> : <span>+</span>}</span>
        </button><a href={mentionUrl(mention)} target="_blank" rel="noopener noreferrer" aria-label={`Vérifier ${mention.title} sur YouTube`}><ExternalLink size={15} /></a></li>;
      })}</ul>}
    </div>
    <footer className="sa-picker-footer"><span role="status">{selected.length}/{MAX_ASSISTANT_MENTIONS} références{selected.length >= MAX_ASSISTANT_MENTIONS ? ' · limite atteinte' : ''}<small>Recherche envoyée à YouTube · quota API.</small></span><button type="button" className="sa-primary" onClick={onClose}>{selected.length ? 'Ajouter au message' : 'Revenir au message'}</button></footer>
  </dialog>, document.body);
};
