/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-wait-v9/',import.meta.url),{recursive:true});
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
  if(options.stream)await ctx.addInitScript(()=>{
    const original=window.fetch.bind(window);window.__streamRequests=[];window.__streamAborts=0;
    window.fetch=async(url,init={})=>{
      if(!String(url).includes(':streamGenerateContent'))return original(url,init);
      window.__streamRequests.push({url:String(url),body:JSON.parse(init.body)});
      const body=new ReadableStream({start(controller){
        window.__pushStream=value=>controller.enqueue(Array.isArray(value)?new Uint8Array(value):new TextEncoder().encode(value));window.__closeStream=()=>controller.close();
        init.signal?.addEventListener('abort',()=>{window.__streamAborts++;try{controller.error(new DOMException('Aborted','AbortError'))}catch{}},{once:true});
      }});
      return new Response(body,{status:200,headers:{'Content-Type':'text/event-stream'}});
    };
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const start = async (p) => { await p.getByRole('button', { name: 'Live', exact:true }).click(); await p.getByText(/Micro ouvert ·/).first().waitFor({ timeout: 20000 }); };
const begin=async p=>{await p.locator('#sb-assistant-input').fill('Analyse mes blends et prépare une playlist selon mes goûts.');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click()};
const reply=JSON.stringify({reply:'Voici une direction personnalisée issue de tes blends.',title:'Tes envies du moment',action:'blend',source:{type:'playlist',id:'PL-VOICE'},extraSources:[],instruction:'Selon tes goûts actuels.',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],researchQuery:'',playlistEdits:null});
const event=text=>'data: '+JSON.stringify({candidates:[{content:{parts:[{text}]}}]})+'\r\n\r\n';
const push=(p,s)=>p.evaluate(value=>window.__pushStream(value),s);
const complete=async p=>{await push(p,event(reply));await p.evaluate(()=>window.__closeStream());await p.locator('[aria-label="Proposition de blend"]').waitFor()};
try {
 {
  let release;const {p,ctx,state}=await setup({state:{waitGemini:new Promise(r=>release=r)}});
  await p.clock.install();await begin(p);await until(()=>state.generations===1);await p.clock.fastForward(110000);
  check(await p.getByRole('alert').count()===0&&await p.getByRole('button',{name:'Arrêter la réponse'}).count()===1,'au-delà de 90 secondes la demande reste active et annulable');
  release();await p.locator('[aria-label="Proposition de blend"]').waitFor();check(state.generations===1,'réponse JSON après 110 s acceptée, sans relance payante');await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup({stream:true});
  await p.evaluate(()=>localStorage.setItem('soundblend_account_v1:voice-account:soundblend_recent_blends',JSON.stringify([{id:'taste-existing',title:'Mon blend personnel',expiresAt:new Date(Date.now()+3600000).toISOString(),tracks:[],instruction:'Jazz doux'}])));
  await p.clock.install();await begin(p);await p.waitForFunction(()=>window.__streamRequests.length===1);
  check(await p.evaluate(()=>window.__streamRequests[0].url.includes('alt=sse')&&!('maxOutputTokens' in window.__streamRequests[0].body.generationConfig)),'Assistant en streaming, sans plafond local de 4096 tokens qui tronque le raisonnement');
  check(await p.evaluate(()=>window.__streamRequests[0].body.contents[0].parts[0].text.includes('Mon blend personnel')),'blends existants effectivement envoyés pour analyse');
  await push(p,'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'RAISONNEMENT INTERNE',thought:true}]}}]})+'\n\n');
  for(let i=0;i<5;i++){await p.clock.fastForward(70000);await push(p,': activité réseau\n\n');}
  check(await p.getByRole('alert').count()===0&&await p.getByRole('button',{name:'Arrêter la réponse'}).count()===1,'350 secondes avec activité : aucune limite globale de 26/90/180 secondes');
  check(await p.getByText('La préparation prend du temps. Elle continue ; tu peux l’arrêter à tout moment.',{exact:true}).count()===1,'attente longue expliquée, sans inventer un pourcentage de progression');
  await p.screenshot({path:new URL('./assistant-wait-v9/attente-longue.png',import.meta.url).pathname});
  const packet=Array.from(new TextEncoder().encode(event(reply)));for(let i=0;i<packet.length;i+=7)await push(p,packet.slice(i,i+7));await p.evaluate(()=>window.__closeStream());
  await p.locator('[aria-label="Proposition de blend"]').waitFor();
  check(await p.getByText('Voici une direction personnalisée issue de tes blends.',{exact:true}).count()===1,'fragments SSE découpés et CRLF réassemblés en un JSON exploitable');
  check(await p.getByText('RAISONNEMENT INTERNE',{exact:false}).count()===0,'raisonnement interne exclu du texte de réponse et du JSON');
  check(await p.evaluate(()=>window.__streamRequests.length===1)&&state.writes.length===0&&errors.length===0,'une requête, aucun rejet, aucune action automatique');
  await p.screenshot({path:new URL('./assistant-wait-v9/reponse-longue.png',import.meta.url).pathname});await ctx.close();
 }
 {
  const {p,ctx}=await setup({stream:true});await p.clock.install();await begin(p);await p.waitForFunction(()=>window.__streamRequests.length===1);
  await p.clock.fastForward(170000);await push(p,': encore connecté\n\n');await p.clock.fastForward(170000);
  check(await p.getByRole('alert').count()===0,'délai réseau remis à zéro par les données, pas calculé depuis le début');
  await p.clock.fastForward(11000);await p.getByRole('alert').waitFor();
  check((await p.getByRole('alert').innerText()).includes('aucune donnée pendant 3 minutes'),'connexion vraiment inactive : message spécifique au réseau, pas ancien délai global');
  check(await p.evaluate(()=>window.__streamAborts===1),'connexion inactive fermée, pas de fuite de lecteur');await ctx.close();
 }
 for(const cancel of ['button','auth']){
  const {p,ctx}=await setup({stream:true});await p.clock.install();await begin(p);await p.waitForFunction(()=>window.__streamRequests.length===1);await p.clock.fastForward(95000);
  if(cancel==='button')await p.getByRole('button',{name:'Arrêter la réponse'}).click();else await p.evaluate(()=>window.dispatchEvent(new Event('sb:auth-changing')));
  check(await p.evaluate(()=>window.__streamAborts===1),`${cancel} : annulation réelle du fetch et du flux après attente longue`);
  check(await p.locator('[aria-label="Proposition de blend"]').count()===0&&await p.getByRole('alert').count()===0,`${cancel} : ni réponse tardive ni fausse erreur de délai`);await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({stream:true});await start(p);
  state.sockets[0].send(JSON.stringify({toolCall:{functionCalls:[{id:'long-voice',name:'proposer_action_musicale',args:{demande:'Analyse mes blends et prépare une playlist.'}}]}}));await p.waitForFunction(()=>window.__streamRequests.length===1);
  await p.clock.install();await p.getByRole('button',{name:'Terminer',exact:true}).click();
  for(let i=0;i<4;i++){await p.clock.fastForward(70000);await push(p,': préparation active\n\n');}
  check(await p.getByRole('alert').count()===0&&await p.evaluate(()=>!window.__voiceStream.active),'fermeture du Live : la préparation de 280 secondes continue, micro fermé');
  await complete(p);check(await p.evaluate(()=>!localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_voice_pending_v1')),'préparation vocale longue terminée : aperçu affiché et journal effacé');await ctx.close();
 }
 console.log(`${checks} contrôles V9 réussis`);
} finally {await browser.close()}
