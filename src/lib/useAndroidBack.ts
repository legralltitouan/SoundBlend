import { useEffect, useRef, useState } from 'react';

import { BACK_HOME_EVENT, enAttente, popInterne, poserEntree, profondeurPile, retirerEntree } from './backEvents';

/* ═══════════════════════════════════════════════════════════════
   Le bouton « retour » du téléphone.

   Sur Android, c'est le geste ou la flèche du système : il doit faire
   quelque chose d'attendu, et pas sortir de l'app d'un coup. Notre
   règle, en trois marches :

   1. **une couche est ouverte** (plein écran du lecteur, fenêtre…) →
      on la referme ;
   2. **on est ailleurs qu'à l'accueil** → on revient à l'accueil ;
   3. **on est déjà à l'accueil**, rien d'ouvert → on laisse le
      navigateur faire : il réduit l'app, comme avant.

   Le nombre d'entrées d'historique suit ce qu'il y a à fermer :
   une pour l'écran (si on n'est pas à l'accueil), une par couche.
   Elles sont posées et retirées par `backEvents`, qui en tient le
   compte exact — voir le commentaire de ce fichier.
   ═══════════════════════════════════════════════════════════════ */

export type BackLayer = { key: string; close: () => void };

/**
 * @param atHome    true quand l'écran affiché est l'accueil
 * @param layers    les couches ouvertes, de la plus profonde à la
 *                  plus haute (chacune sait se refermer)
 */
export const useAndroidBack = (atHome: boolean, layers: BackLayer[]) => {
  const layersRef = useRef<BackLayer[]>(layers);
  layersRef.current = layers;
  const atHomeRef = useRef(atHome);
  atHomeRef.current = atHome;
  /* relance la synchronisation quand un `back()` en vol s'est posé */
  const [tick, setTick] = useState(0);

  /* un retour du système : on referme la couche du dessus, sinon on
     revient à l'accueil (le navigateur fait le reste à l'accueil) */
  useEffect(() => {
    const onPop = () => {
      const inter = popInterne();
      if (inter) return;
      const top = layersRef.current[layersRef.current.length - 1];
      if (top) { top.close(); return; }        // 1. la couche du dessus
      if (!atHomeRef.current) {                // 2. l'accueil
        window.dispatchEvent(new CustomEvent(BACK_HOME_EVENT));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* ── la synchronisation des entrées ──
     `profondeur` est mise à jour immédiatement par `backEvents` : cette
     boucle ne peut donc pas retirer deux entrées pour une seule raison.
     C'est précisément ce qui ramenait à l'accueil. */
  const cible = layers.length + (atHome ? 0 : 1);
  useEffect(() => {
    /* un `back()` encore en vol ne doit pas être doublé : on repasse
       quand son `popstate` est arrivé. Sans cette attente, un clic trop
       rapide posait une entrée que ce `back()` retirait aussitôt. */
    if (enAttente() > 0) {
      const t = window.setTimeout(() => setTick((n) => n + 1), 60);
      return () => window.clearTimeout(t);
    }
    let garde = 8;
    while (garde-- > 0) {
      const d = profondeurPile();
      if (d === cible) break;
      if (d < cible) poserEntree(); else retirerEntree();
    }
  }, [cible, layers.length, atHome, tick]);
};
