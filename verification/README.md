# Vérifications facultatives — SoundBlend 6.9.31

Ces tests utilisent Node.js, Playwright et Chromium. Ils ouvrent des profils de navigateur temporaires et simulent les API pour les parcours fonctionnels. Ils ne se connectent pas à ton compte Google et n'envoient pas de vraie requête Gemini. L'essai YouTube réel, optionnel et distinct, est décrit plus bas.

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
```

Ils visent par défaut `http://localhost:5173/`. Si le serveur utilise un autre port, régler `SOUNDBLEND_DEV_URL` sur son adresse. L'animation sauvegarde une capture dans `verification/captures/`. Le test de délai accélère à 100 ms un délai réseau de production de 12 secondes ; les requêtes sont simulées.

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

## Test YouTube réel (facultatif)

```sh
node verification/t-youtube-reel630.mjs
```

Ce test charge de vraies iframes YouTube et force la même vidéo d'exemple dans les deux lecteurs afin de comparer leurs horloges. Il a besoin d'Internet, peut échouer selon le réseau et ne vérifie ni un compte Premium ni les pixels dans tous les environnements. Ne pas le confondre avec le test simulé ci-dessus.

Pour utiliser un navigateur Chromium déjà installé, définir `CHROMIUM_PATH` sur son exécutable ; sinon Playwright utilise son propre navigateur. Ces variables sont réservées aux tests.
