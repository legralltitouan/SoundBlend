# Vérifications facultatives — SoundBlend 6.9.40

Ces scripts ouvrent des profils Chromium temporaires. Sauf indication contraire, Google OAuth, Drive, Gemini, YouTube et le lecteur sont **simulés** : aucun compte ni aucune clé réelle n'est utilisé. Ils ne prouvent pas une fusion atomique sur Drive, la disponibilité des services ou le comportement de tous les navigateurs. Exécuter les scripts **séquentiellement**.

Les scripts `t-google-connexion638`, `t-pwa638`, `t-pwa-migration638` et leurs homologues historiques `639` sont conservés pour l'historique et attendent l'ancien parcours ou l'ancien cache. Pour la 6.9.40, utiliser les scripts `640` listés ci-dessous. La connexion est inchangée par rapport à la 6.9.39.

## Préparer

Depuis la racine du projet extrait, avec Node.js 20.19+ ou 22.12+ :

```sh
npm ci
npm install --no-save playwright@1.65.0
node node_modules/playwright/cli.js install chromium
```

Sur Linux, Chromium peut demander des bibliothèques système supplémentaires (`node node_modules/playwright/cli.js install-deps chromium`). Pour un navigateur déjà installé, définir `CHROMIUM_PATH` sur son exécutable.

## Comptes, stockage, synchronisation et export — sources

Dans un premier terminal, laisser ouvert `npm run dev`. Après avoir modifié des fichiers source, **redémarrer Vite avant ces suites** : le rechargement à chaud peut créer deux instances d'un module partagé et fausser les tests qui l'importent directement. Dans un second terminal :

```sh
node verification/t-collections631.mjs
node verification/t-drive631.mjs
node verification/t-audit-comptes633.mjs
node verification/t-google-connexion640.mjs
node verification/t-google-mobile638.mjs
node verification/t-google-races637.mjs
node verification/t-gis-ancien638.mjs
node verification/t-audit-deux-appareils633.mjs
node verification/t-audit-horloge633.mjs
node verification/t-audit-playlist633.mjs
node verification/t-races-comptes634.mjs
node verification/t-sync-delais-onglets634.mjs
node verification/t-sync-auto636.mjs
node verification/t-drive-corrompu634.mjs
node verification/t-migration-legacy634.mjs
node verification/t-auth-expiration634.mjs
node verification/t-export-reprise634.mjs
node verification/t-onboarding634.mjs
```

Ces tests couvrent notamment l'isolation A/B et des données historiques, deux appareils, les changements de compte en vol, les délais et fichiers Drive invalides, l'expiration et la reprise YouTube. Les tests de connexion couvrent absence de retour, annulation, double clic, réponses tardives, identité refusée et changement de compte ; le test de courses importe les sources et nécessite Vite. `t-gis-ancien638.mjs` utilise la bibliothèque GIS publique réelle **sans error_callback**, comme en 6.9.33, mais avec fenêtres, réponses OAuth et identités **fictives** : il n'authentifie aucun compte. Il télécharge GIS avec `curl`, ou utilise `SOUNDBLEND_GIS_SCRIPT_PATH`. Le simulateur dépend de certains détails de GIS et peut nécessiter une adaptation si Google les change ; l'application ne les utilise pas. L'essai de fenêtre bloquée ou fermée vérifie l'aide et l'annulation, pas une détection automatique. Les délais de certains scénarios sont accélérés uniquement dans le navigateur de test. Par défaut, ces scripts utilisent `http://localhost:5173/` ; `SOUNDBLEND_DEV_URL` choisit une autre adresse.

## Comparaison avec le diagnostic P

Avec le serveur de sources et une copie séparée du dossier historique `../Diagnostic-Google-SoundBlend-selection-compte/` (non inclus dans cette livraison), lancer `node verification/t-comparaison-p639.mjs`. `SOUNDBLEND_P_HTML` indique un autre emplacement de `diagnostic.html`. Ce test sert les deux pages sur une origine commune interceptée, utilise la bibliothèque GIS publique et intercepte l'autorisation avant tout compte : aucun jeton, consentement ou appel Drive/YouTube réel. Il compare neuf paramètres OAuth.

## Autres parcours — sources

Avec le même serveur :

