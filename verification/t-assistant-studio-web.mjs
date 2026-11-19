/* Studio — adapté aux options repliées.  Recherche Web 6.9.35 : toutes les réponses Google/YouTube sont simulées.
   Le microphone vocal est un périphérique Chromium factice. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': '*' };
const widget = '<style>.container{display:flex;font-size:14px}.chip{border:solid 1px;border-radius:16px;padding:5px 16px}@media (prefers-color-scheme:dark){.container{background-color:#1f1f1f;color:#fff}}</style><div class="container"><svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="#fff"/><path d="M1 1L2 2" fill="#4285F4"/></svg><a class="chip" href="https://vertexaisearch.cloud.google.com/grounding-api-redirect/simulated">Recherche simulée</a></div>';
const answer = 'Voici le résultat Web simulé 🙂.\nUne source confirme l’information.';
const metadata = () => ({ searchEntryPoint: { renderedContent: widget }, webSearchQueries: ['recherche simulée'],
  groundingChunks: [{ web: { uri: 'https://example.com/article', title: 'Source Exemple' } }] });
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; console.log(`  ✓ ${label}`); };
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Attente du scénario Web dépassée'); };
async function setup(options = {}) {
  const state = { webRequests: [], normalPrompts: [], sockets: [], voice: [], writes: [], mode: 'ok', ...options.state };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('soundblend_onboarded', '1');
    localStorage.setItem('soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: 'personal-test-key' }));
  });
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({})}}};' }));
  await ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, headers: cors, body: '{}' }));
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/pipedapi\.|api\.piped\./, (r) => r.abort());
  await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive|youtube)\//, (r) => { if (r.request().method() !== 'GET' && r.request().method() !== 'OPTIONS') state.writes.push(r.request().method()); return r.fulfill({ status: 200, headers: cors, body: '{"items":[],"files":[]}' }); });
  await ctx.route('https://fr.wikipedia.org/w/api.php**', (r) => r.fulfill({ status: 200, headers: cors, body: '{"query":{"pages":{}}}' }));
  await ctx.routeWebSocket(/wss:\/\/generativelanguage\.googleapis\.com\/.*/, (ws) => {
    state.sockets.push(ws); ws.onClose(() => { void ws.close().catch(() => {}); });
    ws.onMessage((raw) => { const m = JSON.parse(String(raw)); state.voice.push(m); if (m.setup) ws.send(JSON.stringify({ setupComplete: {} })); });
  });
  await ctx.route('https://generativelanguage.googleapis.com/**', async (r) => {
    const req = r.request(), u = new URL(req.url());
    const fulfill = (data, status = 200) => r.fulfill({ status, headers: cors, body: JSON.stringify(data) }).catch(() => {});
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    if (u.pathname.endsWith('/models')) return fulfill({ models: [
      { name: 'models/gemini-3.0-pro', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 },
      { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
    ] });
    const body = req.postDataJSON() || {};
    if (body.tools?.some((t) => t.googleSearch)) {
      state.webRequests.push({ url: req.url(), headers: req.headers(), body });
      if (state.webGate) await state.webGate;
      if (state.mode === 'quota') return fulfill({ error: 'quota' }, 429);
      if (state.mode === 'denied') return fulfill({ error: 'denied' }, 403);
      if (state.mode === 'unsupported-first' && state.webRequests.length === 1) return fulfill({ error: 'unsupported' }, 400);
      let meta = metadata();
      if (state.mode === 'no-suggestions') delete meta.searchEntryPoint;
      if (state.mode === 'no-grounding') meta = undefined;
      if (state.mode === 'unsafe-html') meta.searchEntryPoint.renderedContent = state.badHtml;
      if (state.mode === 'unsafe-source') meta.groundingChunks = [{ web: { uri: 'javascript:alert(1)', title: 'mauvais lien' } }];
      return fulfill({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP', ...(meta ? { groundingMetadata: meta } : {}) }] });
    }
    const prompt = body.contents?.[0]?.parts?.[0]?.text || ''; state.normalPrompts.push(prompt);
    const out = { reply: 'Réponse conversationnelle sans recherche.', action: 'none', source: null, extraSources: [], instruction: '', durationMinutes: 45,
      catalogQueries: [], catalogVideoIds: [], researchQuery: 'recherche simulée', playlistEdits: null };
    return fulfill({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForSelector('.ytm-shell');
  await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click(); await p.getByRole('button', {name:'Options et contexte'}).click();
  return { p, ctx, state, errors };
}
const webBox = (p) => p.getByLabel('Recherche Web Google (quota / coût)');
const send = async (p, value) => { await p.locator('#sb-assistant-input').fill(value); await p.getByRole('button', { name: 'Envoyer à l’assistant' }).click(); };
const idle = (p) => p.locator('.sb-chat-thinking').waitFor({ state: 'detached', timeout: 20000 });
try {
  {
    const { p, ctx, state, errors } = await setup();
    await send(p, 'Quel est le sujet ?'); await idle(p);
    check(state.webRequests.length === 0 && await p.locator('.sb-google-result').count() === 0, 'aucune recherche Web Google sans activation');
    await p.getByLabel('Chercher des sources sur Wikipédia').check(); await webBox(p).check();
    check(!(await p.getByLabel('Chercher des sources sur Wikipédia').isChecked()) && state.webRequests.length === 0, 'choix Web explicite, exclusif de Wikipédia et sans appel immédiat');
    check(await p.getByText(/recherche peut être facturée/).isVisible() && await p.getByText(/pas lue automatiquement/).isVisible(), 'coût, confidentialité et limite vocale annoncés');
    await send(p, 'Que s’est-il passé récemment ?'); await p.locator('.sb-google-result').waitFor({ timeout: 20000 });
    check(state.webRequests.length === 1 && state.webRequests[0].body.tools[0].googleSearch && state.webRequests[0].body.contents[0].parts[0].text.includes('Que s’est-il passé récemment ?'), 'Google Search appelé avec la question demandée');
    check(state.webRequests[0].headers['x-goog-api-key'] === 'personal-test-key' && !new URL(state.webRequests[0].url).searchParams.has('key'), 'clé personnelle envoyée en en-tête directement à Google');
    check(await p.locator('.sb-google-answer').textContent() === answer, 'texte Web rendu sans reformulation');
    check(await p.getByRole('link', { name: 'Source Exemple' }).getAttribute('href') === 'https://example.com/article', 'source fournie par Google cliquable directement');
    const widgetCheck = await p.locator('.sb-google-suggestions').evaluate((el, expected) => {
      const t = document.createElement('template'); t.innerHTML = expected;
      const root = el.shadowRoot, suggestion = root?.querySelector('a');
      return { exact: root?.innerHTML === t.innerHTML, href: suggestion?.getAttribute('href'), visible: !!suggestion && suggestion.getBoundingClientRect().width > 0,
        noFrame: !root?.querySelector('iframe'), width: el.getBoundingClientRect().width, answerWidth: el.parentElement.querySelector('.sb-google-answer').getBoundingClientRect().width };
    }, widget);
    check(widgetCheck.exact && widgetCheck.noFrame && widgetCheck.visible, 'suggestions Google intactes dans le document, sans iframe');
    check(widgetCheck.href?.startsWith('https://vertexaisearch.cloud.google.com/grounding-api-redirect/') && widgetCheck.width >= widgetCheck.answerWidth - 1, 'suggestion directe et aussi large que la réponse');
    check(await p.evaluate((raw) => !Object.values(localStorage).some((v) => v.includes(raw)), answer), 'résultat Web non enregistré dans le stockage local');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'aucun débordement horizontal mobile');
    await webBox(p).uncheck(); await send(p, 'Maintenant un autre sujet.'); await idle(p);
    check(!state.normalPrompts.at(-1).includes(answer) && state.normalPrompts.at(-1).includes('Une réponse Web a été affichée séparément'), 'résultat Google non réinjecté dans le modèle musical au tour suivant');
    await p.getByRole('button', { name: 'Nouvelle conversation' }).click();
    check(await p.locator('.sb-google-result').count() === 0 && state.writes.length === 0 && errors.length === 0, 'nouvelle conversation efface le résultat, sans écriture YouTube ni erreur JavaScript');
    await ctx.close();
  }
  for (const mode of ['no-suggestions', 'no-grounding', 'unsafe-source', 'denied', 'quota']) {
    const { p, ctx, state } = await setup({ state: { mode } }); await webBox(p).check(); await send(p, 'Question de test.'); await idle(p);
    check(await p.locator('.sb-google-result').count() === 0 && !(await p.locator('.sb-chat').innerText()).includes(answer)
      && /recherche|source|quota/i.test(await p.locator('.sb-chat').innerText()), `échec ${mode} annoncé sans afficher de réponse non vérifiable`);
    if (mode === 'quota' || mode === 'denied') check(state.webRequests.length === 1, `pas de seconde requête facturable après ${mode}`);
    await ctx.close();
  }
  {
    const unsafe = [
      '<img src=x onerror="window.__xss=1"><a href="https://www.google.com/search?q=x">x</a>',
      '<svg onload="window.__xss=1"></svg><a href="https://www.google.com/search?q=x">x</a>',
      '<a href="javascript:alert(1)">x</a>',
      '<a href="https://google.com.evil.test/search?q=x">x</a>',
      '<style>.container{background:url(https://evil.test/x)}</style><a href="https://www.google.com/search?q=x">x</a>',
      '<style>@import "https://evil.test/x";</style><a href="https://www.google.com/search?q=x">x</a>',
      '<style>.container{background-image:image-set("https://evil.test/x" 1x)}</style><a href="https://www.google.com/search?q=x">x</a>',
      '<svg><circle fill="url(https://evil.test/x)"/></svg><a href="https://www.google.com/search?q=x">x</a>',
    ];
    const { p, ctx, state } = await setup({ state: { mode: 'unsafe-html' } }); await webBox(p).check();
    for (const bad of unsafe) {
      state.badHtml = bad; await send(p, 'Test de fragment non sûr.'); await idle(p);
      check(await p.locator('.sb-google-result').count() === 0 && !(await p.evaluate(() => window.__xss)), 'fragment Google non sûr refusé sans exécution');
      await p.getByRole('button', { name: 'Nouvelle conversation' }).click();
    }
    await ctx.close();
  }
  {
    const { p, ctx, state } = await setup({ state: { mode: 'unsupported-first' } }); await webBox(p).check(); await send(p, 'Recherche avec modèle de secours.');
    await p.locator('.sb-google-result').waitFor({ timeout: 20000 });
    check(state.webRequests.length === 2 && state.webRequests[0].url.includes('gemini-3.0-pro') && state.webRequests[1].url.includes('gemini-2.5-flash'), 'repli limité à un second modèle annoncé après incompatibilité'); await ctx.close();
  }
  {
    let release; const gate = new Promise((resolve) => { release = resolve; });
    const { p, ctx, state } = await setup({ state: { webGate: gate } }); await webBox(p).check(); await send(p, 'Donnée privée du compte A.');
    await until(() => state.webRequests.length === 1);
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('sb:auth-changing'))); release(); await p.waitForTimeout(300);
    check(await p.locator('.sb-google-result').count() === 0 && !(await p.locator('.sb-chat').innerText()).includes('Donnée privée du compte A'), 'changement de compte efface la conversation et ignore la réponse Web tardive');
    check(!(await webBox(p).isChecked()) && await p.locator('#sb-assistant-input').inputValue() === '', 'options et saisie sensibles réinitialisées lors du changement de compte');
    await send(p, 'Compte B.'); await idle(p);
    check(!state.normalPrompts.at(-1).includes('Donnée privée du compte A') && !state.normalPrompts.at(-1).includes(answer), 'aucun contexte du compte précédent renvoyé au modèle suivant'); await ctx.close();
  }
  {
    const { p, ctx, state } = await setup(); await webBox(p).check(); await p.getByRole('button', { name: 'Live', exact:true }).click(); await p.getByRole('button', { name: 'Démarrer le vocal' }).click();
    await p.getByText(/Micro ouvert ·/).first().waitFor({ timeout: 20000 });
    const setupMsg = state.voice.find((m) => m.setup)?.setup;
    check(setupMsg.tools.flatMap((t) => (t.functionDeclarations || []).map((f) => f.name)).includes('rechercher_web'), 'outil de recherche Web déclaré uniquement si activé avant le vocal');
    state.sockets[0].send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'web-1', name: 'rechercher_web', args: { requete: 'Question vocale simulée' } }] } }));
    await p.locator('.sb-google-result').waitFor({ state:'attached', timeout: 20000 });
    await until(() => state.voice.some((m) => m.toolResponse?.functionResponses?.some((f) => f.id === 'web-1')));
    const response = state.voice.flatMap((m) => m.toolResponse?.functionResponses || []).find((f) => f.id === 'web-1').response;
    check(response.statut.includes('affichés') && !JSON.stringify(response).includes(answer) && state.webRequests.length === 1, 'en vocal, sources affichées et outil ne prétend pas transmettre ou lire leur contenu');
    await p.getByRole('button', { name: 'Terminer', exact: true }).click(); await ctx.close();
  }
  console.log(`\n${checks}/${checks} contrôles Web réussis (services Google simulés).`);
} finally { await browser.close(); }
