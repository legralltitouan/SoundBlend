/* Nouvelles attentes et reprise de 6.9.41. Interface réelle, fenêtres,
   jetons, identités et API entièrement fictifs ; ne teste pas un compte Google.
   Les horloges sont accélérées seulement dans le profil de test. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const b = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
const gisStub = `window.__cfg=[];window.__req=[];window.google={accounts:{oauth2:{
  initTokenClient:c=>{const i=window.__cfg.push(c)-1;return {requestAccessToken:o=>window.__req.push({i,prompt:o?.prompt,active:!!navigator.userActivation?.isActive})}},
  revoke:(_t,cb)=>cb&&cb()
}}};`;
let n = 0;
const check = (condition, label) => { assert.ok(condition, label); n++; console.log('  ✓ ' + label); };

async function env({ onboarded = true, width = 390, height = 844, deadline = 6000 } = {}) {
  const c = await b.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const profiles = [], drives = [], errors = [];
  let hold = false, release = () => {}, gate = Promise.resolve();
  await c.addInitScript(({ onboarded, deadline }) => {
    if (onboarded) localStorage.setItem('soundblend_onboarded', '1');
    window.__timers = [];
    const original = window.setTimeout;
    window.setTimeout = function (fn, ms, ...args) {
      if (ms === 12500 || ms === 180000 || ms === 600000) window.__timers.push(ms);
      // 1 seconde fictive correspond à 10 ms. La valeur exacte 600000 est
      // enregistrée avant accélération, et l'ancienne limite aussi si elle existe.
      const adjusted = ms === 12500 ? 125 : ms === 180000 ? 1800 : ms === 600000 ? deadline : ms;
      return original(fn, adjusted, ...args);
    };
  }, { onboarded, deadline });
  await c.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
  await c.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: gisStub }));
  await c.route('https://www.googleapis.com/oauth2/**', async r => {
    const auth = r.request().headers().authorization || '';
    const who = auth.endsWith('-A') ? 'A' : auth.endsWith('-B') ? 'B' : '?';
    profiles.push(who);
    if (hold) await gate;
    return r.fulfill({ status: 200, headers, body: JSON.stringify({ id: 'google-' + who, name: 'Compte fictif ' + who }) }).catch(() => {});
  });
  await c.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
  await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => { drives.push(r.request().headers().authorization || ''); return r.fulfill({ status: 503, headers, body: '{}' }); });
  const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.google?.accounts?.oauth2?.initTokenClient);
  await p.waitForSelector(onboarded ? '.ytm-shell' : '.welcome');
  const count = () => p.evaluate(() => window.__cfg.length);
  const session = () => p.evaluate(() => JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null')?.owner || null);
  const fire = (i, who) => p.evaluate(({ i, who }) => { window.__cfg[i].callback({ access_token: 'FAUX-' + who, expires_in: 3600 }); }, { i, who });
  const start = async locator => { const i = await count(); await locator.click(); await p.waitForFunction(i => window.__cfg.length === i + 1, i); return i; };
  const waitLong = () => p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).waitFor();
  const success = owner => p.waitForFunction(owner => JSON.parse(sessionStorage.getItem('soundblend_google_session_v2') || 'null')?.owner === owner, owner);
  return { c, p, profiles, drives, errors, count, session, fire, start, waitLong, success,
    holdProfile: () => { hold = true; gate = new Promise(resolve => { release = resolve; }); },
    releaseProfile: () => { hold = false; release(); } };
}

async function testSlowSuccess() {
  const e = await env(); const { p, c, profiles, session, start, fire, waitLong, success } = e;
  try {
    const i = await start(p.locator('.sb-link-login'));
    const timers = await p.evaluate(() => window.__timers.slice());
    check(timers.includes(600000) && timers.includes(12500) && !timers.includes(180000), 'nouvelle tentative : échéance de 600 000 ms et aide à 12 500 ms, pas l’ancienne limite de 180 000 ms');
    await waitLong();
    const msg = await p.locator('.sb-google-status').innerText();
    check(msg.includes('n’annule pas la connexion') && msg.includes('s’est fermée') && (await session()) === null, 'le bandeau précise que la connexion continue et que la reprise suppose la fenêtre fermée');
    await p.waitForTimeout(2000); // au-delà de l’ancienne limite simulée de 1800 ms
    check(await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).isVisible() && (await session()) === null && profiles.length === 0, 'après 200 secondes simulées : toujours en attente, sans relance automatique ni compte activé');
    await fire(i, 'A'); await success('google-A');
    check(profiles.join(',') === 'A' && await e.count() === 1, 'réponse lente de la première tentative : identité A vérifiée puis activée sans seconde fenêtre');
    check(e.errors.length === 0, 'aucune exception pendant la réponse lente');
  } finally { e.releaseProfile(); await c.close(); }
}

async function testDeadline() {
  const e = await env({ deadline: 900 }); const { p, c, profiles, session, start, fire, waitLong } = e;
  try {
    const i = await start(p.locator('.sb-link-login')); await waitLong();
    await p.getByText('Code : timeout', { exact: true }).waitFor();
    await fire(i, 'A'); await p.waitForTimeout(100);
    check((await session()) === null && profiles.length === 0 && await p.locator('.sb-link-login').isEnabled(), 'après la nouvelle échéance simulée : libération et retour tardif ignoré');
    check(!(await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).count()), 'le bouton de reprise de l’attente ne persiste pas après expiration');
  } finally { e.releaseProfile(); await c.close(); }
}

async function testRetry() {
  const e = await env(); const { p, c, profiles, drives, session, start, fire, waitLong, success } = e;
  try {
    await p.evaluate(() => {
      localStorage.setItem('soundblend_account_v1:google-A:soundblend_settings', JSON.stringify({ geminiApiKey: 'FAUX-A' }));
      localStorage.setItem('soundblend_account_v1:google-B:soundblend_settings', JSON.stringify({ geminiApiKey: 'FAUX-B' }));
      window.__states = []; window.addEventListener('sb:google-login-state', () => {
        const t = document.querySelector('.sb-google-status')?.textContent || '';
        window.__states.push(t);
      });
    });
    const i = await start(p.locator('.sb-link-login')); await waitLong();
    check(await e.count() === 1 && (await session()) === null, 'fenêtre sans réponse : pas de seconde tentative ni de session automatiques');
    const retry = p.getByRole('button', { name: 'Réessayer après fermeture de Google' });
    await retry.click(); await p.waitForFunction(() => window.__cfg.length === 2);
    const req = await p.evaluate(() => window.__req.slice());
    check(req.length === 2 && req[1].active && req[1].prompt === 'select_account', 'Réessayer ouvre un nouveau choix de compte depuis le clic utilisateur');
    await p.waitForTimeout(50);
    check(!(await p.locator('body').innerText()).includes('Connexion annulée') && (await session()) === null, 'le remplacement n’affiche pas une fausse annulation ni une fausse connexion');
    await fire(i, 'A'); await p.waitForTimeout(100);
    check(profiles.length === 0 && drives.length === 0 && (await session()) === null, 'réponse A de la première tentative après reprise : ignorée avant identité et Drive');
    e.holdProfile(); await fire(i + 1, 'B');
    await p.getByText('Réponse reçue. Vérification du compte auprès de Google…').waitFor();
    check((await session()) === null && !(await retry.count()) && drives.length === 0, 'pendant la vérification B, pas de reprise et aucune session ou écriture Drive prématurée');
    e.releaseProfile(); await success('google-B');
    check(profiles.join(',') === 'B' && (await session()) === 'google-B', 'seule la réponse du nouvel essai active le compte B vérifié');
    const keys = await p.evaluate(() => ({ a: JSON.parse(localStorage.getItem('soundblend_account_v1:google-A:soundblend_settings')).geminiApiKey, b: JSON.parse(localStorage.getItem('soundblend_account_v1:google-B:soundblend_settings')).geminiApiKey }));
    check(keys.a === 'FAUX-A' && keys.b === 'FAUX-B', 'données A et B restent séparées après la reprise');
    await p.waitForTimeout(150);
    check(drives.length > 0 && drives.every(auth => auth.endsWith('-B')) && e.errors.length === 0, 'Drive est appelé seulement avec le jeton fictif B ; aucune exception non traitée');
  } finally { e.releaseProfile(); await c.close(); }
}

async function testRepeatedAndCancel() {
  const e = await env(); const { p, c, profiles, session, start, fire, waitLong } = e;
  try {
    const i = await start(p.locator('.sb-link-login')); await waitLong();
    await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).click();
    await p.waitForFunction(() => window.__cfg.length === 2); await waitLong();
    await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).click();
    await p.waitForFunction(() => window.__cfg.length === 3);
    await fire(i, 'A'); await fire(i + 1, 'A'); await p.waitForTimeout(100);
    check((await session()) === null && profiles.length === 0 && await e.count() === 3, 'reprises successives : les deux anciennes réponses ne peuvent pas se connecter');
    await p.getByRole('button', { name: 'Annuler la connexion Google' }).click();
    await p.getByText('Code : cancelled', { exact: true }).waitFor(); await fire(i + 2, 'B'); await p.waitForTimeout(100);
    check((await session()) === null && profiles.length === 0 && await p.locator('.sb-link-login').isEnabled(), 'annulation volontaire du dernier essai : tous les retours tardifs restent ignorés');
    check(e.errors.length === 0, 'aucune promesse non traitée après plusieurs reprises et une annulation');
  } finally { e.releaseProfile(); await c.close(); }
}

async function testRefusalAfterRetry() {
  const e = await env(); const { p, c, session, start, waitLong } = e;
  try {
    await start(p.locator('.sb-link-login')); await waitLong();
    await p.getByRole('button', { name: 'Réessayer après fermeture de Google' }).click(); await p.waitForFunction(() => window.__cfg.length === 2);
    await p.evaluate(() => { window.__cfg[1].callback({ error: 'access_denied', error_description: 'FAUX-SECRET' }); });
    await p.getByText('Code : access_denied', { exact: true }).waitFor();
    check((await session()) === null && !(await p.locator('body').innerText()).includes('FAUX-SECRET') && await e.count() === 2, 'refus explicite : aucun compte activé, aucune relance automatique ni donnée brute affichée');
  } finally { e.releaseProfile(); await c.close(); }
}

async function testWelcome(width, height) {
  const e = await env({ onboarded: false, width, height }); const { p, c, session, start, fire, waitLong, success } = e;
  try {
    await p.locator('.welcome-cta').getByText('Continuer').click(); await p.getByRole('heading', { name: 'Ton compte Google.' }).waitFor();
    const i = await start(p.getByRole('button', { name: 'Se connecter avec Google' })); await waitLong();
    const retry = p.getByRole('button', { name: 'Réessayer après fermeture de Google' });
    const cancel = p.getByRole('button', { name: 'Annuler la connexion Google' });
    const bounds = await p.evaluate(() => {
      const a = document.querySelector('[aria-label="Réessayer après fermeture de Google"]').getBoundingClientRect();
      const b = document.querySelector('[aria-label="Annuler la connexion Google"]').getBoundingClientRect();
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, a: {left:a.left,right:a.right,top:a.top,bottom:a.bottom}, b: {left:b.left,right:b.right,top:b.top,bottom:b.bottom} };
    });
    const overlaps = bounds.a.left < bounds.b.right && bounds.a.right > bounds.b.left && bounds.a.top < bounds.b.bottom && bounds.a.bottom > bounds.b.top;
    check(await retry.isVisible() && await cancel.isVisible() && bounds.a.left >= 0 && bounds.a.right <= width && bounds.b.left >= 0 && bounds.b.right <= width && bounds.scroll <= width && !overlaps, `accueil ${width} px : les deux boutons sont lisibles sans chevauchement ni débordement horizontal`);
    await retry.focus(); await p.keyboard.press('Enter'); await p.waitForFunction(() => window.__cfg.length === 2);
    const active = await p.evaluate(() => window.__req[1].active);
    await fire(i, 'A'); await p.waitForTimeout(50); check(active && (await session()) === null, `accueil ${width} px : reprise accessible au clavier, ancienne réponse ignorée`);
    await fire(i + 1, 'B'); await success('google-B');
    check((await session()) === 'google-B' && e.errors.length === 0, `accueil ${width} px : nouveau compte B vérifié après reprise`);
  } finally { e.releaseProfile(); await c.close(); }
}

try {
  await testSlowSuccess(); await testDeadline(); await testRetry(); await testRepeatedAndCancel(); await testRefusalAfterRetry();
  await testWelcome(320, 720); await testWelcome(390, 844); await testWelcome(1280, 800);
  console.log(`\n${n}/${n} contrôles de délai et reprise 6.9.41 réussis — horloges et services simulés.`);
} finally { await b.close(); }
