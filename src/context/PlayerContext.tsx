import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Track } from '../types';
import { sameTrack } from '../lib/track';
import { applyRatingToTaste, recordTrackRating } from '../services/storage';
import { youtubeService } from '../services/youtube';

interface PlayerContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  /** l'image : `audio` montre la pochette, `clip` montre la vidéo */
  mode: 'audio' | 'clip';
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
  /** basculer pochette ↔ clip (le bouton du haut du grand lecteur) */
  toggleMode: () => void;
  /** où en est le clip du morceau courant */
  clip: ClipEtat;
  /** le lecteur vidéo vient de se déplacer dans le grand lecteur */
  attachVideo: (el: HTMLDivElement | null) => void;
  rateTrack: (track: Track, rating?: 'liked' | 'disliked') => void;
  clearRating: (track: Track) => void;
  /** reprendre la lecture d'un geste de la personne (toujours accepté) */
  reprendre: () => void;
  /** vrai quand le navigateur a refusé la reprise en arrière-plan */
  repriseRefusee: boolean;
  /** le dernier morceau sauté faute de lecteur — dit à l'écran, jamais en silence */
  morceauxSautes: number;
  /** le morceau qu'on n'a pas pu réparer (identifiant mort, introuvable) */
  dernierSaute: Track | null;
  oublierSautes: () => void;
}

/* ─────────── l'état du clip courant ───────────
   `aucun` n'est pas une erreur : c'est « pas de clip connu pour ce
   morceau ». On garde alors la pochette, et le bouton le dit sans mentir.
   `inconnu` : on n'a pas encore eu l'occasion de demander. */
