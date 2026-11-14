import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Plus, RefreshCw, ChevronRight, LogIn, Sparkles } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { Art, PlaylistArt } from '../ui/Art';
import { useUI } from '../../context/UIContext';
import { usePlayer } from '../../context/PlayerContext';
import { NoiseBackground } from '@/components/ui/noise-background';

/* ═══════════════════════════════════════════════════════════════
   Bibliothèque — reprise exacte de l'écran d'accueil de l'app :
   accroche « Bonjour / Qu'est-ce qu'on écoute ? », rangée de puces,
   « Reprendre », grille de pochettes, « Ton dernier blend ».
   Sur ordinateur la grille s'élargit (5–6 colonnes) et les actions
   complètent l'en-tête ; sur téléphone c'est la vue mobile à
   l'identique.
   ═══════════════════════════════════════════════════════════════ */

export const LibraryView: React.FC = () => {
  const {
    playlists, loadingLibrary, libraryError, loadPlaylistTracks,
    currentBlend, recentBlends, refreshLibrary, isAuthenticated, login, userProfile,
    setCurrentBlend,
  } = useData();
  const { openModal, setView } = useUI();
  const { playTrack } = usePlayer();

  /* Le blend affiché est celui qu'on a ouvert ; à défaut, le plus récent
     réellement enregistré sur l'appareil (même source que « Mes blends »). */
  const lastBlend = currentBlend ?? recentBlends[0] ?? null;
  /* la carte « Reprendre » sert aussi de première tuile de la grille :
     même geste, même place, et plus de tuile sans fonction */

  const openPlaylist = (id: string) => {
    const pl = playlists.find((p) => p.id === id);
    if (!pl?.tracks?.length) {
      /* pas encore de morceaux en mémoire : on les charge d'abord, sinon la
         modale s'ouvrirait sur une liste vide */
      void loadPlaylistTracks(id).then(() => openModal('picker', { playlistId: id }));
      return;
    }
    openModal('picker', { playlistId: id });
  };

  const playPlaylist = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    void loadPlaylistTracks(id).then((tracks) => {
      if (tracks[0]) playTrack(tracks[0], tracks); // toute la playlist devient la file
    });
  };

  return (
    <div className="ytm-page">
      {/* ─────────── accroche ─────────── */}
      <motion.header
        className="sb-hero"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1>
          <Greeting name={userProfile?.name} />
        </h1>
        <h1 className="sb-hero-line2">
          <FlipWords words={QUESTIONS} />
        </h1>
        <p>
          Choisis quelques morceaux, l’IA compose le reste — tes favoris, les pépites
          cachées et des découvertes.
        </p>
        <div className="sb-hero-action">
          <NoiseBackground
            containerClassName="sb-cta-noise w-fit rounded-full p-2"
            className="rounded-full"
            gradientColors={['rgb(255, 0, 102)', 'rgb(94, 0, 255)', 'rgb(255, 122, 0)']}
            noiseIntensity={0.34}
            speed={0.16}
          >
            <button
              className="sb-cta flex h-full w-full cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-2.5 text-[15px] font-semibold transition-all duration-100 active:scale-[0.98]"
              onClick={() => openModal('picker')}
            >
              <Plus size={19} strokeWidth={2.4} /> Nouveau blend
            </button>
          </NoiseBackground>
          {!isAuthenticated && (
            <button className="sb-link-login" onClick={login}>
              <LogIn size={14} strokeWidth={2} /> Connecter mon compte
            </button>
          )}
        </div>
      </motion.header>

      {libraryError && (
        <div className="sb-note">
          <span>{libraryError}</span>
          <button className="chip" onClick={refreshLibrary}>Réessayer</button>
        </div>
      )}

      {/* ─────────── bibliothèque ─────────── */}
      <div className="sb-section-head">
        <h2>Ta bibliothèque</h2>
        <span className="count">{playlists.length + 1} sources</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          onClick={() => (isAuthenticated ? refreshLibrary() : login())}
          aria-label="Rafraîchir"
          title={isAuthenticated ? 'Resynchroniser' : 'Connecter mon compte'}
        >
          <RefreshCw size={17} strokeWidth={1.9} />
        </button>
      </div>

      <div className="sb-grid">
        {/* première tuile : reprendre le dernier blend, sinon en créer un */}
        {lastBlend ? (
          <button
            className="sb-tile sb-tile--resume"
            onClick={() => { setCurrentBlend(lastBlend); setView('blend'); }}
          >
            <span className="sb-tile-art">
              {lastBlend.tracks[0]
                ? <Art track={lastBlend.tracks[0]} size="100%" radius={0} />
                : <span style={{ position: 'absolute', inset: 0, background: 'var(--bg-3)' }} />}
              <span className="sb-tile-badge">Reprendre</span>
              <span
                className="sb-play-badge"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (lastBlend.tracks[0]) playTrack(lastBlend.tracks[0], lastBlend.tracks);
                }}
                aria-label={`Écouter ${lastBlend.title}`}
              >
                <Play size={15} fill="currentColor" />
              </span>
            </span>
            <span className="sb-tile-title">{lastBlend.title}</span>
            <span className="sb-tile-sub">
              {lastBlend.tracks.length} titres · {Math.max(1, Math.round(lastBlend.tracks.reduce((n, t) => n + (t.durationSeconds || 0), 0) / 60))} min
            </span>
          </button>
        ) : (
          <button className="sb-tile sb-tile--new" onClick={() => openModal('picker')}>
            <span className="sb-tile-art sb-tile-art--new">
              <Plus size={30} strokeWidth={2} />
            </span>
            <span className="sb-tile-title">Nouveau blend</span>
            <span className="sb-tile-sub">Choisis trois ou quatre morceaux</span>
          </button>
        )}

        {loadingLibrary && playlists.length === 0 &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="sb-tile">
              <span className="skeleton sb-tile-art" />
              <span className="skeleton" style={{ height: 13, width: '70%', borderRadius: 4 }} />
              <span className="skeleton" style={{ height: 11, width: '40%', borderRadius: 4 }} />
            </div>
          ))}

        {playlists.map((pl) => (
          <button key={pl.id} className="sb-tile" onClick={() => openPlaylist(pl.id)}>
            <span className="sb-tile-art">
              <PlaylistArt tracks={pl.tracks} title={pl.title} size="100%" radius={0} />
              <span
                className="sb-play-badge"
                role="button"
                tabIndex={0}
                onClick={(e) => playPlaylist(e, pl.id)}
              >
                <Play size={15} fill="currentColor" />
              </span>
            </span>
            <span className="sb-tile-title">{pl.title}</span>
            <span className="sb-tile-sub">
              {pl.tracks?.length || pl.trackCount || 0} titres
            </span>
          </button>
        ))}

        {!loadingLibrary && playlists.length === 0 && (
          <button className="sb-tile sb-tile--empty" onClick={login}>
            <span className="sb-tile-art sb-tile-art--empty">
              <LogIn size={26} strokeWidth={1.6} />
            </span>
            <span className="sb-tile-title">Connecter YouTube</span>
            <span className="sb-tile-sub">Importer tes playlists</span>
          </button>
        )}
      </div>

      {/* ─────────── dernier blend ─────────── */}
      <div className="sb-section-head">
        <h2>Ton dernier blend</h2>
        <span className="spacer" />
        <span className="count">
          {lastBlend ? `${lastBlend.tracks.length} titres` : 'aucun'}
        </span>
      </div>

      <div className="sb-list">
        {(lastBlend?.tracks ?? []).slice(0, 6).map((t) => (
          <button key={t.id} className="sb-row" onClick={() => playTrack(t, lastBlend?.tracks ?? [t])}>
            <Art className="sb-row-art" track={t} size={44} radius={8} />
            <span className="sb-row-meta">
              <span className="sb-row-title">{t.title}</span>
              <span className="sb-row-sub">{t.artist}</span>
            </span>
            <Play size={15} className="ink-3" />
          </button>
        ))}
        {!lastBlend && (
          <p className="sb-empty">
            Aucun blend encore.<br />Choisis quelques morceaux pour commencer.
          </p>
        )}
        {lastBlend && (
          <button className="sb-row sb-row--more" onClick={() => setView('history')}>
            <span className="sb-row-meta">
              <span className="sb-row-title">Tous mes blends</span>
              <span className="sb-row-sub">{recentBlends.length} blend{recentBlends.length > 1 ? 's' : ''} enregistré{recentBlends.length > 1 ? 's' : ''}</span>
            </span>
            <ChevronRight size={17} className="ink-3" />
          </button>
        )}
      </div>

      <p className="sb-footnote">
        <Sparkles size={13} strokeWidth={1.8} /> Lecture et export via l’API YouTube Data v3 ·
        l’historique d’écoute n’est pas exposé par Google.
      </p>
    </div>
  );
};

