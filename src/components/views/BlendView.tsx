import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  Play, Pause, ThumbsUp, ThumbsDown, Trash2, RefreshCw, Share2, ExternalLink,
  ChevronUp, ChevronDown, ArrowLeft, Pencil, Lock, Globe, Check, Clock, Sparkles,
  MoreHorizontal, ArrowRight, Download, Radio,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { usePlayer } from '../../context/PlayerContext';
import { geminiService } from '../../services/gemini';
import { youtubeService } from '../../services/youtube';
import { getStoredTasteMemory } from '../../services/storage';
import { useReplaceQueue } from '../../context/ReplaceQueueContext';
import { Button, Equalizer } from '../ui';
import { Art } from '../ui/Art';
import type { Track, TrackCategory } from '../../types';
import { trackKey } from '../../lib/track';

const CAT: Record<TrackCategory, { label: string; color: string }> = {
  anchor: { label: 'Anchor', color: 'var(--anchor)' },
  deep_dive: { label: 'Deep dive', color: 'var(--deep)' },
  fresh: { label: 'Découverte', color: 'var(--fresh)' },
};

/* ═══════════════════════════════════════════════════════════════
   Étape 3 — le résultat. Grande pochette-mosaïque, lecture,
   réordonnancement, remplacement à 1 clic, export YouTube Music.
   ═══════════════════════════════════════════════════════════════ */

