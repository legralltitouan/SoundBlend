/* Mise en page du diagnostic de connexion, petit écran. OAuth simulé. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
let n = 0;
const check = (ok, label) => { assert.ok(ok, label); n++; console.log('  ✓ ' + label); };
try {
  for (const width of [320, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 700 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      localStorage.setItem('soundblend_onboarded', '1');
      const timer = window.setTimeout;
      window.setTimeout = function (fn, ms, ...args) { return timer(fn, ms === 12500 ? 200 : ms, ...args); };
    });
    await context.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
    await context.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: `window.google={accounts:{oauth2:{initTokenClient(){return{requestAccessToken(){}}},revoke(){}}}};` }));
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base); await page.waitForSelector('.sb-link-login'); await page.locator('.sb-link-login').click();
      await page.getByText('Code : attente_sans_message_google', { exact: true }).waitFor();
      const fits = await page.evaluate(() => {
        const s = document.querySelector('.sb-google-status').getBoundingClientRect();
        const b = document.querySelector('[aria-label="Annuler la connexion Google"]').getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth + 1 && s.left >= -1 && s.right <= innerWidth + 1 && b.left >= -1 && b.right <= innerWidth + 1;
      });
      check(fits && errors.length === 0, `${width}px : diagnostic et annulation visibles sans débordement`);
      await page.getByRole('button', { name: 'Annuler la connexion Google' }).click();
      check(await page.locator('.sb-link-login').isEnabled(), `${width}px : annulation utilisable`);
    } finally { await context.close(); }
  }
  console.log(`\n${n}/${n} contrôles de connexion sur petit écran réussis — OAuth simulé.`);
} finally { await browser.close(); }
