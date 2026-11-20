# Assistant V11 — discussions sauvegardées et synchronisées (archive)

> Voir `ASSISTANT-V11.1.md` pour le correctif de continuité de la réflexion pendant la navigation et des états d’attente bloqués.

## Demande et choix retenu

Conserver la discussion quand on quitte l’Assistant, laisser finir une demande Gemini pendant la navigation et retrouver les trois dernières discussions sur les appareils connectés au même compte Google.

Le choix confirmé est **sans serveur supplémentaire**. La tâche continue tant que le navigateur de départ peut exécuter l’application. Une fermeture, un rechargement ou une suspension du processus peut l’interrompre : Drive conserve les données mais n’exécute pas Gemini à la place du navigateur. Dans ce cas, une relance explicite est proposée, jamais un renvoi automatique.

## Ce qui change

### Le bouton « + » en haut à droite

Il ouvre **Tes discussions**, un dialogue dans le style de la confidentialité et des sélecteurs existants :

- bouton **Nouvelle discussion** ;
- les **trois dernières discussions, discussion courante comprise** ;
- titre issu du premier message, date d’activité et nombre de messages ;
- sélection du fil à recharger ;
- statut de synchronisation et bouton **Actualiser**.

Une nouvelle discussion n’efface pas immédiatement l’ancienne. Une discussion vide n’occupe pas de place ; un brouillon commencé peut être conservé. À partir d’une quatrième discussion enregistrée, seules les trois plus récemment modifiées restent dans l’historique. Le choix du fil actif reste propre à chaque appareil : la navigation d’un appareil ne change pas arbitrairement le fil choisi sur un autre.

Le dialogue prend en charge le focus captif, Échap, la fermeture par le fond et la restitution du focus. Le composeur reste fixé en bas. La navbar n’a pas été modifiée et aucun bouton d’historique de blends n’a été réintroduit dans le header.

### Sauvegarde locale par compte

Sont conservés :

- les messages texte, avec identifiants stables et ordre logique ;
- les références YouTube et les résultats musicaux affichés ;
- le brouillon de saisie et ses références ;
- l’aperçu de création de blend et ses réglages (sources, sélection, consigne, durée) ;
- l’état de la dernière demande : lancée, terminée, en erreur ou interrompue.

Limites annoncées dans le dialogue : **3 discussions et jusqu’à 120 messages par discussion**. Les messages enregistrés sont bornés à 16 000 caractères chacun et les collections de références/résultats sont bornées. Le sérialiseur n’inclut ni audio, ni contrôleur de tâche, ni jeton OAuth, ni copie des clés de réglages dans la structure de l’historique. Les informations que l’utilisateur écrit lui-même dans ses messages sont, naturellement, enregistrées comme texte.

Les discussions du compte A, du compte B et de l’espace local déconnecté restent séparées. Les discussions de l’espace déconnecté ne sont pas importées automatiquement dans un compte lors de la connexion. Le changement de compte bloque les réponses tardives de l’ancien compte.

Si localStorage est plein ou inaccessible, le fil reste disponible en mémoire et peut encore être synchronisé tant que la page vit ; un avertissement explicite évite de promettre une persistance locale inexistante.

### Synchronisation dans `appDataFolder`

L’historique est intégré au fichier privé **`soundblend.json`** déjà synchronisé par l’application, sous le champ optionnel **`assistantConversations`**. Il ne crée pas de fichier dans les documents ordinaires de l’utilisateur et n’élargit pas les autorisations Google.

Le moteur existant est réutilisé :

- envoi différé après le geste local (environ 2,5 secondes de calme) ;
- récupération à la connexion et lors des synchronisations de premier plan ;
- actualisation en ouvrant le panneau des discussions ou avec son bouton ;
- veille existante et nouvel essai après une panne ;
- lorsqu’un fil affiche une demande lancée ailleurs, relecture toutes les 15 secondes si la page est visible et connectée ;
- contrôle du compte/de la session à chaque reprise asynchrone ;
- validation du fichier avant fusion, précontrôle avant écriture et relecture avant acquittement.

Il s’agit d’une synchronisation **éventuelle**, pas d’un système temps réel. Hors ligne ou sans session Google valide, le fil reste local et en attente. L’app n’annonce pas une synchronisation réussie sans confirmation du cycle Drive.

Le fichier conserve également les données déjà gérées par l’application, dont la politique existante de synchronisation des réglages ; cette livraison ne modifie pas cette politique. L’exclusion des clés mentionnée ci-dessus concerne la nouvelle structure d’historique.

