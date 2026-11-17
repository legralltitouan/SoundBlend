/* Assistant 6.9.35 : recherches, propositions et garde-fous YouTube.
   Tous les services ci-dessous sont simulés ; aucun compte réel n'est modifié. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,PUT,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; console.log(`  ✓ ${label}`); };
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Attente du scénario dépassée'); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const original = [
  { id: 'item-1', video: 'aaaaaaaaaaa', title: 'Premier', artist: 'Alpha' },
  { id: 'item-2', video: 'bbbbbbbbbbb', title: 'Deuxième', artist: 'Beta' },
  { id: 'item-3', video: 'ccccccccccc', title: 'Troisième', artist: 'Gamma' },
  { id: 'item-4', video: 'aaaaaaaaaaa', title: 'Premier', artist: 'Alpha' },
];
const asApi = (x) => ({ id: x.id, snippet: { title: x.title, videoOwnerChannelTitle: `${x.artist} - Topic`, resourceId: { kind: 'youtube#video', videoId: x.video }, thumbnails: {} }, contentDetails: { videoId: x.video } });
const editAnswer = () => ({ reply: 'Je propose un retrait, un déplacement et un ajout.', action: 'playlist_edit',
  source: { type: 'playlist', id: 'PL-SOURCE' }, extraSources: [], instruction: '', durationMinutes: 45,
  catalogQueries: [], catalogVideoIds: [], researchQuery: 'musique',
  playlistEdits: { removeItemIds: ['item-2'], moves: [{ itemId: 'item-3', position: 0 }], additions: [{ title: 'New Song', artist: 'New Artist' }] } });
async function setup(options = {}) {
  const state = { lists: { 'PL-SOURCE': clone(original) }, meta: { 'PL-SOURCE': { title: 'Ma playlist', privacy: 'public' } },
    writes: [], prompts: [], wiki: [], searches: [], next: 1, mode: options.mode || 'edit', fail: null, privateVideo: false, ...options.state };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(({ authenticated, excluded }) => {
    if (localStorage.getItem('__test635')) return;
    localStorage.setItem('__test635', '1'); localStorage.setItem('soundblend_onboarded', '1'); localStorage.setItem('soundblend_mode', 'dark');
    const prefix = authenticated ? 'soundblend_account_v1:google-assistant:' : '';
    localStorage.setItem(prefix + 'soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: 'test-key' }));
    if (authenticated) sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'fake-token', owner: 'google-assistant', expiresAt: Date.now() + 3600000, profile: { name: 'Test', email: '', avatarUrl: '' } }));
    if (excluded) localStorage.setItem(prefix + 'soundblend_exclusions_v1', JSON.stringify([{ id: 'new-artist', kind: 'artist', artist: 'New Artist', updatedAt: Date.now(), deleted: false }]));
  }, { authenticated: options.auth !== false, excluded: !!options.excluded });
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({})}}};' }));
  await ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, headers: cors, body: '{}' }));
  await ctx.route(/pipedapi\.|api\.piped\./, (r) => r.abort());
  await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    if (r.request().url().includes('alt=media')) return r.fulfill({ status: 200, headers: cors, body: '{"schema":2,"blends":[],"exclusions":[],"decouvertes":[],"suppressionsBlends":{}}' });
    if (r.request().method() === 'PATCH') return r.fulfill({ status: 200, headers: cors, body: '{"id":"f1"}' });
    return r.fulfill({ status: 200, headers: cors, body: '{"files":[{"id":"f1","name":"soundblend.json"}]}' });
  });
  await ctx.route('https://fr.wikipedia.org/w/api.php**', (r) => {
    state.wiki.push(new URL(r.request().url()).searchParams.get('gsrsearch'));
    if (state.mode === 'wiki-error') return r.fulfill({ status: 503, headers: cors, body: '{}' });
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ query: { pages: { 1: { pageid: 1, index: 1, title: 'Daft Punk', extract: 'Daft Punk est un duo français de musique électronique.' } } } }) });
  });
  await ctx.route('https://www.googleapis.com/youtube/v3/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), method = req.method();
    if (method === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    const answer = (body, status = 200) => r.fulfill({ status, headers: cors, body: JSON.stringify(body) });
    if (u.pathname.endsWith('/search')) {
      state.searches.push(u.searchParams.get('q'));
      return answer({ items: [{ id: { videoId: 'ddddddddddd' }, snippet: { title: state.searchTitle || 'New Artist - New Song', channelTitle: state.searchChannel || 'New Artist - Topic', thumbnails: {} } }] });
    }
    if (u.pathname.endsWith('/playlists')) {
      if (method === 'POST') {
        const body = req.postDataJSON(); state.writes.push({ method, resource: 'playlists', body });
        const id = `PL-COPY${state.next++}`; state.lists[id] = []; state.meta[id] = { title: body.snippet.title, privacy: body.status.privacyStatus };
        if (state.createGate) await state.createGate;
        if (state.fail === 'create-response') return answer({}, 500).catch(() => {});
        return answer({ id }).catch(() => {});
      }
      const id = u.searchParams.get('id');
      if (id) { const meta = state.meta[id]; return answer({ items: meta ? [{ id, snippet: { title: meta.title }, status: { privacyStatus: meta.privacy } }] : [] }); }
      return answer({ items: Object.entries(state.meta).map(([id, meta]) => ({ id, snippet: { title: meta.title, thumbnails: {} }, contentDetails: { itemCount: state.lists[id].length } })) });
    }
    if (u.pathname.endsWith('/playlistItems')) {
      if (method === 'GET') {
        const id = u.searchParams.get('playlistId'), list = clone(state.lists[id] || []);
        if (state.privateVideo && id === 'PL-SOURCE' && list[1]) list[1].title = 'Private video';
        // Deux pages même pour les petites listes : les deux lecteurs doivent
        // utiliser toute la pagination, y compris avant les mutations.
        const second = u.searchParams.get('pageToken') === 'p2';
        return answer({ items: (second ? list.slice(2) : list.slice(0, 2)).map(asApi), ...(!second && list.length > 2 ? { nextPageToken: 'p2' } : {}) });
      }
      const data = req.postData() ? req.postDataJSON() : null;
      state.writes.push({ method, resource: 'playlistItems', id: u.searchParams.get('id'), body: data });
      if (method === 'DELETE') {
        const id = u.searchParams.get('id'); for (const list of Object.values(state.lists)) { const at = list.findIndex((x) => x.id === id); if (at >= 0) { list.splice(at, 1); break; } }
        if (state.deleteGate) await state.deleteGate;
        return answer({}).catch(() => {});
      }
      if (method === 'PUT') {
        if (state.fail === 'move') return answer({ error: 'simulated refusal' }, 403);
        const list = state.lists[data.snippet.playlistId], at = list.findIndex((x) => x.id === data.id), [item] = list.splice(at, 1); list.splice(data.snippet.position, 0, item); return answer({ id: item.id });
      }
      if (method === 'POST') {
        const pl = data.snippet.playlistId, list = state.lists[pl], video = data.snippet.resourceId.videoId;
        if (state.fail === 'copy-second' && pl.startsWith('PL-COPY') && list.length === 1) return answer({ error: 'simulated refusal' }, 403);
        const item = { id: `new-${state.next++}`, video, title: video === 'ddddddddddd' ? 'New Song' : 'Copie', artist: video === 'ddddddddddd' ? 'New Artist' : 'Copie' };
        list.splice(Number.isInteger(data.snippet.position) ? data.snippet.position : list.length, 0, item); return answer({ id: item.id });
      }
    }
    return answer({ items: [] });
  });
  await ctx.route('https://generativelanguage.googleapis.com/**', (r) => {
    if (r.request().url().includes('/models?')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 }] }) });
    const prompt = r.request().postDataJSON()?.contents?.[0]?.parts?.[0]?.text || ''; state.prompts.push(prompt);
    let out;
    if (state.mode === 'edit') out = editAnswer();
    else if (state.mode === 'invented') { out = editAnswer(); out.playlistEdits.removeItemIds = ['imaginary-item']; }
    else if (state.mode === 'no-op') { out = editAnswer(); out.playlistEdits = { removeItemIds: [], moves: [], additions: [] }; }
    else if (state.mode === 'wiki' || state.mode === 'wiki-error') out = { reply: prompt.includes('Daft Punk est un duo') ? 'D’après les pages consultées, Daft Punk est un duo français.' : 'Je vais chercher des sources.', action: 'none', source: null, extraSources: [], catalogQueries: [], catalogVideoIds: [], researchQuery: 'Daft Punk', playlistEdits: null };
    else if (state.mode === 'catalog') out = { reply: 'Voici une piste à écouter.', action: 'none', source: null, extraSources: [], catalogQueries: ['New Artist New Song'], catalogVideoIds: [], researchQuery: '', playlistEdits: null };
    else out = { reply: 'Bonjour.', action: 'none', source: null, extraSources: [], catalogQueries: [], catalogVideoIds: [], researchQuery: '', playlistEdits: null };
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) });
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  if (options.auth !== false) await p.getByText(/1 playlist\(s\) YouTube/).waitFor({ timeout: 10000 });
  return { ctx, p, state, errors };
}
const send = async (p, text = 'Modifie Ma playlist : retire le deuxième, mets le troisième au début et ajoute New Song de New Artist.') => {
  await p.locator('#sb-assistant-input').fill(text); await p.getByRole('button', { name: 'Envoyer à l’assistant' }).click();
};
const proposal = (p) => p.getByRole('region', { name: 'Proposition de modification de playlist' });
const waitProposal = (p) => proposal(p).waitFor({ timeout: 18000 });
const waitIdle = (p) => p.locator('.sb-chat-thinking').waitFor({ state: 'detached', timeout: 18000 });
try {
  {
    const { ctx, p, state, errors } = await setup(); await send(p); await waitProposal(p);
    check(state.writes.length === 0, 'aucune écriture YouTube pendant la conversation et la préparation');
    check(await proposal(p).getByText('Retirer').count() === 1 && await proposal(p).getByText('Déplacer').count() === 1 && await proposal(p).getByText('Ajouter en fin').count() === 1, 'aperçu précis des retraits, déplacements et ajouts');
    check(await proposal(p).getByRole('button', { name: 'Choisis une destination' }).isDisabled(), 'aucune destination présélectionnée et bouton désactivé');
    await proposal(p).getByText('Voir l’ordre complet proposé').click();
    check((await proposal(p).locator('.sb-plan-order li').allTextContents()).length === 4 && (await proposal(p).locator('.sb-plan-order li').allTextContents()).filter((x) => x.includes('Premier')).length === 2, 'aperçu conserve deux occurrences de la même vidéo');
    await proposal(p).getByLabel(/Créer une copie privée/).check();
    check(state.writes.length === 0, 'choisir copie ne suffit pas : confirmation encore nécessaire');
    await proposal(p).getByRole('button', { name: 'Confirmer : créer la copie' }).click();
    await p.getByText(/Copie privée créée et vérifiée/).waitFor({ timeout: 18000 });
    const copy = Object.keys(state.lists).find((id) => id.startsWith('PL-COPY'));
    check(!!copy && state.meta[copy].privacy === 'private' && JSON.stringify(state.lists[copy].map((x) => x.video)) === JSON.stringify(['ccccccccccc','aaaaaaaaaaa','aaaaaaaaaaa','ddddddddddd']), 'copie privée vérifiée avec ordre et doublons exacts');
    check(JSON.stringify(state.lists['PL-SOURCE']) === JSON.stringify(original), 'playlist originale conservée lors de la copie');
    check(state.writes.filter((x) => x.resource === 'playlists').length === 1 && state.writes.filter((x) => x.resource === 'playlistItems').length === 4, 'une création et un ajout explicite par occurrence');
    check(!(await p.evaluate(() => Object.keys(localStorage).some((k) => k.includes('soundblend_export_intent_v1')))), 'journal de création effacé après vérification complète');
    check(errors.length === 0, 'aucune erreur JavaScript dans le parcours de copie'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup(); await send(p); await waitProposal(p); await proposal(p).getByLabel(/Modifier l’originale/).check();
    check(state.writes.length === 0, 'originale choisie sans écriture avant confirmation');
    await proposal(p).getByRole('button', { name: 'Confirmer : modifier l’originale' }).click();
    await p.getByText(/Playlist originale vérifiée/).waitFor({ timeout: 18000 });
    check(JSON.stringify(state.writes.map((x) => x.method)) === JSON.stringify(['DELETE','PUT','POST']), 'écritures ciblées seulement après confirmation');
    check(JSON.stringify(state.lists['PL-SOURCE'].map((x) => x.video)) === JSON.stringify(['ccccccccccc','aaaaaaaaaaa','aaaaaaaaaaa','ddddddddddd']), 'ordre final et doublons contrôlés sur l’originale'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup(); await send(p); await waitProposal(p);
    state.lists['PL-SOURCE'].push({ id: 'remote', video: 'eeeeeeeeeee', title: 'Ajout distant', artist: 'Delta' });
    await proposal(p).getByLabel(/Modifier l’originale/).check(); await proposal(p).getByRole('button', { name: 'Confirmer : modifier l’originale' }).click();
    await p.getByRole('alert').waitFor({ timeout: 15000 });
    check(state.writes.length === 0 && /changé depuis l’aperçu/i.test(await p.getByRole('alert').innerText()), 'écriture bloquée si un autre appareil change la playlist depuis l’aperçu');
    check(await proposal(p).count() === 0, 'proposition périmée retirée après un conflit'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ state: { fail: 'move' } }); await send(p); await waitProposal(p);
    await proposal(p).getByLabel(/Modifier l’originale/).check(); await proposal(p).getByRole('button', { name: 'Confirmer : modifier l’originale' }).click();
    await p.getByRole('alert').waitFor({ timeout: 15000 });
    check(state.writes.map((x) => x.method).join(',') === 'DELETE,PUT' && state.lists['PL-SOURCE'].length === 3, 'échec après retrait laisse honnêtement une opération partielle');
    check(/partielle.*vérifie YouTube/i.test(await p.getByRole('alert').innerText()) && await proposal(p).count() === 0, 'échec partiel visible et pas de relance automatique'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ state: { fail: 'copy-second' } }); await send(p); await waitProposal(p);
    await proposal(p).getByLabel(/Créer une copie privée/).check(); await proposal(p).getByRole('button', { name: 'Confirmer : créer la copie' }).click();
    await p.getByRole('alert').waitFor({ timeout: 18000 });
    await p.getByText('Une précédente création reste à vérifier').waitFor({ timeout: 18000 });
    const known = Object.keys(state.lists).find((id) => id.startsWith('PL-COPY'));
    check(state.lists[known].length === 1 && await p.getByRole('link', { name: /Ouvrir la copie connue/ }).count() === 1, 'copie partielle et lien connu conservés après refus YouTube');
    check(await proposal(p).getByRole('button', { name: 'Confirmer : créer la copie' }).isDisabled(), 'journal bloque une seconde création silencieuse');
    const creations = state.writes.filter((x) => x.resource === 'playlists').length;
    await p.reload(); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
    await send(p); await waitProposal(p);
    check(await p.getByText('Une précédente création reste à vérifier').isVisible() && state.writes.filter((x) => x.resource === 'playlists').length === creations, 'journal et blocage survivent au rechargement');
    await p.getByRole('button', { name: /J’ai vérifié YouTube/ }).click();
    check(await p.getByText('Une précédente création reste à vérifier').count() === 0, 'réinitialisation uniquement par bouton explicite après vérification'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ state: { privateVideo: true } }); await send(p); await p.getByRole('alert').waitFor({ timeout: 15000 });
    check(/titres inaccessibles|changé pendant sa lecture/i.test(await p.getByRole('alert').innerText()) && state.writes.length === 0, 'playlist avec vidéo privée ou effacée refusée avant toute mutation'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ mode: 'invented' }); await send(p); await p.getByRole('alert').waitFor({ timeout: 15000 });
    check(/ne correspond pas/i.test(await p.getByRole('alert').innerText()) && state.writes.length === 0, 'identifiant de retrait inventé par le modèle refusé'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ excluded: true }); await send(p); await p.getByRole('alert').waitFor({ timeout: 15000 });
    check(/bloqué/i.test(await p.getByRole('alert').innerText()) && state.writes.length === 0, 'ajout d’un artiste exclu refusé avant toute mutation'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ state: { searchChannel: 'Diffusion Label' } }); await send(p); await waitProposal(p);
    await p.evaluate(() => localStorage.setItem('soundblend_account_v1:google-assistant:soundblend_exclusions_v1', JSON.stringify([{ id: 'label', kind: 'artist', artist: 'Diffusion Label', updatedAt: Date.now(), deleted: false }])));
    await proposal(p).getByLabel(/Modifier l’originale/).check(); await proposal(p).getByRole('button', { name: 'Confirmer : modifier l’originale' }).click();
    check(/bloqué depuis l’aperçu/i.test(await p.getByRole('alert').innerText({ timeout: 12000 })) && state.writes.length === 0, 'nouvelle exclusion de la chaîne brute vérifiée avant toute écriture'); await ctx.close();
  }
  {
    const dup = clone(original); dup[3].id = 'item-1';
    const { ctx, p, state } = await setup({ state: { lists: { 'PL-SOURCE': dup } } }); await send(p);
    check(/identifiants invalides ou répétés/i.test(await p.getByRole('alert').innerText({ timeout: 15000 })) && state.writes.length === 0, 'éléments YouTube avec identifiant répété refusés avant aperçu'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ state: { searchTitle: 'New Artist - Completely Different' } }); await send(p);
    check(/Aucun résultat YouTube suffisamment précis/i.test(await p.getByRole('alert').innerText({ timeout: 15000 })) && state.writes.length === 0, 'résultat de recherche musical hors sujet refusé'); await ctx.close();
  }
  {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const { ctx, p, state } = await setup({ state: { deleteGate: gate } }); await send(p); await waitProposal(p);
    await proposal(p).getByLabel(/Modifier l’originale/).check(); await proposal(p).getByRole('button', { name: 'Confirmer : modifier l’originale' }).click();
    await until(() => state.writes.some((x) => x.method === 'DELETE'));
    await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click(); await p.getByRole('button', { name: 'Se déconnecter' }).click();
    release(); await p.waitForTimeout(500);
    check(state.writes.map((x) => x.method).join(',') === 'DELETE', 'déconnexion pendant une écriture stoppe les opérations suivantes, même si le premier retrait a pu aboutir');
    check(state.lists['PL-SOURCE'].length === 3, 'l’effet déjà reçu reste explicitement partiel, sans faire semblant de l’annuler'); await ctx.close();
  }
  {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const { ctx, p, state } = await setup({ state: { createGate: gate } }); await send(p); await waitProposal(p);
    await proposal(p).getByLabel(/Créer une copie privée/).check(); await proposal(p).getByRole('button', { name: 'Confirmer : créer la copie' }).click();
    await until(() => state.writes.some((x) => x.resource === 'playlists'));
    await p.locator('.ytm-mobile-bar [aria-label="Bibliothèque"]').click(); release();
    await until(() => p.evaluate(() => Object.entries(localStorage).some(([k, v]) => k.includes('soundblend_export_intent_v1') && JSON.parse(v).playlistId?.startsWith('PL-COPY'))));
    check(state.writes.filter((x) => x.resource === 'playlistItems').length === 0, 'quitter la vue interrompt le remplissage de la copie');
    check(await p.evaluate(() => Object.entries(localStorage).some(([k, v]) => k.includes('soundblend_export_intent_v1') && !!JSON.parse(v).playlistId)), 'l’identifiant reçu après navigation reste dans le journal du bon compte'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ mode: 'wiki', auth: false });
    await send(p, 'Qui est Daft Punk ?'); await waitIdle(p);
    check(state.wiki.length === 0, 'aucune recherche encyclopédique sans activation explicite');
    await p.getByLabel('Chercher des sources sur Wikipédia').check(); await send(p, 'Qui est Daft Punk ?'); await p.getByText('Recherche encyclopédique · Wikipédia').waitFor({ timeout: 15000 });
    check(state.wiki.at(-1) === 'Daft Punk' && state.prompts.some((x) => x.includes('Daft Punk est un duo français')), 'recherche encyclopédique réelle simulée et extrait transmis au modèle');
    check(await p.getByRole('link', { name: /Daft Punk/ }).count() >= 1 && await p.getByRole('link', { name: /Chercher plus largement/ }).count() >= 1, 'sources et lien de recherche Web plus large affichés');
    check(state.writes.length === 0, 'la recherche encyclopédique ne modifie aucune playlist'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ mode: 'wiki-error', auth: false }); await p.getByLabel('Chercher des sources sur Wikipédia').check(); await send(p, 'Cherche Daft Punk.'); await waitIdle(p);
    check(await p.getByText(/Wikipédia a refusé la recherche/).isVisible() && state.wiki.length === 1, 'échec de recherche affiché sans inventer des sources'); await ctx.close();
  }
  {
    const { ctx, p, state } = await setup({ mode: 'catalog' }); await send(p, 'Trouve New Song de New Artist.');
    await p.getByText('Résultats YouTube').waitFor({ timeout: 18000 });
    check(state.searches.length === 1 && state.writes.length === 0, 'recherche musicale YouTube effectuée sans écriture');
    await p.getByLabel(/New Song/).first().check(); await p.getByRole('button', { name: /Préparer un blend avec la sélection/ }).click();
    check(await p.getByRole('region', { name: 'Proposition de blend' }).isVisible() && state.writes.length === 0, 'titre trouvé choisi comme amorce, sans génération ni export automatique'); await ctx.close();
  }
  console.log(`\n${checks}/${checks} contrôles du nouvel assistant réussis (services simulés).`);
} finally { await browser.close(); }
