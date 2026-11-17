# SoundBlend AI · 6.9.34

Application web pour écouter sa bibliothèque YouTube et composer des blends. La version 6.9.34 corrige les problèmes d'isolation et de synchronisation constatés dans l'audit de la 6.9.33, et vérifie les opérations YouTube avant d'annoncer leur succès.

## Utiliser l'application

- **Bibliothèque** : parcours les playlists du compte connecté, sélectionne des titres et crée un blend. Sans compte, les playlists affichées sont des exemples.
- **Assistant** : décris ton idée, par exemple « Reprends ma playlist Chill Voiture, ajoute du jazz et rends-la plus énergique ». Gemini répond et peut proposer une source et une consigne modifiables. **Rien n'est généré tant que tu ne presses pas “Générer ce blend”.** Une clé Gemini est nécessaire pour dialoguer et suivre une consigne ; si elle manque ou si le service refuse l'appel, l'application le signale.
- **Blend / Mes blends** : écoute, remplace ou retire des titres, exporte une playlist, retrouve les blends encore valides. Un blend expire après 14 jours selon l’horloge de l’appareil. Supprimer le blend dans SoundBlend ne supprime jamais sa playlist YouTube.
- **Bloquer** : le bouton associé au titre ouvre une feuille animée depuis le bas, avec deux choix séparés : ne plus proposer **cette musique**, ou ne plus proposer **cet artiste**. Les deux se débloquent séparément dans **Réglages**. Bloquer un morceau ne bannit pas automatiquement son artiste. Les anciens pouces ne sont pas convertis en blocages.
- **Réglages → Exclusions** : les deux boutons ouvrent la même feuille. Les onglets « Musiques » et « Artistes » permettent de consulter et débloquer chaque type. Le champ cherche dans les exclusions et dans le catalogue YouTube Music ; « Ajouter une exclusion » lui donne immédiatement le focus. Les correspondances reposent notamment sur les noms : des homonymes ou certaines variantes d'un titre peuvent être regroupés (par exemple « One More Time » et « One More Time (Radio Edit) » du même artiste).
- **Réglages** : compte, clé Gemini, apparence et état de synchronisation. Sur téléphone, ils s'ouvrent par l'avatar de la barre inférieure.

Les découvertes et faces cachées réellement affichées sont mémorisées 14 jours pour éviter de les reproposer. Les amorces explicitement choisies peuvent revenir même si elles sont récentes. L'identification dépend des métadonnées disponibles : des variantes mal étiquetées ou des informations absentes peuvent échapper au rapprochement. Une réponse oEmbed n'est pas une garantie que la vidéo sera lisible dans tous les pays ou pour tous les comptes.

Pendant la composition, la sphère garde ses pigments et son grain ; ses nappes arrière se courbent dans les virages. Des phrases françaises défilent, tandis que l'étape réelle reste lisible en dessous. Les 50 derniers messages réels, même émis très rapidement, sont consultables sous « Étapes précédentes » pendant la génération. Le réglage de mouvement réduit fige la sphère et les phrases, y compris lorsqu'on le modifie pendant la génération.

Dans le grand lecteur, le sélecteur **Titre / Vidéo** reprend la couleur de la pochette et suit le glissement vers le morceau voisin. La teinte est plus discrète en mode clair. Les commandes configurables de l'iframe YouTube sont désactivées, mais YouTube peut toujours afficher son titre, sa marque, des éléments de pause ou des publicités. Sur les écrans courts, la disposition réserve autant que possible un carré de 200 × 200 px au clip, puis compacte les commandes et la file ; une fenêtre trop étroite ne peut pas offrir cette taille.

