# Vérifier le lecteur (optionnel)

Ces essais nécessitent Node.js, le serveur de prévisualisation SoundBlend et Playwright avec Chromium. Depuis la racine du projet :

```sh
npm install
npm run build
npm run preview
```

Dans un second terminal :

```sh
npm install --no-save --no-package-lock playwright@1.65.0
npx playwright install chromium
node verification/t-player630-rigoureux.mjs
node verification/t-youtube-reel630.mjs
```

Le premier test simule **deux** lecteurs distincts, des horloges et des seeks asynchrones. Il ne vérifie pas YouTube lui-même. Le second charge de vraies iframes YouTube, mais force la même vidéo d'exemple dans les deux lecteurs pour que les horloges soient comparables ; il nécessite Internet et peut ne pas aboutir selon le réseau. Il ne prouve ni l'affichage des pixels en navigateur sans écran, ni la reconnaissance d'un compte Premium.

Par défaut les tests visent `http://localhost:4173/`. Pour un autre serveur, définir `SOUNDBLEND_URL`. Pour une installation Chromium particulière, définir `CHROMIUM_PATH` ; sinon Playwright utilise son navigateur installé. Ces deux variables sont uniquement destinées aux tests, pas à la configuration de SoundBlend.
