/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-continuation-v11/',import.meta.url),{recursive:true});
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; console.log(`  ✓ ${label}`); };
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Attente du scénario vocal dépassée'); };
async function setup(options = {}) {
  const state = { received: [], sockets: [], writes: [], wiki: [], modelHeaders: [], ...options.state };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(({ auth, deny, key }) => {
    localStorage.setItem('soundblend_onboarded', '1');
    const prefix = auth ? 'soundblend_account_v1:voice-account:' : '';
    localStorage.setItem(prefix + 'soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: key }));
    if (auth) sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'fake', owner: 'voice-account', expiresAt: Date.now() + 3600000, profile: { name: 'Test vocal', email: '', avatarUrl: '' } }));
    const native = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (native) navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__micRequests = (window.__micRequests || 0) + 1;
      if (deny) throw new DOMException('Permission denied', 'NotAllowedError');
      const stream = await native(...args); window.__voiceStream = stream; return stream;
    };
    const WS = window.WebSocket;
    window.WebSocket = class extends WS { constructor(...args) { super(...args); window.__voiceSocket = this; } };
    if (window.AudioBufferSourceNode) {
      const oldStart = AudioBufferSourceNode.prototype.start, oldStop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function(...args) { if(this.buffer?.length>1) window.__voicePlays = (window.__voicePlays || 0) + 1; return oldStart.apply(this, args); };
      AudioBufferSourceNode.prototype.stop = function(...args) { if(this.buffer?.length>1) window.__voiceStops = (window.__voiceStops || 0) + 1; return oldStop.apply(this, args); };
    }
  }, { auth: options.auth !== false, deny: !!options.deny, key: options.key === undefined ? 'test-key' : options.key });
  await ctx.routeWebSocket(/wss:\/\/generativelanguage\.googleapis\.com\/.*/, (ws) => {
    state.sockets.push(ws);
    ws.onClose(() => { state.socketClosed = true; void ws.close().catch(() => {}); });
    ws.onMessage((message) => {
      const parsed = JSON.parse(String(message)); state.received.push(parsed);
      if (parsed.setup && !options.noSetup) ws.send(JSON.stringify({ setupComplete: {} }));
    });
  });
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
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ query: { pages: { 1: { pageid: 1, index: 1, title: 'Daft Punk', extract: 'Daft Punk est un duo français.' } } } }) });
  });
  await ctx.route('https://www.googleapis.com/youtube/v3/**', (r) => {
    const u = new URL(r.request().url()), method = r.request().method();
    if (method === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    if (method !== 'GET') state.writes.push({ method, path: u.pathname });
    if (u.pathname.endsWith('/playlists')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'PL-VOICE', snippet: { title: 'Vocal Chill', thumbnails: {} }, contentDetails: { itemCount: 1 } }] }) });
    if (u.pathname.endsWith('/playlistItems')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'item-v', snippet: { title: 'Musique', videoOwnerChannelTitle: 'Alpha - Topic', resourceId: { videoId: 'aaaaaaaaaaa' }, thumbnails: {} }, contentDetails: { videoId: 'aaaaaaaaaaa' } }] }) });
    if (u.pathname.endsWith('/search')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: { videoId: 'bbbbbbbbbbb' }, snippet: { title: 'Artist - Song', channelTitle: 'Artist - Topic', thumbnails: {} } }] }) });
    return r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' });
  });
  await ctx.route('https://generativelanguage.googleapis.com/**', async (r) => {
    if (r.request().url().includes('/models?')) {
      state.modelHeaders.push(r.request().headers());
      const models = [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 }];
      if (!options.noLiveModel) models.push({ name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] });
      if (options.extendedOnly) models.push({ name: 'models/gemini-3.8-live-extended-thinking', supportedGenerationMethods: ['bidiGenerateContent'] });
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ models }) });
    }
    state.generations=(state.generations||0)+1;
    if (state.waitGemini) await state.waitGemini;
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Je prépare un blend à partir de Vocal Chill.', action: 'blend', source: { type: 'playlist', id: 'PL-VOICE' }, extraSources: [], instruction: 'Plus jazz', durationMinutes: 45, catalogQueries: [], catalogVideoIds: [], researchQuery: '', playlistEdits: null }) }] } }] }) }).catch(() => {});
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const start = async (p) => { await p.getByRole('button', { name: 'Live', exact:true }).click(); await p.getByText(/Micro ouvert ·/).first().waitFor({ timeout: 20000 }); };
try {
 for (const exit of ['button','hidden']) {
  let release;const waitGemini=new Promise(r=>release=r);
  const {p,ctx,state,errors}=await setup({state:{waitGemini}});await start(p);
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'continue-1',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await p.getByText(/Demande vocale à préparer/).waitFor({state:'attached'});
  if(exit==='button')await p.getByRole('button',{name:'Terminer',exact:true}).click();
  else await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  check(await p.evaluate(()=>!window.__voiceStream.active),`${exit} : le microphone est fermé immédiatement`);
  release();await p.locator('[aria-label="Proposition de blend"]').waitFor({timeout:12000});
  check(await p.locator('[aria-label="Proposition de blend"]').isVisible(),`${exit} : raisonnement démarré dans Live achevé dans le chat`);
  check(state.writes.length===0,`${exit} : aucune mutation automatique`);check(errors.length===0,`${exit} : aucun rejet`);await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup();await start(p);
  const ws=state.sockets[0];
  ws.send(JSON.stringify({serverContent:{inputTranscription:{text:'Prépare une playlist jazz.',finished:true}}}));
  await p.getByText('Prépare une playlist jazz.',{exact:true}).waitFor({state:'attached'});
  await p.getByRole('button',{name:'Terminer',exact:true}).click();
  check(!state.socketClosed&&await p.evaluate(()=>!window.__voiceStream.active),'sortie avant appel outil : socket conservé, micro fermé');
  const sent=state.received.filter(x=>x.realtimeInput?.audio).length,plays=await p.evaluate(()=>window.__voicePlays||0);
  ws.send(JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:Buffer.alloc(48000).toString('base64')}}]}}}));
  await p.waitForTimeout(350);
  check(state.received.filter(x=>x.realtimeInput?.audio).length===sent&&await p.evaluate(()=>window.__voicePlays||0)===plays,'conversation en finition : aucun PCM micro supplémentaire ni réponse sonore');
  ws.send(JSON.stringify({toolCall:{functionCalls:[{id:'late-tool',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await p.locator('[aria-label="Proposition de blend"]').waitFor();
  await until(()=>state.received.some(x=>x.toolResponse?.functionResponses?.some(f=>f.id==='late-tool')));
  ws.send(JSON.stringify({serverContent:{outputTranscription:{text:'Ton aperçu est prêt.',finished:true},turnComplete:true}}));
  await p.getByText('Ton aperçu est prêt.',{exact:true}).waitFor();await until(()=>state.socketClosed);
  check(state.generations===1,'outil arrivé après sortie : exactement une préparation Gemini');
  check(errors.length===0&&state.writes.length===0,'fin du tour : socket fermé sans rejet ni écriture automatique');
  await p.screenshot({path:new URL('./assistant-continuation-v11/apercu-apres-live.png',import.meta.url).pathname});await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();await start(p);await until(()=>state.received.some(x=>x.realtimeInput?.audio));
  await p.getByRole('button',{name:'Terminer',exact:true}).click();
  state.sockets[0].send(JSON.stringify({serverContent:{inputTranscription:{text:'Consigne reçue tardivement.',finished:true}},toolCall:{functionCalls:[{id:'late-asr',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await p.locator('[aria-label="Proposition de blend"]').waitFor();
  check(state.generations===1&&await p.getByText('Consigne reçue tardivement.',{exact:true}).count()===1,'dernière transcription arrivée après fermeture du Live conservée et traitée');await ctx.close();
 }
 {
  let release;const {p,ctx,state,errors}=await setup({state:{waitGemini:new Promise(r=>release=r)}});await start(p);
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'navigation',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await until(()=>state.generations===1);
  await p.locator('.ytm-mobile-bar [aria-label="Bibliothèque"]').click();
  await p.waitForTimeout(350);release();await p.waitForTimeout(600);
  await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.locator('[aria-label="Proposition de blend"]').waitFor();
  check(state.generations===1,'quitter la vue entière : la tâche continue sans seconde requête');
  check(await p.getByText('Demande vocale à préparer : Prépare un blend jazz avec Vocal Chill.',{exact:true}).count()===1,'retour Assistant : résultat et demande restaurés sans doublon');
  check(await p.evaluate(()=>!window.__voiceStream.active)&&errors.length===0,'navigation : aucun micro conservé ni rejet');await ctx.close();
 }
 {
  let release;const {p,ctx,state,errors}=await setup({state:{waitGemini:new Promise(r=>release=r)}});await start(p);
  state.sockets[0].send(JSON.stringify({serverContent:{inputTranscription:{text:'Demande avant navigation.',finished:true}}}));await p.getByText('Demande avant navigation.',{exact:true}).waitFor({state:'attached'});
  await p.locator('.ytm-mobile-bar [aria-label="Bibliothèque"]').click();await p.waitForTimeout(300);
  check(!state.socketClosed&&await p.evaluate(()=>!window.__voiceStream.active),'navigation avant outil : micro coupé mais tour en attente préservé');
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'tool-away',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));await until(()=>state.generations===1);
  await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.getByRole('button',{name:'Arrêter la réponse'}).waitFor();
  check((await p.locator('.sa-thinking .sr-only').innerText()).length>0,'retour avant résultat : progression et bouton d’annulation restaurés');
  release();await p.locator('[aria-label="Proposition de blend"]').waitFor();
  check(state.generations===1&&errors.length===0,'outil reçu après démontage : résultat restauré, un seul appel Gemini');
  check(await p.getByText('Demande vocale à préparer : Prépare un blend jazz avec Vocal Chill.',{exact:true}).count()===1,'requête courante incluse dans le contexte même lorsque la vue était démontée');await ctx.close();
 }
 for(const cancel of ['auth','button']) {
  let release;const {p,ctx,state}=await setup({state:{waitGemini:new Promise(r=>release=r)}});await start(p);
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'cancel',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await until(()=>state.generations===1);await p.getByRole('button',{name:'Terminer',exact:true}).click();
  check(await p.evaluate(()=>!!localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1')),`${cancel} : consigne en cours journalisée dans le bon compte`);
  if(cancel==='auth')await p.evaluate(()=>window.dispatchEvent(new Event('sb:auth-changing')));
  else await p.getByRole('button',{name:'Arrêter la réponse'}).click();
  release();await p.waitForTimeout(600);
  check(await p.locator('[aria-label="Proposition de blend"]').count()===0,`${cancel} : annulation explicite empêche un résultat tardif`);
  check(await p.evaluate(()=>!localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1')),`${cancel} : journal supprimé`);await ctx.close();
 }
 {
  let release;const {p,ctx,state,errors}=await setup({state:{waitGemini:new Promise(r=>release=r)}});await start(p);
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'reload',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await until(()=>state.generations===1);await p.reload();release();
  await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.getByRole('button',{name:/^(?:Relancer la demande ici|Reprendre la demande vocale)$/}).waitFor();
  check(state.generations===1,'rechargement : aucun renvoi Gemini automatique');
  const journal=await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1')));
  check(Object.keys(journal).sort().join(',')==='at,query','journal minimal : ni clé, ni audio, ni historique de conversation');
  await p.getByRole('button',{name:/^(?:Relancer la demande ici|Reprendre la demande vocale)$/}).click();await p.locator('[aria-label="Proposition de blend"]').waitFor();
  check(state.generations===2&&state.writes.length===0,'réouverture : reprise explicite en lecture seule, aucun doublon de mutation');
  check(await p.evaluate(()=>!localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1')),'réussite après reprise : journal effacé');
  check(errors.length===0,'reprise après rechargement : aucun rejet');await ctx.close();
 }
 {
  const {p,ctx}=await setup();
  await p.evaluate(()=>{localStorage.setItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1',JSON.stringify({query:'Périmée',at:Date.now()-31*60*1000}));localStorage.setItem('soundblend_assistant_voice_pending_v1',JSON.stringify({query:'Consigne autre espace',at:Date.now()}))});
  await p.reload();await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.locator('.sa-welcome').waitFor();
  check(await p.getByRole('button',{name:/^(?:Relancer la demande ici|Reprendre la demande vocale)$/}).count()===0,'journal expiré ou hors compte : jamais présenté à la mauvaise personne');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();await start(p);
  await p.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('assistant_voice_pending'))throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v)}});
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'no-storage',name:'proposer_action_musicale',args:{demande:'Prépare un blend jazz avec Vocal Chill.'}}]}}));
  await p.locator('[aria-label="Proposition de blend"]').waitFor({state:'attached'});
  check(state.generations===1,'stockage indisponible : préparation en mémoire fonctionnelle sans fausse garantie de reprise');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();await start(p);
  state.sockets[0].send(JSON.stringify({serverContent:{inputTranscription:{text:'Demande sans réponse.',finished:true}}}));await p.getByText('Demande sans réponse.',{exact:true}).waitFor({state:'attached'});
  await p.clock.install();await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.clock.fastForward(3100);await p.clock.fastForward(88000);
  await p.getByRole('alert').waitFor();await until(()=>state.socketClosed);
  check(await p.evaluate(()=>!window.__voiceStream.active)&&!(state.generations),'tour Live muet : attente bornée, transcription conservée sans lancement inventé');await ctx.close();
 }
 const {default:AxeBuilder}=await import(process.env.SOUNDBLEND_AXE_MODULE||'@axe-core/playwright');
 for(const theme of ['light','dark']) {
  const {p,ctx}=await setup();await p.emulateMedia({reducedMotion:'reduce'});
  await p.evaluate(theme=>{localStorage.setItem('soundblend_account_v1:voice-account:soundblend_mode',theme);localStorage.setItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1',JSON.stringify({query:'Prépare un blend jazz avec Vocal Chill.',at:Date.now()}))},theme);
  await p.reload();await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.getByRole('button',{name:/^(?:Relancer la demande ici|Reprendre la demande vocale)$/}).waitFor();
  check(await p.locator('html').getAttribute('data-mode')===theme,`reprise : vrai thème ${theme} appliqué`);
  const ax=await new AxeBuilder({page:p}).include('.sb-assistant-notice').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  check(ax.violations.length===0,`audit axe reprise ${theme} : ${JSON.stringify(ax.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})))}`);
  await p.screenshot({path:new URL(`./assistant-continuation-v11/reprise-${theme}.png`,import.meta.url).pathname});await ctx.close();
 }
 console.log(`${checks} contrôles V8 réussis, dont 2 audits axe`);
} finally {await browser.close()}
