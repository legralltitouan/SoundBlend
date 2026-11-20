/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-navigation-v11-1/',import.meta.url),{recursive:true});
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
    const blend={id:'blend-v10',title:'Jazz au présent',description:'Un blend existant',tracks,seedTracks:tracks,createdAt:'2026-11-01T12:00:00.000Z',expiresAt:'2099-11-01T12:00:00.000Z',updatedAt:100,instruction:'Jazz doux',exportedPlaylistId:'EXPORT-UNCHANGED',exportedUrl:'https://www.youtube.com/playlist?list=EXPORT-UNCHANGED',exportedMeta:{sig:'old-export-sig',title:'Jazz au présent',privacy:'private',at:'2026-11-01T12:00:00.000Z'}};
    localStorage.setItem('soundblend_account_v1:voice-account:soundblend_recent_blends',JSON.stringify([blend,...Array.from({length:5},(_,i)=>({...blend,id:'other-'+i,title:'Nuance '+i,exportedPlaylistId:undefined,exportedMeta:undefined}))]));
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const answer=(action='blend')=>({reply:'Voici une proposition à vérifier.',title:'Cocktail électrique & soul',action,source:{type:'blend',id:'blend-v10'},extraSources:[],instruction:'Une sélection libre et cohérente.',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],researchQuery:'',playlistEdits:null,blendEdits:action==='blend_edit'?{mode:'tracks',title:'Jazz ajusté',removeTrackIds:['v10-track-1'],moves:[{trackId:'v10-track-2',position:0}],additions:[]}:undefined});
const leave=async(p,where)=>{if(where==='Réglages')await p.getByRole('button',{name:'Réglages du compte'}).last().click();else await p.locator(`.ytm-mobile-bar [aria-label="${where}"]`).click();await p.waitForTimeout(100)};
const back=async p=>{await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.locator('#sb-assistant-input').waitFor()};
const start=async(p,text='Analyse mes goûts pendant la navigation')=>{const count=await p.evaluate(()=>window.__streamRequests?.length || 0);await p.locator('#sb-assistant-input').fill(text);await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.waitForFunction(n=>window.__streamRequests?.length===n+1,count)};
const event=async(p,value)=>p.evaluate(v=>window.__pushStream('data: '+JSON.stringify(v)+'\n\n'),value);
const finish=async(p,reply,reason='STOP')=>event(p,{candidates:[{content:{parts:[{text:JSON.stringify(reply)}]},...(reason?{finishReason:reason}:{})}]});
const saved=async p=>p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_history_v1') || '[]'));
try {
 for(const terminal of ['STOP','DONE','EOF']){
  const {p,ctx,errors,state}=await setup({stream:true});await start(p);
  await event(p,{candidates:[{content:{parts:[{text:'Une pensée interne qui ne doit pas apparaître.',thought:true}]}}]});
  for(const dest of ['Bibliothèque','Blends','Réglages','Bibliothèque','Réglages']){
    await leave(p,dest);await back(p);await p.getByRole('button',{name:'Arrêter la réponse'}).waitFor();
    check(await p.evaluate(()=>window.__streamAborts===0),`${terminal} : flux conservé via ${dest}`);
  }
  if(terminal==='STOP')await p.waitForTimeout(350);
  if(terminal==='STOP')await p.screenshot({path:new URL('./assistant-navigation-v11-1/retour-pendant-reponse.png',import.meta.url).pathname});
  const text=JSON.stringify(answer('none')),cut=Math.floor(text.length/2);
  await event(p,{candidates:[{content:{parts:[{text:text.slice(0,cut)}]}}]});
  check(await p.locator('.sb-chat-thinking').isVisible(),'JSON partiel : attente réelle conservée, pas de réponse prématurée');
  await event(p,{candidates:[{content:{parts:[{text:text.slice(cut)}]},...(terminal==='STOP'?{finishReason:'STOP'}:{})}]});
  if(terminal==='DONE')await p.evaluate(()=>window.__pushStream('data: [DONE]\n\n'));
  if(terminal==='EOF')await p.evaluate(()=>window.__closeStream());
  await p.getByText('Voici une proposition à vérifier.',{exact:true}).waitFor({timeout:5000});
  check(await p.locator('.sb-chat-thinking').count()===0,`${terminal} : réponse complète affichée, indicateur retiré sans attendre une connexion laissée ouverte`);
  check((await saved(p))[0].run.status==='done'&&(await saved(p))[0].messages.length===2,`${terminal} : statut terminé et une seule réponse sauvegardés`);
  check(await p.evaluate(()=>window.__streamRequests.length===1)&&state.writes.length===0,`${terminal} : aucune relance Gemini ni mutation musicale automatique`);
  check(await p.getByText('Une pensée interne qui ne doit pas apparaître.',{exact:true}).count()===0&&errors.length===0,`${terminal} : pensée interne ignorée, aucune exception`);
  await ctx.close();
 }
 {
  const {p,ctx}=await setup({stream:true});await start(p);await leave(p,'Réglages');await finish(p,answer('blend'));
  await p.waitForFunction(()=>JSON.parse(localStorage.getItem('soundblend_account_v1:voice-account:soundblend_assistant_history_v1'))?.[0]?.run.status==='done');
  check(await p.locator('.sb-assistant-studio').count()===0,'réponse traitée et enregistrée alors que le chatbot est démonté');
  await back(p);await p.getByRole('region',{name:'Proposition de blend',exact:true}).waitFor();
  check(await p.locator('.sb-chat-thinking').count()===0&&await p.evaluate(()=>window.__streamRequests.length===1),'aperçu terminé hors de la vue restauré sans nouveau calcul');await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(400);await p.screenshot({path:new URL('./assistant-navigation-v11-1/retour-apres-reponse.png',import.meta.url).pathname});await ctx.close();
 }
 {
  const {p,ctx}=await setup({stream:true});await start(p);await leave(p,'Blends');await back(p);await p.getByRole('button',{name:'Arrêter la réponse'}).waitFor();
  await event(p,{error:{code:429,message:'Quota de test dépassé'}});
  await p.locator('.sb-chat-thinking').waitFor({state:'detached'});check((await saved(p))[0].run.status==='error','erreur fournisseur après navigation : état terminal, jamais un spinner infini');
  check(await p.getByRole('button',{name:'Envoyer à l’assistant'}).count()===1,'composeur utilisable après une erreur distante');await ctx.close();
 }
 if(new URL(base).port==='5173'){
  for(const how of ['abort','remove']){
   const {p,ctx}=await setup({stream:true});await start(p);await leave(p,'Bibliothèque');await back(p);await p.getByRole('button',{name:'Arrêter la réponse'}).waitFor();
   await p.evaluate(async how=>{const t=await import('/src/services/assistantVoiceTask.ts');const task=t.getVoicePreparation();if(how==='abort')task.controller.abort();else t.cancelVoicePreparation(task.conversationId)},how);
   await p.locator('.sb-chat-thinking').waitFor({state:'detached',timeout:3000});
   check((await saved(p))[0].run.status==='cancelled',`${how} : interruption externe notifiée et sauvegardée, aucune tâche fantôme`);
   await start(p,'Nouvelle demande après interruption');await finish(p,{...answer('none'),reply:'La nouvelle demande aboutit.'});await p.getByText('La nouvelle demande aboutit.',{exact:true}).waitFor();
   check(await p.locator('.sb-chat-thinking').count()===0,`${how} : une nouvelle demande aboutit après interruption`);await ctx.close();
  }
 }
 console.log(`\n${checks} contrôles de navigation SSE réussis. Vrai service Gemini/parseur de l’app, flux réseau simulé.`);
} finally {await browser.close()}
