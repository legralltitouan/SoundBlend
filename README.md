# SoundBlend AI · 6.9.32

Application web pour écouter sa bibliothèque YouTube et composer des blends. Cette version remplace l'ancien écran **Goûts** par un **Assistant** conversationnel ; elle conserve le lecteur et l'export vers YouTube.

## Utiliser l'application

- **Bibliothèque** : parcours les playlists du compte connecté, sélectionne des titres et crée un blend. Sans compte, les playlists affichées sont des exemples.
- **Assistant** : décris ton idée, par exemple « Reprends ma playlist Chill Voiture, ajoute du jazz et rends-la plus énergique ». Gemini répond et peut proposer une source et une consigne modifiables. **Rien n'est généré tant que tu ne presses pas “Générer ce blend”.** Une clé Gemini est nécessaire pour dialoguer et suivre une consigne ; si elle manque ou si le service refuse l'appel, l'application le signale.
- **Blend / Mes blends** : écoute, remplace ou retire des titres, exporte une playlist, retrouve les blends encore valides. Un blend expire après 14 jours.
- **Bloquer** : le bouton associé au titre propose deux choix séparés : ne plus proposer **cette musique**, ou ne plus proposer **cet artiste**. Les deux se débloquent séparément dans **Réglages**. Bloquer un morceau ne bannit pas automatiquement son artiste. Les anciens pouces ne sont pas convertis en blocages.
- **Réglages** : compte, clé Gemini, apparence, état de synchronisation et exclusions. Sur téléphone, ils s'ouvrent par l'avatar de la barre inférieure.

Les découvertes et faces cachées réellement affichées sont mémorisées 14 jours pour éviter de les reproposer. Les amorces explicitement choisies peuvent revenir même si elles sont récentes. L'identification dépend des métadonnées disponibles : des variantes mal étiquetées ou des informations absentes peuvent échapper au rapprochement. Une réponse oEmbed n'est pas une garantie que la vidéo sera lisible dans tous les pays ou pour tous les comptes.

Pendant la composition, la sphère garde ses pigments et son grain ; ses nappes arrière se courbent dans les virages. Des phrases françaises défilent, tandis que l'étape réelle reste lisible en dessous. Les 50 derniers messages réels, même émis très rapidement, sont consultables sous « Étapes précédentes » pendant la génération. Le réglage de mouvement réduit fige la sphère et les phrases, y compris lorsqu'on le modifie pendant la génération.

Dans le grand lecteur, le sélecteur **Titre / Vidéo** reprend la couleur de la pochette et suit le glissement vers le morceau voisin. La teinte est plus discrète en mode clair. Les commandes configurables de l'iframe YouTube sont désactivées, mais YouTube peut toujours afficher son titre, sa marque, des éléments de pause ou des publicités. Sur les écrans courts, la disposition réserve autant que possible un carré de 200 × 200 px au clip, puis compacte les commandes et la file ; une fenêtre trop étroite ne peut pas offrir cette taille.

