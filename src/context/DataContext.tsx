import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Playlist, Track, GeneratedBlend, BlendConfig, AppSettings, UserProfile, Exclusions } from '../types';
import { sameTrack, trackKey } from '../lib/track';
import { clientIdGoogle } from '../config/app';
import { youtubeService } from '../services/youtube';
import { geminiService } from '../services/gemini';
import { uniqueTracks } from '../lib/dedupe';
import {
  getStoredSettings, saveStoredSettings, getStoredBlends, saveBlendToStorage, deleteStoredBlend,
  getExclusions, block, unblock, isExcluded, isRecentlyProposed, recordDiscoveries,
  migrateLegacyData, learnDiscoveriesFromBlends,
} from '../services/storage';
import { MOCK_PLAYLISTS } from '../data/mockData';
import { demarrerSync, oublierSync, planifierEnvoi, surveillerExpirations, surEtatSync, type EtatSync } from '../services/drive';

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
  /** Derniers messages réellement émis pendant cette génération. */
  generatingLog: string[];
  generate: (config: BlendConfig, options?: { seeds?: Track[] }) => Promise<GeneratedBlend | null>;

  exclusions: Exclusions;
  blockTrack: (track: { title?: string; artist?: string; videoId?: string }, kind: 'track' | 'artist') => void;
  unblockExclusion: (id: string) => void;

  /* ── la synchro (Drive du compte connecté) ──
     Elle ne demande rien : connecté, elle existe ; déconnecté, elle dort. */
  syncState: EtatSync;
  syncNow: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  migrateLegacyData();
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
  const [generatingLog, setGeneratingLog] = useState<string[]>([]);
  const [exclusions, setExclusions] = useState<Exclusions>(getExclusions);
  const blockTrack = useCallback((track: { title?: string; artist?: string; videoId?: string }, kind: 'track' | 'artist') => {
    block(track, kind);
    setExclusions(getExclusions());
    setSelectedTracks((prev) => prev.filter((t) => !isExcluded(t)));
  }, []);
  const unblockExclusion = useCallback((id: string) => {
    unblock(id);
    setExclusions(getExclusions());
  }, []);

  /* ── la synchro ──
     Trois moments comptent : à la connexion (on récupère), après chaque
     geste qui change les goûts (on renvoie, avec quatre secondes de
     calme), et à la déconnexion (on oublie le fichier — il reste sur le
     compte, mais cet appareil n'y touche plus). */
  const [syncState, setSyncState] = useState<EtatSync>({ phase: 'inactif' });

  useEffect(() => surEtatSync(setSyncState), []);

  const syncNow = useCallback(async () => { await demarrerSync(); }, []);

  // Aussi pour les synchronisations en arrière-plan et les expirations.
  useEffect(() => {
    learnDiscoveriesFromBlends(getStoredBlends());
    surveillerExpirations();
    const onSync = () => {
      const blends = getStoredBlends();
      setRecentBlends(blends);
      setSettings(getStoredSettings());
      setExclusions(getExclusions());
      setSelectedTracks((prev) => prev.filter((t) => !isExcluded(t)));
      setCurrentBlendState((current) => current ? (blends.find((b) => b.id === current.id) || null) : null);
    };
    window.addEventListener('sb:sync-applied', onSync);
    return () => window.removeEventListener('sb:sync-applied', onSync);
  }, []);

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
      /* une réponse YouTube tordue ne doit pas vider l'accueil : on
         teste sur une chaîne, jamais sur un champ supposé */
      const looksLikeDemo = userPlaylists.some((p) => String(p?.id || '').startsWith('demo-pl-'));
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
      if (!youtubeService.isAuthenticated()) { setIsAuthenticated(false); setUserProfile(null); }
    } finally {
      loadingRef.current = false;
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    /* l'ID vient du code (`config/app.ts`) ; celui d'une ancienne version
       enregistrée dans le navigateur sert de secours */
    const idClient = clientIdGoogle(settings.googleClientId);
    if (idClient) youtubeService.initOAuth(idClient);
    // l'avatar du compte doit apparaître même si la bibliothèque ne répond pas
    if (youtubeService.isAuthenticated()) {
      setIsAuthenticated(true);
      const p = youtubeService.getUserProfile();
      if (p) setUserProfile(p);
    }
    loadLibrary();
    /* un compte déjà connecté (jeton encore valide) : la synchro reprend
       sans qu'on demande quoi que ce soit */
    if (youtubeService.isAuthenticated()) void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.googleClientId]);

  // Un seul canal pour exclusions, découvertes, blends et choix du thème.
  useEffect(() => {
    const onLocal = () => planifierEnvoi();
    window.addEventListener('sb:data-changed', onLocal);
    return () => window.removeEventListener('sb:data-changed', onLocal);
  }, []);

  const refreshLibrary = useCallback(async () => {
    await loadLibrary();
  }, [loadLibrary]);

  const loadPlaylistTracks = useCallback(async (playlistId: string): Promise<Track[]> => {
    // L'échec reste distinct d'une playlist réellement vide : chaque vue
    // peut l'expliquer et proposer un nouvel essai.
    const tracks = await youtubeService.fetchPlaylistTracks(playlistId);
    setPlaylists((prev) => prev.map((pl) => (pl.id === playlistId ? { ...pl, tracks } : pl)));
    return tracks;
  }, []);

  const login = useCallback(async () => {
    await youtubeService.login(clientIdGoogle(settings.googleClientId));
    setIsAuthenticated(true);
    setUserProfile(youtubeService.getUserProfile());
    await loadLibrary();
    /* le compte est connu : on va chercher ce que les autres appareils
       ont laissé, puis on renvoie l'ensemble */
    void syncNow();
  }, [settings.googleClientId, loadLibrary, syncNow]);

  const logout = useCallback(() => {
    youtubeService.logout();
    oublierSync();
    setIsAuthenticated(false);
    setUserProfile(null);
    setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p })));
    setSelectedTracks([]);
  }, []);

  const saveSettings = useCallback((s: AppSettings) => {
    saveStoredSettings(s);
    setSettings(s);
    planifierEnvoi();
  }, []);

  /* un morceau est identifié par son videoId, pas par son id : le même
     titre retrouvé dans une autre playlist reste coché */
  const toggleTrack = useCallback((track: Track) => {
    if (isExcluded(track)) return;
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
    const saved = saveBlendToStorage(b);
    setCurrentBlendState(saved);
    setRecentBlends(getStoredBlends());
  }, []);

  const refreshBlends = useCallback(() => setRecentBlends(getStoredBlends()), []);

  const searchCatalog = useCallback(async (q: string) => {
    const result = await youtubeService.searchTracks(q, 20);
    return { ...result, tracks: result.tracks.filter((t) => !isExcluded(t)) };
  }, []);

  const removeBlend = useCallback((id: string) => {
    deleteStoredBlend(id);
    setRecentBlends(getStoredBlends());
    setCurrentBlendState((current) => current?.id === id ? null : current);
  }, []);

  const generate = useCallback(
    async (config: BlendConfig, options?: { seeds?: Track[] }): Promise<GeneratedBlend | null> => {
      const requested = options?.seeds ?? selectedTracks;
      if (!requested.length) return null;
      const seeds = uniqueTracks(requested.filter((t) => !isExcluded(t)));
      if (!seeds.length) throw new Error('Toutes les amorces choisies sont bloquées. Modifie les exclusions dans Réglages.');
      setGenerating(true);
      /* Certains messages se suivent dans le même tour JavaScript (par
         exemple « aucune clé » puis « vérification YouTube »). L'état
         courant seul perdrait le premier lors du regroupement React : on
         garde aussi les 50 derniers messages effectivement reçus. */
      setGeneratingLog([]);
      const report = (msg: string) => {
        setGeneratingStatus(msg);
        setGeneratingLog((prev) => prev.at(-1) === msg ? prev : [...prev.slice(-49), msg]);
      };
      report('Analyse de l’empreinte musicale des morceaux sélectionnés…');
      try {
        const generatedTracks = await geminiService.generateBlend(
          seeds, config, getExclusions(), report,
        );
        // Dernier verrou : l'utilisateur peut bloquer un titre pendant une recherche.
        // Les amorces explicitement choisies restent possibles, même si récentes.
        const tracks = uniqueTracks(generatedTracks).filter((t) => !isExcluded(t)
          && (t.category === 'anchor' || !isRecentlyProposed(t)));
        if (!tracks.length) throw new Error('Aucun titre disponible après application des exclusions et de l’historique.');
        const now = new Date();
        const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const artists = Array.from(new Set(seeds.map((t) => t.artist))).slice(0, 2);
        const name = artists.length >= 2 ? `${artists[0]}, ${artists[1]} & co.` : artists[0] ? `Autour de ${artists[0]}` : 'Nouveau blend';
        const blend: GeneratedBlend = {
          id: `blend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: name,
          description: `Blend généré à partir de ${seeds.length} titre${seeds.length > 1 ? 's' : ''} d’amorce`,
          createdAt: now.toISOString(), expiresAt: expires.toISOString(), seedTracks: seeds, tracks,
          instruction: config.instruction?.trim() || undefined,
          methode: { kind: geminiService.derniereMethode, model: geminiService.dernierModele || undefined, detail: geminiService.derniereNote },
        };
        recordDiscoveries(tracks, now.getTime());
        const saved = saveBlendToStorage(blend);
        setRecentBlends(getStoredBlends());
        setCurrentBlendState(saved);
        if (!options?.seeds) setSelectedTracks([]);
        return saved;
      } catch (e: any) {
        throw new Error(e?.message || 'La génération a échoué.');
      } finally { setGenerating(false); }
    }, [selectedTracks],
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
      exclusions,
      blockTrack,
      unblockExclusion,
      recentBlends,
      refreshBlends,
      removeBlend,
      searchCatalog,
      generating,
      generatingStatus,
      generatingLog,
      generate,
      syncState,
      syncNow,
    }),
    [
      settings, saveSettings, isAuthenticated, userProfile, login, logout, playlists, loadingLibrary,
      libraryError, loadLibrary, loadPlaylistTracks, refreshLibrary, selectedTracks, toggleTrack,
      removeTrack, clearSelection, isSelected, currentBlend, setCurrentBlend, updateBlend,
      recentBlends, refreshBlends, removeBlend, generating, generatingStatus, generatingLog, generate, exclusions, blockTrack, unblockExclusion,
      syncState, syncNow,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
};
