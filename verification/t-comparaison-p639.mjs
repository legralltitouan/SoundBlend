/* Compare la requête OAuth émise par la version candidate avec celle du
   diagnostic P, à origine identique et avec la bibliothèque GIS réelle.
   La fenêtre d'autorisation est interceptée avant Google : aucun compte,
   consentement, jeton ou appel Drive/YouTube réel. Nécessite le serveur
   de sources et la page P séparée. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const upstream = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const origin = 'http://localhost:5273';
const pHtml = await readFile(process.env.SOUNDBLEND_P_HTML || '../Diagnostic-Google-SoundBlend-selection-compte/diagnostic.html', 'utf8');
const gis = process.env.SOUNDBLEND_GIS_SCRIPT_PATH
  ? await readFile(process.env.SOUNDBLEND_GIS_SCRIPT_PATH, 'utf8')
  : execFileSync('curl', ['-fsSL', '--max-time', '25', 'https://accounts.google.com/gsi/client'], { encoding: 'utf8', maxBuffer: 1000000 });
assert.ok(gis.includes('initTokenClient'), 'bibliothèque GIS publique disponible');
const expectedClient = '449975100236-jv09mmj5b3gp7tj93dec3liu736rnmgu.apps.googleusercontent.com';
const expectedScopes = ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/userinfo.profile'];
const keys = ['client_id', 'scope', 'origin', 'prompt', 'response_type', 'response_mode', 'redirect_uri', 'display', 'include_granted_scopes'];
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
let n = 0;
function check(ok, label) { assert.ok(ok, label); n++; console.log('  ✓ ' + label); }
async function parameters(kind) {
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await c.addInitScript(() => localStorage.setItem('soundblend_onboarded', '1'));
  // Par défaut, aucune sortie réseau ; seules les routes contrôlées suivent.
  await c.route('**/*', r => r.abort());
  await c.route(origin + '/**', async r => {
    const u = new URL(r.request().url());
    if (kind === 'P') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pHtml });
    const source = new URL(u.pathname + u.search, upstream);
    return r.fulfill({ response: await r.fetch({ url: source.href }) });
  });
  await c.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: gis }));
  let params = null;
  await c.route('https://accounts.google.com/o/oauth2/v2/auth**', r => {
    const u = new URL(r.request().url());
    params = Object.fromEntries(keys.map(key => [key, u.searchParams.get(key)]));
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Fenêtre OAuth fictive</title>' });
  });
  const page = await c.newPage();
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    if (kind === 'P') await page.waitForFunction(() => document.querySelector('#code')?.textContent === 'Prêt');
    else { await page.waitForSelector('.ytm-shell'); await page.waitForFunction(() => !!window.google?.accounts?.oauth2?.initTokenClient); }
    const popupWait = page.waitForEvent('popup', { timeout: 10000 });
    await page.locator(kind === 'P' ? '#start' : '.sb-link-login').click();
    const popup = await popupWait;
    await popup.waitForURL('https://accounts.google.com/o/oauth2/v2/auth**', { timeout: 10000 });
    await popup.waitForLoadState('domcontentloaded');
    check(!!params, `${kind} : GIS émet une demande OAuth interceptée`);
    check(params.client_id === expectedClient, `${kind} : même client public`);
    check(params.scope === expectedScopes.join(' '), `${kind} : mêmes trois autorisations et ordre`);
    check(params.origin === origin, `${kind} : origine de comparaison commune`);
    check(params.prompt === 'select_account', `${kind} : choix du compte demandé`);
    check(!await page.evaluate(() => !!sessionStorage.getItem('soundblend_google_session_v2')), `${kind} : aucune session utilisateur créée`);
    return params;
  } finally { await c.close(); }
}
try {
  const p = await parameters('P');
  const app = await parameters('SoundBlend');
  check(JSON.stringify(p) === JSON.stringify(app), 'P et SoundBlend : neuf champs OAuth contrôlés identiques à origine commune');
  console.log(`\n${n}/${n} comparaisons réussies — GIS réel ; autorisation interceptée, sans compte ni données réelles.`);
} finally { await browser.close(); }
