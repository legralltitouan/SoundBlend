https://legralltitouan.github.io/SoundBlend/

# SoundBlend — site complet (YouTube Music)

Application web de création de playlists par IA sur ta bibliothèque YouTube.
Une seule peau : **YouTube Music** — noir ou blanc pur, un seul accent rouge
(`#ff0033`), typographie fine, pochettes dominantes, aucune ombre, aucun flou
décoratif. L'agencement est celui de l'app mobile : hero + puces, grille de
pochettes, listes de titres nues, barre de lecture pleine largeur.

---

## 1. Essayer en localhost (2 minutes)

Prérequis : **Node.js 18 ou plus** (https://nodejs.org).

```bash
cd soundblend-app
npm install
npm run dev
```

Ouvre ensuite **http://localhost:5173**.

> Le port 5173 n'est pas décoratif : la clé YouTube fournie par défaut n'accepte
> que cette origine. Sur un autre port, la recherche YouTube et les playlists
> répondront « 403 » ; ajoute alors l'origine dans Google Cloud Console
> (voir la section 4) ou change de clé.

> Le premier `npm install` télécharge ~250 Mo de dépendances ; c'est normal.

### Voir la version déjà compilée, sans rien installer

Le dossier `dist/` contient le site prêt à servir :

```bash
npx serve dist          # ou :  python3 -m http.server --directory dist 8080
```

Puis http://localhost:3000 (ou http://localhost:8080).

### Recompiler après une modification

```bash
npm run build           # types + bundle → dist/
npm run preview         # sert dist/ sur http://localhost:4173
```

---

## 2. Les cinq écrans

| Écran | Ce qu'on y fait |
|---|---|
| **Bienvenue** | au tout premier lancement : choix du thème (deux cartes cliquables), connexion du compte Google, puis trois puces qui expliquent le principe. Une fois passée, l'app s'ouvre directement |
| **Bibliothèque** | accueil : « Bonjour <prénom> » + question qui tourne, un seul bouton **Nouveau blend**, grille des sources dont la première tuile reprend le dernier blend, dernier blend détaillé |
| **Blend** | mosaïque 2×2 des amorces, titre renommable, durée, boutons Écouter / Exporter / Privée-Publique, liste des titres avec catégorie (anchor, deep dive, découverte), 👍 👎, remplacer, retirer, réordonner |
| **Mes blends** | blends conservés 14 jours sur l'appareil, « n titres · m min », « expire dans X j », écouter / supprimer (2ᵉ clic = confirmation) |
| **Goûts** | mémoire de l'IA : aimés, écartés, artistes, évités ; onglets en puces ; réinitialiser |
| **Réglages** | mode clair/sombre, compte YouTube, clés & API. Accessible par **l'avatar du compte**, sous le « + » du rail à gauche sur ordinateur, à droite de la barre basse sur téléphone |

Sur téléphone la navigation passe en barre basse (Bibliothèque, Blends, Goûts,
puis l'avatar qui ouvre les réglages) ; sur bureau en rail de 76 px à gauche, où
l'avatar du compte se trouve **sous le bouton « + »**, en bas du rail. La barre
de lecture reste collée en bas dans les deux cas.

**Ambiance** : trois halos de couleur très diffus dérivent lentement derrière
les pages (teinte tirée du morceau en cours), recouverts d'un grain fin. Rien
n'est chargé depuis le réseau : c'est du CSS et une texture SVG inline. Le mode
« mouvement réduit » du système coupe les animations. La barre de lecture, elle,
affiche une **vague** : la silhouette du morceau se dessine en entier, la partie
écoutée se remplit dans la couleur du thème, un halo accompagne la crête. Elle
bat au rythme de la lecture et s'ouvre au survol.

**Première visite** : l'app s'ouvre sur un écran de bienvenue en trois temps —
l'ambiance (sombre ou clair, avec aperçu en direct), le compte Google, puis le
principe en trois lignes. Rien n'est imposé : « Plus tard » laisse entrer sans
compte (les données de démo prennent le relais). Pour revoir l'intro, supprime
la clé `soundblend_onboarded` du stockage du navigateur.

**Lecteur** : une seule barre de progression, celle du bord haut de la barre.
Elle s'épaissit au survol et se manipule au clic, au clic maintenu ou au
glissement, sur téléphone comme sur ordinateur. À droite, le volume remplace
l'ancienne seconde barre. Quand un morceau se termine, le suivant de la file
(playlist ou blend) démarre tout seul.

**Chercher hors de ses playlists** : dans la modale de sélection, tape au moins
deux lettres — les résultats de tout le catalogue YouTube apparaissent sous
« Ailleurs sur YouTube », au-dessus des morceaux de la playlist. Tu peux les
cocher comme les autres.

---

## 3. Ce qui fonctionne

- **Connexion Google** (Google Identity Services) → lecture des playlists du
  compte via YouTube Data API v3. Sans compte, un jeu de **données de démo**
  identique en structure s'affiche, donc tout est visitable hors connexion.
- **Lecture audio/vidéo** par l'IFrame API YouTube : file d'attente, précédent /
  suivant, volume, sourdine, progression, vue plein écran, clip.
- **Génération Gemini** : on coche quelques amorces, on choisit la durée (20 min
  → 2 h) et les proportions (anchor / deep dive / découvertes), l'IA compose la
  playlist et justifie chaque titre. **Aucun choix de modèle** : le moteur essaie
  automatiquement Gemini 3.8 Flash, puis 3.7, 3.6, 3.5, 3, 2.5 et 2.0 jusqu'à ce
  que l'un réponde.
- **Mémoire de goûts** : 👍 / 👎 mémorisés localement, réinjectés dans les
  consignes envoyées au modèle.
- **Export** : création d'une vraie playlist dans le compte YouTube Music.
- **Tout est stocké localement** (`localStorage`) : blends, goûts, réglages,
  clés. Aucun serveur SoundBlend, aucun envoi de données personnelles.
- **Accueil vivant** : « Bonjour Titouan. » reprend le prénom du compte
  connecté, et la question sous le titre tourne toutes les cinq secondes
  (« Qu'est-ce qu'on écoute ? », « Quel est ton mood musical ? », etc.).
- **Plein écran habillé** : la pochette du morceau sert de fond d'ambiance
  flouté (teinte tirée de l'illustration, voile dégradé vers le fond), sur
  ordinateur comme sur téléphone.
- **Lecteur invisible** : la vidéo YouTube est jouée dans une iframe placée hors
  de l'écran (aucune vignette parasite), et rien n'est chargé tant que tu n'as
  pas lancé un morceau.

---

## 4. Clés & API

**Aucune clé n'est écrite dans le code.** Le dépôt peut être public : il
ne contient aucun identifiant. Les clés arrivent par deux chemins, au
choix :

1. **Réglages → Clés & API** dans l'app (stockage navigateur, jamais envoyé).
   C'est le chemin pour l'app en ligne : chaque appareil garde les siennes.
2. Le fichier **`.env`** à la racine, pour le développement local
   (copié depuis `.env.example`), puis relancer `npm run dev` :

```env
VITE_GOOGLE_CLIENT_ID=….apps.googleusercontent.com
VITE_YOUTUBE_API_KEY=…
VITE_GEMINI_API_KEY=…
```

> `.env` est ignoré par Git (voir `.gitignore`) : il ne part jamais dans
> le dépôt. Sur GitHub, la compilation n'en a pas besoin — l'app se
> contente alors de demander les clés dans ses Réglages.

Pour que la connexion Google fonctionne depuis ton poste, ajoute l'origine dans
Google Cloud Console → *API et services* → *Identifiants* → ton client OAuth →
**Origines JavaScript autorisées** :

```
http://localhost:5173
http://localhost:4173
```

(Si tu sers le site sur un autre port, ajoute aussi cette origine.)

---

## 5. Structure

```
soundblend-app/
├── index.html
├── package.json
├── vite.config.ts           # dev 5273 · preview 4273
├── .env / .env.example
├── dist/                    # build prêt à servir
└── src/
    ├── index.css            # feuille unique : tokens, coque, grille, listes, lecteur
    ├── App.tsx
    ├── components/
    │   ├── shell/Shell.tsx          # rail (bureau) / barre basse (téléphone)
    │   ├── views/                   # Library · Blend · History · Taste · Settings
    │   ├── modals/                  # Picker (choix des morceaux) · Config · Compte · Export
    │   ├── player/PlayerBar.tsx     # barre de lecture + plein écran + clip
    │   └── ui/                      # Modal, boutons, toasts
    ├── context/                     # Data (bibliothèque, blends) · Player · UI
    ├── services/                    # youtube.ts · gemini.ts · storage.ts
    ├── data/mockData.ts             # jeu de démonstration
    └── types/
```

---

## 6. Dépannage

| Symptôme | Cause / remède |
|---|---|
| « Connexion Google refusée » | l'origine `http://localhost:5173` n'est pas dans les origines autorisées du client OAuth |
| Bibliothèque vide | aucune playlist sur le compte choisi, ou clé API YouTube absente → le mode démo prend le relais |
| « Clé Gemini invalide » | clé expirée ou quota épuisé → Réglages → Clés & API, ou remplace la clé |
| Un titre ne démarre pas | restrictions d'intégration YouTube sur cette vidéo ; « Clip » ouvre la page d'origine |
| La recherche YouTube répond 403 | la clé n'autorise pas ton origine → mets à jour la restriction de référent ou change de clé |
| Port déjà pris | `npm run dev -- --port 5300` |
| Miniatures manquantes | YouTube bloque parfois `i.ytimg.com` (réseau/école) ; les textes restent lisibles |

---

Version 4.0 — SoundBlend, peau YouTube Music.
