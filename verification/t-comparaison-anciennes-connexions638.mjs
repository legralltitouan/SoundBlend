/* Comparaison des sources 6.9.33, 6.9.34 et 6.9.37 avec la bibliothèque
   GIS publique non modifiée. Fenêtres, jetons, profils, Drive et YouTube
   sont fictifs : aucun compte ni consentement réel. Servir les trois archives
   décompressées sur les ports ci-dessous (surcharge possible par variables
   SOUNDBLEND_633_URL, SOUNDBLEND_634_URL et SOUNDBLEND_637_URL). */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const versions = [
  { version: '6.9.33', url: process.env.SOUNDBLEND_633_URL || 'http://localhost:5133/', legacy: true, monitors: false },
  { version: '6.9.34', url: process.env.SOUNDBLEND_634_URL || 'http://localhost:5134/', legacy: false, monitors: true },
  { version: '6.9.37', url: process.env.SOUNDBLEND_637_URL || 'http://localhost:5137/', legacy: false, monitors: true },
];
const gis = process.env.SOUNDBLEND_GIS_SCRIPT_PATH
  ? await readFile(process.env.SOUNDBLEND_GIS_SCRIPT_PATH, 'utf8')
  : execFileSync('curl', ['-fsSL', '--max-time', '25', 'https://accounts.google.com/gsi/client'], { encoding: 'utf8', maxBuffer: 1000000 });
assert.ok(gis.includes('initTokenClient'), 'Bibliothèque GIS publique indisponible.');
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; console.log('  ✓ ' + label); }

