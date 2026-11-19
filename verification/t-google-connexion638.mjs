/* Connexion 6.9.38 : interface réelle, OAuth/identités/Drive/YouTube fictifs.
   Compatible sources et sites compilés. Aucun compte ni jeton réel. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS', 'access-control-allow-headers': '*' };
const stub = `window.__configs=[];window.__requests=[];
window.google={accounts:{oauth2:{
 initTokenClient:c=>{const i=window.__configs.push(c)-1;return {requestAccessToken:o=>window.__requests.push({i,activation:!!navigator.userActivation?.isActive,prompt:o?.prompt})}},
 revoke:(_token,cb)=>cb&&cb()
}}};`;
let n = 0;
function check(condition, label) { assert.ok(condition, label); n++; console.log('  ✓ ' + label); }
const pause = ms => new Promise(r => setTimeout(r, ms));
async function newEnv({ onboarded = true, shortTimers = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [], profileCalls = [];
  let hold = false, gate = Promise.resolve(), release = () => {}, profileMode = 'ok';
  await ctx.addInitScript(({ onboarded, shortTimers }) => {
    if (onboarded) localStorage.setItem('soundblend_onboarded', '1');
    if (shortTimers) {
      const original = window.setTimeout;
      window.setTimeout = function (fn, ms, ...args) {
        return original(fn, ms === 12500 ? 150 : ms === 180000 ? 900 : ms, ...args);
      };
    }
  }, { onboarded, shortTimers });
  await ctx.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
  await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: stub }));
  await ctx.route('https://www.googleapis.com/oauth2/**', async r => {
    const auth = r.request().headers().authorization || '';
    const who = auth.endsWith('-A') ? 'A' : auth.endsWith('-B') ? 'B' : '?';
    profileCalls.push(who);
    if (hold) await gate;
    if (profileMode === 'http') return r.fulfill({ status: 403, headers, body: '{}' }).catch(() => {});
    if (profileMode === 'no-id') return r.fulfill({ status: 200, headers, body: '{"name":"Compte fictif"}' }).catch(() => {});
    return r.fulfill({ status: 200, headers, body: JSON.stringify({ id: 'google-' + who, name: 'Compte ' + who }) }).catch(() => {});
  });
  await ctx.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
  await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => r.fulfill({ status: 503, headers, body: '{}' }));
  const p = await ctx.newPage(); p.on('pageerror', error => errors.push(error.message));
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.google?.accounts?.oauth2);
  await p.waitForSelector(onboarded ? '.ytm-shell' : '.welcome');
  const session = () => p.evaluate(() => { const x = JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null'); return { owner: x?.owner || null, hasToken: !!x?.token }; });
  const count = () => p.evaluate(() => window.__configs.length);
  const fire = (i, data) => p.evaluate(({ i, data }) => { window.__configs[i].callback(data); }, { i, data });
  const waitCode = code => p.locator('.sb-google-status').getByText('Code : ' + code, { exact: true }).waitFor({ timeout: 7000 });
  const dismiss = async () => { const button = p.getByRole('button', { name: 'Fermer le message de connexion' }); if (await button.count()) await button.click(); };
  const start = async locator => { const before = await count(); await locator.click(); await p.waitForFunction(before => window.__configs.length === before + 1, before); return before; };
  const success = (i, who) => fire(i, { access_token: 'FAUX-' + who, expires_in: 3600 });
  return { ctx, p, errors, profileCalls, session, count, fire, waitCode, dismiss, start, success,
    holdProfile: () => { hold = true; gate = new Promise(r => { release = r; }); },
    releaseProfile: () => { hold = false; release(); }, setProfileMode: mode => { profileMode = mode; } };
}
async function testMain() {
  const e = await newEnv(), { p, ctx, errors, profileCalls, session, fire, waitCode, dismiss, start, success } = e;
  const status = p.locator('.sb-google-status');
  const settingsNav = p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]');
  const libraryNav = p.locator('.ytm-mobile-bar [aria-label="Bibliothèque"]');
  const connectSettings = () => p.getByRole('button', { name: /^(Connecter mon compte|Reconnecter ce compte)$/ });
  const settings = async () => { await settingsNav.click(); await p.getByRole('heading', { name: 'Réglages', exact: true }).waitFor(); await p.waitForTimeout(350); };
  const library = async () => { await libraryNav.click(); await p.getByRole('heading', { name: 'Ta bibliothèque' }).waitFor(); await p.waitForTimeout(350); };
  const logout = async () => { await p.getByRole('button', { name: 'Se déconnecter' }).click(); await connectSettings().waitFor(); };
  try {
    let i = await start(p.locator('.sb-link-login'));
    const config = await p.evaluate(i => ({ hasErrorCallback: Object.hasOwn(window.__configs[i], 'error_callback'), scope: window.__configs[i].scope, request: window.__requests.at(-1) }), i);
    check(!config.hasErrorCallback, 'mode 6.9.33 : aucun error_callback installé dans GIS');
    check(config.request.activation && config.request.prompt === 'consent', 'ouverture liée au clic réel, avec consentement');
    check(['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/userinfo.profile'].every(s => config.scope.split(' ').includes(s)), 'mêmes trois autorisations YouTube, Drive privé et profil');
    check(await p.locator('.sb-link-login').isDisabled() && await p.locator('[aria-label="Rafraîchir"]').isDisabled(), 'double clic désactivé pendant la tentative');
    await settings();
    check(await p.getByRole('button', { name: 'Connexion en cours…' }).isDisabled() && await status.isVisible(), 'état et annulation restent visibles après changement de vue');
    await p.getByRole('button', { name: 'Annuler la connexion Google' }).click(); await waitCode('cancelled');
    let before = profileCalls.length; await success(i, 'A'); await p.waitForTimeout(150);
    check((await session()).owner === null && profileCalls.length === before, 'annulation : retour tardif ignoré avant toute vérification'); await dismiss();

    i = await start(connectSettings()); await fire(i, { error: 'access_denied', error_description: 'FAUX-SECRET-NE-PAS-AFFICHER' }); await waitCode('access_denied');
    check(!(await p.locator('body').innerText()).includes('FAUX-SECRET-NE-PAS-AFFICHER') && (await session()).owner === null, 'refus OAuth : code sans description brute ni compte activé'); await dismiss();
    i = await start(connectSettings()); await fire(i, null); await waitCode('invalid_response');
    check((await session()).owner === null, 'réponse OAuth mal formée : aucun compte activé'); await dismiss();
    i = await start(connectSettings()); await fire(i, { expires_in: 3600 }); await waitCode('token_missing');
    check((await session()).owner === null, 'absence de jeton : aucun compte activé'); await dismiss();
    i = await start(connectSettings()); await fire(i, { access_token: 'FAUX-A', expires_in: 0 }); await waitCode('invalid_expiry');
    check((await session()).owner === null, 'durée de jeton invalide : aucun compte activé'); await dismiss();
    e.setProfileMode('http'); i = await start(connectSettings()); await success(i, 'A'); await waitCode('profile_check');
    check((await status.innerText()).includes('HTTP 403') && (await session()).owner === null, 'profil HTTP 403 : la protection 6.9.34 empêche la connexion'); await dismiss();
    e.setProfileMode('no-id'); i = await start(connectSettings()); await success(i, 'A'); await waitCode('profile_check');
    check((await status.innerText()).includes('identifiant de compte absent') && (await session()).owner === null, 'profil sans identité stable : aucun compte activé'); await dismiss(); e.setProfileMode('ok');

    i = await start(connectSettings()); before = profileCalls.length; await success(i, 'A'); await p.getByRole('button', { name: 'Se déconnecter' }).waitFor();
    check((await session()).owner === 'google-A' && profileCalls.slice(before).join(',') === 'A', 'retour Google fictif : identité vérifiée avant activation du compte A');
    await fire(i, { access_token: 'FAUX-B', expires_in: 3600 }); await p.waitForTimeout(150);
    check((await session()).owner === 'google-A' && profileCalls.slice(before).join(',') === 'A', 'callback dupliqué : ne remplace pas le compte A par B');
    await library(); await p.getByText('Aucune playlist YouTube', { exact: true }).waitFor();
    check(await p.getByRole('button', { name: 'Connecter YouTube' }).count() === 0, 'bibliothèque connectée vide : aucune fausse invitation à reconnecter');
    await settings(); await logout();

    e.holdProfile(); i = await start(connectSettings()); before = profileCalls.length; await success(i, 'A');
    while (profileCalls.length === before) await pause(30);
    check((await status.innerText()).includes('Vérification du compte') && (await session()).owner === null, 'pendant la vérification, compte et Drive restent inactifs');
    await p.getByRole('button', { name: 'Annuler la connexion Google' }).click(); await waitCode('cancelled'); e.releaseProfile(); await p.waitForTimeout(150);
    check((await session()).owner === null, 'annulation pendant la vérification : profil tardif ignoré');
    await dismiss(); const j = await start(connectSettings()); await success(i, 'A');
    check(await p.getByRole('button', { name: 'Connexion en cours…' }).isDisabled() && (await session()).owner === null, 'ancienne tentative ne peut interrompre la nouvelle');
    await success(j, 'B'); await p.getByRole('button', { name: 'Se déconnecter' }).waitFor();
    check((await session()).owner === 'google-B', 'nouvelle tentative : seul le compte B est activé');
    await logout(); await library();
    i = await start(p.locator('[aria-label="Rafraîchir"]')); await fire(i, { error: 'access_denied' }); await waitCode('access_denied');
    check((await session()).owner === null && (await status.innerText()).includes('autorisation'), 'bouton Rafraîchir déconnecté : refus affiché sans exception');
    check(errors.length === 0, `aucune exception JavaScript non traitée (${errors.join('; ')})`);
  } finally { e.releaseProfile(); await ctx.close(); }
}
async function testNoResponse() {
  const e = await newEnv({ shortTimers: true }), { p, ctx, session, start, success, waitCode } = e;
  try {
    let i = await start(p.locator('.sb-link-login')); await waitCode('attente_sans_message_google');
    check((await p.locator('.sb-google-status').innerText()).includes('attend toujours') && (await session()).owner === null, 'sans retour : aide explicite, sans prétendre qu’une fenêtre est ouverte ou fermée');
    await p.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://autre.test', data: 'FAUX-SECRET-IGNORER' })));
    check(await p.getByText('Code : attente_sans_message_google', { exact: true }).isVisible(), 'message d’une autre origine : diagnostic inchangé');
    await p.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://accounts.google.com', data: 'FAUX-SECRET-IGNORER' })));
    await waitCode('attente_message_google');
    check((await session()).owner === null && !(await p.locator('body').innerText()).includes('FAUX-SECRET-IGNORER'), 'message Google observé sans contenu affiché : aucune connexion déduite');
    await p.getByRole('button', { name: 'Annuler la connexion Google' }).click(); await waitCode('cancelled');
    await p.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://accounts.google.com', data: 'FAUX-SECRET-IGNORER' })));
    await success(i, 'A'); await p.waitForTimeout(120);
    check((await session()).owner === null && await p.locator('.sb-link-login').isEnabled() && await p.getByText('Code : cancelled', { exact: true }).isVisible(), 'Annuler nettoie le diagnostic et ignore tout retour tardif');
    await e.dismiss(); i = await start(p.locator('.sb-link-login')); await waitCode('timeout');
    await success(i, 'A'); await p.waitForTimeout(120);
    check((await session()).owner === null && await p.locator('.sb-link-login').isEnabled(), 'aucune réponse : délai borné, interface libérée, retour tardif ignoré');
    await e.dismiss(); e.holdProfile(); i = await start(p.locator('.sb-link-login'));
    await p.waitForTimeout(250); await success(i, 'A');
    await p.waitForFunction(() => document.querySelector('.sb-google-status')?.textContent.includes('Vérification du compte'));
    await p.waitForTimeout(1000); e.releaseProfile();
    await p.waitForFunction(() => !!sessionStorage.getItem('soundblend_google_session_v2'));
    check((await session()).owner === 'google-A', 'réponse avant échéance : la vérification garde son propre délai');
  } finally { e.releaseProfile(); await ctx.close(); }
}
async function testWelcome() {
  const e = await newEnv({ onboarded: false }), { p, ctx, start, session, success, errors } = e;
  try {
    await p.locator('.welcome-cta').getByText('Continuer').click(); await p.getByRole('heading', { name: 'Ton compte Google.' }).waitFor();
    const i = await start(p.getByRole('button', { name: 'Se connecter avec Google' }));
    check(await p.getByRole('button', { name: 'Annuler la connexion Google' }).isVisible(), 'première visite : annulation accessible');
    await p.locator('.welcome-cta').getByText('Plus tard').click(); await p.getByRole('heading', { name: 'La clé qui compose.' }).waitFor();
    await success(i, 'A'); await p.waitForTimeout(150);
    check((await session()).owner === null && errors.length === 0, 'Plus tard annule la tentative ; retour tardif ignoré');
  } finally { await ctx.close(); }
}
async function testScriptUnavailable() {
  const e = await newEnv(), { p, ctx, session, waitCode, errors } = e;
  try {
    await p.evaluate(() => { window.google = undefined; }); await p.locator('.sb-link-login').click(); await waitCode('script_unavailable');
    check((await session()).owner === null && errors.length === 0 && await p.locator('.sb-link-login').isEnabled(), 'bibliothèque Google indisponible : diagnostic et nouvel essai possible');
  } finally { await ctx.close(); }
}
try {
  await testMain(); await testNoResponse(); await testWelcome(); await testScriptUnavailable();
  console.log(`\n${n}/${n} contrôles de connexion 6.9.38 réussis — OAuth et services simulés.`);
} finally { await browser.close(); }
