import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { Design, Mode } from './prefs';
import { getDesign, getMode, applyTheme, choisirMode } from './prefs';

type ViewName = 'library' | 'blend' | 'history' | 'taste' | 'settings';
type ModalName =
  | 'picker'
  | 'config'
  | 'generating'
  | 'taste'
  | 'history'
  | 'settings'
  | 'account'
  | null;

interface UIContextType {
  design: Design;
  mode: Mode;
  setMode: (m: Mode) => void;
  toggleMode: () => void;

  view: ViewName;
  setView: (v: ViewName) => void;

  modal: ModalName;
  modalData: any;
  openModal: (name: Exclude<ModalName, null>, data?: any) => void;
  closeModal: () => void;

  toast: string | null;
  showToast: (msg: string) => void;

  /* Une tâche qui prend du temps (recherche IA…) se raconte dans un petit
     bandeau discret, avec un texte qui avance : on sait où on en est. */
  task: string | null;
  setTask: (msg: string | null) => void;

  /* accueil de première visite */
  onboarded: boolean;
  finishOnboarding: () => void;
  restartOnboarding: () => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [design, setDesignState] = useState<Design>(getDesign);
  const [mode, setModeState] = useState<Mode>(getMode);
  const [view, setViewState] = useState<ViewName>('library');
  const [modal, setModal] = useState<ModalName>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<boolean>(() => {
    try { return localStorage.getItem('soundblend_onboarded') === '1'; } catch { return false; }
  });

  const finishOnboarding = useCallback(() => {
    setOnboarded(true);
    try { localStorage.setItem('soundblend_onboarded', '1'); } catch { /* ignore */ }
  }, []);

  const restartOnboarding = useCallback(() => {
    setOnboarded(false);
    try { localStorage.removeItem('soundblend_onboarded'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    applyTheme(design, mode);
  }, [design, mode]);

  // Échap ferme la modale ouverte
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* une synchro vient d'apporter un mode (ou des goûts) : l'écran se
     remet à l'heure sans qu'on ait à recharger */
  useEffect(() => {
    const onSync = () => {
      setModeState(getMode());
      setDesignState(getDesign());
    };
    window.addEventListener('sb:sync-applied', onSync);
    return () => window.removeEventListener('sb:sync-applied', onSync);
  }, []);

  // verrouille le scroll quand une modale est ouverte
  useEffect(() => {
    document.body.style.overflow = modal ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [modal]);

  const [task, setTask] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  const setView = useCallback((v: ViewName) => {
    setViewState(v);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const value = useMemo<UIContextType>(
    () => ({
      design,
      mode,
      setMode: setModeState,
      /* l'interrupteur, c'est un choix : il est daté (voir prefs.ts) pour
         que la synchro sache à qui obéir entre deux appareils */
      toggleMode: () => setModeState((m) => {
        const next = m === 'light' ? 'dark' : 'light';
        choisirMode(next);
        return next;
      }),
      view,
      setView,
      modal,
      modalData,
      openModal: (name, data) => {
        setModalData(data ?? null);
        setModal(name);
      },
      closeModal: () => setModal(null),
      toast,
      showToast,
      task,
      setTask,
      onboarded,
      finishOnboarding,
      restartOnboarding,
    }),
    [design, mode, view, modal, modalData, toast, setView, showToast, task, onboarded, finishOnboarding, restartOnboarding],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
};

export type { ViewName };
