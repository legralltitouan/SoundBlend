import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, ThumbsUp, ThumbsDown,
  Maximize2, ExternalLink, ListMusic, ChevronUp,
} from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { useData } from '../../context/DataContext';
import { useCover } from '../ui/Art';
import { Art } from '../ui/Art';

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════
   Lecteur persistant — une seule barre de progression, celle du
   haut, qui s'épaissit au survol et se déplace à la main.
   Sur bureau, le volume prend la place de l'ancienne barre en double.
   ═══════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════
   Gestes de la feuille « En lecture ».

   · un glissement vers le bas ferme la feuille — on suit le doigt,
     et si le geste est franc on referme, sinon la feuille remonte ;
   · un glissement horizontal sur la pochette passe au morceau
     suivant (vers la gauche) ou revient au précédent (vers la droite),
     avec la pochette qui suit le doigt.

   Rien de tout cela ne doit gêner la barre de progression : les
   gestes partent du fond de la feuille et de la pochette seulement.
   ═══════════════════════════════════════════════════════════════ */

type Gesture = {
  active: boolean;
  mode: 'sheet' | 'cover' | null;
  x: number; y: number; dx: number; dy: number;
  axis: 'none' | 'x' | 'y';
};

const useSheetGestures = (opts: {
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) => {
  const [offset, setOffset] = useState(0);          // la feuille suit le doigt
  const [coverDx, setCoverDx] = useState(0);        // la pochette suit le doigt
  const g = useRef<Gesture>({ active: false, mode: null, x: 0, y: 0, dx: 0, dy: 0, axis: 'none' });

  /* un seul point d'entrée : c'est l'endroit où le doigt se pose qui
     décide du geste. Pas de gestionnaire concurrent, donc pas de doute
     sur ce qui doit se produire au relâchement. */
  const start = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;           // à la souris, rien à simuler
    const t = e.target as HTMLElement;
    /* la barre de progression et la file gardent leurs propres gestes */
    if (t.closest('.prail, .nowplaying-queue')) return;
    const mode: Gesture['mode'] = t.closest('.nowplaying-art') ? 'cover' : 'sheet';
    g.current = { active: true, mode, x: e.clientX, y: e.clientY, dx: 0, dy: 0, axis: 'none' };
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture?.(e.pointerId); } catch { /* sans capture, tant pis */ }
  };

  const move = (e: React.PointerEvent) => {
    const d = g.current;
    if (!d.active) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    if (d.axis === 'none') {
      if (Math.abs(d.dx) < 10 && Math.abs(d.dy) < 10) return;
      d.axis = Math.abs(d.dx) > Math.abs(d.dy) ? 'x' : 'y';
    }
    if (d.mode === 'cover' && d.axis === 'x') setCoverDx(d.dx);
    if (d.mode === 'sheet' && d.axis === 'y' && d.dy > 0) setOffset(d.dy);
  };

  const end = () => {
    const d = g.current;
    if (!d.active) return;
    d.active = false;

    if (d.mode === 'cover' && d.axis === 'x') {
      /* un geste franc d'au moins 60 px change de morceau */
      if (d.dx < -60) opts.onNext();
      else if (d.dx > 60) opts.onPrev();
      setCoverDx(0);
      return;
    }
    if (d.mode === 'sheet' && d.axis === 'y') {
      /* la feuille se referme si elle a été tirée assez bas */
      if (d.dy > 110) opts.onClose();
      setOffset(0);
      return;
    }
    setOffset(0);
    setCoverDx(0);
  };

  return { offset, coverDx, start, move, end };
};

/* ═══════════════════════════════════════════════════════════════
   Geste de la barre du bas : un glissement vers le haut n'importe où
   sur la barre (pochette, titre, vide) ouvre le lecteur plein écran —
   comme le fait l'app mobile. Un appui simple, lui, ne change rien.
   ═══════════════════════════════════════════════════════════════ */

