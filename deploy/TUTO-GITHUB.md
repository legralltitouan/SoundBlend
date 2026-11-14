# Mettre SoundBlend sur GitHub — le tutoriel

*De zéro à une adresse https qui marche 24 h/24, sans PC allumé, sans
PowerShell. Et **sans jamais publier tes clés**.*

Temps : 15 à 20 minutes la première fois. Ensuite, mettre à jour prend
deux minutes et un glisser-déposer.

Tu n'as besoin que d'un navigateur.

---

## Avant de commencer — la règle des clés

Trois choses à savoir, et elles règlent la question pour de bon :

1. **Le code que je te livre ne contient aucune clé.** Je l'ai retiré de
   `src/services/storage.ts` : le fichier lisait deux vraies clés
   (`AIza…`) et l'identifiant OAuth en dur. Un dépôt public les aurait
   publiées, et une clé Gemini publiée est une clé à révoquer dans
   l'heure.
2. **Le fichier `.env` ne part jamais sur GitHub.** Il est listé dans
   `.gitignore` — vérifié : Git refuse `.env`, `.env.backup`,
   `.env.production.local` et n'accepte que `.env.example` (le modèle
   vide).
3. **En ligne, les clés se saisissent dans l'app**, écran
   *Réglages → Clés & API*. Elles restent dans **ton** navigateur
   (`localStorage`), sur **ton** téléphone. Elles ne sont envoyées à
   aucun serveur — sauf directement à Google, qui les vérifie.

Résultat : ton dépôt peut être **public**, il ne contient aucun secret.
C'est d'ailleurs obligatoire pour un dépôt privé.

> ⚠️ Une exception : l'**identifiant client OAuth** (le
> `…apps.googleusercontent.com`). Ce n'est pas un secret — Google le
> considère comme public, il apparaît dans toutes les apps web. Tu peux
> le laisser dans tes réglages, il ne permet rien à lui seul (la clé
> secrète, elle, ne doit jamais sortir — et elle n'est pas dans l'app).

---

## Étape 1 — Créer le compte GitHub

1. Va sur `github.com` → **Sign up**.
2. Un courriel, un mot de passe, un nom d'utilisateur, et valide le code
   reçu par courriel.
3. Plan **Free**, sans carte bancaire. C'est suffisant.

---

## Étape 2 — Créer le dépôt