/* ─────────────── « Bonjour Titouan. » ─────────────── */

const Greeting: React.FC<{ name?: string | null }> = ({ name }) => {
  const first = useMemo(() => {
    if (!name) return null;
    const clean = name.trim().split(/\s+/)[0];
    return clean.length > 1 ? clean : null;
  }, [name]);

  return (
    <span className="sb-greeting">
      {first ? `Bonjour ${first}.` : 'Bonjour.'}
    </span>
  );
};

/* ─────────────── la question qui tourne ─────────────── */

/* ═══════════════════════════════════════════════════════════════
   L'accueil : les phrases d'origine, et l'animation « FlipWords ».

   Toute la phrase est grise ; quand elle change, les mots basculent
   l'un après l'autre — les anciens tombent, les nouveaux arrivent
   par le dessus. Les mots qui existent déjà dans les deux phrases
   ne bougent pas : seule la partie qui change pivote.
   ═══════════════════════════════════════════════════════════════ */

/* que des vraies questions : « Là, maintenant : » tout seul ne veut rien
   dire une fois détaché du « Bonjour » au-dessus */
const QUESTIONS = [
  'Qu’est-ce qu’on écoute ?',
  'Quel est ton mood musical ?',
  'On commence par quoi ?',
  'Une envie, là, maintenant ?',
  'Quel morceau te ressemble ?',
  'On met quoi dans l’ambiance ?',
];

