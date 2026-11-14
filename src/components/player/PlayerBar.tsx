import React, { useMemo, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, ChevronUp,
  ThumbsUp, ThumbsDown, ListMusic, Maximize2, ExternalLink,
} from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { useData } from '../../context/DataContext';
import { usePlayerSheet, useViewportHeight } from './PlayerGestures';
import { Art, useCover } from '../ui/Art';
import { usePalette, paletteToCss } from '../../lib/palette';
import type { Track } from '../../types';

/* ═══════════════════════════════════════════════════════════════
   Le lecteur, version mobile d'abord.

   Deux objets, un seul geste :

   · **la barre** — la bande du bas, toujours là pendant la lecture.
     Un doigt qui monte dessus fait apparaître le plein écran, collé à
     sa course : la feuille ne « s'ouvre » pas d'un coup, elle suit.

   · **la feuille** — le plein écran. Elle descend avec le doigt, où
     qu'on le pose (la pochette, le titre, la barre de progression hors
     du rail, le bas de l'écran). Un glissement latéral sur la pochette
     fait défiler les morceaux : la pochette part avec le doigt, la
     voisine entre par le bord, et l'ambiance passe de l'une à l'autre.

   La position de la feuille est *une seule* valeur, `y` : 0 ouvert,
   `vh` rangé. Rien d'autre ne la déplace — c'est ce qui évite les
   conflits entre une transition et une transformation manuelle.
   ═══════════════════════════════════════════════════════════════ */

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

