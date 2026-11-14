/* ═══════════════════════════════════════════════════════════════
   Le service worker de SoundBlend.

   Deux rôles, et pas un de plus :

   1. rendre l'app installable — Chrome n'émet l'invitation que si un
      service worker répond aux requêtes ;
   2. faire tenir l'app debout hors ligne : l'interface est servie depuis
      le cache, les données vivent déjà dans le navigateur. Ouvrir
      SoundBlend dans le métro montre la bibliothèque, pas un dinosaure.

   Ce qui n'est JAMAIS mis en cache : les appels d'API (YouTube,
   Gemini, iTunes, pochettes). Une réponse d'IA ou une pochette servie
   depuis un cache périmé serait pire qu'une absence de réponse.
   ═══════════════════════════════════════════════════════════════ */

const VERSION = 'sb-v6-9-13';
const SHELL = `${VERSION}-shell`;

/* l'interface : la page, le manifeste, les icônes. Les fichiers hachés
   par Vite (index-xxxx.js) sont ajoutés à l'installation, à la volée. */
/* le dossier depuis lequel le service worker est servi : la racine sur un
   domaine, /<dépôt>/ sur GitHub Pages. Tout est calculé à partir de là,
   jamais écrit en dur. */
const BASE = new URL(self.registration.scope).pathname;
const url = (path) => `${BASE}${path}`.replace(/\/{2,}/g, '/');
const PRECACHE = [url('index.html'), url('manifest.webmanifest'), url('icon-192.png'), url('icon-512.png'), url('apple-touch-icon.png'), url('logo.png')];

const isApi = (url) =>
  /(^|\.)googleapis\.com$/.test(url.hostname) ||
  /(^|\.)googleusercontent\.com$/.test(url.hostname) ||
  /(^|\.)youtube\.com$/.test(url.hostname) ||
  /(^|\.)ytimg\.com$/.test(url.hostname) ||
  /(^|\.)itunes\.apple\.com$/.test(url.hostname) ||
  /(^|\.)mzstatic\.com$/.test(url.hostname) ||
  /(^|\.)gstatic\.com$/.test(url.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE).catch(() => undefined);
    /* les fichiers de l'app portent une empreinte que Vite choisit à la
       compilation : on lit la page et on retient tout ce qu'elle appelle,
       pour que la première ouverture hors ligne fonctionne déjà */
    try {
      const html = await (await fetch(url('index.html'), { cache: 'reload' })).text();
      /* les chemins de Vite sont absolus (/soundblend/assets/…) ou
         relatifs selon la compilation : on accepte les deux */
      const assets = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)]
        .map((m) => (m[1].startsWith('http') ? null : new URL(m[1], self.registration.scope).href))
        .filter(Boolean);
      if (assets.length) await c.addAll(assets);
    } catch { /* tant pis : la navigation en ligne les mettra en cache */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  /* les API et les images distantes : jamais de cache, jamais d'attente
     d'un cache. On laisse le réseau faire, et échouer franchement. */
  if (isApi(url) || url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.origin !== self.location.origin) return;

  /* une navigation : le réseau d'abord (pour avoir la dernière version),
     l'interface en cache si le réseau ne répond pas */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(url('index.html'), copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(url('index.html')).then((r) => r || Response.error())),
    );
    return;
  }

  /* les fichiers de l'app (js, css, icônes, polices) : le cache d'abord,
     ils portent une empreinte dans leur nom et ne changent jamais */
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      }).catch(() => Response.error());
    }),
  );
});
