# Assistant V6 — arrêter puis relancer le Live (archive)

> La version actuelle est décrite dans `ASSISTANT-V7.md`. La capture mobile suivante a précisé le blocage : contexte `suspended`, zéro bloc reçu. V7 vérifie l’état natif et propose une activation tactile directe si la reprise automatique ne suffit pas, au lieu de traiter ce cas comme une panne de capture.

## Signalement

Sur le téléphone, le Live a fonctionné une fois. Après « Terminer » puis relance : « Micro autorisé, mais aucun échantillon audio n’arrive du navigateur », systématiquement, sans autre application audio lancée.

Ce message ne prouvait pas qu’une autre application occupait le micro. Le défaut de capture apparaît désormais lié au scénario de réouverture, pas simplement aux permissions.

## Correctif ciblé

Dans V5, `stop()` lançait `AudioContext.close()` sans attendre sa fin, puis une nouvelle session créait immédiatement un autre contexte. Une course entre libération de l’ancien moteur audio et réouverture du suivant était donc possible.

La V6 ne détruit plus et ne recrée plus le moteur matériel à chaque appui sur « Terminer » :

1. Les sons de sortie, outils, timers, nœuds de capture et ports de la session sont arrêtés/déconnectés.
2. **Toutes les pistes du microphone sont arrêtées**, le WebSocket est fermé et le niveau repasse à zéro.
3. Le contexte audio neutre est **suspendu**, sans piste, clé, conversation ni nœud de session conservés par le coordinateur.
4. La session suivante réutilise ce contexte. Elle attend la suspension précédente et une courte fenêtre de relâchement matériel de 300 ms avant de réacquérir le micro si la relance est immédiate.
5. Une demande de reprise audio est faite pendant le clic et répétée après le règlement de la transition précédente. Un ancien arrêt ne doit pas suspendre le nouveau Live après coup.
6. Le module Worklet est chargé **une seule fois par contexte** ; chaque session crée ses propres nœuds et buffers. Aucun ancien bloc n’est réutilisé comme entrée de la session suivante.

Un contexte suspendu n’est pas un microphone ouvert : les tests contrôlent explicitement que toutes les pistes sont terminées et que les flux sont inactifs entre les sessions. Il ne s’agit plus de la garantie V5 « contexte fermé », mais d’une garantie « aucune capture ni émission active, contexte suspendu et réutilisable ». Le contexte est naturellement libéré avec la page ; aucune donnée audio n’est persistée.

### Réarmement borné

Si les chemins Worklet et compatibilité ne délivrent toujours aucun bloc au démarrage, l’app tente **une seule réacquisition complète** : nœuds débranchés, ancienne piste arrêtée, pause de 400 ms, nouveau flux micro puis vérification des PCM pendant trois secondes au maximum. Cette tentative ne contourne aucune permission et reste annulable. Un flux acquis après annulation est immédiatement arrêté.

Si cela échoue, le message indique l’échec de réinitialisation avec l’état du contexte et le moteur de capture. Il n’affirme plus qu’une autre application audio est nécessairement responsable.

Le clic unique, les animations, les tags, le panneau de références, les confirmations musicales et les protections de changement de compte de V5 sont conservés. **Aucun changement de design ni d’autres écrans.**

## Régression reproduite et tests

Avant modification, une nouvelle suite a été exécutée contre V5 avec une panne de route audio simulée après destruction/recréation du contexte : le premier Live fonctionne, le deuxième ne reçoit plus de PCM. Elle échouait à la deuxième ouverture. Cette injection reproduit le comportement observé, mais ne prouve pas à elle seule la cause matérielle exacte sur le téléphone.

Après modification, la même suite passe, ainsi que :

- **33 cycles complets** « Live → signal audio non nul transmis → Terminer → Live » : 8 avec route sensible à la destruction du contexte, 20 avec route normale, 5 avec suspension native artificiellement retardée ;
- une seule création de contexte et un seul chargement du module Worklet par page ;
- arrêt de toutes les pistes après chaque cycle ; contexte inactif suspendu ; aucune mutation musicale ;
- 5 interruptions pendant le démarrage, suivies de reprises réussies ;
- permission de l’ancienne session résolue après l’ouverture de la suivante, sans interrompre cette nouvelle session ;
- première source bloquée, puis réacquisition d’une seconde source qui retrouve un signal non nul ;
- aucun rejet non géré et aucune fuite de piste détectés.

