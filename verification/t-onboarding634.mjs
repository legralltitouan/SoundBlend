/* Première visite : compte avant clé, séparation des espaces, erreurs de stockage. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,OPTIONS','access-control-allow-headers':'*'};
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
async function run(kind){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'light'}),errors=[];
 await ctx.addInitScript(({kind})=>{
  if(kind==='connected')localStorage.setItem('soundblend_settings',JSON.stringify({geminiApiKey:'CLE-LOCALE-HISTORIQUE'}));
  window.__failSettings=false;const old=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){if(window.__failSettings&&this===localStorage&&String(k).endsWith('soundblend_settings'))throw new DOMException('quota','QuotaExceededError');return old.call(this,k,v)};
 },{kind});
 await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'FAUX',expires_in:3600}),10)}),revoke:(_t,cb)=>cb()}}};`}));
 await ctx.route('https://www.googleapis.com/oauth2/**',r=>r.fulfill({status:200,headers:cors,body:'{"id":"onboarding-A","name":"Compte A"}'}));
 await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
 await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>r.fulfill({status:503,headers:cors,body:'{}'}));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator('.welcome').waitFor();
 await p.getByRole('button',{name:/Sombre/}).click();await p.locator('.welcome-cta').getByText('Continuer').click();
 await p.getByRole('heading',{name:'Ton compte Google.'}).waitFor();
 if(kind==='connected'){
  check(await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_mode_v2')).mode)==='dark','choix de thème avant connexion enregistré dans l’espace local');
  await p.getByRole('button',{name:'Se connecter avec Google'}).click();await p.getByText('Compte A',{exact:true}).waitFor();
  await p.locator('.welcome-cta').getByText('Continuer').click();
  await p.getByRole('heading',{name:'La clé qui compose.'}).waitFor();
  check(await p.getByLabel('Clé API Gemini').inputValue()==='','clé historique locale non préremplie après connexion du compte A');
  await p.getByLabel('Clé API Gemini').fill('CLE-COMPTE-A');await p.locator('.welcome-cta').getByText('Continuer').click();
  await p.getByRole('heading',{name:'Tout est prêt.'}).waitFor();
  const keys=await p.evaluate(()=>({local:JSON.parse(localStorage.getItem('soundblend_settings')).geminiApiKey,account:JSON.parse(localStorage.getItem('soundblend_account_v1:onboarding-A:soundblend_settings')).geminiApiKey}));
  check(keys.local==='CLE-LOCALE-HISTORIQUE'&&keys.account==='CLE-COMPTE-A','clé saisie après connexion rangée uniquement dans le compte, ancienne clé préservée');
 }else{
  await p.locator('.welcome-cta').getByText('Plus tard').click();await p.getByRole('heading',{name:'La clé qui compose.'}).waitFor();
  await p.getByLabel('Clé API Gemini').fill('CLE-SANS-COMPTE');
  if(kind==='quota'){
   await p.evaluate(()=>window.__failSettings=true);await p.locator('.welcome-cta').getByText('Continuer').click();
   await p.getByText(/Stockage local indisponible ou plein/).waitFor();
   check(await p.getByRole('heading',{name:'La clé qui compose.'}).isVisible()&&await p.evaluate(()=>!localStorage.getItem('soundblend_settings')),'refus de stockage de la clé : erreur visible et étape non validée');
   await p.evaluate(()=>window.__failSettings=false);
  }
  await p.locator('.welcome-cta').getByText('Continuer').click();await p.getByRole('heading',{name:'Tout est prêt.'}).waitFor();
  check(await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_settings')).geminiApiKey)==='CLE-SANS-COMPTE','sans connexion, la clé est enregistrée uniquement dans l’espace local');
 }
 await p.getByRole('button',{name:'Entrer dans SoundBlend'}).click();await p.waitForSelector('.ytm-shell');
 check(errors.length===0,`parcours ${kind} terminé sans exception JavaScript (${errors.join('; ')})`);await ctx.close();
}
try{await run('connected');await run('local');await run('quota');console.log(`\n${n}/${n} contrôles d’accueil réussis — services simulés.`);}finally{await browser.close();}
