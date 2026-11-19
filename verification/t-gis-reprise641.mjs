/* Bibliothèque GIS publique réelle ; les fenêtres OAuth, réponses, jetons,
   profils et API sont fictifs. Aucun compte ou consentement réel. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const gis = process.env.SOUNDBLEND_GIS_SCRIPT_PATH
  ? await readFile(process.env.SOUNDBLEND_GIS_SCRIPT_PATH, 'utf8')
  : execFileSync('curl', ['-fsSL', '--max-time', '25', 'https://accounts.google.com/gsi/client'], { encoding: 'utf8', maxBuffer: 1000000 });
assert.ok(gis.includes('initTokenClient'), 'Bibliothèque GIS publique disponible');
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
let n = 0;
const check = (value, label) => { assert.ok(value, label); n++; console.log('  ✓ ' + label); };

async function scenario(kind) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const profiles = [], errors = [], requests = [];
  await c.addInitScript(() => {
    localStorage.setItem('soundblend_onboarded', '1');
    const original = window.setTimeout;
    window.setTimeout = function (fn, ms, ...args) { return original(fn, ms === 12500 ? 160 : ms, ...args); };
  });
  await c.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
  await c.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: gis }));
  await c.route('https://accounts.google.com/o/oauth2/v2/auth**', r => {
    const u = new URL(r.request().url()), redirect = u.searchParams.get('redirect_uri');
    const id = redirect === 'gis_transform'
      ? Buffer.from(u.searchParams.get('gis_params') || '', 'base64').toString('latin1').match(/auth\d+/)?.[0]
      : new URL(redirect).searchParams.get('id');
    const clientId = u.searchParams.get('client_id');
    if (!id || !clientId) throw Error('Format GIS modifié : adapter le simulateur.');
    const index = requests.length;
    requests.push({ prompt: u.searchParams.get('prompt'), clientId, scope: u.searchParams.get('scope'), id });
    const params = { id, clientId, type: 'authResult', authResult: { access_token: index === 0 ? 'FAUX-A' : 'FAUX-B', expires_in: 3600, scope: 'https://www.googleapis.com/auth/userinfo.profile' } };
    const send = `window.opener.postMessage(${JSON.stringify(JSON.stringify({ params }))},'*');window.close()`;
    // La première fenêtre se ferme sans retour. Dans « late », un ancien
    // message fictif sera ensuite injecté dans la page après la reprise.
    const action = index === 0 ? 'window.close()' : send;
    const delay = index === 0 ? 400 : 1800;
    return r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Fenêtre OAuth fictive</title><script>setTimeout(()=>{${action}},${delay})</script>` });
  });
  await c.route('https://www.googleapis.com/oauth2/**', r => {
    const auth = r.request().headers().authorization || '';
    const who = auth.endsWith('-A') ? 'A' : auth.endsWith('-B') ? 'B' : '?'; profiles.push(who);
    return r.fulfill({ status: 200, headers, body: JSON.stringify({ id: 'google-' + who, name: 'Compte fictif ' + who }) });
  });
  await c.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
  await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => r.fulfill({ status: 503, headers, body: '{}' }));
  const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
  const owner = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null')?.owner || null);
  try {
    await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.waitForFunction(() => !!window.google?.accounts?.oauth2?.initTokenClient);
    await p.evaluate(() => {
      const oauth = window.google.accounts.oauth2, init = oauth.initTokenClient; window.__trace = [];
      oauth.initTokenClient = function (config) {
        const i = window.__trace.filter(x => x.event === 'init').length;
        window.__trace.push({ event: 'init', i, hasErrorCallback: Object.hasOwn(config, 'error_callback') });
        const callback = config.callback;
        config.callback = response => { window.__trace.push({ event: 'callback', i, hasToken: !!response?.access_token }); return callback(response); };
        return init.call(this, config);
      };
    });
    const firstOpened = p.waitForEvent('popup', { timeout: 10000 }); await p.locator('.sb-link-login').click(); const first = await firstOpened;
    await first.waitForURL('https://accounts.google.com/o/oauth2/v2/auth**', { timeout: 10000 });
    await first.waitForEvent('close', { timeout: 7000 });
    await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).waitFor();
    const secondOpened = p.waitForEvent('popup', { timeout: 10000 });
    await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).click();
    const second = await secondOpened; await second.waitForURL('https://accounts.google.com/o/oauth2/v2/auth**', { timeout: 10000 });
    check(requests.length === 2 && requests.every(r => r.prompt === 'select_account') && requests[0].clientId === requests[1].clientId && requests[0].scope === requests[1].scope && requests[0].id !== requests[1].id, `${kind} : GIS émet deux fenêtres séparées avec mêmes client, scopes et choix de compte`);
    const initial = await p.evaluate(() => window.__trace.filter(x => x.event === 'init'));
    check(initial.length === 2 && initial.every(x => !x.hasErrorCallback), `${kind} : les deux clients GIS conservent le même mode sans error_callback`);
    if (kind === 'late') {
      const { id, clientId } = requests[0];
      // Message synthétique, et non un vrai échange Google : il utilise
      // l'identifiant de la première fenêtre afin de tester l'ancien client.
      const data = JSON.stringify({ params: { id, clientId, type: 'authResult', authResult: { access_token: 'FAUX-A', expires_in: 3600, scope: 'https://www.googleapis.com/auth/userinfo.profile' } } });
      await p.evaluate(data => window.dispatchEvent(new MessageEvent('message', { origin: 'https://accounts.google.com', data })), data);
      await p.waitForFunction(() => window.__trace.some(x => x.event === 'callback' && x.i === 0), null, { timeout: 7000 });
      check(profiles.length === 0 && (await owner()) === null, 'GIS réel : ancien callback A synthétique après reprise ignoré avant vérification');
    } else {
      check(profiles.length === 0 && (await owner()) === null, 'GIS réel : première fenêtre fermée sans réponse, aucune connexion inventée');
    }
    await p.waitForFunction(() => JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null')?.owner === 'google-B', null, { timeout: 10000 });
    const trace = await p.evaluate(() => window.__trace);
    check(trace.some(x => x.event === 'callback' && x.i === 1 && x.hasToken) && profiles.join(',') === 'B', `${kind} : seul le second callback GIS fictif active le compte B vérifié`);
    check(errors.length === 0 && !(await p.locator('body').innerText()).includes('Connexion annulée'), `${kind} : ni exception ni faux message d’annulation après reprise`);
  } finally { await c.close(); }
}
try {
  await scenario('closed'); await scenario('late');
  console.log(`\n${n}/${n} contrôles de reprise avec GIS réel réussis — fenêtres, réponses et API simulées.`);
} finally { await browser.close(); }
