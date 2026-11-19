import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ExternalLink, Loader2, Music2, Plus, Search, UserRound, X } from 'lucide-react';
import { MAX_ASSISTANT_MENTIONS, mentionKey, mentionUrl, searchAssistantMentions, type AssistantMention } from '../../services/assistantMentions';

type SearchState = { key: string; results: AssistantMention[]; error?: string };

/** Même vocabulaire visuel et même recherche temporisée que les exclusions.
 * Dialogue natif pour garder le focus captif sans modifier les ActionSheets. */
export const AssistantMentionPicker: React.FC<{
  selected: AssistantMention[];
  onToggle: (mention: AssistantMention) => void;
  onClose: () => void;
}> = ({ selected, onToggle, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null), inputRef = useRef<HTMLInputElement>(null);
  const immediate = useRef(false);
  const [kind, setKind] = useState<AssistantMention['kind']>('track');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState<SearchState | null>(null);
  const q = query.trim(), searchKey = `${kind}:${q}:${revision}`;
  const current = search?.key === searchKey ? search : null;
  const loading = q.length >= 2 && !current;
  const visibleSelected = selected.filter((item) => item.kind === kind);

  useEffect(() => {
    const dialog = dialogRef.current, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const viewport = window.visualViewport;
    const fitViewport = () => {
      if (!dialog) return;
      const height = viewport?.height || window.innerHeight;
      const inset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0));
      dialog.style.setProperty('--sa-picker-available', `${height}px`);
      dialog.style.setProperty('--sa-picker-inset', `${inset}px`);
      dialog.dataset.keyboard = String(inset > 100);
    };
    dialog?.showModal(); document.body.style.overflow = 'hidden'; fitViewport();
    viewport?.addEventListener('resize', fitViewport); viewport?.addEventListener('scroll', fitViewport); window.addEventListener('resize', fitViewport);
    inputRef.current?.focus({ preventScroll: true });
    return () => { viewport?.removeEventListener('resize', fitViewport); viewport?.removeEventListener('scroll', fitViewport); window.removeEventListener('resize', fitViewport); dialog?.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController(); let active = true;
    const delay = immediate.current ? 0 : 400; immediate.current = false;
    const timer = window.setTimeout(() => {
      void searchAssistantMentions(q, kind, controller.signal).then((results) => {
        if (active && !controller.signal.aborted) setSearch({ key: searchKey, results });
      }).catch((error: unknown) => {
        if (active && !controller.signal.aborted) setSearch({ key: searchKey, results: [], error: error instanceof Error ? error.message : 'Recherche indisponible.' });
      });
    }, delay);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [q, kind, searchKey]);
  const retry = () => { immediate.current = true; setRevision((old) => old + 1); };
  const changeKind = (next: AssistantMention['kind']) => { if (next !== kind) setKind(next); };
  const avatar = (mention: AssistantMention) => <span className={`sb-exclusion-art sb-exclusion-art--${mention.kind}`} aria-hidden="true">
    {mention.kind === 'artist' ? <UserRound size={18} /> : <Music2 size={18} />}
    {mention.thumbnailUrl && <img src={mention.thumbnailUrl} loading="lazy" alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
  return createPortal(<dialog ref={dialogRef} className="sb-action-sheet sb-action-sheet--exclusions sa-mention-picker" aria-labelledby="sa-picker-title" aria-describedby="sa-picker-intro" onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <span className="sb-action-grip" aria-hidden="true" />
    <header className="sb-exclusions-header sb-action-heading">
      <div><p className="sb-action-eyebrow">TON INSPIRATION MUSICALE</p><h2 id="sa-picker-title">Références</h2><p id="sa-picker-intro">Un morceau, un artiste. Une direction plus précise.</p></div>
      <button type="button" className="sb-action-close" aria-label="Fermer la recherche YouTube" onClick={onClose}><X size={19} /></button>
    </header>
    <div className="sb-exclusions-controls">
      <div className="sb-exclusions-tabs" role="tablist" aria-label="Type de référence" onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'track' : event.key === 'End' ? 'artist' : kind === 'track' ? 'artist' : 'track'; changeKind(next); document.getElementById(`sa-picker-tab-${next}`)?.focus(); } }}>
        <button type="button" role="tab" id="sa-picker-tab-track" aria-controls="sa-picker-panel" aria-selected={kind === 'track'} tabIndex={kind === 'track' ? 0 : -1} onClick={() => changeKind('track')}><Music2 size={16} /> Musiques <span>{selected.filter((item) => item.kind === 'track').length}</span></button>
        <button type="button" role="tab" id="sa-picker-tab-artist" aria-controls="sa-picker-panel" aria-selected={kind === 'artist'} tabIndex={kind === 'artist' ? 0 : -1} onClick={() => changeKind('artist')}><UserRound size={16} /> Artistes <span>{selected.filter((item) => item.kind === 'artist').length}</span></button>
      </div>
      <form className="sb-exclusions-search" onSubmit={(event) => { event.preventDefault(); if (q.length >= 2) retry(); }}>
        <Search size={18} aria-hidden="true" />
        <input ref={inputRef} type="search" aria-label="Rechercher sur YouTube" autoComplete="off" maxLength={180} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === 'track' ? 'Rechercher une musique ou un artiste' : 'Rechercher un artiste'} />
        {query && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={16} /></button>}
      </form>
      <p className="sb-exclusions-search-hint">YouTube · recherche automatique après une pause · quota API.</p>
    </div>
    <div className="sb-action-scroll sb-exclusions-scroll sa-picker-results" role="tabpanel" id="sa-picker-panel" aria-labelledby={`sa-picker-tab-${kind}`} tabIndex={0}>
      <div className="sb-exclusions-section-title"><h3>{kind === 'track' ? 'Musiques choisies' : 'Artistes choisis'}</h3><span>{visibleSelected.length}</span></div>
      {visibleSelected.length > 0 ? <div className="sb-exclusion-list sa-picker-selected">{visibleSelected.map((mention) => <div className="sb-exclusion-row" key={mentionKey(mention)}>
        {avatar(mention)}<div className="sb-exclusion-row__copy"><strong>{mention.title}</strong><small>{mention.kind === 'track' ? mention.artist : 'Chaîne YouTube'}</small></div>
        <button type="button" className="sb-exclusion-unblock" aria-label={`Retirer la référence ${mention.title}`} onClick={() => onToggle(mention)}>Retirer</button>
      </div>)}</div> : <div className="sb-exclusions-empty"><span>{kind === 'track' ? <Music2 size={19} /> : <UserRound size={19} />}</span><div><strong>{kind === 'track' ? 'Aucune musique choisie' : 'Aucun artiste choisi'}</strong><p>Les références ajoutées apparaîtront dans ton message sous forme de tags.</p></div></div>}
      {q.length >= 2 ? <section className="sb-exclusions-catalog" aria-label="Résultats YouTube">
        <div className="sb-exclusions-section-title"><h3>Sur YouTube</h3><span>{current && !current.error ? current.results.length : ''}</span></div>
        {loading ? <p className="sb-exclusions-state" role="status"><Loader2 size={17} className="sb-exclusions-spinner" /> Recherche en cours…</p>
          : current?.error ? <div className="sb-exclusions-state sb-exclusions-state--error" role="alert"><span>{current.error}</span><button type="button" onClick={retry}>Réessayer</button></div>
            : current?.results.length ? <div className="sb-exclusion-list">{current.results.map((mention) => {
              const checked = selected.some((item) => mentionKey(item) === mentionKey(mention));
              return <div className="sb-exclusion-row sa-picker-row" key={mentionKey(mention)}>
                {avatar(mention)}<div className="sb-exclusion-row__copy"><strong title={mention.kind === 'track' ? mention.youtubeTitle : mention.title}>{mention.title}</strong><small>{mention.kind === 'track' ? mention.artist : 'Chaîne YouTube'}</small></div>
                <a className="sa-picker-verify" href={mentionUrl(mention)} target="_blank" rel="noopener noreferrer" aria-label={`Vérifier ${mention.title} sur YouTube`}><ExternalLink size={14} /></a>
                <button type="button" className="sb-exclusion-add-result sa-picker-result" aria-label={`${checked ? 'Retirer' : 'Ajouter'} ${mention.title}${mention.kind === 'track' ? ` de ${mention.artist}` : ''}`} aria-pressed={checked} disabled={!checked && selected.length >= MAX_ASSISTANT_MENTIONS} onClick={() => onToggle(mention)}>
                  {checked ? <Check size={15} /> : <Plus size={15} />}<span>{checked ? 'Ajouté' : 'Ajouter'}</span>
                </button>
              </div>;
            })}</div> : <p className="sb-exclusions-state" role="status">Aucun résultat pour cette recherche.</p>}
      </section> : <div className="sb-exclusions-discover"><Search size={16} /><span>{q ? 'Saisis au moins deux caractères.' : 'Recherche un titre ou un artiste pour l’ajouter depuis le catalogue.'}</span></div>}
      <p className="sb-exclusions-privacy">Ta recherche est transmise à YouTube. Vérifie la version du morceau ou la chaîne de l’artiste.</p>
    </div>
    <footer className="sa-picker-footer"><span role="status">{selected.length}/{MAX_ASSISTANT_MENTIONS} références{selected.length >= MAX_ASSISTANT_MENTIONS ? ' · limite atteinte' : ''}</span><button type="button" className="sa-primary" onClick={onClose}>Terminé</button></footer>
  </dialog>, document.body);
};
