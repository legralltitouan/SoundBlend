# SoundBlend 6.9.33 — exclusions

## Ce qui change

- Le bouton de bannissement ouvre une feuille animée depuis le bas, y compris depuis le grand lecteur. Les choix « cette musique » et « cet artiste » restent indépendants.
- Dans Réglages → Exclusions, deux boutons ouvrent la même feuille : « Afficher la liste des exclusions » et « Ajouter une exclusion ». Ce dernier place directement le focus sur le champ de recherche.
- Deux onglets séparent les musiques et les artistes. On peut rechercher dans ses exclusions, les débloquer et ajouter un résultat du catalogue YouTube Music. Les doublons sont signalés ; les exclusions continuent d'utiliser le stockage et la synchronisation existants.
- Le retour Android, le clavier, les écrans courts, les thèmes et la préférence de mouvement réduit ont été pris en compte. Deux corrections annexes concernent l'avatar lors d'une connexion sans rechargement et la fermeture du lecteur si la hauteur de l'écran change pendant sa descente.

## Recherche et confidentialité

La recherche du catalogue passe par les filtres musicaux d'instances **Piped publiques indépendantes**, et non par une API officielle YouTube Music. La requête leur est transmise ; aucun jeton Google ni aucune clé Gemini ne leur est envoyé par cette recherche. Internet et la disponibilité de ces services sont nécessaires. Une panne est signalée avec un bouton pour réessayer.

Les exclusions sont rapprochées notamment par nom d'artiste et par titre : des homonymes ou certaines variantes d'un morceau peuvent être regroupés. Musique et artiste restent deux décisions et deux déblocages distincts.

## Utiliser les fichiers

- **`SoundBlend-v6.9.33-source.zip`** : projet source complet, workflow GitHub et tests, sans dépendances ni site compilé. Décompresse-le, puis dans le dossier `SoundBlend-v6.9.33-source` extrait : `npm ci`, puis `npm run dev`. Node.js 20.19 ou plus dans la série 20, ou 22.12 ou plus, est nécessaire.
- **`SoundBlend-v6.9.33-site.zip`** : fichiers du site compilé pour être servis à la **racine `/`** d'un domaine. Ils doivent être servis par un hébergeur ou serveur web, pas ouverts directement en `file://`. Ce n'est pas le bon paquet précompilé pour un site dans un sous-dossier GitHub Pages.

Pour mettre à jour un dépôt existant, sauvegarde tes modifications, compare les fichiers de la nouvelle source et conserve ta configuration personnalisée (en particulier `src/config/app.ts` si tu l'as modifiée) et ton workflow. Compile et vérifie le diff avant d'effectuer toi-même le commit et l'envoi. Pour GitHub Pages, le workflow fourni recompile avec la base correspondant au dépôt. Le `README.md` et `deploy/TUTO-GITHUB.md` donnent davantage de détails. **Aucun script `.bat` de mise à jour automatique n'est fourni pour cette version.**

Les données déjà stockées dans le navigateur restent liées à l'origine du site. Avant tout déploiement, sauvegarde tes données et ta configuration. Aucun fichier n'a été envoyé sur GitHub, Dropbox ou Google Drive dans le cadre de cette modification ; les anciennes archives 6.9.32 n'ont pas été remplacées.

## Vérifications et limites

- Compilation TypeScript/Vite réussie ; lint sans erreur, avec 80 avertissements dans le projet.
- **51/51** contrôles Exclusions et gestes du lecteur ; **4/4** connexion/avatar ; **236/236** contrôles de régression, dont **9/9** PWA hors ligne. La plupart des services et lecteurs sont simulés.
- Sous `/SoundBlend/` : **51/51** Exclusions, **4/4** connexion/avatar et **9/9** PWA avec services simulés.
- Un essai ponctuel avec Piped réel a retrouvé « One More Time » et Daft Punk, puis vérifié ajout et retrait dans un profil temporaire. Cela ne garantit pas la disponibilité future du service ni les résultats pour tous les pays ou tous les noms.
- La synchronisation Drive, la connexion Google et le lecteur ont été testés principalement avec des services simulés, pas avec ton compte. L'essai antérieur du vrai lecteur YouTube était non concluant.

**Avant diffusion :** l'intégration YouTube héritée utilise un lecteur audio masqué et un second lecteur vidéo muet ; sa conformité aux règles YouTube n'est pas acquise. La présente modification ne la corrige pas. Voir l'avertissement et les liens officiels dans le `README.md` du projet.
