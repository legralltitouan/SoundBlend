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
  /* ── le lecteur reste dans le document, à SA taille, derrière l'app ──
     Avant, il vivait dans une boîte de 2 × 2 px hors de l'écran. YouTube
     n'aime pas ça : il refuse de peindre, et surtout il **coupe le son**
     quand l'iframe n'a pas de surface réelle (c'est même une règle
     explicite de leur API depuis 2023). D'où les erreurs de la console
     — et, pour nous, une image impossible à récupérer.

     Maintenant l'iframe a une vraie surface (320 × 180) et un empilement
     qui la met **toujours** derrière l'application (z-index négatif,
     plus bas que la racine). Elle reste dans le document en permanence :
     aucune API n'est jamais appelée sur un lecteur détaché, et aucune
     barre YouTube ne peut apparaître à l'écran. */
  const ombre = () => {
    let host = document.getElementById('youtube-player-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'youtube-player-host';
      host.setAttribute('aria-hidden', 'true');
      Object.assign(host.style, {
        position: 'fixed', zIndex: '-1',
        left: '0', bottom: '0',
        width: '320px', height: '180px',
        overflow: 'hidden',
        border: '0', margin: '0', padding: '0',
        opacity: '1', pointerEvents: 'none',
      });
      const mount = document.createElement('div');
      mount.id = 'youtube-player-mount';
      mount.style.cssText = 'width:320px;height:180px;';
      host.style.zIndex = '-1';
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
        height: '180',
        width: '320',
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

  /* ── quelle vidéo on charge, et pour quel morceau ──
     `clipCharge` retient l'identifiant déjà chargé, `clipChargePour` le
     morceau auquel il appartenait. Les deux ensemble, sinon le lecteur
     « croit » avoir déjà chargé le clip du nouveau morceau et garde
     l'ancien — d'où le clip du premier titre de la playlist qui revenait
     quand on passait au suivant. */
  const clipChargePour = useRef<string | null>(null);
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
  /**
   * ─────────── l'image du clip : une SECONDE iframe, sans son ───────────
   *
   * Deux tentatives ont échoué avant celle-ci, et il faut le dire :
   *
   *   1. déplacer l'iframe du lecteur → YouTube la perd (« not attached to
   *      the DOM »), le lecteur meurt ;
   *   2. recopier son image sur un canvas → **impossible** : c'est une
   *      origine différente, le navigateur interdit la lecture des pixels
   *      (et de la vidéo) d'une iframe youtube.com. C'était l'écran noir.
   *
   * La solution qui marche est celle que la plateforme prévoit : une
   * **iframe d'intégration dédiée**, muette, placée dans la pochette, et
   * pilotée par l'API. Le lecteur de musique, lui, continue de son côté,
   * intact — il porte le son, et il n'est plus jamais touché.
   *
   * Pour que l'image et le son restent ensemble, on recale le clip sur la
   * position du lecteur à la bascule, puis dès que l'écart dépasse une
   * demi-seconde (ce qui n'arrive qu'après un saut manuel).
   */
  const attachVideo = React.useCallback((el: HTMLDivElement | null) => {
    clipSlot.current = el;
    if (el) monterClip();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [mode, clipId, currentTrack]);

  const clipPlayer = useRef<any>(null);
  const clipPret = useRef(false);

  /* crée (une seule fois) l'iframe du clip dans la boîte de la pochette */
  const monterClip = () => {
    const cadre = clipSlot.current;
    if (!cadre) return;
    const id = mode === 'clip' && clipId ? clipId : null;
    if (!id) return;

    if (clipPlayer.current?.loadVideoById) {
      /* il existe déjà : on lui donne simplement le nouveau morceau */
      try {
        const son = playerRef.current?.getCurrentTime?.() || 0;
        clipPlayer.current.loadVideoById({ videoId: id, startSeconds: Math.max(0, son - 0.3) });
        clipPlayer.current.mute?.();
        if (wantedPlay.current) clipPlayer.current.playVideo?.();
      } catch { /* ignore */ }
      return;
    }
    if (!window.YT || !window.YT.Player) {
      /* l'API n'est pas encore là : on réessaie dans un instant */
      let n = 0;
      const t = window.setInterval(() => {
        n += 1;
        if (window.YT?.Player) { window.clearInterval(t); monterClip(); }
        else if (n > 40) window.clearInterval(t);
      }, 200);
      return;
    }

    const cible = document.createElement('div');
    cible.style.cssText = 'width:100%;height:100%;';
    const ancien = cadre.querySelector('.nowplaying-clip__frame');
    if (ancien) ancien.remove();
    cible.className = 'nowplaying-clip__frame';
    cadre.appendChild(cible);

    const son = playerRef.current?.getCurrentTime?.() || progressRef.current || 0;
    try {
      clipPlayer.current = new window.YT.Player(cible, {
        width: '100%',
        height: '100%',
        videoId: id,
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1,
          playsinline: 1, iv_load_policy: 3,
          /* la position du son, et surtout : muet. Le son vient du lecteur
             de musique, jamais d'ici — sinon on entendrait deux fois. */
          start: Math.max(0, Math.floor(son - 0.3)), mute: 1,
        },
        events: {
          onReady: (e: any) => {
            clipPret.current = true;
            try { e.target.mute?.(); } catch { /* ignore */ }
            if (wantedPlay.current) e.target.playVideo?.();
          },
        },
      });
    } catch { /* lecteur absent */ }
  };

  /* le clip suit la lecture : pause, reprise, et recalage discret */
  useEffect(() => {
    const t = window.setInterval(() => {
      if (mode !== 'clip' || !clipPlayer.current?.getPlayerState) return;
      const c = clipPlayer.current;
      const son = playerRef.current;
      if (!son?.getCurrentTime) return;
      let etatC = 0;
      try { etatC = c.getPlayerState?.() ?? 0; } catch { return; }
      /* on ne cherche pas à synchroniser au dixième de seconde : au-delà
         d'une demi-seconde d'écart, on recale. En deçà, l'œil ne voit rien
         et le son est de toute façon celui du lecteur de musique. */
      try {
        const ecart = (c.getCurrentTime?.() || 0) - (son.getCurrentTime?.() || 0);
        if (Math.abs(ecart) > 0.6) c.seekTo?.(son.getCurrentTime() || 0, true);
        const enLecture = (son.getPlayerState?.() ?? 0) === 1;
        if (enLecture && etatC !== 1) c.playVideo?.();
        if (!enLecture && etatC === 1) c.pauseVideo?.();
      } catch { /* ignore */ }
    }, 700);
    return () => window.clearInterval(t);
  }, [mode]);

  /* on quitte le mode vidéo : le clip se tait et disparaît */
  useEffect(() => {
    if (mode === 'clip') return;
    try { clipPlayer.current?.pauseVideo?.(); } catch { /* ignore */ }
    clipSlot.current?.querySelectorAll('.nowplaying-clip__frame').forEach((n) => {
      const f = n as HTMLElement;
      f.style.display = 'none';
    });
  }, [mode]);

  /* un clip qui n'existe pas : on ne montre pas une image, on revient à
     la pochette — et on le dit, sans jamais laisser un cadre noir */
  useEffect(() => {
    if (mode !== 'clip') return;
    if (clipEtat !== 'aucun') return;
    setMode('audio');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [mode, clipEtat]);

  /* le clip arrive après la bascule : on le monte à ce moment-là */
  useEffect(() => {
    if (mode !== 'clip' || clipEtat !== 'pret' || !clipId) return;
    monterClip();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [mode, clipEtat, clipId, currentTrack?.id]);

  /* ── basculer l'image ──
     Rien à faire sur le lecteur de musique : il continue le morceau qu'il
     joue. Seule la seconde iframe (muette) change, elle, de vidéo. C'est
     ce qui garantit que le son ne s'interrompt pas et que l'horloge de la
     musique ne bouge pas d'un dixième de seconde. */
  const toggleMode = () => {
    const suivant: 'audio' | 'clip' = mode === 'audio' ? 'clip' : 'audio';
    setMode(suivant);
    if (suivant === 'clip') {
      if (clipEtat === 'inconnu') chercherClip(currentTrack);
      /* le clip a déjà sa réponse : on le monte tout de suite */
      if (clipEtat === 'pret' && clipId) monterClip();
    } else {
      try { clipPlayer.current?.pauseVideo?.(); } catch { /* ignore */ }
    }
  };

  /* un nouveau morceau remet l'image à zéro : le clip de l'ancien n'a
     rien à voir avec celui du nouveau */
  const dernierMorceau = useRef<string | null>(null);
  useEffect(() => {
    const id = currentTrack?.id ?? null;
    if (id === dernierMorceau.current) return;
    dernierMorceau.current = id;
    /* on oublie l'image de l'ancien morceau — y compris l'identifiant
       « déjà chargé », sinon le nouveau morceau hérite du clip précédent */
    setClipId(null);
    setClipEtat('inconnu');
    try { clipPlayer.current?.pauseVideo?.(); } catch { /* ignore */ }
    clipSlot.current?.querySelectorAll('.nowplaying-clip__frame').forEach((n) => (n as HTMLElement).remove());
    clipPlayer.current = null;
    clipPret.current = false;
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
