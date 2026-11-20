# V10.1 — correction du slider de durée

Le style global dessinait la piste rouge avec `--fill`, dont la valeur de repli était 50 %. Le composant mettait à jour `--sa-range` sur le fond de l’input, mais la piste native opaque masquait ce fond. La valeur et le curseur changeaient donc sans que la barre rouge suive.

Correction limitée au CSS du slider de l’Assistant : piste Chromium liée à `--sa-range`, progression native Firefox, recentrage du pouce et zone d’interaction de 22 px. Aucun changement de logique de génération, de durée ou du micro.

Validation Chromium : 75 contrôles dont 8 scans axe, avec minimum/maximum, flèches clavier, raccourci 2 h et valeurs intermédiaires pendant un glissement. Analyse des pixels rouges des captures pour vérifier la piste effectivement affichée. Largeurs 390 et 1280 px, thèmes clair et sombre. Le même test échoue avec le CSS V10 non corrigé. Build réussi, lint : 83 avertissements et 0 erreur, git diff --check propre. Le style Firefox est fourni mais n’a pas été exécuté dans Firefox ; pas de test sur téléphone physique.

Le patch est volontairement minimal : seul AssistantView.css change. Application contrôlée sur le fichier de l’archive V10 livrée et comparaison octet par octet réussies. L’archive complète inclut également le nouveau script de régression et les preuves. Aucun déploiement effectué.
