# SoundBlend 6.9.37 — connexion Google

## Le correctif

Cette version corrige une course possible : Google peut signaler `popup_closed` avant de livrer une réponse valide. La 6.9.36 abandonnait immédiatement la tentative et ignorait alors cette réponse. La 6.9.37 attend le retour de Google pendant **trois minutes au maximum** et laisse annuler à tout moment. Une fois la réponse reçue, la vérification d'identité bénéficie de son propre délai ; un compte n'est activé qu'après cette vérification auprès de Google.

Les clics répétés ne lancent plus plusieurs tentatives ; une réponse provenant d'une tentative annulée ou d'un ancien compte est ignorée. Les erreurs sont affichées avec un code compréhensible, sans afficher le jeton ni les détails bruts de Google. Une bibliothèque connectée mais sans playlist n'affiche plus à tort « Connecter YouTube ». La génération et la synchronisation automatique de la 6.9.36 sont conservées.

**Limite importante :** la course a été reproduite avec la vraie bibliothèque Google et une fenêtre/réponse simulées ; l'ouverture de la vraie fenêtre Google a aussi été vérifiée sans connexion. **Aucun vrai compte n'a validé le parcours après consentement.** La cause exacte de ton échec peut donc encore dépendre de Google, du navigateur ou de la configuration de l'installation. Les avertissements COOP vus seuls dans la console ne suffisent pas à la déterminer.

## Choisir la bonne archive

- **`SoundBlend-v6.9.37-source.zip`** : le projet React/Vite complet, à utiliser si ton dépôt GitHub construit le site avec GitHub Actions. Il contient le workflow, pas `node_modules` ni `dist`.
- **`SoundBlend-v6.9.37-site-GitHub-SoundBlend.zip`** : le site déjà compilé pour `https://legralltitouan.github.io/SoundBlend/`, avec la base **`/SoundBlend/`**. Son contenu se dépose dans le dossier de publication d'un site statique, pas dans un sous-dossier `SoundBlend` supplémentaire.
- **`SoundBlend-v6.9.37-site-racine.zip`** : site compilé pour la racine **`/`** d'un autre domaine. Ne l'utilise pas tel quel pour le chemin GitHub Pages `/SoundBlend/`.

## Mettre à jour GitHub Pages

1. Sauvegarde le dépôt, tes personnalisations et les éventuelles modifications en attente sur les appareils. Ne supprime pas les données du navigateur.
2. Dans **GitHub → Settings → Pages**, vérifie comment ton site est publié. Si un workflow GitHub Actions construit la source, utilise l'archive **source** : compare et mets à jour les fichiers du projet à la racine du dépôt, en conservant ta configuration personnelle si tu l'as modifiée, notamment `src/config/app.ts`. Après ton commit et ton envoi, attends la fin de l'action « Publier sur GitHub Pages ».
3. Si, au contraire, GitHub Pages publie directement les fichiers statiques d'une branche ou d'un dossier configuré, utilise l'archive **site GitHub** dans ce dossier de publication. `index.html`, `assets/`, `sw.js` et les icônes doivent être publiés ensemble. Ne remplace pas à l'aveugle des fichiers sans rapport avec SoundBlend.
4. Sur chaque appareil, ouvre l'application **en ligne**, puis ferme et rouvre tous les onglets et fenêtres installées de SoundBlend. Dans Réglages, vérifie **v6.9.37**. Connecte ton compte et vérifie le nom, tes playlists et l'état de synchronisation. La synchronisation reprend automatiquement après une connexion vérifiée.

Pour reconstruire soi-même depuis la source : `npm ci`, puis `BASE_PATH=/SoundBlend/ npm run build`. Sous PowerShell : `$env:BASE_PATH='/SoundBlend/'; npm run build`. Il faut Node.js 20.19+ dans la série 20, ou 22.12+. L'origine du site doit être autorisée dans Google Cloud. Aucun déploiement ni transfert n'a été effectué automatiquement.

## Si la connexion échoue encore

- Si la fenêtre est encore ouverte, termine la validation. Si elle vient de se fermer après validation, attends quelques secondes : une réponse peut arriver tardivement.
- Si rien n'arrive, utilise **Annuler**, puis réessaie. Le message reste visible et indique un code, par exemple `popup_closed` ou `popup_failed_to_open`.
- Tu peux partager **uniquement ce code**, le navigateur utilisé et ce qui s'est passé ; masque les informations personnelles sur une capture. **Ne partage jamais ton mot de passe, ton jeton ou ta clé Gemini.** Ne vide pas les données, cookies ou caches de l'application pour cet essai.
- Si l'hébergeur impose réellement `Cross-Origin-Opener-Policy: same-origin`, il faut vérifier sa configuration HTTP selon les recommandations Google. GitHub Pages n'applique pas le fichier `_headers` ; une balise HTML ne remplace pas un en-tête HTTP.

## Vérifications et limites

- Campagne de régression avant les derniers ajustements du texte et du délai de vérification : **34 exécutions sources**, 586 contrôles comptés et un scénario à deux appareils ; **19 suites et 373 contrôles** sur chacun des sites compilés `/` et `/SoundBlend/`. Les contrôles peuvent se recouper.
- Après ces ajustements : **16 suites sources et 11 suites sur chacun des deux sites compilés**, toutes réussies, dont la connexion (**28/28**), les comptes, la génération et la migration PWA 6.9.36 → 6.9.37 (**10/10 à chaque base**). La vraie fenêtre Google s'est ouverte puis a été fermée volontairement sans exception (**4/4**), sans compte ni consentement.
- OAuth, identités, Drive, YouTube, Gemini et Piped restent majoritairement simulés. L'essai avec la bibliothèque GIS réelle utilise une fenêtre et des réponses fictives ; il ne prouve pas une authentification réelle, ni tous les navigateurs, services ou configurations.
- Compilation réussie aux deux bases ; lint : **0 erreur, 84 avertissements**. Au contrôle, `npm audit` indiquait 12 alertes élevées dans les dépendances de développement et aucune dans l'arbre de production ; ces résultats peuvent évoluer.

Les anciens espaces locaux non attribués restent séparés des comptes. La session, la conversation Assistant, la file et la position de lecture ne sont pas synchronisées. Supprimer un blend SoundBlend ne supprime pas sa playlist YouTube. La clé Gemini personnelle n'est pas intégrée au dépôt public ; les autres précautions figurent dans le `README.md` de la source.

Les empreintes des archives et de ce guide figurent dans `SHA256SUMS-v6.9.37.txt`. Les archives 6.9.35 et 6.9.36 sont restées intactes.
