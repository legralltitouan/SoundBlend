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

const VERSION = 'sb-v6-9-42';
const SHELL = `${VERSION}-shell`;

/* l'interface : la page, le manifeste, les icônes. Les fichiers hachés
   par Vite (index-xxxx.js) sont ajoutés à l'installation, à la volée. */
/* le dossier depuis lequel le service worker est servi : la racine sur un
   domaine, /<dépôt>/ sur GitHub Pages. Tout est calculé à partir de là,
   jamais écrit en dur. */
const BASE = new URL(self.registration.scope).pathname;
const appUrl = (path) => `${BASE}${path}`.replace(/\/{2,}/g, '/');
const PRECACHE = [appUrl('index.html'), appUrl('manifest.webmanifest'), appUrl('icon-192.png'), appUrl('icon-512.png'), appUrl('apple-touch-icon.png'), appUrl('logo.png')];
const appAssets = (html) => [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)]
  .map((m) => (m[1].startsWith('http') ? null : new URL(m[1], self.registration.scope).href))
  .filter(Boolean);

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
    /* Ne jamais remplacer une version hors ligne utilisable par un cache
       incomplet : une panne pendant la mise à jour laisse l'ancien worker
       actif, et le navigateur pourra réessayer à la prochaine visite. */
    const response = await fetch(appUrl('index.html'), { cache: 'reload' });
    if (!response.ok) throw new Error('Interface indisponible pendant la mise à jour.');
    const html = await response.clone().text();
    /* les chemins de Vite sont absolus (/soundblend/assets/…) ou relatifs */
    const assets = appAssets(html);
    if (!assets.some((a) => /\.js(?:\?|$)/.test(a)) || !assets.some((a) => /\.css(?:\?|$)/.test(a))) {
      throw new Error('Ressources compilées absentes pendant la mise à jour.');
    }
    await c.addAll(PRECACHE.filter((url) => url !== appUrl('index.html')));
    for (const url of assets) {
      const asset = await fetch(url, { cache: 'reload' });
      if (!asset.ok || /text\/html/i.test(asset.headers.get('content-type') || '')) {
        throw new Error('Une ressource compilée est indisponible pendant la mise à jour.');
      }
      await c.put(url, asset);
    }
    // La page et les empreintes préchargées proviennent de la même lecture.
    await c.put(appUrl('index.html'), response);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^sb-v[\d-]+-shell$/.test(k) && k !== SHELL).map((k) => caches.delete(k))))
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
        .then(async (res) => {
          if (res.ok) {
            try {
              const cache = await caches.open(SHELL);
              const assets = appAssets(await res.clone().text());
              // Ne pas remplacer la page hors ligne si elle référence une
              // nouvelle compilation dont les ressources manquent encore.
              const present = await Promise.all(assets.map((url) => cache.match(url, { ignoreVary: true })));
              if (assets.length && present.every(Boolean)) await cache.put(appUrl('index.html'), res.clone());
            } catch { /* la page en ligne reste utilisable ; on garde l'ancienne hors ligne */ }
          }
          return res;
        })
        .catch(() => caches.open(SHELL).then((c) => c.match(appUrl('index.html'), { ignoreVary: true })).then((r) => r || Response.error())),
    );
    return;
  }

  /* les fichiers de l'app (js, css, icônes, polices) : le cache d'abord,
     ils portent une empreinte dans leur nom et ne changent jamais */
  e.respondWith(
    caches.open(SHELL).then((cache) => {
      // Certains serveurs ajoutent « Vary: Origin » même aux fichiers
      // statiques. Un script module et son préchargement n'envoient pas
      // toujours le même en-tête Origin : ne l'ignorer que pour notre
      // interface publique et ses ressources hachées, jamais pour les API.
      const shellAsset = url.pathname.startsWith(appUrl('assets/')) || PRECACHE.includes(url.pathname);
      return cache.match(req, { ignoreVary: shellAsset }).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok && (res.type === 'basic' || res.type === 'default')) {
            const copy = res.clone();
            cache.put(req, copy).catch(() => undefined);
          }
          return res;
        }).catch(() => Response.error());
      });
    }),
  );
});