### Fusion de deux appareils

Les messages possèdent des identifiants stables. Pour un même fil, la fusion conserve l’union des messages, puis applique la borne des 120 derniers, sans dupliquer ceux déjà présents sur les deux appareils. Les réglages/brouillons utilisent la version logique la plus récente du fil. Des tâches distinctes ont leurs propres identifiants ; un état terminé ne régresse pas vers une ancienne attente du même calcul. L’ordre logique tient compte d’un appareil dont l’horloge serait en retard.

Ce mécanisme ne constitue pas une transaction distribuée ni une garantie d’exécution Gemini exactement une fois entre appareils. Deux relances explicites peuvent lancer deux calculs et consommer deux quotas. Les gardes Drive existantes ne permettent pas non plus de promettre qu’une course distante parfaitement simultanée est atomiquement verrouillée. La relecture et les fusions suivantes sont nécessaires à la convergence.

### Gemini continue quand on quitte la vue

La préparation tapée au clavier utilise désormais le même principe de tâche indépendante du montage de la vue que la préparation vocale V8. Le gestionnaire suit les tâches **par discussion** au lieu de ne conserver qu’une seule préparation globale.

- Aller dans les Réglages ne coupe plus la demande textuelle déjà acceptée.
- Revenir pendant le calcul recharge le message, l’étape connue et le bouton d’arrêt.
- Revenir après la fin restaure la réponse et l’aperçu sans nouvel appel Gemini.
- Ouvrir une nouvelle discussion pendant le calcul est possible ; le résultat de A reste dans A et ne s’affiche pas dans B.
- Quitter le Live continue de fermer les dispositifs micro/son. Le moteur de capture audio lui-même est inchangé.

Sur un autre appareil, l’app affiche honnêtement qu’une demande a été lancée ailleurs : **elle ne montre pas un faux calcul local**. Son résultat est récupéré après synchronisation. Si la page d’origine a été détruite ou ne peut plus exécuter le calcul, **Relancer la demande ici** prépare une nouvelle réponse seulement après un clic. Une relance vocale textuelle ne rouvre pas automatiquement le micro.

La V9 conserve son absence de coupure globale arbitraire à 90 secondes et son garde-fou d’inactivité réseau. Aucun serveur de tâches n’a été ajouté.

### Une restauration ne vaut jamais confirmation

Les messages et les aperçus de création peuvent être restaurés. En revanche, un ancien aperçu de **modification de blend ou de playlist n’est pas enregistré comme une autorisation d’écriture portable**.

Après destruction de la page ou sur un autre appareil, le fil explique qu’il faut **Repréparer la proposition**, afin d’obtenir un nouvel aperçu avec des vérifications actuelles. La modification effective requiert toujours son bouton de confirmation distinct. Pendant la même session vivante, les aperçus en mémoire gardent leurs contrôles de compte, de source et de version existants.

Restaurer une conversation ne génère pas de blend, ne modifie pas une playlist et ne met pas automatiquement à jour un export YouTube. Les notifications transitoires et la fiche de succès d’une action ne constituent pas un journal d’exécution synchronisé ; les objets musicaux enregistrés restent disponibles dans leurs vues habituelles.

## Compatibilité

Le nouveau champ est optionnel à la lecture : un ancien fichier sans historique est accepté et enrichi lors de la synchronisation. **Mettre à jour l’application sur tous les appareils est recommandé.** Les versions précédentes validaient strictement les champs du fichier ; elles refuseront ce nouveau champ plutôt que de le supprimer silencieusement. Il ne faut donc pas conserver une ancienne version pour synchroniser en parallèle avec V11.

Aucune récupération n’est possible des conversations déjà perdues avant cette livraison et qui n’existent plus dans une page vivante. L’enregistrement prend effet pour les conversations de cette version.

## Validation exécutée

Avant la modification, un test reproduisait la perte de la discussion après navigation vers les Réglages. Son échec attendu est conservé dans `v11-baseline.txt`.

