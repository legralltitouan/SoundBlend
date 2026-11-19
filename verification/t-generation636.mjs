/* Génération et secours 6.9.36 : Gemini, YouTube et Piped entièrement simulés. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (ok, name, details) => { assert.ok(ok, `${name}${details ? `\n${JSON.stringify(details)}` : ''}`); checks++; console.log(`  ✓ ${name}`); };
const id = (prefix, n) => `${prefix}${String(n).padStart(10, '0')}`;
const item = (vid, title, artist) => ({ url: `/watch?v=${vid}`, title, uploaderName: artist, type: 'stream', duration: 210 });
const goodFresh = Array.from({ length: 12 }, (_, i) => ({ title: `Fresh Song ${i + 1}`, artist: `Band ${i + 1}`, videoId: id('F', i + 1), rationale: 'Texture proche' }));
const goodDeep = Array.from({ length: 12 }, (_, i) => ({ title: `Hidden Song ${i + 1}`, artist: 'Alpha', videoId: id('H', i + 1), rationale: 'Titre d’album' }));
const badDeep = Array.from({ length: 8 }, (_, i) => ({ title: `Absent ${i + 1}`, artist: 'Alpha', videoId: id('B', i + 1) }));

async function open(mode, options = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  // Le délai réel de 12 secondes est accéléré uniquement dans ce profil.
  if (mode.startsWith('rate-')) await ctx.addInitScript(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => original(fn, ms === 12000 ? 40 : ms, ...args);
  });
  const calls = { models: [], oembed: [], piped: [] };
  await ctx.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' });
    if (url.pathname.endsWith('/models')) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ models: [
      { name: 'models/gemini-3.0-pro', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 },
    ] }) });
    const prompt = JSON.parse(req.postData() || '{}').contents?.[0]?.parts?.[0]?.text || '';
    const role = prompt.includes('premier travail est de les ÉCOUTER') ? 'analysis'
      : prompt.includes('« DEEP DIVE » — les faces cachées') ? 'deep'
        : prompt.includes('═══ TA SÉLECTION ═══') ? 'fresh' : 'other';
    const model = url.pathname.match(/models\/([^:]+)/)?.[1] || '';
    const key = url.searchParams.get('key');
    calls.models.push({ role, model, key });
    const limited = mode === 'all-quota' || mode === 'rate-exhaust' || (mode === 'rate-recover' && calls.models.length <= 2)
      || (mode === 'cross-key' && key === 'key-A') || (mode === 'partial' && role === 'deep')
      || (mode === 'mixed' && role === 'deep' && model === 'gemini-3.0-pro')
      || (mode === 'next-model' && model === 'gemini-3.0-pro');
    if (limited) {
      if ((mode === 'partial' || mode === 'mixed') && role === 'deep') await new Promise((resolve) => setTimeout(resolve, 80));
      return route.fulfill({ status: 429, headers: cors, body: JSON.stringify({ error: { code: 429, message: mode.startsWith('rate-') ? 'requests per minute' : 'quota per day' } }) });
    }
    if (mode === 'mixed' && role === 'deep') return route.fulfill({ status: 403, headers: cors, body: '{"error":{"message":"permission denied"}}' });
    const content = role === 'analysis' ? { fil: 'Une électronique aérienne', genres: ['electro'], textures: ['synthé'], energie: 'douce', eviter: [] }
      : role === 'deep' ? { titres: mode === 'youtube-errors' ? badDeep : goodDeep }
        : { titres: mode === 'youtube-errors' ? [{ title: 'Absent frais', artist: 'Another', videoId: id('B', 20) }] : goodFresh.slice(0, options.freshLimit || goodFresh.length) };
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(content) }] } }] }) });
  });
  await ctx.route(/pipedapi\.|api\.piped\./, (route) => {
    const u = new URL(route.request().url()); const q = (u.searchParams.get('q') || '').toLowerCase(); calls.piped.push(q);
    let items = [];
    if (!options.noNeighbours && q === 'alpha mix') items = [item(id('N', 1), 'Neighbor - Discovery 1', 'Neighbor')];
    else if (!options.noNeighbours && (q === 'neighbor' || q === 'neighbor topic')) items = Array.from({ length: 12 }, (_, i) => item(id('N', i + 1), `Neighbor - Discovery ${i + 1}`, 'Neighbor'));
    else if (options.oneDeep && q === 'alpha') items = [item(id('H', 1), 'Alpha - Hidden Song 1', 'Alpha')];
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items }) });
  });
  await ctx.route('https://www.youtube.com/oembed**', async (route) => {
    const nested = new URL(new URL(route.request().url()).searchParams.get('url')); const vid = nested.searchParams.get('v'); calls.oembed.push(vid);
    if (vid.startsWith('B')) return route.fulfill({ status: Number(vid.slice(-1)) % 2 ? 404 : 400, headers: cors, body: '{}' });
    if (vid === 'PENDING0001') { await new Promise((resolve) => setTimeout(resolve, 100)); return route.fulfill({ status: 404, headers: cors, body: '{}' }); }
    const n = Number(vid.slice(1));
    let meta = { title: `Seed ${n}`, author_name: 'Alpha - Topic' };
    if (vid.startsWith('N')) meta = { title: `Neighbor - Discovery ${n}`, author_name: 'Neighbor - Topic' };
    if (vid.startsWith('F')) meta = { title: `Fresh Song ${n}`, author_name: `Band ${n} - Topic` };
    if (vid.startsWith('H')) meta = { title: `Hidden Song ${n}`, author_name: 'Alpha - Topic' };
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(meta) });
  });
  const page = await ctx.newPage();
  await page.goto(new URL('verification/test-harness.html', base).href);
  await page.evaluate(async ({ noSeeds }) => {
    localStorage.clear();
    const { youtubeService } = await import('/src/services/youtube.ts');
    youtubeService.estJouable = async () => noSeeds ? ({ ok: false, raison: 'vidéo absente' }) : ({ ok: true });
    youtubeService.findPlayable = async () => null;
  }, { noSeeds: !!options.noSeeds });
  return { ctx, page, calls };
}

async function run(page, { key = 'test-key', seedCount = 5, minutes = 35, ratio = { anchor: 30, deepDive: 30, fresh: 40 }, instruction = '', blockTitle = '', recentTitle = '' } = {}) {
  return page.evaluate(async ({ key, seedCount, minutes, ratio, instruction, blockTitle, recentTitle }) => {
    const s = await import('/src/services/storage.ts');
    const { geminiService: g } = await import('/src/services/gemini.ts');
    s.saveStoredSettings({ googleClientId: '', youtubeApiKey: '', geminiApiKey: key });
    if (blockTitle) s.block({ title: blockTitle, artist: 'Neighbor' }, 'track');
    if (recentTitle) s.writeDiscoveryHistory([{ title: recentTitle, artist: 'Neighbor', shownAt: Date.now() - 1000 }]);
    const seeds = Array.from({ length: seedCount }, (_, i) => ({ id: `seed-${i}`, title: `Seed ${i + 1}`, artist: 'Alpha', videoId: `P${String(i + 1).padStart(10, '0')}`, thumbnailUrl: '', durationSeconds: 210 }));
    const progress = [];
    const tracks = await g.generateBlend(seeds, { durationMinutes: minutes, ratio, instruction }, s.getExclusions(), (m) => progress.push(m));
    return { tracks, report: g.dernierRapport, method: g.derniereMethode, model: g.dernierModele, note: g.derniereNote, progress };
  }, { key, seedCount, minutes, ratio, instruction, blockTitle, recentTitle });
}

try {
  let env = await open('all-quota');
  let r = await run(env.page);
  check(r.report.requested.anchor === 3 && r.report.requested.deepDive === 3 && r.report.requested.fresh === 4, 'répartition de départ exacte sur 10 titres', r);
  check(r.report.before.anchor === 3 && r.report.before.deepDive === 0 && r.report.before.fresh === 4, 'toutes les faces cachées manquantes sont comptées avant compensation', r.report);
  check(r.tracks.length === 10 && r.report.added.anchor === 1 && r.report.added.fresh === 2, 'manque réparti 30:40 entre un pilier et deux découvertes', r.report);
  check(r.report.created.anchor === 4 && r.report.created.deepDive === 0 && r.report.created.fresh === 6, 'étiquettes et comptes finaux restent exacts', r.report);
  check(r.report.warning.includes('429') && r.report.warning.includes('tous les modèles') && r.report.warning.includes('0/3 faces cachées') && r.report.warning.includes('10/10'), 'avertissement persistant : quota constaté, manque et résultat', r.report);
  check(new Set(r.tracks.map((t) => t.videoId)).size === r.tracks.length && r.tracks.filter((t) => t.category === 'fresh').every((t) => t.artist !== 'Alpha'), 'aucun doublon ni artiste d’amorce étiqueté découverte', r.tracks);
  check(env.calls.models.filter((x) => x.role === 'analysis').length === 2 && env.calls.models.length === 2, 'chaque modèle limité n’est pas rappelé pour chaque catégorie', env.calls);
  await env.ctx.close();

  env = await open('partial'); r = await run(env.page);
  check(r.tracks.length === 10 && r.report.before.deepDive === 0 && r.report.added.anchor === 1 && r.report.added.fresh === 2, 'quota pendant les seules faces cachées compensé proportionnellement', r.report);
  check(r.method === 'gemini' && r.report.added.neighbour === 0 && r.tracks.some((t) => t.title === 'Fresh Song 5'), 'les découvertes Gemini déjà proposées servent de réserve', r);
  check(r.report.cause === 'quota' && r.report.warning.includes('0/3 faces cachées'), 'quota partiel expliqué même si la longueur est remplie', r.report);
  await env.ctx.close();

  env = await open('partial', { freshLimit: 4, noNeighbours: true }); r = await run(env.page, { seedCount: 8 });
  check(r.tracks.length === 10 && r.report.added.anchor === 3 && r.report.added.fresh === 0, 'si les découvertes manquent, les piliers restants comblent à leur tour', r.report);
  await env.ctx.close();

  env = await open('partial', { freshLimit: 3 }); r = await run(env.page, { seedCount: 1, minutes: 20, instruction: 'Privilégie le jazz doux.' });
  check(r.tracks.length === 6 && r.method === 'mixte' && r.report.added.neighbour === 2, 'sélection partielle Gemini complétée par voisinage, méthode mixte annoncée', r);
  check(r.report.warning.includes('pas été vérifiées par Gemini pour ta consigne'), 'les découvertes de secours ne prétendent pas respecter une consigne non vérifiée', r.report);
  await env.ctx.close();

  env = await open('mixed'); r = await run(env.page);
  check(r.report.warning.includes('429') && !r.report.warning.includes('tous les modèles'), 'un 429 mêlé à un refus de droit ne devient pas « tous les modèles à court de quota »', r.report);
  await env.ctx.close();

  env = await open('rate-recover'); r = await run(env.page);
  check(r.tracks.length === 10 && !r.report.warning && env.calls.models.filter((c) => c.role === 'analysis').length === 3,
    'limitation de débit temporaire : un seul réessai puis génération normale sans fausse alerte', { report: r.report, calls: env.calls.models });
  await env.ctx.close();

  env = await open('rate-exhaust'); r = await run(env.page);
  check(r.report.warning.includes('429') && r.report.warning.includes('tous les modèles') && env.calls.models.length === 4,
    'limitation de débit persistante : un seul réessai borné puis bilan honnête', { report: r.report, calls: env.calls.models });
  await env.ctx.close();

  env = await open('all-quota'); r = await run(env.page, { seedCount: 1, minutes: 20, blockTitle: 'Discovery 4', recentTitle: 'Discovery 5' });
  check(r.tracks.length === 6 && !r.tracks.some((t) => t.title === 'Discovery 4' || t.title === 'Discovery 5')
    && r.tracks.some((t) => t.title === 'Discovery 6'), 'les compléments respectent exclusions et historique récent avant de chercher plus loin', r.tracks);
  await env.ctx.close();

  env = await open('all-quota');
  let instructionError = '';
  try { await run(env.page, { instruction: 'Un blend jazz bien précis.' }); } catch (err) { instructionError = err.message; }
  check(instructionError.includes('429') && env.calls.piped.length === 0, 'si Gemini ne peut appliquer aucune consigne, l’échec quota est explicite sans secours trompeur');
  await env.ctx.close();

  env = await open('next-model'); r = await run(env.page, { seedCount: 1, ratio: { anchor: 50, deepDive: 25, fresh: 25 } });
  check(r.report.requested.anchor === 5 && r.report.requested.deepDive === 3 && r.report.requested.fresh === 2
    && r.report.planned.anchor === 1 && r.report.planned.deepDive === 3 && r.report.planned.fresh === 6,
    'le bilan conserve la répartition choisie et transfère les piliers indisponibles aux découvertes', r.report);
  check(r.tracks.length === 10 && r.report.created.anchor === 1 && r.report.created.deepDive === 3 && r.report.created.fresh === 6
    && r.report.warning.includes('1/5 piliers') && r.report.warning.includes('4 places de pilier') && !r.report.warning.includes('429'),
    'plafond initial des piliers expliqué, sans diagnostic quota si le modèle de secours a répondu', r.report);
  await env.ctx.close();

  env = await open('all-quota'); r = await run(env.page, { seedCount: 1, minutes: 20 });
  check(r.tracks.length === 6 && r.report.added.anchor === 0 && r.report.added.fresh === 2, 'sans autre pilier, toutes les places manquantes vont aux découvertes', r.report);
  check(r.report.created.anchor === 1 && r.report.created.fresh === 5 && r.report.created.deepDive === 0, 'comptes justes lorsque les piliers sont épuisés', r.report);
  await env.ctx.close();

  env = await open('all-quota', { noNeighbours: true }); r = await run(env.page, { seedCount: 1, minutes: 20 });
  check(r.tracks.length === 1 && r.report.warning.includes('Blend incomplet') && r.report.warning.includes('1/6'), 'aucune découverte ni aucun pilier restant : longueur réduite annoncée', r.report);
  check(r.report.cause === 'quota' && r.tracks.every((t) => t.category === 'anchor'), 'aucun faux morceau inventé pour atteindre la durée', r);
  await env.ctx.close();

  env = await open('all-quota', { noNeighbours: true, noSeeds: true }); r = await run(env.page, { seedCount: 1, minutes: 20 });
  check(r.tracks.length === 0 && r.report.warning.includes('429') && r.report.warning.includes('0/6'),
    'zéro titre admissible : le diagnostic conserve la limite Gemini et le total réel', r.report);
  await env.ctx.close();

  env = await open('youtube-errors', { noNeighbours: true }); r = await run(env.page, { seedCount: 1, minutes: 20 });
  check(env.calls.oembed.some((v) => v.startsWith('B')), 'les vidéos refusées par oEmbed ont été réellement simulées', env.calls);
  check(r.report.warning.includes('Blend incomplet') && !r.report.warning.includes('429') && r.report.cause !== 'quota', 'des erreurs YouTube 400/404 ne deviennent pas un faux diagnostic de quota Gemini', r.report);
  check(!r.tracks.some((t) => t.videoId.startsWith('B')), 'les vidéos refusées par oEmbed ne remplissent pas artificiellement le blend', r.tracks);
  await env.ctx.close();

  env = await open('next-model', { noNeighbours: true }); r = await run(env.page);
  check(r.tracks.length === 10 && r.method === 'gemini' && r.model === 'gemini-2.5-flash', 'un autre modèle disponible compose normalement après un 429', r);
  check(!r.report.warning && !r.report.cause, 'aucune alerte quota incomplète si la répartition finale est respectée', r.report);
  await env.ctx.close();

  env = await open('cross-key'); const a = await run(env.page, { key: 'key-A' }); const b = await run(env.page, { key: 'key-B' });
  check(a.report.cause === 'quota' && b.tracks.length === 10 && b.method === 'gemini' && !b.report.warning, 'changer de clé ne réutilise pas les refus quota de l’ancienne clé', { a: a.report, b: b.report, calls: env.calls.models });
  check(env.calls.models.some((c) => c.key === 'key-B'), 'les modèles sont réellement essayés pour la nouvelle clé', env.calls.models);
  await env.ctx.close();

  env = await open('all-quota', { oneDeep: true, noNeighbours: true });
  const small = await env.page.evaluate(async () => (await import('/src/services/search.ts')).artistTracks('Alpha'));
  check(small.length === 1 && small[0].title.includes('Hidden Song'), 'une recherche complémentaire vide ne supprime pas le seul titre déjà trouvé', small);
  const parallel = await env.page.evaluate(async () => { const { verifyVideo } = await import('/src/services/search.ts'); return Promise.all([verifyVideo('PENDING0001'), verifyVideo('PENDING0001'), verifyVideo('PENDING0001')]); });
  check(parallel.every((x) => x && x.ok === false) && env.calls.oembed.filter((x) => x === 'PENDING0001').length === 1, 'trois vérifications simultanées partagent un seul refus oEmbed', { parallel, calls: env.calls.oembed });
  const repartition = await env.page.evaluate(async () => { const c = await import('/src/services/curator.ts'); return {
    zero: c.splitCounts(10, { anchor: 0, deepDive: 0, fresh: 100 }, 5),
    requested: c.splitRequestedCounts(10, { anchor: 50, deepDive: 25, fresh: 25 }),
    capped: c.splitCounts(10, { anchor: 50, deepDive: 25, fresh: 25 }, 1),
    fallback: c.splitReplacement(3, { anchor: 30, fresh: 40 }),
    noWeights: c.splitReplacement(3, { anchor: 0, fresh: 0 }),
  }; });
  check(repartition.zero.anchor === 0 && repartition.zero.deepDive === 0 && repartition.zero.fresh === 10, 'parts à zéro respectées dans la demande initiale', repartition);
  check(repartition.requested.anchor === 5 && repartition.requested.deepDive === 3 && repartition.requested.fresh === 2
    && repartition.capped.anchor === 1 && repartition.capped.deepDive === 3 && repartition.capped.fresh === 6,
    'capacité des amorces prise en compte sans augmenter artificiellement les faces cachées', repartition);
  check(repartition.fallback.anchor === 1 && repartition.fallback.fresh === 2 && repartition.noWeights.fresh === 3, 'arrondi proportionnel et repli découvertes sans poids', repartition);
  await env.ctx.close();
  console.log(`\n${checks}/${checks} contrôles de génération réussis — services simulés.`);
} finally { await browser.close(); }
