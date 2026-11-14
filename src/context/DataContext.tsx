import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Playlist, Track, GeneratedBlend, BlendConfig, AppSettings, UserProfile } from '../types';
import { sameTrack, trackKey, ratingKey, getStoredRatings, writeStoredRatings, type TrackRating } from '../lib/track';
import { youtubeService } from '../services/youtube';
import { geminiService } from '../services/gemini';
import { uniqueTracks } from '../lib/dedupe';
import {
  applyRatingToTaste,
  getStoredSettings,
  saveStoredSettings,
  getStoredBlends,
  saveBlendToStorage,
  deleteStoredBlend,
  getStoredTasteMemory,
  saveStoredTasteMemory,
  writeStoredBlends,
} from '../services/storage';
import { MOCK_PLAYLISTS } from '../data/mockData';

interface DataContextType {
  settings: AppSettings;
  saveSettings: (s: AppSettings) => void;

  isAuthenticated: boolean;
  userProfile: UserProfile | null;
  login: () => Promise<void>;
  logout: () => void;

  playlists: Playlist[];
  loadingLibrary: boolean;
  libraryError: string | null;
  loadLibrary: () => Promise<void>;
  loadPlaylistTracks: (id: string) => Promise<Track[]>;
  refreshLibrary: () => Promise<void>;

  selectedTracks: Track[];
  toggleTrack: (t: Track) => void;
  removeTrack: (id: string) => void;
  clearSelection: () => void;
  isSelected: (id: string, track?: Track) => boolean;

  currentBlend: GeneratedBlend | null;
  setCurrentBlend: (b: GeneratedBlend | null) => void;
  updateBlend: (b: GeneratedBlend) => void;
  recentBlends: GeneratedBlend[];
  refreshBlends: () => void;
  removeBlend: (id: string) => void;
  searchCatalog: (q: string) => Promise<{ tracks: Track[]; error: string | null }>;

  generating: boolean;
  generatingStatus: string;
  generate: (config: BlendConfig) => Promise<GeneratedBlend | null>;

  tasteVersion: number;
  bumpTaste: () => void;

