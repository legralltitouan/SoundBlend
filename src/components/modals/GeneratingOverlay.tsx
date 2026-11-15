import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { OrganicBlob } from '../ui/OrganicBlob';

/* ═══════════════════════════════════════════════════════════════
   Écran de composition.

   Une sphère organique : six nappes de couleur qui avancent en file,
   respirent chacune à son tour et suivent la trajectoire en huit du mode
   Chargement de la référence. Le grain est cuit dans la forme par le filtre
   de pigment. Le texte reste lisible au bas de l’écran, sans anneau ni barre.

   Les phrases techniques du moteur (« quota », « basculement ») ne
   sortent jamais à l'écran : on raconte la composition, pas le réseau.
   ═══════════════════════════════════════════════════════════════ */

const STEPS = [
  'Lecture de l’empreinte sonore des amorces',
  'Parcours des discographies et des faces B',
  'Recherche d’artistes à la même texture',
  'Équilibrage du tempo et des tonalités',
  'Assemblage final du blend',
];

export const GeneratingOverlay: React.FC = () => {
  const { mode } = useUI();
  const { generating, generatingStatus } = useData();
  /* ── ne jamais rester par-dessus le blend ──
     `modal === 'generating'` est posé par l'écran de configuration, et
     c'est ce même écran qui le retire quand la génération rend la main.
     Mais quand elle échoue, le `catch` affiche un message et s'arrête
     là : le modal restait ouvert, plein écran, par-dessus le blend qu'on
     venait de composer. L'écran de composition ne s'affiche donc que
     pendant que le moteur travaille réellement. */
  const open = generating;
  const dark = mode === 'dark';
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);

  const friendly = useMemo(() => {
    if (!generatingStatus) return STEPS[step];
    /* Ce qui compte, c'est que la personne voie POURQUOI ça bloque :
       « Analyse impossible — clé Gemini refusée (403)… » est justement
       la phrase utile. On ne masque donc plus que les notes purement
       internes (basculement d'un modèle à l'autre, quota atteint côté
       YouTube), pas les diagnostics de la clé. */
    const interne = /basculement|tentative|fallback/i.test(generatingStatus);
    const diagnostic = /clé Gemini|quota Gemini|Analyse impossible|Aucune (face|découverte|pilier)/i.test(generatingStatus);
    return interne && !diagnostic ? STEPS[step] : generatingStatus.replace(/…$/, '');
  }, [generatingStatus, step]);

  useEffect(() => {
    if (!open) { setStep(0); return; }
    const t = window.setInterval(() => setStep((s) => (s < STEPS.length - 1 ? s + 1 : s)), 2600);
    return () => window.clearInterval(t);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sb-gen"
          data-mode={dark ? 'dark' : 'light'}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <OrganicBlob mode={dark ? 'dark' : 'light'} movement="chargement" />
          <div className="sb-gen-caption" role="status" aria-live="polite">
            <div className="sb-gen-caption-title">Composition en cours</div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={friendly} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: .82, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={{ duration: reduced ? 0 : .35 }}>
                {friendly}
              </motion.p>
            </AnimatePresence>
          </div>
        </motion.div>

      )}
    </AnimatePresence>
  );
};

export default GeneratingOverlay;
