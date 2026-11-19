# Assistant V5 — capture audio vérifiée et entrée Live directe

## Signalement et limite du diagnostic

Le téléphone affiche « Micro ouvert », mais l’orbe ne réagit pas et la voix n’est pas détectée, alors que Chrome et le site GitHub disposent déjà de l’autorisation. Le défaut à traiter n’est donc pas simplement l’absence de permission.

Dans V4, l’app pouvait annoncer le micro ouvert dès que le graphe audio avait été branché, **sans vérifier la réception de blocs audio**. Le vumètre était aussi dépendant de la disponibilité du WebSocket. Cette livraison vérifie la capture locale et introduit un secours pour les moteurs audio bloqués.

La cause exacte sur le téléphone de l’utilisateur n’a pas été observée sur matériel : les changements ci-dessous traitent les pannes reproductibles correspondantes. Aucun test ne permet de prétendre que la version a déjà été validée sur cet appareil précis.

## Changements

### Capture et reprise audio

- Acquisition dans le geste utilisateur, puis reprise du contexte audio **après** acquisition du micro également : certains moteurs mobiles peuvent le suspendre de nouveau.
- Capture locale initialisée avant la découverte Gemini. L’app attend des échantillons réels avant de poursuivre ; elle ne conserve pas de file d’audio à envoyer rétroactivement. Les blocs antérieurs à la connexion Gemini sont mesurés puis abandonnés.
- AudioWorklet privilégié. Si son module est absent, échoue, reste bloqué, ou si aucun bloc n’arrive, passage automatique à un chemin de compatibilité `ScriptProcessorNode`.
- Vérification des premiers blocs avec délais bornés. Si les deux chemins restent inopérants : erreur claire, libération du micro et **pas de faux statut « Micro ouvert »**.
- Surveillance en cours de session : reprise du contexte suspendu et bascule de secours si le Worklet s’arrête ou ne délivre durablement aucun signal mesurable.
- Les deux chemins produisent du PCM16 mono little-endian, **16 kHz par blocs de 100 ms**, en tenant compte de la fréquence réelle du contexte. Aucun renvoi direct du micro aux haut-parleurs : sortie du graphe de capture à gain nul.
- L’orbe est pilotée par le niveau audio mesuré **localement**, sans attendre Gemini. L’indicateur « Signal micro reçu » signifie qu’un signal sonore a été mesuré, pas qu’une voix humaine a été identifiée ou transcrite.
- Signal durablement silencieux : indication spécifique, différente d’un problème de permission. Un coupe-micro système, une source Bluetooth silencieuse ou une autre application audio restent des causes possibles que le code ne peut pas annuler de force.
- Détails dépliables : moteur utilisé, état du contexte, nombre de blocs reçus et envoyés, état muet du périphérique. Aucun nom de périphérique, clé ou audio brut affiché ou persisté dans ces diagnostics.
- Annulation, fermeture de vue, changement de compte et passage réel en arrière-plan gardent leurs protections. Tous les nœuds, ports, timers, pistes et contextes sont libérés. Les flux acquis tardivement sont toujours arrêtés.

`ScriptProcessorNode` est une API de compatibilité dépréciée, utilisée uniquement en secours. Elle n’est pas une garantie universelle pour tous les navigateurs futurs ; l’échec est visible et borné, jamais présenté comme une capture réussie.

### Un clic sur Live

Le bouton **Live ouvre la vue et démarre immédiatement** l’acquisition et la connexion. Il n’y a plus de deuxième bouton « Démarrer le vocal ». En cas d’échec, « Réessayer le Live » relance une nouvelle session dans un nouveau geste utilisateur. Les clics répétés ne créent pas plusieurs acquisitions simultanées.

Le bouton décrit le démarrage du micro et l’envoi à Google dans son libellé accessible ; la vue et le panneau de confidentialité rappellent l’usage de la clé et des quotas. Terminer, couper le micro et revenir au clavier restent disponibles. La sélection d’une proposition n’autorise toujours aucune mutation YouTube.

### Animation

Un petit orbe remplace l’icône du bouton Live. À l’ouverture, l’orbe de la page s’agrandit depuis un point, remonte doucement, développe un halo et révèle le titre et le texte. L’animation ne retarde pas le démarrage micro et ne bloque pas l’activation utilisateur. Après l’entrée, le niveau mesuré reprend le contrôle de l’orbe. La préférence de réduction des mouvements supprime la transition.

Le texte d’attente ne ressemble plus à une fausse transcription : « Juste un instant… », puis « Dis-moi ton envie musicale. »

### Cadre rouge du champ de recherche

Le contour de focus rouge **interne** de l’input est supprimé uniquement dans le panneau Assistant. Le conteneur conserve un focus fin et neutre. Les boutons et onglets gardent leur focus clavier visible. Aucun changement aux réglages, à leurs exclusions ou aux styles globaux.

## Vérifications finales