**Attention — intégration YouTube héritée à refondre avant une diffusion conforme :** le lecteur audio est masqué derrière l'application et mesure 320 × 180 px ; un second lecteur muet peut jouer en même temps pour le clip. L'iframe du clip ne reçoit pas les interactions et ses coins sont arrondis. Ces choix préexistants ne respectent pas plusieurs [exigences YouTube](https://developers.google.com/youtube/terms/required-minimum-functionality) et [politiques sur le lecteur et la séparation audio/vidéo](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions). Cette version améliore la taille du clip, mais **ne rend pas l'intégration entièrement conforme**. Une refonte vers un lecteur unique, visible et interactif, diffusant ensemble le son et l'image du même contenu, changerait l'expérience actuelle et nécessite de nouveaux essais.

## Données et confidentialité

Pour répondre, Gemini reçoit la conversation récente, les noms et identifiants des playlists, leurs titres déjà chargés, les blends valides et leurs consignes, ainsi que les exclusions. Une playlist reconnue mais pas encore chargée est lue avant la proposition finale. Lors de la composition, la source sélectionnée et la consigne sont transmises au modèle. Ne saisis pas d'informations que tu ne souhaites pas envoyer à Google.

Les réglages, exclusions, blends et l'historique récent sont d'abord enregistrés dans le navigateur. Après connexion et autorisation, ils peuvent aussi être synchronisés dans l'espace privé **appDataFolder** de Google Drive. **La clé Gemini y est enregistrée en clair** pour suivre le compte sur les autres appareils ; ne partage pas un compte Drive auquel tu ne souhaites pas donner accès à cette clé. Les recherches de morceaux peuvent également passer par des instances Piped publiques ; elles reçoivent la recherche, pas ta clé Gemini.

La synchronisation fusionne les changements, marque les suppressions et prévoit un nouvel essai après une panne. Elle ne dispose pas d'un verrou atomique sur Drive : après des changements simultanés, garde les appareils ouverts et connectés pour qu'ils se relisent. Un blend expiré est retiré localement ; le nettoyage distant attend une connexion. Les tests fournis simulent Drive et deux appareils ; ils ne remplacent pas un essai sur un vrai compte.

## Essayer localement

Prérequis : Node.js 20.19 ou plus, ou 22.12+. Dans le dossier extrait contenant `package.json` :

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

La compilation crée `dist/`, servi sur <http://localhost:4173/>. L'archive source ne contient pas les dépendances ni `dist/` ; le site déjà compilé pour la racine `/` est fourni séparément dans `soundblend-dist.zip`.

La PWA peut rouvrir son **interface** hors ligne après une première visite et l'activation de son service worker. La lecture YouTube, la recherche, Gemini et Drive restent des services réseau ; la musique n'est pas téléchargée pour une lecture hors ligne.

## GitHub Pages

Pour un dépôt existant, voir `MISE-A-JOUR-GITHUB-v6-9-32.md` et le script accompagnant l'archive. Le workflow `.github/workflows/pages.yml` est conservé : il choisit la base adaptée au nom du dépôt. Pour tester manuellement une compilation en sous-dossier :

```sh
BASE_PATH=/SoundBlend/ npm run build
```

Sous PowerShell : `$env:BASE_PATH='/SoundBlend/'; npm run build`. Le paquet `soundblend-dist.zip` utilise au contraire la racine `/` ; GitHub Actions recompile avec sa propre base.

## Vérifications et limites

Les tests facultatifs et leurs commandes se trouvent dans `verification/README.md`. Ils couvrent notamment les exclusions, l'historique, la synchronisation Drive simulée, le parcours Assistant, la pagination, la sphère, le lecteur simulé et le rechargement PWA hors ligne. Les appels Gemini, Drive et la plupart des réponses YouTube sont simulés. La connexion et la synchronisation avec un compte réel, l'abonnement Premium et tous les navigateurs/appareils ne sont pas garantis par ces tests.

La connexion Google à SoundBlend n'ouvre pas automatiquement une session YouTube dans l'iframe. Si des publicités apparaissent malgré Premium, connecte le compte abonné sur YouTube dans le même navigateur et vérifie les cookies ; consulte aussi [l'aide YouTube](https://support.google.com/youtube/answer/7437519?hl=fr). Le lecteur muet et le son sont synchronisés au mieux, mais YouTube et les images-clés ne permettent pas de promettre un calage parfait.

## Dépannage rapide

| Situation | À vérifier |
|---|---|
| Connexion Google refusée | Origine autorisée du client OAuth, compte et autorisations. |
| Bibliothèque ou playlist indisponible | Message affiché, connexion, autorisations et quota YouTube ; réessayer. Une page partielle n'est pas conservée comme une playlist complète. |
| Assistant indisponible | Clé Gemini personnelle, quota, accès au modèle et réseau ; aucune source inventée n'est lancée. |
| Exclusion inattendue | Réglages → exclusions ; titre et artiste peuvent être débloqués indépendamment. |
| Ancienne version visible | Attendre GitHub Actions, fermer les onglets SoundBlend et rouvrir le site. |
| Lecture impossible | Restrictions YouTube, connexion ou intégration ; une vérification de métadonnées ne garantit pas la lecture. |
