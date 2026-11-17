import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { Track } from '../types';
import type { Design, Mode } from './prefs';
import { getDesign, getMode, applyTheme, choisirMode } from './prefs';

type ViewName = 'library' | 'blend' | 'history' | 'assistant' | 'settings';
type ModalName =
  | 'picker'
  | 'config'
  | 'generating'
  | 'taste'
  | 'history'
  | 'settings'
  | 'account'
  | null;

/** Les feuilles d'action passent aussi au-dessus du lecteur plein écran. */
export type ActionSheet =
  | { kind: 'block'; track: Track }
  | { kind: 'exclusions'; focusSearch: boolean };
type ActiveActionSheet = ActionSheet & { instance: number };

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

  actionSheet: ActiveActionSheet | null;
  openActionSheet: (sheet: ActionSheet, opener?: HTMLElement | null) => void;
  closeActionSheet: () => void;

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
  const [actionSheet, setActionSheet] = useState<ActiveActionSheet | null>(null);
  const sheetIsOpen = useRef(false);
  const sheetSerial = useRef(0);
  const sheetOpener = useRef<HTMLElement | null>(null);
  const openActionSheet = useCallback((sheet: ActionSheet, opener?: HTMLElement | null) => {
    if (!sheetIsOpen.current) {
      sheetOpener.current = opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    sheetIsOpen.current = true;
    // Chaque ouverture est une nouvelle instance, même si une sortie est
    // encore animée : son état et son focus ne doivent jamais être recyclés.
    setActionSheet({ ...sheet, instance: ++sheetSerial.current });
  }, []);
  const closeActionSheet = useCallback(() => {
    if (!sheetIsOpen.current) return;
    sheetIsOpen.current = false;
    setActionSheet(null);
    const opener = sheetOpener.current;
    sheetOpener.current = null;
    // À la fermeture (y compris retour système), revenir au bouton d'origine.
    requestAnimationFrame(() => { if (!sheetIsOpen.current && opener?.isConnected) opener.focus({ preventScroll: true }); });
  }, []);
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

  // Échap ferme d'abord la feuille au premier plan, jamais celle derrière.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (sheetIsOpen.current) {
        e.preventDefault();
        closeActionSheet();
      } else setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeActionSheet]);

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

  // Les deux niveaux partagent le verrou : fermer l'un ne libère pas l'autre.
  useEffect(() => {
    document.body.style.overflow = modal || actionSheet ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [modal, actionSheet]);

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
      setMode: (m) => { choisirMode(m); setModeState(m); },
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
      actionSheet,
      openActionSheet,
      closeActionSheet,
      toast,
      showToast,
      task,
      setTask,
      onboarded,
      finishOnboarding,
      restartOnboarding,
    }),
    [design, mode, view, modal, modalData, actionSheet, openActionSheet, closeActionSheet, toast, setView, showToast, task, onboarded, finishOnboarding, restartOnboarding],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within UIProvider');
  return ctx;
};

export type { ViewName };