export const BlendView: React.FC = () => {
  const { currentBlend, updateBlend, settings, isAuthenticated, ratingOf, setRating } = useData();
  const { design, showToast, setView } = useUI();
  const { playTrack, currentTrack, isPlaying, rateTrack } = usePlayer();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(currentBlend?.title || '');
  const [priv, setPriv] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(currentBlend?.exportedUrl || null);
  const queue = useReplaceQueue();

  const blend = currentBlend;

  const stats = useMemo(() => {
    if (!blend) return null;
    const seconds = blend.tracks.reduce((a, t) => a + (t.durationSeconds || 200), 0);
    return {
      minutes: Math.round(seconds / 60),
      anchor: blend.tracks.filter((t) => t.category === 'anchor').length,
      deep: blend.tracks.filter((t) => t.category === 'deep_dive').length,
      fresh: blend.tracks.filter((t) => t.category === 'fresh').length,
    };
  }, [blend]);

  if (!blend || !stats) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', textAlign: 'center', padding: 24 }}>
        <div>
          <p className="ink-2">Aucun blend affiché pour l’instant.</p>
          <Button variant="tonal" onClick={() => setView('library')}>Retour à la bibliothèque</Button>
        </div>
      </div>
    );
  }

  /* ── playlist déjà exportée : la garder au diapason ────────────────
     Dès qu'un titre est ajouté, retiré ou remplacé dans le blend, la
     playlist YouTube Music ne correspond plus. On compare les deux
     contenus et, si ça diverge, on propose « Mettre à jour ». */
  const [outOfSync, setOutOfSync] = useState(false);
  const [updating, setUpdating] = useState(false);
  /* sans connexion Google, on ne peut pas comparer : le bouton reste caché */
  const [canSync, setCanSync] = useState(false);
  useEffect(() => { setCanSync(youtubeService.isAuthenticated()); }, [blend.exportedPlaylistId]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const pid = blend.exportedPlaylistId;
      /* on interroge le service : le jeton peut avoir été restauré après le
         premier rendu (le contexte, lui, garde la valeur du démarrage) */
      if (!pid || !youtubeService.isAuthenticated()) { setOutOfSync(false); return; }
      const remote = await youtubeService.getPlaylistItems(pid).catch(() => []);
      if (!alive || !remote.length) { setOutOfSync(false); return; }   // rien à comparer
      /* l'ordre compte autant que le contenu : un titre déplacé dans le
         blend doit aussi se déplacer sur YouTube Music */
      const there = remote.map((r) => r.videoId);
      const here = (blend.tracks.map((t) => t.videoId).filter(Boolean) as string[])
        .filter((v, i, a) => a.indexOf(v) === i);
      const same = there.length === here.length && here.every((v, i) => there[i] === v);
      setOutOfSync(!same);
    };
    void check();
    return () => { alive = false; };
  }, [blend.exportedPlaylistId, blend.tracks, isAuthenticated]);

  const updateOnYT = async () => {
    const pid = blend.exportedPlaylistId;
    if (!pid || updating) return;
    setUpdating(true);
    try {
      const res = await youtubeService.syncPlaylist(pid, blend.tracks);
      setOutOfSync(false);
      const bits = [
        res.added ? `${res.added} ajout${res.added > 1 ? 's' : ''}` : '',
        res.removed ? `${res.removed} retrait${res.removed > 1 ? 's' : ''}` : '',
        res.moved ? `${res.moved} déplacement${res.moved > 1 ? 's' : ''}` : '',
      ].filter(Boolean);
      showToast(bits.length ? `Playlist mise à jour : ${bits.join(', ')}.` : 'La playlist était déjà à jour.');
    } catch (e: any) {
      showToast(e?.message || 'Mise à jour impossible.');
    } finally {
      setUpdating(false);
    }
  };

  const saveTitle = () => {
    setEditing(false);
    if (title.trim() && title !== blend.title) updateBlend({ ...blend, title: title.trim() });
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blend.tracks.length) return;
    const next = [...blend.tracks];
    [next[i], next[j]] = [next[j], next[i]];
    updateBlend({ ...blend, tracks: next });
  };

  const remove = (id: string) => updateBlend({ ...blend, tracks: blend.tracks.filter((t) => t.id !== id) });

  /* Noter un titre : le lecteur, le blend et le registre partagé avancent
     ensemble. C'est ce registre — et non la ligne de liste — qui alimente
     l'affichage : un vote posé ici se voit donc aussitôt dans la barre du
     lecteur, et réciproquement. */
  const myRating = (t: Track) => ratingOf(t) ?? t.userRating ?? null;
  const rate = (t: Track, rating: 'liked' | 'disliked') => {
    const next: 'liked' | 'disliked' | null = myRating(t) === rating ? null : rating;
    rateTrack(t, rating);
    setRating(t, next);
    updateBlend({
      ...blend,
      tracks: blend.tracks.map((x) => (trackKey(x) === trackKey(t) ? { ...x, userRating: next } : x)),
    });
  };

  /* ── remplacer un morceau ──────────────────────────────────────
     Le travail ne se fait plus ici : on l'empile dans la file, qui
     s'occupe de tout, un morceau à la fois. On peut donc en lancer
     plusieurs d'affilée, quitter le blend et revenir : l'icône tourne
     toujours et la proposition finit par arriver. */
  const replace = (track: Track) => {
    if (!queue) return;
    if (queue.jobFor(blend.id, track.id)) return;      // déjà en file
    queue.enqueue({
      blendId: blend.id,
      trackId: track.id,
      trackTitle: track.title,
      run: async (onStep) => {
        /* on transmet l'étape ET la note du moteur : le bandeau affiche
           aussi ce que le modèle a compris du contexte */
        const relay = (s: any) => onStep(s);
        /* deux essais : si la première proposition est déjà dans le blend
           (ou tombe sur la même vidéo), on en demande une autre au lieu de
           rendre un échec à l'auditeur */
        for (let attempt = 0; attempt < 2; attempt++) {
          const fresh = await geminiService.replaceSingleTrack(
            track, blend.tracks, blend.seedTracks, getStoredTasteMemory(),
            { onStep: relay, nonce: Date.now() + attempt },
          );
          const note = geminiService.takeEngineNote();
          if (note) onStep(note as any);
          if (!fresh) continue;
          if (blend.tracks.some((t) => t.id !== track.id && t.videoId && t.videoId === fresh.videoId)) continue;
          if (!fresh.videoId) continue;
          return { title: fresh.title, artist: fresh.artist, track: fresh };
        }
        return null;
      },
    });
  };

  /* une proposition prête est appliquée dès qu'elle arrive — que l'on
     soit resté sur le blend ou revenu après un détour */
  useEffect(() => {
    if (!queue) return;
    const ready = queue.readyFor(blend.id);
    if (!ready?.result) return;
    const target = blend.tracks.find((t) => t.id === ready.trackId);
    if (target) {
      updateBlend({
        ...blend,
        tracks: blend.tracks.map((t) => (t.id === ready.trackId ? ready.result!.track : t)),
      });
      showToast(`« ${target.title} » remplacé par « ${ready.result.title} » — ${ready.result.artist}.`);
    }
    queue.consume(ready.id);
  }, [queue, blend, updateBlend, showToast]);

  const exportToYT = async () => {
    if (!isAuthenticated) {
      showToast('Connecte ton compte YouTube pour exporter ce blend.');
      setView('settings');
      return;
    }
    setExporting(true);
    try {
      const desc = `Blend SoundBlend AI — amorces : ${blend.seedTracks.map((t) => t.title).join(', ')}`;
      const id = await youtubeService.createPlaylist(title || blend.title, desc, priv);
      await youtubeService.addTracksToPlaylist(id, blend.tracks);
      const url = `https://music.youtube.com/playlist?list=${id}`;
      setExported(url);
      updateBlend({ ...blend, exportedPlaylistId: id, exportedUrl: url });
      confetti({ particleCount: 110, spread: 75, origin: { y: 0.62 }, colors: ['#7b61ff', '#0a84ff', '#f0568c'] });
      showToast('Playlist créée sur YouTube Music.');
    } catch (e: any) {
      showToast(e?.message || 'Export impossible.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="ytm-page">
      {/* retour */}
      <button className="sb-back" onClick={() => setView('library')}>
        <ArrowLeft size={17} strokeWidth={2} /> Bibliothèque
      </button>

      {/* ─────────── en-tête du blend ─────────── */}
      <motion.header
        className="sb-blend-head"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sb-mosaic">
          {blend.tracks.slice(0, 4).map((t) => (
            <Art key={t.id} track={t} size="100%" radius={0} />
          ))}
        </div>

        <div className="sb-blend-info">
          <div className="sb-eyebrow">Blend · {stats.minutes} min</div>

          {editing ? (
            <div className="sb-rename">
              <input
                className="field"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
              />
              <button className="btn btn-sm" onClick={saveTitle}><Check size={15} /> OK</button>
            </div>
          ) : (
            <h1>
              {blend.title}
              <button className="sb-title-edit" onClick={() => { setTitle(blend.title); setEditing(true); }} aria-label="Renommer">
                <Pencil size={15} strokeWidth={1.9} />
              </button>
            </h1>
          )}

          <p className="sb-blend-counts">
            {stats.anchor} anchor · {stats.deep} deep dives · {stats.fresh} découvertes
          </p>

          <div className="sb-blend-buttons">
            <button
              className="btn"
              onClick={() => blend.tracks[0] && playTrack(blend.tracks[0], blend.tracks)}
            >
              <Play size={15} fill="currentColor" /> Écouter
            </button>

            {exported ? (
              <>
                <a className="btn btn-tonal" href={exported} target="_blank" rel="noreferrer">
                  <Check size={15} /> YouTube Music
                </a>
                {(canSync && (outOfSync || updating)) && (
                  <button
                    className="btn btn-tonal sb-sync-btn"
                    data-stale="true"
                    onClick={updateOnYT}
                    disabled={updating}
                    title="Le blend a changé depuis l’export : remettre la playlist YouTube Music à jour"
                  >
                    <RefreshCw size={15} className={updating ? 'anim-spin' : ''} />
                    {updating ? 'Mise à jour…' : 'Mettre à jour'}
                    {!updating && <span className="sb-sync-dot" aria-hidden />}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-tonal" onClick={exportToYT} disabled={exporting}>
                {exporting ? <RefreshCw size={15} className="anim-spin" /> : <Share2 size={15} />}
                {exporting ? 'Export…' : 'Exporter'}
              </button>
            )}

            <button className="chip" onClick={() => setPriv((v) => !v)} title="Visibilité de la playlist exportée">
              {priv ? <Lock size={13} strokeWidth={2} /> : <Globe size={13} strokeWidth={2} />}
              {priv ? 'Privée' : 'Publique'}
            </button>

            <button className="chip sb-hide-sm" onClick={() => { setTitle(blend.title); setEditing(true); }}>
              <Pencil size={13} strokeWidth={2} /> Renommer
            </button>
          </div>
        </div>
      </motion.header>

      {/* ─────────── liste des titres ─────────── */}
      <div className="sb-list sb-list--roomy">
        {blend.tracks.map((t, i) => {
          const playing = currentTrack?.id === t.id && isPlaying;
          const cat = t.category ? CAT[t.category] : null;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.012, 0.18), duration: 0.26 }}
              className="sb-track-row"
              data-playing={currentTrack?.id === t.id ? '1' : '0'}
            >
              <span className="sb-track-index">{String(i + 1).padStart(2, '0')}</span>

              <button
                className="sb-track-art"
                onClick={() => playTrack(t, blend.tracks)}
                aria-label={`Lire ${t.title}`}
              >
                <Art track={t} size="100%" radius={0} />
                <span className="sb-track-play">
                  {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                </span>
              </button>

              <button className="sb-track-meta" onClick={() => playTrack(t, blend.tracks)}>
                <span className="sb-row-title">
                  {t.title}
                  {cat && <span className="sb-cat" data-cat={t.category}>{cat.label}</span>}
                </span>
                <span className="sb-row-sub">
                  {t.artist}{t.rationale ? ` — ${t.rationale}` : ''}
                </span>
              </button>

              <div className="sb-track-actions">
                <button
                  className="icon-btn rate-btn"
                  data-on={myRating(t) === 'liked' ? 'true' : 'false'}
                  onClick={() => rate(t, 'liked')}
                  title={myRating(t) === 'liked' ? 'Retirer mon avis' : 'J’aime'}
                  aria-label="J’aime"
                  aria-pressed={myRating(t) === 'liked'}
                >
                  <ThumbsUp size={15} strokeWidth={1.9} fill={myRating(t) === 'liked' ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="icon-btn rate-btn"
                  data-on={myRating(t) === 'disliked' ? 'true' : 'false'}
                  onClick={() => rate(t, 'disliked')}
                  title={myRating(t) === 'disliked' ? 'Retirer mon avis' : 'Pas pour moi'}
                  aria-label="Pas pour moi"
                  aria-pressed={myRating(t) === 'disliked'}
                >
                  <ThumbsDown size={15} strokeWidth={1.9} fill={myRating(t) === 'disliked' ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => replace(t)}
                  title={queue?.jobFor(blend.id, t.id) ? 'Remplacement en cours…' : 'Remplacer'}
                  aria-label="Remplacer"
                  aria-busy={!!queue?.jobFor(blend.id, t.id)}
                >
                  <RefreshCw
                    size={15}
                    strokeWidth={1.9}
                    className={queue?.jobFor(blend.id, t.id) ? 'anim-spin' : ''}
                  />
                </button>
                <button className="icon-btn" onClick={() => remove(t.id)} title="Retirer" aria-label="Retirer">
                  <Trash2 size={15} strokeWidth={1.9} />
                </button>
                <span className="sb-reorder sb-hide-sm">
                  <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Monter"><ChevronUp size={15} /></button>
                  <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Descendre"><ChevronDown size={15} /></button>
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <p className="sb-footnote">
        <Sparkles size={13} strokeWidth={1.8} /> {blend.tracks.length} titres · {stats.minutes} min ·
        blend conservé 14 jours sur cet appareil.
      </p>
    </div>
  );
};
