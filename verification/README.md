# Vérifications facultatives — SoundBlend 6.9.33

Ces tests utilisent Node.js, Playwright et Chromium. Ils ouvrent des profils de navigateur temporaires et simulent les API pour les parcours fonctionnels. Ils ne se connectent pas à ton compte Google et n'envoient pas de vraie requête Gemini. Les essais réels facultatifs de la recherche Piped et du lecteur YouTube sont décrits plus bas.

## Préparer

Depuis la racine du projet extrait :

```sh
npm install
npm install --no-save --no-package-lock playwright@1.65.0
npx playwright install chromium
```

Le paquet Playwright n'est nécessaire que pour les tests. Sur Linux, son installation peut demander des bibliothèques système supplémentaires (`npx playwright install-deps chromium`).

## Tests sur les sources

Dans un premier terminal, lancer et laisser ouvert :

```sh
npm run dev
```

Dans un second terminal :

```sh
node verification/t-collections631.mjs
node verification/t-drive631.mjs
node verification/t-curateur631.mjs
node verification/t-resolution631.mjs
node verification/t-youtube-bibliotheque631.mjs
node verification/t-orb631.mjs
node verification/t-pochettes-diagnostics632.mjs
node verification/t-exclusions633.mjs
node verification/t-connexion-avatar633.mjs
```

Ils visent par défaut `http://localhost:5173/`. Si le serveur utilise un autre port, régler `SOUNDBLEND_DEV_URL` sur son adresse. L'animation sauvegarde une capture dans `verification/captures/`. Le test de délai accélère à 100 ms un délai réseau de production de 12 secondes ; les requêtes sont simulées. Le test pochettes/diagnostics vérifie notamment les résolutions, les réponses réseau tardives et la conservation de messages émis dans le même tour JavaScript.

Le test Exclusions simule Piped et le lecteur : il couvre les onglets, l'ajout et le retrait indépendants, les doublons, le rapprochement de variantes de titres, la panne et le repli réseau, les réponses tardives, le clavier, le retour Android, les thèmes et plusieurs tailles d'écran, y compris un changement de hauteur pendant la fermeture du lecteur. Il ne démontre pas la disponibilité permanente des instances publiques. Il fonctionne aussi sur le site compilé avec `SOUNDBLEND_URL`. Le test connexion/avatar simule Google et vérifie connexion, déconnexion et conservation des exclusions locales sans rechargement.

Une vérification complémentaire de la composition, du sélecteur et des petits écrans utilise **à la fois** le serveur de sources et le site compilé (voir ci-dessous) :

```sh
node verification/t-visuel632.mjs
```

`SOUNDBLEND_DEV_URL` désigne le serveur de sources, `SOUNDBLEND_URL` le site compilé. Les pochettes sont des couleurs simulées, les lecteurs YouTube sont simulés et seul le cycle de texte est accéléré pour le test. Il vérifie notamment les contrastes sur 48 palettes dans chaque thème, les deux directions du geste, les diagnostics, le mouvement réduit et plusieurs tailles d'écran. Il ne prouve pas l'apparence des éléments natifs YouTube.

## Tests sur le site compilé

Dans un terminal, compiler puis laisser ouvert le serveur de prévisualisation :

```sh
npm run build
npm run preview
```

Dans un second terminal, sur macOS/Linux :

```sh
export SOUNDBLEND_URL=http://localhost:4173/
node verification/t-assistant631.mjs
node verification/t-assistant-erreurs631.mjs
node verification/t-pwa631.mjs
node verification/t-player630-rigoureux.mjs
```

Sous PowerShell, remplacer la première ligne par `$env:SOUNDBLEND_URL='http://localhost:4173/'`. `SOUNDBLEND_URL` choisit le site compilé pour ces tests ; sans elle, le test PWA et le test lecteur utilisent déjà le port 4173, tandis que les deux tests Assistant utilisent le serveur de développement sur 5173. Le test Assistant sauvegarde une capture de l'écran de composition.

Le test PWA active un **vrai service worker dans un profil temporaire** et recharge l'interface après avoir coupé le réseau. Le test lecteur utilise deux faux lecteurs YouTube, des horloges et des sauts asynchrones ; il ne prouve pas le comportement du service YouTube réel. Tous les scénarios Assistant, bibliothèque et Drive utilisent des réponses simulées, y compris l'essai sur 550 titres.

## Recherche d'exclusions réelle (facultatif)

```sh
node verification/t-exclusions-reel633.mjs
```

Ce test envoie les requêtes « Daft Punk One More Time » et « Daft Punk » à Piped. Il ajoute puis retire un titre et un artiste dans un profil navigateur temporaire, sans compte Google. La disponibilité des instances, les résultats et l'accès réseau peuvent varier ; un échec ne suffit pas à conclure que l'interface est défectueuse. Un essai ponctuel de cette version a reçu les deux résultats et réussi l'ajout et le retrait.

## Test YouTube réel (facultatif)

```sh
node verification/t-youtube-reel630.mjs
```

Ce test charge de vraies iframes YouTube et force la même vidéo d'exemple dans les deux lecteurs afin de comparer leurs horloges. Il a besoin d'Internet, peut échouer selon le réseau et ne vérifie ni un compte Premium ni les pixels dans tous les environnements. Ne pas le confondre avec le test simulé ci-dessus. L'essai de la 6.9.32 dans l'environnement de livraison n'a pas démarré et est non concluant. Une sonde séparée avec un seul lecteur visible a reçu une demande de connexion anti-robot de YouTube, sans prouver l'unique cause de l'échec de SoundBlend. Les tests, même réussis, ne valident pas la conformité aux règles YouTube : l'architecture existante avec deux lecteurs dont un caché doit être revue (voir le README principal).

Pour utiliser un navigateur Chromium déjà installé, définir `CHROMIUM_PATH` sur son exécutable ; sinon Playwright utilise son propre navigateur. Ces variables sont réservées aux tests.
