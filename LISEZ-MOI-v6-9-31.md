# SoundBlend AI — version 6.9.31

## Ce qui change

### Assistant musical

L'onglet **Assistant** remplace **Goûts**. Il peut discuter d'une idée en s'appuyant sur les playlists et blends valides : « Reprends ma playlist Chill Voiture, ajoute du jazz et rends-la plus énergique ». La proposition indique la source, la durée et la consigne ; tu peux les modifier. La génération ne démarre **qu'après ton clic** sur « Générer ce blend ».

L'assistant nécessite une clé Gemini personnelle dans Réglages. Il reçoit la conversation récente, les noms et identifiants des playlists, leurs morceaux chargés, les blends valides et leurs consignes, ainsi que les exclusions. La playlist proposée est chargée avant confirmation si son contenu n'était pas encore disponible. Une source inventée ou une erreur d'accès ne sont pas présentées comme une source valide.

### Blocages et découvertes

Le bouton **Bloquer** propose deux choix distincts : **ne plus proposer cette musique** ou **ne plus proposer cet artiste**. Le premier ne bloque pas les autres titres de l'artiste. Tu peux débloquer séparément chaque choix dans Réglages. Les anciens pouces ne deviennent pas automatiquement des blocages.

Les découvertes et faces cachées effectivement proposées sont prises en compte pendant **14 jours** ; des amorces explicitement choisies peuvent revenir. Les contrôles s'appuient sur l'identifiant et les noms disponibles, y compris l'identité YouTube si elle répond. Des métadonnées manquantes ou erronées peuvent empêcher certains rapprochements : une absence totale de répétition ou d'erreur ne peut pas être garantie.

### Synchronisation Drive

Blends, exclusions, historique récent, thème et clé Gemini peuvent suivre le compte Google dans son espace privé `appDataFolder`. La clé Gemini y est **stockée en clair** ; elle est aussi conservée dans le navigateur. Les suppressions et déblocages sont horodatés pour éviter qu'une ancienne copie les rétablisse ; un blend expiré est retiré du fichier distant lors d'une synchronisation connectée.

La fusion Drive n'est **pas atomique**. Laisse les appareils ouverts et connectés après des modifications simultanées. Hors ligne, les changements restent en attente et le nettoyage cloud reprend lorsque la connexion est rétablie. La synchronisation a été testée avec deux appareils et un Drive **simulés**, pas avec un vrai compte Drive.

### Animation et lecteur

La composition affiche une sphère SVG à six couches, avec grain et trajectoire en huit, inspirée du fichier fourni. Le mouvement réduit fige l'animation et la rotation d'écran recadre le dessin. Le lecteur conserve les corrections précédentes de synchronisation entre son et clip ; un calage parfait n'est pas garanti par YouTube.

La connexion Google de SoundBlend ne connecte pas automatiquement l'iframe YouTube. Si des publicités apparaissent malgré Premium, connecte-toi à YouTube dans le même navigateur avec le compte abonné et vérifie les cookies. Consulte aussi [l'aide YouTube](https://support.google.com/youtube/answer/7437519?hl=fr). Cette version ne garantit pas la suppression des publicités et ne les détecte pas à partir de la durée d'un clip.

## Mise à jour du site GitHub

1. Télécharge et décompresse **`soundblend-site-v6-9.zip`** : tu obtiens `src-v6.9.31`.
2. Place ce dossier **à côté** de ton dépôt Git cloné et place **`MAJ-SoundBlend-v6.9.31.bat` à la racine du dépôt**, à côté du dossier `src`. Le script est aussi présent dans le zip.
3. Sauvegarde d'abord tes modifications locales. Double-clique sur le `.bat` : il vérifie le dépôt et la branche `main`, fait un pull sans forcer, copie les fichiers, puis crée un commit si nécessaire et pousse sur `origin/main`.
4. Attends l'Action GitHub verte, ouvre le site et vérifie **Réglages → SoundBlend AI · v6.9.31**. Ferme et rouvre les onglets si l'ancienne version reste affichée.

Le script ne fait pas de `reset --hard`, ne supprime pas les dossiers et ne modifie pas `.github/workflows/pages.yml`. Il refuse les modifications suivies ainsi que les fichiers non suivis ou ignorés dans les chemins de copie. Il a été inspecté et la copie du paquet a été simulée, mais il **n'a pas été exécuté sous Windows**. Détails et dépannage dans `MISE-A-JOUR-GITHUB-v6-9-31.md`.

Les autres archives sont `soundblend-github.zip` (projet complet pour GitHub) et `soundblend-dist.zip` (site compilé pour une racine `/`). GitHub Actions recompile pour le sous-dossier du dépôt. Le code source et les tests facultatifs sont également dans le paquet principal.

## Résultats des vérifications

| Test | Résultat | Environnement |
|---|---:|---|
| Compilation TypeScript + Vite | Réussie | production |
| Données, migration et historique | 18/18 | sources, simulé |
| Synchronisation et courses Drive | 30/30 | sources, Drive simulé |
| Curateur et filtres | 19/19 | sources, API simulées |
| Identité YouTube, cache et exclusions | 16/16 | sources, API simulées |
| Bibliothèque YouTube, erreurs, délais et pagination | 12/12 | sources, API simulée |
| Sphère, mouvement réduit et rotation | 13/13 | sources, Chromium |
| Parcours graphique Assistant | 20/20 | site compilé, API simulées |
| Erreurs Assistant et sources, dont 550 titres | 12/12 | site compilé, API simulées |
| PWA et rechargement réellement hors ligne | 7/7 | site compilé, service worker actif |
| Lecteur audio/clip | 37/37 | site compilé, lecteurs simulés |
| PWA et Assistant sous `/SoundBlend/` | 7/7 et 20/20 | compilation sous-dossier, API simulées |

Les tests sont fournis dans `verification/` avec leur mode d'emploi. Ils ne constituent pas un essai Gemini ou Drive authentifié, ni un test Premium sur ton compte. En développement, un test de réouverture du lecteur ne compte pas le même nombre de créations ; le même constat a été reproduit sur la version 6.9.30 de référence. La compilation de production, elle, passe le test ci-dessus.

L'interface mise en cache peut être rouverte hors ligne après une première visite ; la musique YouTube, les recherches, Gemini et la synchronisation nécessitent toujours le réseau.
