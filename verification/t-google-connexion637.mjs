/* Connexion Google : interface réelle, OAuth/identités/Drive/YouTube simulés.
   Profils Chromium temporaires ; aucun compte ni jeton réel. Compatible source
   et site compilé à la racine ou en sous-dossier. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'*'};
let n=0;
const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('  ✓ '+label)};
const stub=`window.__configs=[];window.__requests=[];
window.google={accounts:{oauth2:{
 initTokenClient:c=>{const i=window.__configs.push(c)-1;return {requestAccessToken:o=>window.__requests.push({i,activation:!!navigator.userActivation?.isActive,prompt:o?.prompt})}},
 revoke:(_token,cb)=>cb&&cb()
}}};`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function newEnv({onboarded=true,shortTimeout=false}={}){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[],profileCalls=[];
 let hold=false,gate=Promise.resolve(),release=()=>{},profileMode='ok';
 await ctx.addInitScript(({onboarded,shortTimeout})=>{
  if(onboarded)localStorage.setItem('soundblend_onboarded','1');
  if(shortTimeout){const original=window.setTimeout;window.setTimeout=function(fn,ms,...rest){return original(fn,ms===180000?500:ms,...rest)}}
 },{onboarded,shortTimeout});
 await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await ctx.route('https://accounts.google.com/gsi/client',r=>r.fulfill({status:200,contentType:'application/javascript',body:stub}));
 await ctx.route('https://www.googleapis.com/oauth2/**',async r=>{
  const auth=r.request().headers().authorization||'';const who=auth.endsWith('-A')?'A':auth.endsWith('-B')?'B':'?';
  profileCalls.push(who);if(hold)await gate;
  if(profileMode==='http')return r.fulfill({status:403,headers,body:'{}'}).catch(()=>{});
  if(profileMode==='no-id')return r.fulfill({status:200,headers,body:'{"name":"Compte fictif"}'}).catch(()=>{});
  return r.fulfill({status:200,headers,body:JSON.stringify({id:'google-'+who,name:'Compte '+who})}).catch(()=>{});
 });
 await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers,body:'{"items":[]}'}));
 await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>r.fulfill({status:503,headers,body:'{}'}));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!window.google?.accounts?.oauth2);
 if(onboarded)await p.waitForSelector('.ytm-shell');else await p.waitForSelector('.welcome');
 const session=()=>p.evaluate(()=>{const x=JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')||'null');return {owner:x?.owner||null,hasToken:!!x?.token}});
 const count=()=>p.evaluate(()=>window.__configs.length);
 const fire=(i,which,data)=>p.evaluate(({i,which,data})=>{window.__configs[i][which](data)},{i,which,data});
 const waitCode=code=>p.locator('.sb-google-status').getByText('Code : '+code,{exact:true}).waitFor({timeout:6000});
 const dismiss=async()=>{const button=p.getByRole('button',{name:'Fermer le message de connexion'});if(await button.count())await button.click()};
 const start=async(locator)=>{const before=await count();await locator.click();await p.waitForFunction(before=>window.__configs.length===before+1,before);return before};
 const success=(i,who)=>fire(i,'callback',{access_token:'FAUX-'+who,expires_in:3600});
 const waiting=()=>p.getByRole('button',{name:'Annuler la connexion Google'}).waitFor();
 const holdProfile=()=>{hold=true;gate=new Promise(r=>{release=r})};
 const releaseProfile=()=>{hold=false;release()};
 const setProfileMode=m=>{profileMode=m};
 return {ctx,p,errors,profileCalls,session,count,fire,waitCode,dismiss,start,success,waiting,holdProfile,releaseProfile,setProfileMode};
}
async function testMain(){
 const e=await newEnv(),{p,ctx,errors,profileCalls,session,fire,waitCode,dismiss,start,success,holdProfile,releaseProfile,setProfileMode}=e;
 const settingsNav=p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]');
 const libraryNav=p.locator('.ytm-mobile-bar [aria-label="Bibliothèque"]');
 const connectSettings=()=>p.getByRole('button',{name:/^(Connecter mon compte|Reconnecter ce compte)$/});
 const logout=async()=>{await p.getByRole('button',{name:'Se déconnecter'}).click();await connectSettings().waitFor()};
 const settings=async()=>{await settingsNav.click();await p.getByRole('heading',{name:'Réglages',exact:true}).waitFor();await p.waitForTimeout(350)};
 const library=async()=>{await libraryNav.click();await p.getByRole('heading',{name:'Ta bibliothèque'}).waitFor();await p.waitForTimeout(350)};
 const status=p.locator('.sb-google-status');
 try{
  let i=await start(p.locator('.sb-link-login'));await e.waiting();
  const req=await p.evaluate(()=>window.__requests.at(-1));
  check(req.activation&&req.prompt==='consent','ouverture du client pendant le geste utilisateur, avec consentement');
  check(await p.locator('.sb-link-login').isDisabled()&&await p.locator('[aria-label="Rafraîchir"]').isDisabled(),'accueil : clics répétés désactivés pendant la connexion');
  await settings();
  check(await p.getByRole('button',{name:'Connexion en cours…'}).isDisabled()&&await status.isVisible(),'état et annulation restent visibles après changement de vue');
  await p.getByRole('button',{name:'Annuler la connexion Google'}).click();await waitCode('cancelled');
  const before=profileCalls.length;await success(i,'A');await p.waitForTimeout(200);
  check((await session()).owner===null&&profileCalls.length===before,'annulation : réponse tardive ignorée sans vérification ni connexion');
  await dismiss();

  i=await start(connectSettings());await fire(i,'error_callback',{type:'popup_failed_to_open'});await waitCode('popup_failed_to_open');
  check((await status.innerText()).includes('n’a pas pu s’ouvrir')&&await connectSettings().isEnabled(),'popup bloquée : erreur précise et nouvel essai possible');
  await dismiss();
  i=await start(connectSettings());await fire(i,'callback',{error:'access_denied',error_description:'FAUX-SECRET-NE-PAS-AFFICHER'});await waitCode('access_denied');
  check(!(await p.locator('body').innerText()).includes('FAUX-SECRET-NE-PAS-AFFICHER')&&(await session()).owner===null,'refus OAuth : code utile, description brute non affichée');
  await dismiss();
  i=await start(connectSettings());await fire(i,'error_callback',{type:'FAUX-SECRET-NE-PAS-AFFICHER',message:'FAUX-SECRET-NE-PAS-AFFICHER'});await waitCode('google_error');
  check(!(await p.locator('body').innerText()).includes('FAUX-SECRET-NE-PAS-AFFICHER'),'erreur Google inconnue : aucune donnée brute affichée');await dismiss();
  i=await start(connectSettings());await fire(i,'callback',null);await waitCode('invalid_response');
  check((await session()).owner===null,'réponse OAuth mal formée : aucune connexion et aucun plantage');await dismiss();
  i=await start(connectSettings());await fire(i,'callback',{expires_in:3600});await waitCode('token_missing');
  check((await session()).owner===null,'absence de jeton : compte non activé');await dismiss();
  i=await start(connectSettings());await fire(i,'callback',{access_token:'FAUX-A',expires_in:0});await waitCode('invalid_expiry');
  check((await session()).owner===null,'durée de jeton invalide : compte non activé');await dismiss();
  setProfileMode('http');i=await start(connectSettings());await success(i,'A');await waitCode('profile_check');
  check((await status.innerText()).includes('HTTP 403')&&(await session()).owner===null,'vérification identité HTTP 403 : erreur précise, aucun compte activé');await dismiss();
  setProfileMode('no-id');i=await start(connectSettings());await success(i,'A');await waitCode('profile_check');
  check((await status.innerText()).includes('identifiant de compte absent')&&(await session()).owner===null,'identité sans ID stable : compte non activé');await dismiss();setProfileMode('ok');

  i=await start(connectSettings());await fire(i,'error_callback',{type:'popup_closed'});await waitCode('popup_closed');
  check(await p.getByRole('button',{name:'Connexion en cours…'}).isDisabled()&&await p.getByRole('button',{name:'Annuler la connexion Google'}).isVisible(),'fermeture signalée : attente bornée et annulation explicite, sans prétendre à un refus');
  const beforeA=profileCalls.length;await success(i,'A');await p.getByRole('button',{name:'Se déconnecter'}).waitFor();
  check((await session()).owner==='google-A'&&profileCalls.slice(beforeA).join(',')==='A','réponse valide après popup_closed : identité vérifiée et compte A activé');
  await fire(i,'callback',{access_token:'FAUX-B',expires_in:3600});await p.waitForTimeout(150);
  check((await session()).owner==='google-A'&&profileCalls.slice(beforeA).join(',')==='A','callback dupliqué : ne peut ni vérifier ni activer B');
  await library();await p.getByText('Aucune playlist YouTube',{exact:true}).waitFor();
  check(await p.getByText('Aucune playlist YouTube',{exact:true}).isVisible()&&await p.getByRole('button',{name:'Connecter YouTube'}).count()===0,'compte connecté sans playlist : aucune fausse invitation à reconnecter');
  await settings();await logout();

  i=await start(connectSettings());holdProfile();const beforeB=profileCalls.length;await success(i,'B');
  await p.waitForFunction(()=>document.querySelector('.sb-google-status')?.textContent.includes('Vérification du compte'));
  while(profileCalls.length===beforeB)await pause(30);
  await fire(i,'error_callback',{type:'popup_closed'});await fire(i,'error_callback',{type:'popup_failed_to_open'});
  check((await status.innerText()).includes('Vérification du compte')&&(await session()).owner===null,'après réception du jeton, les erreurs de fenêtre ne coupent pas la vérification');
  releaseProfile();await p.getByRole('button',{name:'Se déconnecter'}).waitFor();
  check((await session()).owner==='google-B','vérification terminée : seul le compte B est activé');
  await logout();

  i=await start(connectSettings());holdProfile();const oldCalls=profileCalls.length;await success(i,'A');
  while(profileCalls.length===oldCalls)await pause(30);
  await p.getByRole('button',{name:'Annuler la connexion Google'}).click();await waitCode('cancelled');
  releaseProfile();await p.waitForTimeout(200);
  check((await session()).owner===null,'annulation pendant la vérification : profil tardif non activé');
  await dismiss();const j=await start(connectSettings());await success(i,'A');await fire(i,'error_callback',{type:'popup_failed_to_open'});
  check(await p.getByRole('button',{name:'Connexion en cours…'}).isDisabled()&&(await session()).owner===null,'ancienne tentative ne peut pas interrompre la nouvelle');
  await success(j,'B');await p.getByRole('button',{name:'Se déconnecter'}).waitFor();
  check((await session()).owner==='google-B','nouvelle tentative active le compte B, sans réactiver A');
  await logout();await library();
  i=await start(p.locator('[aria-label="Rafraîchir"]'));await fire(i,'error_callback',{type:'popup_failed_to_open'});await waitCode('popup_failed_to_open');
  check((await status.innerText()).includes('fenêtre Google')&&(await session()).owner===null,'bouton Rafraîchir déconnecté : erreur gérée et diagnostic visible');
  check(errors.length===0,`aucune exception JavaScript non traitée (${errors.join('; ')})`);
 }finally{releaseProfile();await ctx.close()}
}
async function testTimeout(){
 const e=await newEnv({shortTimeout:true}),{p,ctx,fire,start,waitCode,session,success}=e;
 try{
  let i=await start(p.locator('.sb-link-login'));await fire(i,'error_callback',{type:'popup_closed'});await waitCode('popup_closed');
  await p.waitForFunction(()=>document.querySelector('.sb-google-status[data-error="true"]')?.textContent.includes('aucune réponse'));
  const before=await session();await success(i,'A');await p.waitForTimeout(100);
  check(before.owner===null&&(await session()).owner===null&&await p.locator('.sb-link-login').isEnabled(),'fermeture sans réponse : délai borné, réessai possible, réponse tardive ignorée');
  await e.dismiss();i=await start(p.locator('.sb-link-login'));await waitCode('timeout');
  check((await session()).owner===null&&await p.locator('.sb-link-login').isEnabled(),'absence de tout retour Google : délai borné et interface libérée');
  await e.dismiss();e.holdProfile();i=await start(p.locator('.sb-link-login'));
  await p.waitForTimeout(220);await success(i,'A');
  await p.waitForFunction(()=>document.querySelector('.sb-google-status')?.textContent.includes('Vérification du compte'));
  await p.waitForTimeout(650);e.releaseProfile();
  await p.waitForFunction(()=>!!sessionStorage.getItem('soundblend_google_session_v2'));
  check((await session()).owner==='google-A','réponse reçue avant l’échéance : la vérification dispose de son propre délai');
 }finally{e.releaseProfile();await ctx.close()}
}
async function testWelcome(){
 const e=await newEnv({onboarded:false}),{p,ctx,start,fire,session,success,waitCode,errors}=e;
 try{
  await p.locator('.welcome-cta').getByText('Continuer').click();await p.getByRole('heading',{name:'Ton compte Google.'}).waitFor();
  const i=await start(p.getByRole('button',{name:'Se connecter avec Google'}));await fire(i,'error_callback',{type:'popup_closed'});await waitCode('popup_closed');
  check(await p.getByRole('button',{name:'Annuler la connexion Google'}).isVisible(),'première visite : attente et annulation accessibles');
  await p.locator('.welcome-cta').getByText('Plus tard').click();await p.getByRole('heading',{name:'La clé qui compose.'}).waitFor();
  await success(i,'A');await p.waitForTimeout(150);
  check((await session()).owner===null&&errors.length===0,'Plus tard annule la tentative ; un retour tardif ne connecte pas le compte');
 }finally{await ctx.close()}
}
try{await testMain();await testTimeout();await testWelcome();console.log(`\n${n}/${n} contrôles de connexion réussis — OAuth et services simulés.`)}finally{await browser.close()}
