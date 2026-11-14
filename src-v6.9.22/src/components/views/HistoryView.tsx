import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Trash2, Clock3, ChevronRight, Sparkles } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { Art } from '../ui/Art';
import { useUI } from '../../context/UIContext';
import { usePlayer } from '../../context/PlayerContext';

/* ═══════════════════════════════════════════════════════════════
   Mes blends — liste plate, comme l'écran « Blends » de l'app :
   pochette + titre + « n titres · m min » + échéance, actions à
   droite. Aucune carte, aucun ombrage.
   ═══════════════════════════════════════════════════════════════ */

export const HistoryView: React.FC = () => {
  const { recentBlends, removeBlend, setCurrentBlend } = useData();
  const { setView } = useUI();
  const { playTrack } = usePlayer();
  const [confirm, setConfirm] = useState<string | null>(null);
  /* plus de voile au survol : ce détecteur ne servait qu'à lui.
     On le garde pour l'attribut de compatibilité posé plus bas. */
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: none)');
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  const rows = useMemo(
    () =>
      recentBlends.map((b) => ({
        ...b,
        minutes: Math.max(1, Math.round(b.tracks.reduce((s, t) => s + (t.durationSeconds || 0), 0) / 60)),
        remaining: Math.max(0, Math.ceil((new Date(b.expiresAt).getTime() - Date.now()) / 86400000)),
      })),
    [recentBlends],
  );

  const open = (id: string) => {
    const b = recentBlends.find((x) => x.id === id);
    if (!b) return;
    setCurrentBlend(b);
    setView('blend');
  };

  return (
    <div className="ytm-page">
      <header className="sb-hero sb-hero--compact">
        <h1>Mes blends</h1>
        <p>
          {rows.length
            ? `${rows.length} blend${rows.length > 1 ? 's' : ''} gardé${rows.length > 1 ? 's' : ''} sur cet appareil — 14 jours.`
            : 'Rien encore — compose ton premier blend.'}
        </p>
      </header>

      {rows.length > 0 && (
        <div className="sb-list sb-list--roomy">
          <AnimatePresence initial={false}>
            {rows.map((b) => (
              <motion.div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => open(b.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(b.id); }}
                style={{ cursor: 'pointer' }}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="sb-blend-row"
              >
                <button className="sb-blend-thumb" onClick={(e) => { e.stopPropagation(); open(b.id); }} aria-label={`Ouvrir ${b.title}`}>
                  <span className="sb-blend-cover">
                    <Art track={b.tracks[0] || { videoId: '', title: b.title, artist: '', thumbnailUrl: '' }} size="100%" radius={0} />
                    {/* la pochette sert aussi de fond au bouton lecture : plus de rond vide */}
                    <span className="sb-blend-play" aria-hidden data-always={coarse ? '1' : '0'}>
                      <Art track={b.tracks[1] || b.tracks[0] || { videoId: '', title: b.title, artist: '', thumbnailUrl: '' }} size="100%" radius={0} />
                      <Play size={13} fill="currentColor" />
                    </span>
                  </span>
                </button>

                <span className="sb-blend-meta">
                  <span className="sb-row-title sb-row-title--strong">{b.title}</span>
                  <span className="sb-row-sub">
                    {b.tracks.length} titres · {b.minutes} min
                  </span>
                  <span className="sb-blend-expiry">
                    <Clock3 size={11} strokeWidth={2} /> expire dans {b.remaining} j
                  </span>
                </span>

                <div className="sb-blend-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn"
                    onClick={(e) => { e.stopPropagation(); if (b.tracks[0]) playTrack(b.tracks[0], b.tracks); }}
                    aria-label="Écouter"
                    title="Écouter"
                  >
                    <Play size={17} strokeWidth={1.9} />
                  </button>
                  <button
                    className="icon-btn sb-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm === b.id) { removeBlend(b.id); setConfirm(null); }
                      else setConfirm(b.id);
                    }}
                    aria-label="Supprimer"
                    title={confirm === b.id ? 'Confirmer la suppression' : 'Supprimer'}
                  >
                    <Trash2 size={16} strokeWidth={1.9} />
                  </button>
                  <button className="icon-btn sb-hide-sm" onClick={(e) => { e.stopPropagation(); open(b.id); }} aria-label="Ouvrir">
                    <ChevronRight size={17} strokeWidth={1.9} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {rows.length === 0 && (
        <div className="sb-empty-block">
          <div className="sb-empty-icon"><Sparkles size={22} strokeWidth={1.6} /></div>
          <p className="sb-empty-title">Aucun blend pour l’instant</p>
          <p className="sb-empty">Choisis quelques amorces,<br />l’IA s’occupe du reste.</p>
          <button className="btn" onClick={() => setView('library')}>Composer un blend</button>
        </div>
      )}
    </div>
  );
};
