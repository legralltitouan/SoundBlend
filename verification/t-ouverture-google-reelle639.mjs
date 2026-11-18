/* Ouvre la vraie fenêtre Google sans compte, consentement ni jeton.
   Le navigateur reçoit un site local compilé à la place du site public :
   aucun déploiement ni modification du site distant. Compiler pour /SoundBlend/
   puis indiquer son dossier par SOUNDBLEND_CURRENT_SITE_DIR si nécessaire. */
import { chromium } from 'playwright';
import { resolve, sep } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = 'https://legralltitouan.github.io/SoundBlend/';
const root = resolve(process.env.SOUNDBLEND_CURRENT_SITE_DIR || 'dist');
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => { if (location.hostname === 'legralltitouan.github.io') localStorage.setItem('soundblend_onboarded', '1'); });
await context.route('**/*', route => {
  const url = route.request().url();
  if (url.startsWith('https://accounts.google.com/') || /^https:\/\/[^/]*\.gstatic\.com\//.test(url)) return route.continue();
  return route.abort();
});
await context.route('https://legralltitouan.github.io/SoundBlend/**', route => {
  const url = new URL(route.request().url()), relative = url.pathname.slice('/SoundBlend/'.length) || 'index.html', file = resolve(root, relative);
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, path: file });
});
const p = await context.newPage(), errors = [];
p.on('pageerror', e => errors.push(e.message));
let parameters = null;
context.on('request', r => {
  try {
    const u = new URL(r.url());
    if (u.hostname === 'accounts.google.com' && u.pathname === '/o/oauth2/v2/auth') {
      parameters = { prompt: u.searchParams.get('prompt'), client: u.searchParams.get('client_id'), origin: u.searchParams.get('origin'), scope: u.searchParams.get('scope') };
    }
  } catch { /* aucune donnée sensible n'est lue ou enregistrée */ }
});
let n = 0;
function check(ok, label) { assert.ok(ok, label); n++; console.log('  ✓ ' + label); }
try {
  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.ytm-shell');
  await p.waitForFunction(() => !!window.google?.accounts?.oauth2?.initTokenClient, null, { timeout: 30000 });
  await p.evaluate(() => {
    const oauth = window.google.accounts.oauth2, original = oauth.initTokenClient;
    oauth.initTokenClient = function (config) { window.__modeSansErrorCallback = !Object.hasOwn(config, 'error_callback'); return original.call(this, config); };
  });
  const popupPromise = p.waitForEvent('popup', { timeout: 15000 }); await p.locator('.sb-link-login').click(); const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500);
  check(!popup.isClosed() && popup.url().startsWith('https://accounts.google.com/'), 'vraie fenêtre Google ouverte sans saisie de compte');
  check(parameters?.prompt === 'select_account', 'la vraie demande initiale demande la sélection du compte');
  check(parameters?.client === '449975100236-jv09mmj5b3gp7tj93dec3liu736rnmgu.apps.googleusercontent.com' && parameters?.origin === 'https://legralltitouan.github.io', 'client public et origine du site public conservés dans la demande initiale');
  check(['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/userinfo.profile'].every(s => (parameters?.scope || '').split(' ').includes(s)), 'les trois autorisations figurent dans la demande initiale');
  check(await p.evaluate(() => window.__modeSansErrorCallback) && (await p.locator('.sb-google-status').innerText()).includes('Termine la connexion'), 'absence de error_callback et attente visibles sur le build local');
  await popup.close(); await p.locator('.sb-google-status').getByText(/^Code : attente_(sans_)?message_google$/).waitFor({ timeout: 18000 });
  check(await p.getByRole('button', { name: 'Annuler la connexion Google' }).isVisible() && errors.length === 0 && !(await p.evaluate(() => !!sessionStorage.getItem('soundblend_google_session_v2'))),
    'fermeture volontaire sans réponse : aide visible, aucune connexion ni exception');
  await p.getByRole('button', { name: 'Annuler la connexion Google' }).click(); await p.locator('.sb-google-status').getByText('Code : cancelled', { exact: true }).waitFor();
  check(await p.locator('.sb-link-login').isEnabled() && errors.length === 0, 'annulation : bouton libéré immédiatement');
  console.log(`\n${n}/${n} contrôles d’ouverture réelle réussis. Aucun compte, consentement ni jeton réel ; site distant inchangé.`);
} finally { await context.close(); await browser.close(); }
