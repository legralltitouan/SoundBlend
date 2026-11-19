/* Gardes de reprise du service partagé, depuis les sources Vite. Tout est
   simulé : aucun compte, jeton ou service utilisateur réel. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const c = await b.newContext({ serviceWorkers: 'block' });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
let hold = false, gate = Promise.resolve(), release = () => {}; const profiles = [], errors = [];
await c.addInitScript(() => {
  localStorage.setItem('soundblend_onboarded', '1');
  const timer = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) { return timer(fn, ms === 12500 ? 200 : ms, ...args); };
});
await c.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
await c.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: `window.__cfg=[];window.google={accounts:{oauth2:{initTokenClient:c=>{window.__cfg.push(c);return{requestAccessToken(){}}},revoke:(_t,cb)=>cb&&cb()}}};` }));
await c.route('https://www.googleapis.com/oauth2/**', async r => {
  const h = r.request().headers().authorization || '', who = h.endsWith('-A') ? 'A' : h.endsWith('-B') ? 'B' : '?'; profiles.push(who);
  if (hold) await gate;
  return r.fulfill({ status: 200, headers, body: JSON.stringify({ id: 'google-' + who, name: 'Compte fictif ' + who }) }).catch(() => {});
});
await c.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => r.fulfill({ status: 503, headers, body: '{}' }));
const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
let n = 0; const check = (v, label) => { assert.ok(v, label); n++; console.log('  ✓ ' + label); };
const count = () => p.evaluate(() => window.__cfg.length);
const fire = (i, who) => p.evaluate(({ i, who }) => { window.__cfg[i].callback({ access_token: 'FAUX-' + who, expires_in: 3600 }); }, { i, who });
const state = () => p.evaluate(() => ({ phase: window.__yt.getLoginState().phase, owner: window.__yt.accountId(), auth: window.__yt.isAuthenticated() }));
const capture = label => p.evaluate(label => { const promise = window.__yt.login('fictif'); promise.then(() => window.__results[label] = 'ok', e => window.__results[label] = e.code); }, label);
const retry = label => p.evaluate(label => { const promise = window.__yt.retryPendingLogin('fictif'); if (!promise) return false; promise.then(() => window.__results[label] = 'ok', e => window.__results[label] = e.code); return true; }, label);
const waitResult = label => p.waitForFunction(label => !!window.__results[label], label);
try {
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.waitForFunction(() => !!window.google?.accounts?.oauth2);
  await p.evaluate(async () => { window.__yt = (await import('/src/services/youtube.ts')).youtubeService; window.__results = {}; });
  check(!(await retry('inactif')) && await count() === 0, 'service inactif : reprise sans effet et aucune fenêtre');
  let i = await count(); await capture('premiere');
  check(!(await retry('trop-tot')) && await count() === i + 1 && (await state()).phase === 'waiting', 'avant le bandeau : une reprise périmée ne peut pas invalider la tentative');
  await p.waitForFunction(() => window.__yt.getLoginState().phase === 'waiting-long');
  const statuses = await p.evaluate(() => { window.__phases = []; window.addEventListener('sb:google-login-state', () => window.__phases.push(window.__yt.getLoginState().phase)); return window.__phases; });
  assert.ok(Array.isArray(statuses));
  check(await retry('nouvelle'), 'reprise explicitement demandée pendant l’attente acceptée');
  await waitResult('premiere');
  check(await p.evaluate(() => window.__results.premiere) === 'superseded' && !(await p.evaluate(() => window.__phases.includes('error'))) && await count() === i + 2, 'ancienne promesse remplacée sans événement d’erreur ni troisième fenêtre');
  await fire(i, 'A'); await p.waitForTimeout(100);
  check(profiles.length === 0 && !(await state()).auth, 'ancien jeton A : ignoré avant vérification');
  hold = true; gate = new Promise(resolve => { release = resolve; }); await fire(i + 1, 'B');
  await p.waitForFunction(() => window.__yt.getLoginState().phase === 'verifying');
  check(!(await retry('pendant-verif')) && await count() === i + 2 && (await state()).owner === null, 'reprise périmée pendant vérification B : aucun effet sur la réponse déjà reçue');
  hold = false; release(); await waitResult('nouvelle');
  check(await p.evaluate(() => window.__results.nouvelle) === 'ok' && (await state()).owner === 'google-B' && profiles.join(',') === 'B', 'seule la seconde tentative active B après sa vérification');
  check(!(await retry('apres-succes')) && await count() === i + 2, 'après succès : une reprise périmée ne change rien');
  await p.evaluate(() => window.__yt.logout());
  i = await count(); await capture('avant-sortie'); await p.waitForFunction(() => window.__yt.getLoginState().phase === 'waiting-long');
  check(await retry('sortie'), 'reprise possible depuis une nouvelle attente');
  await p.evaluate(() => window.__yt.logout()); await waitResult('sortie');
  const before = profiles.length; await fire(i, 'A'); await fire(i + 1, 'B'); await p.waitForTimeout(100);
  const s = await state();
  check(await p.evaluate(() => window.__results.sortie) === 'cancelled' && !s.auth && !s.owner && profiles.length === before, 'déconnexion après reprise : aucune réponse tardive ne réactive un compte');
  check(errors.length === 0, 'aucune exception JavaScript non traitée');
  console.log(`\n${n}/${n} contrôles de courses de reprise réussis — services simulés.`);
} finally { release(); await c.close(); await b.close(); }
