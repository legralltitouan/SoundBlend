import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Playlist, Track, GeneratedBlend, BlendConfig, AppSettings, UserProfile, Exclusions } from '../types';
import { sameTrack, trackKey } from '../lib/track';
import { clientIdGoogle } from '../config/app';
import { youtubeService } from '../services/youtube';
import { accountRevision, assertAccountRevision } from '../services/accountScope';
import { geminiService } from '../services/gemini';
import { uniqueTracks } from '../lib/dedupe';
import {
  getStoredSettings, saveStoredSettings, getStoredBlends, saveBlendToStorage, deleteStoredBlend,
  getExclusions, block, unblock, isExcluded, isRecentlyProposed, recordDiscoveries,
  migrateLegacyData, learnDiscoveriesFromBlends,
} from '../services/storage';
import { MOCK_PLAYLISTS } from '../data/mockData';
import { demarrerSync, planifierEnvoi, surveillerExpirations, surEtatSync, type EtatSync } from '../services/drive';

interface DataContextType {
  settings: AppSettings;
  saveSettings: (s: AppSettings) => void;

  isAuthenticated: boolean;
  accountKnown: boolean;
  authReady: boolean;
  authNotice: string;
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
  const [accountKnown, setAccountKnown] = useState<boolean>(() => !!youtubeService.accountId());
  const [authReady, setAuthReady] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => youtubeService.getUserProfile());

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState<boolean>(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [currentBlend, setCurrentBlendState] = useState<GeneratedBlend | null>(null);
  const [recentBlends, setRecentBlends] = useState<GeneratedBlend[]>(getStoredBlends);

  const [generating, setGenerating] = useState(false);
  const generationInProgress = useRef<symbol | null>(null);
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
  const [syncState, setSyncState] = useState<EtatSync>({ phase: 'inactif', enAttente: false });

  useEffect(() => surEtatSync(setSyncState), []);

  const syncNow = useCallback(async () => { await demarrerSync(); }, []);

  // Aussi pour les synchronisations en arrière-plan et les expirations.
  useEffect(() => {
    try { learnDiscoveriesFromBlends(getStoredBlends()); } catch { /* le diagnostic de stockage apparaît lors de l'action ou de la synchro */ }
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

  const libraryRequest = useRef(0);

  // Les vues et toutes les opérations en vol repartent à zéro si le compte
  // change ; les données de l'ancien compte restent dans son propre espace.
  useEffect(() => {
    const onAccount = () => {
      libraryRequest.current++;
      migrateLegacyData();
      setSettings(getStoredSettings()); setRecentBlends(getStoredBlends()); setExclusions(getExclusions());
      setSelectedTracks([]); setCurrentBlendState(null);
      setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p }))); setLibraryError(null); setLoadingLibrary(false);
      generationInProgress.current = null;
      setGenerating(false); setGeneratingStatus(''); setGeneratingLog([]);
      setIsAuthenticated(youtubeService.isAuthenticated()); setAccountKnown(!!youtubeService.accountId());
      setUserProfile(youtubeService.getUserProfile()); setAuthNotice('');
      surveillerExpirations();
    };
    const onAuth = () => {
      setIsAuthenticated(youtubeService.isAuthenticated()); setAccountKnown(!!youtubeService.accountId());
      setUserProfile(youtubeService.getUserProfile());
    };
    const onExpired = () => {
      libraryRequest.current++; setLoadingLibrary(false); onAuth();
      setAuthNotice('Session Google expirée. Reconnecte ce compte pour reprendre les envois en attente.');
    };
    window.addEventListener('sb:account-changed', onAccount);
    window.addEventListener('sb:auth-changed', onAuth);
    window.addEventListener('sb:auth-expired', onExpired);
    return () => {
      window.removeEventListener('sb:account-changed', onAccount);
      window.removeEventListener('sb:auth-changed', onAuth);
      window.removeEventListener('sb:auth-expired', onExpired);
    };
  }, []);

  const loadLibrary = useCallback(async () => {
    const request = ++libraryRequest.current;
    const revision = accountRevision(), serial = youtubeService.sessionRevision();
    const current = () => request === libraryRequest.current && revision === accountRevision() && serial === youtubeService.sessionRevision();
    setLoadingLibrary(true); setLibraryError(null);
    try {
      if (!youtubeService.isAuthenticated()) {
        if (current()) { setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p }))); setIsAuthenticated(false); }
        return;
      }
      const userPlaylists = await youtubeService.fetchPlaylists();
      if (!current()) return;
      const looksLikeDemo = userPlaylists.some((p) => String(p?.id || '').startsWith('demo-pl-'));
      if (looksLikeDemo) setLibraryError("YouTube n'a renvoyé aucune playlist pour ce compte. Vérifie le compte choisi lors de la connexion.");
      setPlaylists(userPlaylists);
      userPlaylists.slice(0, 6).forEach((pl, i) => {
        setTimeout(() => {
          if (!current()) return;
          youtubeService.fetchPlaylistTracks(pl.id).then((tracks) => {
            if (!current() || !tracks.length) return;
            setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? { ...p, tracks } : p)));
          }).catch(() => {});
        }, i * 180);
      });
    } catch (e: any) {
      if (!current()) return;
      setLibraryError(e?.message || 'Impossible de lire la bibliothèque YouTube.');
      setPlaylists(MOCK_PLAYLISTS.map((p) => ({ ...p })));
      if (!youtubeService.isAuthenticated()) setIsAuthenticated(false);
    } finally { if (current()) setLoadingLibrary(false); }
  }, []);

  useEffect(() => {
    let active = true;
    const idClient = clientIdGoogle(settings.googleClientId);
    if (idClient) void youtubeService.initOAuth(idClient);
    const start = async () => {
      await youtubeService.restoreLegacySession();
      if (!active) return;
      setIsAuthenticated(youtubeService.isAuthenticated()); setAccountKnown(!!youtubeService.accountId());
      setUserProfile(youtubeService.getUserProfile()); setAuthNotice(youtubeService.getRestoreWarning()); setAuthReady(true);
      void loadLibrary();
      if (youtubeService.isAuthenticated()) void syncNow();
    };
    void start();
    return () => { active = false; };
  }, [settings.googleClientId, loadLibrary, syncNow]);

  // Aussi pour les changements faits sur cet appareil sans passer par une vue.
  useEffect(() => {
    const onLocal = () => planifierEnvoi();
    window.addEventListener('sb:data-changed', onLocal);
    return () => window.removeEventListener('sb:data-changed', onLocal);
  }, []);

  const refreshLibrary = useCallback(async () => { await loadLibrary(); }, [loadLibrary]);
  const loadPlaylistTracks = useCallback(async (playlistId: string): Promise<Track[]> => {
    const revision = accountRevision(), serial = youtubeService.sessionRevision();
    const tracks = await youtubeService.fetchPlaylistTracks(playlistId);
    assertAccountRevision(revision);
    if (serial !== youtubeService.sessionRevision()) throw new Error('La session Google a changé pendant la lecture de la playlist.');
    setPlaylists((prev) => prev.map((pl) => (pl.id === playlistId ? { ...pl, tracks } : pl)));
    return tracks;
  }, []);

  const login = useCallback(async () => {
    await youtubeService.login(clientIdGoogle(settings.googleClientId));
    setAuthNotice(''); setIsAuthenticated(true); setAccountKnown(true); setUserProfile(youtubeService.getUserProfile());
    void syncNow();
    await loadLibrary();
  }, [settings.googleClientId, loadLibrary, syncNow]);
  const logout = useCallback(() => { youtubeService.logout(); }, []);

  const saveSettings = useCallback((s: AppSettings) => {
    saveStoredSettings(s);
    setSettings(s);
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
    const revision = accountRevision();
    const result = await youtubeService.searchTracks(q, 20);
    assertAccountRevision(revision);
    return { ...result, tracks: result.tracks.filter((t) => !isExcluded(t)) };
  }, []);

  const removeBlend = useCallback((id: string) => {
    deleteStoredBlend(id);
    setRecentBlends(getStoredBlends());
    setCurrentBlendState((current) => current?.id === id ? null : current);
  }, []);

  const generate = useCallback(
    async (config: BlendConfig, options?: { seeds?: Track[] }): Promise<GeneratedBlend | null> => {
      const revision = accountRevision();
      const requested = options?.seeds ?? selectedTracks;
      if (!requested.length) return null;
      const seeds = uniqueTracks(requested.filter((t) => !isExcluded(t)));
      if (!seeds.length) throw new Error('Toutes les amorces choisies sont bloquées. Modifie les exclusions dans Réglages.');
      if (generationInProgress.current) throw new Error('Une génération est déjà en cours.');
      const generationToken = Symbol('generation'); generationInProgress.current = generationToken;
      setGenerating(true);
      /* Certains messages se suivent dans le même tour JavaScript (par
         exemple « aucune clé » puis « vérification YouTube »). L'état
         courant seul perdrait le premier lors du regroupement React : on
         garde aussi les 50 derniers messages effectivement reçus. */
      setGeneratingLog([]);
      const report = (msg: string) => {
        assertAccountRevision(revision);
        setGeneratingStatus(msg);
        setGeneratingLog((prev) => prev.at(-1) === msg ? prev : [...prev.slice(-49), msg]);
      };
      report('Analyse de l’empreinte musicale des morceaux sélectionnés…');
      try {
        const generatedTracks = await geminiService.generateBlend(
          seeds, config, getExclusions(), report,
        );
        assertAccountRevision(revision);
        // Dernier verrou : l'utilisateur peut bloquer un titre pendant une recherche.
        // Les amorces explicitement choisies restent possibles, même si récentes.
        const tracks = uniqueTracks(generatedTracks).filter((t) => !isExcluded(t)
          && (t.category === 'anchor' || !isRecentlyProposed(t)));
        const generationReport = geminiService.dernierRapport;
        if (!tracks.length) throw new Error(`Aucun titre admissible n’a pu être conservé.${generationReport?.warning ? ` ${generationReport.warning}` : ''}`);
        const now = new Date();
        const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        const artists = Array.from(new Set(seeds.map((t) => t.artist))).slice(0, 2);
        const name = artists.length >= 2 ? `${artists[0]}, ${artists[1]} & co.` : artists[0] ? `Autour de ${artists[0]}` : 'Nouveau blend';
        const actual = { anchor: tracks.filter((t) => t.category === 'anchor').length,
          deepDive: tracks.filter((t) => t.category === 'deep_dive').length,
          fresh: tracks.filter((t) => t.category === 'fresh').length };
        const beforeFinal = generationReport
          ? generationReport.created.anchor + generationReport.created.deepDive + generationReport.created.fresh : 0;
        const removedFinal = Math.max(0, beforeFinal - tracks.length);
        const finalWarning = generationReport && removedFinal
          ? `Avant le contrôle final : ${generationReport.warning || `sélection de ${beforeFinal}/${generationReport.target} titres.`} `
            + `Contrôle final : ${tracks.length}/${generationReport.target} titres enregistrés (${actual.anchor} piliers, ${actual.deepDive} faces cachées, ${actual.fresh} découvertes). `
            + `${removedFinal} titre${removedFinal > 1 ? 's ont été écartés' : ' a été écarté'} après contrôle des exclusions, de l’historique et des doublons.`
          : generationReport?.warning;
        const generation = generationReport ? { ...generationReport, created: actual, warning: finalWarning || '',
          ...(removedFinal && !generationReport.cause ? { cause: 'other' as const } : {}) } : undefined;
        const blend: GeneratedBlend = {
          id: `blend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: name,
          description: `Blend généré à partir de ${seeds.length} titre${seeds.length > 1 ? 's' : ''} d’amorce`,
          createdAt: now.toISOString(), expiresAt: expires.toISOString(), seedTracks: seeds, tracks,
          instruction: config.instruction?.trim() || undefined,
          methode: { kind: geminiService.derniereMethode, model: geminiService.dernierModele || undefined, detail: geminiService.derniereNote },
          generation,
        };
        recordDiscoveries(tracks, now.getTime());
        const saved = saveBlendToStorage(blend);
        setRecentBlends(getStoredBlends());
        setCurrentBlendState(saved);
        if (!options?.seeds) setSelectedTracks([]);
        return saved;
      } catch (e: any) {
        throw new Error(e?.message || 'La génération a échoué.');
      } finally {
        if (generationInProgress.current === generationToken) generationInProgress.current = null;
        if (accountRevision() === revision) setGenerating(false);
      }
    }, [selectedTracks],
  );

  const value = useMemo<DataContextType>(
    () => ({
      settings,
      saveSettings,
      isAuthenticated,
      accountKnown,
      authReady,
      authNotice,
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
      settings, saveSettings, isAuthenticated, accountKnown, authReady, authNotice, userProfile, login, logout, playlists, loadingLibrary,
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