La suite dédiée à la relance compte **91 contrôles réussis**.

### Validation finale exécutée séquentiellement

| Suite | Résultat |
| --- | --- |
| TypeScript + Vite | Réussi |
| Lint global | 0 erreur, 83 avertissements préexistants |
| `t-assistant-live-restart-v6.mjs` | 91 contrôles réussis |
| `t-assistant-live-mobile-v6.mjs` | 56 contrôles réussis |
| `t-assistant-mentions-v6.mjs` | 62 contrôles réussis, dont 10 scans axe |
| Interface fixe / responsive / confidentialité | 58 contrôles réussis |
| Sécurité et confirmations YouTube | 33 contrôles réussis |
| Live : audio, micro coupé/rouvert, outils et arrêts | 26 contrôles réussis |
| Génération et exclusions | 21 contrôles réussis |
| Axe accueil, conversation, Live et confidentialité | 8 scans sans violation détectée |
| Première ouverture des vues hors ligne | Réussie sur build V6 |
| Échec de téléchargement d’une vue : coque et navigation | Réussi |
| `git diff --check` | Réussi |

**337 contrôles fonctionnels et 18 scans axe**, plus les deux suites PWA. Les audits statiques réduisent les animations ; les interactions et la réduction des mouvements sont testées séparément. L’avertissement Vite sur le chunk principal demeure.

### Limites

Tests sur Chromium de bureau avec émulation Android, microphone factice, véritable graphe Web Audio et API/WebSocket Google simulés. La route sensible aux fermetures et la suspension retardée sont des pannes injectées. **Pas de validation sur le téléphone physique de l’utilisateur ni avec Gemini Live réel.** Il faut donc confirmer le correctif sur son appareil après publication. Les audits axe ne sont pas une certification complète d’accessibilité. Les tests PWA portent sur une installation propre, pas sur la migration d’une ancienne installation.

## À vérifier sur le téléphone

Après publication du build complet et réouverture de l’app en ligne :

- ouvrir Live et vérifier le signal ;
- appuyer sur Terminer, relancer immédiatement, puis répéter plusieurs fois ;
- si l’erreur persiste, capturer le message et les valeurs de « Le micro ne réagit pas ? » : moteur, état, blocs reçus et envoyés. Les valeurs permettent de distinguer une reprise de moteur bloquée d’une source silencieuse.

Il n’est pas demandé de redonner les permissions déjà accordées ni de fermer arbitrairement d’autres applications pour valider ce correctif.

## Reproduire

```sh
npm ci
npm run dev
```

Outils de test temporaires, sans modifier le lockfile :

```sh
npm install --no-save --package-lock=false playwright@1.65.1 @axe-core/playwright@4.13.0
npx playwright install --with-deps chromium
node verification/t-assistant-live-restart-v6.mjs
node verification/t-assistant-live-mobile-v6.mjs
node verification/t-assistant-mentions-v6.mjs
node verification/t-assistant-refinement.mjs
node verification/t-assistant-refinement-safety.mjs
node verification/t-assistant-refinement-live.mjs
node verification/t-assistant-studio-generation.mjs
node verification/axe-assistant-refinement.mjs
```

Suites séquentielles ; Vite sur 5173 (`SOUNDBLEND_DEV_URL`). Les tests PWA nécessitent un build servi sur 4173. Les scripts V5 qui exigent un contexte fermé ne décrivent plus la stratégie de suspension V6.

## Livraison et périmètre

- ZIP V6 complet, avec rapport et journaux.
- Patch **V5 → V6**, à appliquer à la V5 précédemment livrée.
- Patch complet sur le commit initial `51f92aa586dfc63119f697acf1ec8781128355e1`.

**Un seul fichier de production modifié par V6 : `src/services/geminiLive.ts`.** Les autres changements sont des tests et rapports. Navbar, Shell, réglages, styles et composants Assistant, autres vues, dépendances et générateur partagé restent identiques à V5.

Aucun secret, nouvelle dépendance, enregistrement audio persistant ou mutation automatique YouTube ajouté. Service worker et numéro de release inchangés. Aucun commit, push ni déploiement effectué.
