# Assistant V8 — micro intermittent et continuité après le Live (archive)

> Le signalement suivant confirme un fonctionnement du Live apparemment satisfaisant sur le téléphone. La version actuelle `ASSISTANT-V9.md` conserve le micro V8 et corrige séparément les annulations des analyses longues de l’Assistant (limites locales de 90 secondes au total et de 26 secondes par tentative).

## Signalement et niveau de preuve

La V7 démarre parfois sur le téléphone, mais plusieurs essais reviennent à l’erreur de capture. La capture précédente indiquait un contexte `suspended`. La nouvelle capture montre des « Demande vocale à préparer… » puis un arrêt lors du passage en arrière-plan, sans réponse préparée.

Deux problèmes de code ont été traités séparément :

1. Un moteur audio suspendu pouvait être réutilisé à chaque essai ; une suspension survenant **pendant** l’attente des PCM pouvait encore terminer dans l’erreur générique de capture.
2. La préparation Gemini d’une demande vocale utilisait le signal d’annulation de l’outil Live. Fermer le Live arrêtait cet outil et annulait donc aussi le raisonnement déjà lancé dans le chat. Le démontage de la vue arrêtait également les préparations.

Le deuxième problème est reproduit sur la V7 dans `baseline-v7-continuation-echec-attendu.txt` : le micro se ferme, mais l’aperçu n’arrive jamais après la sortie du Live. Le blocage d’un ancien contexte et la suspension tardive sont injectés dans de nouveaux tests audio. **La cause native exacte de l’intermittence sur le téléphone n’a pas été observée directement.**

## 1. Reprise audio : changer le moteur bloqué, pas seulement rappeler resume()

Le démarrage normal reste en un seul clic. Si le contexte reste suspendu, « Activer l’audio » reste proposé. L’appui réel sur ce bouton :

- crée le contexte de remplacement directement dans le geste utilisateur ;
- détache les anciens nœuds et ferme l’ancien contexte ;
- conserve le flux micro déjà autorisé, sans refaire getUserMedia pour cette seule activation ;
- réinitialise la sortie silencieuse, reconstruit la capture sur le nouveau contexte puis vérifie l’arrivée de nouveaux PCM ;
- ne considère pas une ancienne mesure ni une promesse resume() résolue comme preuve de fonctionnement.

Un clic JavaScript artificiel ne déclenche pas la reconstruction. Il ne peut pas fabriquer un geste utilisateur natif. Une seule reconstruction est autorisée par épisode d’activation, pour éviter une accumulation de moteurs en cas de taps répétés.

Le contrôle d’état est maintenant effectué **avant le montage du graphe, après son montage et après chaque attente d’échantillons**. Si le moteur se suspend durant cette attente, l’activation est proposée au lieu de confondre l’absence de PCM avec une panne du micro. Les attentes suivent le contexte courant après son remplacement et exigent de nouveaux blocs après reconstruction.

Les garde-fous restent bornés : attente d’activation de 30 secondes, arrêts et nettoyage sur annulation, repli Worklet/compatibilité et réarmement micro uniquement pour une vraie absence de blocs avec moteur actif. Aucun résultat de ces simulations ne permet de garantir que tous les problèmes de routage Android sont éliminés.

## 2. Quitter le Live ne veut plus dire annuler la demande

### Dispositifs audio

« Terminer », l’écriture dans le chat, le passage en arrière-plan ou le changement de vue ferment immédiatement les pistes micro, détachent la capture et arrêtent la lecture sonore. Aucun PCM supplémentaire ne doit partir de ces pistes après la fermeture.

### Tour Gemini encore en cours

Si de l’audio a été transmis ou si un tour/outil est en attente, la connexion Live peut finir silencieusement le tour :

- envoi d’une fin de flux audio ;
- réception possible de la dernière transcription et d’un appel d’outil arrivé après la sortie ;
- aucune lecture sonore pendant cette finition ;
- fermeture à la fin du tour et des outils ;
- courte grâce de 3 secondes si aucune transcription n’est encore arrivée, avec prolongation jusqu’à 90 secondes au total lorsqu’un tour/outil est effectivement en attente.

Les événements de compte possèdent leurs propres gardes dans le service, même si la vue n’est plus montée. Aucun micro ni socket différé ne doit survivre à un changement de compte.

### Préparation déjà acceptée

Une demande acceptée par `proposer_action_musicale` est confiée à une tâche de préparation du chat. Son contrôleur ne dépend plus du signal de l’outil Live.

