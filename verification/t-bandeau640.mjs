/* Parcours réel de remplacement et bandeau : bureau/mobile, clair/sombre,
   glissement, clic, clavier et changement de thème. Les réponses Gemini et
   YouTube sont fictives ; aucun service ni compte réel n'est utilisé.
   SOUNDBLEND_EXPECT_639_BUG=1 vérifie la régression sur la version précédente. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const oldBug = process.env.SOUNDBLEND_EXPECT_639_BUG === '1';
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`  ✓ ${label}`); };
const readColor = async (page) => page.locator('.sb-task[data-state]').evaluate((el) => {
  const css = getComputedStyle(el).backgroundColor;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  return { css, rgba: [...ctx.getImageData(0, 0, 1, 1).data] };
});
const isDark = ({ rgba }) => rgba[0] < 60 && rgba[1] < 60 && rgba[2] < 60 && rgba[3] > 200;
const isLight = ({ rgba }) => rgba[0] > 230 && rgba[1] > 230 && rgba[2] > 230 && rgba[3] > 200;

async function exercise({ name, width, height, mobile }) {
  console.log(`\n${name} (${width} × ${height})`);
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', colorScheme: 'dark' });
  const errors = [];
  let finish, seenPost;
  const gate = new Promise((resolve) => { finish = resolve; });
  const post = new Promise((resolve) => { seenPost = resolve; });
  let posts = 0, mockSearches = 0;
  const seed = {
    id: 'seed-640', title: 'Piste originale', artist: 'Artiste initial', videoId: 'ORIGINAL001',
    thumbnailUrl: '', durationSeconds: 210, category: 'fresh',
  };
  const blend = {
    id: 'blend-640', title: 'Blend de test', description: 'Données fictives',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    seedTracks: [seed], tracks: [seed],
  };
  try {
    await ctx.addInitScript(({ blend }) => {
      localStorage.setItem('soundblend_onboarded', '1');
      localStorage.setItem('soundblend_mode_v2', JSON.stringify({ mode: 'dark', at: Date.now() }));
      localStorage.setItem('soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: 'CLE-YOUTUBE-FICTIVE', geminiApiKey: 'CLE-GEMINI-FICTIVE' }));
      localStorage.setItem('soundblend_recent_blends', JSON.stringify([blend]));
    }, { blend });
    // La règle générale bloque toutes les autres origines ; les routes
    // suivantes, plus spécifiques, simulent les seules réponses nécessaires.
    await ctx.route('**/*', (r) => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
    await ctx.route('https://generativelanguage.googleapis.com/**', async (r) => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 }] }) });
      posts++; seenPost();
      await gate;
      const payload = { analyse: 'Une proposition fictive adaptée au contexte de ce test.', suggestions: [{ title: 'Nouvelle piste', artist: 'Artiste neuf', rationale: 'Remplacement fictif' }] };
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) }).catch(() => {});
    });
    await ctx.route('https://www.googleapis.com/youtube/v3/search**', (r) => {
      mockSearches++;
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: { videoId: 'NEWVIDEO001' }, snippet: { title: 'Nouvelle piste', channelTitle: 'Artiste neuf - Topic', thumbnails: {} } }] }) });
    });
    await ctx.route('https://www.youtube.com/oembed**', (r) => r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ title: 'Nouvelle piste', author_name: 'Artiste neuf - Topic' }) }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('.ytm-shell');
    const navigation = mobile ? '.ytm-mobile-bar' : '.ytm-rail';
    await page.locator(`${navigation} [aria-label="Blends"]`).click();
    await page.getByRole('button', { name: 'Ouvrir Blend de test', exact: true }).click();
    await page.getByRole('button', { name: 'Remplacer', exact: true }).click();
    await Promise.race([post, new Promise((_, reject) => setTimeout(() => reject(new Error('Le moteur fictif ne reçoit pas la demande.')), 10000))]);
    const ticker = page.locator('.sb-task[data-state]');
    await ticker.waitFor();
    await page.waitForFunction(() => document.querySelector('.sb-task[data-state]')?.getAttribute('data-state') === 'open');
    await page.evaluate(() => { window.__ticker640 = document.querySelector('.sb-task[data-state]'); });
    check((await ticker.innerText()).includes('Piste originale') && posts === 1, 'le vrai remplacement ouvre le suivi du bon morceau');
    const darkOpen = await readColor(page);
    check(isDark(darkOpen), `fond sombre lorsque le suivi est ouvert (${darkOpen.css})`);

    await page.waitForFunction(() => document.querySelector('.sb-task[data-state]')?.getAttribute('data-state') === 'peek', null, { timeout: 6500 });
    await page.waitForTimeout(800); // fin du ressort pour mesurer la tranche réellement accessible
    const darkPeek = await readColor(page);
    check(oldBug ? isLight(darkPeek) : isDark(darkPeek), oldBug
      ? `ancienne régression reproduite : tranche blanche en mode sombre (${darkPeek.css})`
      : `la tranche rangée reste sombre (${darkPeek.css})`);
    const bounds = await ticker.boundingBox();
    check(bounds && Math.abs(bounds.x - (width - 18)) < 3 && bounds.width > 300, 'le même bandeau glisse à droite et laisse environ 18 px visibles');
    check(await page.evaluate(() => window.__ticker640 === document.querySelector('.sb-task[data-state]')), 'le bandeau rangé est le même élément que le bandeau ouvert');

    // La navigation conserve le remplacement en cours. Sur les deux formats,
    // le changement de thème passe par le vrai réglage de l'application.
    await page.locator(`${navigation} [aria-label="Réglages du compte"]`).click();
    const theme = page.getByRole('button', { name: 'Changer de thème clair/sombre' });
    await theme.click();
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'light');
    check(await ticker.getAttribute('data-state') === 'peek', 'le suivi reste rangé pendant la navigation et le changement de thème');
    const lightPeek = await readColor(page);
    check(isLight(lightPeek), `tranche claire après changement de thème (${lightPeek.css})`);
    const clickable = await ticker.boundingBox();
    const x = Math.min(width - 5, Math.max(0, clickable.x + 9));
    const y = Math.max(2, Math.min(height - 2, clickable.y + Math.min(30, clickable.height / 2)));
    check(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.sb-task') === window.__ticker640, { x, y }), 'la tranche visible peut recevoir un vrai clic');
    await page.mouse.click(x, y);
    await page.waitForFunction(() => document.querySelector('.sb-task[data-state]')?.getAttribute('data-state') === 'open');
    const lightOpen = await readColor(page);
    check(isLight(lightOpen), `un clic rouvre le suivi dans le thème clair (${lightOpen.css})`);
    check(await page.evaluate(() => window.__ticker640 === document.querySelector('.sb-task[data-state]')), 'la réouverture conserve le même élément');

    await theme.click();
    await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark');
    const darkAgain = await readColor(page);
    check(await ticker.getAttribute('data-state') === 'open' && isDark(darkAgain), 'le changement vers sombre fonctionne aussi pendant que le bandeau est ouvert');
    await page.waitForFunction(() => document.querySelector('.sb-task[data-state]')?.getAttribute('data-state') === 'peek', null, { timeout: 7000 });
    await page.waitForTimeout(800);
    const darkAgainPeek = await readColor(page);
    check(oldBug ? isLight(darkAgainPeek) : isDark(darkAgainPeek), oldBug
      ? 'l’ancienne régression réapparaît après réouverture'
      : 'le bandeau se range à nouveau sans devenir blanc');
    check(await ticker.getAttribute('aria-label') === 'Sortir le suivi du remplacement' && await ticker.getAttribute('tabindex') === '0', 'la tranche est accessible au clavier');
    await ticker.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.sb-task[data-state]')?.getAttribute('data-state') === 'open');
    check(await ticker.getAttribute('data-state') === 'open', 'Entrée rouvre le bandeau');

    // Libérer la réponse réseau factice et revenir au blend pour vérifier
    // que la file réelle applique bien la proposition après navigation.
    finish();
    await page.waitForTimeout(500);
    await page.locator(`${navigation} [aria-label="Blends"]`).click();
    await page.getByRole('button', { name: 'Ouvrir Blend de test', exact: true }).click();
    await page.getByText('Nouvelle piste', { exact: true }).first().waitFor({ timeout: 10000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundblend_recent_blends') || '[]')[0]);
    check(mockSearches > 0 && saved?.tracks?.[0]?.title === 'Nouvelle piste', 'la proposition fictive est appliquée et enregistrée après retour au blend');
    check(errors.length === 0, `aucune exception JavaScript (${errors.join('; ') || 'aucune'})`);
  } finally {
    finish();
    await ctx.close();
  }
}
try {
  for (const view of [{ name: 'Ordinateur', width: 1280, height: 800, mobile: false }, { name: 'Mobile', width: 390, height: 844, mobile: true }]) await exercise(view);
  console.log(`\n${checks}/${checks} contrôles du bandeau réussis — Chromium, moteur et données fictifs${oldBug ? ', référence 6.9.39' : ''}.`);
} finally { await browser.close(); }
