# SoundBlend AI — version 6.9.32

## Ce qui change

### Lecteur : Titre / Vidéo

Le sélecteur reprend les couleurs de la pochette : la pastille et le fond ont des luminosités distinctes pour conserver des libellés lisibles. La teinte est plus discrète en mode clair. Elle suit la pochette précédente ou suivante pendant le glissement, jusqu'au changement de morceau.

Le clip reste dans le carré, muet et synchronisé au mieux avec la musique. La barre de commandes YouTube configurable était **déjà désactivée** et le reste (`controls=0`). YouTube peut néanmoins afficher son titre, sa marque, des éléments natifs au démarrage ou en pause, et des publicités : l'application ne peut pas garantir leur disparition. Le paramètre `modestbranding`, devenu sans effet, a été retiré du clip.

> **Point important avant diffusion : la conformité YouTube n'est pas acquise.** L'architecture héritée utilise un lecteur audio masqué de 320 × 180 px et un second lecteur muet pour l'image ; ils peuvent jouer ensemble. Le clip ne reçoit pas les interactions et ses coins sont arrondis. Ces choix entrent en conflit avec les [exigences YouTube de taille, de visibilité et de lecture automatique](https://developers.google.com/youtube/terms/required-minimum-functionality), ainsi qu'avec les [règles sur les liens et la séparation du son et de l'image](https://developers.google.com/youtube/terms/developer-policies#i.-additional-prohibitions). L'amélioration de taille du clip ne corrige pas ces problèmes. Une refonte vers un lecteur unique, visible et interactif, diffusant le son et l'image du même contenu, est nécessaire pour les traiter ; elle modifierait l'expérience actuelle et demanderait de nouveaux essais.

Sur les écrans courts, le lecteur réserve 200 × 200 px au clip lorsque la fenêtre le permet, avec une disposition compacte et, en paysage, les commandes à côté. Sur une fenêtre extrêmement basse, la file est temporairement masquée ; les boutons précédent/suivant restent disponibles. Une fenêtre trop étroite ne peut pas offrir un carré de 200 px.

### Composition

La sphère conserve ses couleurs, son cœur, ses flous et son grain. Ses deux nappes arrière se courbent progressivement dans les virages plutôt que de pivoter comme des blocs rigides ; la trajectoire en huit reste en place.

Sous « Génération en cours », des phrases françaises changent avec une animation inspirée de LayoutTextFlip. L'étape réelle est affichée séparément ; les messages longs sont défilables. Les 50 derniers messages réellement émis, même très brefs, sont consultables pendant la génération dans « Étapes précédentes ». Si le système demande des mouvements réduits, la sphère et les phrases se figent, y compris si ce réglage change pendant la génération.

### Fonctions conservées

L'**Assistant** dialogue à partir des sources disponibles et ne lance un blend qu'après confirmation. Les blocages de musique et d'artiste sont séparés et réversibles. Les découvertes et faces cachées proposées sont prises en compte pendant 14 jours ; les amorces explicitement choisies peuvent revenir. Des métadonnées manquantes ou inexactes peuvent empêcher certains rapprochements : une absence absolue de répétition n'est pas garantie.

Blends, exclusions, historique, thème et clé Gemini peuvent être synchronisés dans l'espace privé `appDataFolder` du compte Drive. La clé Gemini y est **stockée en clair**, ainsi que dans le navigateur. La fusion Drive n'est **pas atomique** : après des modifications simultanées, laisse les appareils ouverts et connectés. Le nettoyage distant des blends expirés reprend lors d'une synchronisation connectée. Les tests Drive utilisent des appareils et un service simulés, pas un vrai compte.

La connexion Google de SoundBlend ne connecte pas automatiquement l'iframe YouTube. Si des publicités apparaissent malgré Premium, connecte-toi à YouTube dans le même navigateur avec le compte abonné et vérifie les cookies. Consulte aussi [l'aide YouTube](https://support.google.com/youtube/answer/7437519?hl=fr). L'application ne garantit pas la suppression des publicités et ne les détecte pas à partir de la durée.

## Mise à jour du site GitHub

1. Télécharge et décompresse **`soundblend-site-v6-9.zip`** : tu obtiens `src-v6.9.32`.
2. Place ce dossier **à côté** de ton dépôt Git cloné et place **`MAJ-SoundBlend-v6.9.32.bat` à la racine du dépôt**, à côté du dossier `src`. Le script est aussi présent dans le zip.
3. Sauvegarde tes modifications locales. Double-clique sur le `.bat` : il vérifie le dépôt et la branche `main`, effectue un pull sans forcer, copie les fichiers, puis crée un commit si nécessaire et pousse sur `origin/main`.
4. Attends l'Action GitHub verte, ouvre le site et vérifie **Réglages → SoundBlend AI · v6.9.32**. Si l'ancienne version reste affichée, ferme et rouvre les onglets SoundBlend.

Le script ne fait pas de `reset --hard`, ne supprime pas les dossiers et ne modifie pas `.github/workflows/pages.yml`. Il refuse les modifications suivies ainsi que les fichiers non suivis ou ignorés dans les chemins de copie. La copie de cette version sur une source 6.9.31 a été simulée et recompilée ; le `.bat` a été inspecté mais **n'a pas été exécuté sous Windows**. Il peut avoir copié ou commité des fichiers avant une erreur ultérieure : détails dans `MISE-A-JOUR-GITHUB-v6-9-32.md`.

Les autres archives sont `soundblend-github.zip` (projet complet pour GitHub) et `soundblend-dist.zip` (site compilé pour une racine `/`). GitHub Actions recompile pour le sous-dossier du dépôt. Le code et les tests facultatifs sont inclus dans le paquet principal.

## Vérifications et limites

| Test | Résultat | Environnement |
|---|---:|---|
| Compilation TypeScript + Vite | Réussie | production |
| Sélecteur, contrastes, gestes, composition, mouvement réduit et écrans courts | 32/32 | Chromium ; pochettes et lecteurs simulés |
| Sphère, grain et rotation | 13/13 | sources, Chromium |
| Cache des pochettes et historique des diagnostics | 18/18 | sources, réseau et génération simulés |
| Lecteur audio/clip | 37/37 | site compilé, lecteurs simulés |
| Assistant et erreurs/sources | 20/20 et 12/12 | site compilé, API simulées |
| PWA et rechargement hors ligne | 7/7 | site compilé, service worker actif |
| Données, Drive, curateur, résolution et bibliothèque | 18/18, 30/30, 19/19, 16/16, 12/12 | sources, services simulés |
| PWA et Assistant sous `/SoundBlend/` | 7/7 et 20/20 | compilation sous-dossier, API simulées |
| Copie 6.9.31 → 6.9.32 | 108 fichiers vérifiés | superposition simulée, build identique |

L'essai avec les **véritables iframes YouTube** n'a pas démarré dans l'environnement de test, ni avec la 6.9.32 ni avec la 6.9.31 utilisée en comparaison : il est **non concluant**. Une sonde séparée, avec un seul lecteur YouTube visible, a affiché une demande de connexion pour confirmer que le navigateur n'était pas un robot ; cela indique une limitation de l'environnement, sans établir l'unique cause de l'échec dans SoundBlend. Les tests simulés ne démontrent donc pas la peinture vidéo, les éléments natifs ou le comportement Premium sur ton compte. Aucun essai Gemini ou Drive authentifié n'a été effectué. Le calage exact du clip et du son reste tributaire de YouTube et des images-clés.

L'interface mise en cache peut être rouverte hors ligne après une première visite ; la musique YouTube, les recherches, Gemini et la synchronisation nécessitent toujours le réseau.
