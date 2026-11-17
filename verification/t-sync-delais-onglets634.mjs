/* Deux onglets d'un même compte et délais Drive (en-têtes ET corps) simulés. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'*'};
let remote={schema:2,modifie:new Date().toISOString(),appareil:'serveur',apparence:{mode:'light',at:0},reglages:{geminiApiKey:'',at:0},exclusions:[],decouvertes:[],suppressionsBlends:{},portrait:null,blends:[]};let fail=false,holdPatch=false,patchStarted=false,releasePatch;
await ctx.addInitScript(()=>{localStorage.setItem('soundblend_onboarded','1');if(!sessionStorage.getItem('soundblend_google_session_v2'))sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'FAUX',owner:'same-account',expiresAt:Date.now()+3600000,profile:{name:'Même compte',email:'',avatarUrl:''}}));});
await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
 const req=r.request(),u=new URL(req.url()),m=req.method();if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
 if(fail)return r.fulfill({status:503,headers:cors,body:'{}'});
 if(u.pathname.includes('/upload/')&&m==='PATCH'){
  const body=JSON.parse(req.postData());
  if(holdPatch){holdPatch=false;patchStarted=true;return new Promise(resolve=>{releasePatch=()=>{remote=body;resolve(r.fulfill({status:200,headers:cors,body:'{"id":"f1"}'}));}});}
  remote=body;return r.fulfill({status:200,headers:cors,body:'{"id":"f1"}'});
 }
 if(u.searchParams.get('alt')==='media')return r.fulfill({status:200,headers:cors,body:JSON.stringify(remote)});
 return r.fulfill({status:200,headers:cors,body:'{"files":[{"id":"f1","name":"soundblend.json"}]}'});
});
const wait=async(fn,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw new Error(`Délai dépassé : ${label}`)};
const status=p=>p.evaluate(async()=> (await import('/src/services/drive.ts')).etatSync());
const ready=async p=>{const s=await status(p);return s.phase==='pret'&&!s.enAttente};
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
let p,q;
try{
 p=await ctx.newPage();await p.goto(base);await p.waitForSelector('.ytm-shell');await wait(()=>ready(p),'premier onglet');
 q=await ctx.newPage();await q.goto(base);await q.waitForSelector('.ytm-shell');await wait(()=>ready(q),'second onglet');
 await q.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();fail=true;
 await p.evaluate(async()=> (await import('/src/services/storage.ts')).block({artist:'Autre onglet'},'artist'));
 await wait(async()=> (await status(q)).enAttente,'marqueur partagé');
 const qstate=await status(q),text=await q.locator('.sb-sync-line').innerText();
 check(qstate.enAttente&&qstate.phase!=='pret'&&!text.includes('Dernière synchronisation vérifiée'),'un geste en attente dans un onglet rend l’état de l’autre honnête');
 fail=false;await q.getByRole('button',{name:'Synchroniser maintenant'}).click();
 await wait(()=>remote.exclusions.some(x=>x.artist==='Autre onglet')&&ready(q),'reprise depuis le second onglet');
 check(remote.exclusions.some(x=>x.artist==='Autre onglet'&&!x.deleted),'l’autre onglet peut reprendre et envoyer le changement partagé');
 await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());await wait(()=>ready(p),'état avant écritures concurrentes');
 holdPatch=true;await p.evaluate(async()=> (await import('/src/services/storage.ts')).block({artist:'Premier geste en vol'},'artist'));
 const first=await p.evaluate(()=>localStorage.getItem('soundblend_account_v1:same-account:soundblend_sync_pending_v2'));
 const ongoing=p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());await wait(()=>patchStarted,'PATCH bloqué');
 await q.evaluate(async()=> (await import('/src/services/storage.ts')).block({artist:'Deuxième geste en vol'},'artist'));
 const second=await q.evaluate(()=>localStorage.getItem('soundblend_account_v1:same-account:soundblend_sync_pending_v2'));
 check(!!first&&!!second&&first!==second,'chaque geste change le marqueur partagé même si un envoi était déjà en attente');
 await q.close();releasePatch();await ongoing;
 await wait(async()=>remote.exclusions.some(x=>x.artist==='Premier geste en vol')&&remote.exclusions.some(x=>x.artist==='Deuxième geste en vol')&&ready(p),'reprise après fermeture du second onglet');
 check(remote.exclusions.some(x=>x.artist==='Premier geste en vol')&&remote.exclusions.some(x=>x.artist==='Deuxième geste en vol'),'geste du second onglet pendant PATCH repris après fermeture, sans faux état à jour');
 await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());await wait(()=>ready(p),'état initial avant délais');
 await p.evaluate(()=>{
  window.__fetchOrig=window.fetch;window.__timerOrig=window.setTimeout;window.__aborts=0;window.__mode='headers';
  window.setTimeout=(fn,ms,...args)=>window.__timerOrig(fn,ms===12000?120:ms,...args);
  window.fetch=(input,init={})=>{
   const url=String(input);if(!url.includes('googleapis.com/drive/'))return window.__fetchOrig(input,init);
   init.signal.addEventListener('abort',()=>window.__aborts++,{once:true});
   if(window.__mode==='headers')return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
   return Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"files":['))}}),{status:200,headers:{'content-type':'application/json'}}));
  };
 });
 const result1=await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());let s=await status(p);
 check(!result1&&s.phase==='erreur'&&s.enAttente,'Drive sans en-têtes : délai borné, erreur et attente visibles');
 await p.evaluate(()=>window.__mode='body');
 const result2=await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());s=await status(p);
 check(!result2&&s.phase==='erreur'&&s.enAttente,'corps Drive figé après les en-têtes : délai borné et erreur');
 check(await p.evaluate(()=>window.__aborts)>=2,'les deux requêtes bloquées reçoivent un signal d’annulation');
 await p.evaluate(()=>{window.fetch=window.__fetchOrig;window.setTimeout=window.__timerOrig});
 check(await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync()),'nouvel essai possible après rétablissement');await wait(()=>ready(p),'fin du nouvel essai');
 check(remote.exclusions.some(x=>x.artist==='Autre onglet')&&!((await status(p)).enAttente),'reprise confirmée sans perdre la modification');
 await p.evaluate(async()=>{
  const original=Storage.prototype.removeItem;window.__removeOrig=original;
  Storage.prototype.removeItem=function(key){if(this===localStorage&&String(key).endsWith(':soundblend_sync_pending_v2'))throw new DOMException('refus','SecurityError');return original.call(this,key)};
  (await import('/src/services/storage.ts')).block({artist:'Marqueur non effaçable'},'artist');
 });
 const unable=await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());s=await status(p);
 check(!unable&&s.phase==='erreur'&&s.enAttente&&s.message.includes('Stockage local')&&remote.exclusions.some(x=>x.artist==='Marqueur non effaçable'),'marqueur local impossible à effacer : état prudent malgré l’envoi reçu par Drive');
 await p.evaluate(()=>Storage.prototype.removeItem=window.__removeOrig);
 check(await p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync())&&await ready(p),'après rétablissement du stockage, synchronisation confirmée');
 console.log(`\n${n}/${n} contrôles délais et onglets réussis — Drive simulé.`);
}finally{await ctx.close();await browser.close();}
