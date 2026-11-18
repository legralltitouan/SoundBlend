# SoundBlend 6.9.39 — essai de connexion Google

## Ce que signifie ton résultat P01

Le test indépendant effectué sur ton ordinateur a reçu une réponse Google et confirmé les trois autorisations demandées. Il utilisait le même client Google et les mêmes droits que SoundBlend, mais demandait de choisir le compte au lieu de forcer un nouvel écran de consentement.

La comparaison avec l'ancien essai local D09 est encourageante, **sans prouver à elle seule la cause de la panne** : les essais ont eu lieu à des moments différents et l'état des autorisations, le compte ou le parcours ont pu changer. P01 ne vérifie ni le site SoundBlend ni les appels Drive et YouTube.

## Ce que change cette version candidate

La 6.9.39 remplace `prompt=consent` par `prompt=select_account` dans la connexion Google. Elle garde le **même projet et identifiant OAuth**, les trois droits et la valeur par défaut de `include_granted_scopes`. Google peut réutiliser des droits déjà accordés, inclure d'autres droits précédemment accordés au même client, ou encore demander un nouvel accord. Le droit YouTube demandé reste étendu : vérifie toujours les autorisations que Google présente avant de les accepter.

Les protections de la 6.9.38, dont la vérification de l'identité, la séparation des comptes, l'annulation et la synchronisation, sont conservées. Le code de l'application, hors affichage et numéro de cache de version, ne change que sur ce paramètre. Cette version est une **tentative à vérifier**, pas une réparation garantie. Aucun projet Cloud, site, dépôt ou compte n'a été modifié par l'agent.

## Quel fichier utiliser ?

- **`SoundBlend-v6.9.39-source.zip`** : projet complet pour un dépôt GitHub qui construit le site par GitHub Actions. C'est le choix à privilégier pour le dépôt public observé. Le ZIP contient un dossier parent `SoundBlend-v6.9.39-source/` et son contenu comprend `.github/` ; il ne contient ni dépendances installées ni site compilé.
- **`SoundBlend-v6.9.39-site-GitHub-SoundBlend.zip`** : site statique déjà compilé pour `/SoundBlend/`, uniquement si le site est publié directement à partir de fichiers statiques.
- **`SoundBlend-v6.9.39-site-racine.zip`** : site statique pour `/` sur un autre domaine ; ne pas l'utiliser pour le chemin GitHub `/SoundBlend/`.

## Avant de publier

1. Conserve le projet Cloud et le client existants : **ne les recrée pas et ne révoque pas les autorisations** pour cet essai. Ne vide pas les données, cookies ou caches du navigateur et ne désinstalle pas l'application.
2. Conserve une copie de ton dépôt et de tes éventuelles personnalisations. L'ancien `SoundBlend-v6.9.38-source.zip` et son site restent disponibles ; si tu as modifié ton dépôt depuis, compare avant de remplacer quoi que ce soit. Ne remplace pas le dossier `.git` ni tes clés personnelles.
3. Important : après une vraie connexion, **SoundBlend peut synchroniser automatiquement et écrire dans le dossier privé Drive du compte**, comme en 6.9.38. Garde tes autres appareils fermés pendant le premier essai et ne supprime rien ; vérifie les données avant de reprendre les modifications. Revenir au code précédent ne peut pas annuler automatiquement une synchronisation déjà effectuée.

## Si tu choisis d'essayer sur GitHub Pages

1. Décompresse l'archive source. Dans ton dépôt existant, compare puis mets à jour le **contenu** du dossier `SoundBlend-v6.9.39-source/`, pas ce dossier parent. Conserve toute personnalisation, notamment `src/config/app.ts`, ainsi que `.git`. Le workflow `.github/workflows/pages.yml` est inclus. Si tu ne sais pas comment préserver tes changements, demande de l'aide avant de remplacer les fichiers.
2. Crée le commit et envoie-le vers `main`, puis attends la réussite de l'action **Publier sur GitHub Pages**. L'agent n'a fait aucun envoi. Si ton site publie directement des fichiers statiques au lieu du workflow, utilise le ZIP **site GitHub** et non le ZIP racine.
3. Ouvre SoundBlend en ligne, ferme et rouvre tous ses onglets et fenêtres installées, puis vérifie **v6.9.39** dans Réglages. Un ancien onglet peut encore exécuter l'ancienne version ; n'efface pas le stockage pour forcer la mise à jour.
4. Si le compte n'est pas connecté, clique **Connecter mon compte** ou **Reconnecter ce compte**, choisis le même compte que pour P et termine le parcours si tu acceptes les droits. Google peut ne pas redemander le consentement. Si le compte est déjà connecté, inutile de le déconnecter pour ce test : la déconnexion peut révoquer une autorisation Google.
5. Vérifie le nom du compte, puis tes playlists et l'état de synchronisation dans Réglages. La synchronisation peut démarrer automatiquement dès la connexion. Une bibliothèque vide ne démontre pas une suppression : vérifie le compte et le message éventuel avant toute action.
6. Si la fenêtre Google se ferme et que l'application attend encore, relève le code d'attente après quelques secondes, puis utilise **Annuler**. Communique seulement le code et le résultat observé, jamais ton mot de passe, une adresse, un jeton, une URL de connexion ou ta clé Gemini.

Si la tentative n'aboutit pas, conserve les données et la configuration Cloud ; on peut revenir au code 6.9.38 ou poursuivre le diagnostic. La restauration du code ne restaure pas automatiquement d'éventuelles données modifiées entre-temps.

## Vérifications et limites

- Comparaison de P et de la candidate sur une origine locale commune : **13/13 contrôles**, avec la bibliothèque GIS réelle et l'autorisation interceptée avant Google. Neuf champs OAuth contrôlés sont identiques. Un autre essai avec une copie antérieure de GIS donne le même résultat. Aucun compte ni jeton réel n'est utilisé dans ces comparaisons.
- Connexion de la candidate : **32/32 contrôles simulés**, sur les sources puis sur chacun des deux sites compilés ; choix du compte, droits demandés, annulation, expiration, changement de compte et vérification d'identité sont notamment couverts. GIS réel avec fenêtres et réponses fictives : **12/12** par environnement.
- Conservation des données : **35/35 contrôles Drive simulés**, autres contrôles de comptes et de synchronisation, ainsi qu'un scénario à deux appareils fictifs. Mise à jour PWA depuis les véritables sites compilés 6.9.38 : **11/11** à chaque base, avec données et session fictives. Les contrôles ne prouvent pas une fusion Drive atomique.
- Vraie fenêtre Google ouverte depuis le build local servi à l'origine GitHub interceptée : **7/7 contrôles**, sans choisir de compte ni donner de consentement. Le site distant n'a pas été modifié.
- Les deux compilations réussissent ; lint : **0 erreur, 84 avertissements**. Les appels Drive/YouTube, les identités et les réponses OAuth de l'application ont été simulés par l'agent. **Aucun essai authentifié de la 6.9.39 n'a été réalisé.**

Les empreintes des archives et de ce guide sont dans `SHA256SUMS-v6.9.39.txt`.
