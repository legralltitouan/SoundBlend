import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { youtubeService } from '../services/youtube';

/* ═══════════════════════════════════════════════════════════════
   La file des remplacements.

   Un remplacement prend du temps : l'IA cherche, on vérifie que le
   morceau existe, on cherche sa pochette. Si on en lance plusieurs à
   la suite, ils ne doivent pas se marcher dessus ni disparaître quand
   on change d'écran. D'où ce registre, placé au-dessus des vues :

   · une file unique, exécutée un remplacement à la fois ;
   · chaque entrée garde son état (en attente / en cours / prête /
     échouée) et son étape courante ;
   · l'état des entrées survit à la navigation — l'icône tourne encore
     quand on revient sur le blend ;
   · une proposition prête est appliquée par la vue du blend ; si elle
     n'est plus affichée, elle attend sagement son retour.
   ═══════════════════════════════════════════════════════════════ */

export type ReplaceStatus = 'queued' | 'running' | 'ready' | 'error';

export interface ReplaceJob {
  id: string;
  blendId: string;
  trackId: string;
  trackTitle: string;
  status: ReplaceStatus;
  step: string;
  /** la phrase du moteur : ce qu'il a compris du morceau et du contexte */
  note?: string;
  startedAt: number;
  /** la proposition, dès qu'elle est prête */
  result?: {
    title: string;
    artist: string;
    track: any;
  };
  error?: string;
}

interface QueueContextType {
  jobs: ReplaceJob[];
  /** l'état d'un morceau donné (ou null) */
  jobFor: (blendId: string, trackId: string) => ReplaceJob | null;
  /** nombre de remplacements en attente ou en cours pour ce blend */
  pendingFor: (blendId: string) => number;
  enqueue: (args: {
    blendId: string;
    trackId: string;
    trackTitle: string;
    run: (onStep: (s: string) => void) => Promise<{ title: string; artist: string; track: any } | null>;
  }) => string;
  /** première proposition prête pour ce blend, à appliquer par la vue */
  readyFor: (blendId: string) => ReplaceJob | null;
  /** la vue du blend vient de consommer une proposition */
  consume: (jobId: string) => void;
  dismiss: (jobId: string) => void;
}

const QueueContext = createContext<QueueContextType | undefined>(undefined);

/* une étape technique a un libellé court ; une phrase plus longue est
   l'analyse du modèle et va dans son propre champ, pas dans l'étape —
   sinon l'étape suivante l'écrase au bout d'une seconde */
const KNOWN_STEPS = new Set(['taste', 'thinking', 'comparing', 'finding', 'artwork']);
export const isEngineNote = (s: string) => !!s && !KNOWN_STEPS.has(s) && s.length > 24;

const STEP_LABEL: Record<string, string> = {
  taste: 'Lecture de tes goûts',
  thinking: 'L’IA cherche une idée',
  comparing: 'Comparaison avec les morceaux du blend',
  finding: 'Vérification que le titre existe bien',
  artwork: 'Recherche de la pochette',
};

/* une étape connue a son libellé ; tout le reste est une phrase venue du
   moteur — son analyse du morceau — et se montre telle quelle */
export const stepLabel = (s: string) => STEP_LABEL[s] || s || 'Recherche en cours';

export const ReplaceQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [jobs, setJobs] = useState<ReplaceJob[]>([]);
  const runningRef = useRef(false);
  const jobsRef = useRef<ReplaceJob[]>([]);
  jobsRef.current = jobs;
  const runnersRef = useRef(new Map<string, (onStep: (s: string) => void) => Promise<any>>());

  const patch = useCallback((id: string, next: Partial<ReplaceJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));
  }, []);

  /* un seul remplacement à la fois : on dépile dès qu'un slot se libère */
  const pump = useCallback(() => {
    if (runningRef.current) return;
    const next = jobsRef.current.find((j) => j.status === 'queued');
    if (!next) return;
    runningRef.current = true;
    patch(next.id, { status: 'running', step: 'taste', startedAt: Date.now() });

    console.debug('[file] départ', next.trackTitle);
    const runner = runnersRef.current.get(next.id);
    if (!runner) {
      runningRef.current = false;
      patch(next.id, { status: 'error', error: 'Tâche perdue.' });
      setTimeout(pump, 60);
      return;
    }

    runner((s: string) => patch(next.id, isEngineNote(s) ? { note: s } : { step: s }))
      .then((res) => {
        if (!res) patch(next.id, { status: 'error', error: 'Aucune proposition trouvée.' });
        else patch(next.id, { status: 'ready', result: res });
      })
      .catch((e) => { console.debug('[file] échec', e?.message); patch(next.id, { status: 'error', error: e?.message || 'Remplacement impossible.' }); })
      .finally(() => {
        runningRef.current = false;
        /* on laisse respirer une seconde entre deux morceaux : les appels
           à l'IA et à YouTube n'aiment pas partir tous en même temps */
        setTimeout(pump, 900);
      });
  }, [patch]);

  /* les fonctions d'exécution ne sont pas dans l'état React : elles n'ont
     pas à provoquer de rendu, et elles restent valides après un changement
     d'écran */

  const enqueue: QueueContextType['enqueue'] = useCallback((args) => {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    runnersRef.current.set(id, args.run);
    setJobs((prev) => [
      ...prev,
      {
        id,
        blendId: args.blendId,
        trackId: args.trackId,
        trackTitle: args.trackTitle,
        status: 'queued',
        step: 'taste',
        startedAt: Date.now(),
      },
    ]);
    return id;
  }, [pump]);

  const consume = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    runnersRef.current.delete(jobId);
  }, []);

  const dismiss = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    runnersRef.current.delete(jobId);
  }, []);

  const jobFor = useCallback(
    (blendId: string, trackId: string) =>
      jobs.find((j) => j.blendId === blendId && j.trackId === trackId && j.status !== 'ready') || null,
    [jobs],
  );

  const readyFor = useCallback(
    (blendId: string) => jobs.find((j) => j.blendId === blendId && j.status === 'ready') || null,
    [jobs],
  );

  const pendingFor = useCallback(
    (blendId: string) => jobs.filter((j) => j.blendId === blendId && (j.status === 'queued' || j.status === 'running')).length,
    [jobs],
  );

  /* dès qu'une entrée apparaît ou qu'un slot se libère, on dépile */
  useEffect(() => { pump(); }, [jobs, pump]);

  /* sécurité : si un onglet revient au premier plan, on relance la pompe */
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') pump(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [pump]);

  const value = useMemo<QueueContextType>(
    () => ({ jobs, jobFor, readyFor, pendingFor, enqueue, consume, dismiss }),
    [jobs, jobFor, readyFor, pendingFor, enqueue, consume, dismiss],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
};

export const useReplaceQueue = () => {
  const ctx = useContext(QueueContext);
  /* le fournisseur est optionnel : les vues qui n'en ont pas besoin
     (ou les tests isolés) ne doivent pas casser */
  return ctx ?? null;
};

export const useYoutubeAuth = () => youtubeService.isAuthenticated();
