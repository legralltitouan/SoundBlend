/* ═══════════════════════════════════════════════════════════════
   La configuration de l'application — un seul fichier, une ligne.

   ─────────── l'ID client Google ───────────

   C'est lui qui autorise la fenêtre « Se connecter avec Google ».
   **Ce n'est pas un secret** : c'est un identifiant public, comme le
   numéro de téléphone d'un magasin. Il est visible dans le code de
   n'importe quel site qui propose cette connexion, et Google le veut
   ainsi — un site statique n'a pas d'endroit secret où le ranger.

   Ce qui serait secret, c'est le *client secret* : cette application
   n'en a pas, et n'en a jamais eu (le flux utilisé est public par
   conception, sans secret).

   Donc on le met ici, une fois, et **personne n'a jamais à le saisir** :
   ni toi, ni les personnes qui utilisent l'app.

   ─────────── comment le remplir ───────────

   1. Google Cloud Console → APIs & Services → Credentials
   2. « Create credentials » → « OAuth client ID » → type « Web application »
   3. Authorized JavaScript origins : `https://<ton-compte>.github.io`
      (+ `http://localhost:5173` et `http://localhost:4173` pour tester)
   4. Colle la valeur ci-dessous, entre les guillemets.
   5. Redéploie. C'est tout : plus aucun champ dans Réglages.

   Laissé vide, l'app fonctionne entièrement — seule la connexion au
   compte Google est indisponible, et elle le dit clairement. Une valeur
   déjà enregistrée dans le navigateur par une ancienne version reste
   utilisée en secours, pour ne rien casser chez les personnes qui
   l'avaient saisie à la main.
   ═══════════════════════════════════════════════════════════════ */

/**
 * La clé Gemini de l'application — facultative.
 *
 * Remplie, **personne n'a plus rien à saisir** : l'app s'en sert pour tout
 * le monde, et l'IA fonctionne dès la première ouverture. C'est ce qui se
 * rapproche le plus de « l'utilisateur ne fait rien ».
 *
 * Le prix à payer, et il faut le dire clairement : une clé de site web est
 * publique par nature, et la consommation de tout le monde passe sur ce
 * compte-là. À ton échelle (une offre gratuite, des quotas par jour et par
 * modèle), c'est indolore. Si l'app s'ouvre à beaucoup de monde, il
 * faudra une facturation — ou revenir à « chacun met sa clé ».
 *
 * Laissée vide, c'est la clé saisie par la personne qui sert (ou, à
 * défaut, le blend par voisinage).
 */
export const GEMINI_API_KEY = '';

/** l'ID client OAuth public de l'application — à remplir une fois */
export const GOOGLE_CLIENT_ID = '449975100236-jv09mmj5b3gp7tj93dec3liu736rnmgu.apps.googleusercontent.com';

/**
 * L'ID client à utiliser : celui du code s'il est rempli, sinon celui
 * qu'une ancienne version avait enregistré dans le navigateur.
 */
export const clientIdGoogle = (valeurAncienne?: string): string =>
  GOOGLE_CLIENT_ID.trim() || (valeurAncienne || '').trim();