```sh
node verification/t-bandeau640.mjs
node verification/t-curateur631.mjs
node verification/t-resolution631.mjs
node verification/t-generation636.mjs
node verification/t-generation-ui636.mjs
SOUNDBLEND_FINAL_FILTER=1 node verification/t-generation-ui636.mjs
node verification/t-generation-erreur-ui636.mjs
node verification/t-generation-races636.mjs
node verification/t-youtube-bibliotheque631.mjs
node verification/t-assistant631.mjs
node verification/t-assistant-erreurs631.mjs
node verification/t-assistant635.mjs
node verification/t-assistant-vocal635.mjs
node verification/t-assistant-web635.mjs
node verification/t-connexion-avatar633.mjs
node verification/t-exclusions633.mjs
node verification/t-orb631.mjs
node verification/t-pochettes-diagnostics632.mjs
```

Le test `t-bandeau640.mjs` lance un vrai remplacement à partir d'un blend fictif. Il maintient une réponse Gemini simulée pour observer le bandeau ouvert puis rangé, change le thème, teste clic et clavier, et vérifie l'application d'un résultat fictif après navigation, sur mobile et ordinateur. Aucun compte ou service externe réel n'est utilisé. Avec `SOUNDBLEND_URL`, il teste aussi un site compilé.

Les tests de génération couvrent notamment quota total ou partiel, erreur YouTube distincte, répartition, plafonnement des piliers, compléments, exclusions, affichage et persistance du bilan, échec sans aucun titre, synchronisation vers un second profil fictif et changements de compte en vol. Le mode `SOUNDBLEND_FINAL_FILTER=1` injecte une exclusion avant le dernier contrôle ; sous PowerShell, utiliser `$env:SOUNDBLEND_FINAL_FILTER='1'`, lancer le script, puis supprimer la variable. Le test de courses utilise `generation-races636.html` et son petit composant de test ; aucun de ces fichiers n'est un point d'entrée du site de production.

Les tests de l'Assistant couvrent notamment une bibliothèque de plus de 500 titres, les propositions, les copies, les retraits et réordonnancements, les annulations, les changements de compte, les exclusions, la recherche et les erreurs. Le vocal utilise le graphe audio Chromium réel avec un micro factice et un WebSocket simulé. La recherche Google Search, les modèles Gemini et YouTube sont simulés ; ces tests ne valident pas de services ni comptes réels. Exclusions couvre clavier, tailles d'écran, repli réseau et réponses tardives ; l'animation et les pochettes peuvent écrire des images dans `verification/captures/`.

## Site compilé et PWA

Compiler pour la racine et laisser ouvert le serveur de prévisualisation :

```sh
npm run build
npm run preview
```

Dans un second terminal, sur macOS/Linux :

```sh
export SOUNDBLEND_URL=http://localhost:4173/
node verification/t-bandeau640.mjs
node verification/t-site-comptes634.mjs
node verification/t-google-connexion640.mjs
node verification/t-gis-ancien638.mjs
node verification/t-export-reprise634.mjs
node verification/t-onboarding634.mjs
node verification/t-generation-ui636.mjs
SOUNDBLEND_REAL_FAILURE=1 node verification/t-generation-erreur-ui636.mjs
node verification/t-pwa640.mjs
node verification/t-pwa-navigation640.mjs
node verification/t-player630-rigoureux.mjs
node verification/t-assistant631.mjs
node verification/t-assistant-erreurs631.mjs
node verification/t-assistant635.mjs
node verification/t-assistant-vocal635.mjs
node verification/t-assistant-web635.mjs
node verification/t-connexion-avatar633.mjs
node verification/t-exclusions633.mjs
node verification/t-visuel632.mjs
```

Sous PowerShell : `$env:SOUNDBLEND_URL='http://localhost:4173/'` ; pour le test d'échec du site, définir `$env:SOUNDBLEND_REAL_FAILURE='1'`, lancer le script puis supprimer la variable. Ce mode utilise le moteur compilé avec des réponses Gemini et YouTube simulées ; le mode par défaut remplace le moteur et exige le serveur de sources. Le test visuel utilise aussi le serveur de sources sur 5173. Les tests PWA activent un **vrai service worker** dans un profil temporaire : ils vérifient le rechargement hors ligne et la conservation de la page en cache lors d'un déploiement incomplet. Le test lecteur utilise deux faux lecteurs, pas les iframes YouTube réelles.

Pour tester la mise à jour du **vrai site compilé 6.9.39** vers la 6.9.40, conserver séparément `SoundBlend-v6.9.39-site-racine.zip`, installer `unzip`, puis :

```sh
export SOUNDBLEND_PREVIOUS_SITE_ZIP=/chemin/vers/SoundBlend-v6.9.39-site-racine.zip
node verification/t-pwa-migration640.mjs
```

