/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-redesign-v10/',import.meta.url),{recursive:true});
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; console.log(`  ✓ ${label}`); };
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
  await ctx.addInitScript(()=>{
    const tracks=['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc'].map((videoId,i)=>({id:'v10-track-'+i,videoId,title:['FLY','LOAT','Stayin Alive'][i],artist:['Jeremiah','JOYCA','Bee Gees'][i],durationSeconds:210,durationFormatted:'3:30',thumbnailUrl:'https://i.ytimg.com/vi/'+videoId+'/mqdefault.jpg'}));
    const blend={id:'blend-v10',title:'Jazz au présent',description:'Un blend existant',tracks,seedTracks:tracks,createdAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),updatedAt:100,instruction:'Jazz doux',exportedPlaylistId:'EXPORT-UNCHANGED',exportedUrl:'https://www.youtube.com/playlist?list=EXPORT-UNCHANGED',exportedMeta:{sig:'old-export-sig',title:'Jazz au présent',privacy:'private',at:new Date().toISOString()}};
    localStorage.setItem('soundblend_account_v1:voice-account:soundblend_recent_blends',JSON.stringify([blend,...Array.from({length:5},(_,i)=>({...blend,id:'other-'+i,title:'Nuance '+i,exportedPlaylistId:undefined,exportedMeta:undefined}))]));
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const answer=(action='blend')=>({reply:'Voici une proposition à vérifier.',title:'Cocktail électrique & soul',action,source:{type:'blend',id:'blend-v10'},extraSources:[],instruction:'Une sélection libre et cohérente.',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],researchQuery:'',playlistEdits:null,blendEdits:action==='blend_edit'?{mode:'tracks',title:'Jazz ajusté',removeTrackIds:['v10-track-1'],moves:[{trackId:'v10-track-2',position:0}],additions:[]}:undefined});
const send=async(p)=>{
 await p.locator('#sb-assistant-input').fill('Crée un nouveau blend carte blanche');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();
 await p.waitForFunction(()=>window.__streamRequests?.length===1);
 await p.evaluate(value=>window.__pushStream('data: '+JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]},finishReason:'STOP'}]})+'\n\n'),answer());
 await p.locator('.sb-chat-thinking').waitFor({state:'detached'});
};
try {
 const {p,ctx}=await setup({stream:true});await send(p);await p.locator('.sa-adjust > summary').click();await p.getByRole('button',{name:'Choisir les sources musicales'}).click();
 check(await p.getByRole('button',{name:'Fermer les sources musicales'}).evaluate(e=>e===document.activeElement),'ouverture des inspirations : focus sur Fermer, jamais sur la recherche');await p.getByRole('textbox',{name:'Rechercher une source musicale'}).click();
 check(await p.getByRole('textbox',{name:'Rechercher une source musicale'}).evaluate(e=>e===document.activeElement),'recherche focalisable à la demande');
 await p.keyboard.press('Escape');
 check(await p.getByRole('button',{name:'Choisir les sources musicales'}).evaluate(e=>e===document.activeElement),'Échap restitue le focus au bouton ouvrant');
 await p.getByRole('button',{name:'Choisir les sources musicales'}).click();
 check(await p.getByRole('button',{name:'Fermer les sources musicales'}).evaluate(e=>e===document.activeElement),'réouverture sans focaliser la recherche');
 const {default:AxeBuilder}=await import(process.env.SOUNDBLEND_AXE_MODULE);
 const ax=await new AxeBuilder({page:p}).include('.sa-source-dialog').analyze();check(ax.violations.length===0,`axe inspirations : ${JSON.stringify(ax.violations.map(v=>v.id))}`);
 await p.screenshot({path:'/home/user/v12-inspirations.png'});await ctx.close();
 console.log(`${checks} contrôles de focus réussis`);
} finally {await browser.close()}
