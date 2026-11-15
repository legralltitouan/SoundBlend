import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { OrganicBlob } from '../ui/OrganicBlob';

/* Des phrases d'ambiance, pas une barre de progression inventée : la
   véritable étape du moteur reste affichée séparément, sous l'animation. */
const PHRASES = [
  'On analyse ta sélection',
  'On se souvient de tes goûts',
  'On cherche le bon ton',
  'On affine l’énergie',
  'On explore de nouvelles pistes',
  'On compose ton blend',
  'On peaufine les enchaînements',
];

/* On écoute aussi les changements à chaud : l'option du système peut être
   modifiée alors que la génération est déjà ouverte. */
const useMotionReduced = () => {
  const [reduced, setReduced] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
};

/** Légende indépendante pour pouvoir vérifier mouvement et diagnostics. */
export const GeneratingCaption: React.FC<{ status: string; history?: string[]; active?: boolean }> = ({ status, history = [], active = true }) => {
  const reduced = useMotionReduced();
  const [step, setStep] = useState(0);
  const diagnosticRef = useRef<HTMLParagraphElement | null>(null);
  const previous = history.at(-1) === status ? history.slice(0, -1) : history;
  useEffect(() => { if (diagnosticRef.current) diagnosticRef.current.scrollTop = 0; }, [status]);

  useEffect(() => {
    if (!active) { setStep(0); return; }
    /* Pas de défilement ni de transition en préférence mouvement réduit. */
    if (reduced) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % PHRASES.length), 3000);
    return () => window.clearInterval(t);
  }, [active, reduced]);

  return (
    <div className="sb-gen-caption">
      <h2 className="sb-gen-caption-title">Génération en cours</h2>
      {/* Inspiré de LayoutTextFlip : la largeur épouse chaque phrase, qui
          glisse dans la suivante. Les lecteurs d'écran n'ont pas à réannoncer
          toutes les trois secondes cette animation purement décorative. */}
      <div className="sb-gen-flip-line" aria-hidden="true">
        <motion.div className="sb-gen-flip" layout={!reduced}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 30 }}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={step} className="sb-gen-flip-word"
              initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12, filter: 'blur(3px)' }}
              transition={{ duration: reduced ? 0 : .34, ease: [0.22, 1, 0.36, 1] }}>
              {PHRASES[step]}
            </motion.span>
          </AnimatePresence>
        </motion.div>
      </div>
      {/* L'état courant est annoncé ; les messages précédents, même émis
          dans la même frame, restent consultables sans interrompre la
          lecture d'écran toutes les trois secondes. */}
      <p ref={diagnosticRef} className="sb-gen-diagnostic" role="status" aria-live="polite" aria-atomic="true"
        tabIndex={status.length > 100 ? 0 : undefined}>
        {status || 'Création de ton blend…'}
      </p>
      {previous.length > 0 && (
        <details className="sb-gen-history">
          <summary>Étapes précédentes ({previous.length})</summary>
          <ol tabIndex={0} aria-label="Étapes précédentes de la génération">
            {previous.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
          </ol>
        </details>
      )}
    </div>
  );
};

export const GeneratingOverlay: React.FC = () => {
  const { mode } = useUI();
  const { generating, generatingStatus, generatingLog } = useData();
  const reduced = useMotionReduced();
  const dark = mode === 'dark';

  /* Le vrai état de génération gouverne l'écran : il ne reste pas posé
     par-dessus le blend après la fin ou l'échec. */
  return (
    <AnimatePresence>
      {generating && (
        <motion.div
          className="sb-gen"
          data-mode={dark ? 'dark' : 'light'}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <OrganicBlob mode={dark ? 'dark' : 'light'} movement="chargement" />
          <GeneratingCaption status={generatingStatus} history={generatingLog} />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GeneratingOverlay;
