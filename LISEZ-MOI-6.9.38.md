# SoundBlend 6.9.38 — retour au parcours Google 6.9.33

## Ce qui a été repris

À ta demande, cette version reprend la **configuration de la fenêtre Google de la 6.9.33**, tout en gardant la vérification du compte et la séparation des données introduites en 6.9.34. Les améliorations ultérieures, notamment la génération et la synchronisation automatique de la 6.9.36, sont conservées. Ce n'est donc pas un retour complet de l'application à la 6.9.33.

La comparaison montre que la 6.9.34 et la 6.9.36 ont le même code de connexion : dans un scénario simulé, toutes deux peuvent abandonner avant une réponse Google tardive. La 6.9.33 n'utilise pas le même gestionnaire de fermeture de fenêtre. En revanche, **si aucune réponse Google ne parvient à SoundBlend, aucune de ces versions ne peut se connecter**. Le message que tu as constaté en 6.9.37 correspond à une attente sans réponse exploitable ; il ne démontre pas pourquoi la réponse manque.

**Cette reprise est une tentative, pas une connexion réelle confirmée.** Je n'ai pas utilisé ton compte et n'ai pas pu valider le consentement Google. Les anciens sites chargent eux aussi la bibliothèque Google actuelle ; revenir au code ancien ne garantit donc pas le résultat.

Comme en 6.9.33, la fermeture ou le blocage de la fenêtre n'est pas détecté de façon fiable. L'application propose **Annuler** et cesse d'attendre au bout de trois minutes. Après réception d'une réponse, elle vérifie toujours l'identité et la durée du jeton avant d'activer le compte et la synchronisation.

## Quel fichier utiliser ?

- **`SoundBlend-v6.9.38-source.zip`** : le projet complet. C'est celui à utiliser si ton dépôt GitHub construit le site avec GitHub Actions. Il contient le workflow, mais pas `node_modules` ni le site compilé.
- **`SoundBlend-v6.9.38-site-GitHub-SoundBlend.zip`** : site compilé pour `/SoundBlend/`, uniquement si GitHub Pages publie directement des fichiers statiques.
- **`SoundBlend-v6.9.38-site-racine.zip`** : site compilé pour `/` sur un autre domaine. Ne l'utilise pas pour le chemin GitHub `/SoundBlend/`.

## Mise à jour de ton GitHub Pages

Le dépôt public dispose d'un workflow GitHub Actions : si c'est bien lui qui publie ton site, utilise **l'archive source**.

1. Sauvegarde le dépôt et les éventuelles modifications en attente sur tes appareils. **N'efface pas les données, cookies ou caches de SoundBlend.**
2. Décompresse l'archive source. Mets à jour, à la racine du dépôt, le **contenu** du dossier `SoundBlend-v6.9.38-source`, pas le dossier lui-même. Vérifie aussi les fichiers cachés, notamment `.github/` ; ne remplace pas le dossier `.git`. Compare les changements et conserve tes personnalisations, notamment `src/config/app.ts` si tu l'as modifié.
3. Fais le commit et l'envoi, puis attends la fin de l'action **Publier sur GitHub Pages**. Si tu publies les fichiers statiques directement plutôt qu'avec cette action, utilise l'archive **site GitHub** dans le dossier de publication, sans créer de sous-dossier `SoundBlend` supplémentaire.
4. Sur chaque appareil, ouvre SoundBlend en ligne, puis ferme et rouvre tous ses onglets et fenêtres installées. Dans **Réglages**, vérifie **v6.9.38** avant de changer de compte. Un ancien onglet peut continuer à exécuter son ancien code.
5. Reconnecte-toi au **même compte**, puis vérifie ton nom, tes playlists et l'état de synchronisation. Ne supprime aucune donnée locale tant que les données importantes ne sont pas vérifiées.

Aucun déploiement ni transfert n'a été effectué par cette livraison.

## Si la connexion reste bloquée

- Termine la validation si la fenêtre Google est encore ouverte. Si elle ne s'ouvre pas, autorise les fenêtres pour ce site, puis clique **Annuler** et réessaie.
- Si la fenêtre s'est fermée après validation et que SoundBlend reste en attente, attends environ 15 secondes et relève le code affiché. Il peut être `attente_sans_message_google` ou `attente_message_google`.
- Ces codes indiquent seulement si SoundBlend a observé un message provenant de `accounts.google.com` pendant l'attente. Un tel message n'est **pas nécessairement la réponse de connexion**. Le diagnostic ne lit ni ne stocke le contenu de ce message et ne déduit aucune connexion.
- Clique **Annuler** pour libérer le bouton. Si le problème continue, transmets-moi **seulement le code affiché**, le navigateur et ce qui s'est passé. Ne partage jamais ton mot de passe, ton jeton ou ta clé Gemini. Il n'est pas nécessaire d'effacer les données du navigateur pour cet essai.

## Vérifications et limites

- Comparaison des sites 6.9.33, 6.9.34 et 6.9.37 : **25/25 contrôles** avec la vraie bibliothèque GIS, mais des fenêtres et réponses fictives. Dans le scénario sans réponse, les trois versions restent déconnectées.
- Version 6.9.38 : **20 suites sources**, 360 contrôles comptés et un scénario à deux appareils ; **14 suites et 226 contrôles** sur chacun des deux sites compilés. Les contrôles peuvent se recouper. La connexion compte **30/30** par environnement ; GIS réel avec fenêtre et réponses fictives : **12/12** par environnement. Le bandeau et son bouton sont aussi vérifiés à 320 et 390 px.
- Mises à jour PWA depuis les 6.9.33, 6.9.34 et 6.9.37 : **11/11** à la racine et **11/11** sous `/SoundBlend/` pour chaque ancienne version, avec comptes et données fictifs.
- La vraie fenêtre Google s'est ouverte, puis a été fermée volontairement : **4/4** contrôles, sans connexion ni consentement. Drive, YouTube, OAuth après consentement et Gemini restent simulés : cela ne prouve pas que ton compte se reconnectera.
- Compilation des deux bases réussie ; lint **0 erreur, 84 avertissements**. Au contrôle, `npm audit` signalait 12 alertes élevées dans les dépendances de développement et aucune dans l'arbre de production ; ces résultats évoluent.

Les anciennes données locales non attribuées restent séparées des comptes. La session, la conversation Assistant, la file et la position de lecture ne sont pas synchronisées. Supprimer un blend SoundBlend ne supprime pas sa playlist YouTube. La clé Gemini personnelle ne doit pas être ajoutée au dépôt public.

Les empreintes des archives et de ce guide figurent dans `SHA256SUMS-v6.9.38.txt`. Les versions précédentes restent disponibles séparément.