async function scenario(v, kind) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [], profileCalls = [];
  await context.addInitScript(({ kind }) => {
    localStorage.setItem('soundblend_onboarded', '1');
    window.__popupClosedReads = 0;
    const original = window.open;
    window.open = function (...args) {
      const w = original.apply(this, args);
      if (!w || !['closed-early', 'silent'].includes(kind)) return w;
      const at = performance.now();
      return new Proxy(w, { get(target, key) {
        if (key === 'closed') {
          window.__popupClosedReads++;
          // closed-early : faux signal de fermeture alors que la fenêtre reste
          // ouverte. silent : pas de signal fiable après sa fermeture simulée.
          return kind === 'closed-early' ? performance.now() - at > 200 : false;
        }
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
  }, { kind });
  await context.route('**/*', route => route.request().url().startsWith(new URL(v.url).origin + '/') ? route.continue() : route.abort());
  await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: gis }));
  await context.route('https://accounts.google.com/o/oauth2/v2/auth**', route => {
    const u = new URL(route.request().url()), redirect = u.searchParams.get('redirect_uri');
    const id = redirect === 'gis_transform'
      ? Buffer.from(u.searchParams.get('gis_params') || '', 'base64').toString('latin1').match(/auth\d+/)?.[0]
      : new URL(redirect).searchParams.get('id');
    const clientId = u.searchParams.get('client_id');
    if (!id || !clientId) throw new Error('Format GIS inconnu : adapter uniquement le simulateur.');
    const params = { id, clientId, type: 'authResult', authResult: { access_token: 'FAUX-COMPARAISON', expires_in: 3600, scope: 'https://www.googleapis.com/auth/userinfo.profile' } };
    const send = `window.opener.postMessage(${JSON.stringify(JSON.stringify({ params }))},'*');window.close()`;
    const action = kind === 'silent' ? 'window.close()' : send;
    const delay = kind === 'closed-early' ? 2200 : 250;
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>Fenêtre OAuth fictive<script>setTimeout(()=>{${action}},${delay})</script></body></html>` });
  });
  await context.route('https://www.googleapis.com/oauth2/**', route => {
    profileCalls.push(route.request().method());
    return route.fulfill(kind === 'profile-403'
      ? { status: 403, headers, body: '{}' }
      : { status: 200, headers, body: '{"id":"compte-test","name":"Compte fictif"}' });
  });
  await context.route('https://www.googleapis.com/youtube/v3/**', route => route.fulfill({ status: 200, headers, body: '{"items":[]}' }));
  await context.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, route => route.fulfill({ status: 503, headers, body: '{}' }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(v.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ytm-shell');
    await page.waitForFunction(() => !!window.google?.accounts?.oauth2?.initTokenClient);
    await page.evaluate(() => {
      window.__authTrace = [];
      const oauth = window.google.accounts.oauth2, original = oauth.initTokenClient;
      oauth.initTokenClient = function (config) {
        const callback = config.callback, error = config.error_callback;
        window.__authTrace.push({ event: 'init', monitors: typeof error === 'function' });
        config.callback = response => {
          window.__authTrace.push({ event: 'callback', hasToken: !!response?.access_token, hasError: !!response?.error });
          return callback?.(response);
        };
        // Ne surtout pas installer error_callback là où l'ancienne version
        // n'en avait pas : ce serait modifier le comportement du vrai GIS.
        if (typeof error === 'function') config.error_callback = e => {
          window.__authTrace.push({ event: 'error', type: e?.type });
          return error(e);
        };
        return original.call(this, config);
      };
    });
    const popupPromise = page.waitForEvent('popup', { timeout: 10000 });
    await page.locator('.sb-link-login').click();
    await popupPromise;
    if (kind === 'silent') {
      await page.waitForTimeout(1800);
    } else {
      await page.waitForFunction(() => window.__authTrace.some(e => e.event === 'callback'), null, { timeout: 12000 });
      const shouldCallProfile = !(kind === 'closed-early' && v.version === '6.9.34');
      const deadline = Date.now() + 10000;
      while (shouldCallProfile && !profileCalls.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 40));
      if (kind === 'normal' || (kind === 'closed-early' && v.version !== '6.9.34') || (kind === 'profile-403' && v.legacy)) {
        await page.waitForFunction(legacy => legacy ? !!localStorage.getItem('soundblend_yt_token') : !!sessionStorage.getItem('soundblend_google_session_v2'), v.legacy, { timeout: 10000 });
      } else {
        await page.waitForTimeout(400);
      }
    }
    const data = await page.evaluate(() => ({
      trace: window.__authTrace,
      closedReads: window.__popupClosedReads,
      legacyToken: !!localStorage.getItem('soundblend_yt_token'),
      owner: JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null')?.owner || null,
      status: document.querySelector('.sb-google-status')?.textContent || '',
    }));
    const init = data.trace.find(e => e.event === 'init');
    const hasCallback = data.trace.some(e => e.event === 'callback' && e.hasToken);
    const signalledClosed = data.trace.some(e => e.event === 'error' && e.type === 'popup_closed');
    const connected = v.legacy ? data.legacyToken : data.owner === 'compte-test';
    console.log('  état de test (sans données personnelles) : ' + JSON.stringify({ trace: data.trace, closedReads: data.closedReads, connected, profileCalls, errors, status: data.status }));
    check(init?.monitors === v.monitors, `${v.version} / ${kind} : configuration GIS d'origine conservée`);
    if (kind === 'normal') {
      check(hasCallback && connected && profileCalls.length === 1, `${v.version} : réponse fictive normale reçue et session activée`);
    } else if (kind === 'closed-early') {
      if (v.legacy) check(!signalledClosed && hasCallback && connected, `${v.version} : pas d’error_callback installé ; retour fictif accepté`);
      else if (v.version === '6.9.34') check(signalledClosed && hasCallback && !connected, `${v.version} : signal fictif précoce abandonne la tentative avant le jeton`);
      else check(signalledClosed && hasCallback && connected, `${v.version} : signal fictif précoce non terminal, jeton accepté`);
    } else if (kind === 'silent') {
      check(!hasCallback && !signalledClosed && !connected && profileCalls.length === 0,
        `${v.version} : sans réponse ni signal fiable, pas de compte activé`);
      if (v.version === '6.9.37') check(data.status.includes('Termine la connexion dans la fenêtre Google'), '6.9.37 : le bandeau reste sur « Termine la connexion » dans ce scénario simulé');
    } else if (kind === 'profile-403') {
      if (v.legacy) check(hasCallback && connected && profileCalls.length === 1, `${v.version} : jeton activé malgré un profil refusé`);
      else check(hasCallback && !connected && profileCalls.length === 1, `${v.version} : profil refusé, compte et synchro non activés`);
    }
    return { version: v.version, kind, trace: data.trace, closedReads: data.closedReads, connected, profileCalls: profileCalls.length, unhandledErrors: errors.length };
  } finally { await context.close(); }
}
const results = [];
try {
  for (const version of versions.filter(v => !process.env.SOUNDBLEND_COMPARE_VERSION || v.version === process.env.SOUNDBLEND_COMPARE_VERSION)) for (const kind of ['normal', 'closed-early', 'silent', 'profile-403'].filter(k => !process.env.SOUNDBLEND_COMPARE_SCENARIO || k === process.env.SOUNDBLEND_COMPARE_SCENARIO)) {
    console.log(`\n${version.version} — ${kind}`);
    results.push(await scenario(version, kind));
  }
  console.log(`\n${checks}/${checks} contrôles comparatifs réussis — GIS réel, fenêtres et réponses fictives.`);
  console.log('Résumé sans données personnelles : ' + JSON.stringify(results));
} finally { await browser.close(); }
