import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Play, Pause, Check, ChevronLeft, Plus, Music2, Disc3, X, ListMusic, ArrowRight,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { usePlayer } from '../../context/PlayerContext';
import { Modal, ModalHeader, ModalFooter } from '../ui/Modal';
import { Button } from '../ui';
import type { Playlist, Track } from '../../types';
import { Art, PlaylistArt } from '../ui/Art';

const fmt = (s: number) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.floor((s || 0) % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════
   Modale de sélection — le cœur du flux.
   Deux colonnes sur grand écran : playlists à gauche, morceaux à
   droite. Sur mobile, on passe de l'une à l'autre en glissant.
   Feuille plein cadre sur téléphone, dialogue bordé sur bureau.
   ═══════════════════════════════════════════════════════════════ */

export const PickerModal: React.FC = () => {
  const { modal, modalData, closeModal, openModal, design } = useUI();
  const {
    playlists, loadingLibrary, loadPlaylistTracks, libraryError, refreshLibrary,
    toggleTrack, isSelected, selectedTracks, clearSelection, searchCatalog,
  } = useData();
  const { playTrack, currentTrack, isPlaying } = usePlayer();

  const open = modal === 'picker';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileTracks, setMobileTracks] = useState(false);
  const [query, setQuery] = useState('');
  const [loadingTracks, setLoadingTracks] = useState(false);
  /* résultats venus du catalogue YouTube, en plus des playlists */
  const [catalog, setCatalog] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    /* arrivée par la barre de recherche : le champ prend le focus tout de suite */
    if (modalData?.focusSearch) setTimeout(() => searchRef.current?.focus(), 220);
    const wantId = modalData?.playlistId as string | undefined;
    if (wantId) {
      setActiveId(wantId);
      setMobileTracks(true);
    } else {
      setMobileTracks(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // si aucune playlist n'est choisie, on pré-sélectionne la première dès qu'elle arrive
  useEffect(() => {
    if (!open) return;
    if (activeId && playlists.some((p) => p.id === activeId)) return;
    const first = playlists.find((p) => !String(p?.id || '').startsWith('demo-pl-likes')) || playlists[0];
    if (first) setActiveId(first.id);
  }, [open, playlists, activeId]);

  // charge les morceaux de la playlist active
  useEffect(() => {
    if (!open || !activeId) return;
    const pl = playlists.find((p) => p.id === activeId);
    if (pl && (!pl.tracks || pl.tracks.length === 0)) {
      setLoadingTracks(true);
      loadPlaylistTracks(activeId).finally(() => setLoadingTracks(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeId]);

  /* requête tapée : on interroge le catalogue après une courte pause */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setCatalog([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const id = setTimeout(async () => {
      const res = await searchCatalog(q);
      setCatalog(res.tracks);
      setSearchError(res.error);
      setSearching(false);
    }, 420);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  const active = useMemo(() => playlists.find((p) => p.id === activeId) || null, [playlists, activeId]);
  const tracks = active?.tracks || [];
  const inPlaylist = tracks.filter(
    (t) => t.title.toLowerCase().includes(query.toLowerCase()) || t.artist.toLowerCase().includes(query.toLowerCase()),
  );
  const seen = new Set(inPlaylist.map((t) => t.videoId));
  const extra = catalog.filter((t) => !seen.has(t.videoId));
  /* en haut : ce que la recherche trouve ailleurs sur YouTube */
  const filtered = [...extra, ...inPlaylist];
  const hasQuery = query.trim().length >= 2;

  const totalSeconds = selectedTracks.reduce((acc, t) => acc + (t.durationSeconds || 200), 0);
  const openConfig = () => {
    closeModal();
    setTimeout(() => openModal('config'), 180);
  };

  /* ─── variante YouTube Music : plein écran, sobre, sans carte ─── */
  if (design === 'ytm') {
    return (
      <Modal open={open} onClose={closeModal} size="full" label="Choisir des morceaux" hideClose className="ytm-sheet">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 22px 12px' }}>
            {mobileTracks && active && (
              <button className="icon-btn" onClick={() => setMobileTracks(false)} aria-label="Retour"><ChevronLeft size={20} strokeWidth={1.8} /></button>
            )}
            <h2 className="title-display" style={{ fontSize: 22, margin: 0, fontWeight: 400 }}>
              {mobileTracks && active ? active.title : 'Choisis tes morceaux'}
            </h2>
            <span style={{ flex: 1 }} />
            <span className="ink-3" style={{ fontSize: 12.5 }}>{selectedTracks.length} sélectionné{selectedTracks.length > 1 ? 's' : ''}</span>
            <button className="icon-btn" onClick={closeModal} aria-label="Fermer"><X size={20} strokeWidth={1.8} /></button>
          </div>

          <div style={{ padding: '0 22px 12px' }}>
            <div className="ytm-search" style={{ maxWidth: 'none', cursor: 'text' }}>
              <Search size={16} strokeWidth={1.8} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={active ? 'Filtrer un titre ou un artiste' : 'Chercher'}
                style={{ flex: 1, background: 'none', border: 0, outline: 'none', color: 'var(--ink)', fontSize: 13.5 }}
              />
            </div>
          </div>

          <div className="picker-body" data-tracks={mobileTracks} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) minmax(0,1fr)', minHeight: 0, flex: 1, overflow: 'hidden' }}>
            <div className="picker-side" style={{ overflow: 'auto', padding: '0 10px 10px' }}>
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => { setActiveId(pl.id); setMobileTracks(true); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: 8, marginBottom: 2,
                    borderRadius: 10, border: 0, cursor: 'pointer', textAlign: 'left',
                    background: pl.id === activeId && !mobileTracks ? 'var(--bg-hover)' : 'transparent',
                    color: 'var(--ink)',
                  }}
                >
                  <PlaylistArt tracks={pl.tracks} title={pl.title} size={40} radius={6} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.title}</span>
                    <span className="ink-3" style={{ display: 'block', fontSize: 11.5 }}>{pl.tracks?.length ?? pl.trackCount} titres</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="picker-main" style={{ overflow: 'auto', padding: '0 18px 16px' }}>
              {active && loadingTracks && tracks.length === 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 54, borderRadius: 10 }} />)}
                </div>
              )}
              {!active && !hasQuery && <p className="ink-3" style={{ padding: 30, fontSize: 13 }}>Choisis une playlist à gauche.</p>}
              {searching && (
                <p className="ink-3" style={{ fontSize: 12, padding: '10px 8px 4px', display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span className="anim-spin" style={{ width: 12, height: 12, borderRadius: 999, border: '1.5px solid var(--line-2)', borderTopColor: 'var(--accent)' }} />
                  Recherche dans YouTube…
                </p>
              )}
              {hasQuery && extra.length > 0 && (
                <p className="sb-eyebrow" style={{ margin: '10px 8px 4px' }}>Ailleurs sur YouTube</p>
              )}
              {hasQuery && !searching && searchError && (
                <p className="ink-3" style={{ fontSize: 12, padding: '6px 8px 2px', lineHeight: 1.5 }}>
                  {searchError} Tu peux toujours choisir dans tes playlists ci-dessous.
                </p>
              )}
              {filtered.map((t, i) => {
                const fromCatalog = hasQuery && extra.includes(t);
                const firstPlaylistRow = hasQuery && extra.length > 0 && !fromCatalog && i === extra.length;
                const selected = isSelected(t.id, t);
                return (
                  <React.Fragment key={t.id}>
                  {firstPlaylistRow && <p className="sb-eyebrow" style={{ margin: '14px 8px 4px' }}>Dans ta playlist</p>}
                  <div
                    onClick={() => toggleTrack(t)}
                    className="track-row pick-row"
                    data-selected={selected ? 'true' : 'false'}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', animation: `fade-up .3s ${Math.min(i * 0.01, 0.2)}s both` }}
                  >
                    <span
                      style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'grid', placeItems: 'center',
                        border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line-strong)'}`,
                        background: selected ? 'var(--accent)' : 'transparent', color: '#fff',
                        transition: 'all .18s var(--ease-spring)',
                      }}
                    >
                      {selected && <Check size={12} strokeWidth={3.4} />}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); playTrack(t, filtered); }}
                      style={{ position: 'relative', width: 42, height: 42, borderRadius: 6, overflow: 'hidden', border: 0, padding: 0, cursor: 'pointer', flexShrink: 0 }}
                      aria-label={`Écouter ${t.title}`}
                    >
                      <Art track={t} size="100%" radius={6} />
                    </button>
                    <span className="pick-meta" style={{ minWidth: 0, flex: 1 }}>
                      <span className="pick-title" style={{ display: 'block', fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ink)' }}>{t.title}</span>
                      <span className="ink-3 pick-artist" style={{ display: 'block', fontSize: 12 }}>{t.artist}</span>
                    </span>
                    {fromCatalog && (
                      <span className="ink-3" style={{ fontSize: 10.5, border: '1px solid var(--line)', borderRadius: 999, padding: '2px 7px' }}>
                        YouTube
                      </span>
                    )}
                    <span className="ink-3 pick-dur" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                      {t.durationSeconds ? (t.durationFormatted || fmt(t.durationSeconds)) : ''}
                    </span>
                  </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
            <span className="ink-2" style={{ fontSize: 13 }}>
              {selectedTracks.length ? `${selectedTracks.length} morceau${selectedTracks.length > 1 ? 'x' : ''} · ≈ ${Math.max(1, Math.round(totalSeconds / 60))} min` : 'Rien de coché'}
            </span>
            <span style={{ flex: 1 }} />
            {selectedTracks.length > 0 && <Button variant="ghost" size="sm" onClick={clearSelection}>Vider</Button>}
            <Button onClick={openConfig} disabled={selectedTracks.length === 0}>
              Continuer <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={closeModal} size="full" label="Choisir des morceaux" hideClose>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {/* En-tête */}
        <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          {mobileTracks && active && (
            <button className="icon-btn filled" onClick={() => setMobileTracks(false)} aria-label="Retour aux playlists" style={{ marginTop: 2 }}>
              <ChevronLeft size={18} />
            </button>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="ink-3" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', marginBottom: 5 }}>
              Étape 1 · Amorces
            </div>
            <h2 className="title-display" style={{ fontSize: 22, margin: 0, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {mobileTracks && active ? active.title : 'Choisis ta vibe'}
            </h2>
            <p className="ink-2" style={{ fontSize: 13, margin: '5px 0 0' }}>
              {mobileTracks && active
                ? 'Coche les morceaux qui te parlent — autant que tu veux.'
                : 'Tes playlists, plus tes titres likés. Coche librement, sans limite.'}
            </p>
          </div>
          <button className="icon-btn" onClick={refreshLibrary} title="Resynchroniser"><Disc3 size={17} /></button>
          <button className="icon-btn filled" onClick={closeModal} aria-label="Fermer"><X size={18} /></button>
        </div>

        {/* Corps : playlists | morceaux */}
        <div
          className="picker-body"
          data-tracks={mobileTracks}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(240px, 320px) minmax(0, 1fr)',
            minHeight: 0, flex: 1, overflow: 'hidden',
          }}
        >
          {/* colonne playlists */}
          <div className="picker-side" style={{ borderRight: '1px solid var(--line)', overflow: 'auto', padding: 12, background: 'var(--bg-elev)' }}>
            {loadingLibrary && playlists.length === 0 && (
              <div style={{ display: 'grid', gap: 8, padding: 6 }}>
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 14 }} />)}
              </div>
            )}

            {libraryError && playlists.length <= 1 && (
              <div style={{ padding: 14, borderRadius: 16, background: 'var(--bg-sunken)', marginBottom: 8 }}>
                <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.5 }} className="ink-2">{libraryError}</p>
                <Button size="sm" variant="tonal" block onClick={refreshLibrary}><Disc3 size={14} /> Recharger</Button>
              </div>
            )}

            {playlists.map((pl) => (
              <PlaylistRow
                key={pl.id}
                playlist={pl}
                active={pl.id === activeId && !mobileTracks}
                onClick={() => { setActiveId(pl.id); setMobileTracks(true); }}
                count={pl.tracks?.length ?? pl.trackCount}
              />
            ))}

            <button
              onClick={() => { closeModal(); setTimeout(() => openModal('settings'), 180); }}
              className="ink-3"
              style={{ width: '100%', marginTop: 8, padding: '10px 12px', fontSize: 12, background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              Une playlist manque ? Vérifier la configuration
            </button>
          </div>

          {/* colonne morceaux */}
          <div className="picker-main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
                <input
                  className="field"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={active ? 'Filtrer un titre, un artiste…' : 'Chercher un morceau'}
                  style={{ height: 40, paddingLeft: 36, borderRadius: 999 }}
                />
              </div>
              {active && (
                <Button
                  size="sm"
                  variant="tonal"
                  onClick={() => filtered.forEach((t) => { if (!isSelected(t.id)) toggleTrack(t); })}
                  className="sb-hide-sm"
                >
                  <Plus size={14} /> Tout ajouter
                </Button>
              )}
            </div>

            <div style={{ overflow: 'auto', padding: '10px 12px 18px', flex: 1 }}>
              {!active && (
                <div style={{ height: '100%', minHeight: 240, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
                  <div>
                    <div style={{ width: 62, height: 62, borderRadius: 20, background: 'var(--accent-soft)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
                      <ListMusic size={26} style={{ color: 'var(--accent)' }} />
                    </div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Choisis une playlist à gauche</p>
                    <p className="ink-3" style={{ margin: '6px 0 0', fontSize: 13 }}>Ses morceaux s’afficheront ici, prêts à être cochés.</p>
                  </div>
                </div>
              )}

              {active && loadingTracks && tracks.length === 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 58, borderRadius: 14 }} />)}
                </div>
              )}

              {active && !loadingTracks && filtered.length === 0 && (
                <p className="ink-3" style={{ textAlign: 'center', padding: 40, fontSize: 13 }}>Aucun morceau ne correspond.</p>
              )}

              <AnimatePresence initial={false}>
                {filtered.map((t, i) => {
                  const selected = isSelected(t.id, t);
                  const playing = currentTrack?.id === t.id && isPlaying;
                  return (
                    <motion.div
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: Math.min(i * 0.012, 0.24), duration: 0.25 }}
                      onClick={() => toggleTrack(t)}
                      className={`track-row tap ${selected ? 'is-selected' : ''}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                        padding: '7px 10px', borderRadius: 14,
                        background: selected ? 'var(--accent-soft)' : 'transparent',
                        transition: 'background-color .2s',
                      }}
                    >
                      <span
                        style={{
                          width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                          display: 'grid', placeItems: 'center',
                          border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--line-strong)'}`,
                          background: selected ? 'var(--accent)' : 'transparent',
                          color: 'var(--accent-ink)',
                          transition: 'all .2s var(--ease-spring)',
                        }}
                      >
                        {selected && <Check size={13} strokeWidth={3.2} />}
                      </span>

                      <button
                        onClick={(e) => { e.stopPropagation(); playTrack(t, filtered); }}
                        aria-label={`Écouter ${t.title}`}
                        style={{ position: 'relative', width: 44, height: 44, borderRadius: 10, overflow: 'hidden', border: 0, padding: 0, cursor: 'pointer', flexShrink: 0 }}
                      >
                        <Art track={t} size="100%" radius={6} />
                        <span className="row-play" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.45)', color: '#fff', opacity: 0, transition: 'opacity .2s' }}>
                          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 1 }} />}
                        </span>
                      </button>

                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: selected ? 650 : 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.title}
                        </span>
                        <span className="ink-3" style={{ display: 'block', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist}</span>
                      </span>

                      <span className="ink-3" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{t.durationFormatted || fmt(t.durationSeconds)}</span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Pied */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elev)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex' }}>
              {selectedTracks.slice(-4).map((t, i) => (
                <Art key={t.id} track={t} size={34} radius={9} style={{ marginLeft: i === 0 ? 0 : -10, border: '2px solid var(--bg-elev)' }} />
              ))}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)' }}>
                {selectedTracks.length} morceau{selectedTracks.length > 1 ? 'x' : ''}
              </div>
              <div className="ink-3" style={{ fontSize: 11.5 }}>
                {selectedTracks.length ? `≈ ${Math.max(1, Math.round(totalSeconds / 60))} min de musique` : 'Rien de coché pour l’instant'}
              </div>
            </div>
          </div>

          {selectedTracks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSelection}>Vider</Button>
          )}
          <Button variant="primary" onClick={openConfig} disabled={selectedTracks.length === 0}>
            Suivant
            <ArrowRight size={16} className="chev" />
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const PlaylistRow: React.FC<{
  playlist: Playlist;
  active: boolean;
  count: number;
  onClick: () => void;
}> = ({ playlist, active, count, onClick }) => {
  const isLikes = false;
  return (
    <button
      onClick={onClick}
      className="tap"
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: 7,
        background: active ? 'var(--accent-soft)' : 'transparent',
        border: `1px solid ${active ? 'color-mix(in oklab, var(--accent) 40%, transparent)' : 'transparent'}`,
        cursor: 'pointer', textAlign: 'left', borderRadius: 14, marginBottom: 2,
        transition: 'background-color .2s, border-color .2s',
      }}
    >
      <span style={{ width: 42, height: 42, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-sunken)', display: 'grid', placeItems: 'center' }}>
        {isLikes ? (
          <Music2 size={18} style={{ color: 'var(--fresh)' }} />
        ) : (
          <PlaylistArt tracks={playlist.tracks} title={playlist.title} size="100%" radius={10} />
        )}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: active ? 650 : 550, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {playlist.title}
        </span>
        <span className="ink-3" style={{ display: 'block', fontSize: 11.5 }}>{count} titre{count > 1 ? 's' : ''}</span>
      </span>
      {active && <Check size={15} style={{ color: 'var(--accent)' }} />}
    </button>
  );
};
