import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Track } from '../types';
import { sameTrack } from '../lib/track';
import { applyRatingToTaste, recordTrackRating } from '../services/storage';

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isVideoOpen: boolean;
  queue: Track[];
  currentIndex: number;
  playTrack: (track: Track, newQueue?: Track[]) => void;
  togglePlay: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  /** le morceau voisin, dans la file en cours (glissement sur la pochette) */
  stepTrack: (step: 1 | -1) => void;
  toggleVideoModal: () => void;
  rateTrack: (track: Track, rating?: 'liked' | 'disliked') => void;
  clearRating: (track: Track) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(210);
  const [volume, setVolumeState] = useState<number>(80);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOpen, setIsVideoOpen] = useState<boolean>(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  const playerRef = useRef<any>(null);
  const playerReady = useRef<boolean>(false);
  const pendingVideo = useRef<string | null>(null);
  const intervalRef = useRef<any>(null);
  const progressRef = useRef<number>(0);
  const durationRef = useRef<number>(210);

  /* crée l'iframe YouTube (invisible) et la branche sur nos callbacks.
     Elle n'est créée qu'au premier morceau : rien n'est chargé avant. */
  const ensurePlayer = (videoId: string) => {
    if (playerRef.current?.loadVideoById) {
      playerRef.current.loadVideoById(videoId);
      playerRef.current.playVideo?.();
      return;
    }
    pendingVideo.current = videoId;
    if (!window.YT || !window.YT.Player) {
      // le script YouTube n'est pas encore arrivé : on réessaie dans un instant
      let tries = 0;
      const t = setInterval(() => {
        tries += 1;
        if (window.YT?.Player) {
          clearInterval(t);
          ensurePlayer(pendingVideo.current!);
        } else if (tries > 40) {
          clearInterval(t);
        }
      }, 200);
      return;
    }

    let host = document.getElementById('youtube-player-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'youtube-player-host';
      host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, {
        position: 'fixed', left: '-10000px', top: '0',
        width: '2px', height: '2px', overflow: 'hidden',
        opacity: '0', pointerEvents: 'none',
      });
      const mount = document.createElement('div');
      mount.id = 'youtube-player-mount';
      host.appendChild(mount);
      document.body.appendChild(host);
    }

    try {
      playerRef.current = new window.YT.Player('youtube-player-mount', {
        height: '200',
        width: '200',
        videoId,
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1,
        },
        events: {
          onReady: (e: any) => {
            playerReady.current = true;
            const v = pendingVideo.current;
            if (v) { e.target.loadVideoById(v); e.target.playVideo?.(); }
            try { e.target.setVolume(volume); } catch { /* ignore */ }
          },
          onStateChange: (event: any) => {
            if (event.data === 1) {
              setIsPlaying(true);
              const d = playerRef.current?.getDuration?.() || 0;
              if (d > 0) setDuration(d);
            } else if (event.data === 2) {
              setIsPlaying(false);
            } else if (event.data === 0) {
              advance.current();
            }
          },
          onError: () => {
            if (queueRef.current.length > 1) setTimeout(() => advance.current(), 600);
          },
        },
      });
    } catch (e) {
      console.warn('YouTube player init failed:', e);
    }
  };

  /* le callback de fin de vidéo est créé une seule fois : il lui faut
     toujours la file et l'index à jour, donc on passe par des refs */
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef<number>(-1);
  const playingRef = useRef<boolean>(false);
  queueRef.current = queue;
  indexRef.current = currentIndex;
  playingRef.current = isPlaying;

  /* enchaînement : morceau suivant, bouclage en fin de file */
  const advance = useRef<() => void>(() => {});
  advance.current = () => {
    const q = queueRef.current;
    if (q.length === 0) return;
    const next = q[(indexRef.current + 1) % q.length];
    if (!next) return;
    const nextIdx = q.findIndex((t) => t.id === next.id);
    indexRef.current = nextIdx;
    setCurrentIndex(nextIdx);
    setCurrentTrack(next);
    setProgress(0);
    setIsPlaying(true);
    if (next.videoId) ensurePlayer(next.videoId);
  };

  // attend que l'API YouTube soit disponible, sans créer de lecteur à vide
  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  /* ═══ suivi de la lecture : 60 images par seconde ═══
     Avant, un minuteur de 500 ms faisait avancer le curseur par bonds.
     Maintenant on lit la position réelle du lecteur à chaque image et on
     l'interpole entre deux mesures : le curseur glisse, sans à-coups.
     Quand le lecteur YouTube n'est pas encore prêt, on extrapole à partir
     de l'horloge, ce qui donne le même résultat lisse. */
  const lastSample = useRef<{ t: number; pos: number }>({ t: 0, pos: 0 });

  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) cancelAnimationFrame(intervalRef.current);
      intervalRef.current = null;
      return;
    }

    const start = performance.now();
    const startPos = progressRef.current;
    lastSample.current = { t: start, pos: startPos };

    const tick = (now: number) => {
      const player = playerRef.current;
      let pos: number;

      if (player?.getCurrentTime) {
        const raw = player.getCurrentTime() || 0;
        /* si la valeur n'a pas bougé (YouTube lisse par pas de 250 ms),
           on extrapole entre deux mesures pour ne pas saccader */
        if (raw !== lastSample.current.pos) {
          lastSample.current = { t: now, pos: raw };
          pos = raw;
        } else {
          pos = lastSample.current.pos + (now - lastSample.current.t) / 1000;
        }
      } else {
        pos = startPos + (now - start) / 1000;
      }

      const total = durationRef.current || 210;
      if (pos >= total) pos = total;
      progressRef.current = pos;
      setProgress(pos);
      intervalRef.current = requestAnimationFrame(tick);
    };

    intervalRef.current = requestAnimationFrame(tick);
    return () => {
      if (intervalRef.current) cancelAnimationFrame(intervalRef.current);
      intervalRef.current = null;
    };
  }, [isPlaying]);

  /* la position courante, sans provoquer de rendu */
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  const playTrack = (track: Track, newQueue?: Track[]) => {
    let activeQueue = queue;
    if (newQueue) {
      setQueue(newQueue);
      queueRef.current = newQueue;
      activeQueue = newQueue;
    }
    const idx = activeQueue.findIndex((t) => t.id === track.id);
    indexRef.current = idx >= 0 ? idx : 0;
    setCurrentIndex(idx >= 0 ? idx : 0);
    setCurrentTrack(track);
    setProgress(0);

    setIsPlaying(true);
    if (!track.videoId) return; // fiche sans vidéo : rien à charger
    ensurePlayer(track.videoId);
  };

  const togglePlay = () => {
    if (!currentTrack) return;

    if (isPlaying) {
      playerRef.current?.pauseVideo?.();
      setIsPlaying(false);
    } else {
      playerRef.current?.playVideo?.();
      setIsPlaying(true);
    }
  };

  const seekTo = (seconds: number) => {
    setProgress(seconds);
    playerRef.current?.seekTo?.(seconds, true);
  };

  const setVolume = (vol: number) => {
    setVolumeState(vol);
    playerRef.current?.setVolume?.(vol);
    if (isMuted && vol > 0) {
      setIsMuted(false);
      playerRef.current?.unMute?.();
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      playerRef.current?.unMute?.();
    } else {
      setIsMuted(true);
      playerRef.current?.mute?.();
    }
  };

  const nextTrack = () => advance.current();

  const prevTrack = () => {
    if (queue.length === 0) return;
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    playTrack(queue[prevIdx], queue);
  };

  /* le morceau voisin, pour le glissement sur la pochette : on ne
     s'appuie pas sur l'index du rendu (il peut être en retard d'un cran
     juste après un changement), mais sur le morceau réellement affiché */
  const trackAt = (step: 1 | -1): Track | null => {
    const q = queueRef.current.length ? queueRef.current : queue;
    if (!q.length) return null;
    const here = currentTrack ? q.findIndex((t) => t.id === currentTrack.id) : -1;
    const from = here >= 0 ? here : indexRef.current;
    return q[(from + step + q.length) % q.length] ?? null;
  };

  const stepTrack = (step: 1 | -1) => {
    const t = trackAt(step);
    if (!t) return;
    playTrack(t);
  };

  const toggleVideoModal = () => {
    setIsVideoOpen(!isVideoOpen);
  };

  const clearRating = (track: Track) => {
    setQueue((prevQueue) => prevQueue.map((t) => (sameTrack(t, track) ? { ...t, userRating: null } : t)));
    if (sameTrack(currentTrack, track)) setCurrentTrack({ ...currentTrack!, userRating: null });
    /* et la mémoire des goûts oublie le morceau, sinon il reste dans
       « Tes goûts » alors que le pouce est retiré */
    applyRatingToTaste(track, null);
  };

  const rateTrack = (track: Track, rating?: 'liked' | 'disliked') => {
    /* sans note, ou sur le pouce déjà actif : on retire l'avis */
    if (!rating || track.userRating === rating) { clearRating(track); return; }

    // Record to storage
    recordTrackRating(track, rating);

    // Update track in current queue (par identité de morceau, pas d'id)
    setQueue((prevQueue) =>
      prevQueue.map((t) =>
        sameTrack(t, track) ? { ...t, userRating: rating } : t
      )
    );

    if (sameTrack(currentTrack, track)) {
      setCurrentTrack({ ...currentTrack!, userRating: rating });

      // If disliked while currently playing, skip to next song smoothly!
      if (rating === 'disliked') {
        setTimeout(() => {
          nextTrack();
        }, 300);
      }
    }
  };

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        progress,
        duration,
        volume,
        isMuted,
        isVideoOpen,
        queue,
        currentIndex,
        playTrack,
        togglePlay,
        seekTo,
        setVolume,
        toggleMute,
        nextTrack,
        prevTrack,
        stepTrack,
        toggleVideoModal,
        rateTrack,
        clearRating,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
};
