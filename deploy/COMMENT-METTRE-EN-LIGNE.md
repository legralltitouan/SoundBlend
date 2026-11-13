# Mettre SoundBlend en ligne — une fois, puis plus jamais

Objectif : une adresse https qui marche 24 h/24, sans PC allumé, sans
PowerShell, sans rien relancer. Trois chemins, du plus simple au plus
durable. Choisis-en **un**.

---

## Chemin A — Cloudflare Pages : le plus simple (10 minutes, sans Git)

C'est celui que je recommande pour commencer. Gratuit, sans carte
bancaire, **bande passante illimitée**, et on peut déposer les fichiers
directement depuis le navigateur.

1. Compile l'app une fois (je te fournis le dossier `dist/` prêt).
2. Va sur `dash.cloudflare.com` → crée un compte gratuit.
3. Menu **Workers & Pages** → **Create** → onglet **Pages** → **Upload assets**.
4. Donne un nom au projet : `soundblend` → l'adresse sera
   `https://soundblend.pages.dev`.
5. Glisse **tout le contenu** du dossier `dist/` (pas le dossier
   lui-même : `index.html`, `assets/`, `sw.js`, `manifest.webmanifest`…).
6. **Deploy**. C'est en ligne, en https, pour toujours.

Limites du gratuit : 500 compilations par mois (tu n'en feras qu'une
poignée), 20 000 fichiers, 25 Mo par fichier. Aucune limite de trafic.

> Pas de Git, pas de terminal. Pour mettre à jour plus tard, même écran :
> **Create new deployment** et on reglisse le nouveau `dist/`.

---

## Chemin B — GitHub Pages : gratuit à vie, et l'historique du code

Un peu plus long la première fois, mais ensuite **un seul envoi de
fichiers** met le site à jour, et GitHub compile tout seul.

1. Crée un compte sur `github.com` (gratuit).
2. **New repository** → nom : `soundblend` → **Public** (obligatoire
   pour Pages gratuit) → **Create**.
3. **Add file → Upload files** : dépose tout le **contenu** de
   `soundblend-app/` (le dossier `src/`, `public/`, `package.json`,
   `index.html`, `.github/`, `vite.config.ts`…) — pas `node_modules`,
   pas `dist`. Valide avec **Commit changes**.
4. Onglet **Settings → Pages** → *Build and deployment* → **Source :
   GitHub Actions**.
5. Onglet **Actions** : le travail « Publier sur GitHub Pages » se lance
   tout seul (≈ 1 minute). À la fin, l'adresse est
   `https://<ton-compte>.github.io/soundblend/`.
6. Ouvre cette adresse sur ton téléphone : la carte « Installer
   SoundBlend » apparaît, et l'app s'installe.

Le fichier `.github/workflows/pages.yml` s'occupe de tout : il installe,
compile avec le bon sous-dossier (`/soundblend/`), publie. **Il n'y a
rien à exécuter chez toi.**

Mettre à jour : on remplace les fichiers modifiés dans le dépôt, on
valide, GitHub republie en une minute.

Limites du gratuit (largement suffisantes ici) : 1 Go de site publié,
100 Go de trafic par mois, 10 compilations par heure. GitHub demande de
ne pas en faire un usage commercial — c'est un projet personnel, donc
c'est bon.

---

## Chemin C — Ton domaine à toi

Si tu veux `soundblend.fr` plutôt qu'une adresse en `.pages.dev` ou
`.github.io` :

1. Achète le domaine (≈ 10 €/an, chez OVH, Porkbun, Namecheap…).
2. Chez Cloudflare Pages : projet → **Custom domains** → **Set up a
   domain** → suis les deux enregistrements DNS indiqués.
3. Chez GitHub Pages : Settings → Pages → **Custom domain**, puis un
   enregistrement `CNAME` chez ton registrar.

Le certificat https est créé et renouvelé tout seul dans les deux cas.
C'est la seule option payante, et c'est ~10 € par an, pas par mois.

---

## Ce qu'il ne faut PAS choisir

**Netlify** n'est plus gratuit « à vie » : depuis 2025, le plan gratuit
donne 300 crédits par mois, et quand ils sont épuisés **tous les sites
du compte sont mis en pause** jusqu'au mois suivant. Pour une app qu'on
ouvre tous les jours, c'est un piège. Vercel a aussi une limite de
bande passante et interdit l'usage commercial sur son plan gratuit.

**Un ordinateur allumé** : plus la peine. Les deux chemins ci-dessus
tournent sur l'infrastructure de Cloudflare ou de GitHub.

---

## Après la mise en ligne — deux réglages à ne pas oublier

1. **Google Cloud → Identifiants → ton client OAuth** : ajoute
   `https://soundblend.pages.dev` (ou ton adresse) dans
   **Origines JavaScript autorisées**. Sinon la connexion YouTube sera
   refusée par Google avec une erreur `redirect_uri_mismatch` ou
   `origin_mismatch`.
2. **Clé API YouTube** : si elle est restreinte par référent HTTP,
   ajoute la nouvelle adresse dans la liste. Sinon les recherches
   YouTube renverront 403.

Les clés Gemini et YouTube restent dans le navigateur (`localStorage`) :
elles ne partent pas dans le code publié. Ne les écris jamais dans un
fichier du dépôt.

---

## Installer l'app sur le téléphone

Une fois l'adresse ouverte sur le téléphone :

- **Android / Chrome** : la carte « Installer SoundBlend » apparaît en
  bas, au-dessus de la barre de lecture. Un appui, et l'icône est posée.
- **iPhone / Safari** : Partager → « Sur l'écran d'accueil ».
- L'app s'ouvre ensuite en plein écran, et fonctionne même hors réseau
  pour l'interface.
