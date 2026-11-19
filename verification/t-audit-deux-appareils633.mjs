/* Audit de synchronisation 6.9.33 : deux profils Chromium temporaires,
   même compte fictif, Drive SIMULÉ en mémoire. Aucun appel réel à Google.
   Les blocs/déblocages, blend, clé et mode empruntent les mêmes fonctions
   et événements que l'interface ; aucune synchro manuelle n'est forcée. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
const remote = { id: 'fichier-compte-fictif', data: { schema: 2, modifie: new Date().toISOString(), appareil: 'serveur-fictif', apparence: { mode: 'light', at: 0 }, reglages: { geminiApiKey: '', at: 0 }, exclusions: [], decouvertes: [], suppressionsBlends: {}, blends: [], portrait: null } };
const wait = async (condition, description, limit = 15000) => {
  const end = Date.now() + limit;
  while (Date.now() < end) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Délai dépassé : ${description}`);
};
const ready = async p => p.evaluate(async () => { const d = await import('/src/services/drive.ts'); return d.etatSync().phase === 'pret' && !d.enAttente(); });
const state = async p => p.evaluate(async () => {
  const s = await import('/src/services/storage.ts'), prefs = await import('/src/context/prefs.ts');
  return { exclusions: s.getExclusionRecords(), blends: s.getStoredBlends(), key: s.getStoredSettings().geminiApiKey, mode: prefs.getMode(), discoveries: s.getDiscoveryHistory() };
});
async function device(name) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await c.addInitScript(({ name }) => {
    if (localStorage.getItem('__audit_device')) return;
    localStorage.setItem('__audit_device', name); localStorage.setItem('soundblend_onboarded', '1');
    sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token:'FAUX-MEME-COMPTE',owner:'google-unique',expiresAt:Date.now()+3600000,profile:{ name:'Compte fictif unique', email:'', avatarUrl:'' } }));
    localStorage.setItem('soundblend_mode', 'light');
  }, { name });
  await c.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
  await c.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};' }));
  await c.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
  await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => {
    const req = r.request(), u = new URL(req.url()), method = req.method();
    if (method === 'OPTIONS') return r.fulfill({ status: 200, headers, body: '' });
    if (req.headers().authorization !== 'Bearer FAUX-MEME-COMPTE') return r.fulfill({ status: 401, headers, body: '{}' });
    if (u.pathname.includes('/upload/') && method === 'PATCH') {
      remote.data = JSON.parse(req.postData() || '{}');
      return r.fulfill({ status: 200, headers, body: JSON.stringify({ id: remote.id }) });
    }
    if (u.searchParams.get('alt') === 'media') return r.fulfill({ status: 200, headers, body: JSON.stringify(remote.data) });
    return r.fulfill({ status: 200, headers, body: JSON.stringify({ files: [{ id: remote.id, name: 'soundblend.json' }] }) });
  });
  const p = await c.newPage(); await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.ytm-shell');
  await wait(() => ready(p), `synchro initiale ${name}`);
  return { c, p };
}
let A, B;
try {
  A = await device('A');
  await A.p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  await A.p.getByLabel('Clé API Gemini').fill('FAUSSE-CLE-TEST');
  await A.p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await A.p.getByRole('button', { name: 'Changer de thème clair/sombre' }).click();
  await A.p.evaluate(async () => {
    const s = await import('/src/services/storage.ts'); const now = Date.now();
    const t = { id: 'TRACK000001', videoId: 'TRACK000001', title: 'Titre test', artist: 'Artiste test', thumbnailUrl: '', durationSeconds: 180, category: 'fresh' };
    s.block(t, 'track'); s.block(t, 'artist'); s.recordDiscoveries([t], now);
    s.saveBlendToStorage({ id: 'blend-test', title: 'Blend test', description: '', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), seedTracks: [], tracks: [t] });
  });
  await wait(() => remote.data.reglages?.geminiApiKey === 'FAUSSE-CLE-TEST' && remote.data.apparence?.mode === 'dark' && remote.data.exclusions?.filter(x => !x.deleted).length === 2 && remote.data.blends?.some(x => x.id === 'blend-test') && remote.data.decouvertes?.some(x => x.title === 'Titre test'), 'envoi automatique des créations A');
  await wait(() => ready(A.p), 'fin du premier envoi A');
  B = await device('B');
  let b = await state(B.p);
  assert.equal(b.exclusions.filter(x => !x.deleted).length, 2);
  assert.ok(b.exclusions.some(x => x.kind === 'track') && b.exclusions.some(x => x.kind === 'artist'));
  assert.ok(b.blends.some(x => x.id === 'blend-test') && b.discoveries.some(x => x.title === 'Titre test'));
  assert.equal(b.key, 'FAUSSE-CLE-TEST'); assert.equal(b.mode, 'dark');
  console.log('✓ Sur le même compte fictif : musique, artiste, blend, historique, clé et mode envoyés automatiquement puis reçus sur le second profil.');

  await A.p.evaluate(async () => { const s = await import('/src/services/storage.ts'); for (const r of s.getExclusionRecords().filter(x => !x.deleted)) s.unblock(r.id); s.deleteStoredBlend('blend-test'); });
  await A.p.getByLabel('Clé API Gemini').fill('');
  await A.p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await A.p.getByRole('button', { name: 'Changer de thème clair/sombre' }).click();
  await wait(() => remote.data.exclusions?.filter(x => x.deleted).length === 2 && !remote.data.blends?.some(x => x.id === 'blend-test') && !!remote.data.suppressionsBlends?.['blend-test'] && remote.data.reglages?.geminiApiKey === '' && remote.data.apparence?.mode === 'light', 'envoi automatique des suppressions A');
  await wait(() => ready(A.p), 'fin du second envoi A');
  assert.equal((await state(B.p)).exclusions.filter(x => !x.deleted).length, 2, 'le second profil contient encore une ancienne copie avant sa reconnexion');
  await B.p.reload({ waitUntil: 'domcontentloaded' }); await B.p.waitForSelector('.ytm-shell'); await wait(() => ready(B.p), 'lecture B après reconnexion');
  b = await state(B.p);
  assert.equal(b.exclusions.filter(x => !x.deleted).length, 0);
  assert.ok(b.exclusions.some(x => x.kind === 'track' && x.deleted) && b.exclusions.some(x => x.kind === 'artist' && x.deleted));
  assert.ok(!b.blends.some(x => x.id === 'blend-test'));
  assert.equal(b.key, ''); assert.equal(b.mode, 'light');
  assert.ok(!remote.data.blends.some(x => x.id === 'blend-test') && remote.data.exclusions.every(x => x.deleted));
  console.log('✓ Déblocages musique et artiste, suppression du blend, effacement de la clé et changement de mode sont reçus sur la copie périmée sans résurrection.');
  console.log('\nTest terminé : envoi et reconnexion automatiques, données et Drive simulés.');
} finally { await A?.c.close(); await B?.c.close(); await browser.close(); }
