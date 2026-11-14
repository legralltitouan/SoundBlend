import { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════
   Le bouton « retour » du téléphone.

   Sur Android, c'est le geste ou la flèche du système : il doit faire
   quelque chose d'attendu dans une application, et pas sortir de
   l'app d'un coup. Notre règle, en trois marches :

   1. **une couche est ouverte** (plein écran du lecteur, fenêtre, clé
      vidéo…) → on la referme ;
   2. **on est ailleurs qu'à l'accueil** (blend, historique, goûts,
      réglages) → on revient à l'accueil ;
   3. **on est déjà à l'accueil** → on laisse le navigateur faire : il
      réduit l'app (ou revient au lanceur), comme avant.

   Sur iOS il n'y a pas de bouton retour, mais le geste « balayage depuis
   le bord » produit le même événement : la marche 1 et 2 y fonctionnent
   aussi, gratuitement.

   Comment on s'y prend : chaque fois qu'on entre dans une couche ou
   qu'on quitte l'accueil, on **empile une entrée** dans l'historique du
   navigateur. Quand la personne appuie sur retour, l'entrée se dépile et
   on reçoit `popstate` : on referme/revient. À l'accueil sans couche, il
   n'y a rien d'empilé, donc le retour va au navigateur, qui réduit l'app.
   ═══════════════════════════════════════════════════════════════ */

type Step = { depth: number; key: string };

export type BackLayer = { key: string; close: () => void };

/**
 * @param atHome    true quand l'écran affiché est l'accueil
 * @param layers    les couches ouvertes, de la plus profonde à la plus
 *                  haute (chacune sait se refermer)
 */
export const useAndroidBack = (atHome: boolean, layers: BackLayer[]) => {
  /* ce que l'on a empilé nous-mêmes, et qu'il faudra dépiler si l'écran
     change sans que le retour soit passé par là */
  const pushed = useRef<Step[]>([]);
  const layersRef = useRef<BackLayer[]>(layers);
  layersRef.current = layers;
  const atHomeRef = useRef(atHome);
  atHomeRef.current = atHome;

  /* la profondeur désirée : 1 si on n'est pas à l'accueil, plus une par
     couche ouverte */
  const desired = (atHome ? 0 : 1) + layers.length;

  useEffect(() => {
    const onPop = () => {
      /* le navigateur a dépilé une de NOS entrées */
      if (pushed.current.length === 0) return;
      pushed.current.pop();
      const top = layersRef.current[layersRef.current.length - 1];
      if (top) {
        /* on referme la couche du dessus. Effet de bord : l'effet se
           relance, `desired` baisse, et l'entrée correspondante est
           retirée proprement plus bas. */
        top.close();
        return;
      }
      if (!atHomeRef.current) {
        window.dispatchEvent(new CustomEvent('sb:back-home'));
        return;
      }
      /* plus rien à fermer ni à quitter : le navigateur gère */
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* on tient la pile au niveau voulu */
  useEffect(() => {
    const sync = () => {
      const want = desired;
      const have = pushed.current.length;
      if (have < want) {
        for (let i = have; i < want; i++) {
          const key = `sb-back-${Date.now()}-${i}`;
          try {
            window.history.pushState({ sbBack: key }, '');
            pushed.current.push({ depth: i + 1, key });
          } catch { /* historique indisponible : on n'insiste pas */ }
        }
      } else if (have > want) {
        /* l'écran a changé tout seul (un clic, pas le bouton retour) : on
           retire nos entrées en trop pour que le compte reste juste */
        const drop = have - want;
        pushed.current.splice(have - drop, drop);
        try { window.history.go(-drop); } catch { /* ignore */ }
      }
    };
    sync();
  }, [desired]);
};

/** l'événement écouté par l'application pour revenir à l'accueil */
export const BACK_HOME_EVENT = 'sb:back-home';