export type ClipEtat = 'inconnu' | 'cherche' | 'pret' | 'aucun';

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [duration, setDuration] = useState<number>(210);
  const [volume, setVolumeState] = useState<number>(80);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  /* ─────────── le mode image ───────────
     Une seule règle : la musique ne s'interrompt jamais. Le lecteur
     YouTube est déplacé dans le grand lecteur, pas recréé ; sa position
     n'est pas touchée, sauf si la vidéo du clip n'est pas la même que
     celle qu'on écoute — et dans ce cas seulement, on recale sur la
     seconde près (voir `attachVideo`). */
  const [mode, setMode] = useState<'audio' | 'clip'>('audio');
  const [clipId, setClipId] = useState<string | null>(null);
  const [clipEtat, setClipEtat] = useState<ClipEtat>('inconnu');
  const clipSlot = useRef<HTMLDivElement | null>(null);
  const clipTaille = useRef({ w: 0, h: 0 });
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  /* ── les morceaux qui ne se lisent pas ──
     Constat de l'auditeur : la file passait des morceaux sans lecteur,
     un par un, sans un mot. Un identifiant mort n'est pas une fatalité :
     on redemande le morceau à YouTube. S'il est introuvable, on le dit,
     et on passe au suivant. */
  const [morceauxSautes, setMorceauxSautes] = useState<number>(0);
  const [dernierSaute, setDernierSaute] = useState<Track | null>(null);
  const oublierSautes = () => { setMorceauxSautes(0); setDernierSaute(null); };
  /* les morceaux déjà réparés pendant cette session : id mort → id neuf */
  const repares = useRef<Map<string, string>>(new Map());
  /* les morceaux qu'on a renoncé à réparer : on ne les retente pas */
  const abandonnes = useRef<Set<string>>(new Set());

  const playerRef = useRef<any>(null);
  /* l'intention de lecture : « je veux que ça joue », décidée par la
     personne, jamais par un événement du lecteur (voir plus bas) */
  const wantedPlay = useRef(false);
  const markWanted = (v: boolean) => { wantedPlay.current = v; };
  const playerReady = useRef<boolean>(false);
  const pendingVideo = useRef<string | null>(null);
  const intervalRef = useRef<any>(null);
  const progressRef = useRef<number>(0);
  const durationRef = useRef<number>(210);

  /* crée l'iframe YouTube (invisible) et la branche sur nos callbacks.
     Elle n'est créée qu'au premier morceau : rien n'est chargé avant. */
  /* le lecteur caché, celui qui vit hors de l'écran quand on est en
     pochette */
  const ombre = () => {
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
    return host;
  };

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

    ombre();

    try {
      playerRef.current = new window.YT.Player('youtube-player-mount', {
        height: '200',
        width: '200',
        videoId,
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0,
          /* `playsinline` garde la lecture DANS la page au lieu de forcer
             le plein écran vidéo d'iOS ; sans lui, la sortie de l'app
             interrompait la piste. */
          playsinline: 1,
        },
        events: {
          onReady: (e: any) => {
            playerReady.current = true;
            const v = pendingVideo.current;
            if (v) { e.target.loadVideoById(v); e.target.playVideo?.(); }
            try { e.target.setVolume(volume); } catch { /* ignore */ }
          },
          onStateChange: (event: any) => {
            /* 5 = vidéo en file d'attente, 3 = mise en tampon : ce ne sont
               pas des pauses, on ne touche pas à l'état affiché */
            if (event.data === 1) {
              setIsPlaying(true);
              /* la musique est là : ni message, ni échéance en attente */
              window.clearTimeout(pauseTimer.current ?? undefined);
              setRepriseRefusee(false);
              const d = playerRef.current?.getDuration?.() || 0;
              if (d > 0) setDuration(d);
            } else if (event.data === 2) {
              /* une pause vient du lecteur. Si l'onglet est caché, c'est le
                 navigateur qui a suspendu la page — pas la personne : on
                 garde l'intention, et la reprise se fera au retour. */
              setIsPlaying(false);
              /* Une pause que personne n'a demandé : l'intention d'écouter
                 est toujours là et la page est à l'écran.

                 ── pourquoi on attend avant de le dire ──
                 Au démarrage d'un morceau, YouTube passe par « non
                 démarré » (5) puis parfois par une micro-pause le temps de
                 mettre en tampon. On annonçait donc « la lecture s'est
                 arrêtée » à chaque changement de piste, alors que tout
                 allait bien — le bandeau apparaissait, puis disparaissait
                 aussitôt que la musique repartait : ce clignotement.

                 Désormais chaque passage en pause pose une échéance, et
                 c'est la **dernière** qui décide. Toute reprise l'annule.
                 Il faut donc que le silence dure pour que le message
                 s'affiche — et un morceau qui démarre ne le déclenche
                 jamais (on ne signale pas une pause sur une piste à 0:00,
                 le lecteur n'a pas encore eu sa chance). */
              if (wantedPlay.current && document.visibilityState === 'visible') {
                /* la position au moment de la pause : si elle était déjà
                   installée (plus d'une seconde), c'est un morceau qui
                   tournait — donc un vrai arrêt. Si elle était à zéro,
                   c'est un démarrage : le lecteur n'a pas encore eu sa
                   chance, et on ne dit rien. */
                const dejaAvance = currentTime.current > 1;
                window.clearTimeout(pauseTimer.current ?? undefined);
                pauseTimer.current = window.setTimeout(() => {
                  try {
                    const st = playerRef.current?.getPlayerState?.();
                    const t1 = currentTime.current;
                    if (wantedPlay.current && st !== 1 && st !== 3 && (dejaAvance || t1 > 1)) {
                      setRepriseRefusee(true);
                    }
                  } catch { /* lecteur absent : rien à dire */ }
                }, 2600);
              }
            } else if (event.data === 0) {
              advance.current();
            }
          },
          onError: () => {
            /* 2, 5, 100, 101, 150 : identifiant invalide, lecteur HTML5,
               vidéo retirée, non intégrable, ou bloquée par l'ayant
               droit. Aucune de ces erreurs ne guérit en insistant, et
               toutes donnaient le même silence. On tente la réparation
               une fois, puis on saute en le disant. */
            const t = currentRef.current;
            if (t) setTimeout(() => sauter(t), 400);
            else if (queueRef.current.length > 1) setTimeout(() => advance.current(), 600);
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
  const currentRef = useRef<Track | null>(null);
  queueRef.current = queue;
  indexRef.current = currentIndex;
  playingRef.current = isPlaying;
  currentRef.current = currentTrack;

  /* ─────────── lire un morceau, ou le réparer ───────────
     Avant, on chargeait `track.videoId` sans se demander s'il vivait
     encore. Une vidéo retirée ou bloquée faisait donc défiler la file en
     silence (l'appelant `onError` de YouTube sautait au suivant, et
     ainsi de suite). Maintenant : on demande au morceau s'il se lit ; si
     non, on le redemande à YouTube par son titre et son artiste ; si
     vraiment rien ne se lit, on le déclare sauté — à l'écran, pas dans
     la console — et on passe au suivant. */
  const jouer = (track: Track, essais = 0) => {
    if (!track.videoId) { sauter(track); return; }
    ensurePlayer(track.videoId);
  };

  /* le morceau ne peut pas être lu : on le répare, sinon on le saute */
  const reparer = async (track: Track): Promise<boolean> => {
    const deja = repares.current.get(track.videoId);
    if (deja) { ensurePlayer(deja); return true; }
    if (abandonnes.current.has(track.videoId)) return false;
    try {
      const neuf = await youtubeService.reparerVideoId(track.title, track.artist);
      if (neuf && neuf !== track.videoId) {
        repares.current.set(track.videoId, neuf);
        /* la file et le morceau affiché prennent l'identifiant réparé :
           la prochaine lecture n'aura plus à le redemander */
        setQueue((prev) => prev.map((t) => (t.id === track.id ? { ...t, videoId: neuf, verifie: true } : t)));
        setCurrentTrack((cur) => (cur && cur.id === track.id ? { ...cur, videoId: neuf, verifie: true } : cur));
        ensurePlayer(neuf);
        return true;
      }
    } catch { /* réseau muet : on saute, sans insister */ }
    abandonnes.current.add(track.videoId);
    return false;
  };

  const sauter = (track: Track, apresReparation = false) => {
    if (!apresReparation) {
      /* on tente d'abord la réparation, une fois par morceau */
      void reparer(track).then((ok) => {
        if (!ok) sauter(track, true);
      });
      return;
    }
    setMorceauxSautes((n) => n + 1);
    setDernierSaute(track);
    /* le suivant : on ne tourne pas en boucle sur la même file */
    const q = queueRef.current;
    if (q.length > 1 && track.id) advance.current();
  };

  /* enchaînement : morceau suivant, bouclage en fin de file.
     Déclaré APRÈS `sauter` (qui l'appelle) ; on passe par une ref pour
     que le callback du lecteur, créé une fois, voie toujours la version
     à jour. */
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
    markWanted(true);
    setIsPlaying(true);
    jouer(next);
  };

  // attend que l'API YouTube soit disponible, sans créer de lecteur à vide
  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  /* ═══ la musique continue quand on quitte l'app ═══
     Deux choses pouvaient couper le son en sortant : le navigateur met
     l'onglet en veille, et le lecteur YouTube s'arrête de lui-même — ou
     se met en pause quand il perd le focus sur iOS. On ne veut pas de
     ça : une piste lancée doit continuer.

     On ne *force* rien non plus : si la personne a appuyé sur pause, la
     piste reste en pause (on mémorise son intention, `wantedPlay`). Au
     retour au premier plan, si elle voulait écouter, on relance — après
     un court délai, parce qu'iOS refuse la reprise dans la même image
     que le retour de l'onglet. */
  /* L'intention, pas l'état affiché.
     `isPlaying` suit le lecteur : quand le navigateur met l'onglet en
     veille, YouTube se met en pause et `onStateChange` nous prévient —
     `isPlaying` passe donc à false **dans l'onglet qu'on vient de
     quitter**. Au retour, `wantedPlay` était devenu faux, et la reprise
     ne faisait rien. C'était la cause du « la musique s'arrête quand je
     réduis l'app ».

     L'intention est maintenant explicite : elle ne change que sur une
     action de la personne (lecture, pause) ou en fin de file — jamais
     sur un événement du lecteur. */
  const lastResume = useRef(0);
  /* le navigateur a mis en pause et a refusé la reprise : on ne se bat
     pas, on le dit. Ce drapeau s'allume quand une reprise échoue et
     s'éteint dès que la lecture repart. */
  const [repriseRefusee, setRepriseRefusee] = useState(false);
  const verifierRefus = useRef<number | null>(null);
  /* l'échéance du « la lecture s'est arrêtée » : elle se repousse à chaque
     pause, et seule la dernière aboutit (voir onStateChange) */
  const pauseTimer = useRef<number | null>(null);
  /* la position réelle du lecteur, lue sans provoquer de rendu : elle dit
     si la piste a seulement commencé à avancer */
  const currentTime = useRef(0);

  /* « Reprendre » : c'est le geste que la personne fait elle-même quand
     elle revient dans l'app et que le navigateur a refusé la reprise.
     Une reprise déclenchée par un appui est toujours acceptée, là où une
     reprise déclenchée par l'onglet ne l'est jamais sur iOS. */
  const reprendre = React.useCallback(() => {
    const p = playerRef.current;
    markWanted(true);
    setRepriseRefusee(false);
    setIsPlaying(true);
    try { p?.playVideo?.(); } catch { /* lecteur absent */ }
  }, []);

  useEffect(() => {
    const resume = () => {
      if (!wantedPlay.current) return;
      const p = playerRef.current;
      if (!p) return;
      try {
        const state = p.getPlayerState?.();
        /* 1 = en lecture, 3 = en tampon : la musique tourne déjà */
        if (state === 1 || state === 3) return;
        p.playVideo?.();
      } catch { /* lecteur pas encore prêt : rien à faire */ }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      /* Un seul essai, franc. Insister pendant six secondes ne servait à
         rien et donnait exactement ce qu'on ne veut pas : une bagarre
         entre l'app et le navigateur, « lecture » contre « pause ». Si le
         navigateur refuse la reprise, il n'y a pas de round d'après :
         on le dit à la personne (voir le bandeau plus bas). */
      lastResume.current = Date.now();
      resume();
      /* et on regarde, une seconde plus tard, si la reprise a été
         acceptée. Si le lecteur est toujours en pause alors qu'on veut
         écouter, c'est que le navigateur a refusé : on le dira, au lieu
         de relancer en boucle. */
      window.clearTimeout(verifierRefus.current ?? undefined);
      verifierRefus.current = window.setTimeout(() => {
        if (!wantedPlay.current) return;
        const p2 = playerRef.current;
        try {
          const st = p2?.getPlayerState?.();
          if (st === 1 || st === 3) { setRepriseRefusee(false); return; }
          /* même prudence qu'ailleurs : si la piste n'a pas encore avancé,
             c'est un démarrage, pas un arrêt */
          if (progressRef.current < 0.6) return;
          setRepriseRefusee(true);
        } catch { /* lecteur absent : rien à dire */ }
      }, 1800);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
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
      /* la position RÉELLE du lecteur, pour distinguer un démarrage d'un
         arrêt (voir onStateChange) */
      currentTime.current = player?.getCurrentTime ? (player.getCurrentTime() || 0) : pos;
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
    currentTime.current = 0;

    markWanted(true);
    setIsPlaying(true);
    /* sans identifiant, ou avec un identifiant mort : on répare avant de
       jouer — jamais de lecture muette présentée comme un succès */
    jouer(track);
  };

  /* ═══════════ le clip du morceau courant ═══════════
     On ne cherche que quand on le demande (le bouton du grand lecteur)
     ou quand le grand lecteur s'ouvre en mode clip. La recherche ne
     bloque rien : la pochette reste affichée pendant ce temps. */
  const chercherClip = (t: Track | null) => {
    if (!t) return;
    const cle = `${t.artist}::${t.title}`.toLowerCase();
    if (clipDemandes.current.has(cle)) return;
    clipDemandes.current.add(cle);
    setClipEtat('cherche');
    void youtubeService
      .trouverClip({ title: t.title, artist: t.artist, videoId: t.videoId, durationSeconds: t.durationSeconds })
      .then((id) => {
        /* la réponse peut arriver après un changement de morceau */
        if (currentRef.current?.id !== t.id) return;
        setClipId(id);
        setClipEtat(id ? 'pret' : 'aucun');
      })
      .catch(() => {
        if (currentRef.current?.id === t.id) { setClipId(null); setClipEtat('aucun'); }
      });
  };

  const clipDemandes = useRef<Set<string>>(new Set());

  /* ── déplacer le lecteur YouTube dans le grand lecteur ──
     C'est la pièce maîtresse : on ne détruit rien, on **déplace** la
     même iframe. Le son ne s'interrompt donc pas une seconde, et la
     position reste exactement celle du morceau.

     Deux cas :
       · image = la vidéo qu'on écoute → rien à faire, c'est déjà synchro ;
       · image = un clip qui n'est pas la vidéo du son → on charge le clip
         **à la position du son** et on le met en sourdine : c'est le son
         de la musique qui commande, l'image suit. À chaque seconde où
         l'écart dépasserait 0,7 s, on recale. Aucune boucle, aucun
         doublon : une seule source de son, toujours. */
  const attachVideo = React.useCallback((el: HTMLDivElement | null) => {
    clipSlot.current = el;
    const p = playerRef.current;
    const iframe: HTMLIFrameElement | null = p?.getIframe ? p.getIframe() : null;
    if (!iframe) return;

    const placer = () => {
      const cible = clipSlot.current;
      if (!cible) { ombre().appendChild(iframe); return; }
      if (iframe.parentElement !== cible) {
        cible.appendChild(iframe);
        /* de vrais pixels : YouTube refuse de peindre dans un cadre de
           2 × 2, même si son CSS est en 100 % */
        const r = cible.getBoundingClientRect();
        clipTaille.current = { w: Math.round(r.width), h: Math.round(r.height) };
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = '0';
        iframe.setAttribute('width', String(Math.max(300, clipTaille.current.w)));
        iframe.setAttribute('height', String(Math.max(170, clipTaille.current.h)));
        p?.setSize?.(Math.max(300, clipTaille.current.w), Math.max(170, clipTaille.current.h));
      }
    };

    placer();


    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        const c = clipSlot.current;
        if (!c || iframe.parentElement !== c) return;
        const r = c.getBoundingClientRect();
        if (!r.width || !r.height) return;
        p?.setSize?.(Math.round(r.width), Math.round(r.height));
      })
      : null;
    if (ro && el) ro.observe(el);
    return () => ro?.disconnect();
  }, [mode, clipId, currentTrack]);

  const clipCharge = useRef<string | null>(null);

  /* ── le clip arrive après la bascule ──
     On a demandé à YouTube ; la réponse peut prendre deux secondes. Si on
     est déjà en mode clip quand elle arrive, c'est ici qu'on charge la
     vidéo — à la position du son, à l'instant où on la reçoit. Aucune
     resynchro n'est nécessaire ensuite : le clip EST le lecteur, il n'y a
     qu'une horloge à bord. */
  useEffect(() => {
    if (mode !== 'clip' || !clipId || !currentTrack) return;
    if (clipId === currentTrack.videoId) return;   /* c'est déjà la vidéo qu'on écoute */
    if (clipCharge.current === clipId) return;
    const p = playerRef.current;
    if (!p?.loadVideoById || !wantedPlay.current) return;
    const ici = p.getCurrentTime?.() || progressRef.current || 0;
    clipCharge.current = clipId;
    try { p.loadVideoById({ videoId: clipId, startSeconds: Math.max(0, ici - 0.4) }); } catch { /* ignore */ }
  }, [mode, clipId, currentTrack]);

  const toggleMode = () => {
    setMode((m) => {
      const suivant = m === 'audio' ? 'clip' : 'audio';
      if (suivant === 'clip') {
        /* on demande le clip au moment où on le montre, et pas avant :
           inutile d'interroger YouTube pour chaque morceau écouté */
        if (clipId && currentTrack && clipId !== currentTrack.videoId) {
          const p = playerRef.current;
          try {
            const ici = progressRef.current || 0;
            clipCharge.current = clipId;
            p?.loadVideoById?.({ videoId: clipId, startSeconds: Math.max(0, ici - 0.4) });
          } catch { /* lecteur absent */ }
        }
        if (clipEtat === 'inconnu') chercherClip(currentTrack);
      } else {
        /* retour à la pochette : on remet la vidéo du morceau, au même
           endroit, et on rend le son au lecteur */
        const p = playerRef.current;
        try {
          if (clipId && currentTrack && clipId !== currentTrack.videoId) {
            const ici = progressRef.current || 0;
            p?.loadVideoById?.({ videoId: currentTrack.videoId, startSeconds: Math.max(0, ici) });
            clipCharge.current = null;
          }
        } catch { /* lecteur absent */ }
      }
      return suivant;
    });
  };

  /* un nouveau morceau remet l'image à zéro : le clip de l'ancien n'a
     rien à voir avec celui du nouveau */
  const dernierMorceau = useRef<string | null>(null);
  useEffect(() => {
    const id = currentTrack?.id ?? null;
    if (id === dernierMorceau.current) return;
    dernierMorceau.current = id;
    setClipId(null);
    setClipEtat('inconnu');
    clipCharge.current = null;
    if (mode === 'clip') chercherClip(currentTrack);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [currentTrack?.id, mode]);

  const togglePlay = () => {
    if (!currentTrack) return;

    if (isPlaying) {
      /* la personne appuie sur pause : c'est elle qui décide, on ne
         relancera pas en arrière-plan */
      markWanted(false);
      playerRef.current?.pauseVideo?.();
      setIsPlaying(false);
    } else {
      markWanted(true);
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
        mode,
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
        toggleMode,
        clip: clipEtat,
        attachVideo,
        rateTrack,
        clearRating,
        reprendre,
        repriseRefusee,
        morceauxSautes,
        dernierSaute,
        oublierSautes,
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
