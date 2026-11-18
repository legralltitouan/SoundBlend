/* Courses du service OAuth et des comptes — sources Vite, tout simulé.
   Jamais de compte, jeton ou requête utilisateur réels. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const b=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const c=await b.newContext({serviceWorkers:'block'}),headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*'};
const calls=[];let holdFor='',release=()=>{},gate=Promise.resolve(),rejectFor='';
const setHold=who=>{holdFor=who;gate=new Promise(r=>{release=r})};
const unblock=()=>{holdFor='';release()};
await c.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
await c.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await c.route('https://accounts.google.com/gsi/client',r=>r.fulfill({status:200,contentType:'application/javascript',body:`window.__cfg=[];window.google={accounts:{oauth2:{initTokenClient:o=>{window.__cfg.push(o);return{requestAccessToken(){}}},revoke:(_t,cb)=>cb&&cb()}}};`}));
await c.route('https://www.googleapis.com/oauth2/**',async r=>{
 const h=r.request().headers().authorization||'';const who=h.endsWith('-OLD')?'OLD':h.endsWith('-A')?'A':h.endsWith('-B')?'B':'?';calls.push(who);
 if(holdFor===who)await gate;
 if(rejectFor===who)return r.fulfill({status:403,headers,body:'{}'}).catch(()=>{});
 return r.fulfill({status:200,headers,body:JSON.stringify({id:'google-'+who,name:'Compte '+who})}).catch(()=>{});
});
await c.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers,body:'{"items":[]}'}));
await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>r.fulfill({status:503,headers,body:'{}'}));
const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
let n=0;const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('  ✓ '+label)};
const wait=async(fn,label)=>{const end=Date.now()+7000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,30))}throw Error('Délai dépassé : '+label)};
const begin=label=>p.evaluate(label=>{window.__begin(label)},label);
const result=label=>p.evaluate(label=>window.__results[label],label);
const done=label=>wait(async()=>!!(await result(label)),label);
const count=()=>p.evaluate(()=>window.__cfg.length);
const callback=(i,who,expires=3600)=>p.evaluate(({i,who,expires})=>{window.__cfg[i].callback({access_token:'FAUX-'+who,expires_in:expires})},{i,who,expires});
const state=()=>p.evaluate(async()=>({owner:window.__yt.accountId(),auth:window.__yt.isAuthenticated(),scope:(await import('/src/services/accountScope.ts')).accountScope(),serial:window.__yt.sessionRevision(),stored:!!sessionStorage.getItem('soundblend_google_session_v2'),phase:window.__yt.getLoginState().phase}));
try{
 await p.goto(base);await p.waitForSelector('.ytm-shell');await p.waitForFunction(()=>!!window.google?.accounts?.oauth2);
 await p.evaluate(async()=>{window.__yt=(await import('/src/services/youtube.ts')).youtubeService;window.__results={};window.__begin=label=>{void window.__yt.login('id-client-fictif').then(()=>window.__results[label]={ok:true},e=>window.__results[label]={ok:false,code:e.code})}});
 let i=await count();await begin('premiere');await begin('doublon');await done('doublon');
 check((await count())===i+1&&(await result('doublon')).code==='already_pending'&&(await state()).phase==='waiting','service partagé : seconde tentative refusée sans invalider la première');
 await p.evaluate(()=>window.__yt.cancelPendingLogin());await done('premiere');const countBefore=calls.length;await callback(i,'A');await p.waitForTimeout(100);
 check((await result('premiere')).code==='cancelled'&&calls.length===countBefore&&!(await state()).auth,'annulation : ancien callback ignoré avant toute vérification');

 await p.evaluate(()=>{localStorage.setItem('soundblend_yt_token','FAUX-OLD');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+3600000));localStorage.setItem('soundblend_settings',JSON.stringify({geminiApiKey:'CLE-LOCALE-FICTIVE'}))});
 i=await count();await begin('fenetre-prioritaire');const restored=await p.evaluate(()=>window.__yt.restoreLegacySession());await callback(i,'B');await done('fenetre-prioritaire');
 const local=await p.evaluate(()=>({old:localStorage.getItem('soundblend_yt_token'),key:JSON.parse(localStorage.getItem('soundblend_settings')).geminiApiKey}));
 check(restored===false&&(await state()).owner==='google-B'&&local.old===null&&local.key==='CLE-LOCALE-FICTIVE','restauration héritée pendant une fenêtre : ignorée, puis B vérifié sans importer les anciennes données');
 i=await count();await begin('sortie');await p.evaluate(()=>window.__yt.logout());await done('sortie');await callback(i,'A');await p.waitForTimeout(150);
 check((await result('sortie')).code==='cancelled'&&(await state()).owner===null&&(await state()).scope===null&&!(await state()).stored,'déconnexion pendant une tentative : ancien retour ne réactive aucun compte');

 i=await count();await p.evaluate(()=>window.addEventListener('sb:auth-changing',()=>window.__yt.logout(),{once:true}));await begin('reentrant-avant');await callback(i,'A');await done('reentrant-avant');
 check((await result('reentrant-avant')).code==='cancelled'&&(await state()).owner===null&&(await state()).scope===null,'déconnexion pendant auth-changing : activation empêchée même en réentrance');
 i=await count();await p.evaluate(()=>window.addEventListener('sb:auth-changed',()=>window.__yt.logout(),{once:true}));await begin('reentrant-apres');await callback(i,'A');await done('reentrant-apres');
 check((await result('reentrant-apres')).code==='cancelled'&&(await state()).owner===null&&!(await state()).stored,'déconnexion pendant auth-changed : session immédiatement retirée et non réactivée');

 await p.evaluate(()=>{localStorage.setItem('soundblend_yt_token','FAUX-OLD');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+3600000))});
 setHold('OLD');const oldStart=calls.length;
 await p.evaluate(()=>{window.__restoreDone=null;void window.__yt.restoreLegacySession().then(x=>window.__restoreDone=x)});
 await wait(()=>calls.length>oldStart,'ancienne identité suspendue');i=await count();await begin('nouveau-B');await callback(i,'B');await done('nouveau-B');unblock();
 await wait(()=>p.evaluate(()=>window.__restoreDone!==null),'ancienne restauration terminée');
 check(await p.evaluate(()=>window.__restoreDone===false)&&(await state()).owner==='google-B'&&(await state()).scope==='google-B','restauration ancienne tardive : ne remplace pas le compte B choisi');

 const serial=(await state()).serial;rejectFor='A';i=await count();await begin('identite-invalide');await callback(i,'A');await done('identite-invalide');rejectFor='';
 const s=await state();check((await result('identite-invalide')).code==='profile_check'&&s.owner==='google-B'&&s.scope==='google-B'&&s.auth&&s.serial===serial,'identité A refusée : session B existante et espace B conservés');
 await p.evaluate(()=>window.__yt.logout());
 setHold('A');i=await count();await begin('expire-durant-profil');const old=calls.length;await callback(i,'A',1);await wait(()=>calls.length>old,'profil A suspendu');
 await p.waitForTimeout(1200);unblock();await done('expire-durant-profil');
 check((await result('expire-durant-profil')).code==='token_expired'&&(await state()).owner===null,'expiration pendant la vérification : jeton non activé');

 const before=await count();await p.evaluate(()=>{const f=()=>{if(window.__yt.getLoginState().phase==='waiting'){window.removeEventListener('sb:google-login-state',f);window.__yt.cancelPendingLogin()}};window.addEventListener('sb:google-login-state',f)});await begin('annulation-synchrone');await done('annulation-synchrone');
 check((await result('annulation-synchrone')).code==='cancelled'&&(await count())===before,'annulation synchrone pendant le changement d’état : aucune fenêtre ouverte');
 check(errors.length===0,`aucune exception non traitée (${errors.join('; ')})`);
 console.log(`\n${n}/${n} contrôles de courses OAuth réussis — services simulés.`);
}finally{unblock();await c.close();await b.close()}