const FLIP_STAGGER = 0.018;   // décalage entre deux mots
const FLIP_MS = 3200;         // une phrase toutes les 3,2 s

const FlipWords: React.FC<{ words: string[] }> = ({ words: list }) => {
  const [i, setI] = useState(0);
  /* la phrase qu'on vient de quitter : au tout premier affichage il n'y en a
     pas — sinon les mots de la dernière phrase apparaîtraient une fraction
     de seconde par-dessus la première */
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      setLeaving(list[i]);
      setI((n) => (n + 1) % list.length);
    }, FLIP_MS);
    return () => clearInterval(t);
  }, [i, list]);

  /* les mots de la phrase courante, et la phrase précédente : ceux qui
     sont communs restent en place, les autres basculent */
  const current = useMemo(() => list[i].split(' '), [list, i]);
  const previous = useMemo(() => (leaving ? leaving.split(' ') : []), [leaving]);

  return (
    <span className="sb-flip-words" aria-live="polite">
      {current.map((w, idx) => {
        const wasThere = previous.includes(w);
        return (
          <motion.span
            key={`${i}-${idx}-${w}`}
            className="sb-flip-word"
            initial={wasThere ? false : { opacity: 0, y: '62%', rotateX: -85, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: '0%', rotateX: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.52, delay: idx * FLIP_STAGGER, ease: [0.22, 1, 0.36, 1] }}
          >
            {w}
          </motion.span>
        );
      })}
      {/* les mots qui étaient là et qui partent tombent, décalés */}
      <span className="sb-flip-leaving" aria-hidden>
        {previous.map((w, idx) =>
          current.includes(w) ? (
            /* garde la place : le mot ne bouge pas, mais la couche
               sortante doit garder la même mise en page */
            <span key={`${i}-hold-${idx}-${w}`} className="sb-flip-word sb-flip-word--ghost">
              {w}
            </span>
          ) : (
            <motion.span
              key={`${i}-out-${idx}-${w}`}
              className="sb-flip-word sb-flip-word--out"
              initial={{ opacity: 1, y: '0%', rotateX: 0, filter: 'blur(0px)' }}
              animate={{ opacity: 0, y: '-62%', rotateX: 85, filter: 'blur(6px)' }}
              transition={{ duration: 0.42, delay: idx * FLIP_STAGGER, ease: [0.22, 1, 0.36, 1] }}
            >
              {w}
            </motion.span>
          ),
        )}
      </span>
    </span>
  );
};