export const PlayerBar: React.FC = () => {
  const {
    currentTrack, isPlaying, progress, duration, volume, isMuted,
    togglePlay, seekTo, setVolume, toggleMute, nextTrack, prevTrack, stepTrack, toggleVideoModal,
    queue,
  } = usePlayer();

  /* même registre que la liste du blend : un vote posé ici s'y voit, et
     réciproquement — plus de décalage entre les deux affichages */
  const { ratingOf, setRating } = useData();
  const ownRating = currentTrack ? ratingOf(currentTrack) ?? currentTrack.userRating ?? null : null;
  const vote = (r: 'liked' | 'disliked') => {
    if (!currentTrack) return;
    /* un second appui sur le même pouce retire l'avis — et « Tes goûts »
       doit le refléter, c'est setRating qui s'en charge. */
    setRating(currentTrack, ownRating === r ? null : r);
  };

  const vh = useViewportHeight();
  /* la position visée pendant qu'on glisse sur la barre (null = au repos) */
  const [scrub, setScrub] = useState<number | null>(null);
  /* où en est le doigt dans le glissement latéral, de -1 à 1 : c'est ce
     qui règle l'opacité de l'ambiance (l'ambiance change *pendant* le
     geste, et non d'un coup au changement de morceau) */
  const [coverMix, setCoverMix] = useState(0);

  /* les deux voisins, pour les faces latérales du carrousel */
  const peekTrack = (step: 1 | -1) => {
    if (!queue.length || !currentTrack) return null;
    const i = queue.findIndex((t) => t.id === currentTrack.id);
    if (i < 0) return null;
    return queue[(i + step + queue.length) % queue.length] ?? null;
  };

  /* l'ambiance du morceau voisin : on la lit maintenant, pour que la
     couleur soit prête quand le doigt arrive au bout du geste */
  const prevT = currentTrack ? peekTrack(-1) : null;
  const nextT = currentTrack ? peekTrack(1) : null;
  const curCover = useCover(currentTrack ?? { videoId: '', title: '', artist: '' });
  const prevCover = useCover(prevT ?? { videoId: '', title: '', artist: '' });
  const nextCover = useCover(nextT ?? { videoId: '', title: '', artist: '' });
  /* les trois palettes : la couleur du fond vient d'elles, pas de l'image
     floutée (qui n'est là que pour la texture). C'est ce qui permet à la
     teinte de passer de l'une à l'autre pendant le geste. */
  const curPal = usePalette(curCover.small);
  const prevPal = usePalette(prevCover.small);
  const nextPal = usePalette(nextCover.small);

  const sheet = usePlayerSheet({
    height: () => vh,
    /* la course d'une pochette : de son centre au centre de la scène,
       c'est-à-dire exactement la distance qui la fait sortir du cadre */
    coverWidth: () => {
      const el = document.querySelector('.nowplaying-art--main');
      const w = el ? el.getBoundingClientRect().width : Math.min(window.innerWidth, vh) * 0.9;
      return window.innerWidth / 2 + w / 2 + 4;
    },
    onNext: () => stepTrack(1),
    onPrev: () => stepTrack(-1),
    onCoverProgress: setCoverMix,
  });

  const pct = useMemo(() => (duration ? Math.min(100, (progress / duration) * 100) : 0), [progress, duration]);

  if (!currentTrack) return null;

  const coverSize = 'var(--art, min(46vh, 380px))';

  return (
    <>
      <AnimatePresence>
        <motion.div
          key="ytm-bar"
          className="ytm-nowbar"
          initial={{ y: 70, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 70, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 32 }}
          {...sheet.barHandlers}
        >
          {/* progression : fine au repos, épaisse et manipulable au survol */}
          <ProgressRail
            value={progress}
            max={duration || 100}
            onSeek={seekTo}
            className="nowbar-progress"
          />

          <button
            onClick={() => sheet.open()}
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
              <button className="icon-btn" onClick={() => sheet.open()} aria-label="File d’attente">
                <ListMusic size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* ═══ le plein écran ═══
          Il existe dans le DOM tant que `sheet.mounted` est vrai ; sa
          position verticale est `sheet.y`, et rien d'autre. Quand le
          doigt commande, pas de transition ; au relâchement, une
          transition finit la course et `onSettled` décide de la suite. */}
      <AnimatePresence>
        {sheet.mounted && (
          <div
            className="nowplaying"
            data-drag={sheet.dragging ? '1' : '0'}
            data-anim={sheet.settling && !sheet.dragging ? '1' : '0'}
            style={{ transform: `translate3d(0, ${sheet.y}px, 0)` }}
            onTransitionEnd={(e) => { if (e.propertyName === 'transform') sheet.onSettled(); }}
          >
            <div className="nowplaying-ambience" aria-hidden>
              {/* trois couches : la teinte du morceau courant, puis celles
                  des voisins. Elles ne s'allument qu'avec le doigt — la
                  couleur passe donc de l'une à l'autre *pendant* le
                  glissement, et la nouvelle est déjà en place quand le
                  morceau change. */}
              <span className="nowplaying-ambience__layer nowplaying-ambience__layer--base"
                style={{
                  ...paletteToCss(curPal),
                  backgroundImage: curCover.small ? `url("${curCover.small}")` : undefined,
                }} />
              <span className="nowplaying-ambience__layer"
                style={{
                  ...paletteToCss(prevPal),
                  backgroundImage: prevCover.small ? `url("${prevCover.small}")` : undefined,
                  opacity: Math.max(0, -coverMix) * 0.9,
                }} />
              <span className="nowplaying-ambience__layer"
                style={{
                  ...paletteToCss(nextPal),
                  backgroundImage: nextCover.small ? `url("${nextCover.small}")` : undefined,
                  opacity: Math.max(0, coverMix) * 0.9,
                }} />
            </div>

            <div className="nowplaying-sheet" {...sheet.sheetHandlers}>
              <div className="nowplaying-top">
                <button className="icon-btn" onClick={() => sheet.close()} aria-label="Réduire">
                  <ChevronUp size={20} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <span className="nowplaying-eyebrow">En lecture</span>
                <span className="nowplaying-spacer" aria-hidden />
              </div>

              <div className="nowplaying-body">
                {/* le carrousel : trois faces sur une piste. On translate la
                    piste entière — les voisines entrent et sortent avec le
                    doigt, sans le moindre fondu. */}
                {/* le carrousel : trois faces, une piste, un décalage.
                    Rien ne change de taille ici — seule la piste coulisse. */}
                <div className="nowplaying-stage">
                  <div
                    className="nowplaying-track"
                    data-dragging={sheet.dragging ? '1' : '0'}
                    style={{ '--dx': `${sheet.dx}px` } as React.CSSProperties}
                  >
                    <div className="nowplaying-art nowplaying-art--left" aria-hidden>
                      <Art track={prevT || currentTrack} size="100%" radius={16} large />
                    </div>
                    <div key={currentTrack.id} className="nowplaying-art nowplaying-art--main">
                      <Art track={currentTrack} size="100%" radius={16} large />
                    </div>
                    <div className="nowplaying-art nowplaying-art--right" aria-hidden>
                      <Art track={nextT || currentTrack} size="100%" radius={16} large />
                    </div>
                  </div>
                </div>

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
                    onPreview={setScrub}
                    className="big-rail"
                    label="Progression"
                  />
                  <div className="nowplaying-times">
                    {/* pendant le geste, l'heure suit le doigt — pas la lecture */}
                    <span>{fmt(scrub ?? progress)}</span>
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

              {/* choisir un morceau change le lecteur, il ne le referme pas */}
              <QueueStrip />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* la pochette courante, pour que le navigateur la garde en cache
          pendant que le doigt arrive sur la voisine */}
      <span className="sr-only" aria-hidden style={{ display: 'none' }}>{coverSize}</span>
    </>
  );
};

