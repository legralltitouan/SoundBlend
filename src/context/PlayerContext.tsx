import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Track } from '../types';
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
  /* Le lecteur de musique reste en place. Un second lecteur, muet,
     fournit l'image et suit la position du premier. */
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
  /* Un seek YouTube est asynchrone : tant que le son n'a pas rejoint la
     nouvelle position, son ancienne valeur ne doit pas ramener le clip
     en arrière. */
  const seekMusique = useRef<{ cible: number; depuis: number } | null>(null);
  const synchroniserClipRef = useRef<(forcer?: boolean) => void>(() => {});

  const positionMusique = (): number | null => {
    try {
      const t = playerRef.current?.getCurrentTime?.();
      return typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : null;
    } catch { return null; }
  };
  const attenteSeekMusique = (position: number, maintenant: number): boolean => {
    const enCours = seekMusique.current;
    if (!enCours) return false;
    if (Math.abs(position - enCours.cible) <= 1.25 || maintenant - enCours.depuis >= 2500) {
      seekMusique.current = null;
      return false;
    }
    return true;
  };

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
            /* Écouter les états réels, y compris le tampon : la vidéo ne
               doit pas continuer à défiler pendant que le son attend. */
            synchroniserClipRef.current();
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
    progressRef.current = 0;
    currentTime.current = 0;
    seekMusique.current = null;
    lastSample.current = { t: performance.now(), pos: 0 };
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

  /* L'horloge affichée vient du lecteur qui produit le son. On lisse
     seulement entre deux échantillons, pendant 250 ms maximum : lorsqu'il
     est en pause ou en tampon, elle ne doit pas continuer toute seule. */
  const lastSample = useRef<{ t: number; pos: number }>({ t: 0, pos: 0 });
  useEffect(() => {
    if (!currentTrack) return;
    const tick = (now: number) => {
      const player = playerRef.current;
      const raw = positionMusique();
      let pos = progressRef.current;
      if (raw != null) {
        let etat = -1;
        try { etat = player?.getPlayerState?.() ?? -1; } catch { /* en attente */ }
        if (attenteSeekMusique(raw, now)) {
          pos = seekMusique.current!.cible;
          lastSample.current = { t: now, pos };
        } else {
          if (raw !== lastSample.current.pos || etat !== 1) lastSample.current = { t: now, pos: raw };
          const interpolation = etat === 1 ? Math.min(0.25, Math.max(0, (now - lastSample.current.t) / 1000)) : 0;
          pos = raw + interpolation;
          currentTime.current = raw;
        }
      }
      const total = durationRef.current;
      if (total > 0) pos = Math.min(pos, total);
      progressRef.current = pos;
      setProgress(pos);
      intervalRef.current = requestAnimationFrame(tick);
    };
    intervalRef.current = requestAnimationFrame(tick);
    return () => {
      if (intervalRef.current) cancelAnimationFrame(intervalRef.current);
      intervalRef.current = null;
    };
    /* la boucle lit les valeurs courantes dans les refs */
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [currentTrack?.id]);

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
    progressRef.current = 0;
    currentTime.current = 0;
    seekMusique.current = null;
    lastSample.current = { t: performance.now(), pos: 0 };

    markWanted(true);
    setIsPlaying(true);
    /* sans identifiant, ou avec un identifiant mort : on répare avant de
       jouer — jamais de lecture muette présentée comme un succès */
    jouer(track);
  };

  /* Recherche et identité du clip. Le service mémorise déjà les réponses
     et regroupe les requêtes en cours : ne pas bloquer une seconde
     recherche quand on revient plus tard sur un morceau déjà joué. */
  const cleClip = (t: Track | null): string | null => t ? `${t.id}::${t.videoId}` : null;
  const clipPour = useRef<string | null>(null);
  const clipRecherche = useRef<string | null>(null);
  const chercherClip = (t: Track | null) => {
    if (!t) return;
    const cle = cleClip(t)!;
    if (clipRecherche.current === cle) return;
    clipRecherche.current = cle;
    setClipEtat('cherche');
    void youtubeService
      .trouverClip({ title: t.title, artist: t.artist, videoId: t.videoId, durationSeconds: t.durationSeconds })
      .then((id) => {
        if (cleClip(currentRef.current) !== cle) return;
        clipPour.current = cle;
        setClipId(id);
        setClipEtat(id ? 'pret' : 'aucun');
      })
      .catch(() => {
        if (cleClip(currentRef.current) === cle) {
          clipPour.current = cle;
          setClipId(null);
          setClipEtat('aucun');
        }
      })
      .finally(() => { if (clipRecherche.current === cle) clipRecherche.current = null; });
  };

  /* La musique ne change pas de lecteur. Le clip est une seconde iframe
     muette. On ne déplace pas une iframe YouTube dans le DOM : quand le
     grand lecteur est réellement démonté, elle sera recréée à l'ouverture. */
  const attachVideo = React.useCallback((el: HTMLDivElement | null) => {
    if (clipSlot.current === el) return;
    /* Le grand lecteur est démonté à sa fermeture. Ne pas conserver une
       référence à son iframe détachée, sinon elle ne reviendra jamais. */
    if (clipSlot.current) {
      clipSlot.current = null;
      demontrerClip();
    }
    clipSlot.current = el;
    if (el) assurerClip();
  }, []);

  const clipPlayer = useRef<any>(null);
  const clipPret = useRef(false);
  /* l'identifiant réellement chargé dans le lecteur du clip */
  const clipCode = useRef<string | null>(null);
  const dernierSeekClip = useRef(-Infinity);
  const dernierOrdreClip = useRef<{ ordre: 'play' | 'pause'; a: number } | null>(null);
  /* l'état courant, lisible depuis les rappels à identité stable */
  const modeRef = useRef(mode);
  const clipIdRef = useRef(clipId);
  modeRef.current = mode;
  clipIdRef.current = clipId;
  /* le cadre du clip = **l'iframe elle-même** : `new YT.Player(div)` ne
     met pas une iframe DANS la div, il **remplace** la div par l'iframe */
  const cadreClip = useRef<Element | null>(null);

  /* on détruit le lecteur du clip et on retire son cadre */
  const demontrerClip = () => {
    const ancien = clipPlayer.current;
    clipPlayer.current = null;
    clipPret.current = false;
    clipCode.current = null;
    dernierSeekClip.current = -Infinity;
    dernierOrdreClip.current = null;
    try { ancien?.pauseVideo?.(); } catch { /* ignore */ }
    try { ancien?.destroy?.(); } catch { /* ignore */ }
    try { cadreClip.current?.parentNode?.removeChild(cadreClip.current); } catch { /* ignore */ }
    cadreClip.current = null;
    clipSlot.current?.querySelectorAll('.nowplaying-clip__frame').forEach((n) => n.remove());
  };

  /* ── créer le lecteur du clip, dans la pochette ──
     Vérifié sur le vrai YouTube : créé directement dans la boîte de la
     pochette, le lecteur démarre et peint normalement (`#movie_player`
     monté, vidéo présente) — y compris quand la boîte est encore en
     opacité 0. Il n'y a donc rien à déplacer, rien à contourner.
     Deux pièges en revanche, tous deux mesurés :
       · l'API n'accepte pas `100%` en largeur/hauteur → lecteur de
         taille nulle, écran noir. On donne des pixels.
       · l'API **remplace** la div par l'iframe : on retient l'iframe
         (`getIframe()`), pas la div. */
  const monterClip = () => {
    const cadre = clipSlot.current;
    if (!cadre || modeRef.current !== 'clip') return;
    const id = clipIdRef.current;
    if (!id || clipPour.current !== cleClip(currentRef.current)) return;

    /* un lecteur pour CE morceau : on ne le reconstruit pas */
    if (clipPlayer.current && clipCode.current === id) return;

    /* des cadres fantômes dans la pochette : ils sont noirs et couvrent
       l'image, on les retire */
    [...cadre.querySelectorAll('.nowplaying-clip__frame')].forEach((n) => n.remove());
    if (clipPlayer.current) demontrerClip();

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

    const l = Math.max(160, Math.round(cadre.clientWidth || 320));
    const h = Math.max(160, Math.round(cadre.clientHeight || 320));

    const cible = document.createElement('div');
    cible.className = 'nowplaying-clip__frame';
    cible.style.cssText = `width:${l}px;height:${h}px;`;
    cadre.appendChild(cible);
    cadreClip.current = cible;
    clipCode.current = id;
    clipPret.current = false;

    const son = positionMusique() ?? progressRef.current;
    try {
      clipPlayer.current = new window.YT.Player(cible, {
        width: String(l),
        height: String(h),
        videoId: id,
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1,
          playsinline: 1, iv_load_policy: 3,
          /* la position du son, et surtout : muet. Le son vient du lecteur
             de musique, jamais d'ici — sinon on entendrait deux fois. */
          start: Math.max(0, Math.floor(son)), mute: 1,
        },
        events: {
          onReady: (e: any) => {
            if (clipPlayer.current !== e.target) return;
            clipPret.current = true;
            try { e.target.mute?.(); } catch { /* ignore */ }
            /* le clip joue toujours, muet : il porte une image, pas un
               son. Le lier à l'intention de la musique (pause, reprise)
               faisait qu'une reprise le laissait figé sur une image
               noire. Son état suit celui de la musique par le calage
               ci-dessous, mais il démarre toujours. */
            try {
              e.target.playVideo?.();
              dernierOrdreClip.current = { ordre: 'play', a: performance.now() };
            } catch { /* ignore */ }
            synchroniserClipRef.current(true);
            /* on retient l'iframe : elle a remplacé notre div */
            const ifr = e.target.getIframe?.();
            if (ifr) {
              cadreClip.current = ifr as Element;
              Object.assign((ifr as HTMLElement).style, {
                position: 'absolute', inset: '0',
                width: '100%', height: '100%', border: '0',
                pointerEvents: 'none',
              });
            }
          },
          onStateChange: (e: any) => {
            if (clipPlayer.current !== e.target) return;
            if (e.data === 1 || e.data === 2 || e.data === 3) synchroniserClipRef.current();
          },
          onError: (e: any) => {
            if (clipPlayer.current !== e.target) return;
            demontrerClip();
            setClipId(null);
            setClipEtat('aucun');
          },
        },
      });
    } catch { /* lecteur absent */ }
  };

  /* Le son fait autorité. Les commandes ne touchent qu'au lecteur muet.
     On mesure toutes les 250 ms, sans multiplier les seeks pendant le
     chargement : YouTube cherche à une image-clé et ne promet pas le
     cadrage exact à la milliseconde. Les pubs ne sont pas détectables de
     façon fiable par l'API IFrame ; aucune heuristique sur leur durée. */
  const synchroniserClip = (forcer = false) => {
    const c = clipPlayer.current;
    const son = playerRef.current;
    if (!c || !clipPret.current || !son || clipPour.current !== cleClip(currentRef.current)) return;
    let etatC: number;
    let etatSon: number;
    try {
      etatC = c.getPlayerState?.() ?? -1;
      etatSon = son.getPlayerState?.() ?? -1;
    } catch { return; }
    const maintenant = performance.now();
    const ordonner = (ordre: 'play' | 'pause') => {
      const precedent = dernierOrdreClip.current;
      if (precedent?.ordre === ordre && maintenant - precedent.a < 1200) return;
      dernierOrdreClip.current = { ordre, a: maintenant };
      try { if (ordre === 'play') c.playVideo?.(); else c.pauseVideo?.(); } catch { /* lecteur pas prêt */ }
    };
    if (modeRef.current !== 'clip') {
      if (etatC === 1 || etatC === 3) ordonner('pause');
      return;
    }
    const position = positionMusique();
    const seekEnCours = position != null && attenteSeekMusique(position, maintenant);
    /* 0 = vidéo finie : ne pas la redémarrer en boucle pendant que la
       piste audio, éventuellement plus longue, termine. */
    if (etatC === 0 && !forcer) return;
    if (position != null && !seekEnCours && etatC !== 3) {
      try {
        const image = c.getCurrentTime?.();
        if (typeof image === 'number' && Number.isFinite(image)
            && Math.abs(image - position) > 0.7
            && (forcer || maintenant - dernierSeekClip.current >= 1400)) {
          dernierSeekClip.current = maintenant;
          c.seekTo?.(position, true);
        }
      } catch { /* le clip n'a pas encore d'horloge */ }
    }
    if (etatSon === 1 && etatC !== 1 && etatC !== 3) ordonner('play');
    else if (etatSon !== 1 && (etatC === 1 || etatC === 3)) ordonner('pause');
  };
  synchroniserClipRef.current = synchroniserClip;
  useEffect(() => {
    const timer = window.setInterval(() => synchroniserClipRef.current(), 250);
    return () => window.clearInterval(timer);
  }, []);

  /* ── ce qui prouve qu'un lecteur de clip est vivant ──
     Attention : PENDANT son démarrage, il n'a pas encore d'iframe —
     `getIframe()` rend null. Le juger « mort » à ce moment-là, c'est le
     détruire et le recréer en boucle, et il n'a jamais le temps de
     charger : écran noir, document vide. C'est exactement ce qui est
     arrivé. On considère donc comme vivant tout lecteur du bon morceau
     qui n'a pas encore rendu l'âme. */
  const assurerClip = () => {
    const cadre = clipSlot.current;
    if (!cadre) return;
    const m = modeRef.current;
    const cid = clipIdRef.current;
    if (m !== 'clip' || !cid || clipPour.current !== cleClip(currentRef.current)) return;

    if (clipPlayer.current && clipCode.current === cid) return;  /* en cours ou prêt : on n'y touche pas */
    monterClip();
  };

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
    assurerClip();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [mode, clipEtat, clipId, currentTrack?.id]);

  /* ── basculer l'image ──
     Rien à faire sur le lecteur de musique : il continue le morceau qu'il
     joue. Seule la seconde iframe (muette) change, elle, de vidéo. C'est
     ce qui garantit que le son ne s'interrompt pas et que l'horloge de la
     musique ne bouge pas d'un dixième de seconde. */
  const toggleMode = () => {
    const suivant: 'audio' | 'clip' = modeRef.current === 'audio' ? 'clip' : 'audio';
    modeRef.current = suivant;
    setMode(suivant);
    /* Recaler immédiatement au retour ; figer le clip quand on revient à
       la pochette. Le lecteur et la position de la musique ne changent pas. */
    synchroniserClipRef.current(suivant === 'clip');
    if (suivant === 'clip' && clipEtat === 'inconnu') chercherClip(currentTrack);
  };

  /* un nouveau morceau remet l'image à zéro : le clip de l'ancien n'a
     rien à voir avec celui du nouveau */
  const dernierMorceau = useRef<string | null>(null);
  useEffect(() => {
    const id = cleClip(currentTrack);
    if (id === dernierMorceau.current) return;
    dernierMorceau.current = id;
    /* L'identité audio fait aussi partie de la clé en cas de réparation. */
    clipPour.current = null;
    setClipId(null);
    setClipEtat('inconnu');
    demontrerClip();
    if (mode === 'clip') chercherClip(currentTrack);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [currentTrack?.id, currentTrack?.videoId, mode]);

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
    if (!Number.isFinite(seconds)) return;
    const cible = Math.max(0, Math.min(durationRef.current || seconds, seconds));
    const maintenant = performance.now();
    seekMusique.current = { cible, depuis: maintenant };
    progressRef.current = cible;
    currentTime.current = cible;
    lastSample.current = { t: maintenant, pos: cible };
    setProgress(cible);
    try { playerRef.current?.seekTo?.(cible, true); } catch { /* lecteur absent */ }
    if (modeRef.current === 'clip' && clipPret.current && clipPour.current === cleClip(currentRef.current)) {
      try {
        clipPlayer.current?.seekTo?.(cible, true);
        dernierSeekClip.current = maintenant;
      } catch { /* le clip peut encore charger */ }
    }
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
