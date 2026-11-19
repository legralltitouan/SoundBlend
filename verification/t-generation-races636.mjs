/* Générations simultanées et changements de compte dans le vrai DataProvider.
   Le moteur et tous les services externes sont simulés. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route('**/*', (r) => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let checks = 0; const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`  ✓ ${label}`); };
const wait = (expr) => page.waitForFunction(expr, null, { timeout: 10000 });
try {
  await page.goto(new URL('verification/generation-races636.html', base).href);
  await wait(() => typeof window.__generationData === 'function' && document.getElementById('ready').textContent === 'prêt');
  await page.evaluate(async () => {
    localStorage.clear();
    const scope = await import('/src/services/accountScope.ts');
    const { geminiService } = await import('/src/services/gemini.ts');
    window.__scope = scope;
    window.__arrived = []; window.__release = {};
    const gates = Object.fromEntries(['A', 'B'].map((id) => [id, new Promise((resolve) => { window.__release[id] = resolve; })]));
    geminiService.generateBlend = async (seeds) => {
      const name = seeds[0].artist;
      window.__arrived.push(name);
      await gates[name];
      // Simuler une réponse tardive qui écrirait les métadonnées du singleton :
      // le contexte doit vérifier la révision avant de s'en servir.
      const track = { ...seeds[0], category: 'anchor' };
      geminiService.derniereMethode = 'gemini'; geminiService.dernierModele = `modele-${name}`; geminiService.derniereNote = `Sélection ${name}`;
      geminiService.dernierRapport = { target: 1, requested: { anchor: 1, deepDive: 0, fresh: 0 }, before: { anchor: 1, deepDive: 0, fresh: 0 }, created: { anchor: 1, deepDive: 0, fresh: 0 }, added: { anchor: 0, fresh: 0, neighbour: 0 }, warning: `bilan-${name}` };
      return [track];
    };
    window.__start = (name) => {
      const t = { id: `seed-${name}`, title: `Titre ${name}`, artist: name, videoId: name.repeat(11), thumbnailUrl: '', durationSeconds: 210 };
      const result = { done: false };
      void window.__generationData().generate({ durationMinutes: 20, ratio: { anchor: 30, deepDive: 30, fresh: 40 } }, { seeds: [t] })
        .then((blend) => { result.done = true; result.blend = blend; }, (e) => { result.done = true; result.error = e.message; });
      return result;
    };
  });
  await page.evaluate(() => { window.__scope.selectAccountScope('A'); window.__first = window.__start('A'); window.__duplicate = window.__start('A'); });
  await wait(() => window.__arrived.includes('A') && window.__duplicate.done && window.__generationData().generating);
  let state = await page.evaluate(() => ({ arrived: window.__arrived, duplicate: window.__duplicate }));
  check(state.arrived.length === 1 && state.duplicate.error.includes('déjà en cours'), 'deux demandes simultanées du même compte ne lancent qu’une génération');

  await page.evaluate(() => window.__scope.selectAccountScope('B'));
  await wait(() => !window.__generationData().generating);
  await page.evaluate(() => { window.__second = window.__start('B'); });
  await wait(() => window.__arrived.includes('B') && window.__generationData().generating);
  check(await page.evaluate(() => window.__arrived.join('') === 'AB'), 'le nouveau compte peut lancer sa propre génération');

  await page.evaluate(() => window.__release.A());
  await wait(() => window.__first.done);
  state = await page.evaluate(() => ({ first: window.__first, generating: window.__generationData().generating, current: window.__generationData().currentBlend }));
  check(state.first.error.includes('compte a changé') && state.current === null, 'la réponse tardive du compte A n’est pas enregistrée pour B');
  check(state.generating, 'la fin tardive de A ne masque pas la génération encore active de B');
  await page.evaluate(() => { window.__duplicateB = window.__start('B'); });
  await wait(() => window.__duplicateB.done);
  check(await page.evaluate(() => window.__duplicateB.error.includes('déjà en cours') && window.__arrived.length === 2), 'le verrou de génération reste actif pour B après la fin de A');

  await page.evaluate(() => window.__release.B());
  await wait(() => window.__second.done && !window.__generationData().generating);
  state = await page.evaluate(() => ({ second: window.__second, current: window.__generationData().currentBlend,
    a: JSON.parse(localStorage.getItem('soundblend_account_v1:A:soundblend_recent_blends') || '[]'),
    b: JSON.parse(localStorage.getItem('soundblend_account_v1:B:soundblend_recent_blends') || '[]') }));
  check(state.second.blend?.methode.model === 'modele-B' && state.second.blend?.generation.warning === 'bilan-B', 'le résultat B conserve ses propres métadonnées et son bilan');
  check(state.a.length === 0 && state.b.length === 1 && state.b[0].seedTracks[0].artist === 'B', 'aucun blend A n’est écrit et le blend B reste dans son espace');
  check(errors.length === 0, `aucune exception JavaScript (${errors.join('; ')})`);
  console.log(`\n${checks}/${checks} contrôles des générations concurrentes réussis — moteur simulé.`);
} finally { await ctx.close(); await browser.close(); }
