import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, ThumbsDown, Trash2, Brain, Sparkles, RotateCcw, AlertTriangle } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { getStoredTasteMemory, saveStoredTasteMemory } from '../../services/storage';
import type { TasteMemory } from '../../types';

/* Mémoire des goûts : avis mémorisés, exploitables et effaçables. */
export const TasteView: React.FC = () => {
  const { tasteVersion, bumpTaste, resetAllRatings } = useData();
  const { design, showToast } = useUI();
  const [memory, setMemory] = useState<TasteMemory>(getStoredTasteMemory);
  const [tab, setTab] = useState<'liked' | 'disliked'>('liked');
  /* effacer ses goûts est définitif : on demande d'abord confirmation */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setMemory(getStoredTasteMemory());
  }, [tasteVersion]);

  const update = (next: TasteMemory) => {
    saveStoredTasteMemory(next);
    setMemory(next);
    bumpTaste();
  };

  const tracks = tab === 'liked' ? memory.likedTracks : memory.dislikedTracks;
  const artists = tab === 'liked' ? memory.likedArtists : memory.dislikedArtists;

  const removeTrack = (id: string) =>
    update({
      ...memory,
      likedTracks: tab === 'liked' ? memory.likedTracks.filter((t) => t.id !== id) : memory.likedTracks,
      dislikedTracks: tab === 'disliked' ? memory.dislikedTracks.filter((t) => t.id !== id) : memory.dislikedTracks,
    });

  const removeArtist = (name: string) =>
    update({
      ...memory,
      likedArtists: tab === 'liked' ? memory.likedArtists.filter((a) => a !== name) : memory.likedArtists,
      dislikedArtists: tab === 'disliked' ? memory.dislikedArtists.filter((a) => a !== name) : memory.dislikedArtists,
    });

  return (
    <div className="ytm-page">
      <header className="sb-hero sb-hero--compact">
        <h1>Tes goûts</h1>
        <p>
          Chaque pouce nourrit la mémoire de l’IA : elle évite ce que tu écartes et
          privilégie ce qui te plaît.
        </p>
        <div className="sb-chips">
          <button className="chip" onClick={() => setConfirming(true)}>
            <RotateCcw size={14} strokeWidth={2} /> Réinitialiser
          </button>
        </div>
      </header>

      <AnimatePresence>
        {confirming && (
          <motion.div
            key="confirm-reset"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="sb-confirm" role="alertdialog" aria-label="Confirmer la réinitialisation">
              <span className="sb-confirm-icon"><AlertTriangle size={17} strokeWidth={1.9} /></span>
              <div className="sb-confirm-body">
                <p className="sb-confirm-title">Effacer tous tes avis ?</p>
                <p className="sb-confirm-text">
                  Tous les pouces (aimés et écartés) seront retirés de chaque morceau,
                  et la mémoire de l’IA repartira de zéro. C’est définitif.
                </p>
                <div className="sb-confirm-actions">
                  <button className="chip" onClick={() => setConfirming(false)}>Annuler</button>
                  <button
                    className="chip chip--danger"
                    onClick={() => {
                      resetAllRatings();
                      setConfirming(false);
                      showToast('Tous tes avis ont été effacés.');
                    }}
                  >
                    <Trash2 size={13} strokeWidth={2} /> Effacer mes avis
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sb-stats">
        <StatCell icon={<ThumbsUp size={14} strokeWidth={2} />} value={memory.likedTracks.length} label="aimés" />
        <StatCell icon={<ThumbsDown size={14} strokeWidth={2} />} value={memory.dislikedTracks.length} label="écartés" />
        <StatCell icon={<Sparkles size={14} strokeWidth={2} />} value={memory.likedArtists.length} label="artistes" />
        <StatCell icon={<Brain size={14} strokeWidth={2} />} value={memory.dislikedArtists.length} label="évités" />
      </div>

      <div className="sb-chips sb-chips--tight">
        <button className="chip" data-on={tab === 'liked' ? '1' : '0'} onClick={() => setTab('liked')}>
          <ThumbsUp size={14} strokeWidth={2} /> Aimés
        </button>
        <button className="chip" data-on={tab === 'disliked' ? '1' : '0'} onClick={() => setTab('disliked')}>
          <ThumbsDown size={14} strokeWidth={2} /> Écartés
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <AnimatePresence initial={false}>
          {tracks.map((t) => (
            <motion.div
              key={t.id + t.title}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              className="sb-row sb-row--flat"
            >
              <span className="sb-dot" data-liked={tab === 'liked' ? '1' : '0'} />
              <span className="sb-row-meta">
                <span className="sb-row-title">{t.title}</span>
                <span className="sb-row-sub">{t.artist}</span>
              </span>
              <button className="icon-btn" onClick={() => removeTrack(t.id)} title="Oublier" aria-label="Oublier">
                <Trash2 size={15} strokeWidth={1.9} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        {tracks.length === 0 && (
          <p className="sb-empty">
            Rien ici pour le moment.<br />
            Les avis donnés dans le lecteur ou dans un blend apparaîtront ici.
          </p>
        )}
      </div>

      {artists.length > 0 && (
        <>
          <div className="sb-section-head"><h2>Artistes</h2></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {artists.map((a) => (
              <span key={a} className="chip" style={{ cursor: 'default', paddingRight: 6 }}>
                {a}
                <button onClick={() => removeArtist(a)} aria-label={`Oublier ${a}`} style={{ display: 'grid', placeItems: 'center', border: 0, background: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6 }}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const StatCell: React.FC<{ icon: React.ReactNode; value: number; label: string }> = ({ icon, value, label }) => (
  <div className="sb-stat">
    <span className="sb-stat-icon">{icon}</span>
    <span className="sb-stat-value">{value}</span>
    <span className="sb-stat-label">{label}</span>
  </div>
);
