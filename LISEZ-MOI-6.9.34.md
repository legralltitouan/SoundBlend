# SoundBlend 6.9.34 — comptes et synchronisation

Cette version corrige les problèmes reproduits lors de l'audit de la 6.9.33. Elle est fournie séparément : les archives 6.9.33 ne sont pas modifiées.

## Ce qui change

- **Comptes séparés :** les réglages, exclusions, blends, portrait et historique récent sont rangés selon l'identifiant Google vérifié. Les données de l'ancien espace local sans compte restent séparées : elles ne sont pas automatiquement importées dans un compte et redeviennent accessibles après déconnexion.
- **Synchronisation Drive :** les modifications en attente sont conservées et l'application signale notamment une erreur, un délai ou une session expirée. Elle refuse d'écraser un fichier Drive invalide ou d'une version inconnue. Les changements entre onglets sont pris en compte, y compris pendant un envoi.
- **Playlists YouTube :** l'export n'est annoncé vérifié qu'après relecture des morceaux, de leur ordre, du titre et de la visibilité. Après une création partielle, le lien est conservé quand c'est possible et la mise à jour reprend sur cette playlist. Supprimer un blend dans SoundBlend ne supprime pas sa playlist YouTube.
- **Session :** la conversation de l'Assistant, la sélection, la file et la position de lecture ne sont pas synchronisées. La session Google reste propre à l'onglet. L'interface d'accueil et la mise à jour de la PWA ont aussi été corrigées.

## Avant de mettre à jour

1. Sauvegarde ton projet et tes configurations personnalisées. Sur chaque appareil, vérifie le compte utilisé et les données importantes, sans effacer les données du navigateur ni changer de compte si un envoi est en attente.
2. Déploie la nouvelle version complète. Sur **chaque appareil**, ouvre l'application en ligne, puis ferme et rouvre tous les onglets et toutes les fenêtres installées de SoundBlend. Vérifie **v6.9.34 dans Réglages avant de changer de compte** : un ancien onglet continue d'exécuter son ancien code tant qu'il n'est pas rechargé.
3. Reconnecte-toi si l'application le demande et vérifie l'état de synchronisation et les données sur les appareils concernés. La nouvelle version vérifie l'identité des anciennes sessions avant synchronisation.

**Attention :** si la 6.9.33 a déjà mélangé les données de plusieurs comptes dans un Drive, la nouvelle version ne peut pas déterminer leur provenance ni les séparer automatiquement. Examine les données de chaque compte et corrige-les avec précaution. Les données déjà présentes dans le Drive privé d'un compte restent destinées à être fusionnées avec ce compte.

## En cas d'export ou de synchronisation interrompu

- Dans Réglages, un envoi en attente ou une erreur nécessite de vérifier la connexion et, si besoin, de se reconnecter **au même compte** puis de réessayer. Ne supprime pas les données locales tant que les données importantes ne sont pas vérifiées ailleurs.
- Si YouTube a créé une playlist mais que le lien ne peut pas être enregistré, conserve le lien affiché et libère de l'espace avant de réessayer. Si le résultat est incertain ou le lien perdu, vérifie d'abord ta bibliothèque YouTube, puis associe le lien de la bonne playlist dans SoundBlend. Ne débloque une nouvelle création qu'après avoir vérifié qu'aucune playlist n'a déjà été créée.
- Les modifications simultanées sur plusieurs appareils sont fusionnées au mieux, mais Drive ne fournit pas ici de verrou atomique : une écriture peut encore être perdue. Un conflit sur un même blend est résolu par version entière. Après des changements simultanés, laisse les appareils se relire et vérifie le résultat. Le journal local d'export ne garantit pas non plus l'absence de doublons YouTube entre appareils.

## Confidentialité

La clé Gemini est enregistrée **en clair** dans le navigateur et, si la synchronisation est autorisée, dans le fichier privé de l'application sur Google Drive. Ne partage pas un navigateur ou un compte Drive si tu ne souhaites pas donner accès à cette clé. Les requêtes de recherche d'exclusions peuvent être envoyées à des instances Piped publiques indépendantes, sans jeton Google ni clé Gemini. Gemini reçoit les données nécessaires à la conversation et à la composition : voir le `README.md` pour les détails.

## Utiliser les fichiers

- **`SoundBlend-v6.9.34-source.zip`** contient les sources, le workflow GitHub et les tests, sans dépendances ni site compilé. Décompresse-le, puis dans le dossier `SoundBlend-v6.9.34-source` extrait lance `npm ci` puis `npm run dev`. Il faut Node.js 20.19 ou plus dans la série 20, ou 22.12 ou plus.
- **`SoundBlend-v6.9.34-site.zip`** contient le site compilé pour la **racine `/`** d'un domaine. Sers son contenu avec un hébergeur ou un serveur web ; ne l'ouvre pas directement en `file://`. Pour un sous-dossier GitHub Pages, utilise la source et recompile avec la base du dépôt : le ZIP de site à la racine ne convient pas.
- **`SHA256SUMS-v6.9.34.txt`** permet de vérifier les empreintes des deux archives et du présent guide.

Pour un dépôt existant, sauvegarde tes changements et compare les fichiers ; conserve ta configuration personnalisée, notamment `src/config/app.ts` si tu l'as modifiée, et ton workflow. Compile et vérifie le diff avant de faire toi-même le commit et l'envoi. Le `README.md` et `deploy/TUTO-GITHUB.md` donnent les instructions détaillées. **Aucun script `.bat` de mise à jour automatique n'est fourni.** Aucun déploiement ni envoi sur GitHub, Dropbox ou Google Drive n'a été effectué pour cette version.

## Vérifications et limites

- Compilation réussie ; lint sans erreur, avec **83 avertissements**.
- Sources : **22 suites réussies**, soit **348 contrôles comptés et deux scénarios multi-appareils**. Site compilé : **222 contrôles à la racine** et **121 sous `/SoundBlend/`**. Ces totaux comprennent des reprises de scénarios et ne s'additionnent pas comme des contrôles uniques.
- La mise à jour PWA depuis la 6.9.33 a été vérifiée à la racine et sous `/SoundBlend/`, notamment après un téléchargement incomplet : **10/10 à chaque chemin**. Sous-dossier : ancienne source 6.9.33 recompilée pour la même base.
- Les services Google, Drive et YouTube sont simulés pour ces vérifications : **aucun vrai compte Google ou YouTube n'a été utilisé**. Elles ne prouvent ni une synchronisation atomique ni le comportement de tous les appareils. L'essai antérieur du vrai lecteur YouTube était non concluant.
- **Alerte dépendances :** `npm audit` a signalé 12 paquets de gravité élevée liés à une même alerte transitive [picomatch](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), dans les outils de développement. Aucun correctif n'était indiqué lors du contrôle. L'audit des seules dépendances de production n'en signalait aucune à ce moment-là, ce qui ne garantit pas la sécurité du site. Voir le `README.md` avant de modifier les dépendances.

**Avant diffusion :** l'intégration YouTube héritée utilise un lecteur audio masqué et un second lecteur vidéo muet ; sa conformité aux règles YouTube n'est pas acquise. Cette version ne la corrige pas. Voir l'avertissement et les liens officiels dans le `README.md` du projet.
