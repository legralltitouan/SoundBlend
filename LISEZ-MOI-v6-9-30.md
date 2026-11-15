# SoundBlend AI — version 6.9.30

## En bref

Cette version améliore le calage entre l'horloge affichée, le lecteur qui fournit le son et le lecteur muet qui affiche le clip. Elle conserve la correction du lecteur natif masqué et du retour Titre → Vidéo.

**Important : les publicités Premium ne sont pas garanties supprimées par cette mise à jour.** Je corrige mon affirmation précédente : l'API du lecteur YouTube ne fournit pas de signal publicitaire fiable, et la durée d'une vidéo ne suffit pas pour identifier une annonce. J'ai donc retiré cette détection, qui pouvait masquer à tort un clip normal. Il faut vérifier la session YouTube et les cookies ; la procédure est ci-dessous et dans Réglages.

## Synchronisation

- L'horloge du lecteur audio est la référence pour l'affichage et pour le clip muet.
- Un saut sur la barre du grand lecteur ou de la mini-barre est transmis au lecteur audio ; si le clip est présent, sa position est recalée. Une garde évite de le ramener à l'ancienne position pendant que le saut audio est encore en cours.
- En mode Titre, le clip est figé ; au retour en Vidéo, il se recale sur le son. La bascule ne commande ni pause, ni saut, ni rechargement du lecteur audio.
- La position et l'état des deux lecteurs sont contrôlés régulièrement ; les corrections sont espacées pour éviter de multiplier les seeks pendant le chargement.
- À la fermeture du grand lecteur, son iframe est libérée ; à la réouverture elle est recréée pour le morceau courant, sans déplacer ni recréer le lecteur audio. Revenir à un morceau déjà écouté relance correctement sa recherche de clip.
- Si le clip ne peut pas être trouvé ou que son lecteur renvoie une erreur, l'interface revient à la pochette et grise Vidéo.

**Limites :** YouTube effectue les seeks sur des images-clés et chaque iframe peut charger à son propre rythme. La synchro au millième et une absence totale de décalage ne peuvent donc pas être garanties. Si le clip et l'audio sont deux montages différents (intro plus longue, version live, etc.), la même seconde peut aussi correspondre à des passages différents du morceau.

## Si des publicités apparaissent malgré Premium

La connexion Google dans SoundBlend sert aux données et playlists ; elle ne connecte pas automatiquement le lecteur YouTube intégré. YouTube indique que des cookies bloqués peuvent empêcher la reconnaissance du compte dans une vidéo intégrée.

1. Dans **le même navigateur et le même profil que SoundBlend**, ouvre [youtube.com](https://www.youtube.com/) et connecte-toi au compte associé à l'abonnement.
2. Vérifie que l'abonnement est actif sur [youtube.com/paid_memberships](https://www.youtube.com/paid_memberships). YouTube distingue YouTube Premium de YouTube Music Premium, qui ne couvre pas nécessairement toutes les vidéos.
3. Vérifie que les cookies YouTube ne sont pas bloqués pour SoundBlend. Dans Chrome, tu peux autoriser YouTube dans les paramètres de cookies tiers / données de site ; les intitulés varient selon la version. Sur un autre navigateur ou une app installée, vérifie aussi la session propre à ce navigateur.
4. Recharge SoundBlend et réessaie le même clip. Pour la procédure exacte selon l'appareil : [aide officielle YouTube](https://support.google.com/youtube/answer/7437519?hl=fr).

La reconnaissance du compte et la diffusion des annonces restent contrôlées par YouTube et le navigateur. SoundBlend ne peut pas forcer Premium sur l'iframe ni garantir l'absence d'annonces dans tous les environnements.

## Tests et leurs limites

Le paquet source inclut les essais principaux dans `verification/` (instructions dans ce dossier). Les autres tests de non-régression ont été exécutés dans l’environnement de travail.

| Essai | Résultat |
|---|---|
| Compilation TypeScript et Vite | Réussie |
| `t-player630-rigoureux` : deux lecteurs simulés, saut asynchrone réellement déclenché, pause, tampon, trois bascules, mini-barre, changement et retour de morceau, repli sur erreur | 37/37 |
| Tests simulés de non-régression clip `t-clip629`, `t-clip624` | 22/22 et 27/27 |
| `t-clip626` : repli sans clip et console | 12/13 à une passe (erreurs console non détaillées), puis 13/13 à deux passes suivantes |
| `t-sync623`, `t-playlist623`, `t-lecture623` | 9/9, 7/7 et 6/6 |
| Réglages | version 6.9.30 et aide Premium présentes |

**Lecteurs YouTube réels :** dans Chromium sans écran, avec la même vidéo d'exemple YouTube imposée aux deux lecteurs pour la mesure, les écarts relevés via l'API étaient de **0,13 à 0,41 s** : en lecture, après trois allers-retours Titre/Vidéo et après fermeture/réouverture du grand lecteur. Le lecteur audio était la même iframe et le clip était muet. Un autre essai sur le morceau de démonstration n'a pas abouti, faute de chargement complet. Aucun de ces essais ne valide ton compte Premium, tes morceaux, ni la peinture de la vidéo sur ton appareil ; les captures vidéo du navigateur sans écran ne sont pas fiables.

## Mise à jour GitHub

1. Décompresse `soundblend-site-v6-9.zip` : tu obtiens `src-v6.9.30`.
2. Place ce dossier **à côté** du dépôt cloné et `MAJ-SoundBlend-v6.9.30.bat` **dans** le dépôt.
3. Sauvegarde et committe d'abord tes éventuelles modifications. Double-clique ensuite sur le `.bat` : il refuse un dépôt modifié, fait un pull `--ff-only`, copie les fichiers du paquet, puis crée un commit si nécessaire et pousse vers `main`.
4. Attends GitHub Actions, puis vérifie **Réglages → SoundBlend AI · v6.9.30**. Ferme et rouvre tous les onglets de l'app si l'ancienne version reste en cache.

Le script n'utilise pas `git reset --hard`, ne supprime pas les dossiers et ne modifie pas `.github/workflows/pages.yml`. Il n'indexe pas les autres fichiers non suivis. En cas d'échec après une copie ou un commit, lis son message et vérifie `git status` avant de recommencer. Le script n'a pas pu être exécuté sous Windows dans cet environnement.

Archives supplémentaires : `soundblend-github.zip` contient l'ensemble du projet et le script ; `soundblend-dist.zip` contient le site compilé pour une racine `/` (le workflow GitHub recompile pour le bon sous-dossier).

## Contrôles de version

- `package.json` et `package-lock.json` : `6.9.30`
- `public/sw.js` : `sb-v6-9-30`
- Génération : composant `GeneratingOverlay.tsx` identique à la 6.9.22 (SHA-256 `6950bdf5ca262a8e26e2782aeb2462458c33894a2fec431b09ad352ae35cf80f`).
- Workflow `pages.yml` inchangé : MD5 `737ac33cc87eccfb9cbc112ac89bdd3f`.
