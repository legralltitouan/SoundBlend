# Assistant — V3, références YouTube (archive)

> La version actuelle est décrite dans `ASSISTANT-V4.md` : panneau inspiré des exclusions, recherche temporisée, tags colorés sans guillemets et démarrage Live mobile renforcé. La suite V3 ci-dessous reste archivée ; utiliser `t-assistant-mentions-v4.mjs` sur la version actuelle.

Cette version complète la V2. La navbar, le Shell, les autres vues, les dépendances et le générateur partagé restent inchangés.

## Ce qui change

- **« + » à gauche du composeur** : ouvre une fenêtre de recherche YouTube, et non un menu sans fonction.
- Deux onglets : **Morceaux** (vidéos de la catégorie musicale YouTube) et **Artistes** (chaînes YouTube). Une chaîne n’est pas présentée comme un artiste officiellement certifié. Un lien permet de vérifier chaque résultat sur YouTube.
- Recherche explicite par Entrée ou loupe : aucune requête à l’ouverture ni à chaque caractère. La fenêtre indique l’utilisation du quota API.
- Sélection multiple, jusqu’à huit références. Les choix sont insérés immédiatement dans le brouillon, avec un texte `#«Titre · Artiste»` ou `@«Nom»` et une puce retirable. Le bouton « Ajouter au message » referme la fenêtre et replace le focus dans le champ. Échap conserve les choix déjà insérés.
- Retirer une puce retire son token. Supprimer/modifier un token dans le texte retire la référence structurée correspondante. Un `@nom` saisi librement n’est jamais converti en référence YouTube vérifiée.
- Les versions homonymes sont distinguées par leurs identifiants, non par leurs noms. Si deux résultats ont exactement le même token lisible, leurs deux références restent distinctes ; retirer une puce conserve le token tant que l’autre est présente. Effacer ce token retire les deux.
- **Live à droite, avant Envoyer**. Le bouton d’interruption peut s’intercaler pendant une réponse. Le composeur fixe, son décalage au-dessus de la navbar/du lecteur et la présentation minimale V2 sont conservés.

## Contexte réellement envoyé

Chaque message utilisateur envoyé conserve ses références structurées en mémoire : identifiant vidéo ou chaîne, nom, artiste/chaîne, titre YouTube brut et token associé. Le sérialiseur Gemini inclut ces données dans le contexte de conversation, y compris lors des relances dans la fenêtre d’historique retenue. Il ne s’agit pas d’une simple décoration visuelle du prompt.

Les morceaux peuvent servir d’amorces précises pour une **proposition** de blend. Les exclusions existantes restent appliquées aux titres nettoyés et aux métadonnées brutes. Une référence bloquée peut être discutée mais n’est pas utilisée comme amorce autorisée. Les liens des références envoyées restent consultables dans les messages.

Le Live reçoit les références de la conversation récente et celles du brouillon au démarrage. Une demande vocale de préparation transmet aussi les références du brouillon à la préparation textuelle. Les règles vocales interdisent de les lire comme des identifiants ou de les traiter comme une autorisation d’exécution.

Aucune lecture audio, génération, modification YouTube ou sauvegarde de conversation n’est déclenchée par la sélection. Les boutons de confirmation et les protections existantes restent nécessaires. La fenêtre de confidentialité mentionne les références et le contexte Live.

## Recherche et protection des données

- Utilise le jeton OAuth YouTube actif ; à défaut, la clé API YouTube des réglages. Sans l’un ou l’autre, un message explique la configuration nécessaire.
- Appel direct à l’API YouTube, sans nouveau serveur, dépendance ou cache persistant. Clé dans l’en-tête, pas dans l’URL ; requêtes sans cookies ni référent.
- Recherche annulable, délai de 12 secondes, contrôle de session et de portée de compte avant/après la réponse. Les réponses devenues obsolètes ne repeuplent pas la fenêtre.
- Gestion des résultats vides, absence de clé, quota/refus, session expirée, réseau indisponible et réponses invalides. Un 401 invalide uniquement le jeton concerné.
- Identifiants et miniatures validés ; résultats dédupliqués ; métadonnées affichées comme texte, jamais comme HTML.
- À la fermeture de la fenêtre : requête annulée, résultats libérés. Au changement de compte : fenêtre fermée, références, messages et brouillon effacés. Pas de persistance des références dans le stockage local.

