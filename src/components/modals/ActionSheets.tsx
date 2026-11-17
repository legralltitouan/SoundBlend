import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { Ban, Check, ChevronRight, Loader2, Music2, Plus, Search, UserRound, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI, type ActionSheet } from '../../context/UIContext';
import { artistMatches, getExclusionRecords, isExcluded } from '../../services/storage';
import { searchExclusionCatalog, type CatalogResult } from '../../services/exclusionCatalog';
import type { ExclusionRecord, Track } from '../../types';
import { Art } from '../ui/Art';

/** Une seule couche, au-dessus du lecteur et des autres fenêtres. */
export const ActionSheets: React.FC = () => {
  const { actionSheet } = useUI();
  return createPortal(
    <AnimatePresence>
      {actionSheet && <SheetFrame key={actionSheet.instance} sheet={actionSheet} />}
    </AnimatePresence>,
    document.body,
  );
};

const SheetFrame: React.FC<{ sheet: ActionSheet }> = ({ sheet }) => {
  const { closeActionSheet } = useUI();
  const panel = useRef<HTMLElement | null>(null);
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    // Pour « Ajouter », l'input est prêt dès l'ouverture ; sinon le premier
    // choix ou l'onglet courant reçoit le focus, sans déplacer la page.
    const target = panel.current?.querySelector<HTMLElement>('[data-sheet-initial]:not([disabled])')
      || panel.current?.querySelector<HTMLElement>('button:not([disabled])');
    target?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((el) => !el.hidden && el.getClientRects().length > 0);
      if (!focusable.length) { e.preventDefault(); panel.current.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.current.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [present]);

  const transition = { duration: reducedMotion ? 0.01 : 0.34, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  return (
    <div className="sb-action-layer" data-present={present ? 'true' : 'false'} aria-hidden={!present || undefined} inert={!present || undefined}>
      <motion.div className="sb-action-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0.01 : 0.23 }} onClick={closeActionSheet} />
      <motion.section
        ref={panel}
        className={`sb-action-sheet ${sheet.kind === 'exclusions' ? 'sb-action-sheet--exclusions' : 'sb-action-sheet--block'}`}
        role="dialog"
        aria-modal="true"
        aria-label={sheet.kind === 'block' ? 'Bloquer' : 'Exclusions'}
        tabIndex={-1}
        initial={reducedMotion ? { opacity: 0 } : { y: '100%', opacity: 0.9 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reducedMotion ? { opacity: 0 } : { y: '100%', opacity: 0.9 }}
        transition={transition}
      >
        <span className="sb-action-grip" aria-hidden />
        {sheet.kind === 'block' ? <BlockSheet track={sheet.track} /> : <ExclusionsSheet focusSearch={sheet.focusSearch} present={present} />}
      </motion.section>
    </div>
  );
};

const BlockSheet: React.FC<{ track: Track }> = ({ track }) => {
  const { blockTrack, exclusions } = useData();
  const { closeActionSheet, showToast } = useUI();
  const [error, setError] = useState('');
  const trackAlready = isExcluded(track, { tracks: exclusions.tracks, artists: [] });
  const artistAlready = exclusions.artists.some((a) => artistMatches(a, track.artist) && artistMatches(track.artist, a));
  const choose = (kind: 'track' | 'artist') => {
    try {
      blockTrack(track, kind);
      closeActionSheet();
      showToast(kind === 'track' ? `« ${track.title} » ne sera plus proposé.` : `${track.artist} ne sera plus proposé.`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Impossible de bloquer ce titre.'); }
  };
  return (
    <div className="sb-action-scroll sb-block-content">
      <header className="sb-action-heading">
        <div><p className="sb-action-eyebrow">TES PRÉFÉRENCES</p><h2>Ne plus proposer</h2><p>Qu’est-ce que tu souhaites exclure ?</p></div>
        <button type="button" className="sb-action-close" onClick={closeActionSheet} aria-label="Fermer"><X size={19} /></button>
      </header>
      <div className="sb-block-current">
        <Art track={track} size={52} radius={10} />
        <div><strong>{track.title || 'Musique inconnue'}</strong><span>{track.artist || 'Artiste inconnu'}</span></div>
        <Ban size={18} aria-hidden />
      </div>
      <p className="sb-block-explain">Choisis ce que tu ne veux plus retrouver dans tes prochains blends.</p>
      <div className="sb-block-choices">
        <button type="button" className="sb-block-choice" aria-label="Ne plus proposer cette musique" data-sheet-initial onClick={() => choose('track')} disabled={!track.title || !track.artist || trackAlready}>
          <span className="sb-block-choice__icon"><Music2 size={19} /></span>
          <span className="sb-block-choice__copy"><strong>Ne plus proposer cette musique</strong><small>{trackAlready ? 'Cette musique est déjà exclue' : 'Ce titre uniquement'}</small></span>
          {trackAlready ? <Check size={17} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
        </button>
        <button type="button" className="sb-block-choice" aria-label="Ne plus proposer cet artiste" onClick={() => choose('artist')} disabled={!track.artist || artistAlready}>
          <span className="sb-block-choice__icon"><UserRound size={19} /></span>
          <span className="sb-block-choice__copy"><strong>Ne plus proposer cet artiste</strong><small>{artistAlready ? 'Cet artiste est déjà exclu' : `Tous les titres de ${track.artist || 'cet artiste'}`}</small></span>
          {artistAlready ? <Check size={17} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
        </button>
      </div>
      {error && <p className="sb-action-error" role="alert">{error}</p>}
      <p className="sb-action-footnote">Tu peux revenir sur ton choix dans Réglages → Exclusions.</p>
    </div>
  );
};

type SearchState = { key: string; phase: 'ready' | 'error'; results: CatalogResult[]; message?: string };
const comparable = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const resultName = (r: CatalogResult) => r.kind === 'track' ? r.title : r.artist;

const ExclusionsSheet: React.FC<{ focusSearch: boolean; present: boolean }> = ({ focusSearch, present }) => {
  const { exclusions, blockTrack, unblockExclusion } = useData();
  const { closeActionSheet } = useUI();
  const [kind, setKind] = useState<'track' | 'artist'>('track');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState<SearchState | null>(null);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement | null>(null);
  const tabs = useRef<Record<'track' | 'artist', HTMLButtonElement | null>>({ track: null, artist: null });
  const q = query.trim();
  const searchKey = `${kind}:${q}:${revision}`;

  // Le changement de texte / d'onglet, la fermeture et un nouvel essai
  // annulent l'ancien appel ; aucune réponse tardive ne remplace la nouvelle.
  // Une nouvelle révision n'a pas encore de résultat : l'affichage déduit
  // « chargement » directement au lieu de synchroniser un état dans l'effet.
  useEffect(() => {
    if (!present || !q) return;
    const controller = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      void searchExclusionCatalog(q, kind, controller.signal).then((results) => {
        if (active && !controller.signal.aborted) setSearch({ key: searchKey, phase: 'ready', results });
      }).catch((e: unknown) => {
        if (active && !controller.signal.aborted) setSearch({ key: searchKey, phase: 'error', results: [], message: e instanceof Error ? e.message : 'Recherche indisponible.' });
      });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [kind, q, searchKey, present]);

  // La lecture est déclenchée à chaque rendu lié aux exclusions, y compris
  // après une synchro Drive. Les tombstones restent invisibles dans la liste.
  const records = getExclusionRecords().filter((r) => !r.deleted && r.kind === kind);
  const terms = comparable(q).split(/\s+/).filter(Boolean);
  const visibleRecords = terms.length ? records.filter((r) => {
    const haystack = comparable(`${r.title || ''} ${r.artist}`);
    return terms.every((term) => haystack.includes(term));
  }) : records;
  const currentSearch = search?.key === searchKey ? search : null;

  const changeQuery = (value: string) => { setQuery(value); setRevision((n) => n + 1); setNotice(''); };
  const switchTab = (next: 'track' | 'artist', focus = false) => {
    setKind(next);
    setRevision((n) => n + 1);
    setNotice('');
    if (focus) tabs.current[next]?.focus();
  };
  const onTabKey = (e: React.KeyboardEvent) => {
    let next: 'track' | 'artist' | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next = kind === 'track' ? 'artist' : 'track';
    if (e.key === 'Home') next = 'track';
    if (e.key === 'End') next = 'artist';
    if (next) { e.preventDefault(); switchTab(next, true); }
  };
  const remove = (r: ExclusionRecord) => {
    try {
      unblockExclusion(r.id);
      setNotice(`${r.kind === 'track' ? `« ${r.title} »` : r.artist} a été débloqué${r.kind === 'track' ? 'e' : ''}.`);
      requestAnimationFrame(() => tabs.current[kind]?.focus({ preventScroll: true }));
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Déblocage non enregistré.'); }
  };
  const add = (r: CatalogResult) => {
    try {
      blockTrack(r.kind === 'track' ? { title: r.title, artist: r.artist, videoId: r.videoId } : { artist: r.artist }, r.kind);
      setNotice(r.kind === 'track' ? `« ${r.title} » est maintenant exclue.` : `${r.artist} est maintenant exclu.`);
    } catch (e: unknown) { setNotice(e instanceof Error ? e.message : 'Impossible d’ajouter cette exclusion.'); }
  };
  const isDirectlyExcluded = (r: CatalogResult) => r.kind === 'track'
    ? isExcluded(r, { tracks: exclusions.tracks, artists: [] })
    : exclusions.artists.some((a) => artistMatches(a, r.artist) && artistMatches(r.artist, a));

  return (
    <>
      <header className="sb-exclusions-header sb-action-heading">
        <div><p className="sb-action-eyebrow">TON ESPACE MUSICAL</p><h2>Exclusions</h2><p>Garde la main sur ce que SoundBlend te propose.</p></div>
        <button type="button" className="sb-action-close" onClick={closeActionSheet} aria-label="Fermer"><X size={19} /></button>
      </header>
      <div className="sb-exclusions-controls">
        <div className="sb-exclusions-tabs" role="tablist" aria-label="Type d’exclusion" onKeyDown={onTabKey}>
          <button ref={(el) => { tabs.current.track = el; }} type="button" id="sb-exclusions-tab-track" role="tab" aria-selected={kind === 'track'} aria-controls="sb-exclusions-panel" tabIndex={kind === 'track' ? 0 : -1} data-sheet-initial={!focusSearch ? '' : undefined} onClick={() => switchTab('track')}><Music2 size={16} /> Musiques <span>{exclusions.tracks.length}</span></button>
          <button ref={(el) => { tabs.current.artist = el; }} type="button" id="sb-exclusions-tab-artist" role="tab" aria-selected={kind === 'artist'} aria-controls="sb-exclusions-panel" tabIndex={kind === 'artist' ? 0 : -1} onClick={() => switchTab('artist')}><UserRound size={16} /> Artistes <span>{exclusions.artists.length}</span></button>
        </div>
        <div className="sb-exclusions-search">
          <Search size={18} aria-hidden />
          <input
            ref={input}
            type="search"
            aria-label="Rechercher dans les exclusions et le catalogue"
            placeholder={kind === 'track' ? 'Rechercher une musique ou un artiste' : 'Rechercher un artiste'}
            data-sheet-initial={focusSearch ? '' : undefined}
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            autoComplete="off"
          />
          {query && <button type="button" aria-label="Effacer la recherche" onClick={() => { changeQuery(''); input.current?.focus(); }}><X size={16} /></button>}
        </div>
        <p className="sb-exclusions-search-hint">Tes exclusions et YouTube Music, via Piped (service public).</p>
      </div>
      <div className="sb-action-scroll sb-exclusions-scroll" role="tabpanel" id="sb-exclusions-panel" aria-labelledby={`sb-exclusions-tab-${kind}`}>
        <div className="sb-exclusions-section-title"><h3>{kind === 'track' ? 'Musiques exclues' : 'Artistes exclus'}</h3><span>{visibleRecords.length}</span></div>
        {visibleRecords.length ? <div className="sb-exclusion-list">
          {visibleRecords.map((r) => <div className="sb-exclusion-row" key={r.id}>
            <CatalogAvatar kind={r.kind} image={r.videoId ? `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg` : undefined} />
            <div className="sb-exclusion-row__copy"><strong>{r.kind === 'track' ? r.title : r.artist}</strong><small>{r.kind === 'track' ? r.artist : 'Artiste'}</small></div>
            <button type="button" className="sb-exclusion-unblock" aria-label={`Débloquer ${r.kind === 'artist' ? r.artist : r.title}`} onClick={() => remove(r)}>Débloquer</button>
          </div>)}
        </div> : <div className="sb-exclusions-empty">
          <span><Ban size={19} /></span>
          <div><strong>{q ? 'Aucune exclusion correspondante' : kind === 'track' ? 'Aucune musique exclue' : 'Aucun artiste exclu'}</strong><p>{q ? 'Les résultats du catalogue apparaissent juste en dessous.' : 'Tes exclusions apparaîtront ici. Tu peux les retirer à tout moment.'}</p></div>
        </div>}

        {q ? <section className="sb-exclusions-catalog" aria-label="Résultats YouTube Music">
          <div className="sb-exclusions-section-title"><h3>Sur YouTube Music</h3><span>{currentSearch?.phase === 'ready' ? currentSearch.results.length : ''}</span></div>
          {!currentSearch ? <p className="sb-exclusions-state" role="status"><Loader2 size={17} className="sb-exclusions-spinner" /> Recherche en cours…</p>
            : currentSearch.phase === 'error' ? <div className="sb-exclusions-state sb-exclusions-state--error" role="alert"><span>{currentSearch.message}</span><button type="button" onClick={() => setRevision((n) => n + 1)}>Réessayer</button></div>
              : currentSearch.results.length ? <div className="sb-exclusion-list">
                {currentSearch.results.map((r) => {
                  const blocked = isDirectlyExcluded(r);
                  const artistBlocked = r.kind === 'track' && !blocked && isExcluded(r, { tracks: [], artists: exclusions.artists });
                  return <div className="sb-exclusion-row" key={r.kind === 'track' ? r.videoId : r.id}>
                    <CatalogAvatar kind={r.kind} image={r.thumbnail} />
                    <div className="sb-exclusion-row__copy"><strong>{resultName(r)}</strong><small>{r.kind === 'track' ? `${r.artist}${artistBlocked ? ' · artiste exclu' : ''}` : 'Artiste'}</small></div>
                    <button type="button" className="sb-exclusion-add-result" aria-label={blocked ? `${resultName(r)} déjà exclu${r.kind === 'track' ? 'e' : ''}` : `Exclure ${resultName(r)}${r.kind === 'track' ? ` de ${r.artist}` : ''}`} aria-disabled={blocked || undefined} onClick={() => { if (!blocked) add(r); }}>
                      {blocked ? <Check size={15} /> : <Plus size={15} />} <span>{blocked ? 'Exclu' : 'Exclure'}</span>
                    </button>
                  </div>;
                })}
              </div> : <p className="sb-exclusions-state">Aucun résultat pour cette recherche.</p>}
        </section> : <div className="sb-exclusions-discover"><Search size={16} /><span>Recherche un titre ou un artiste pour l’ajouter depuis le catalogue.</span></div>}
        <p className="sb-exclusions-privacy">Ta recherche est transmise à une instance Piped publique indépendante.</p>
        <p className="sb-exclusions-help">Musique et artiste sont indépendants. Les correspondances reposent sur leurs noms et peuvent regrouper des homonymes ou des variantes d’un titre.</p>
      </div>
      <div className="sb-exclusions-notice" role="status" aria-live="polite">{notice}</div>
    </>
  );
};

const CatalogAvatar: React.FC<{ kind: 'track' | 'artist'; image?: string }> = ({ kind, image }) => {
  const [failedImage, setFailedImage] = useState<string | undefined>();
  return <span className={`sb-exclusion-art sb-exclusion-art--${kind}`} aria-hidden>
    {kind === 'track' ? <Music2 size={18} /> : <UserRound size={18} />}
    {image && failedImage !== image && <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />}
  </span>;
};
