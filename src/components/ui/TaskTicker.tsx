import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Check, Clock } from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { useReplaceQueue, stepLabel } from '../../context/ReplaceQueueContext';

/* ═══════════════════════════════════════════════════════════════
   Le bandeau de progression.

   Il dit trois choses, et rien de plus :
   · quel morceau est en train d'être remplacé ;
   · quelle étape est en cours (une vraie étape du code) ;
   · depuis combien de temps, et combien attendent derrière.

   C'est **un seul objet**. Il ne se remplace jamais par un autre, il ne
   s'efface pas non plus : il glisse vers la droite et se range sous la
   bordure de l'écran, où l'on n'en voit plus que la tranche gauche. Un
   clic le ressort pour cinq secondes. Rien n'apparaît ni ne disparaît —
   il n'y a donc aucun fondu possible entre les deux états.
   ═══════════════════════════════════════════════════════════════ */

const HIDE_AFTER_MS = 3000;    // visible trois secondes, puis il se range
const PEEK_MS = 5000;          // ressorti, il reste cinq secondes
/* ce qui reste visible quand le bandeau est rangé : un congé de carte de
   18 px contre le bord. La course vaut la largeur du bloc moins cette
   tranche — plus la marge qui le sépare du bord (20 px sur ordinateur,
   12 px sur mobile). */
const PEPEK_VISIBLE = 18;
/* sur mobile le bloc est posé en haut, avec des marges égales : la course
   du rangement se compte alors depuis sa propre largeur. Sur ordinateur il
   est ancré en bas à droite, et la course se compte depuis le bord droit. */
const isNarrow = () => typeof window !== 'undefined' && window.innerWidth <= 819;

export const TaskTicker: React.FC = () => {
  const { task } = useUI();
  const queue = useReplaceQueue();

  const running = useMemo(
    () => queue?.jobs.find((j) => j.status === 'running') || null,
    [queue],
  );
  const waiting = useMemo(
    () => queue?.jobs.filter((j) => j.status === 'queued').length || 0,
    [queue],
  );

  /* le temps écoulé, seconde par seconde */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const from = running.startedAt;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - from) / 1000)));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [running?.id, running?.startedAt, running]);

  /* la fin d'un remplacement, annoncée quelques secondes */
  const [done, setDone] = useState<{ title: string; id: string } | null>(null);
  const lastReady = useMemo(
    () => queue?.jobs.find((j) => j.status === 'ready') || null,
    [queue],
  );
  useEffect(() => {
    if (lastReady?.result) setDone({ title: lastReady.result.title, id: lastReady.id });
  }, [lastReady?.id]);

  /* ── sorti, ou rangé ? ───────────────────────────────────────── */
  const active = !!(running || task);
  const [open, setOpen] = useState(true);
  const peekUntil = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!active) { setOpen(false); return; }
    setOpen(true);
    const until = Math.max(Date.now() + HIDE_AFTER_MS, peekUntil.current);
    window.clearTimeout(timer.current ?? undefined);
    timer.current = window.setTimeout(() => setOpen(false), Math.max(0, until - Date.now()));
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    /* le compteur ne réarme volontairement pas le minuteur : sinon le
       bandeau resterait sorti indéfiniment, seconde après seconde */
  }, [active, running?.id, running?.step, waiting]);

  const peek = () => {
    peekUntil.current = Date.now() + PEEK_MS;
    setOpen(true);
    window.clearTimeout(timer.current ?? undefined);
    timer.current = window.setTimeout(() => setOpen(false), PEEK_MS);
  };

  /* état vide : rien du tout */
  if (!active) {
    if (!done) return null;
    return (
      <AnimatePresence>
        <motion.div
          key="done"
          className="sb-task sb-task--done"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          onAnimationComplete={() => window.setTimeout(() => setDone((d) => (d && d.id === done.id ? null : d)), 2400)}
        >
          <span className="sb-task-dot sb-task-dot--ok" aria-hidden>
            <Check size={13} strokeWidth={2.6} />
          </span>
          <span className="sb-task-text">
            <span className="sb-task-head">C’est trouvé</span>
            <span className="sb-task-sub">« {done.title} » remplace ton morceau.</span>
          </span>
        </motion.div>
      </AnimatePresence>
    );
  }

  /* Deux lignes, deux rôles : l'étape technique dit ce que fait le
     moteur maintenant, l'analyse dit ce qu'il a compris du morceau. La
     seconde reste affichée quand la première défile — c'est la trace de
     la réflexion, et c'est elle qu'on veut pouvoir lire. */
  const stepText = running ? stepLabel(running.step) : task || '';
  const engineNote = running?.note || '';

  return (
    <motion.div
      className="sb-task"
      data-state={open ? 'open' : 'peek'}
      role="status"
      aria-live="polite"
      /* une seule valeur animée : la translation. Le bloc est le même
         avant, pendant et après le geste. */
      initial={false}
      animate={{
        x: open
          ? '0px'
          : (isNarrow()
            ? `calc(100% + 12px - ${PEPEK_VISIBLE}px)`
            : `calc(100% + 20px - ${PEPEK_VISIBLE}px)`),
      }}
      transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }}
      onClick={open ? undefined : peek}
      onKeyDown={open ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') peek(); }}
      tabIndex={open ? undefined : 0}
      style={{ cursor: open ? 'default' : 'pointer' }}
      aria-label={open ? undefined : 'Sortir le suivi du remplacement'}
    >
      <span className="sb-task-dot" aria-hidden>
        <Sparkles size={15} strokeWidth={2} />
        <i className="sb-task-pulse" />
      </span>

      <span className="sb-task-text">
        <span className="sb-task-head">
          {running ? `Remplacement de « ${running.trackTitle} »` : task}
        </span>

        <span className="sb-task-steps">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={stepText}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="sb-task-sub"
            >
              {stepText}{/…$/.test(stepText) ? '' : '…'}
            </motion.span>
          </AnimatePresence>
          {engineNote && (
            <span className="sb-task-note" title={engineNote}>{engineNote}</span>
          )}
        </span>

        <span className="sb-task-foot">
          <Clock size={10.5} strokeWidth={2} />
          <span>{elapsed}s</span>
          {waiting > 0 && (
            <>
              <span className="sb-task-sep">·</span>
              <span className="sb-task-queue">+{waiting} en attente</span>
            </>
          )}
        </span>
      </span>

      <span className="sb-task-bar" aria-hidden><i /></span>
    </motion.div>
  );
};