const useBarSwipe = (onUp: () => void) => {
  const g = useRef({ x: 0, y: 0, active: false, dy: 0 });
  const start = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    g.current = { x: e.clientX, y: e.clientY, active: true, dy: 0 };
  };
  const move = (e: React.PointerEvent) => {
    if (!g.current.active) return;
    g.current.dy = e.clientY - g.current.y;
  };
  const end = () => {
    if (!g.current.active) return;
    const { dy, x } = g.current;
    g.current.active = false;
    /* geste franc vers le haut, sans dérive horizontale */
    if (dy < -34) onUp();
  };
  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: () => { g.current.active = false; },
  };
};

export const PlayerBar: React.FC = () => {
  const {
    currentTrack, isPlaying, progress, duration, volume, isMuted,
    togglePlay, seekTo, setVolume, toggleMute, nextTrack, prevTrack, stepTrack, toggleVideoModal,
  } = usePlayer();

  /* même registre que la liste du blend : un vote posé ici s'y voit, et
     réciproquement — plus de décalage entre les deux affichages */
  const { ratingOf, setRating } = useData();
  const { rateTrack } = usePlayer();
  const ownRating = currentTrack ? ratingOf(currentTrack) ?? currentTrack.userRating ?? null : null;
  const vote = (r: 'liked' | 'disliked') => {
    if (!currentTrack) return;
    rateTrack(currentTrack, r);
    setRating(currentTrack, ownRating === r ? null : r);
  };

  const [expanded, setExpanded] = useState(false);
  /* les gestes de la feuille : glisser vers le bas pour la refermer,
     glisser sur la pochette pour changer de morceau */
  const sheet = useSheetGestures({
    onClose: () => setExpanded(false),
    onNext: () => stepTrack(1),
    onPrev: () => stepTrack(-1),
  });


  const pct = useMemo(() => (duration ? Math.min(100, (progress / duration) * 100) : 0), [progress, duration]);

  /* glisser vers le haut sur la barre ouvre le plein écran */
  const barSwipe = useBarSwipe(() => setExpanded(true));

  if (!currentTrack) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          key="ytm-bar"
          className="ytm-nowbar"
          initial={{ y: 70, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 70, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          {...barSwipe}
        >
          {/* progression : fine au repos, épaisse et manipulable au survol */}
          <ProgressRail
            value={progress}
            max={duration || 100}
            onSeek={seekTo}
            className="nowbar-progress"
          />

          <button
            onClick={() => setExpanded(true)}
            className="nowbar-track"
            aria-label="Ouvrir le lecteur"
          >
            <Art track={currentTrack} size={40} radius={6} />
            <span className="nowbar-meta">
              <span className="nowbar-title">{currentTrack.title}</span>
              <span className="nowbar-artist">{currentTrack.artist}</span>
            </span>
          </button>

          <div className="nowbar-controls">
            <button className="icon-btn" onClick={prevTrack} aria-label="Précédent">
              <SkipBack size={18} strokeWidth={1.8} />
            </button>
            <button className="nowbar-play" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Lecture'}>
              {isPlaying
                ? <Pause size={16} fill="currentColor" />
                : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className="icon-btn" onClick={nextTrack} aria-label="Suivant">
              <SkipForward size={18} strokeWidth={1.8} />
            </button>
          </div>

          {/* à droite : le temps, le volume, les actions — groupés pour que
              les commandes de lecture restent pile au milieu de la bande */}
          <div className="nowbar-right">
            <div className="nowbar-times">
              <span>{fmt(progress)}</span>
              <span className="ink-3">/ {fmt(duration)}</span>
            </div>

            {/* bureau : le volume remplace l'ancienne seconde barre */}
            <div className="nowbar-volume">
              <button className="icon-btn" onClick={toggleMute} aria-label={isMuted ? 'Rétablir le son' : 'Couper le son'}>
                {isMuted || volume === 0
                  ? <VolumeX size={17} strokeWidth={1.8} />
                  : <Volume2 size={17} strokeWidth={1.8} />}
              </button>
              <ProgressRail
                value={isMuted ? 0 : volume}
                max={100}
                onSeek={(v) => { setVolume(v); if (isMuted && v > 0) toggleMute(); }}
                className="volume-rail"
                label="Volume"
              />
            </div>

            <div className="nowbar-actions">
              <button
                className="icon-btn rate-btn"
                data-on={ownRating === 'liked' ? 'true' : 'false'}
                onClick={() => vote('liked')}
                aria-label="J’aime"
                aria-pressed={ownRating === 'liked'}
              >
                <ThumbsUp size={16} strokeWidth={1.9} fill={ownRating === 'liked' ? 'currentColor' : 'none'} />
              </button>
              <button
                className="icon-btn rate-btn"
                data-on={ownRating === 'disliked' ? 'true' : 'false'}
                onClick={() => vote('disliked')}
                aria-label="Je n’aime pas"
                aria-pressed={ownRating === 'disliked'}
              >
                <ThumbsDown size={16} strokeWidth={1.9} fill={ownRating === 'disliked' ? 'currentColor' : 'none'} />
              </button>
              <button className="icon-btn sb-hide-sm" onClick={toggleVideoModal} aria-label="Clip">
                <Maximize2 size={15} strokeWidth={1.9} />
              </button>
              <button className="icon-btn" onClick={() => setExpanded(true)} aria-label="File d’attente">
                <ListMusic size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Now playing plein écran */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            className="nowplaying"
            style={{ transform: sheet.offset ? `translateY(${sheet.offset}px)` : undefined }}
            data-dragging={sheet.offset > 4 ? '1' : '0'}
            onPointerDownCapture={sheet.start}
            onPointerMoveCapture={sheet.move}
            onPointerUpCapture={sheet.end}
            onPointerCancelCapture={sheet.end}
          >
            {/* poignée : le repère du glissement vers le bas */}
            <span className="nowplaying-grip" aria-hidden />
            {/* ambiance : la pochette du morceau, floutée derrière l'écran */}
            <div className="nowplaying-ambience" aria-hidden>
              {/* les mêmes nappes animées que le reste du site, aux couleurs de la pochette */}
              <div className="nowplaying-aura">
                <i /><i /><i />
              </div>
            </div>

            <div className="nowplaying-top">
              <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Réduire">
                <ChevronUp size={20} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <span className="nowplaying-eyebrow">En lecture</span>
              {/* plus d'icône en haut à droite : la croix du haut suffit */}
              <span className="nowplaying-spacer" aria-hidden />
            </div>

            <div className="nowplaying-body">
              <motion.div
                key={currentTrack.id}
                initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="nowplaying-art"
                style={{
                  transform: sheet.coverDx ? `translateX(${sheet.coverDx}px) rotate(${sheet.coverDx * 0.02}deg)` : undefined,
                  opacity: sheet.coverDx ? Math.max(0.45, 1 - Math.abs(sheet.coverDx) / 420) : 1,
                }}

              >
                <Art track={currentTrack} size="100%" radius={16} large />
              </motion.div>
              <div className="nowplaying-meta">
                <h2 className="title-display">{currentTrack.title}</h2>
                <p className="ink-3">{currentTrack.artist}</p>
                {currentTrack.rationale && <p className="ink-2 nowplaying-why">{currentTrack.rationale}</p>}
              </div>

              <div className="nowplaying-progress">
                <ProgressRail
                  value={progress}
                  max={duration || 100}
                  onSeek={seekTo}
                  className="big-rail"
                  label="Progression"
                />
                <div className="nowplaying-times">
                  <span>{fmt(progress)}</span>
                  <span>{fmt(duration)}</span>
                </div>
              </div>

              <div className="nowplaying-controls">
                <button className="icon-btn nowplaying-vote" data-on={ownRating === 'disliked' ? 'true' : 'false'}
                  onClick={() => vote('disliked')} aria-label="Je n’aime pas" aria-pressed={ownRating === 'disliked'}>
                  <ThumbsDown size={19} strokeWidth={1.8} fill={ownRating === 'disliked' ? 'currentColor' : 'none'} />
                </button>
                <button className="icon-btn" onClick={prevTrack} aria-label="Précédent">
                  <SkipBack size={24} strokeWidth={1.6} />
                </button>
                <button className="nowplaying-play" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Lecture'}>
                  {isPlaying
                    ? <Pause size={24} fill="currentColor" />
                    : <Play size={24} fill="currentColor" style={{ marginLeft: 3 }} />}
                </button>
                <button className="icon-btn" onClick={nextTrack} aria-label="Suivant">
                  <SkipForward size={24} strokeWidth={1.6} />
                </button>
                <button className="icon-btn nowplaying-vote" data-on={ownRating === 'liked' ? 'true' : 'false'}
                  onClick={() => vote('liked')} aria-label="J’aime" aria-pressed={ownRating === 'liked'}>
                  <ThumbsUp size={19} strokeWidth={1.8} fill={ownRating === 'liked' ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>

            <QueueStrip onPick={() => setExpanded(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

/* ─────────────── file d'attente du plein écran ─────────────── */

const QueueStrip: React.FC<{ onPick: () => void }> = ({ onPick }) => {
  const { queue, currentIndex, playTrack } = usePlayer();
  if (queue.length === 0) return null;
  return (
    <div className="nowplaying-queue">
      {queue.map((t, i) => (
        <button
          key={t.id + i}
          onClick={() => { playTrack(t, queue); onPick(); }}
          data-active={i === currentIndex}
          className="queue-item"
        >
          <Art track={t} size={96} radius={8} />
          <span className="queue-title">{t.title}</span>
        </button>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Barre de lecture manipulable : clic, clic maintenu, glissement.
   Même comportement sur téléphone et sur ordinateur.
   ═══════════════════════════════════════════════════════════════ */

const ProgressRail: React.FC<{
  value: number;
  max: number;
  onSeek: (v: number) => void;
  className?: string;
  label?: string;
}> = ({ value, max, onSeek, className = '', label = 'Progression' }) => {
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  const ratioFromEvent = (clientX: number) => {
    const el = railRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const shown = preview ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;
  /* la vague n'habille que la progression (barre du bas + plein écran) ;
     le volume garde son filet simple */
  /* la vague colorée est réservée au plein écran ; la barre du bas garde son
     filet d'origine, avec l'anneau lumineux comme repère */
  const isWave = className.includes('big-rail');
  const isBottom = className.includes('nowbar-progress');

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    const v = ratioFromEvent(e.clientX) * max;
    setPreview(v);
    onSeek(v);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const v = ratioFromEvent(e.clientX) * max;
    setPreview(v);
    onSeek(v);
  };

  const end = () => {
    setDragging(false);
    setPreview(null);
  };

  return (
    <div
      ref={railRef}
      className={`prail ${className} ${dragging ? 'is-dragging' : ''} ${hovering ? 'is-hovering' : ''}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => { setHovering(false); if (dragging) end(); }}
      onPointerEnter={() => setHovering(true)}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max) || 0}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(max, value + 5));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, value - 5));
      }}
    >
      {isWave ? (
        <WaveRail value={shown} max={max} pct={pct} className={className} />
      ) : (
        <>
          <span className="prail-track" />
          <span className="prail-fill" style={{ width: `${pct}%` }} />
        </>
      )}
      {(hovering || dragging || isBottom) && <span className="prail-knob" style={{ left: `${pct}%` }} />}
    </div>
  );
};


/* ═══════════════════════════════════════════════════════════════
   La barre de progression : une ligne, et des aurores.

   · une ligne fine traverse toute la largeur — la piste ;
   · sur la partie écoutée, deux ou trois « aurores » colorées, tirées de
     la pochette, s'élèvent et retombent en douceur, comme une nappe ;
   · un anneau lumineux marque la position exacte.
   Tout est tracé dans un seul canvas, en pause quand rien ne joue.
   ═══════════════════════════════════════════════════════════════ */

const WaveRail: React.FC<{ value: number; max: number; pct: number; className: string }> = ({ value, max, pct, className }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const pctRef = useRef(pct);
  pctRef.current = pct;
  const { isPlaying, currentTrack } = usePlayer();
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const el = ref.current?.closest('.prail');
    if (!el) return;
    const io = new MutationObserver(() =>
      setHover(el.classList.contains('is-hovering') || el.classList.contains('is-dragging')));
    io.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => io.disconnect();
  }, []);

  /* une graine par morceau : chaque titre a sa propre forme d'aurore */
  const seed = useMemo(() => {
    const key = `${currentTrack?.id ?? ''}`;
    let h = 11;
    for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) % 997;
    return h;
  }, [currentTrack?.id]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0;
    let t = 0;
    let phase = Math.random() * 100;

    const palette = () => {
      const st = getComputedStyle(document.documentElement);
      return {
        h: Number(st.getPropertyValue('--p-h')) || 352,
        s: (st.getPropertyValue('--p-s') || '62%').trim(),
        l: (st.getPropertyValue('--p-l') || '48%').trim(),
        ink: (st.getPropertyValue('--ink') || '#ffffff').trim(),
      };
    };
    let col = palette();
    const onPalette = () => { col = palette(); if (!isPlaying) draw(); };
    window.addEventListener('sb:palette', onPalette);

    /* trois aurores : centre, largeur, amplitude, couleur */
    /* les aurores vivent juste avant le curseur : une crête large, deux
       plus fines, comme une nappe qui vient mourir sur la position */
    /* centres en fraction de la partie écoutée, largeurs en fraction de la
       barre : les bosses gardent une taille constante, bien séparées */
    const auroras = [
      { c: 0.46, w: 0.115, a: 0.55 },
      { c: 0.70, w: 0.085, a: 1.0 },
      { c: 0.88, w: 0.060, a: 0.66 },
    ];

    /* l'aurore i, hauteur au point x (0 → 1 sur la partie écoutée) */
    const crest = (x: number, split: number, i: number, maxAmp: number) => {
      const a = auroras[i];
      const d = (x - a.c * split) / Math.max(8, a.w * w);
      const bell = Math.exp(-d * d * 2.1);
      const breathe = 0.88 + Math.sin(t * 0.5 + i * 1.9 + phase) * 0.12;
      return bell * a.a * breathe * maxAmp;
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (w < 8) return;
      /* Dans la barre du bas, le filet est au ras du haut du canevas : les
         aurores doivent tenir sous le bord supérieur, sinon elles sont
         rognées. On calcule donc la place réellement disponible au-dessus
         du filet, et on y borne les crêtes. */
      const atEdge = className.includes('nowbar-progress');
      const mid = atEdge ? 2 : h - 4;
      const splitRaw = (pctRef.current / 100) * w;
      /* sous 24 px, la forme n'a pas la place de respirer : on garde une
         amorce discrète plutôt qu'un triangle écrasé */
      const split = Math.max(0, Math.min(w, splitRaw));
      /* marge de sécurité : la crête la plus haute ne doit jamais toucher
         le bord (ni le haut du canevas, ni la ligne du bas) */
      const room = atEdge ? Math.max(2, h - mid - 2) : Math.max(2, h * 0.5 - 2);
      const maxAmp = room * 0.92 * (hover ? 1.1 : 1);

      /* 1. la piste : une ligne fine sur toute la largeur */
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

      /* 2. la ligne écoutée, plus franche */
      if (split > 1) {
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(split, mid); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* 3. les aurores, uniquement sur la partie écoutée, en fondu au bord */
      if (split > 24) {
        auroras.forEach((a, i) => {
          const hue = (col.h + (i === 0 ? -18 : i === 1 ? 12 : 40)) % 360;
          const light = Math.max(42, Math.min(66, parseInt(col.l) + (i === 1 ? 8 : 2)));
          const grad = ctx.createLinearGradient(0, mid - maxAmp * a.a, 0, mid);
          grad.addColorStop(0, `hsl(${hue} ${col.s} ${Math.min(72, light + 16)}% / 0.95)`);
          grad.addColorStop(0.55, `hsl(${hue} ${col.s} ${light}% / 0.98)`);
          grad.addColorStop(1, `hsl(${(hue + 16) % 360} ${col.s} ${Math.max(30, light - 14)}% / 0.9)`);

          /* la forme : une bosse, posée sur la ligne */
          ctx.beginPath();
          for (let x = 0; x <= split; x += 1) {
            const edge = Math.min(1, (x / split) * 5, ((split - x) / 26)); // meurt avant le curseur
            const y = Math.min(crest(x, split, i, maxAmp) * Math.max(0, edge), mid - 1);
            if (x === 0) ctx.moveTo(x, mid - y); else ctx.lineTo(x, mid - y);
          }
          for (let x = split; x >= 0; x -= 1) {
            const edge = Math.min(1, (x / split) * 5, ((split - x) / 26));
            const y = Math.min(crest(x, split, i, maxAmp) * Math.max(0, edge), mid - 1);
            ctx.lineTo(x, Math.min(h - 1, mid + y * 0.08));      // à peine sous la ligne
          }
          ctx.closePath();
          ctx.fillStyle = grad;
          ctx.globalAlpha = 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
        });

        /* un liséré clair sur la crête principale */
        ctx.beginPath();
        for (let x = 0; x <= split; x += 1) {
          const edge = Math.min(1, (x / split) * 5, ((split - x) / 26));
          const y = Math.min(crest(x, split, 1, maxAmp) * Math.max(0, edge), mid - 1);
          if (x === 0) ctx.moveTo(x, mid - y); else ctx.lineTo(x, mid - y);
        }
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    const loop = () => { t += 0.012; draw(); raf = requestAnimationFrame(loop); };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width));
      const nh = Math.max(1, Math.round(r.height));
      if (nw === w && nh === h) return;
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (isPlaying) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('sb:palette', onPalette);
    };
  }, [isPlaying, seed, hover]);

  /* hors lecture, la position change encore (glissement) : on redessine */
  useEffect(() => {
    if (isPlaying) return;
    const c = ref.current;
    if (!c) return;
    const ev = new CustomEvent('sb:redraw');
    c.dispatchEvent(ev);
  }, [pct, isPlaying]);

  return (
    <canvas
      ref={ref}
      className={`prail-wave ${className.includes('big-rail') ? 'prail-wave--big' : ''} ${className.includes('nowbar-progress') ? 'prail-wave--edge' : ''}`}
      aria-hidden
    />
  );
};

export const VideoModal: React.FC = () => {
  const { isVideoOpen, toggleVideoModal, currentTrack } = usePlayer();
  if (!currentTrack) return null;
  return (
    <AnimatePresence>
      {isVideoOpen && (
        <div className="fixed inset-0 z-[75] grid place-items-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={toggleVideoModal}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(10px)' }}
          />
          <motion.div
            initial={{ scale: 0.94, y: 16, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{
              position: 'relative', width: 'min(920px, 96vw)', zIndex: 1,
              background: 'var(--bg)', borderRadius: 18,
              border: '1px solid var(--line-strong)', boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.title}</div>
                <div className="ink-3" style={{ fontSize: 12 }}>{currentTrack.artist}</div>
              </div>
              <span style={{ flex: 1 }} />
              <a className="icon-btn" href={`https://music.youtube.com/watch?v=${currentTrack.videoId}`} target="_blank" rel="noreferrer" title="YouTube Music"><ExternalLink size={17} /></a>
              <button className="icon-btn" onClick={toggleVideoModal} aria-label="Fermer"><XIcon /></button>
            </div>
            <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#000' }}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${currentTrack.videoId}?autoplay=1&enablejsapi=1`}
                title={currentTrack.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

/* petite croix, pour ne pas réimporter tout le jeu d'icônes */
const XIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