1. En haut à droite : **+** → **New repository**.
2. **Repository name** : `soundblend`
   *(tout en minuscules, sans espace ni accent — ce nom apparaîtra dans
   l'adresse du site).*
3. **Description** : facultatif.
4. **Public** ← obligatoire pour que GitHub Pages soit gratuit. Le code
   ne contient aucune clé, donc c'est sans risque.
5. Ne coche **rien** d'autre (pas de README, pas de `.gitignore`) : on va
   déposer le projet tel quel.
6. **Create repository**.

Tu arrives sur une page avec des instructions Git. **Ignore-les** : on
va tout faire à la souris.

---

## Étape 3 — Déposer le projet

GitHub n'accepte pas les dossiers vides ni les fichiers cachés par
glisser-déposer, d'où la méthode en deux temps.

### 3a. Les dossiers, un par un

Sur la page du dépôt : **Add file** → **Upload files**.

Dépose, un dossier à la fois (glisse le dossier entier dans la page,
tu peux aussi passer par « choose your files » puis sélectionner un
dossier) :

| Dossier à déposer | Contenu |
| --- | --- |
| `src/` | tout le code de l'app (44 fichiers) |
| `public/` | icônes, manifeste, service worker (11 fichiers) |
| `deploy/` | le mode d'emploi de l'hébergement (1 fichier) |

À chaque dépôt, en bas de page, clique sur **Commit changes**.

### 3b. Le fichier de publication automatique

1. **Add file** → **Create new file**.
2. Dans le champ du nom, tape exactement :
   `.github/workflows/pages.yml`
   (les `/` créent les dossiers tout seuls).
3. Dans la zone de texte, colle le contenu du fichier
   **`pages.yml`** que je te fournis à côté de ce tutoriel.
4. **Commit changes**.

### 3c. Les fichiers de la racine

**Add file** → **Upload files**, puis dépose ces fichiers, **un par un**
(ils sont tous à la racine du projet) :

```
index.html
package.json
package-lock.json
vite.config.ts
postcss.config.js
tailwind.config.js
tsconfig.json
tsconfig.app.json
tsconfig.node.json
eslint.config.js
README.md
.gitignore
.gitattributes
.env.example
```

> Si un nom n'existe pas dans ton dossier, ignore-le. Ce qui compte :
> `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`,
> `.gitignore` et `.env.example`.

**Ne dépose jamais :** `.env`, `node_modules/`, `dist/`, ni aucun fichier
dont le nom finit par `.local`.

> `.gitignore` et `.gitattributes` commencent par un point : le
> sélecteur de fichiers de Windows les cache. Dans la fenêtre
> d'upload, tape `*` dans le champ du nom pour les faire apparaître,
> ou crée-les avec **Create new file** en tapant leur nom.

### 3d. Vérifier que rien de secret n'est passé

Sur la page du dépôt :

1. Clique sur le fichier **`.env`** : il ne doit **pas** exister. S'il
   apparaît, supprime-le (ouvre-le → icône corbeille → **Commit**).
2. Dans la barre de recherche du dépôt (en haut), cherche `AIza`.
   Résultat attendu : **aucun fichier de code**. (Tu ne verras au mieux
   que ce tutoriel, qui en parle sans en contenir.)
3. Cherche `449975100236` (le début de ton identifiant OAuth) :
   il ne doit apparaître nulle part.

Si l'une de ces recherches trouve quelque chose : ne publie pas, et
**révoque la clé concernée** (voir la section « Si une clé a fuité »).

---

## Étape 4 — Activer GitHub Pages

1. Onglet **Settings** du dépôt (en haut à droite).
2. Colonne de gauche : **Pages**.
3. Section *Build and deployment* → **Source** : choisis
   **GitHub Actions** (et non « Deploy from a branch »).
4. Rien d'autre à régler.

---

## Étape 5 — Laisser GitHub compiler

1. Onglet **Actions**.
2. Un travail nommé **« Publier sur GitHub Pages »** tourne (point
   orange). Il prend une à deux minutes.
3. Quand il devient **vert**, clique dessus : la dernière étape,
   *deploy*, affiche l'adresse du site.

L'adresse a cette forme :

```
https://<ton-compte>.github.io/soundblend/
```

> Le travail compile avec le bon sous-dossier tout seul (`/soundblend/`) :
> c'est ce que fait la variable `BASE_PATH` dans le workflow. Rien à
> régler à la main.

**Si le travail est rouge**, ouvre-le : la ligne fautive est la dernière
en rouge. Les deux causes habituelles sont un fichier manquant à la
racine (`package-lock.json` oublié) ou `package.json` placé dans un
sous-dossier. Corrige en redéposant le fichier : GitHub relance seul.

---

## Étape 6 — Ouvrir l'adresse sur le téléphone

1. Envoie-toi l'adresse (note, message, QR code).
2. Ouvre-la sur le téléphone, dans **Chrome** (Android) ou **Safari**
   (iPhone).
3. La carte **« Installer SoundBlend »** apparaît en bas :
   - Android → **Installer** ;
   - iPhone → **Partager** → **Sur l'écran d'accueil**.
4. L'icône est posée. L'app s'ouvre en plein écran, et fonctionne même
   sans réseau pour l'interface.

---

## Étape 7 — Saisir les clés, une fois, sur l'appareil

À la première ouverture de l'app installée :

1. Icône d'engrenage → **Réglages**.
2. Carte **Clés & API** : un avertissement rouge indique ce qui manque.
3. Colle :
   - **Client ID OAuth Google** — `…apps.googleusercontent.com` ;
   - **Clé API YouTube Data v3** — `AIza…` ;
   - **Clé API Gemini** — `AIza…`.
4. **Enregistrer**.

Elles restent dans ce navigateur. Pour un second appareil, ressaisis-les
(ou copie-les), c'est tout.

> **Depuis la v6.9.8, l'app ne lit plus aucune clé au moment de la
> compilation.** Avant, un `.env` présent sur le PC pendant `npm run
> build` faisait entrer la clé dans le fichier JavaScript publié — donc
> dans le dépôt public. C'est corrigé : le fichier `dist/` livré ne
> contient aucun identifiant, vérifié au scan. Les clés n'existent que
> dans la saisie de l'écran Réglages.

---

## Étape 8 — Deux réglages côté Google (sinon ça bloque)

Ces deux-là ne sont pas dans l'app, et sans eux la connexion YouTube
échoue avec une erreur.

### 8a. L'origine autorisée (OAuth)

`console.cloud.google.com` → **API et services** → **Identifiants** →
ton **ID client OAuth** → **Origines JavaScript autorisées** → **Ajouter
un URI** :

```
https://<ton-compte>.github.io
```

⚠️ **Sans le `/soundblend/`** : Google ne compare que le domaine.
Enregistre. La prise en compte peut demander quelques minutes.

### 8b. La restriction de la clé YouTube

**API et services** → **Identifiants** → ta **clé API** → *Restrictions
relatives aux applications* → **Sites web** → ajoute :

```
https://<ton-compte>.github.io/*
```

Sans ça, les recherches YouTube renvoient `403`.

---

## Mettre à jour l'app plus tard (la méthode qui marche)

Ton dépôt a une particularité : **le contenu de l'app est à la racine**
(`src/`, `public/`, `index.html`, `package.json`, `.github/workflows/`)
— et c'est ce que ton `pages.yml` attend. On ne change donc **jamais**
la structure, on remplace seulement les fichiers.

### Méthode A — glisser-déposer (la plus simple)

1. Sur GitHub, ouvre le dépôt `legralltitouan/SoundBlend`.
2. **Add file** → **Upload files**.
3. Ouvre le dossier `site-v6.9.8/` livré dans l'archive, sélectionne
   **tout ce qu'il contient** (`src`, `public`, `deploy`, les fichiers de
   la racine…) et dépose-le dans la page.
