/* Durée du jeton OAuth et vérification d'identité — Google entièrement simulé. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'*'};
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const wait=async(fn,label,ms=6000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error(`Délai dépassé : ${label}`)};
async function run(kind){
 const legacy=kind==='legacy',delay=kind==='during'||legacy?1200:kind==='valid'?850:0,secs=kind==='missing'?null:kind==='during'?1:2;
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),calls=[];
 await ctx.addInitScript(({legacy,secs})=>{
  localStorage.setItem('soundblend_onboarded','1');window.__seconds=secs;
  if(legacy){localStorage.setItem('soundblend_yt_token','FAUX-ANCIEN');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+800));localStorage.setItem('soundblend_settings',JSON.stringify({geminiApiKey:'ANCIENNE-CLE'}));}
 },{legacy,secs});
 await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'FAUX',expires_in:window.__seconds}),10)}),revoke:(_t,cb)=>cb()}}};`}));
 await ctx.route('https://www.googleapis.com/oauth2/**',async r=>{calls.push('profil');if(delay)await new Promise(resolve=>setTimeout(resolve,delay));return r.fulfill({status:200,headers:cors,body:'{"id":"compte-verifie","name":"Test"}'}).catch(()=>{});});
 await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
 await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{calls.push('drive');return r.fulfill({status:503,headers:cors,body:'{}'});});
 const p=await ctx.newPage();await p.goto(base);await p.waitForSelector('.ytm-shell');await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
 if(legacy){
  await p.getByText(/ancienne session Google a expiré pendant sa vérification/i).waitFor();
  check(await p.evaluate(async()=> (await import('/src/services/accountScope.ts')).accountScope())===null&&!calls.includes('drive'),'ancienne session expirée pendant l’identité : aucun compte activé ni accès Drive');
  check(await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_settings')).geminiApiKey)==='ANCIENNE-CLE','ancienne clé locale conservée après expiration pendant la migration');
 }else{
  await p.getByRole('button',{name:'Connecter mon compte',exact:true}).click();
  if(kind==='missing'){
   await p.getByText(/jeton expiré ou sans durée fiable/i).waitFor();
   check(!calls.includes('profil')&&!calls.includes('drive')&&await p.evaluate(async()=> (await import('/src/services/accountScope.ts')).accountScope())===null,'durée absente : connexion refusée sans activation ni synchronisation');
  }else if(kind==='during'){
   await p.getByText(/jeton Google a expiré pendant la vérification/i).waitFor();
   check(calls.includes('profil')&&!calls.includes('drive')&&await p.evaluate(async()=> (await import('/src/services/accountScope.ts')).accountScope())===null,'jeton expiré pendant le profil : aucune activation ni synchronisation');
  }else{
   await p.getByRole('button',{name:'Se déconnecter'}).waitFor();
   const remaining=await p.evaluate(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')).expiresAt-Date.now());
   check(remaining>0&&remaining<1700,`durée comptée dès la réception du jeton, pas après le profil (${remaining} ms restantes)`);
   await wait(async()=>await p.getByRole('button',{name:'Reconnecter ce compte'}).isVisible(),'expiration visible');
   check(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')).expiresAt)===0,'expiration réelle affichée et persistée dans la session de l’onglet');
  }
 }
 await ctx.close();
}
try{await run('missing');await run('during');await run('valid');await run('legacy');console.log(`\n${n}/${n} contrôles d’expiration OAuth réussis — services simulés.`);}finally{await browser.close();}