| Suite | Résultat |
| --- | --- |
| TypeScript + Vite | Réussi |
| Lint du dépôt | 0 erreur, 83 avertissements préexistants |
| `t-assistant-mentions-v5.mjs` | 62 contrôles réussis, dont 10 scans axe |
| `t-assistant-live-mobile-v5.mjs` | 56 contrôles réussis |
| Interface fixe / responsive / confidentialité | 58 contrôles réussis |
| Sécurité / confirmations YouTube | 33 contrôles réussis |
| Live : audio, outils, micro coupé/rouvert et arrêts | 26 contrôles réussis, adaptés au clic unique |
| Génération et exclusions | 21 contrôles réussis |
| Axe accueil / conversation / Live / confidentialité | 8 scans sans violation détectée |
| Vues différées hors ligne, build V5 | Réussi |
| Vue indisponible : coque et navigation conservées | Réussi |
| `git diff --check` | Réussi |

**246 contrôles fonctionnels et 18 scans axe**, plus les deux suites PWA. Les audits statiques réduisent les animations pour ne pas mesurer une phase transitoire de fondu ; l’animation d’entrée et sa désactivation sont testées séparément.

La suite mobile contrôle notamment :

- le clic unique et l’activation utilisateur conservée ;
- le niveau local avant connexion Gemini et l’absence d’envoi avant son accord ;
- des blocs PCM de taille attendue et **non nuls**, pas seulement l’existence d’une piste ;
- le chemin normal, Worklet sans messages, Worklet absent, module en erreur et module bloqué ;
- un moteur qui cesse de répondre en cours de session ;
- un moteur qui délivre uniquement des zéros, avec retour d’un signal non nul après bascule ;
- la reprise d’un AudioContext suspendu ;
- l’échec des deux chemins, sans statut trompeur ni fuite de piste ;
- les permissions différées/refusées, les retours de visibilité, les annulations et les timeouts déjà couverts par V4.

Responsive : 320×568, 390×844, 768×1024, 1440×1000 ; clair/sombre ; clavier VisualViewport simulé. Les références précises, tags, exclusions et confirmations de V4 restent vérifiés.

### Limites

Chromium de bureau émulant un mobile Android, avec microphone factice, véritable graphe Web Audio et WebSocket/API Google simulés. Les tests n’utilisent ni compte réel ni service Gemini Live réel. Ils ne remplacent pas un test physique Chrome Android / PWA ou Chrome iOS. Les scans axe ne sont pas une certification complète. L’avertissement Vite sur le chunk principal demeure.

## À vérifier sur le téléphone après publication

1. Publier le build complet, puis rouvrir l’app **en ligne** pour charger cette version.
2. Cliquer une seule fois sur Live ; attendre la connexion et parler. L’orbe et « Signal micro reçu » doivent réagir au signal.
3. Si le problème persiste, déplier **« Le micro ne réagit pas ? »** et relever moteur, contexte, blocs reçus/envoyés et état du signal. Joindre une capture de ces valeurs est plus utile que de redonner les permissions déjà accordées.
4. Des blocs reçus non nuls et envoyés qui augmentent orientent vers la connexion/service/transcription ; zéro bloc oriente vers le moteur audio ; des blocs sans signal orientent vers une source silencieuse, le périphérique ou le coupe-micro système. Ces indications aident au diagnostic et ne prouvent pas à elles seules la cause.

## Reproduire les tests

```sh
npm ci
npm run dev
```

Installation temporaire des outils, sans modifier le lockfile :

```sh
npm install --no-save --package-lock=false playwright@1.65.1 @axe-core/playwright@4.13.0
npx playwright install --with-deps chromium
node verification/t-assistant-mentions-v5.mjs
node verification/t-assistant-live-mobile-v5.mjs
node verification/t-assistant-refinement.mjs
node verification/t-assistant-refinement-safety.mjs
node verification/t-assistant-refinement-live.mjs
node verification/t-assistant-studio-generation.mjs
node verification/axe-assistant-refinement.mjs
```

Suites séquentielles, Vite sur 5173 (`SOUNDBLEND_DEV_URL`). Pour les tests PWA : build puis preview sur 4173. Les scripts V3/V4 de démarrage en deux étapes sont archivés et ne décrivent plus l’interaction actuelle.

## Livraison

- Projet complet V5, avec rapport, captures et journaux.
- Patch V4 → V5 sur l’archive V4 précédemment livrée.
- Patch complet sur `51f92aa586dfc63119f697acf1ec8781128355e1`.

Changements de production : `AssistantView.tsx`, `AssistantView.css`, `geminiLive.ts` seulement. Tests et rapports complètent la livraison. Navbar, Shell, réglages/exclusions, styles globaux, autres vues, générateur partagé et dépendances inchangés par V5.

Aucun secret, nouvelle dépendance de production, persistance audio ou mutation automatique YouTube ajouté. Le service worker et le numéro de release sont inchangés. Les tests hors ligne utilisent une installation propre, pas une migration d’une ancienne PWA. Aucun commit, push GitHub ni déploiement effectué.
