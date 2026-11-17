/* Mise à jour depuis une ancienne session OAuth globale : données séparées,
   identité vérifiée avant Drive ; pas de Google ou de données réelles. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'*'};
const wait=async(fn,label,ms=10000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw new Error(`Délai dépassé : ${label}`)};
let n=0;const check=(v,s)=>{assert.ok(v,s);n++;console.log(`  ✓ ${s}`)};
async function run(kind){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'light'});
 await ctx.addInitScript(({kind})=>{
  if(localStorage.getItem('__seed'))return;localStorage.setItem('__seed','1');localStorage.setItem('soundblend_onboarded','1');
  localStorage.setItem('soundblend_yt_token','ancien-jeton');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+(kind==='expired'?-1000:3600000)));
  localStorage.setItem('soundblend_yt_user',JSON.stringify({name:'Ancien nom non fiable',email:'ancien@example.test'}));
  localStorage.setItem('soundblend_settings',JSON.stringify({geminiApiKey:'CLE-LOCALE-ANCIENNE'}));localStorage.setItem('soundblend_mode','dark');
  localStorage.setItem('soundblend_taste_memory',JSON.stringify({anciens:'pouces'}));
  localStorage.setItem('soundblend_exclusions_v1',JSON.stringify([{id:'artist:ancien',kind:'artist',artist:'Ancien',updatedAt:Date.now(),deleted:false}]));
 },{kind});
 const seen=[];let data={schema:2,modifie:new Date().toISOString(),appareil:'distant',apparence:{mode:'light',at:0},reglages:{geminiApiKey:'',at:0},exclusions:[],decouvertes:[],suppressionsBlends:{},blends:[],portrait:null};
 await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};'}));
 await ctx.route('https://www.googleapis.com/oauth2/**',r=>{seen.push('userinfo');return r.fulfill({status:kind==='failed'?503:200,headers:cors,body:kind==='failed'?'{}':JSON.stringify({id:'123456789',name:'Identité confirmée'})});});
 await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
 await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
  const req=r.request(),u=new URL(req.url()),m=req.method();seen.push('drive:'+m);
  if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
  if(u.pathname.includes('/upload/')&&m==='PATCH'){data=JSON.parse(req.postData());return r.fulfill({status:200,headers:cors,body:'{"id":"f1"}'});}
  if(u.searchParams.get('alt')==='media')return r.fulfill({status:200,headers:cors,body:JSON.stringify(data)});
  return r.fulfill({status:200,headers:cors,body:'{"files":[{"id":"f1","name":"soundblend.json"}]}'});
 });
 const p=await ctx.newPage();await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
 if(kind==='ok'){
  await wait(async()=>p.evaluate(async()=>{const d=await import('/src/services/drive.ts');return d.etatSync().phase==='pret'}),'restauration vérifiée');
  const info=await p.evaluate(async()=>({scope:(await import('/src/services/accountScope.ts')).accountScope(),settings:(await import('/src/services/storage.ts')).getStoredSettings(),raw:localStorage.getItem('soundblend_settings'),oldToken:localStorage.getItem('soundblend_yt_token'),session:!!sessionStorage.getItem('soundblend_google_session_v2'),thumb:localStorage.getItem('soundblend_taste_memory')}));
  check(info.scope==='123456789'&&info.session&&!info.oldToken&&seen[0]==='userinfo'&&seen.some(x=>x.startsWith('drive:')),'ancienne session restaurée seulement après identité Google stable vérifiée');
  check(info.settings.geminiApiKey===''&&data.reglages.geminiApiKey===''&&data.exclusions.length===0&&!JSON.stringify(data).includes('Ancien'),'données locales historiques non importées dans le compte restauré');
  check(JSON.parse(info.raw).geminiApiKey==='CLE-LOCALE-ANCIENNE'&&!!info.thumb,'clé et anciennes données historiques conservées dans l’espace local séparé');
  await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');
  check(await p.evaluate(async()=> (await import('/src/services/accountScope.ts')).accountScope())==='123456789','rechargement : espace du compte vérifié retrouvé dans cet onglet');
 } else {
  await p.getByRole('button',{name:'Connecter mon compte',exact:true}).waitFor();await p.waitForTimeout(300);
  const scope=await p.evaluate(async()=> (await import('/src/services/accountScope.ts')).accountScope());
  check(scope===null&&!seen.some(x=>x.startsWith('drive:')),kind==='failed'?'profil inaccessible : aucune synchro et retour à l’espace local':'ancien jeton expiré : aucun accès Drive et espace local conservé');
  if(kind==='failed')check((await p.locator('.ytm-page').innerText()).includes('Ancienne session non vérifiée'),'échec de vérification expliqué dans les réglages');
 }
 await ctx.close();
}
try{await run('ok');await run('failed');await run('expired');console.log(`\n${n}/${n} contrôles de migration réussis — services simulés.`);}finally{await browser.close();}
