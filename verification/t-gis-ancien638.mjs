/* GIS public réel, mode d'ouverture 6.9.33. Fenêtres OAuth, jetons,
   identité et API fictifs : aucun compte ni consentement réel. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const gis = process.env.SOUNDBLEND_GIS_SCRIPT_PATH
  ? await readFile(process.env.SOUNDBLEND_GIS_SCRIPT_PATH, 'utf8')
  : execFileSync('curl', ['-fsSL', '--max-time', '25', 'https://accounts.google.com/gsi/client'], { encoding: 'utf8', maxBuffer: 1000000 });
if (!gis.includes('initTokenClient')) throw Error('Bibliothèque GIS publique indisponible.');
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
let n = 0;
function check(ok, label) { assert.ok(ok, label); n++; console.log('  ✓ ' + label); }
async function scenario(kind) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [], profiles = [];
  await c.addInitScript(({ kind }) => {
    localStorage.setItem('soundblend_onboarded', '1');
    const timer = window.setTimeout;
    window.setTimeout = function (fn, ms, ...args) { return timer(fn, ms === 12500 ? 350 : ms, ...args); };
    const original = window.open;
    window.open = function (...args) {
      if (kind === 'blocked') return null;
      const w = original.apply(this, args); if (!w) return w;
      if (kind !== 'early-close' && kind !== 'cancel') return w;
      const at = performance.now();
      return new Proxy(w, { get(target, key) {
        if (key === 'closed') return performance.now() - at > 200;
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
  }, { kind });
  await c.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
  await c.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: gis }));
  await c.route('https://accounts.google.com/o/oauth2/v2/auth**', r => {
    const u = new URL(r.request().url()), redirect = u.searchParams.get('redirect_uri');
    const id = redirect === 'gis_transform'
      ? Buffer.from(u.searchParams.get('gis_params') || '', 'base64').toString('latin1').match(/auth\d+/)?.[0]
      : new URL(redirect).searchParams.get('id');
    const clientId = u.searchParams.get('client_id');
    if (!id || !clientId) throw Error('Format GIS modifié : adapter le simulateur.');
    const params = { id, clientId, type: 'authResult', authResult: { access_token: 'FAUX-GIS', expires_in: 3600, scope: 'https://www.googleapis.com/auth/userinfo.profile' } };
    const send = `window.opener.postMessage(${JSON.stringify(JSON.stringify({ params }))},'*');window.close()`;
    const action = kind === 'manual-close' ? 'window.close()' : send;
    const delay = kind === 'early-close' || kind === 'cancel' ? 2200 : 250;
    return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>OAuth fictif<script>setTimeout(()=>{${action}},${delay})</script></body></html>` });
  });
  await c.route('https://www.googleapis.com/oauth2/**', r => { profiles.push(true); return r.fulfill({ status: 200, headers, body: '{"id":"compte-fictif","name":"Compte fictif"}' }); });
  await c.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
  await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => r.fulfill({ status: 503, headers, body: '{}' }));
  const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
  try {
    await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.waitForFunction(() => !!window.google?.accounts?.oauth2?.initTokenClient);
    await p.evaluate(() => {
      const oauth = window.google.accounts.oauth2, original = oauth.initTokenClient; window.__trace = [];
      oauth.initTokenClient = function (config) {
        window.__trace.push({ event: 'init', hasErrorCallback: Object.hasOwn(config, 'error_callback') });
        const callback = config.callback;
        config.callback = response => { window.__trace.push({ event: 'callback', hasToken: !!response?.access_token }); return callback?.(response); };
        // Ne pas ajouter error_callback : cela changerait le mode testé.
        return original.call(this, config);
      };
    });
    const popupPromise = kind === 'blocked' ? null : p.waitForEvent('popup', { timeout: 10000 });
    await p.locator('.sb-link-login').click();
    const popup = popupPromise ? await popupPromise : null;
    const trace = () => p.evaluate(() => window.__trace);
    const owner = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null')?.owner || null);
    check(!(await trace()).find(x => x.event === 'init')?.hasErrorCallback, `${kind} : vrai GIS initialisé sans error_callback comme en 6.9.33`);
    if (kind === 'normal' || kind === 'early-close') {
      await p.waitForFunction(() => !!sessionStorage.getItem('soundblend_google_session_v2'), null, { timeout: 10000 });
      check((await trace()).some(x => x.event === 'callback' && x.hasToken) && (await owner()) === 'compte-fictif' && errors.length === 0,
        kind === 'normal' ? 'GIS réel : retour et identité fictifs activés normalement' : 'GIS réel : retour fictif accepté malgré un faux état de fermeture de fenêtre');
    } else if (kind === 'cancel') {
      await p.getByRole('button', { name: 'Annuler la connexion Google' }).click(); await p.waitForTimeout(2700);
      check((await trace()).some(x => x.event === 'callback' && x.hasToken) && (await owner()) === null && profiles.length === 0 && errors.length === 0,
        'GIS réel : après annulation, retour fictif ignoré avant lecture du profil');
    } else {
      await p.locator('.sb-google-status').getByText(/^Code : attente_(sans_)?message_google$/).waitFor();
      if (kind === 'manual-close') await popup.waitForEvent('close', { timeout: 7000 }).catch(() => {});
      check(!(await trace()).some(x => x.event === 'callback') && (await owner()) === null && profiles.length === 0 && errors.length === 0,
        kind === 'blocked' ? 'GIS réel : fenêtre bloquée, aucun retour ; aide sans fausse détection' : 'GIS réel : fenêtre fermée sans retour ; aide sans fausse connexion');
      await p.getByRole('button', { name: 'Annuler la connexion Google' }).click();
      check(await p.locator('.sb-link-login').isEnabled(), `${kind} : Annuler rend un nouvel essai possible`);
    }
  } finally { await c.close(); }
}
try {
  for (const kind of ['normal', 'early-close', 'cancel', 'manual-close', 'blocked']) await scenario(kind);
  console.log(`\n${n}/${n} contrôles GIS réussis — bibliothèque réelle, fenêtres/réponses/API simulées.`);
} finally { await browser.close(); }
