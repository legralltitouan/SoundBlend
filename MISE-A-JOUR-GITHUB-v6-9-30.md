# Mise à jour GitHub — SoundBlend 6.9.30

## Fichiers nécessaires

- `soundblend-site-v6-9.zip` — à décompresser à côté du dépôt ; il crée le dossier `src-v6.9.30`.
- `MAJ-SoundBlend-v6.9.30.bat` — à copier dans le dépôt Git cloné.
- `LISEZ-MOI-v6-9-30.md` — détails, résultats des tests et limites Premium/synchronisation.

```text
Téléchargements/
├── SoundBlend/                 dépôt Git cloné, branche main
│   ├── .git/
│   ├── .github/workflows/pages.yml
│   ├── src/
│   └── MAJ-SoundBlend-v6.9.30.bat
└── src-v6.9.30/                dossier extrait du zip
    ├── src/
    ├── public/
    └── package.json
```

## Avant de lancer

Sauvegarde et committe les modifications du dépôt si tu en as. Le script s'arrête si des fichiers suivis sont modifiés ou si des fichiers non suivis se trouvent dans les chemins à mettre à jour. Il ne fait **pas** de `git reset --hard` et ne supprime pas les dossiers.

Le script nécessite Git pour Windows, la branche `main`, un accès au dépôt distant `origin`, et un historique qui accepte un `git pull --ff-only`. Il copie les fichiers du paquet, crée un commit si nécessaire et pousse sur `origin/main`. Il ne modifie pas le workflow `.github/workflows/pages.yml` et n'ajoute pas les autres fichiers non suivis.

## Après lancement

1. Vérifie sur GitHub que l'Action **Publier sur GitHub Pages** est verte.
2. Ouvre le site, puis Réglages : le pied de page doit afficher **SoundBlend AI · v6.9.30**.
3. Teste une lecture puis **Titre → Vidéo → Titre → Vidéo**, un saut de lecture, et une fermeture/réouverture du grand lecteur.
4. Si une pub apparaît malgré YouTube Premium : utilise l'aide sous **Réglages → Compte Google → Des pubs malgré YouTube Premium ?**. La connexion à SoundBlend ne garantit pas la connexion du lecteur YouTube intégré. Consulte aussi [l'aide officielle YouTube](https://support.google.com/youtube/answer/7437519?hl=fr).

## En cas d'échec

- **Dossier introuvable :** décompresse le zip, puis place `src-v6.9.30` à côté du dépôt. Aucun changement n'a été fait.
- **Modifications détectées :** sauvegarde/committe-les avant de relancer ; le script ne les écrase pas volontairement.
- **Pull refusé :** une divergence existe ; résous-la avant de relancer. Le script ne force pas la branche.
- **Copie, commit ou push interrompu :** les fichiers peuvent déjà avoir été copiés ou commités. Lis le message et vérifie `git status` et `git log` avant toute nouvelle action.
- **Ancienne version affichée :** attends la fin d'Actions, ferme tous les onglets SoundBlend et rouvre le site.

Le `.bat` a été vérifié statiquement mais pas exécuté sur Windows ici. Les écarts observés avec deux lecteurs YouTube réels sont documentés dans le LISEZ-MOI ; ils ne garantissent pas une synchronisation parfaite de tous les clips ni l'absence de pubs sur ton compte.

Empreinte attendue de `pages.yml` : `737ac33cc87eccfb9cbc112ac89bdd3f` (MD5).
