import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({args:['--no-sandbox']});let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('✓ '+label)};
const c=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:850}});
await c.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
await c.route(/^https:\/\//,r=>r.abort());
const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.dismiss());
try{
 await p.goto(base);await p.locator('.sb-link-login').waitFor();await p.clock.install();
 await p.evaluate(()=>{window.__blockNavigation=true;window.addEventListener('beforeunload',e=>{if(window.__blockNavigation){e.preventDefault();e.returnValue=''}})});
 for(let i=0;i<3;i++){
  await p.locator('.sb-link-login').click();await p.waitForFunction(()=>!!sessionStorage.getItem('soundblend_oauth_redirect_pending'));
  check(await p.locator('.sb-google-status').count()===0,'tentative '+(i+1)+' : bandeau absent immédiatement');
  await p.clock.fastForward(2900);check(await p.locator('.sb-google-status').count()===0,'bandeau toujours masqué avant 3 secondes');
  await p.clock.fastForward(150);await p.getByRole('button',{name:'Annuler la connexion Google'}).waitFor();
  check(await p.locator('.sb-link-login').isDisabled(),'bandeau après 3 secondes, tentative unique protégée');
  await p.getByRole('button',{name:'Annuler la connexion Google'}).click();
  check(await p.locator('.sb-google-status').count()===0&&await p.locator('.sb-link-login').isEnabled(),'Annuler ferme le bandeau et réactive la connexion sans recharger');
  check(await p.evaluate(()=>!sessionStorage.getItem('soundblend_oauth_redirect_pending')&&!sessionStorage.getItem('soundblend_google_session_v2')),'Annuler supprime le state OAuth, sans créer de session');
 }
 await c.route('https://accounts.google.com/o/oauth2/v2/auth?**',r=>r.fulfill({status:200,contentType:'text/html',body:'<title>Google simulé</title><p>Page de connexion simulée, aucun compte demandé.</p>'}));
 await p.evaluate(()=>window.__blockNavigation=false);
 await p.locator('.sb-link-login').click();await p.waitForURL('https://accounts.google.com/**');
 check(p.url().startsWith('https://accounts.google.com/'),'navigation complète vers une page Google simulée');
 await p.goBack();await p.locator('.sb-link-login').waitFor();
 check(await p.locator('.sb-link-login').isEnabled(),'vrai retour historique du navigateur : reconnexion possible sans rechargement manuel');
 await p.evaluate(()=>{window.__blockNavigation=true;window.addEventListener('beforeunload',e=>{if(window.__blockNavigation){e.preventDefault();e.returnValue=''}})});
 await p.locator('.sb-link-login').click();await p.waitForFunction(()=>!!sessionStorage.getItem('soundblend_oauth_redirect_pending'));
 await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 check(await p.locator('.sb-link-login').isEnabled()&&await p.locator('.sb-google-status').count()===0,'retour de page BFCache simulé : tentative libérée immédiatement');
 await p.evaluate(async()=>{const {youtubeService}=await import('/src/services/youtube.ts');youtubeService.setLoginState({phase:'error',code:'test_error',message:'Erreur Google simulée.'})});
 check(await p.getByRole('alert').count()===1,'une erreur Google réelle ne reste pas cachée pendant le délai');
 await p.getByRole('button',{name:'Fermer le message de connexion'}).click();
 let release;const pending=new Promise(r=>release=r);
 await c.route('https://www.googleapis.com/oauth2/v2/userinfo',async r=>{await pending;await r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:'late-account',name:'Test tardif'})}).catch(()=>{})});
 await p.evaluate(async()=>{
  const {youtubeService}=await import('/src/services/youtube.ts');const state='v10-test-state';sessionStorage.setItem('soundblend_oauth_redirect_pending',JSON.stringify({state,startedAt:Date.now()}));
  window.__sbOAuthReturn={token:'fake-token',error:null,state,scope:'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile',expiresIn:'3600',receivedAt:Date.now()};
  void youtubeService.completeRedirectLogin();
 });
 await p.getByText('Réponse reçue. Vérification du compte auprès de Google…',{exact:true}).waitFor();
 await p.getByRole('button',{name:'Annuler la connexion Google'}).click();release();await p.waitForTimeout(200);
 check(await p.evaluate(()=>!sessionStorage.getItem('soundblend_google_session_v2'))&&await p.locator('.sb-link-login').isEnabled(),'annuler la vérification ignore un profil reçu tardivement');
 check(errors.length===0,'aucune exception ni rejet de promesse non géré');
 console.log(`${checks} contrôles de connexion V10 réussis (navigation bloquée volontairement, pas de compte réel).`);
}finally{await browser.close()}