  /* ── le vote, partagé ──────────────────────────────────────────────
     Un avis donné quelque part (liste du blend, barre du lecteur, plein
     écran) doit apparaître partout immédiatement : c'est ce registre qui
     s'en charge. La clé est celle du morceau (videoId), pas de la ligne. */
  ratingOf: (t: { videoId?: string; title?: string; artist?: string }) => TrackRating;
  setRating: (t: Track, rating: TrackRating) => void;
  ratingsVersion: number;
  /* efface d'un coup tous les avis, partout (mémoire + blends enregistrés) */
  resetAllRatings: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(getStoredSettings);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => youtubeService.isAuthenticated());
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => youtubeService.getUserProfile());

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [currentBlend, setCurrentBlendState] = useState<GeneratedBlend | null>(null);
  const [recentBlends, setRecentBlends] = useState<GeneratedBlend[]>(getStoredBlends);

  const [generating, setGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState('');
  const [tasteVersion, setTasteVersion] = useState(0);

  const bumpTaste = useCallback(() => setTasteVersion((v) => v + 1), []);

  /* Le registre des avis : une seule vérité pour toute l'application.
     Il est relu depuis le stockage au démarrage, puis mis à jour à chaque
     vote — d'où qu'il vienne. */
  const [ratings, setRatings] = useState<Record<string, TrackRating>>(() => getStoredRatings());
  const [ratingsVersion, setRatingsVersion] = useState(0);

  const ratingOf = useCallback(
    (t: { videoId?: string; title?: string; artist?: string }) => ratings[ratingKey(t)] ?? null,
    [ratings],
  );

  const setRating = useCallback((t: Track, rating: TrackRating) => {
    setRatings((prev) => {
      const next = { ...prev };
      const k = ratingKey(t);
      if (rating) next[k] = rating; else delete next[k];
      writeStoredRatings(next);
      return next;
    });
    setRatingsVersion((v) => v + 1);
    /* la mémoire du goût suit le même mouvement — y compris quand on
       retire un avis : le morceau quitte alors « Tes goûts ». */
    applyRatingToTaste(t, rating);
    bumpTaste();
  }, [bumpTaste]);

  const loadingRef = useRef(false);

  const loadLibrary = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingLibrary(true);
    setLibraryError(null);

    try {
      if (!youtubeService.isAuthenticated()) {
        setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p })));
        setIsAuthenticated(false);
        return;
      }

      const userPlaylists = await youtubeService.fetchPlaylists();
      const looksLikeDemo = userPlaylists.some((p) => p.id.startsWith('demo-pl-'));
      if (looksLikeDemo) {
        // l'API n'a rien renvoyé : on garde la démo mais on le dit clairement
        setLibraryError(
          "YouTube n'a renvoyé aucune playlist pour ce compte. Vérifie le compte choisi lors de la connexion.",
        );
      }
      setPlaylists(userPlaylists);

      if (userPlaylists.length > 0) {
        /* précharge les premières playlists : la modale est aussitôt utile et
           surtout chaque tuile peut montrer une vraie pochette au lieu d'initiales */
        const warm = userPlaylists.slice(0, 6);
        warm.forEach((pl, i) => {
          setTimeout(() => {
            youtubeService.fetchPlaylistTracks(pl.id).then((tracks) => {
              if (!tracks.length) return;
              setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? { ...p, tracks } : p)));
            }).catch(() => {});
          }, i * 180);
        });
      }
    } catch (e: any) {
      setLibraryError(e?.message || 'Impossible de lire la bibliothèque YouTube.');
      setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p })));
    } finally {
      loadingRef.current = false;
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    if (settings.googleClientId) {
      youtubeService.initOAuth(settings.googleClientId);
    }
    // l'avatar du compte doit apparaître même si la bibliothèque ne répond pas
    if (youtubeService.isAuthenticated()) {
      setIsAuthenticated(true);
      const p = youtubeService.getUserProfile();
      if (p) setUserProfile(p);
    }
    loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.googleClientId]);

  const refreshLibrary = useCallback(async () => {
    await loadLibrary();
  }, [loadLibrary]);

  const loadPlaylistTracks = useCallback(async (playlistId: string): Promise<Track[]> => {
    try {
      const tracks = await youtubeService.fetchPlaylistTracks(playlistId);
      setPlaylists((prev) => prev.map((pl) => (pl.id === playlistId ? { ...pl, tracks } : pl)));
      return tracks;
    } catch (e) {
      console.warn('Failed to load tracks', playlistId, e);
      return [];
    }
  }, []);

  /* Réinitialiser les goûts : ce n'est pas seulement vider une liste à
     l'écran, il faut retirer les pouces de chaque morceau — le registre des
     avis, les blends enregistrés, la file du lecteur et la mémoire. */
  const resetAllRatings = useCallback(() => {
    setRatings(() => {
      writeStoredRatings({});
      return {};
    });
    setRatingsVersion((v) => v + 1);

    /* les blends gardent une copie de l'avis : on l'efface aussi */
    setRecentBlends((prev) => {
      const next = prev.map((b) => ({
        ...b,
        tracks: b.tracks.map((t) => ({ ...t, userRating: null })),
        seedTracks: (b.seedTracks || []).map((t) => ({ ...t, userRating: null })),
      }));
      writeStoredBlends(next);
      return next;
    });
    setCurrentBlendState((b) =>
      b
        ? {
            ...b,
            tracks: b.tracks.map((t) => ({ ...t, userRating: null })),
            seedTracks: (b.seedTracks || []).map((t) => ({ ...t, userRating: null })),
          }
        : b,
    );

    /* la mémoire des goûts repart de zéro en même temps que les pouces :
       deux listes vides valent mieux qu'une mémoire fantôme */
    saveStoredTasteMemory({ likedTracks: [], dislikedTracks: [], likedArtists: [], dislikedArtists: [] });
    bumpTaste();
    window.dispatchEvent(new CustomEvent('sb:ratings-reset'));
  }, [bumpTaste]);

  const login = useCallback(async () => {
    await youtubeService.login(settings.googleClientId);
    setIsAuthenticated(true);
    setUserProfile(youtubeService.getUserProfile());
    await loadLibrary();
  }, [settings.googleClientId, loadLibrary]);

  const logout = useCallback(() => {
    youtubeService.logout();
    setIsAuthenticated(false);
    setUserProfile(null);
    setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p })));
    setSelectedTracks([]);
  }, []);

  const saveSettings = useCallback((s: AppSettings) => {
    saveStoredSettings(s);
    setSettings(s);
  }, []);

  /* un morceau est identifié par son videoId, pas par son id : le même
     titre retrouvé dans une autre playlist reste coché */
  const toggleTrack = useCallback((track: Track) => {
    setSelectedTracks((prev) => {
      const exists = prev.some((t) => sameTrack(t, track));
      return exists ? prev.filter((t) => !sameTrack(t, track)) : [...prev, track];
    });
  }, []);

  const removeTrack = useCallback((id: string) => {
    setSelectedTracks((prev) => prev.filter((t) => t.id !== id && t.videoId !== id));
  }, []);

  const clearSelection = useCallback(() => setSelectedTracks([]), []);

  const isSelected = useCallback(
    (id: string, track?: Track) =>
      track
        ? selectedTracks.some((t) => sameTrack(t, track))
        : selectedTracks.some((t) => t.id === id || t.videoId === id || trackKey(t) === id),
    [selectedTracks],
  );

  const setCurrentBlend = useCallback((b: GeneratedBlend | null) => setCurrentBlendState(b), []);

  const updateBlend = useCallback((b: GeneratedBlend) => {
    setCurrentBlendState(b);
    saveBlendToStorage(b);
    setRecentBlends(getStoredBlends());
  }, []);

  const refreshBlends = useCallback(() => setRecentBlends(getStoredBlends()), []);

  const searchCatalog = useCallback((q: string) => youtubeService.searchTracks(q, 20), []);

  const removeBlend = useCallback((id: string) => {
    deleteStoredBlend(id);
    setRecentBlends(getStoredBlends());
  }, []);

  const generate = useCallback(
    async (config: BlendConfig): Promise<GeneratedBlend | null> => {
      if (!selectedTracks.length) return null;
      setGenerating(true);
      setGeneratingStatus('Analyse de l’empreinte musicale des morceaux sélectionnés…');

      try {
        const tasteMemory = getStoredTasteMemory();
        const generatedTracks = await geminiService.generateBlend(
          selectedTracks,
          config,
          tasteMemory,
          (msg) => setGeneratingStatus(msg),
        );

        const now = new Date();
        const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const artists = Array.from(new Set(selectedTracks.map((t) => t.artist))).slice(0, 2);
        const name =
          artists.length >= 2
            ? `${artists[0]}, ${artists[1]} & co.`
            : artists[0]
              ? `Autour de ${artists[0]}`
              : 'Nouveau blend';

        /* dernier filet : quel que soit le chemin qui a produit la liste
           (modèle, repli local, remplacement), un blend ne part jamais
           avec un morceau en double. */
        const blend: GeneratedBlend = {
          id: `blend-${Date.now()}`,
          title: name,
          description: `Blend généré à partir de ${selectedTracks.length} titre${selectedTracks.length > 1 ? 's' : ''} d’amorce`,
          createdAt: now.toISOString(),
          expiresAt: expires.toISOString(),
          seedTracks: selectedTracks,
          tracks: uniqueTracks(generatedTracks),
          /* par quel moyen : la réponse reste attachée au blend, pas
             seulement à l'écran qui l'a vu naître */
          methode: {
            kind: geminiService.derniereMethode,
            model: geminiService.dernierModele || undefined,
            detail: geminiService.derniereNote,
          },
        };

        saveBlendToStorage(blend);
        setRecentBlends(getStoredBlends());
        setCurrentBlendState(blend);
        setSelectedTracks([]);
        return blend;
      } catch (e: any) {
        throw new Error(e?.message || 'La génération a échoué.');
      } finally {
        setGenerating(false);
      }
    },
    [selectedTracks],
  );

  const value = useMemo<DataContextType>(
    () => ({
      settings,
      saveSettings,
      isAuthenticated,
      userProfile,
      login,
      logout,
      playlists,
      loadingLibrary,
      libraryError,
      loadLibrary,
      loadPlaylistTracks,
      refreshLibrary,
      selectedTracks,
      toggleTrack,
      removeTrack,
      clearSelection,
      isSelected,
      currentBlend,
      setCurrentBlend,
      updateBlend,
      ratingOf,
      setRating,
      ratingsVersion,
      resetAllRatings,
      recentBlends,
      refreshBlends,
      removeBlend,
      searchCatalog,
      generating,
      generatingStatus,
      generate,
      tasteVersion,
      bumpTaste,
    }),
    [
      settings, saveSettings, isAuthenticated, userProfile, login, logout, playlists, loadingLibrary,
      libraryError, loadLibrary, loadPlaylistTracks, refreshLibrary, selectedTracks, toggleTrack,
      removeTrack, clearSelection, isSelected, currentBlend, setCurrentBlend, updateBlend,
      recentBlends, refreshBlends, removeBlend, generating, generatingStatus, generate, tasteVersion, bumpTaste, resetAllRatings,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
};
