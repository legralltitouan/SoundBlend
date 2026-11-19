/* V3 : recherche YouTube et Gemini simulés. Aucun appel Google réel. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({args:['--no-sandbox']});
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const shots=new URL('./assistant-mentions/',import.meta.url).pathname; await mkdir(shots,{recursive:true});
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'};
const channel='UC'+'a'.repeat(22), ids=Array.from({length:10},(_,i)=>`mention00${i}x`);
const items=ids.map((videoId,i)=>({id:{videoId},snippet:{title:`Artist ${i} - Song ${i} (Official Audio)`,channelTitle:`Artist ${i} - Topic`,channelId:channel,thumbnails:{medium:{url:i===0?'https://unsafe.invalid/tracker.png':''}}}}));
let checks=0;const check=(v,l)=>{assert.ok(v,l);checks++;console.log('✓ '+l)};
async function setup(w=390,h=844,mode='light',key=true){
 const c=await browser.newContext({viewport:{width:w,height:h},reducedMotion:'reduce',serviceWorkers:'block'});
 await c.addInitScript(({mode,key})=>{localStorage.setItem('soundblend_onboarded','1');localStorage.setItem('soundblend_mode',mode);localStorage.setItem('soundblend_settings',JSON.stringify({youtubeApiKey:key?'youtube-test-key':'',geminiApiKey:'gemini-test-key'}));},{mode,key});
 const state={searches:[],prompts:[],writes:[],status:200,empty:false,delay:0,blend:false};
 await c.route(/^https:\/\//,r=>r.abort());
 await c.route('https://www.googleapis.com/youtube/v3/**',async r=>{
  const req=r.request();if(req.method()==='OPTIONS')return r.fulfill({headers:cors,body:'{}'});
  if(req.method()!=='GET'){state.writes.push(req.url());return r.fulfill({headers:cors,body:'{}'});}
  const u=new URL(req.url());if(!u.pathname.endsWith('/search'))return r.fulfill({headers:cors,body:'{}'});
  state.searches.push({url:req.url(),headers:req.headers()});const delay=state.delay;
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  return r.fulfill({status:state.status,headers:cors,body:JSON.stringify({items:state.empty?[]:u.searchParams.get('type')==='channel'?[{id:{channelId:channel},snippet:{title:'Daft Punk'}}]:items})}).catch(()=>{});
 });
 await c.route('https://generativelanguage.googleapis.com/**',r=>{
  if(r.request().method()==='OPTIONS')return r.fulfill({headers:cors,body:'{}'});
  if(r.request().url().includes('/models?'))return r.fulfill({headers:cors,body:JSON.stringify({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent'],outputTokenLimit:8192}]})});
  state.prompts.push(r.request().postDataJSON()?.contents?.[0]?.parts?.[0]?.text||'');
  const out={reply:'Ces références donnent une direction précise.',title:'Références à ta façon',action:state.blend?'blend':'none',source:null,extraSources:[],instruction:'Une direction souple et musicale.',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],followUps:[],playlistEdits:null};
  return r.fulfill({headers:cors,body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(out)}]}}]})});
 });
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator(`${w<820?'.ytm-mobile-bar':'.ytm-rail'} [aria-label="Assistant"]`).click();await p.waitForSelector('.sa-welcome');return {c,p,state,errors};
}
async function open(p){await p.getByRole('button',{name:'Ajouter une référence YouTube'}).click();await p.locator('.sa-mention-picker').waitFor();}
async function search(p,q='Daft Punk'){await p.getByRole('textbox',{name:'Rechercher sur YouTube'}).fill(q);await p.getByRole('button',{name:'Lancer la recherche YouTube'}).click();}
async function results(p){await p.locator('.sa-picker-result').first().waitFor();}
async function close(p){await p.getByRole('button',{name:'Ajouter au message',exact:true}).click();}
async function send(p){await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-message--assistant').last().waitFor();await p.locator('.sb-chat-thinking').waitFor({state:'detached'});}
try{
 const {c,p,state,errors}=await setup();
 const plus=await p.locator('.sa-mention-add').boundingBox(),live=await p.locator('.sa-live-button').boundingBox(),sendRect=await p.locator('[type="submit"]').boundingBox();
 check(plus.x<live.x&&live.x<sendRect.x,'+ à gauche, Live à droite avant Envoyer');
 await p.locator('#sb-assistant-input').fill('Compare ces influences : ');await open(p);
 check(await p.getByRole('dialog').evaluate(e=>e.contains(document.activeElement)),'focus captif dans le dialogue natif');
 check(state.searches.length===0,'ouvrir la recherche ne consomme pas de quota');
 await p.getByRole('textbox',{name:'Rechercher sur YouTube'}).fill('Daft');check(state.searches.length===0,'la frappe seule ne déclenche aucune requête');
 await search(p);await results(p);
 check(state.searches.length===1&&new URL(state.searches[0].url).searchParams.get('videoCategoryId')==='10','recherche explicite de vidéos musicales uniquement');
 check(!state.searches[0].url.includes('youtube-test-key')&&state.searches[0].headers['x-goog-api-key']==='youtube-test-key','clé API dans l’en-tête, jamais dans l’URL');
 check(await p.locator('img[src*="unsafe.invalid"]').count()===0,'miniatures externes non autorisées rejetées');
 await p.locator('.sa-picker-result').nth(0).click();await p.locator('.sa-picker-result').nth(1).click();
 check(await p.locator('.sa-picker-result[aria-pressed="true"]').count()===2,'sélection multiple de deux titres précis');
 await p.getByRole('tab',{name:'Artistes',exact:true}).click();check(await p.locator('.sa-picker-result').count()===0,'changer de type nettoie les résultats précédents');
 await search(p);await results(p);check(new URL(state.searches.at(-1).url).searchParams.get('type')==='channel','artistes recherchés sous forme de chaînes YouTube');
 await p.locator('.sa-picker-result').click();await close(p);
 const draft=await p.locator('#sb-assistant-input').inputValue();
 check(draft.startsWith('Compare ces influences')&&draft.includes('#«Song 0 · Artist 0»')&&draft.includes('@«Daft Punk»'),'mentions #morceau et @artiste insérées dans le prompt existant');
 check(await p.locator('.sa-draft-mentions .sa-mention').count()===3,'puces de références visibles');
 check(await p.locator('#sb-assistant-input').evaluate(e=>document.activeElement===e),'retour du focus au prompt');
 await p.screenshot({path:shots+'composeur-mobile.png'});
 await p.getByRole('button',{name:'Retirer la référence Song 1',exact:true}).click();
 check(!(await p.locator('#sb-assistant-input').inputValue()).includes('#«Song 1'),'retirer une puce supprime sa mention du prompt');
 await send(p);
 check(await p.locator('.sa-draft-mentions').count()===0&&!(await p.locator('#sb-assistant-input').inputValue()),'brouillon et références vidés après envoi');
 check(await p.locator('.sa-message-mentions a').count()===2,'références envoyées consultables dans le message');
 const prompt=state.prompts.at(-1);
 check(prompt.includes('"videoId":"'+ids[0]+'"')&&prompt.includes('"channelId":"'+channel+'"')&&prompt.includes('titreYouTube'),'identifiants et métadonnées exactes transmis au vrai sérialiseur Gemini');
 check(!prompt.includes('"videoId":"'+ids[1]+'"'),'référence retirée non transmise à Gemini');
 await p.locator('#sb-assistant-input').fill('Et pour une ambiance plus douce ?');await send(p);
 check(state.prompts.at(-1).includes('"videoId":"'+ids[0]+'"'),'références conservées dans le contexte des relances');
 check(state.writes.length===0&&await p.getByRole('region',{name:'Proposition de blend',exact:true}).count()===0,'simple question sans génération ni écriture YouTube automatique');
 const persisted=await p.evaluate(()=>Object.entries(localStorage).filter(([,v])=>v.includes('mention000x')||v.includes('Compare ces influences')));
 check(persisted.length===0,'références et messages non persistés dans localStorage');
 await open(p);await search(p);await results(p);await p.locator('.sa-picker-result').first().click();await close(p);
 await p.locator('#sb-assistant-input').fill('Mention tapée à la main @Daft Punk');
 check(await p.locator('.sa-draft-mentions').count()===0,'effacer le token retire le contexte ; texte libre non transformé en fausse référence');
 await open(p);await search(p);await results(p);
 for(let i=0;i<8;i++)await p.locator('.sa-picker-result').nth(i).click();
 check(await p.locator('.sa-picker-result[aria-pressed="true"]').count()===8&&await p.locator('.sa-picker-result').nth(8).isDisabled(),'limite de huit références, sans empêcher leur désélection');
 await p.keyboard.press('Escape');check(await p.getByRole('dialog').count()===0&&await p.locator('.sa-mention').count()===8,'Échap ferme le picker et garde les choix déjà insérés');
 await p.getByRole('button',{name:'Live',exact:true}).click();await p.evaluate(async()=>{const {GeminiLiveSession}=await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/services/geminiLive.ts')).name);GeminiLiveSession.prototype.start=async function(key,context){window.__liveContext=JSON.parse(context)};GeminiLiveSession.prototype.stop=function(){};});
 await p.getByRole('button',{name:'Démarrer le vocal'}).click();await p.waitForFunction(()=>!!window.__liveContext);
 check(await p.evaluate(()=>window.__liveContext.referencesDuBrouillon.length===8&&window.__liveContext.conversation.some(m=>m.referencesYouTube.length>0)),'Live reçoit les références du brouillon et de la conversation');
 await p.getByRole('button',{name:'Fermer le mode Live'}).click();
 await open(p);await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sb:auth-changing')));
 check(await p.getByRole('dialog').count()===0&&await p.locator('.sa-mention').count()===0&&!(await p.locator('#sb-assistant-input').inputValue()),'changement de compte ferme la recherche et efface références, conversation et brouillon');
 check(errors.length===0,'aucune exception JavaScript dans le parcours complet');await c.close();
 // Erreurs, résultats vides et annulation d’une requête lente.
 const e=await setup();await open(e.p);e.state.status=403;await search(e.p);await e.p.getByRole('alert').waitFor();check((await e.p.getByRole('alert').innerText()).includes('quotas'),'quota refusé expliqué sans faux résultat');
 e.state.status=200;e.state.empty=true;await search(e.p,'Aucun résultat');await e.p.getByText('Aucun résultat. Essaie un titre ou un nom plus précis.').waitFor();check(await e.p.locator('.sa-picker-result').count()===0,'résultat vide explicite');
 e.state.empty=false;e.state.delay=800;await search(e.p,'Ancienne recherche');await e.p.getByRole('textbox',{name:'Rechercher sur YouTube'}).fill('Nouvelle recherche');await e.p.waitForTimeout(1000);check(await e.p.locator('.sa-picker-result').count()===0,'réponse tardive ignorée après modification du texte');
 e.state.delay=0;await search(e.p);await results(e.p);await e.p.locator('.sa-picker-result').first().click();await close(e.p);e.state.blend=true;await send(e.p);await e.p.getByRole('region',{name:'Proposition de blend',exact:true}).waitFor();check(e.state.writes.length===0,'morceau référencé utilisable comme amorce d’un aperçu sans exécution');await e.c.close();
 // Contrôles unitaires dans le navigateur : mêmes modules que la vue.
 const unit=await setup();
 const unitResults=await unit.p.evaluate(async({items})=>{
  const load=async name=>import(performance.getEntriesByType('resource').find(e=>e.name.includes(`/src/services/${name}.ts`)).name);
  const m=await load('assistantMentions'),{youtubeService:yt,isAssistantTrackExcluded}=await load('youtube');
  const native=window.fetch,revision=yt.sessionRevision.bind(yt),getToken=yt.getAccessToken.bind(yt),invalidate=yt.invalidateToken.bind(yt);
  const out=[];let hits=0;
  try{
   window.fetch=async()=>{hits++;return new Response(JSON.stringify({items:[items[0],items[0],{id:{videoId:'bad'},snippet:{title:'Bad'}},{id:{videoId:'valid00000x'},snippet:{title:''}}]}),{status:200})};
   const found=await m.searchAssistantMentions('Test','track');out.push([found.length===1,'réponse dédupliquée et identifiants/titres invalides rejetés']);
   const abort=new AbortController();abort.abort();const before=hits;
   try{await m.searchAssistantMentions('Test','track',abort.signal);out.push([false,'annulation initiale']);}catch(err){out.push([err.name==='AbortError'&&hits===before,'signal déjà annulé : aucune requête']);}
   const old=revision();yt.sessionRevision=()=>old;
   window.fetch=async()=>{yt.sessionRevision=()=>old+1;return new Response(JSON.stringify({items}),{status:200})};
   try{await m.searchAssistantMentions('Test','track');out.push([false,'session modifiée']);}catch(err){out.push([err.message.includes('compte a changé'),'réponse refusée si la session change pendant le réseau']);}
   yt.sessionRevision=revision;let invalidated='';yt.getAccessToken=()=> 'token-test';yt.invalidateToken=token=>{invalidated=token};
   window.fetch=async(url,opts)=>{out.push([opts.headers.Authorization==='Bearer token-test'&&!opts.headers['x-goog-api-key'],'jeton OAuth prioritaire sur la clé API']);return new Response('{}',{status:401})};
   try{await m.searchAssistantMentions('Test','track');}catch(err){out.push([invalidated==='token-test'&&err.message.includes('expirée'),'401 invalide le jeton concerné et explique la reconnexion']);}
   const {block}=await load('storage');block({artist:'Artist 0'},'artist');out.push([isAssistantTrackExcluded(m.mentionTrack(found[0])),'morceau référencé soumis aux exclusions existantes']);
   const same={...found[0],id:'other00000x'};out.push([m.mentionKey(same)!==m.mentionKey(found[0]),'versions homonymes distinguées par leurs identifiants, pas leurs noms']);
  }finally{window.fetch=native;yt.sessionRevision=revision;yt.getAccessToken=getToken;yt.invalidateToken=invalidate;}
  return out;
 },{channel,items});
 for(const [v,l]of unitResults)check(v,l);await unit.c.close();
 const no=await setup(390,844,'light',false);await open(no.p);await search(no.p);await no.p.getByRole('alert').waitFor();check((await no.p.getByRole('alert').innerText()).includes('Connecte ton compte')&&no.state.searches.length===0,'absence de compte/clé expliquée avant tout appel');await no.c.close();
 // Mobile étroit, tablette et desktop, clair/sombre ; captures et audits du dialogue.
 const {default:AxeBuilder}=await import(process.env.SOUNDBLEND_AXE_MODULE||'@axe-core/playwright');
 for(const [w,h,mode]of[[320,568,'light'],[390,844,'dark'],[768,1024,'light'],[1440,1000,'light'],[1440,1000,'dark']]){
  const t=await setup(w,h,mode);await open(t.p);await search(t.p);await results(t.p);await t.p.locator('.sa-picker-result').first().click();
  check(await t.p.getByRole('dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.scrollHeight<=e.clientHeight+1}),`dialogue sans débordement ${w} ${mode}`);
  const ax=await new AxeBuilder({page:t.p}).include('.sa-mention-picker').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  check(ax.violations.length===0,`audit axe dialogue ${w} ${mode} : ${JSON.stringify(ax.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})))}`);
  await t.p.screenshot({path:shots+`recherche-${w}-${mode}.png`});await close(t.p);await t.p.screenshot({path:shots+`mentions-${w}-${mode}.png`});await t.c.close();
 }
 console.log(`\n${checks} contrôles V3 réussis, dont 5 audits axe (API simulées).`);
}finally{await browser.close();}
