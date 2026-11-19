/* Refuser les fichiers Drive incompris plutôt que les écraser. Services simulés. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({serviceWorkers:'block'}),cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,OPTIONS','access-control-allow-headers':'*'};
const blank=()=>({schema:2,modifie:new Date().toISOString(),appareil:'fictif',apparence:{mode:'light',at:0},reglages:{geminiApiKey:'',at:0},exclusions:[],decouvertes:[],suppressionsBlends:{},portrait:null,blends:[]});
let remote=blank(),patches=0,posts=0,listOverride=null,missingFile=false;
await ctx.addInitScript(()=>{localStorage.setItem('soundblend_onboarded','1');sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'FAUX',owner:'compte-fictif',expiresAt:Date.now()+3600000,profile:{name:'Test',email:'',avatarUrl:''}}));});
await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
 const req=r.request(),u=new URL(req.url()),m=req.method();if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
 if(u.pathname.includes('/upload/')&&m==='PATCH'){patches++;remote=JSON.parse(req.postData());return r.fulfill({status:200,headers:cors,body:'{"id":"f1"}'});}
 if(u.pathname.includes('/upload/')&&m==='POST'){posts++;return r.fulfill({status:200,headers:cors,body:'{"id":"nouveau"}'});}
 if(u.searchParams.get('alt')==='media')return r.fulfill({status:missingFile?404:200,headers:cors,body:missingFile?'{}':typeof remote==='string'?remote:JSON.stringify(remote)});
 return r.fulfill({status:200,headers:cors,body:JSON.stringify(listOverride||{files:[{id:'f1',name:'soundblend.json'}]})});
});
const p=await ctx.newPage();let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const wait=async(fn,label)=>{const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error(label)};
const etat=()=>p.evaluate(async()=> (await import('/src/services/drive.ts')).etatSync());
const sync=()=>p.evaluate(async()=>await (await import('/src/services/drive.ts')).demarrerSync());
try{
 await p.goto(base);await p.waitForSelector('.ytm-shell');await wait(async()=> (await etat()).phase==='pret','initialisation Drive');
 await p.evaluate(async()=> (await import('/src/services/storage.ts')).block({artist:'Local à préserver'},'artist'));
 const b={id:'b',title:'Distant',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),seedTracks:[],tracks:[]};
 const cases=[
  ['JSON tronqué','{"schema":2,'],
  ['version future',{...blank(),schema:3}],
  ['version absente',{...blank(),schema:undefined}],
  ['exclusions au mauvais format',{...blank(),exclusions:{id:'malforme'}}],
  ['exclusion malformée',{...blank(),exclusions:[{id:'artist:x',kind:'artist',artist:'X',updatedAt:'hier',deleted:false}]}],
  ['clé distante au mauvais format',{...blank(),reglages:{geminiApiKey:42,at:0}}],
  ['titres de blend illisibles',{...blank(),blends:[{...b,tracks:'perdu'}]}],
  ['suppressions malformées',{...blank(),suppressionsBlends:{b:{at:1,expiresAt:'jamais'}}}],
  ['champ de schéma inconnu',{...blank(),champNouvelleVersion:{donnees:'à conserver'}}],
  ['champ de réglages inconnu',{...blank(),reglages:{geminiApiKey:'',at:0,nouveauChamp:'à conserver'}}],
 ];
 for(const [label,value] of cases){
  remote=value;const before=typeof value==='string'?value:JSON.stringify(value),count=patches;
  const ok=await sync(),s=await etat();
  check(!ok&&s.phase==='erreur'&&s.enAttente&&s.message.includes('illisible')&&patches===count&&(typeof remote==='string'?remote:JSON.stringify(remote))===before,`${label} : erreur explicite, aucun PATCH et attente conservée`);
 }
 remote=blank();
 for(const [label,value] of [['identifiant absent',{files:[{name:'soundblend.json'}]}],['nom absent',{files:[{id:'f1'}]}],['nom inattendu',{files:[{id:'f1',name:'autre.json'}]}]]){
  listOverride=value;const before=patches,created=posts;const ok=await sync(),s=await etat();
  check(!ok&&s.phase==='erreur'&&s.enAttente&&s.message.includes('illisible')&&patches===before&&posts===created,`${label} dans la liste : aucune écriture ni création aveugle`);
 }
 listOverride=null;missingFile=true;const before404=patches,posts404=posts;
 const absent=await sync();check(!absent&&(await etat()).enAttente&&patches===before404&&posts===posts404,'fichier listé puis 404 : aucun nouveau fichier créé sans relistage ultérieur');
 missingFile=false;check(await sync(),'reprise possible après restauration d’un fichier valide');
 check(remote.exclusions.some(x=>x.artist==='Local à préserver')&&!(await etat()).enAttente,'modification locale préservée et confirmée après réparation');
 console.log(`\n${n}/${n} contrôles fichiers Drive réussis — API simulée.`);
}finally{await ctx.close();await browser.close();}
