# SoundBlend 6.9.35 — nouvel assistant

Cette version ajoute un assistant conversationnel, le dialogue vocal Gemini Live, la recherche musicale et Web, et des propositions de modifications de playlists. Les archives 6.9.34 restent séparées et inchangées.

## Utilisation rapide

1. Ouvre **Réglages** et saisis ta clé Gemini personnelle. Connecte ton compte Google si tu veux utiliser tes playlists ou rechercher des titres sur YouTube. Les droits d'accès, quotas et modèles disponibles dépendent de ta clé et de Google.
2. Dans **Assistant**, écris ton idée ou clique **Démarrer le vocal**. Le vocal nécessite HTTPS, un navigateur compatible et l'autorisation d'utiliser le microphone. Il s'arrête lorsque tu quittes la vue, passes l'application en arrière-plan ou changes de compte. Tu peux aussi couper le micro ou arrêter la session.
3. Pour rechercher des informations, coche **Wikipédia** ou **Recherche Web Google** avant d'envoyer ta question. Le choix est explicite et les deux modes sont exclusifs. Google Search peut être facturé ; vérifie les sources et les tarifs. En vocal, une recherche Web affiche sa réponse et ses sources à l'écran : elle n'est pas lue automatiquement.
4. Pour un **blend**, vérifie les sources et la consigne puis clique **Générer ce blend**. Pour une **playlist**, contrôle l'aperçu, choisis **modifier l'originale** ou **créer une copie privée**, puis confirme. Une simple discussion ou confirmation orale ne lance pas l'action.

Une proposition accepte au maximum cinq ajouts et 25 changements ; la copie privée est limitée à 150 titres. Les titres YouTube ajoutés comportent un lien de vérification. Les exclusions sont contrôlées avant l'ajout ; une copie conserve toutefois les titres déjà présents sur l'originale, même s'ils sont exclus. Si la playlist contient des éléments inaccessibles ou si une modification concurrente est détectée, l'opération est bloquée.

**Après une panne ou une interruption**, les écritures YouTube peuvent être partielles : vérifie la playlist directement sur YouTube avant une nouvelle tentative. Le journal d'une copie empêche une recréation silencieuse et conserve son lien si celui-ci a pu être reçu ; ne l'efface qu'après vérification. Les opérations ne sont pas atomiques : un changement sur un autre appareil peut encore intervenir entre la vérification et l'écriture.

## Confidentialité et coûts

Le vocal utilise **directement dans le navigateur** ta clé Gemini personnelle : aucun serveur supplémentaire ni token éphémère n'a été ajouté. La voix et un résumé de ton contexte musical sont envoyés à Google pendant la session. La clé est enregistrée en clair dans le navigateur et peut être synchronisée dans le fichier privé de l'application sur Google Drive ; protège l'accès au navigateur et au compte Drive, restreins la clé et surveille les quotas.

La conversation et les noms, titres et exclusions nécessaires sont transmis à Gemini. La recherche Wikipédia envoie son sujet à Wikipédia ; la recherche Web envoie ta question à Google Search via Gemini. Google indique conserver les prompts, le contexte et les réponses de ce dernier service pendant 30 jours pour son fonctionnement et ses contrôles. Les réponses et suggestions Web restent en mémoire dans l'onglet, ne sont pas enregistrées de façon persistante et ne commandent pas automatiquement les actions musicales. La conversation n'est pas synchronisée et est effacée lors d'un changement de compte.

Consulte les [conditions Gemini API](https://aistudio.google.com/docs/terms), les [conditions de Google Search](https://aistudio.google.com/docs/terms#grounding-with-google-search) et les [tarifs](https://ai.google.dev/gemini-api/docs/pricing). Les conditions indiquent notamment un usage professionnel ou commercial, une limite d'âge de 18 ans et des exigences de services payants lorsque des clients API sont mis à disposition dans l'EEE, en Suisse ou au Royaume-Uni. Les quotas, les frais et les règles peuvent évoluer ; vérifie-les avant de diffuser l'application.

## Mettre à jour

1. Sauvegarde ton projet et tes configurations. Vérifie les données et les synchronisations en attente sur chaque appareil.
2. **Source :** décompresse `SoundBlend-v6.9.35-source.zip`, puis lance `npm ci` et `npm run dev` dans le dossier extrait. Node.js 20.19 ou plus dans la série 20, ou 22.12 ou plus, est nécessaire. Pour un dépôt existant, compare les changements et conserve ta configuration personnalisée, notamment `src/config/app.ts` et ton workflow.
3. **Site compilé :** `SoundBlend-v6.9.35-site.zip` est construit pour la racine `/` d'un domaine et doit être servi par un hébergeur, pas ouvert directement en `file://`. Pour GitHub Pages sous `/SoundBlend/`, recompile la source avec `BASE_PATH=/SoundBlend/ npm run build`. Les origines utilisées pour OAuth doivent être autorisées dans Google Cloud.
4. Déploie tous les fichiers ensemble. Sur **chaque appareil**, ouvre l'application en ligne, puis ferme et rouvre tous les onglets et fenêtres installées. Vérifie **v6.9.35** dans Réglages avant de changer de compte. Reconnecte-toi si nécessaire et contrôle les données et la synchronisation.

Les anciennes données locales sans compte restent séparées, sans import automatique dans un compte ; la session et la conversation ne sont pas synchronisées. Supprimer un blend dans SoundBlend ne supprime pas sa playlist YouTube. Si une ancienne version a déjà mélangé des données de comptes dans Drive, cette mise à jour ne peut pas en reconstituer automatiquement la provenance.

Aucun script `.bat` de mise à jour automatique n'est fourni. Aucun déploiement ni envoi sur GitHub, Dropbox ou Google Drive n'a été effectué pour cette version. Les archives et ce guide peuvent être vérifiés avec `SHA256SUMS-v6.9.35.txt`.

## Vérifications et limites

- Compilation réussie ; lint : **0 erreur, 85 avertissements**. Les avertissements de compilation concernent notamment `__dirname` dans la configuration Vite et un gros fichier JavaScript.
- **25/25 suites sur les sources**, dont **445 contrôles comptés** et un scénario supplémentaire à deux appareils. Les nouvelles suites couvrent notamment les modifications de playlists (38/38), le vocal avec micro Chromium factice (25/25) et la recherche Web (34/34).
- **15/15 suites sur le site compilé**, soit **319 contrôles à la racine** et **319 sous `/SoundBlend/`**, y compris la migration PWA 6.9.34 → 6.9.35 : 10/10 à chaque chemin. Ces nombres comprennent des répétitions, pas des contrôles uniques à additionner.
- **Gemini Live, Google Search, Drive et YouTube ont été simulés : aucun compte ou clé réelle n'a validé ces parcours.** La disponibilité réelle des modèles, des recherches, du vocal et des modifications reste à vérifier avec tes propres accès ; les tests ne garantissent ni la synchronisation atomique ni tous les navigateurs.
- `npm audit` signale **12 vulnérabilités élevées dans les dépendances de développement**, liées à l'avis [picomatch GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). L'audit des seules dépendances de production n'en signalait aucune lors de ce contrôle, sans garantir la sécurité du site. Ne lance pas `npm audit fix --force` sans étudier les changements incompatibles.

**Avant diffusion :** le lecteur YouTube hérité utilise un lecteur audio masqué et un second lecteur vidéo muet. Sa conformité aux règles YouTube n'est pas acquise ; cette version ne le corrige pas. Les liens officiels et les autres limites sont détaillés dans le `README.md` de la source.