**Attention — intégration YouTube héritée à refondre avant une diffusion conforme :** le lecteur audio est masqué derrière l'application et mesure 320 × 180 px ; un second lecteur muet peut jouer en même temps pour le clip. L'iframe du clip ne reçoit pas les interactions et ses coins sont arrondis. Ces choix préexistants ne respectent pas plusieurs [exigences YouTube](https://developers.google.com/youtube/terms/required-minimum-functionality) et [politiques sur le lecteur et la séparation audio/vidéo](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions). Cette version améliore la taille du clip, mais **ne rend pas l'intégration entièrement conforme**. Une refonte vers un lecteur unique, visible et interactif, diffusant ensemble le son et l'image du même contenu, changerait l'expérience actuelle et nécessite de nouveaux essais.

## Données et confidentialité

Pour répondre, Gemini reçoit la conversation récente, les noms et identifiants des playlists, leurs titres déjà chargés, les blends valides et leurs consignes, ainsi que les exclusions. Une playlist reconnue mais pas encore chargée est lue avant la proposition finale. Lors de la composition, la source sélectionnée et la consigne sont transmises au modèle. Ne saisis pas d'informations que tu ne souhaites pas envoyer à Google.

Les réglages, exclusions, blends, le portrait et l'historique récent sont enregistrés localement dans un espace propre à l'identifiant Google vérifié. Après autorisation, ils peuvent être synchronisés dans l'espace privé **appDataFolder** de ce compte Drive. **La clé Gemini est enregistrée en clair** dans le navigateur et dans ce fichier privé, sans chiffrement par l'application. Ne partage pas un compte Drive ou un navigateur auquel tu ne souhaites pas donner accès à cette clé.

**Les anciennes données locales sans compte sont conservées séparément, sans import automatique dans un compte.** Une déconnexion les rend de nouveau accessibles dans l'espace local. La conversation de l'Assistant, la sélection de titres, la file de lecture et la position de lecture ne sont pas synchronisées. Les jetons Google sont gardés dans la session de l'onglet plutôt que partagés comme données de compte entre onglets.

Au passage depuis une ancienne version, l'identité de toute session Google encore valide est vérifiée avant la synchronisation. Si la vérification échoue ou si la session a expiré, reconnecte-toi ; les données locales historiques ne sont pas envoyées au compte. En revanche, les données déjà présentes dans l'espace Drive privé de ce compte restent destinées à être fusionnées avec lui. Si une ancienne version a déjà mélangé les données de deux comptes, la mise à jour ne peut pas deviner leur provenance ni les séparer automatiquement : il faut examiner les données de chaque compte et les corriger avec précaution.

La recherche de musiques et d'artistes dans les exclusions interroge le catalogue YouTube Music par les filtres `music_songs` et `music_artists` d'instances **Piped publiques indépendantes** : ce n'est pas une API officielle YouTube Music. La requête est envoyée à ces services, sans clé Gemini ni jeton Google. La recherche nécessite Internet et leur disponibilité ; une panne est signalée et peut être réessayée. Les images affichées peuvent provenir de services distants. D'autres recherches de morceaux de l'application peuvent aussi passer par Piped.

La synchronisation relit et fusionne les changements, conserve les suppressions en attente et signale les erreurs, les délais et l'expiration du jeton. Elle refuse d'écraser un fichier Drive mal formé ou d'une version inconnue. Un nouvel essai peut être lancé dans Réglages. Elle ne dispose pas d'un verrou atomique Drive : une écriture simultanée dans la dernière fenêtre entre lecture et écriture peut encore être perdue. Après des modifications simultanées, garde les appareils connectés pour qu'ils se relisent ; un conflit sur un même blend est résolu par version entière, pas morceau par morceau. Les horloges très désaccordées et les suppressions effectuées simultanément hors ligne restent des cas limites. Un blend expiré est masqué localement ; le nettoyage distant attend une connexion. Les tests fournis simulent Drive et deux appareils ; ils ne remplacent pas un essai sur un vrai compte.

Une playlist n'est annoncée vérifiée qu'après relecture des morceaux, de leur ordre, du titre et de la visibilité. Si une création est partielle, le lien reste accessible et « Mettre à jour » reprend sur cette playlist. Si YouTube a créé la playlist mais que le navigateur ne peut pas enregistrer son lien, conserve le lien affiché et libère de l'espace avant de réessayer l'enregistrement. Si le lien a été perdu ou si la réponse est incertaine, vérifie ta bibliothèque YouTube, puis associe le lien de la bonne playlist ; ne débloque un nouvel export qu'après avoir vérifié qu'aucune playlist n'a été créée. Le journal de récupération est local à cet appareil : il ne constitue pas une garantie d'unicité absolue entre appareils concurrents.

## Essayer localement

Prérequis : Node.js 20.19 ou plus dans la série 20, ou 22.12 ou plus. Dans le dossier extrait contenant `package.json` :

```sh
npm install
npm run dev
```

Ouvre <http://localhost:5173/>. Le client OAuth public figure dans `src/config/app.ts` ; l'origine du site doit être autorisée dans Google Cloud Console. Aucune clé YouTube n'est demandée dans l'interface ; la clé Gemini personnelle se saisit dans **Réglages**. Ne place jamais de clé secrète dans le dépôt, `.env.example` ou le code.

Pour produire et prévisualiser le site :

```sh
npm run build
npm run preview
```

La compilation crée `dist/`, servi sur <http://localhost:4173/>. L'archive source ne contient pas les dépendances ni `dist/` ; un site déjà compilé pour la racine `/` est fourni séparément dans `SoundBlend-v6.9.34-site.zip`.

La PWA peut rouvrir son **interface** hors ligne après une première visite et l'activation de son service worker. Pour une mise à jour depuis la 6.9.33, ouvre l'application en ligne, puis ferme et rouvre **tous les onglets et toutes les fenêtres installées sur chaque appareil** ; vérifie « v6.9.34 » dans Réglages avant de changer de compte. Un ancien onglet garde son ancien code tant qu'il n'est pas rechargé. Le nouveau service worker refuse d'activer une mise à jour dont les ressources sont incomplètes ; le comportement d'un ancien cache dépend aussi de l'hébergeur. Déploie le site complet d'un seul tenant et vérifie son fonctionnement en ligne avant de compter sur le hors-ligne. La lecture YouTube, la recherche, Gemini et Drive restent des services réseau ; la musique n'est pas téléchargée pour une lecture hors ligne.

## GitHub Pages

Pour un dépôt existant, sauvegarde tes modifications, compare les fichiers avant de les remplacer et conserve ta configuration personnelle, notamment `src/config/app.ts` si tu l'as modifiée. Après `npm ci` et `npm run build`, vérifie le diff et crée toi-même le commit et l'envoi. Aucun script de mise à jour automatique n'est fourni pour cette version. Le workflow `.github/workflows/pages.yml` est conservé : il choisit la base adaptée au nom du dépôt. Pour tester manuellement une compilation en sous-dossier :

```sh
BASE_PATH=/SoundBlend/ npm run build
```

Sous PowerShell : `$env:BASE_PATH='/SoundBlend/'; npm run build`. Le paquet `SoundBlend-v6.9.34-site.zip` utilise au contraire la racine `/` ; GitHub Actions recompile avec sa propre base.

## Vérifications et limites

Les tests facultatifs et leurs commandes se trouvent dans `verification/README.md`. Ils couvrent notamment les exclusions, l'historique, la synchronisation Drive simulée, le parcours Assistant, la pagination, la sphère, le lecteur simulé et le rechargement PWA hors ligne. Les appels Gemini, Drive et la plupart des réponses YouTube sont simulés. La connexion et la synchronisation avec un compte réel, l'abonnement Premium et tous les navigateurs/appareils ne sont pas garantis par ces tests.

**Dépendances de développement :** lors de la vérification de l'archive extraite, `npm audit` a signalé 12 paquets de gravité élevée liés à une même alerte transitive [picomatch — GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) : certains motifs glob non fiables peuvent provoquer un déni de service. Aucun correctif picomatch n'était indiqué dans le registre et l'avis consultés. `npm audit --omit=dev` ne signalait aucune vulnérabilité à ce moment-là, sans garantir la sécurité du site. Ces résultats évoluent ; surveiller l'avis, mettre à jour les outils lorsqu'un correctif adapté existe et ne pas accepter de motifs glob non fiables dans les outils de développement. Ne pas appliquer `npm audit fix --force` sans examiner les changements potentiellement incompatibles.

La connexion Google à SoundBlend n'ouvre pas automatiquement une session YouTube dans l'iframe. Si des publicités apparaissent malgré Premium, connecte le compte abonné sur YouTube dans le même navigateur et vérifie les cookies ; consulte aussi [l'aide YouTube](https://support.google.com/youtube/answer/7437519?hl=fr). Le lecteur muet et le son sont synchronisés au mieux, mais YouTube et les images-clés ne permettent pas de promettre un calage parfait.

## Dépannage rapide

| Situation | À vérifier |
|---|---|
| Connexion Google refusée | Origine autorisée du client OAuth, compte et autorisations. |
| Bibliothèque ou playlist indisponible | Message affiché, connexion, autorisations et quota YouTube ; réessayer. Une page partielle n'est pas conservée comme une playlist complète. |
| Assistant indisponible | Clé Gemini personnelle, quota, accès au modèle et réseau ; aucune source inventée n'est lancée. |
| Exclusion inattendue | Réglages → Exclusions → Afficher la liste ; titre et artiste peuvent être débloqués indépendamment. Les noms homonymes et certaines variantes peuvent se rapprocher. |
| Recherche d'exclusion indisponible | Vérifier le réseau et réessayer : les instances Piped publiques sont indépendantes et peuvent tomber en panne. |
| Ancienne version visible | Attendre le déploiement, ouvrir l'app en ligne puis fermer et rouvrir tous les onglets et fenêtres installées ; vérifier v6.9.34 dans Réglages. |
| Export interrompu | Vérifier directement la bibliothèque YouTube ; utiliser le lien conservé ou l'associer avant de relancer une création. |
| Fichier Drive illisible ou plus récent | Aucune écriture n'est tentée sur ce fichier : vérifier la version et restaurer une copie valide avant de réessayer. |
| Lecture impossible | Restrictions YouTube, connexion ou intégration ; une vérification de métadonnées ne garantit pas la lecture. |
