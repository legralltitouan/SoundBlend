import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Download, X, Share } from 'lucide-react';
import { useInstall, installPossible } from '../../lib/pwa';
import { useUI } from '../../context/UIContext';

/* ═══════════════════════════════════════════════════════════════
   L'invitation à installer.

   Elle ne s'affiche que sur un téléphone, une seule fois, et seulement
   si l'installation est réellement possible. Elle ne bloque rien : elle
   est posée au-dessus de la barre de lecture, se referme d'un geste, et
   ne revient plus une fois écartée. Sur ordinateur, on passe par les
   réglages — pas de bandeau qui vient interrompre l'écoute.
   ═══════════════════════════════════════════════════════════════ */

const SEEN_KEY = 'soundblend_install_seen';
const isPhone = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(max-width: 780px)').matches;

export const InstallBanner: React.FC = () => {
  const { onboarded } = useUI();
  const pwa = useInstall();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!onboarded || pwa.installed || pwa.dismissed) return;
    if (!isPhone() || !installPossible()) return;
    /* on ne propose que ce qui peut aboutir : sur iPhone les gestes,
       ailleurs le prompt du navigateur — s'il n'existe pas, on se tait */
    if (pwa.platform !== 'ios' && !pwa.canInstall) return;
    /* on laisse la personne atterrir, puis on propose une fois */
    const t = window.setTimeout(() => {
      let seen = false;
      try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
      if (!seen) setOpen(true);
    }, 2600);
    return () => window.clearTimeout(t);
  }, [onboarded, pwa.installed, pwa.dismissed, pwa.canInstall, pwa.platform]);

  const close = (markSeen: boolean) => {
    setOpen(false);
    if (markSeen) {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
      pwa.dismiss();
    }
  };

  if (pwa.platform === 'ios') {
    /* Safari n'offre pas de bouton : on montre le geste, on ne promet pas
       un clic qui ne ferait rien */
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            className="sb-install-banner"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="sb-install-icon"><Share size={16} /></span>
            <div className="sb-install-copy">
              <b>Garde SoundBlend sur ton iPhone</b>
              <span>Partager, puis « Sur l’écran d’accueil ».</span>
            </div>
            <button className="sb-install-x" aria-label="Plus tard" onClick={() => close(true)}>
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sb-install-banner"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="sb-install-icon"><Download size={16} /></span>
          <div className="sb-install-copy">
            <b>Installer SoundBlend</b>
            <span>Une icône, plein écran, sans barre d’adresse.</span>
          </div>
          <button
            className="sb-install-go"
            onClick={async () => {
              const r = await pwa.install();
              if (r !== 'unavailable') close(true);
            }}
          >
            Installer
          </button>
          <button className="sb-install-x" aria-label="Plus tard" onClick={() => close(true)}>
            <X size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default InstallBanner;