L'ancien paquet n'est pas inclus dans la source 6.9.40. `SOUNDBLEND_PREVIOUS_SITE_DIR` peut désigner le répertoire extrait ; `SOUNDBLEND_PREVIOUS_VERSION=6.9.33` ou `6.9.34` sélectionne une autre version dont le site compilé est fourni séparément. L'essai simule un téléchargement raté, vérifie les caches, conserve les espaces A/B et une session fictive, puis recharge les deux versions hors ligne. Il ne garantit pas tous les états possibles de cache.

Les tests de migration et de navigation utilisent le chemin de `SOUNDBLEND_URL` pour déterminer leur point de montage, et lisent le site courant depuis `dist/` (ou le dossier indiqué par `SOUNDBLEND_CURRENT_SITE_DIR`). Ils refusent une compilation dont la base ne correspond pas. Ils n'envoient pas de requêtes au serveur indiqué dans l'URL : ils servent eux-mêmes les fichiers sur un port local temporaire. `SOUNDBLEND_BASE_PATH`, si défini, remplace le chemin de l'URL.

Pour vérifier une compilation en sous-dossier GitHub Pages, adapter la base à son dépôt, puis relancer les tests compatibles ci-dessus avec l'URL correspondante :

```sh
BASE_PATH=/SoundBlend/ npm run build
BASE_PATH=/SoundBlend/ npm run preview -- --port 4181
# Dans le second terminal :
export SOUNDBLEND_URL=http://localhost:4181/SoundBlend/
node verification/t-bandeau640.mjs
node verification/t-pwa640.mjs
node verification/t-pwa-navigation640.mjs
node verification/t-site-comptes634.mjs
node verification/t-google-connexion640.mjs
node verification/t-gis-ancien638.mjs
node verification/t-export-reprise634.mjs
node verification/t-onboarding634.mjs
node verification/t-generation-ui636.mjs
SOUNDBLEND_REAL_FAILURE=1 node verification/t-generation-erreur-ui636.mjs
```

Pour le test de **migration en sous-dossier**, l'ancienne version doit aussi cibler cette base. Avec l'URL ci-dessus et la 6.9.40 compilée dans `dist/` :

```sh
export SOUNDBLEND_PREVIOUS_SITE_ZIP=/chemin/vers/SoundBlend-v6.9.39-site-GitHub-SoundBlend.zip
node verification/t-pwa-migration640.mjs
```

Pour les anciennes versions 6.9.33/6.9.34, recompiler leur source avec `BASE_PATH=/SoundBlend/`, puis définir `SOUNDBLEND_PREVIOUS_VERSION` et `SOUNDBLEND_PREVIOUS_SITE_DIR`. Pour compiler le site courant ailleurs que `dist/`, indiquer son dossier dans `SOUNDBLEND_CURRENT_SITE_DIR`.

## Comparaison historique — facultatif

`node verification/t-comparaison-anciennes-connexions638.mjs` compare les sites 6.9.33, 6.9.34 et 6.9.37 servis séparément sur les ports 5133, 5134 et 5137. Ils ne sont pas inclus dans ce paquet. Il utilise GIS réel mais des fenêtres et des retours fictifs ; il montre notamment que les trois restent déconnectés si aucune réponse ne revient. Les ports peuvent être changés par `SOUNDBLEND_633_URL`, `SOUNDBLEND_634_URL` et `SOUNDBLEND_637_URL`.

## Réseau réel — facultatif

`node verification/t-ouverture-google-reelle639.mjs` sert localement le site compilé pour `/SoundBlend/` sous l'adresse GitHub interceptée et ouvre la vraie fenêtre Google **sans saisir de compte** ; il ne modifie pas le site distant. `SOUNDBLEND_CURRENT_SITE_DIR` permet d'indiquer le dossier compilé. Ce contrôle ne vérifie pas la connexion après consentement.

`node verification/t-exclusions-reel633.mjs` interroge des instances Piped publiques pour « Daft Punk One More Time » et « Daft Punk », dans un profil temporaire sans compte. Les réponses et la disponibilité peuvent varier ; un échec peut venir du réseau ou du service.

`node verification/t-youtube-reel630.mjs` ouvre de vraies iframes YouTube et ne vérifie ni un compte Premium ni la conformité réglementaire. L'essai antérieur dans l'environnement de livraison n'a pas démarré et reste **non concluant**. L'architecture héritée à deux lecteurs, dont un masqué, doit être revue avant de revendiquer sa conformité aux règles YouTube : voir le README principal.
