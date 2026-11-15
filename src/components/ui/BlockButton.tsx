import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import type { Track } from '../../types';

/** Un seul bouton, deux gestes volontairement distincts. */
export const BlockButton: React.FC<{ track: Track; className?: string; size?: number }> = ({ track, className = '', size = 17 }) => {
  const [open, setOpen] = useState(false);
  const { blockTrack } = useData();
  const { showToast } = useUI();
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);
  const choose = (kind: 'track' | 'artist') => {
    try {
      blockTrack(track, kind);
      setOpen(false);
      showToast(kind === 'track' ? `« ${track.title} » ne sera plus proposé.` : `${track.artist} ne sera plus proposé.`);
    } catch (e: any) { showToast(e?.message || 'Impossible de bloquer ce titre.'); }
  };
  return <>
    <button type="button" className={`icon-btn ${className}`} aria-label="Bloquer" title="Bloquer" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
      <Ban size={size} strokeWidth={1.9} />
    </button>
    {open && createPortal(
      <div className="sb-block-backdrop" onClick={() => setOpen(false)}>
        <section className="sb-block-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-block-title" onClick={(e) => e.stopPropagation()}>
          <div className="sb-block-heading"><div><h2 id="sb-block-title">Bloquer</h2><p>{track.title} · {track.artist}</p></div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Fermer"><X size={18} /></button></div>
          <p className="sb-block-explain">Choisis précisément ce que SoundBlend ne doit plus proposer. Tu pourras le débloquer dans Réglages.</p>
          <button autoFocus className="sb-block-choice" onClick={() => choose('track')}>
            <strong>Ne plus proposer cette musique</strong><span>Seulement « {track.title} » de {track.artist}</span>
          </button>
          <button className="sb-block-choice" onClick={() => choose('artist')}>
            <strong>Ne plus proposer cet artiste</strong><span>Tous les titres de {track.artist}</span>
          </button>
        </section>
      </div>, document.body,
    )}
  </>;
};