4. En bas, écris le message (`v6.9.8 — player au doigt, timeline réparée,
   doublons verrouillés`), puis **Commit changes**.
5. ⚠️ **Ne dépose jamais** `.github/workflows/pages.yml` : ton fichier
   actuel fonctionne. GitHub le remplacerait par une variante prévue
   pour un autre rangement (`soundblend-app/`), et le site casserait.
   Si tu dois le modifier, fais-le au crayon, directement dans GitHub.

GitHub lance alors *Publier sur GitHub Pages* : onglet **Actions**, la
pastille passe au vert en une à deux minutes, et l'adresse est à jour.

### Méthode B — en ligne de commande (si tu as Git sur ton PC)

```bash
# dans le dossier qui contient le contenu de site-v6.9.8/
git clone https://github.com/legralltitouan/SoundBlend.git
cd SoundBlend

# on remplace le contenu de l'app, sans toucher au workflow
cp -r /chemin/vers/site-v6.9.8/src            .
cp -r /chemin/vers/site-v6.9.8/public         .
cp -r /chemin/vers/site-v6.9.8/deploy         .
cp    /chemin/vers/site-v6.9.8/index.html     .
cp    /chemin/vers/site-v6.9.8/package.json   .
cp    /chemin/vers/site-v6.9.8/package-lock.json .
cp    /chemin/vers/site-v6.9.8/*.js  .        # vite, tailwind, postcss
cp    /chemin/vers/site-v6.9.8/tsconfig*.json .

git add -A && git commit -m "v6.9.8" && git push
```

### Vérifier que la mise à jour est bien en ligne

1. **Actions** → le dernier *Publier sur GitHub Pages* est vert.
2. Ouvre le site, puis **Réglages** en bas de l'écran : la version
   affichée doit être **v6.9.8**.
3. Si le téléphone montre encore l'ancienne version : ferme l'onglet,
   rouvre-le (le service worker met le site en cache).

---

## Et si je préfère ne pas passer par GitHub ?

**Cloudflare Pages** fait la même chose en plus court, sans dépôt : on
glisse le dossier `dist/` (fourni) sur `dash.cloudflare.com`, et
l'adresse `https://soundblend.pages.dev` existe. Gratuit, bande passante
illimitée.

Différence : avec GitHub, ton code est conservé et versionné, et chaque
mise à jour est un simple dépôt de fichiers. Avec Cloudflare, il n'y a
que le site compilé.

---

## Si une clé a fuité

Une clé publiée est une clé perdue : GitHub est public, et des robots
lisent les nouveaux dépôts en quelques minutes.

1. **Révoque** : `aistudio.google.com` → *Get API key* → supprime la clé
   (Gemini) ; `console.cloud.google.com` → *Identifiants* → supprime la
   clé YouTube, puis crée-en une neuve.
2. **Restreins** la nouvelle : sites web autorisés (ton adresse GitHub),
   et pour Gemini, la restriction par API.
3. **Nettoie le dépôt** : supprime le fichier fautif, puis vérifie dans
   *Settings → Secrets and variables → Actions* qu'aucun secret n'a été
   stocké par erreur.
4. Retire-la aussi de `.env` sur ton PC, et ressaisis la neuve dans
   l'app.

Un doute sur ce qui est public ? Un dépôt GitHub public est lisible par
n'importe qui, y compris l'historique des versions : un secret supprimé
aujourd'hui reste lisible dans l'historique. C'est pour ça qu'on ne le
dépose jamais.

---

## Récapitulatif en une page

| Étape | Où | Quoi |
| --- | --- | --- |
| 1 | github.com | compte gratuit |
| 2 | + → New repository | `soundblend`, **Public** |
| 3 | Add file → Upload | `src/`, `public/`, `deploy/`, puis la racine |
| 3b | Create new file | `.github/workflows/pages.yml` |
| 4 | Settings → Pages | Source : **GitHub Actions** |
| 5 | Actions | attendre le vert |
| 6 | téléphone | installer depuis la carte |
| 7 | app → Réglages | saisir les 3 clés |
| 8 | console.cloud.google.com | origine autorisée + restriction de clé |
