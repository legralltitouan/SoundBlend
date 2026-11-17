/* Non-régression : deux comptes, anciennes données, expirations et quota.
   OAuth, Drive, YouTube et Piped sont simulés ; aucun compte réel utilisé. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: 'light' });
const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,DELETE,OPTIONS,PUT', 'access-control-allow-headers': '*' };
const now = Date.now();
const t = (title, artist, videoId) => ({ id: videoId, title, artist, videoId, thumbnailUrl: '', durationSeconds: 180, category: 'fresh' });
const blend = (id, title, track) => ({ id, title, description: '', createdAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), seedTracks: [], tracks: [track] });
const blank = { schema: 2, modifie: new Date(now).toISOString(), appareil: 'serveur-simule', apparence: { mode: 'light', at: 0 }, reglages: { geminiApiKey: '', at: 0 }, exclusions: [], decouvertes: [], suppressionsBlends: {}, portrait: null, blends: [] };
const banks = {
  A: { id: 'fichier-A', data: { ...structuredClone(blank), apparence: { mode: 'dark', at: now - 1000 }, reglages: { geminiApiKey: 'FAUSSE-CLE-A', at: now - 1000 }, exclusions: [
    { id: 'artist:artiste a', kind: 'artist', artist: 'Artiste A', updatedAt: now - 1000, deleted: false },
    { id: 'track:artiste a|titre a', kind: 'track', title: 'Titre A', artist: 'Artiste A', videoId: 'AAAAAAAAAAA', updatedAt: now - 1000, deleted: false },
  ], blends: [blend('blend-A', 'Blend A', t('Titre A', 'Artiste A', 'AAAAAAAAAAA'))] } },
  B: { id: 'fichier-B', data: structuredClone(blank) },
};
const calls = [];
let n = 0;
const check = (v, label) => { assert.ok(v, label); console.log(`  ✓ ${label}`); n++; };
const wait = async (condition, description, limit = 18000) => { const deadline = Date.now() + limit; while (Date.now() < deadline) { if (await condition()) return; await new Promise(r => setTimeout(r, 70)); } throw new Error(`Délai dépassé : ${description}`); };
await ctx.addInitScript(({ now }) => {
  if (!localStorage.getItem('__audit_legacy_seed')) {
    localStorage.setItem('__audit_legacy_seed', '1'); localStorage.setItem('soundblend_onboarded', '1');
    localStorage.setItem('soundblend_settings', JSON.stringify({ geminiApiKey: 'FAUSSE-CLE-ANCIENNE' }));
    localStorage.setItem('soundblend_mode', 'dark');
    localStorage.setItem('soundblend_exclusions_v1', JSON.stringify([{ id:'artist:ancien',kind:'artist',artist:'Ancien',updatedAt:now,deleted:false }]));
    localStorage.setItem('soundblend_recent_blends', JSON.stringify([{id:'blend-ancien',title:'Blend ancien',description:'',createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks:[]}]));
  }
  window.__auditAccount = 'A'; window.__auditExpires = 3600;
}, { now });
await ctx.route('**/*', r => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
await ctx.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: `window.google={accounts:{oauth2:{initTokenClient:(o)=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'FAUX-'+window.__auditAccount,expires_in:window.__auditExpires}),10)}),revoke:(_t,cb)=>cb()}}};` }));
await ctx.route('https://www.googleapis.com/oauth2/**', r => {
  const account = r.request().headers().authorization?.split('FAUX-')[1] || 'X';
  return r.fulfill({ status: 200, headers, body: JSON.stringify(account === 'X' ? { name: 'Identité sans ID' } : { id: `google-${account}`, name: `Compte ${account}`, picture: '' }) });
});
await ctx.route('https://www.googleapis.com/youtube/v3/**', r => r.fulfill({ status: 200, headers, body: '{"items":[]}' }));
await ctx.route(/pipedapi\.|api\.piped\./, r => r.fulfill({ status: 200, headers, body: JSON.stringify({ items: [{ type: 'channel', name: 'Artiste quota fictif', url: '/channel/quota' }] }) }));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, r => {
  const req = r.request(), url = new URL(req.url()), method = req.method();
  if (method === 'OPTIONS') return r.fulfill({ status: 200, headers, body: '' });
  const account = (req.headers().authorization || '').split('FAUX-')[1], bank = banks[account];
  calls.push({ account, method, path: url.pathname });
  if (!bank) return r.fulfill({ status: 401, headers, body: '{}' });
  if (url.pathname.includes('/upload/') && method === 'PATCH') {
    if (decodeURIComponent(url.pathname.split('/').at(-1)) !== bank.id) return r.fulfill({ status: 404, headers, body: '{}' });
    bank.data = JSON.parse(req.postData() || '{}'); return r.fulfill({ status: 200, headers, body: JSON.stringify({ id: bank.id }) });
  }
  if (url.searchParams.get('alt') === 'media') return r.fulfill({ status: 200, headers, body: JSON.stringify(bank.data) });
  return r.fulfill({ status: 200, headers, body: JSON.stringify({ files: [{ id: bank.id, name: 'soundblend.json' }] }) });
});
const ready = async p => p.evaluate(async () => { const d = await import('/src/services/drive.ts'); return d.etatSync().phase === 'pret' && !d.enAttente(); });
const state = async p => p.evaluate(async () => {
  const s = await import('/src/services/storage.ts'), a = await import('/src/services/accountScope.ts'), pref = await import('/src/context/prefs.ts');
  return { owner: a.accountScope(), exclusions: s.getExclusionRecords(), blends: s.getStoredBlends(), settings: s.getStoredSettings(), mode: pref.getMode() };
});
const settings = p => p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]');
const login = async (p, account) => { await p.evaluate(a => { window.__auditAccount = a; }, account); await p.getByRole('button', { name: /^(Connecter mon compte|Reconnecter ce compte)$/ }).click(); };
const logout = async p => { await p.getByRole('button', { name: 'Se déconnecter' }).click(); await p.getByRole('button', { name: 'Connecter mon compte', exact: true }).waitFor(); };
let p, q;
const errors = [];
try {
  p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.ytm-shell'); await p.waitForFunction(() => !!window.google?.accounts?.oauth2);
  await settings(p).click();
  let guest = await state(p);
  check(guest.owner === null && guest.settings.geminiApiKey === 'FAUSSE-CLE-ANCIENNE' && guest.blends.some(x=>x.id==='blend-ancien'), 'anciennes données visibles dans leur espace local, sans compte');
  await login(p, 'A'); await p.getByRole('button', { name: 'Se déconnecter' }).waitFor(); await wait(() => ready(p), 'première synchro A');
  let a = await state(p);
  check(a.owner === 'google-A' && a.settings.geminiApiKey === 'FAUSSE-CLE-A' && a.mode === 'dark' && a.blends.some(x=>x.id==='blend-A') && a.exclusions.filter(x=>!x.deleted).length===2, 'A reçoit uniquement ses propres données Drive');
  check(!banks.A.data.blends.some(x=>x.id==='blend-ancien') && !banks.A.data.exclusions.some(x=>x.artist==='Ancien') && banks.A.data.reglages.geminiApiKey==='FAUSSE-CLE-A', 'aucune ancienne donnée locale n’est importée dans A');

  await p.evaluate(async () => { const s = await import('/src/services/storage.ts'); s.block({artist:'Modification A en attente'},'artist'); });
  check(await p.evaluate(async()=> (await import('/src/services/drive.ts')).enAttente()), 'un geste récent est marqué en attente avant le délai d’envoi');
  await logout(p);
  guest = await state(p);
  check(guest.owner === null && guest.settings.geminiApiKey === 'FAUSSE-CLE-ANCIENNE' && !guest.exclusions.some(x=>x.artist==='Artiste A'), 'déconnexion : A reste séparé et l’espace local historique réapparaît');
  check(!banks.A.data.exclusions.some(x=>x.artist==='Modification A en attente'), 'déconnexion immédiate : l’envoi non effectué n’est pas déclaré réussi');
  await login(p, 'B'); await p.getByRole('button', { name:'Se déconnecter' }).waitFor(); await wait(() => ready(p), 'première synchro B');
  let b = await state(p);
  check(b.owner==='google-B' && b.settings.geminiApiKey==='' && b.blends.length===0 && b.exclusions.length===0 && b.mode==='light', 'B démarre dans son espace distinct, sans clé, thème ou blend de A');
  check(!JSON.stringify(banks.B.data).includes('Artiste A') && !JSON.stringify(banks.B.data).includes('FAUSSE-CLE-A') && !JSON.stringify(banks.B.data).includes('FAUSSE-CLE-ANCIENNE') && !JSON.stringify(banks.B.data).includes('Modification A en attente'), 'Drive B ne reçoit ni données de A, ni anciennes données locales');
  await p.evaluate(async () => { const s=await import('/src/services/storage.ts'); s.block({artist:'Artiste B'},'artist'); s.saveStoredSettings({...s.getStoredSettings(),geminiApiKey:'FAUSSE-CLE-B'}); });
  await wait(() => banks.B.data.reglages.geminiApiKey==='FAUSSE-CLE-B' && banks.B.data.exclusions.some(x=>x.artist==='Artiste B'), 'envoi B'); await wait(() => ready(p), 'fin envoi B');
  await logout(p); await login(p, 'A'); await wait(() => ready(p) && banks.A.data.exclusions.some(x=>x.artist==='Modification A en attente'), 'reprise A');
  a = await state(p);
  check(a.settings.geminiApiKey==='FAUSSE-CLE-A' && a.exclusions.some(x=>x.artist==='Modification A en attente') && !a.exclusions.some(x=>x.artist==='Artiste B'), 'reconnexion A : ses modifications en attente sont reprises sans recevoir B');
  check(!JSON.stringify(banks.B.data).includes('Modification A en attente'), 'la reprise différée de A ne touche pas Drive B');

  await logout(p); const beforeUnknown = calls.length; await login(p,'X');
  await p.getByText(/Impossible de vérifier l’identité Google/).first().waitFor();
  check((await state(p)).owner===null && !calls.slice(beforeUnknown).some(x=>x.account==='X'), 'identité Google sans ID stable : connexion et synchronisation refusées');
  await login(p,'B'); await wait(() => ready(p), 'reconnexion B');
  const beforeExpiry = structuredClone(banks.B.data);
  await p.evaluate(async () => { const y=(await import('/src/services/youtube.ts')).youtubeService; y.invalidateToken(y.getAccessToken()); });
  await p.getByRole('button',{name:'Reconnecter ce compte'}).waitFor();
  await p.evaluate(async () => { const s=await import('/src/services/storage.ts'); s.block({artist:'Ajout après expiration'},'artist'); });
  const expired = await p.evaluate(async()=>{const d=await import('/src/services/drive.ts');return d.etatSync()});
  check(expired.phase==='expire' && expired.enAttente && (await state(p)).owner==='google-B', 'expiration : statut explicite, compte conservé et changement marqué en attente');
  check(!JSON.stringify(banks.B.data).includes('Ajout après expiration') && beforeExpiry.reglages.geminiApiKey===banks.B.data.reglages.geminiApiKey, 'aucun envoi n’est annoncé pendant l’expiration');
  await login(p,'B'); await wait(() => ready(p) && banks.B.data.exclusions.some(x=>x.artist==='Ajout après expiration'), 'reprise après expiration');
  check(!((await p.locator('.sb-sync-line').innerText()).includes('en attente')), 'reconnexion : envoi repris et état confirmé');

  await p.evaluate(() => { window.__originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key,value) { if (String(key).endsWith(':soundblend_exclusions_v1')) throw new DOMException('Quota simulé','QuotaExceededError'); return window.__originalSetItem.call(this,key,value); }; });
  await p.getByRole('button',{name:'Ajouter une exclusion',exact:true}).click(); await p.getByRole('tab',{name:/Artistes/}).click();
  await p.getByRole('searchbox',{name:'Rechercher dans les exclusions et le catalogue'}).fill('Artiste quota fictif');
  await p.getByRole('button',{name:'Exclure Artiste quota fictif'}).click();
  check((await p.locator('.sb-exclusions-notice').innerText()).includes('Stockage local indisponible') && !(await state(p)).exclusions.some(x=>x.artist==='Artiste quota fictif'), 'quota local refusé : erreur visible, aucune exclusion confirmée');
  await p.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; }); await p.keyboard.press('Escape');

  q = await ctx.newPage(); q.on('pageerror',e=>errors.push(e.message)); await q.goto(base,{waitUntil:'domcontentloaded'}); await q.waitForSelector('.ytm-shell'); await q.waitForFunction(()=>!!window.google?.accounts?.oauth2); await settings(q).click();
  await login(q,'A'); await wait(() => ready(q), 'onglet A');
  check((await state(p)).owner==='google-B' && (await state(q)).owner==='google-A', 'deux onglets du même navigateur gardent des comptes indépendants');
  await logout(q);
  check((await state(p)).owner==='google-B' && await p.evaluate(async()=> (await import('/src/services/youtube.ts')).youtubeService.isAuthenticated()), 'la déconnexion de l’onglet A ne change pas le compte de l’onglet B');
  check(errors.length===0, `aucune exception JavaScript (${errors.join('; ')})`);
  console.log(`\n${n}/${n} contrôles comptes réussis — comptes et services simulés.`);
} catch (e) {
  console.error('État diagnostique :', p && await p.evaluate(async () => ({ sync:(await import('/src/services/drive.ts')).etatSync(), scope:(await import('/src/services/accountScope.ts')).accountScope() })).catch(()=>null), 'appels', calls.slice(-20), 'erreurs', errors);
  throw e;
} finally { await ctx.close(); await browser.close(); }
