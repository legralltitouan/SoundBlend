import React, { useCallback, useEffect, useState } from 'react';
import { useUI } from '../../context/UIContext';
import { usePlayer } from '../../context/PlayerContext';
import { useAndroidBack, type BackLayer } from '../../lib/useAndroidBack';
import { BACK_HOME_EVENT } from '../../lib/backEvents';

/* ═══════════════════════════════════════════════════════════════
   Branchement du bouton retour du téléphone.

   Il ne fait rien d'autre que dire à `useAndroidBack` ce qui est
   ouvert et comment le refermer. Toute la logique est dans le hook.
   ═══════════════════════════════════════════════════════════════ */

export const BackHandler: React.FC = () => {
  const { view, setView, modal, closeModal, onboarded, finishOnboarding } = useUI();
  const { isVideoOpen, toggleVideoModal } = usePlayer();

  /* le plein écran du lecteur : il vit dans son propre composant, donc
     il nous dit simplement s'il est ouvert par un attribut du document.
     C'est laid, mais ça évite de faire passer un état à travers trois
     contextes pour une seule information. */
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    const read = () => setSheetOpen(!!document.querySelector('.nowplaying'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  const closeSheet = useCallback(() => {
    /* le bouton « réduire » de la feuille : c'est lui qui sait l'animer */
    const btn = document.querySelector('.nowplaying-top .icon-btn') as HTMLElement | null;
    btn?.click();
  }, []);

  /* de la plus profonde à la plus haute — l'ordre compte : le retour
     ferme la dernière. Le plein écran du lecteur passe au-dessus de
     tout (il est rendu après les fenêtres, et à un z-index plus haut) :
     c'est donc lui la couche du dessus quand il est ouvert. */
  const layers: BackLayer[] = [];
  if (modal) layers.push({ key: 'modal', close: closeModal });
  if (isVideoOpen) layers.push({ key: 'video', close: toggleVideoModal });
  if (sheetOpen) layers.push({ key: 'sheet', close: closeSheet });
  /* l'accueil de bienvenue n'est pas une couche : c'est le premier écran,
     le retour n'a pas de sens avant d'être entré dans l'app */

  const atHome = view === 'library';

  useAndroidBack(atHome, layers);

  /* le retour demandé alors qu'on est sur une autre page : retour accueil */
  useEffect(() => {
    const onHome = () => setView('library');
    window.addEventListener(BACK_HOME_EVENT, onHome);
    return () => window.removeEventListener(BACK_HOME_EVENT, onHome);
  }, [setView]);

  /* la bienvenue : on ne propose pas de retour, mais si la personne
     appuie, on considère qu'elle entre (sinon elle reste coincée) */
  useEffect(() => {
    if (onboarded) return;
    const onHome = () => finishOnboarding();
    window.addEventListener(BACK_HOME_EVENT, onHome);
    return () => window.removeEventListener(BACK_HOME_EVENT, onHome);
  }, [onboarded, finishOnboarding]);

  return null;
};
