# SoundBlend 6.9.36 — génération et synchronisation

Cette version corrige le remplissage des blends et retire le bouton « Synchroniser maintenant ». Les archives 6.9.35 restent séparées et inchangées.

## Ce qui change

- Si une catégorie n'est pas suffisamment remplie, l'application cherche d'abord des propositions déjà disponibles, puis complète avec des **piliers et des découvertes** selon les parts choisies. Si aucun autre pilier n'est disponible, elle essaie davantage de découvertes ; si les découvertes manquent, elle essaie les piliers restants. Les exclusions, l'historique et les doublons restent contrôlés.
- Si la proportion choisie prévoit plus de piliers qu'il n'y a d'amorces, les places impossibles sont demandées en découvertes. L'écran de réglage l'indique ; le bilan conserve la répartition choisie avant ce plafonnement.
- Un **bilan conservé avec le blend** indique les catégories manquantes, les compléments et le nombre réellement enregistré. Si une limite Gemini HTTP 429 a réellement perturbé la génération, il le dit, y compris lorsque les remplacements ont permis d'atteindre le nombre total. Un 429 peut signaler un quota **ou une limite de débit**. Si aucun titre ne peut être conservé, aucun blend vide n'est créé et le diagnostic reste visible pour un nouvel essai.
- Les requêtes `youtube.com/oembed` en erreur 400 ou 404 vues sur la capture concernent YouTube ; **elles ne démontrent pas un quota Gemini**. Une vérification de métadonnées ne garantit pas non plus la lecture de la vidéo pour tous les comptes ou pays.
- La **synchronisation est automatique** après les modifications, à l'ouverture et au retour au premier plan. Les changements distants sont aussi recherchés périodiquement tant que l'application reste ouverte et connectée. Une erreur temporaire est réessayée ; si les autorisations ou la session ont expiré, il faut les réactiver dans Réglages. L'état de synchronisation reste visible.

Le secours par voisinage utilise des recherches YouTube via des instances Piped publiques : il ne garantit ni la disponibilité ni la qualité des résultats. Les découvertes de voisinage ne sont pas garanties conformes à une consigne libre ; lorsque ce cas se présente, le bilan le précise. Si aucune piste admissible supplémentaire n'est trouvée, le blend peut rester plus court que l'objectif. La durée choisie donne un nombre estimé de titres, pas une durée exacte.

## Mettre à jour

1. Sauvegarde ton projet, tes configurations et les éventuelles modifications en attente sur les appareils.
2. **Source :** décompresse `SoundBlend-v6.9.36-source.zip`, puis exécute `npm ci` et `npm run dev` dans le dossier extrait. Node.js 20.19 ou plus dans la série 20, ou 22.12 ou plus, est nécessaire. Pour un dépôt existant, compare les fichiers et conserve tes personnalisations, notamment `src/config/app.ts` si tu l'as modifié.
3. **Site compilé :** `SoundBlend-v6.9.36-site.zip` est destiné à la racine `/` d'un domaine et doit être servi par un hébergeur, pas ouvert en `file://`. Pour GitHub Pages sous `/SoundBlend/`, recompile la source avec `BASE_PATH=/SoundBlend/ npm run build`. L'origine utilisée pour OAuth doit être autorisée dans Google Cloud.
4. Déploie tous les fichiers du site ensemble. Sur **chaque appareil**, ouvre l'application en ligne, puis ferme et rouvre tous les onglets et fenêtres installées. Vérifie **v6.9.36** dans Réglages, reconnecte-toi si nécessaire et contrôle tes données et l'état de synchronisation.

Les anciennes données locales sans compte restent séparées des comptes ; la session, la conversation de l'Assistant, la file et la position de lecture ne sont pas synchronisées. Supprimer un blend dans SoundBlend ne supprime pas sa playlist YouTube. Drive ne fournit pas ici de verrou atomique : après des changements simultanés, laisse les appareils connectés pour qu'ils se relisent. Une ancienne version qui a déjà mélangé les données de comptes ne peut pas être corrigée automatiquement par cette mise à jour.

Aucun déploiement ni transfert GitHub, Dropbox ou Google Drive n'a été effectué pour cette version. Les deux archives et ce guide peuvent être vérifiés avec `SHA256SUMS-v6.9.36.txt`.

## Vérifications et limites

- Compilation réussie à `/` et sous `/SoundBlend/` ; lint : **0 erreur, 84 avertissements**. La compilation signale notamment l'usage de `__dirname` dans la configuration Vite et un fichier JavaScript volumineux.
- **30 suites sur les sources**, plus une variante du parcours de génération avec exclusion tardive : **31 exécutions réussies, 541 contrôles comptés**, ainsi qu'un scénario à deux appareils. Les contrôles comprennent des répétitions et ne constituent pas autant de garanties indépendantes.
- **17 suites sur le site compilé pour chaque base**, soit **339 contrôles à `/` et 339 sous `/SoundBlend/`**. La migration PWA réelle de l'ancien site compilé 6.9.35 vers le nouveau a réussi **10/10** à chaque base, avec simulation d'un téléchargement incomplet et vérification du cache hors ligne.
- **Gemini, Drive, YouTube, OAuth et Piped ont été simulés** pour ces parcours : aucun vrai compte ni aucune clé réelle n'ont validé leur comportement. Les essais ne garantissent ni la disponibilité des services, ni une fusion Drive atomique, ni tous les navigateurs et appareils.
- `npm audit` signalait **12 vulnérabilités élevées dans les dépendances de développement**, liées à l'avis [picomatch GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). L'audit des dépendances de production n'en signalait aucune lors de ce contrôle, sans garantir la sécurité du site. Ne lance pas `npm audit fix --force` sans étudier les changements incompatibles.

**Avant diffusion :** l'intégration YouTube héritée utilise notamment un lecteur audio masqué et un second lecteur vidéo muet. Sa conformité aux règles YouTube n'est pas acquise ; cette version ne la corrige pas. La clé Gemini personnelle est enregistrée en clair dans le navigateur et peut être synchronisée dans le fichier privé de l'application sur Drive. Les autres précautions, coûts et conditions des services sont détaillés dans le `README.md` de la source.
