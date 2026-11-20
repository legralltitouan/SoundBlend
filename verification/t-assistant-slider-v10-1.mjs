/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const painted = async range => JSON.parse(execFileSync('python3',['-c',`import sys,io,json
from PIL import Image
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')
y=im.height//2
red=[x for x in range(im.width) if (lambda r,g,b:r>150 and r>g*1.8 and r>b*1.5)(*im.getpixel((x,y)))]
print(json.dumps({'red':len(red),'width':im.width}))`],{input:await range.screenshot()}));
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-slider-v10-1/',import.meta.url),{recursive:true});
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
const stored=p=>p.evaluate(async()=>{const {getStoredBlends}=await import('/src/services/storage.ts');return getStoredBlends()});
const mock=async(p,value)=>{await p.evaluate(async value=>{window.__answer=value;const {geminiService}=await import('/src/services/gemini.ts');geminiService.converse=async(...args)=>{window.__lastOptions=args[4];if(window.__hold)await new Promise(resolve=>window.__finish=resolve);return window.__answer};},value)};
const send=async(p,text='Crée un nouveau blend carte blanche')=>{await p.locator('#sb-assistant-input').fill(text);await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor({state:'detached'})};
const durations=async ctx=>ctx.route('https://www.googleapis.com/youtube/v3/videos?**',r=>r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[{id:'aaaaaaaaaaa',contentDetails:{duration:'PT4M12S'}},{id:'bbbbbbbbbbb',contentDetails:{duration:'PT2M48S'}},{id:'ccccccccccc',contentDetails:{duration:'PT5M9S'}}]})}));
try {
 {
  const {p,ctx,state,errors}=await setup();await durations(ctx);await mock(p,answer());await send(p);
  const card=p.getByRole('region',{name:'Proposition de blend',exact:true});await card.waitFor();
  await card.getByLabel('Durée 4:12',{exact:true}).waitFor();
  check((await card.locator('.sa-mosaic').first().boundingBox()).width===(await card.locator('.sa-mosaic').first().boundingBox()).height,'pochette de proposition : carré parfait, pas rectangle');
  check(await card.locator('.sa-blend-heading .sa-mosaic-cell').count()===3&&await card.locator('.sa-seed-art').count()===3,'mosaïque des trois points de départ et pochette arrondie à gauche de chaque titre');
  check((await card.locator('time').allTextContents()).join(',')==='4:12,2:48,5:09','durées officielles variées, anciennes valeurs fictives 3:30 ignorées');
  await card.locator('.sa-adjust > summary').click();
  check(await card.locator('select,input[type=checkbox]').count()===0,'réglages sans select ni longue liste de cases sources');
  const textarea=card.getByRole('textbox',{name:'Consigne transmise à Gemini'});
  await textarea.fill('Une direction musicale détaillée.\n'.repeat(40));
  await p.waitForTimeout(100);
  check(await textarea.evaluate(e=>e.scrollHeight<=e.clientHeight+2&&getComputedStyle(e).resize==='none'&&getComputedStyle(e).overflowY==='hidden'),'consigne haute automatiquement : tout visible, ni scroll interne ni poignée de redimensionnement');
  const tall=await textarea.evaluate(e=>e.clientHeight);await textarea.fill('Une direction courte.');await p.waitForTimeout(60);
  check(await textarea.evaluate((e,tall)=>e.clientHeight<tall,tall),'consigne : la hauteur diminue aussi quand le texte est raccourci');
  const range=card.getByRole('slider',{name:'Durée du blend'});await range.focus();await p.keyboard.press('ArrowRight');
  check(await range.getAttribute('aria-valuetext')==='46 minutes','slider de durée accessible au clavier, valeur exacte');
  await card.getByRole('button',{name:'2 h',exact:true}).click();check(await range.inputValue()==='120','raccourci de durée synchronisé avec le slider');
  for (const width of [390,1280]) for (const theme of ['light','dark']) {
    await p.setViewportSize({width,height:900});
    await p.evaluate(theme=>document.documentElement.setAttribute('data-mode',theme),theme);
    for (const [key,expected] of [['Home',10],['End',180],['Home',10],['ArrowRight',11]]) {
      await range.focus();await p.keyboard.press(key);
      const visual=await range.evaluate(e=>({value:Number(e.value),track:getComputedStyle(e,'::-webkit-slider-runnable-track').backgroundImage,progress:e.style.getPropertyValue('--sa-range'),thumb:getComputedStyle(e,'::-webkit-slider-thumb').marginTop}));
      const pixels=await painted(range); const percent=(expected-10)/170*100;
      check(visual.value===expected&&Math.abs(parseFloat(visual.progress)-percent)<.001&&Math.abs(pixels.red-pixels.width*percent/100)<26,`piste réellement peinte synchronisée ${expected} min / ${width} ${theme}`);
    }
    await range.scrollIntoViewIfNeeded();const box=await range.boundingBox();
    await p.mouse.move(box.x+11,box.y+box.height/2);await p.mouse.down();
    const observed=[];
    for(const part of [.2,.4,.65,.85]) {
      await p.mouse.move(box.x+11+(box.width-22)*part,box.y+box.height/2,{steps:5});
      observed.push({...await range.evaluate(e=>({value:Number(e.value),progress:e.style.getPropertyValue('--sa-range')})),...await painted(range)});
    }
    await p.mouse.up();
    check(observed.every((v,i)=>Math.abs(v.red-v.width*parseFloat(v.progress)/100)<26&&(!i||(v.value>observed[i-1].value&&v.red>observed[i-1].red))),`remplissage suit le glissement en continu / ${width} ${theme}`);
    await card.getByRole('button',{name:'2 h',exact:true}).click();
    const presetPixels=await painted(range);
    check(await range.inputValue()==='120'&&Math.abs(presetPixels.red-presetPixels.width*110/170)<26,`raccourci 2 h : piste et curseur synchronisés / ${width} ${theme}`);
    await card.locator('.sa-duration-control').screenshot({path:new URL(`./assistant-slider-v10-1/slider-${width}-${theme}.png`,import.meta.url).pathname});
  }
  await card.getByRole('button',{name:'Choisir les sources musicales'}).click();const dialog=p.getByRole('dialog',{name:'Tes inspirations'});await dialog.waitFor();
  await dialog.getByRole('textbox',{name:'Rechercher une source musicale'}).fill('Nuance');
  check(await dialog.locator('.sa-source-results li').count()===5,'recherche locale de sources visuelles');
  for(const n of [0,1,2])await dialog.getByRole('button',{name:'Ajouter Nuance '+n,exact:true}).click();
  check(await dialog.getByRole('button',{name:'Ajouter Nuance 3',exact:true}).isDisabled(),'maximum de quatre sources respecté dans le sélecteur visuel');
  await p.keyboard.press('Escape');check(await p.getByRole('dialog').count()===0,'Échap ferme le sélecteur, focus rendu au bouton');
  await card.getByRole('button',{name:'Utiliser Nuance 1 comme base',exact:true}).click();
  check((await card.locator('.sa-source-selection li').first().innerText()).includes('Nuance 1'),'une nuance peut devenir la base sans dupliquer les sources');
  await card.getByRole('button',{name:'Retirer la source Nuance 1',exact:true}).click();
  check(await card.locator('.sa-source-selection li').count()===3,'retirer la base promeut une nuance, palette cohérente');
  check(state.writes.length===0&&errors.length===0,'réglages de proposition : aucune mutation YouTube ni erreur');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();await mock(p,answer('blend_edit'));const before=await stored(p);await send(p,'Retire LOAT, mets Stayin Alive au début et renomme mon blend Jazz ajusté');
  const card=p.getByRole('region',{name:'Proposition de modification de blend',exact:true});await card.waitFor();
  check(JSON.stringify(await stored(p))===JSON.stringify(before),'modification de blend : simple aperçu ne change rien au stockage');
  await card.getByRole('button',{name:'Confirmer : modifier ce blend'}).click();await p.getByRole('region',{name:'Blend enregistré'}).waitFor();
  const all=await stored(p),after=all.find(b=>b.id==='blend-v10'),original=before.find(b=>b.id==='blend-v10');
  check(all.length===before.length&&after.title==='Jazz ajusté'&&after.tracks.map(t=>t.id).join(',')==='v10-track-2,v10-track-0','confirmation : modification en place exacte, sans copie');
  check(after.id===original.id&&after.expiresAt===original.expiresAt&&after.createdAt===original.createdAt&&JSON.stringify(after.exportedMeta)===JSON.stringify(original.exportedMeta),'identité, création, expiration et export connu préservés');
  check(state.writes.length===0,'modifier le blend local ne modifie jamais sa playlist YouTube');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await mock(p,answer('blend_edit'));await send(p,'Modifie le blend existant');await p.getByRole('region',{name:'Proposition de modification de blend'}).waitFor();
  await p.evaluate(async()=>{const s=await import('/src/services/storage.ts');const b=s.getStoredBlends().find(b=>b.id==='blend-v10');s.saveBlendToStorage({...b,title:'Version concurrente'})});
  await p.getByRole('button',{name:'Confirmer : modifier ce blend'}).click();await p.getByRole('alert').waitFor();
  check((await stored(p)).find(b=>b.id==='blend-v10').title==='Version concurrente','version modifiée depuis l’aperçu : confirmation bloquée, jamais écrasée');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();const value=answer('blend_edit');value.blendEdits={mode:'regenerate',title:'Jazz repensé',removeTrackIds:[],moves:[],additions:[]};await mock(p,value);
  await p.evaluate(async()=>{const {geminiService}=await import('/src/services/gemini.ts');geminiService.generateBlend=async seeds=>{window.__generationCount=(window.__generationCount||0)+1;return seeds.slice(0,2).map(t=>({...t,category:'anchor'}))}});
  const before=await stored(p);await send(p,'Recompose ce même blend dans une direction plus soul');
  check(!(await p.evaluate(()=>window.__generationCount)),'recomposition : aucune génération avant confirmation');
  await p.getByRole('button',{name:'Confirmer : recomposer ce blend'}).click();await p.getByRole('region',{name:'Blend enregistré'}).waitFor();
  const after=await stored(p),updated=after.find(b=>b.id==='blend-v10');
  check(after.length===before.length&&updated.title==='Jazz repensé'&&updated.tracks.length===2&&updated.expiresAt===before.find(b=>b.id==='blend-v10').expiresAt,'recomposition confirmée remplace le même blend, sans nouvelle entrée ni extension d’expiration');
  check(await p.evaluate(()=>window.__generationCount===1)&&state.writes.length===0,'recomposition unique et aucun envoi YouTube automatique');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await p.emulateMedia({reducedMotion:'no-preference'});await p.evaluate(()=>window.__hold=true);await mock(p,answer());
  await p.locator('#sb-assistant-input').fill('Prépare mon blend');await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sa-thinking').waitFor();
  const first=await p.locator('.sa-thinking-line').innerText();await p.waitForTimeout(3800);
  check((await p.locator('.sa-thinking strong').innerText())==='Gemini réfléchit à ta demande…','réflexion : titre Gemini constant');
  check((await p.locator('.sa-thinking-line').innerText())!==first,'réflexion : texte explicatif animé sous le titre');
  await p.getByRole('button',{name:'Arrêter la réponse'}).click();await p.evaluate(()=>window.__finish?.());check(await p.locator('.sa-thinking').count()===0,'réflexion arrêtée proprement avec la demande');await ctx.close();
 }
 {
  const {p,ctx}=await setup();
  const results=await p.evaluate(async()=>{
    const {prepareAssistantBlendDraft:prepare,assertAssistantBlendDraft:guard}=await import('/src/services/assistantBlend.ts');
    const storage=await import('/src/services/storage.ts');const {youtubeService}=await import('/src/services/youtube.ts');
    const blank={mode:'tracks',removeTrackIds:[],moves:[],additions:[]};const results=[];
    for(const [label,edit] of [
      ['sans changement',blank],['retrait inconnu',{...blank,removeTrackIds:['inconnu']}],
      ['déplacement invalide',{...blank,moves:[{trackId:'v10-track-0',position:90}]}],
      ['déplacement d’un titre retiré',{...blank,removeTrackIds:['v10-track-0'],moves:[{trackId:'v10-track-0',position:0}]}],
      ['suppression intégrale',{...blank,removeTrackIds:['v10-track-0','v10-track-1','v10-track-2']}],
      ['trop d’ajouts',{...blank,additions:Array(6).fill({title:'New Song',artist:'New Artist'})}],
      ['mélange régénération/changements',{...blank,mode:'regenerate',removeTrackIds:['v10-track-0']}],
    ]){try{await prepare('blend-v10',edit);results.push([label,false])}catch{results.push([label,true])}}
    const candidate={id:'search-result',videoId:'ddddddddddd',title:'New Song',artist:'New Artist',thumbnailUrl:'',durationSeconds:0,youtubeTitle:'New Artist - New Song',youtubeChannel:'New Artist - Topic'};
    youtubeService.searchAssistantCatalog=async()=>[candidate];
    const before=JSON.stringify(storage.getStoredBlends());const draft=await prepare('blend-v10',{...blank,additions:[{title:'New Song',artist:'New Artist'}]});
    results.push(['ajout exact préparé sans mutation',draft.additions.length===1&&JSON.stringify(storage.getStoredBlends())===before]);
    storage.block(candidate,'track');try{guard(draft);results.push(['exclusion ajoutée après aperçu',false])}catch{results.push(['exclusion ajoutée après aperçu',true])}
    const rename=await prepare('blend-v10',{...blank,title:'Un nouveau titre'});const original=storage.getStoredBlends().find(b=>b.id==='blend-v10');
    storage.writeStoredBlends(storage.getStoredBlends().map(b=>b.id===original.id?{...b,_pending:!b._pending}:b));
    try{guard(rename);results.push(['confirmation de sync seule ne rend pas le brouillon périmé',true])}catch{results.push(['confirmation de sync seule ne rend pas le brouillon périmé',false])}
    storage.deleteStoredBlend('blend-v10');try{guard(rename);results.push(['blend supprimé depuis aperçu',false])}catch{results.push(['blend supprimé depuis aperçu',true])}
    return results;
  });
  for(const [label,ok] of results)check(ok,'garde blend : '+label);await ctx.close();
 }
 {
  const {p,ctx}=await setup();const value=answer('blend_edit');value.blendEdits={mode:'regenerate',removeTrackIds:[],moves:[],additions:[]};await mock(p,value);
  await p.evaluate(async()=>{const {geminiService}=await import('/src/services/gemini.ts');geminiService.generateBlend=async seeds=>{window.__generating=true;await new Promise(resolve=>window.__releaseGeneration=resolve);return seeds.map(t=>({...t,category:'anchor'}))}});
  await send(p,'Recompose le même blend');await p.getByRole('button',{name:'Confirmer : recomposer ce blend'}).click();await p.waitForFunction(()=>window.__generating);
  await p.evaluate(async()=>{const s=await import('/src/services/storage.ts');const b=s.getStoredBlends().find(b=>b.id==='blend-v10');s.saveBlendToStorage({...b,title:'Modification concurrente pendant calcul'});window.__releaseGeneration()});
  await p.getByRole('alert').waitFor();const all=await stored(p);
  check(all.length===6&&all.find(b=>b.id==='blend-v10').title==='Modification concurrente pendant calcul','changement pendant régénération : refus d’écraser, aucune copie de repli créée');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();let prompt='';
  await ctx.route(/https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/.*:streamGenerateContent.*/,r=>{
    prompt=r.request().postDataJSON().contents[0].parts[0].text;
    return r.fulfill({status:200,headers:cors,body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(answer('blend_edit'))}]}}]})});
  });
  await send(p,'Retire LOAT de Jazz au présent et mets Stayin Alive en premier');await p.getByRole('region',{name:'Proposition de modification de blend'}).waitFor();
  check(prompt.includes('Tu PEUX modifier un blend SoundBlend existant EN PLACE')&&prompt.includes('v10-track-1'),'protocole réel du service : capacité de modification en place et identifiants présents dans le prompt');
  check((await stored(p)).find(b=>b.id==='blend-v10').tracks.length===3&&state.writes.length===0,'parse Gemini blend_edit : aperçu concret, jamais une exécution automatique');await ctx.close();
 }
 const {default:AxeBuilder}=await import(process.env.SOUNDBLEND_AXE_MODULE||'@axe-core/playwright');
 for(const [width,theme] of [[390,'light'],[390,'dark'],[1280,'light'],[1280,'dark']]){
  const {p,ctx}=await setup();await p.setViewportSize({width,height:900});await p.emulateMedia({reducedMotion:'reduce'});await durations(ctx);
  await ctx.route('https://i.ytimg.com/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><linearGradient id="a"><stop stop-color="#536c83"/><stop offset="1" stop-color="#cba4a0"/></linearGradient></defs><rect width="100" height="100" fill="url(#a)"/><circle cx="50" cy="50" r="23" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></svg>'}));
  await p.evaluate(async theme=>{const {choisirMode}=await import('/src/context/prefs.ts');choisirMode(theme)},theme);
  await mock(p,answer());await send(p);const card=p.getByRole('region',{name:'Proposition de blend',exact:true});await card.waitFor();await p.waitForTimeout(200);
  check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`proposition ${width} ${theme} : aucun débordement`);
  await card.screenshot({path:new URL(`./assistant-slider-v10-1/proposition-${width}-${theme}.png`,import.meta.url).pathname});
  await card.locator('.sa-adjust > summary').click();
  const ax=await new AxeBuilder({page:p}).include('.sa-blend-card').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  check(ax.violations.length===0,`axe réglages ${width} ${theme} : ${JSON.stringify(ax.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})))}`);
  await card.screenshot({path:new URL(`./assistant-slider-v10-1/reglages-${width}-${theme}.png`,import.meta.url).pathname});
  await card.getByRole('button',{name:'Choisir les sources musicales'}).click();await p.getByRole('dialog',{name:'Tes inspirations'}).waitFor();
  const modal=await new AxeBuilder({page:p}).include('.sa-source-dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  check(modal.violations.length===0,`axe sources ${width} ${theme} : ${JSON.stringify(modal.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})))}`);
  await p.screenshot({path:new URL(`./assistant-slider-v10-1/sources-${width}-${theme}.png`,import.meta.url).pathname});await ctx.close();
 }
 console.log(`${checks} contrôles de redesign V10 réussis, dont 8 audits axe`);
} finally {await browser.close()}
