/* Expiration du jeton au retour par redirection ; services simulés. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({args:['--no-sandbox']});
try {
 for(const mode of ['missing','during','valid']){
  const ctx=await browser.newContext({serviceWorkers:'block'});let profiles=0;
  await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
  await ctx.route('https://www.googleapis.com/oauth2/v2/userinfo',async r=>{profiles++; if(mode==='during')await new Promise(x=>setTimeout(x,1200)); await r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:'compte-fictif',name:'Test'})});});
  const p=await ctx.newPage();await p.goto(base);await p.evaluate(()=>{localStorage.setItem('soundblend_onboarded','1');sessionStorage.setItem('soundblend_oauth_redirect_pending',JSON.stringify({state:'fictif',startedAt:Date.now()}));});
  const f=new URLSearchParams({access_token:'FAUX',state:'fictif',scope:'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile'});
  if(mode!=='missing')f.set('expires_in',mode==='during'?'1':'3600');
  await p.goto('about:blank');await p.goto(base+'#'+f.toString());
  if(mode==='valid') { await p.waitForFunction(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')||'null')?.owner==='compte-fictif'); assert.equal(profiles,1); }
  else { await p.getByText('Code : '+(mode==='missing'?'invalid_expiry':'token_expired'),{exact:true}).waitFor(); assert.equal(await p.evaluate(()=>sessionStorage.getItem('soundblend_google_session_v2')),null); assert.equal(profiles,mode==='during'?1:0); }
  console.log('✓ expiration et activation : '+mode);await ctx.close();
 }
} finally {await browser.close()}
