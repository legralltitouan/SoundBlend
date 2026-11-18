# SoundBlend 6.9.40 — correctif du bandeau

## Ce qui change

Lorsque le suivi d’un remplacement glisse sur le bord droit, sa tranche reste désormais **sombre en mode sombre**. En mode clair, elle reste claire. Le glissement, la réouverture et la file de remplacement sont conservés.

La 6.9.40 reprend la 6.9.39. Elle ne modifie ni la connexion Google, ni les autorisations, ni la synchronisation. Le numéro de version affiché et le cache de l’application installée ont été mis à jour pour que le correctif puisse être chargé.

Tu as observé des échecs lorsque les changements de compte sont très rapides. Cette observation ne permet pas encore d’en établir la cause : le correctif visuel ne prétend pas résoudre la connexion.

## Quels fichiers utiliser ?

- **`Correctif-SoundBlend-v6.9.40.zip`** : correctif limité aux cinq fichiers modifiés, avec un patch et un petit mode d’emploi. À privilégier si ton dépôt correspond à la 6.9.39 et que tu veux préserver le reste de ton projet.
- **`SoundBlend-v6.9.40-source.zip`** : projet source complet, avec `.github/` et les tests, pour un dépôt qui construit le site par GitHub Actions. L’archive contient un dossier parent `SoundBlend-v6.9.40-source/`.
- **`SoundBlend-v6.9.40-site-GitHub-SoundBlend.zip`** : site déjà compilé pour une publication directe sous `/SoundBlend/`.
- **`SoundBlend-v6.9.40-site-racine.zip`** : site compilé pour un domaine publié à la racine `/`. Ne l’utilise pas pour le chemin GitHub `/SoundBlend/`.

Utilise **une seule méthode** : le correctif sur ton projet source, le projet source complet, ou un site statique selon ton mode de publication. Les sites compilés ne remplacent pas les sources d’un dépôt construit par Actions.

## Pour ton dépôt GitHub construit par Actions

1. Garde une copie du dépôt et de tes personnalisations. Les fichiers et archives **6.9.39** sont conservés séparément comme retour arrière. Ne remplace pas `.git`, tes clés ou ta configuration personnelle.
2. Décompresse le ZIP du correctif et suis son `LISEZ-MOI.md`. Il contient un patch à vérifier avant application ainsi que les cinq fichiers à copier si tu préfères les comparer manuellement. Si une vérification échoue ou si tu as changé l’un de ces fichiers depuis la 6.9.39, ne l’écrase pas : demande de l’aide pour fusionner les modifications.
3. Vérifie le diff, puis crée le commit et envoie-le toi-même vers `main`. Attends la réussite de l’action **Publier sur GitHub Pages**. Aucune publication n’a été faite par l’agent.
4. Ouvre le site en ligne, ferme et rouvre ses anciens onglets et fenêtres installées, puis vérifie **v6.9.40** dans Réglages. Ne vide pas les données du navigateur pour forcer la mise à jour.
5. En mode sombre, lance un remplacement qui dure quelques secondes : lorsque le suivi se range à droite, sa tranche doit rester sombre. Touche-la pour le rouvrir. Vérifie aussi le mode clair si tu le souhaites.

Au dernier contrôle en lecture seule, les cinq fichiers concernés du dépôt public au commit `f45cff128a1cdd195c61c0a1bce95016c0f85996` correspondaient à la 6.9.39 conservée. Ce contrôle ne couvre pas tout le dépôt et peut devenir périmé : vérifie ton exemplaire avant application.

## Connexion et données

La synchronisation Drive peut démarrer automatiquement après une connexion et écrire dans le dossier privé de l’application, comme auparavant. Ne supprime pas les données, ne recrée pas le projet Cloud et ne révoque pas les autorisations pour essayer ce correctif visuel. Revenir au code 6.9.39 ne restaure pas automatiquement des données éventuellement modifiées entre-temps.

Si une reconnexion échoue, note le message ou le code affiché et le contexte, sans communiquer d’adresse, mot de passe, jeton, URL de connexion ou clé Gemini. Attendre un peu entre les changements de compte peut être un essai prudent, mais n’est pas une solution dont l’efficacité a été démontrée.

## Vérifications et limites

- Sur le véritable bandeau de la 6.9.39, le fond blanc en mode sombre a été reproduit sur deux tailles d’écran.
- Sur la 6.9.40 : **32 contrôles du bandeau** sur les sources et **32 sur chacun des deux sites compilés**, en Chromium : clair et sombre, ouvert et rangé, changement de thème, clic, clavier, navigation et résultat de remplacement fictif.
- Sur chacun des deux sites : **32 contrôles de connexion simulée**, 11 contrôles de comptes simulés, et 23 contrôles PWA dont 11 de migration depuis le véritable site compilé 6.9.39. Les comptes, réponses et services utilisés par ces tests sont fictifs.
- Les deux compilations réussissent ; lint : **0 erreur, 84 avertissements**. Lors du contrôle, l’audit signale 12 alertes élevées dans les dépendances complètes et aucune avec `--omit=dev` ; ces résultats peuvent évoluer.

L’agent n’a effectué aucune connexion authentifiée à SoundBlend ni test sur tous les appareils ou navigateurs. Les essais ne garantissent pas les services externes, la fusion Drive atomique ou la résolution des échecs de reconnexion. Les empreintes des archives et du présent guide sont dans `SHA256SUMS-v6.9.40.txt`.