- Sortir du Live ou changer de vue ne l’annule plus.
- La tâche reste en mémoire au niveau du module, avec révision de compte et révision de session.
- Au retour dans l’Assistant, une tâche en cours affiche sa progression et son bouton d’arrêt ; une tâche terminée restaure demande, réponse et aperçu.
- Le bouton explicite « Arrêter la réponse », la déconnexion, le changement de compte et le délai de préparation continuent d’annuler réellement le travail.
- Les tâches ne peuvent toujours préparer que des aperçus. Génération et écritures YouTube demandent leurs boutons de confirmation distincts.

Les résultats vocaux mémorisés sont invalidés au lancement d’une nouvelle demande textuelle ou d’une action confirmée pour éviter de restaurer ultérieurement un aperçu devenu obsolète.

## 3. Si Chrome ou l’app est réellement fermé

Sans serveur exécutant les tâches, une page ne peut pas garantir du calcul ou du réseau après destruction/suspension de son processus par Android. **Cette livraison n’ajoute pas de serveur et ne promet pas une exécution après arrêt forcé de Chrome.**

Une consigne vocale déjà acceptée pour préparation est donc journalisée temporairement dans le stockage local du compte : uniquement `{ query, at }`, sans audio, sans clé API et sans historique de conversation.

À la réouverture après interruption :

- bouton **« Reprendre la demande vocale »** ;
- aucun appel Gemini automatique avant cet appui ;
- reprise en lecture seule pour préparer une réponse/un aperçu ;
- possibilité d’oublier la consigne ;
- journal effacé après réussite, annulation explicite ou déconnexion ;
- reprise refusée si la consigne a plus de 30 minutes ou appartient à un autre espace de compte.

La limite de 30 minutes est une fenêtre de validité : un journal expiré est supprimé lorsqu’il est relu. Le navigateur ne garantit pas l’exécution d’un effacement programmé quand il est fermé. Le texte de confidentialité explique ce nouveau stockage minimal et la distinction entre micro coupé et préparation poursuivie.

Cette reprise ne reconstitue pas tout l’historique privé, les réglages d’un aperçu ou les références du brouillon après destruction du processus. Si nécessaire, il faudra préciser de nouveau ces éléments. Si le stockage local est indisponible, le travail en mémoire reste fonctionnel mais cette reprise ne peut pas être garantie. Une parole qui n’a jamais été transcrite ni acceptée comme demande ne peut pas être reconstruite.

## Validation finale

Toutes les suites suivantes ont été exécutées séquentiellement sur le code final, avec services simulés.

| Suite | Résultat |
| --- | --- |
| TypeScript + Vite | Réussi |
| Lint global | 0 erreur, 83 avertissements |
| Activation V8 | 53 contrôles, dont 2 scans axe |
| Continuité V8 | 38 contrôles, dont 2 scans axe |
| Interface / responsive / composition | 58 contrôles |
| Sécurité et confirmations | 33 contrôles |
| Live : flux, lecture, outils, coupure et reprise | 26 contrôles |
| Génération / exclusions | 21 contrôles |
| Références et mentions | 62 contrôles, dont 10 scans axe |
| Capture mobile / repli Worklet | 56 contrôles |
| Relances successives | 91 contrôles |
| Axe accueil / conversation / Live / confidentialité | 8 scans sans violation détectée |
| Vues différées et première ouverture hors ligne | Réussi |
| Échec de module : coque/navigation préservées | Réussi |
| `git diff --check` | Réussi |

**424 contrôles fonctionnels et 22 scans axe**, plus les deux suites PWA. L’avertissement Vite sur la taille du chunk principal reste présent.

### Nouveaux cas audio testés

- resume() résout sans démarrer, rejette hors geste ou reste en attente ;
- ancien contexte définitivement bloqué même avec un tap, mais remplaçant utilisable ;
- ancien contexte fermé après remplacement, un seul nouveau moteur actif et même flux micro ;
- suspension après l’acquisition, pendant la vérification des blocs ;
- vrais PCM non nuls transmis au WebSocket simulé après reconstruction ;
- suspension au milieu du Live et reprise clavier ;
- trois relances successives, arrêt, changement de compte et arrière-plan pendant l’activation ;
- refus persistant même après reconstruction : délai borné et erreur spécifique, sans boucle de permissions ;
- démarrage non bloqué toujours en un seul tap ;
- carte d’activation en vrais thèmes clair et sombre, audit axe.

### Nouveaux cas de continuité testés