/* ─────────────── file d'attente du plein écran ─────────────── */

const QueueStrip: React.FC = () => {
  const { queue, currentTrack, playTrack } = usePlayer();
  const ref = useRef<HTMLDivElement>(null);

  /* le morceau en cours reste visible dans la file */
  useEffect(() => {
    const el = ref.current?.querySelector('[data-now="1"]') as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [currentTrack?.id]);

  if (!queue.length) return null;
  return (
    <div className="nowplaying-queue" ref={ref}>
      {queue.map((t: Track) => (
        <button
          key={t.id}
          className="queue-item"
          data-now={t.id === currentTrack?.id ? '1' : '0'}
          onClick={() => playTrack(t, queue)}
          title={`${t.title} — ${t.artist}`}
        >
          <Art track={t} size={84} radius={10} />
          <span className="queue-title">{t.title}</span>
        </button>
      ))}
    </div>
  );
};

/* ─────────────── la barre de progression ───────────────

   Une seule règle : **pendant le doigt, on ne déplace que l'aperçu**.
   La nappe, le curseur et l'heure suivent le pixel. Le vrai `seekTo`
   part au relâchement. Avant, chaque pixel du geste demandait un saut
   au lecteur YouTube : des dizaines de sauts par seconde, une position
   qui repartait en arrière, et l'écran qui clignotait.
   ─────────────────────────────────────────────────────────── */

const ProgressRail: React.FC<{
  value: number;
  max: number;
  onSeek: (v: number) => void;
  className?: string;
  label?: string;
  onPreview?: (v: number | null) => void;
}> = ({ value, max, onSeek, className = '', label = 'Progression', onPreview }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const latest = useRef(0);

  const shown = preview ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  const ratioFrom = (clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
  };

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag(true);
    const v = ratioFrom(e.clientX) * max;
    latest.current = v;
    setPreview(v);
    onPreview?.(v);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const v = ratioFrom(e.clientX) * max;
    latest.current = v;
    setPreview(v);
    onPreview?.(v);
  };

  const end = () => {
    if (drag) onSeek(latest.current);
    setDrag(false);
    setPreview(null);
    onPreview?.(null);
  };

  return (
    <div
      ref={ref}
      className={`prail ${className} ${drag ? 'is-dragging' : ''} ${hover ? 'is-hovering' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      tabIndex={0}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); if (drag) end(); }}
      onKeyDown={(e) => {
        const step = max > 60 ? 5 : 1;
        if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(max, value + step)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, value - step)); }
      }}
    >
      {className.includes('big-rail') ? (
        <WaveRail value={shown} max={max} hovering={hover} dragging={drag} />
      ) : (
        <>
          <span className="prail-track" />
          <span className="prail-fill" style={{ width: `${pct}%` }} />
        </>
      )}
      {/* la pastille ne disparaît jamais sur la grande barre : elle est le
          point de repère du doigt, même quand on arrive dessus par surprise */}
      {(hover || drag || className.includes('big-rail')) && (
        <span className="prail-knob" style={{ left: `${pct}%` }} />
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   La nappe de la grande barre — les aurores.

   Trois bosses de couleur posées juste avant le curseur, lues dans la
   palette de la pochette. Elles respirent pendant la lecture et suivent
   le doigt quand on glisse.

   Trois choses, et trois seulement, causaeint le glitch d'avant :

   · l'effet était reconstruit à chaque survol ou changement de
     lecture ; le canevas était redimensionné, donc vidé, et une image
     noire passait. Il est maintenant créé **une fois** ;
   · la boucle était figée sur l'état du moment : on lit désormais
     tout dans des refs (position, survol, lecture) ;
   · la boucle ne tournait qu'en lecture, et un événement « redessine »
     que personne n'écoutait était censé la relancer. Elle tourne
     toujours : c'est elle qui fait suivre le doigt.
   ═══════════════════════════════════════════════════════════════ */

const WaveRail: React.FC<{ value: number; max: number; hovering: boolean; dragging: boolean }> = ({
  value, max, hovering, dragging,
}) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const { isPlaying, currentTrack } = usePlayer();

  /* tout ce qui change souvent, en ref : la boucle n'est jamais recréée */
  const live = useRef({ pct: 0, hover: false, playing: false, t: 0 });
  live.current.pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  live.current.hover = hovering || dragging;
  live.current.playing = isPlaying;

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
    let t = seed;
    let phase = (seed % 97) / 15;

    /* la palette est lue une fois, puis à chaque changement de morceau */
    let col = { h: 352, s: '62%', l: '48%', ink: '#ffffff' };
    const readPalette = () => {
      const st = getComputedStyle(document.documentElement);
      col = {
        h: Number(st.getPropertyValue('--p-h')) || 352,
        s: (st.getPropertyValue('--p-s') || '62%').trim(),
        l: (st.getPropertyValue('--p-l') || '48%').trim(),
        ink: (st.getPropertyValue('--ink') || '#ffffff').trim(),
      };
    };
    readPalette();
    const onPalette = () => readPalette();
    window.addEventListener('sb:palette', onPalette);

    /* les aurores vivent juste avant le curseur : une crête large, deux
       plus fines, comme une nappe qui vient mourir sur la position */
    const auroras = [
      { c: 0.46, w: 0.115, a: 0.55 },
      { c: 0.70, w: 0.085, a: 1.0 },
      { c: 0.88, w: 0.060, a: 0.66 },
    ];

    const crest = (x: number, split: number, i: number, maxAmp: number) => {
      const a = auroras[i];
      const d = (x - a.c * split) / Math.max(8, a.w * w);
      const bell = Math.exp(-d * d * 2.1);
      const breathe = 0.88 + Math.sin(t * 0.02 + i * 1.9 + phase) * 0.12;
      return bell * a.a * breathe * maxAmp;
    };

    const draw = () => {
      if (w < 8) return;
      ctx.clearRect(0, 0, w, h);
      const mid = h - 4;
      const split = Math.max(0, Math.min(w, live.current.pct * w));
      const room = Math.max(2, h * 0.52 - 2);
      const maxAmp = room * 0.92 * (live.current.hover ? 1.1 : 1);
      /* en pause, l'aurore respire à peine : elle reste vivante sans danser */
      const amp = live.current.playing ? 1 : 0.55;

      /* 1. la piste, fine, sur toute la largeur */
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();

      /* 2. la partie écoutée, plus franche */
      if (split > 1) {
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(split, mid); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* 3. les aurores, uniquement sur la partie écoutée */
      if (split > 24) {
        auroras.forEach((a, i) => {
          const hue = (col.h + (i === 0 ? -18 : i === 1 ? 12 : 40)) % 360;
          const light = Math.max(42, Math.min(66, parseInt(col.l) + (i === 1 ? 8 : 2)));
          const grad = ctx.createLinearGradient(0, mid - maxAmp * a.a, 0, mid);
          grad.addColorStop(0, `hsl(${hue} ${col.s} ${Math.min(72, light + 16)}% / 0.95)`);
          grad.addColorStop(0.55, `hsl(${hue} ${col.s} ${light}% / 0.98)`);
          grad.addColorStop(1, `hsl(${(hue + 16) % 360} ${col.s} ${Math.max(30, light - 14)}% / 0.9)`);

          ctx.beginPath();
          for (let x = 0; x <= split; x += 1) {
            const edge = Math.min(1, (x / split) * 5, (split - x) / 26);
            const y = Math.min(crest(x, split, i, maxAmp * amp) * Math.max(0, edge), mid - 1);
            if (x === 0) ctx.moveTo(x, mid - y); else ctx.lineTo(x, mid - y);
          }
          for (let x = split; x >= 0; x -= 1) {
            const edge = Math.min(1, (x / split) * 5, (split - x) / 26);
            const y = Math.min(crest(x, split, i, maxAmp * amp) * Math.max(0, edge), mid - 1);
            ctx.lineTo(x, Math.min(h - 1, mid + y * 0.08));
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
          const edge = Math.min(1, (x / split) * 5, (split - x) / 26);
          const y = Math.min(crest(x, split, 1, maxAmp * amp) * Math.max(0, edge), mid - 1);
          if (x === 0) ctx.moveTo(x, mid - y); else ctx.lineTo(x, mid - y);
        }
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    const loop = () => {
      live.current.t += 0.012;
      t += 0.012;
      draw();
      raf = requestAnimationFrame(loop);
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width));
      const nh = Math.max(1, Math.round(r.height));
      /* on ne touche au tampon *que* s'il change de taille : le redimensionner
         le vide, et c'est ce qui produisait l'image noire au survol */
      if (nw === Math.round(w) && nh === Math.round(h)) return;
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(canvas);
    resize();
    draw();
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('sb:palette', onPalette);
    };
    /* une seule fois : la boucle lit tout dans `live` */
  }, [seed]);

  return <canvas ref={ref} className="prail-wave prail-wave--big" aria-hidden />;
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
