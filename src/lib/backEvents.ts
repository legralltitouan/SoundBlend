/* ═══════════════════════════════════════════════════════════════
   L'historique du retour, tenu à la main — et le signal d'accueil.

   On ne peut pas compter sur `history.length` : le navigateur y ajoute
   ses propres entrées (un `pushState` annulé, un retour qu'on a refusé,
   l'entrée de la page d'avant…). Le 9 novembre, cette imprécision a
   coûté un vrai défaut : réduire le plein écran du lecteur ramenait à
   l'accueil.

   Ici on tient **nos** entrées nous-mêmes, avec deux nombres :

   - `profondeur` : combien d'entrées nous avons posées au-dessus de
     l'accueil ;
   - `attente` : combien de `back()` nous avons lancés et dont le
     `popstate` n'est pas encore arrivé (`back()` est asynchrone).

   Toutes les fonctions mettent ces nombres à jour **tout de suite**,
   avant que le navigateur ne réponde. Du coup la synchronisation ne
   peut plus retirer deux entrées pour une seule fermeture.
   ═══════════════════════════════════════════════════════════════ */

/** l'application demande à revenir à l'accueil (retour système) */
export const BACK_HOME_EVENT = 'sb:back-home';

const PILE = { profondeur: 0, attente: 0 };

/** combien d'entrées nous avons posées (pour les tests et le débogage) */
export const profondeurPile = () => PILE.profondeur;

/** un `back()` est-il encore en vol ? (le `popstate` n'est pas arrivé) */
export const enAttente = () => PILE.attente;

/** poser une entrée : « il y a quelque chose à fermer ou à quitter » */
export const poserEntree = () => {
  try {
    window.history.pushState({ sb: ++PILE.profondeur }, '');
  } catch { /* historique indisponible : on n'insiste pas */ }
};

/**
 * Retirer notre entrée, quand il reste moins de choses à fermer qu'il n'y
 * a d'entrées.
 *
 * Appelé par **la synchronisation seule** (`useAndroidBack`), jamais par
 * le geste ni par le bouton « réduire » : ceux-là referment la couche et
 * s'arrêtent là. C'est ce qui compte — quand le geste retirait l'entrée
 * *et* que la synchronisation la retirait aussi, on en retirait deux pour
 * une fermeture, et l'app revenait à l'accueil.
 *
 * Ne fait rien s'il n'y a rien à nous : c'est ce qui protège le cas où
 * c'est le retour système qui vient de refermer la couche.
 */
export const retirerEntree = () => {
  if (PILE.profondeur <= 0) return;
  PILE.profondeur -= 1;
  PILE.attente += 1;
  try { window.history.back(); } catch { PILE.attente -= 1; PILE.profondeur += 1; }
};

/**
 * Un `popstate` vient d'arriver. Vrai s'il est de nous — auquel cas il
 * n'y a rien à en faire : les compteurs sont déjà à jour.
 */
export const popInterne = () => {
  if (PILE.attente > 0) { PILE.attente -= 1; return true; }
  if (PILE.profondeur > 0) PILE.profondeur -= 1;
  return false;
};
