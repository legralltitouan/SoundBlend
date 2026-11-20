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
    const blend={id:'blend-v10',title:'Jazz au présent',description:'Un blend existant',tracks,seedTracks:tracks,createdAt:'2026-11-01T12:00:00.000Z',expiresAt:'2099-11-01T12:00:00.000Z',updatedAt:100,instruction:'Jazz doux',exportedPlaylistId:'EXPORT-UNCHANGED',exportedUrl:'https://www.youtube.com/playlist?list=EXPORT-UNCHANGED',exportedMeta:{sig:'old-export-sig',title:'Jazz au présent',privacy:'private',at:'2026-11-01T12:00:00.000Z'}};
    localStorage.setItem('soundblend_account_v1:voice-account:soundblend_recent_blends',JSON.stringify([blend,...Array.from({length:5},(_,i)=>({...blend,id:'other-'+i,title:'Nuance '+i,exportedPlaylistId:undefined,exportedMeta:undefined}))]));
  });
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const answer=(action='blend')=>({reply:'Voici une proposition à vérifier.',title:'Cocktail électrique & soul',action,source:{type:'blend',id:'blend-v10'},extraSources:[],instruction:'Une sélection libre et cohérente.',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],researchQuery:'',playlistEdits:null,blendEdits:action==='blend_edit'?{mode:'tracks',title:'Jazz ajusté',removeTrackIds:['v10-track-1'],moves:[{trackId:'v10-track-2',position:0}],additions:[]}:undefined});
const mock=async(p,value)=>{await p.evaluate(async value=>{window.__answer=value;const {geminiService}=await import('/src/services/gemini.ts');geminiService.converse=async(...args)=>{window.__lastOptions=args[4];if(window.__hold)await new Promise(resolve=>window.__finish=resolve);return window.__answer};},value)};
const send=async(p,text='Crée un nouveau blend carte blanche')=>{await p.locator('#sb-assistant-input').fill(text);await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor({state:'detached'})};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await pause(50)}throw new Error('Délai test historique');};
const rows=p=>p.evaluate(async()=>{const h=await import('/src/services/assistantHistory.ts');return h.getAssistantConversations()});
const navOut=async p=>{await p.getByRole('button',{name:'Réglages du compte'}).last().click();await p.waitForTimeout(220)};
const navBack=async p=>{await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.locator('#sb-assistant-input').waitFor()};
const openHistory=async p=>{await p.getByRole('button',{name:'Nouvelle conversation',exact:true}).click();await p.getByRole('dialog',{name:'Tes discussions',exact:true}).waitFor()};
const newChat=async p=>{await openHistory(p);await p.getByRole('button',{name:'Nouvelle discussion',exact:true}).click();await p.locator('.sa-welcome').waitFor()};
const sync=p=>p.evaluate(async()=>{const d=await import('/src/services/drive.ts');return d.demarrerSync()});
const shared=()=>({data:{schema:2,blends:[],exclusions:[],decouvertes:[],suppressionsBlends:{}},writes:[],queries:[],fail:false});
async function drive(ctx,cloud){await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
 const u=new URL(r.request().url()),method=r.request().method();
 if(method==='OPTIONS')return r.fulfill({headers:cors,body:''});
 if(cloud.fail)return r.fulfill({status:503,headers:cors,body:'offline'});
 if(method==='PATCH'){cloud.data=JSON.parse(r.request().postData());cloud.writes.push(structuredClone(cloud.data));return r.fulfill({headers:cors,body:'{"id":"f1"}'})}
 if(u.searchParams.get('alt')==='media')return r.fulfill({headers:cors,body:JSON.stringify(cloud.data)});
 cloud.queries.push(u.href);return r.fulfill({headers:cors,body:'{"files":[{"id":"f1","name":"soundblend.json"}]}'});
})}
try {
 {
  const {p,ctx,errors,state}=await setup();await mock(p,answer('none'));await send(p,'Ma discussion doit rester après les réglages');
  await p.locator('#sb-assistant-input').fill('Un brouillon conservé');await navOut(p);await navBack(p);
  check(await p.getByText('Ma discussion doit rester après les réglages',{exact:true}).count()===1,'messages conservés après navigation vers Réglages');
  check(await p.locator('#sb-assistant-input').inputValue()==='Un brouillon conservé','brouillon conservé pendant la navigation');
  await p.reload();await navBack(p);
  check(await p.getByText('Ma discussion doit rester après les réglages',{exact:true}).count()===1,'messages restaurés après rechargement complet');
  check(await p.locator('#sb-assistant-input').inputValue()==='Un brouillon conservé','brouillon restauré après rechargement');
  check(state.writes.length===0&&errors.length===0,'restaurer une discussion ne déclenche aucune écriture YouTube ni erreur');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));await p.evaluate(()=>window.__hold=true);
  await p.locator('#sb-assistant-input').fill('Travail long A');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor();
  await navOut(p);await navBack(p);await p.locator('.sb-chat-thinking').waitFor();
  check(await p.getByText('Travail long A',{exact:true}).count()===1,'demande et indicateur restaurés pendant le calcul');
  check(await p.evaluate(()=>!window.__lastOptions.signal.aborted),'navigation ne coupe pas la requête Gemini');
  await p.evaluate(()=>window.__finish());await p.locator('.sb-chat-thinking').waitFor({state:'detached'});
  check(await p.getByText('Voici une proposition à vérifier.',{exact:true}).count()===1,'résultat de la même requête affiché au retour, sans duplication');
  check((await rows(p))[0].run.status==='done','résultat et statut final enregistrés sans dépendre de la vue');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await p.evaluate(async()=>{const {geminiService}=await import('/src/services/gemini.ts');window.__pending={};geminiService.converse=async msgs=>{const name=msgs.at(-1).text;return new Promise(resolve=>window.__pending[name]=()=>resolve({reply:'Réponse '+name,action:'none',source:null,extraSources:[],instruction:'',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],researchQuery:'',playlistEdits:null}))}});
  await p.locator('#sb-assistant-input').fill('Calcul A');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor();
  await newChat(p);check(await p.locator('.sb-chat-message').count()===0,'nouvelle discussion possible pendant le calcul précédent');
  await p.locator('#sb-assistant-input').fill('Calcul B');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor();
  await p.evaluate(()=>window.__pending['Calcul A']());await pause(200);
  check(await p.getByText('Réponse Calcul A',{exact:true}).count()===0,'résultat A ne contamine pas la discussion B');
  await p.evaluate(()=>window.__pending['Calcul B']());await p.locator('.sb-chat-thinking').waitFor({state:'detached'});
  check(await p.getByText('Réponse Calcul B',{exact:true}).count()===1,'plusieurs tâches indépendantes, résultat B dans B');
  await openHistory(p);await p.locator('.sa-history-list button').filter({hasText:'Calcul A'}).click();
  check(await p.getByText('Réponse Calcul A',{exact:true}).count()===1,'historique retrouve A achevée en arrière-plan');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));
  for(let i=1;i<=4;i++){if(i>1)await newChat(p);await send(p,'Discussion '+i)}
  const data=await rows(p);check(data.length===3&&!data.some(c=>c.messages.some(m=>m.text==='Discussion 1')),'les trois dernières discussions seulement sont retenues');
  await openHistory(p);check(await p.locator('.sa-history-list li').count()===3,'historique affiche exactement les trois discussions');
  await p.locator('.sa-history-list button').filter({hasText:'Discussion 2'}).click();
  check(await p.getByText('Discussion 2',{exact:true}).count()===1&&await p.getByText('Discussion 4',{exact:true}).count()===0,'sélection historique restaure une discussion sans mélanger les messages');
  await navOut(p);await navBack(p);check(await p.getByText('Discussion 2',{exact:true}).count()===1,'sélection active conservée après navigation');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));await send(p,'Discussion privée A');
  const result=await p.evaluate(async()=>{const a=await import('/src/services/accountScope.ts');const h=await import('/src/services/assistantHistory.ts');const owner=a.accountScope();a.selectAccountScope('second-account');const empty=h.getAssistantConversations().length;a.selectAccountScope(owner);return {empty,restored:h.getAssistantConversations()[0].messages.some(m=>m.text==='Discussion privée A')}});
  check(result.empty===0&&result.restored,'historiques isolés par compte, retour au compte original conservé');
  const safe=await p.evaluate(async()=>{const h=await import('/src/services/assistantHistory.ts');const c=h.getAssistantConversations()[0];const copy=structuredClone(c);delete copy._pending;copy.messages[0].apiKey='secret';const snapshot=h.cleanConversationSnapshot({...c.snapshot,accessToken:'secret',audio:'data:audio',plan:{action:'blend_edit'}});return {invalid:!h.validAssistantConversations([copy]),noSecret:!JSON.stringify(snapshot).includes('secret'),writePreview:snapshot.plan===null&&snapshot.needsRefresh}});
  check(safe.invalid&&safe.noSecret,'validation et sérialisation refusent les champs secrets/inconnus');check(safe.writePreview,'aucun ancien aperçu d’écriture réactivé par la désérialisation');await ctx.close();
 }
 {
  const cloud=shared(),{p,ctx}=await setup();await drive(ctx,cloud);await mock(p,answer('none'));await send(p,'Sauvegarde automatique, sans bouton');
  await until(()=>cloud.data.assistantConversations?.[0]?.run.status==='done',12000);
  check(cloud.data.assistantConversations[0].messages.length===2,'sauvegarde Drive automatique après le geste, sans bouton manuel');
  check(!JSON.stringify(cloud.data.assistantConversations).includes('test-key'),'l’historique ne copie pas la clé des réglages');await ctx.close();
 }
 {
  const cloud=shared(),A=await setup(),B=await setup();await drive(A.ctx,cloud);await drive(B.ctx,cloud);
  await mock(A.p,answer('none'));await send(A.p,'Depuis le premier appareil');check(await sync(A.p),'appareil A envoie vers Drive simulé');
  check(cloud.queries.some(u=>new URL(u).searchParams.get('spaces')==='appDataFolder'),'stockage dans le dossier privé appDataFolder existant');
  check(cloud.data.assistantConversations?.length===1&&cloud.data.assistantConversations[0].messages.length===2,'fichier privé contient les messages et leur identité stable');
  check(await sync(B.p),'appareil B récupère les données du même compte');
  await B.p.getByText('Depuis le premier appareil',{exact:true}).waitFor();check(true,'restauration automatique sur un second contexte navigateur');
  await mock(B.p,answer('none'));await B.p.evaluate(()=>window.__hold=true);await B.p.locator('#sb-assistant-input').fill('Suite sur le deuxième appareil');await B.p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await B.p.locator('.sb-chat-thinking').waitFor();await sync(B.p);await sync(A.p);
  await A.p.getByText(/aucune tâche ne s’exécute ici/).waitFor();check(true,'ancien calcul terminé sur A : le nouveau calcul de B reste identifié comme distant');
  await B.p.evaluate(()=>window.__finish());await B.p.locator('.sb-chat-thinking').waitFor({state:'detached'});await sync(B.p);await sync(A.p);
  await A.p.getByText('Suite sur le deuxième appareil',{exact:true}).waitFor();check(true,'suite du fil sur B restaurée sur A');
  check((await rows(A.p))[0].messages.length===4&&(await rows(B.p))[0].messages.length===4,'fusion sans duplication des messages');
  check(!(await rows(A.p)).some(c=>c._pending),'acquittement seulement après relecture Drive');
  const writes=cloud.writes.length;await sync(A.p);await sync(B.p);check(cloud.writes.length===writes,'aucune boucle d’envoi après convergence');
  await A.ctx.close();await B.ctx.close();
 }
 {
  const cloud=shared(),A=await setup(),B=await setup();await drive(A.ctx,cloud);await drive(B.ctx,cloud);
  await mock(A.p,answer('none'));await A.p.evaluate(()=>window.__hold=true);await A.p.locator('#sb-assistant-input').fill('Analyse interappareils');await A.p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await A.p.locator('.sb-chat-thinking').waitFor();await sync(A.p);await sync(B.p);
  await B.p.getByText('Analyse interappareils',{exact:true}).waitFor();
  check(await B.p.locator('.sb-chat-thinking').count()===0&&await B.p.getByText(/aucune tâche ne s’exécute ici/).count()===1,'autre appareil : statut honnête, aucun faux calcul local');
  await navOut(A.p);await A.p.evaluate(()=>window.__finish());await until(async()=>(await rows(A.p))[0].run.status==='done');await sync(A.p);await sync(B.p);
  await B.p.getByText('Voici une proposition à vérifier.',{exact:true}).waitFor();check(await B.p.getByText(/aucune tâche ne s’exécute ici/).count()===0,'résultat calculé hors de la vue restauré sur B, attente retirée');
  await A.ctx.close();await B.ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));await p.evaluate(()=>window.__hold=true);await p.locator('#sb-assistant-input').fill('Reprise après destruction');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor();await p.reload();await navBack(p);
  check(await p.locator('.sb-chat-thinking').count()===0&&await p.getByRole('button',{name:'Relancer la demande ici'}).isVisible(),'rechargement interrompu : relance explicite, pas de requête automatique');
  await mock(p,answer('none'));await p.getByRole('button',{name:'Relancer la demande ici'}).click();await p.getByText('Voici une proposition à vérifier.',{exact:true}).waitFor();check(true,'relance explicite du dernier message fonctionne');
  await newChat(p);await mock(p,answer('none'));await p.evaluate(()=>window.__hold=true);await p.locator('#sb-assistant-input').fill('À arrêter');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor();await p.getByRole('button',{name:'Arrêter la réponse'}).click();check((await rows(p))[0].run.status==='cancelled','arrêt explicite enregistré sans tâche fantôme');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));await p.evaluate(()=>window.__hold=true);await p.locator('#sb-assistant-input').fill('Réponse privée en retard');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor();
  await p.evaluate(async()=>{window.dispatchEvent(new Event('sb:auth-changing'));const a=await import('/src/services/accountScope.ts');a.selectAccountScope('new-history-account');window.__finish();});await pause(250);
  check(await p.locator('.sb-chat-message').count()===0&&(await rows(p)).length===0,'changement de compte pendant le calcul : aucun résultat tardif dans le nouveau compte');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));await send(p,'Convergence et conservation');
  const result=await p.evaluate(async()=>{const h=await import('/src/services/assistantHistory.ts');const a=h.conversationForDrive(h.getAssistantConversations()[0]);const b=structuredClone(a);b.version+='-b';b.updatedAt+=1;b.messages.push(h.stampAssistantMessage({role:'user',text:'Autre branche'}));b.run={...a.run,status:'running'};const ab=h.mergeAssistantConversations([a],[b]);const ba=h.mergeAssistantConversations([b],[a]);const long={...a,messages:Array.from({length:121},(_,i)=>h.stampAssistantMessage({role:'user',text:'M'+i}))};const reordered=Object.fromEntries(Object.entries(a).reverse());return {ordered:h.validAssistantConversations([reordered]),commute:JSON.stringify(ab)===JSON.stringify(ba),union:ab[0].messages.length===3,terminal:ab[0].run.status==='done',limit:h.mergeAssistantConversations([long],[])[0].messages.length,valid:h.validAssistantConversations([a]),invalid:!h.validAssistantConversations([{...a,snapshot:{...a.snapshot,token:'bad'}}])}});
  check(result.commute&&result.union,'fusion concurrente commutative, messages des deux branches conservés');check(result.terminal,'statut terminé non remplacé par une ancienne attente');check(result.ordered,'ordre des clés JSON sans importance pour la validation');check(result.valid&&result.invalid,'validation stricte du format cloud et des champs de snapshot');check(result.limit===120,'limite de 120 messages conservés par discussion');
  const timing=await p.evaluate(async()=>{const h=await import('/src/services/assistantHistory.ts');const t=await import('/src/services/assistantVoiceTask.ts');const c=h.conversationForDrive(h.getAssistantConversations()[0]);const future=Date.now()+86400000;h.mergeRemoteAssistantConversations([{...c,id:'chat-clock-test',updatedAt:future,version:`${future}-remote`,run:{...c.run,startedAt:future,status:'done'}}]);const task=t.beginVoicePreparation({},'Nouvelle tâche',new AbortController(),'chat-clock-test',false);t.updateVoicePreparation(task,'Z ancienne étape');t.updateVoicePreparation(task,'A étape suivante');const row=h.getAssistantConversations().find(c=>c.id==='chat-clock-test');const result={clock:row.run.id===task.run.id&&task.run.startedAt>future,stage:row.run.stage==='A étape suivante'};t.cancelVoicePreparation('chat-clock-test');return result});
  check(timing.clock,'horloge du second appareil en retard : la nouvelle tâche prend bien la suite');check(timing.stage,'étape réelle la plus récente retenue, pas un tri alphabétique');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer());await send(p,'Un aperçu à retrouver');
  await p.locator('.sa-adjust > summary').click();await p.getByRole('button',{name:'2 h',exact:true}).click();await p.getByRole('textbox',{name:'Consigne transmise à Gemini'}).fill('Direction ajustée avant navigation');
  await navOut(p);await navBack(p);await p.getByRole('region',{name:'Proposition de blend',exact:true}).waitFor();await p.locator('.sa-adjust > summary').click();
  check(await p.getByRole('slider',{name:'Durée du blend'}).inputValue()==='120'&&await p.getByRole('textbox',{name:'Consigne transmise à Gemini'}).inputValue()==='Direction ajustée avant navigation','aperçu de création et réglages modifiés conservés, sans retour aux valeurs du modèle');
  await ctx.close();
 }
 {
  const cloud=shared(),{p,ctx}=await setup();await drive(ctx,cloud);await mock(p,answer('none'));await send(p,'À envoyer après panne réseau');cloud.fail=true;check(!await sync(p),'panne Drive signalée sans fausse confirmation');
  check((await rows(p))[0]._pending,'messages restent en attente et sur cet appareil');cloud.fail=false;check(await sync(p),'reprise après panne réseau');
  const before=cloud.writes.length;cloud.data.assistantConversations=[{id:'invalid',messages:'broken'}];check(!await sync(p)&&cloud.writes.length===before,'historique distant corrompu refusé sans écrasement de Drive');
  check((await rows(p))[0].messages.some(m=>m.text==='À envoyer après panne réseau'),'erreur distante ne supprime pas la discussion locale');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await p.evaluate(()=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('soundblend_assistant_history_v1'))throw new DOMException('quota','QuotaExceededError');return native.call(this,k,v)}});await mock(p,answer('none'));await send(p,'Conserver malgré le quota');
  check((await rows(p))[0]?.messages.some(m=>m.text==='Conserver malgré le quota'),'quota local : discussion conservée en mémoire');
  check(await p.getByText(/Historique gardé en mémoire uniquement/).count()===1,'quota local : avertissement visible, pas de promesse de sauvegarde durable');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('blend_edit'));await send(p,'Modifie mon blend sans exécuter automatiquement');await p.getByRole('region',{name:'Proposition de modification de blend'}).waitFor();await p.reload();await navBack(p);
  check(await p.getByRole('button',{name:'Confirmer : modifier ce blend'}).count()===0&&await p.getByRole('button',{name:'Repréparer la proposition'}).isVisible(),'après destruction : aperçu d’écriture ne devient pas une autorisation réutilisable');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('none'));await send(p,'Discussion pour accessibilité');
  const {default:AxeBuilder}=await import(process.env.SOUNDBLEND_AXE_MODULE || '@axe-core/playwright');
  await mkdir(new URL('./assistant-history-v11/',import.meta.url),{recursive:true});
  for(const width of [390,1280])for(const theme of ['light','dark']){
   await p.setViewportSize({width,height:900});await p.evaluate(theme=>document.documentElement.setAttribute('data-mode',theme),theme);await openHistory(p);
   const dialog=p.getByRole('dialog',{name:'Tes discussions',exact:true});const b=await dialog.boundingBox();check(b.x>=0&&b.x+b.width<=width+1,`dialogue sans débordement ${width} ${theme}`);
   const scan=await new AxeBuilder({page:p}).analyze();check(scan.violations.length===0,`axe discussions ${width} ${theme} : ${JSON.stringify(scan.violations.map(v=>v.id))}`);
   await p.screenshot({path:new URL(`./assistant-history-v11/discussions-${width}-${theme}.png`,import.meta.url).pathname});await p.keyboard.press('Escape');check(await p.getByRole('button',{name:'Nouvelle conversation',exact:true}).evaluate(e=>e===document.activeElement),`Échap et restitution du focus ${width} ${theme}`);
  }await ctx.close();
 }
 console.log(`\n${checks} contrôles historique V11 réussis, dont 4 audits axe. Services simulés, deux contextes navigateurs indépendants.`);
} finally {await browser.close()}
