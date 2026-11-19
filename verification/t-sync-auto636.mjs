/* Synchronisation automatique 6.9.36 : deux états réseau, Drive et OAuth simulés. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; console.log(`  ✓ ${label}`); };
const wait = async (fn, label, ms = 12000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error(`Délai dépassé : ${label}`); };
const exclusion = (name, at = Date.now()) => ({ id: `artist:${name.toLowerCase().replace(/\s/g, '-')}`, kind: 'artist', artist: name, deleted: false, updatedAt: at });

async function open({ pollMs = 180000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const state = { mode: 'ok', calls: 0, patches: 0, remote: { schema: 2, modifie: new Date().toISOString(), appareil: 'serveur', apparence: { mode: 'light', at: 0 }, reglages: { geminiApiKey: '', at: 0 }, exclusions: [exclusion('Initial distant')], decouvertes: [], suppressionsBlends: {}, portrait: null, blends: [] } };
  await ctx.addInitScript(({ pollMs }) => {
    localStorage.setItem('soundblend_onboarded', '1');
    if (!sessionStorage.getItem('soundblend_google_session_v2')) sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'FAUX', owner: 'auto-test', expiresAt: Date.now() + 3600000, profile: { name: 'Test auto', email: '', avatarUrl: '' } }));
    const origTimeout = window.setTimeout.bind(window), origInterval = window.setInterval.bind(window);
    window.setTimeout = (fn, ms, ...args) => origTimeout(fn, ms === 2500 ? 80 : ms === 10000 ? 450 : ms === 20000 ? 700 : ms === 1200 ? 80 : ms, ...args);
    window.setInterval = (fn, ms, ...args) => origInterval(fn, ms === 180000 ? pollMs : ms, ...args);
  }, { pollMs });
  await ctx.route('**/*', (r) => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};' }));
  await ctx.route('https://www.googleapis.com/youtube/v3/**', (r) => r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' }));
  await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, (r) => {
    const req = r.request(), u = new URL(req.url()); if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    state.calls++;
    if (state.mode !== 'ok') return r.fulfill({ status: Number(state.mode), headers: cors, body: '{}' });
    if (u.pathname.includes('/upload/') && req.method() === 'PATCH') { state.remote = JSON.parse(req.postData()); state.patches++; return r.fulfill({ status: 200, headers: cors, body: '{"id":"f1"}' }); }
    if (u.searchParams.get('alt') === 'media') return r.fulfill({ status: 200, headers: cors, body: JSON.stringify(state.remote) });
    return r.fulfill({ status: 200, headers: cors, body: '{"files":[{"id":"f1","name":"soundblend.json"}]}' });
  });
  const page = await ctx.newPage();
  await page.goto(base); await page.waitForSelector('.ytm-shell');
  const status = () => page.evaluate(async () => (await import('/src/services/drive.ts')).etatSync());
  const localArtists = () => page.evaluate(async () => (await import('/src/services/storage.ts')).getExclusions().artists);
  const ready = async () => { const e = await status(); return e.phase === 'pret' && !e.enAttente; };
  await wait(ready, 'synchronisation initiale');
  return { ctx, page, state, status, localArtists, ready };
}

try {
  let e = await open();
  check((await e.localArtists()).includes('Initial distant'), 'données distantes chargées automatiquement à l’ouverture');
  await e.page.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  check(await e.page.getByRole('button', { name: 'Synchroniser maintenant' }).count() === 0, 'bouton manuel absent des réglages');
  check((await e.page.locator('.sb-sync-line').innerText()).includes('vérifiée'), 'état de synchronisation toujours visible');
  check(await e.page.getByText(/synchronisation est automatique/i).isVisible(), 'fonctionnement automatique expliqué dans les réglages');

  await e.page.evaluate(async () => (await import('/src/services/storage.ts')).block({ artist: 'Geste local' }, 'artist'));
  await wait(() => e.state.remote.exclusions.some((x) => x.artist === 'Geste local') && e.ready(), 'envoi automatique local');
  check(e.state.remote.exclusions.some((x) => x.artist === 'Geste local' && !x.deleted), 'modification locale envoyée automatiquement sans clic');

  e.state.mode = '503';
  await e.page.evaluate(async () => (await import('/src/services/storage.ts')).block({ artist: 'Après panne' }, 'artist'));
  await wait(async () => { const s = await e.status(); return s.phase === 'erreur' && s.enAttente; }, 'erreur temporaire');
  check((await e.localArtists()).includes('Après panne') && (await e.status()).message.includes('automatiquement'), 'échec réseau garde le geste et annonce la reprise automatique');
  e.state.mode = 'ok';
  await wait(() => e.state.remote.exclusions.some((x) => x.artist === 'Après panne') && e.ready(), 'nouvel essai automatique sans événement en ligne');
  check(e.state.remote.exclusions.some((x) => x.artist === 'Après panne'), 'réessai après panne sans bouton ni intervention réseau');

  // Aucun push Drive : la relance au premier plan relit le fichier. Attendre
  // la fenêtre anti-rafale de cinq secondes avant de simuler le retour.
  e.state.remote.exclusions.push(exclusion('Retour distant', Date.now() + 100));
  await e.page.waitForTimeout(5200);
  await e.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await wait(async () => (await e.localArtists()).includes('Retour distant'), 'relecture au premier plan', 3000);
  check((await e.localArtists()).includes('Retour distant'), 'retour dans l’application charge les changements distants');
  await e.ctx.close();

  e = await open({ pollMs: 500 });
  e.state.remote.exclusions.push(exclusion('Veille distante', Date.now() + 100));
  await wait(async () => (await e.localArtists()).includes('Veille distante'), 'veille distante automatique', 5000);
  check((await e.localArtists()).includes('Veille distante'), 'la veille périodique charge les changements sans ouvrir les réglages');
  await e.ctx.close();

  e = await open();
  await e.page.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  e.state.mode = '403';
  await e.page.evaluate(async () => (await import('/src/services/storage.ts')).block({ artist: 'Droit refusé' }, 'artist'));
  await wait(async () => (await e.status()).phase === 'sans-portee', 'refus de droits');
  check((await e.status()).enAttente && await e.page.getByRole('button', { name: 'Réactiver les autorisations' }).isVisible(), '403 : attente conservée et action de réautorisation maintenue');
  const calls403 = e.state.calls; await e.page.waitForTimeout(700);
  check(e.state.calls === calls403, 'pas de boucle de réessais agressive sur un refus de droits');
  e.state.mode = 'ok';
  await e.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await wait(() => e.state.remote.exclusions.some((x) => x.artist === 'Droit refusé') && e.ready(), 'reprise après rétablissement');
  check(e.state.remote.exclusions.some((x) => x.artist === 'Droit refusé'), 'événement réseau relance la synchronisation automatiquement');
  await e.ctx.close();

  e = await open(); e.state.mode = '401';
  await e.page.evaluate(async () => (await import('/src/services/storage.ts')).block({ artist: 'Session expirée' }, 'artist'));
  await wait(async () => (await e.status()).phase === 'expire', 'expiration session');
  check((await e.status()).enAttente && (await e.localArtists()).includes('Session expirée'), 'expiration : données du compte conservées et état en attente');
  const calls401 = e.state.calls; await e.page.waitForTimeout(700);
  check(e.state.calls === calls401, 'pas de requêtes répétées avec une session expirée');
  await e.ctx.close();
  console.log(`\n${checks}/${checks} contrôles de synchronisation automatique réussis — Drive simulé.`);
} finally { await browser.close(); }
