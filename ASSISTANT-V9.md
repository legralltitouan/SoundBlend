# Assistant V9 — laisser aboutir les analyses longues (archive)

> Archive V9. La livraison actuelle est décrite dans `ASSISTANT-V11.md` : elle conserve les analyses longues et le moteur micro V8, les améliorations V10/V10.1, et ajoute les discussions sauvegardées et synchronisées par compte.

## Signalement et diagnostic

L’utilisateur confirme que le Live semble maintenant fonctionner correctement. Le nouveau problème concerne la réponse du chat : une demande d’analyse des blends existants se termine par « La réponse a dépassé le délai… ».

Ce message était déclenché par le contrôleur de la vue après **90 secondes pour l’ensemble de la préparation**. Il ne prouvait pas que Gemini avait échoué : il pouvait simplement être encore occupé. Chaque tentative de `converse` avait en plus un budget local de **26 secondes**. Des modèles successifs pouvaient donc être annulés puis remplacés avant la limite globale.

Une nouvelle régression, exécutée sur V8 avant correction, reproduit l’annulation au-delà de 90 secondes. Le journal `baseline-v8-attente-echec-attendu.txt` conserve cet échec attendu.

## Changements

### Pas de durée totale maximale imposée à la réponse de l’Assistant

- Suppression du contrôleur d’annulation globale à 90 secondes dans `AssistantView.send`.
- Suppression du budget de 26 secondes pour les appels de conversation de l’Assistant.
- Un délai de 30 secondes affiche une information d’attente longue ; il **n’annule rien** et ne prétend pas mesurer un pourcentage de raisonnement.
- Le bouton **« Arrêter la réponse »** reste opérationnel, y compris après plusieurs minutes.
- Les gardes de compte et les annulations explicites demeurent actives.

Les autres traitements Gemini (génération de blends, recherches Web et politiques de délai existantes hors conversation) ne passent pas automatiquement à ce nouveau comportement. L’option est activée uniquement pour `converse`.

### Réponse reçue en flux

La conversation utilise `streamGenerateContent?alt=sse`, plutôt que d’attendre une réponse monolithique tout en annulant rapidement le modèle.

Le lecteur :

- réassemble les événements SSE, les fins de ligne LF/CRLF et les fragments UTF-8 ;
- concatène les fragments de réponse JSON ;
- ignore les parties marquées `thought`, qui ne doivent ni être affichées comme réponse ni corrompre son JSON ;
- accepte aussi une réponse JSON non découpée ;
- conserve les erreurs HTTP et les mécanismes de repli existants entre modèles ;
- libère le lecteur et les écouteurs lors d’une fin, d’une erreur ou d’une annulation ;
- borne la taille du texte pour éviter une accumulation mémoire sans fin.

Le plafond local `maxOutputTokens:4096` n’est plus imposé aux conversations de l’Assistant, afin de ne pas consommer artificiellement le budget de raisonnement/sortie d’un modèle récent. Les plafonds du modèle et du fournisseur existent toujours ; il ne s’agit pas d’une sortie illimitée.

L’aperçu et les actions restent affichés seulement après réception et validation d’une réponse JSON complète. Il ne s’agit pas d’une exécution progressive de commandes ni d’un affichage de raisonnement interne.

### Garde-fou réseau, pas chronomètre de raisonnement

Un flux sans aucune donnée reçue pendant **3 minutes** est interrompu. Ce délai repart à zéro à chaque bloc effectivement reçu, y compris une activité de maintien du flux. Il n’existe pas de durée totale maximale du flux : une réponse de plus de cinq minutes avec activité n’est pas coupée pour sa seule durée.

**Absence de données ne prouve pas une panne réseau** : le fournisseur peut aussi rester silencieux. Ce garde-fou permet de ne pas laisser une connexion apparemment inactive sans borne ; une analyse réellement silencieuse au-delà de trois minutes peut donc encore échouer. Le message mentionne cette absence de données, et non l’ancien délai global de réponse. Les erreurs de réseau, de quota, de clé, de JSON ou les limites côté Google ne peuvent pas être transformées en succès garanti.

La lecture du contexte musical et la découverte des modèles restent annulables par les contrôles et gardes existants ; cette version n’ajoute pas de mécanisme permettant à une page fermée de poursuivre du travail.

## Live et micro préservés

Aucune modification de `geminiLive.ts`, du traitement du microphone, de l’activation tactile ou de `assistantVoiceTask.ts` par rapport à V8. Le diagnostic audio affiche donc toujours **« Audio Live · révision 8 »** : c’est normal, la révision audio n’a pas changé.

La préparation vocale acceptée dans le chat bénéficie aussi du nouveau comportement, même après sortie du Live. La fermeture bornée du socket Live ne doit pas annuler cette préparation indépendante. Le test d’une préparation vocale de 280 secondes confirme ce parcours simulé, avec micro fermé et aperçu affiché à la fin.