## Validation exécutée

| Vérification | Résultat |
| --- | --- |
| TypeScript + compilation Vite | Réussi |
| Lint du dépôt | 0 erreur, 83 avertissements préexistants |
| Suite V3 `t-assistant-mentions.mjs` | 49 contrôles, dont 5 scans axe, tous réussis |
| Non-régression interface V2 | 58 contrôles réussis |
| Non-régression sécurité | 33 contrôles réussis |
| Non-régression Live | 26 contrôles réussis |
| Non-régression génération | 21 contrôles réussis |
| Axe accueil/conversation/Live/confidentialité | 8 scans sans violation détectée |
| PWA : première ouverture des vues hors ligne | Réussi sur le build V3 |
| Échec de chargement d’une vue différée | Navigation et coque préservées |
| `git diff --check` | Réussi |

Au total : **182 contrôles fonctionnels et 13 scans axe**, plus les deux suites PWA. Les tests V3 vérifient notamment le payload réel du sérialiseur Gemini, les relances, le contexte Live, la suppression des références, les identifiants précis, la limite de sélection, les annulations, les exclusions, les quotas, l’authentification et le changement de compte.

Dimensions : 320×568, 390×844, 768×1024 et 1440×1000 ; thèmes clair/sombre. Les captures de la livraison montrent la recherche et le composeur. Le dialogue est natif : focus captif, Échap, clic extérieur et verrouillage du défilement. Réduction des animations respectée.

### Limites des vérifications

Les API YouTube/Gemini sont simulées. Aucun compte réel, quota réel, modification de playlist réelle ou déploiement n’a été utilisé. Le test V3 du contexte Live intercepte le démarrage de la session ; la suite Live existante exerce le graphe audio Chromium avec microphone factice et WebSocket simulé. Le clavier mobile est simulé, pas validé sur du matériel Safari/iOS. Les audits automatisés ne constituent pas une certification d’accessibilité. L’avertissement Vite de taille du chunk principal demeure.

Une exécution excessivement parallèle des navigateurs a atteint les délais de chargement locaux ; les suites ont ensuite été relancées séquentiellement avec succès. Les API externes réelles restent à vérifier avec les clés et comptes de l’utilisateur.

## Fichiers V3

- `src/services/assistantMentions.ts` (nouveau)
- `src/components/views/AssistantMentionPicker.tsx` (nouveau)
- `src/components/views/AssistantView.tsx`
- `src/components/views/AssistantView.css`
- `src/components/views/AssistantPrivacy.tsx`
- `src/services/gemini.ts`
- `src/services/geminiLive.ts`
- `verification/t-assistant-mentions.mjs` (nouveau)
- Rapports : ce document, et mention d’archivage du rapport V2.

## Reproduire / appliquer

```sh
npm ci
npm run dev
```

Pour les tests, installer temporairement Playwright et axe sans modifier le lockfile, puis lancer les suites **séquentiellement** :

```sh
npm install --no-save --package-lock=false playwright@1.65.1 @axe-core/playwright@4.13.0
npx playwright install --with-deps chromium
node verification/t-assistant-mentions.mjs
node verification/t-assistant-refinement.mjs
node verification/t-assistant-refinement-safety.mjs
node verification/t-assistant-refinement-live.mjs
node verification/t-assistant-studio-generation.mjs
node verification/axe-assistant-refinement.mjs
```

Vite sur 5173 par défaut (`SOUNDBLEND_DEV_URL`). Pour les deux suites PWA, compiler puis servir le build sur 4173. Les rapports V1/V2 sont conservés pour historique, mais ce rapport décrit la livraison actuelle.

- ZIP V3 : projet complet prêt à installer, hors dépendances, secrets et build généré.
- Patch **V2 → V3** : à appliquer sur l’archive V2 livrée précédemment.
- Patch complet : à appliquer au commit de départ `51f92aa586dfc63119f697acf1ec8781128355e1`.

Le numéro de release et le service worker ne sont pas modifiés. Publier tout `dist` après compilation selon le processus de release habituel ; les tests PWA utilisent une installation propre, pas une migration d’une ancienne installation. Aucun commit, push GitHub ni déploiement n’a été effectué.
