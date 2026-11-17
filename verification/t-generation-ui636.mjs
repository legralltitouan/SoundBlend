/* Parcours utilisateur : génération, bilan conservé et synchronisation sans bouton. Services simulés. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
// Ce mode injecte une exclusion tout juste après la sélection, pour tester
// le dernier verrou et son bilan sans affaiblir les garde-fous en production.
const finalFilter = process.env.SOUNDBLEND_FINAL_FILTER === '1';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 }, serviceWorkers: 'block' });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,OPTIONS', 'access-control-allow-headers': '*' };
const id = (prefix, n) => `${prefix}${String(n).padStart(10, '0')}`;
const item = (vid, title, artist) => ({ url: `/watch?v=${vid}`, title, uploaderName: artist, type: 'stream', duration: 210 });
const now = Date.now();
const remote = { data: { schema: 2, modifie: new Date().toISOString(), appareil: 'serveur', apparence: { mode: 'dark', at: 0 }, reglages: { geminiApiKey: 'test-key', at: now }, exclusions: [], decouvertes: [], suppressionsBlends: {}, portrait: null, blends: [] } };
const driveRoute = (r) => {
  const req = r.request(), u = new URL(req.url()); if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
  if (u.pathname.includes('/upload/') && req.method() === 'PATCH') { remote.data = JSON.parse(req.postData()); return r.fulfill({ status: 200, headers: cors, body: '{"id":"f1"}' }); }
  if (u.searchParams.get('alt') === 'media') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(remote.data) });
  return r.fulfill({ status: 200, headers: cors, body: '{"files":[{"id":"f1","name":"soundblend.json"}]}' });
};
await ctx.addInitScript(({ now }) => {
  localStorage.setItem('soundblend_onboarded', '1');
  if (!sessionStorage.getItem('soundblend_google_session_v2')) sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'FAUX', owner: 'ui-gen', expiresAt: Date.now() + 3600000, profile: { name: 'Test', email: '', avatarUrl: '' } }));
  if (!localStorage.getItem('soundblend_account_v1:ui-gen:soundblend_settings')) localStorage.setItem('soundblend_account_v1:ui-gen:soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: 'test-key', _updatedAt: now }));
}, { now });
await ctx.route('**/*', (r) => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, driveRoute);
await ctx.route('https://www.googleapis.com/youtube/v3/**', (r) => {
  const u = r.request().url();
  if (u.includes('/playlists?')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'PL1', snippet: { title: 'Sélection Alpha', description: '', thumbnails: {} }, contentDetails: { itemCount: 5 } }] }) });
  if (u.includes('/playlistItems?')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: Array.from({ length: 5 }, (_, i) => ({ id: `it-${i}`, snippet: { title: `Seed ${i + 1}`, videoOwnerChannelTitle: 'Alpha - Topic', thumbnails: {} }, contentDetails: { videoId: id('P', i + 1) } })) }) });
  return r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' });
});
await ctx.route('https://generativelanguage.googleapis.com/**', (r) => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
  if (new URL(r.request().url()).pathname.endsWith('/models')) return r.fulfill({ status: 200, headers: cors, body: '{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"],"outputTokenLimit":8192}]}' });
  return r.fulfill({ status: 429, headers: cors, body: '{"error":{"message":"quota per day"}}' });
});
await ctx.route(/pipedapi\.|api\.piped\./, (r) => {
  const q = (new URL(r.request().url()).searchParams.get('q') || '').toLowerCase(); let items = [];
  if (q === 'alpha mix') items = [item(id('N', 1), 'Neighbor - Discovery 1', 'Neighbor')];
  else if (q === 'neighbor' || q === 'neighbor topic') items = Array.from({ length: 12 }, (_, i) => item(id('N', i + 1), `Neighbor - Discovery ${i + 1}`, 'Neighbor'));
  return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items }) });
});
await ctx.route('https://www.youtube.com/oembed**', (r) => {
  const vid = new URL(new URL(r.request().url()).searchParams.get('url')).searchParams.get('v'), n = Number(vid.slice(1));
  const meta = vid.startsWith('N') ? { title: `Neighbor - Discovery ${n}`, author_name: 'Neighbor - Topic' } : { title: `Seed ${n}`, author_name: 'Alpha - Topic' };
  return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(meta) });
});
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let n = 0; const check = (ok, label) => { assert.ok(ok, label); n++; console.log(`  ✓ ${label}`); };
try {
  await page.goto(base); await page.waitForSelector('.ytm-shell');
  await page.locator('.ytm-rail [aria-label="Nouveau blend"]').click();
  await page.getByRole('dialog', { name: 'Choisir des morceaux' }).waitFor();
  await page.locator('.pick-row').first().waitFor({ timeout: 12000 });
  await page.locator('.pick-row').filter({ hasText: 'Seed 1' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('dialog', { name: 'Réglages du blend' }).waitFor();
  await page.getByRole('button', { name: '20 min', exact: true }).click();
  await page.getByRole('button', { name: 'Confort', exact: true }).click();
  check((await page.locator('.sb-dose-seg[data-key="anchor"] .sb-dose-num').innerText()) === '1'
    && (await page.locator('.sb-dose-seg[data-key="deepDive"] .sb-dose-num').innerText()) === '2'
    && (await page.locator('.sb-dose-seg[data-key="fresh"] .sb-dose-num').innerText()) === '3', 'avec une seule amorce, seuls les piliers sont plafonnés et leurs places vont aux découvertes');
  check(await page.getByText(/répartition choisie prévoit 3 piliers.*1 amorce/i).isVisible(), 'le plafonnement et le report sont expliqués avant le lancement');
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await page.locator('.ytm-rail [aria-label="Nouveau blend"]').click();
  await page.getByRole('dialog', { name: 'Choisir des morceaux' }).waitFor();
  for (let i = 2; i <= 5; i++) await page.locator('.pick-row').filter({ hasText: `Seed ${i}` }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('dialog', { name: 'Réglages du blend' }).waitFor();
  await page.getByRole('button', { name: '20 min', exact: true }).click();
  await page.getByRole('button', { name: 'Équilibré', exact: true }).click();
  check((await page.locator('.sb-dose-seg[data-key="anchor"] .sb-dose-num').innerText()) === '2'
    && (await page.locator('.sb-dose-seg[data-key="deepDive"] .sb-dose-num').innerText()) === '2'
    && (await page.locator('.sb-dose-seg[data-key="fresh"] .sb-dose-num').innerText()) === '2', 'la répartition affichée correspond aux nombres réellement demandés');
  if (finalFilter) await page.evaluate(async () => {
    const { geminiService } = await import('/src/services/gemini.ts');
    const { block } = await import('/src/services/storage.ts');
    const original = geminiService.generateBlend.bind(geminiService);
    geminiService.generateBlend = async (...args) => {
      const tracks = await original(...args);
      const fresh = tracks.find((t) => t.category === 'fresh');
      if (!fresh) throw new Error('Précondition : une découverte doit être sélectionnée.');
      block({ title: fresh.title, artist: fresh.artist, videoId: fresh.videoId }, 'track');
      return tracks;
    };
  });
  await page.getByRole('button', { name: 'Générer', exact: true }).click();
  await page.locator('.sb-blend-warning').waitFor({ timeout: 30000 });
  let warning = await page.locator('.sb-blend-warning').innerText();
  check(warning.includes('429') && warning.includes('0/2 faces cachées') && warning.includes('6/6'), 'le bilan visible explique la limite, les faces manquantes et le total');
  check(warning.includes('1 pilier') && warning.includes('1 découverte'), 'le complément proportionnel est explicitement affiché');
  const expectedCount = finalFilter ? 5 : 6, expectedFresh = finalFilter ? 2 : 3;
  check((await page.locator('.sb-blend-counts').innerText()).includes('3 piliers') && (await page.locator('.sb-blend-counts').innerText()).includes(`${expectedFresh} découvertes`), 'les compteurs affichent les catégories réellement créées');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundblend_account_v1:ui-gen:soundblend_recent_blends') || '[]')[0]);
  check(saved?.generation?.warning.includes('429') && saved.generation.created.anchor === 3 && saved.generation.created.fresh === expectedFresh, 'le bilan est enregistré avec les comptes réellement créés');
  check(saved.tracks.length === expectedCount && new Set(saved.tracks.map((x) => x.videoId)).size === expectedCount, 'le résultat enregistré ne contient aucun doublon');
  if (finalFilter) {
    check(warning.includes('Avant le contrôle final') && warning.includes('Contrôle final : 5/6 titres enregistrés') && warning.includes('1 titre a été écarté'), 'le bilan distingue les comptes avant et après le dernier filtrage');
    check(saved.generation.created.anchor + saved.generation.created.deepDive + saved.generation.created.fresh === saved.tracks.length, 'les comptes persistés restent exacts après exclusion tardive');
  }
  const until = Date.now() + 15000;
  while (!remote.data.blends.some((b) => b.id === saved.id && b.generation?.warning === saved.generation.warning) && Date.now() < until)
    await page.waitForTimeout(100);
  check(remote.data.blends.some((b) => b.id === saved.id && b.generation?.created.fresh === expectedFresh), 'le blend et son bilan sont envoyés automatiquement à Drive simulé');
  // Deuxième profil isolé, même compte, aucun stockage prérempli : il doit
  // charger le blend et afficher le bilan sans clic de synchronisation.
  const other = await browser.newContext({ viewport: { width: 1200, height: 820 }, serviceWorkers: 'block' });
  try {
    await other.addInitScript(() => {
      localStorage.setItem('soundblend_onboarded', '1');
      sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'FAUX', owner: 'ui-gen', expiresAt: Date.now() + 3600000, profile: { name: 'Test', email: '', avatarUrl: '' } }));
    });
    await other.route('**/*', (r) => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
    await other.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await other.route('https://www.googleapis.com/youtube/v3/**', (r) => r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' }));
    await other.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, driveRoute);
    const otherPage = await other.newPage();
    otherPage.on('pageerror', (e) => errors.push(e.message));
    await otherPage.goto(base); await otherPage.waitForSelector('.ytm-shell');
    await otherPage.waitForFunction(({ id }) => JSON.parse(localStorage.getItem('soundblend_account_v1:ui-gen:soundblend_recent_blends') || '[]').some((b) => b.id === id && b.generation?.warning), { id: saved.id }, { timeout: 15000 });
    await otherPage.locator('.ytm-rail [aria-label="Blends"]').click();
    await otherPage.getByRole('button', { name: `Ouvrir ${saved.title}`, exact: true }).click();
    const otherWarning = await otherPage.locator('.sb-blend-warning').innerText();
    check(otherWarning === warning, 'un second appareil fictif charge automatiquement et affiche le même bilan');
  } finally { await other.close(); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.sb-blend-warning').scrollIntoViewIfNeeded();
  const width = await page.locator('.sb-blend-warning').evaluate((el) => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }));
  check(width.width <= 390 && width.scroll <= width.client + 1, 'avertissement lisible sans débordement sur mobile');
  await page.reload(); await page.waitForSelector('.ytm-shell');
  await page.locator('.ytm-mobile-bar [aria-label="Blends"]').click();
  await page.getByRole('button', { name: `Ouvrir ${saved.title}`, exact: true }).click();
  await page.locator('.sb-blend-warning').waitFor();
  warning = await page.locator('.sb-blend-warning').innerText();
  check(warning.includes('429') && warning.includes('0/2 faces cachées'), 'l’avertissement reste visible après fermeture et réouverture du blend');
  await page.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  check(await page.getByRole('button', { name: 'Synchroniser maintenant' }).count() === 0, 'le bouton manuel n’apparaît plus dans le parcours réel');
  check(errors.length === 0, `aucune exception JavaScript (${errors.join('; ')})`);
  console.log(`\n${n}/${n} contrôles du parcours graphique de génération réussis — services simulés.`);
} finally { await ctx.close(); await browser.close(); }
