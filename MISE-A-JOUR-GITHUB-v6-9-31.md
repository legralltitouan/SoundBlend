# Mise à jour GitHub — SoundBlend 6.9.31

## Fichiers nécessaires

- `soundblend-site-v6-9.zip` : à décompresser ; il crée le dossier **`src-v6.9.31`**.
- `MAJ-SoundBlend-v6.9.31.bat` : à copier **à la racine du dépôt Git cloné**. Une copie se trouve aussi dans le zip.
- `LISEZ-MOI-v6-9-31.md` : nouveautés, confidentialité et limites des tests.

```text
Téléchargements/
├── SoundBlend/                       dépôt Git cloné, branche main
│   ├── .git/
│   ├── .github/workflows/pages.yml
│   ├── src/
│   └── MAJ-SoundBlend-v6.9.31.bat
└── src-v6.9.31/                     dossier extrait du zip
    ├── src/
    ├── public/
    └── package.json
```

## Avant de lancer

Sauvegarde et committe tes éventuelles modifications. Le script demande Git pour Windows, une branche `main`, un accès au dépôt distant `origin` et un historique compatible avec `git pull --ff-only`.

Il refuse les fichiers suivis modifiés ou déjà indexés, ainsi que les fichiers non suivis dans les chemins à copier. Par prudence, il refuse aussi les fichiers **ignorés et non suivis** présents dans ces chemins, même s'ils ne seraient pas forcément écrasés. Il ne fait pas de `git reset --hard`, ne supprime pas les dossiers et ne copie pas `.github/workflows/pages.yml`. Il ne peut pas protéger contre toutes les configurations Git particulières ou modifications simultanées : conserve une sauvegarde.

## Lancer puis vérifier

1. Double-clique sur `MAJ-SoundBlend-v6.9.31.bat` **à la racine du dépôt**, pas dans le dossier extrait. Il effectue le pull, copie les fichiers et vérifie la version. Il crée ensuite un commit si nécessaire et **pousse automatiquement vers `origin/main`**.
2. Sur GitHub, attends que l'Action **Publier sur GitHub Pages** soit verte.
3. Ouvre le site, puis Réglages : le pied de page doit afficher **SoundBlend AI · v6.9.31**.
4. Ouvre l'Assistant, demande une proposition puis vérifie qu'aucun blend n'est lancé avant ton clic. Teste séparément le blocage d'un titre, le blocage d'un artiste et leur déblocage dans Réglages.
5. Vérifie le lecteur et la synchronisation sur tes appareils. Si des publicités apparaissent malgré Premium, consulte l'aide dans Réglages et le LISEZ-MOI.

## En cas d'échec

- **Source introuvable :** décompresse le zip et place `src-v6.9.31` à côté du dépôt. Aucun fichier n'a été copié.
- **Modifications ou fichiers non suivis / ignorés détectés :** sauvegarde-les ou déplace-les, puis relance. La vérification des fichiers ignorés peut être plus stricte que nécessaire.
- **Pull refusé :** une divergence existe ; résous-la avant de relancer. Le script ne force pas la branche.
- **Erreur après copie, commit ou push :** des fichiers peuvent déjà avoir été copiés ou commités. Lis le message puis vérifie `git status` et `git log` avant toute nouvelle action.
- **Ancienne version affichée :** attends la fin d'Actions, ferme tous les onglets SoundBlend et rouvre le site.

Le `.bat` a été vérifié statiquement ; la copie de la 6.9.31 sur une source 6.9.30 a été simulée et recompilée. **Le script lui-même n'a pas été exécuté sous Windows** dans cet environnement. Le workflow conservé a pour MD5 `737ac33cc87eccfb9cbc112ac89bdd3f`.
