import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { OrganicBlob } from '../ui/OrganicBlob';

/* ═══════════════════════════════════════════════════════════════
   Écran de composition.

   Une sphère organique : six nappes de couleur qui avancent en file,
   respirent chacune à son tour et nagent vers un point au hasard. Le
   grain est cuit dans la forme par le filtre de pigment — les bords sont
   déplacés par un bruit fractal, jamais lisses. Le texte est posé net
   au milieu. Rien d'autre — ni anneau, ni barre, ni compteur.

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
  const { modal, mode } = useUI();
  const { generating, generatingStatus } = useData();
  const open = modal === 'generating' || generating;
  const dark = mode === 'dark';
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <OrganicBlob mode={dark ? 'dark' : 'light'} />
          {/* le voile de lecture, entre la sphère et le texte */}
          <span className="sb-gen-veil" aria-hidden />

          <div className="sb-gen-content">
            <motion.div
              className="sb-gen-eyebrow"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
            >
              <span className="sb-gen-dot" />
              SoundBlend compose
            </motion.div>

            <motion.h2
              className="sb-gen-title"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
              Composition en cours
            </motion.h2>

            <div className="sb-gen-line">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={friendly}
                  initial={{ opacity: 0, y: 7 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -7 }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                >
                  {friendly}
                </motion.p>
              </AnimatePresence>
            </div>

            {/* cinq traits : celui qu'on vit est plein */}
            <div className="sb-gen-ticks" aria-hidden>
              {STEPS.map((_, i) => (
                <motion.span
                  key={i}
                  animate={{ opacity: i <= step ? 1 : 0.22, scaleX: i === step ? 1 : 0.5 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GeneratingOverlay;
