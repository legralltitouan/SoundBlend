import { chromium } from 'playwright'; import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5180/';
const browser=await chromium.launch({args:['--no-sandbox']});
const ctx=await browser.newContext({serviceWorkers:'block'}); const page=await ctx.newPage();
await ctx.route('**/*', r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://www.googleapis.com/oauth2/v2/userinfo',r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:'compte-B',name:'B fictif'})}));
try {
 await page.goto(base); await page.evaluate(()=>{localStorage.setItem('soundblend_onboarded','1');sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'A-fictif',owner:'compte-A',expiresAt:Date.now()+3600000,profile:{name:'A'}})); sessionStorage.setItem('soundblend_oauth_redirect_pending',JSON.stringify({state:'state-fictif',startedAt:Date.now()}));});
 const hash=new URLSearchParams({access_token:'B-fictif',expires_in:'3600',state:'state-fictif',scope:'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile'}).toString();
 await page.goto('about:blank'); await page.goto(base+'#'+hash);await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2'))?.owner==='compte-B');
 assert.equal(new URL(page.url()).hash,'');console.log('OK changement A vers B avec retour et identité vérifiée');
 await page.goto('about:blank'); await page.goto(base+'#'+hash); await page.getByText('Code : invalid_state',{exact:true}).waitFor(); assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')).owner),'compte-B');console.log('OK réponse rejouée refusée, B conservé');
 await page.evaluate(()=>sessionStorage.setItem('soundblend_oauth_redirect_pending',JSON.stringify({state:'expire',startedAt:Date.now()-601000})));
 const expired=new URLSearchParams({access_token:'C-fictif',expires_in:'3600',state:'expire',scope:'profile'}).toString();await page.goto('about:blank');await page.goto(base+'#'+expired);await page.getByText('Code : invalid_state',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')).owner),'compte-B');console.log('OK réponse expirée refusée, B conservé');
} finally {await browser.close()}