Le stockage minimal de reprise V8 et les confirmations nécessaires à la génération/aux écritures YouTube sont conservés, sans nouveau journal ni nouvelle collecte audio.

## Validation finale

Suites exécutées séquentiellement après redémarrage du serveur de développement, pour éviter de tester un mélange de modules HMR et de mocks.

| Suite | Résultat |
| --- | --- |
| TypeScript + Vite | Réussi |
| Lint | 0 erreur, 83 avertissements |
| Attentes longues V9 | 18 contrôles réussis |
| Interface / composition / responsive | 58 contrôles |
| Sécurité et confirmations | 33 contrôles |
| Live audio et outils | 26 contrôles |
| Génération / exclusions | 21 contrôles |
| Mentions et références | 62 contrôles, dont 10 scans axe |
| Capture mobile | 56 contrôles |
| Relances du Live | 91 contrôles |
| Activation V8 conservée | 53 contrôles, dont 2 scans axe |
| Continuité V8 conservée | 38 contrôles, dont 2 scans axe |
| Axe accueil / conversation / Live / confidentialité | 8 scans sans violation détectée |
| PWA / vues différées hors ligne | Réussi |
| Module indisponible : navigation préservée | Réussi |
| `git diff --check` | Réussi |

**442 contrôles fonctionnels et 22 scans axe**, plus deux suites PWA. L’avertissement Vite sur la taille du chunk principal reste présent.

### Nouvelle suite `t-assistant-wait-v9.mjs`

- réponse JSON reçue après 110 secondes, sans annulation ni deuxième appel ;
- route de streaming et absence du plafond local de 4096 tokens ;
- blends existants effectivement présents dans le contexte envoyé ;
- flux actif de 350 secondes dépassant les anciens seuils de 26 et 90 secondes ;
- information d’attente longue, bouton d’arrêt disponible ;
- événements SSE et UTF-8 découpés au milieu des octets, réassemblage correct ;
- parties internes de raisonnement exclues ;
- une seule requête et aucune écriture automatique ;
- délai d’inactivité réarmé par les données ;
- absence de données au-delà de 3 minutes : arrêt du lecteur et erreur spécifique ;
- annulations par bouton et changement de compte après attente prolongée ;
- préparation vocale de 280 secondes après sortie du Live, micro fermé, aperçu reçu et journal de reprise effacé.

### Limites de validation

Les durées sont exercées avec **horloge virtuelle** dans Chromium et flux/réponses Gemini simulés, pas par une requête de plusieurs minutes au service Google réel. Les tests audio utilisent un graphe Web Audio réel et un microphone factice ; les contraintes mobiles sont simulées. Aucun nouvel essai physique du téléphone ni appel réel à Gemini n’a été réalisé. Les scans axe ne constituent pas une certification d’accessibilité complète.

## Vérifier après publication

1. Charger le nouveau build en ligne.
2. Envoyer la demande d’analyse des blends existants.
3. Après 30 secondes, une indication d’attente peut apparaître. Elle doit laisser la demande en cours et le bouton d’arrêt disponible.
4. Le cap des 90 secondes ne doit plus produire l’ancien message.
5. Attendre la réponse et vérifier l’aperçu ; aucune action musicale ne doit être appliquée sans confirmation.

La réponse dépend toujours de Gemini, de la connexion, des quotas et d’un contexte exploitable. L’app ne peut pas garantir que toute consigne aboutira exactement au résultat attendu ni qu’un processus Android arrêté continuera à tourner.

## Reproduire

```sh
npm ci
npm run dev -- --host 0.0.0.0
node verification/t-assistant-wait-v9.mjs
```

Playwright doit être disponible pour les tests. Les régressions utilisent les mêmes scripts que V8 ; `SOUNDBLEND_AXE_MODULE` permet d’indiquer un module axe installé séparément. Exécuter les suites séquentiellement ; serveur de développement sur 5173, build PWA servi sur 4173.

## Périmètre et livraison

Production modifiée par V9 :

- `src/components/views/AssistantView.tsx` : attente non destructive et suppression de la coupure globale ;
- `src/services/gemini.ts` : option de transport réservée à la conversation ;
- nouveau `src/services/geminiAssistantStream.ts` : lecture du flux et garde-fou d’inactivité.

Aucun changement de navbar, micro, références, autres vues, routeur, dépendances, lockfile, service worker ni numéro de release. Les usages hors conversation du service Gemini gardent leur transport et leur budget par défaut.

Livraison : ZIP complet V9, patch V8 → V9, patch complet sur le commit initial `51f92aa586dfc63119f697acf1ec8781128355e1`, rapport, journaux, captures et SHA-256. Le patch incrémental est contrôlé et appliqué sur l’archive V8 livrée puis les fichiers source suivis sont comparés octet par octet. Le patch complet est contrôlé sur le commit initial. Le périmètre de production est vérifié par comparaison avec V8.

Aucun commit, push ni déploiement effectué.