| Suite | Résultat |
| --- | --- |
| Historique V11, deux navigateurs indépendants et cloud simulé | **66 contrôles, dont 4 audits axe** |
| Drive : fusion, comptes, hors ligne, conflits | 35 contrôles |
| Drive : données corrompues et refus d’écrasement | 16 contrôles |
| Continuité V8 adaptée aux statuts/reprises V11 | 38 contrôles dont 2 audits axe |
| Redesign V10 + piste réelle du slider V10.1 | 75 contrôles dont 8 audits axe |
| Interface et composeur | 58 contrôles |
| Sécurité des aperçus et écritures musicales | 33 contrôles |
| Live audio et outils | 26 contrôles |
| Génération et exclusions | 21 contrôles |
| Réponses longues | 18 contrôles |
| Mentions, sérialisation et périmètre de stockage V11 | 62 contrôles dont 10 audits axe |
| Démarrage mobile émulé | 56 contrôles |
| Relances du Live | 91 contrôles |
| Activation audio V8 | 53 contrôles dont 2 audits axe |
| Connexion/annulation Google V10 | 21 contrôles |
| Bibliothèque YouTube | 12 contrôles |
| Identité au retour OAuth et expiration | 6 scénarios |
| Axe général : accueil, conversation, Live, confidentialité | 8 audits |
| PWA : vues différées et ouverture hors ligne | Réussi |
| Échec d’un module : coque et navigation conservées | Réussi |

Soit **661 contrôles/scénarios fonctionnels et 34 audits axe**, plus les suites PWA. Ce sont des assertions/scans automatisés, pas 661 parcours utilisateurs indépendants ni une certification d’accessibilité.

Les nouveaux tests vérifient notamment la navigation pendant et après calcul, le brouillon après rechargement, deux discussions calculées indépendamment, la limite de trois fils, la sauvegarde Drive automatique sans clic manuel, la poursuite du même fil sur deux appareils simulés, le retour du résultat depuis la page d’origine absente, l’absence de requête automatique après destruction, l’annulation, le refus des réponses tardives après changement de compte, la fusion sans doublons, la convergence sans boucle d’envoi, les pannes Drive, la corruption distante, le quota local, les réglages de création restaurés, le refus de réutiliser un ancien aperçu d’écriture, l’horloge en retard et le clavier/focus en clair/sombre à 390 et 1280 px.

Les anciennes assertions qui exigeaient de ne jamais persister les messages ont été adaptées à la nouvelle demande explicite : elles vérifient maintenant le seul espace d’historique approprié et l’absence de copie des clés API dans sa structure. Les tests de continuité reconnaissent la nouvelle relance explicite et une étape de progression réelle, plutôt qu’un libellé vocal figé. Les scripts antérieurs restent archivés.

**Build réussi ; lint : 83 avertissements et 0 erreur ; `git diff --check` propre.**

### Limites des preuves

- Google, YouTube, Drive et Gemini simulés : aucune autorisation ni écriture sur un compte réel.
- « Deux appareils » signifie deux contextes navigateurs Chromium indépendants partageant un serveur Drive simulé, pas deux téléphones physiques.
- Le micro utilise la capture Chromium factice ; pas de nouvelle vérification physique Android/iOS.
- Les scans axe n’ont signalé aucune violation dans les écrans testés, sans remplacer une revue complète d’accessibilité.
- Pas de preuve de fonctionnement pendant une suspension arbitraire du système : la limite sans serveur est explicitement affichée.

## Fichiers et périmètre

Nouveaux fichiers de production :

- `src/services/assistantHistory.ts` : sérialisation bornée, stockage par compte, historique et fusion ;
- `src/components/views/AssistantHistoryPanel.tsx` : panneau de sélection et création de discussion.

Intégration dans `AssistantView.tsx`, son CSS et sa modal de confidentialité ; gestionnaire de préparations par fil dans `assistantVoiceTask.ts` ; champ optionnel dans `drive.ts` ; identifiants de messages dans le type `AssistantMessage` de `gemini.ts`.

Moteur `geminiLive.ts`, navbar `Shell.tsx`, dépendances, lockfile et service worker comparés à l’archive V10.1 : **inchangés**. Le correctif de la piste du slider est conservé.

## Livraison

- Archive complète **SoundBlend-Assistant-V11.zip** ;
- patch exact **V10.1 → V11** ;
- patch complet depuis le commit initial `51f92aa586dfc63119f697acf1ec8781128355e1` ;
- rapport, journaux, captures et sommes SHA-256.

Le patch incrémental est vérifié sur l’archive V10.1 réellement livrée ; le patch complet sur le commit initial. Pour chacun : `git apply --check`, application puis comparaison octet par octet des fichiers source/documentation/tests avec la livraison V11. Les annexes `livraison/` sont fournies dans le ZIP et ne font pas partie des patchs.

Aucun commit du dépôt de travail, push ni déploiement effectué.