- sortie par Terminer et passage en arrière-plan pendant une préparation lente ;
- sortie avant l’appel d’outil et dernière transcription arrivée après fermeture du Live ;
- aucun envoi micro ni lecture sonore pendant la finition ;
- réponse d’outil honnête, exactement un appel de préparation et aucune écriture YouTube ;
- navigation hors de la vue pendant une préparation, résultat restauré au retour ;
- outil reçu après démontage, progression restaurée avant le résultat ;
- annulation explicite et changement de compte empêchant tout résultat tardif ;
- rechargement avec reprise sur bouton uniquement, journal minimal effacé après succès ;
- journal expiré ou hors compte jamais présenté ;
- quota de stockage simulé indisponible sans panne de la préparation en mémoire ;
- tour Live sans réponse : attente bornée, pas de lancement inventé ;
- carte de reprise clair/sombre, audit axe.

### Ce que ces tests ne prouvent pas

Chromium de bureau avec émulation mobile, microphone factice, vrai graphe Web Audio et services Google simulés. Les restrictions et blocages audio sont injectés. Pas de test sur le téléphone de l’utilisateur, pas de test Android natif/Chrome installé physique, pas d’appel réel Gemini Live, pas de test de survie à un processus Android tué. Les scans axe ne sont pas une certification complète ; les tests PWA concernent une installation propre, pas toutes les migrations de cache.

## Vérifier sur le téléphone

1. Publier le build complet, rouvrir en ligne puis vérifier **« Audio Live · révision 8 »** dans les détails du Live.
2. Ouvrir le Live. Si « Activer l’audio » apparaît, appuyer directement dessus : il doit reconstruire le moteur au lieu de reprendre encore le même contexte bloqué.
3. Vérifier l’apparition du signal micro, puis faire plusieurs cycles Terminer → Live.
4. Demander une proposition musicale puis quitter le Live pendant « Gemini réfléchit… ». Le micro doit se couper et la réponse/l’aperçu arriver dans le chat.
5. Refaire en changeant de vue et en passant brièvement en arrière-plan. Ne pas confondre cette situation avec Android qui tue le processus.
6. Pour une préparation déjà acceptée interrompue par rechargement, vérifier la proposition de reprise, sans envoi automatique.

Si le micro échoue encore malgré cette révision et l’appui direct, transmettre le diagnostic **après cet appui** : état du contexte, moteur, blocs reçus/envoyés, modèle du téléphone et version de Chrome. Les succès simulés des livraisons précédentes ne doivent pas être présentés comme une preuve de résolution physique.

## Reproduire localement

```sh
npm ci
npm run dev -- --host 0.0.0.0
```

Avec Playwright et axe disponibles (outils de test, pas des dépendances de production) :

```sh
node verification/t-assistant-audio-activation-v8.mjs
node verification/t-assistant-continuation-v8.mjs
node verification/t-assistant-refinement.mjs
node verification/t-assistant-refinement-safety.mjs
node verification/t-assistant-refinement-live.mjs
node verification/t-assistant-studio-generation.mjs
node verification/t-assistant-mentions-v7.mjs
node verification/t-assistant-live-mobile-v7.mjs
node verification/t-assistant-live-restart-v6.mjs
node verification/axe-assistant-refinement.mjs
```

Définir `SOUNDBLEND_AXE_MODULE` si axe est installé en dehors du projet. Serveur 5173 par défaut ; exécuter les suites séquentiellement. Les tests PWA utilisent le build servi sur 4173. Les suites V7 d’activation sont historiques : V8 utilise son propre scénario qui simule aussi les contraintes sur les nouveaux contextes.

## Périmètre et livraison

Production modifiée par rapport à la V7 :

- `src/services/geminiLive.ts` ;
- `src/components/views/AssistantView.tsx` ;
- `src/components/views/AssistantPrivacy.tsx` ;
- nouveau `src/services/assistantVoiceTask.ts`.

Pas de modification de la navbar, du routeur, du design des réglages, des autres vues, du générateur partagé, des dépendances, du lockfile, du service worker ni du numéro de release. Les changements sont limités à l’Assistant et à son traitement vocal.

Livraison : ZIP complet V8, patch exact V7 → V8, patch complet sur le commit initial `51f92aa586dfc63119f697acf1ec8781128355e1`, rapport, journaux, captures et sommes SHA-256. Le patch incrémental est contrôlé puis appliqué à l’archive V7 livrée, avec comparaison octet par octet de tous les fichiers source suivis. Le patch complet est contrôlé sur le commit initial.

Aucun commit, push ni déploiement effectué.
