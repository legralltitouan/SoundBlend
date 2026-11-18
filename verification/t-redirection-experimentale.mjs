import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5180/';
const browser = await chromium.launch({args:['--no-sandbox']});
const required='https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';
async function run(mode){
 const context=await browser.newContext({serviceWorkers:'block'});let requestParams, profileCount=0;
 await context.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
 await context.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await context.route('https://accounts.google.com/o/oauth2/v2/auth**', async r=>{
   const u=new URL(r.request().url()); requestParams=u.searchParams;
   const p=new URLSearchParams({state:mode==='invalid'?'wrong':u.searchParams.get('state')});
   if(mode==='denied') p.set('error','access_denied');
   else { p.set('access_token','FAUX-TOKEN');p.set('expires_in','3600');p.set('scope',mode==='partial'?'profile':required); }
   await r.fulfill({status:302,headers:{location:base+'#'+p.toString()}});
 });
 await context.route('https://www.googleapis.com/oauth2/v2/userinfo',r=>{profileCount++;return r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:'fake-account',name:'Fictif'})});});
 const page=await context.newPage(); await page.goto(base); await page.locator('.sb-link-login').waitFor();
 await page.locator('.sb-link-login').click();
 await page.waitForURL(url=>url.href===base,{timeout:10000});
 await page.waitForTimeout(500);
 assert.equal(requestParams.get('redirect_uri'),base); assert.equal(requestParams.get('response_type'),'token');
 assert.equal(requestParams.get('prompt'),'select_account');assert.match(requestParams.get('state'),/^[a-f0-9]{64}$/);
 assert.equal(new URL(page.url()).hash,'');
 if(mode==='success') {await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')||'null')?.owner==='fake-account'); assert.equal(profileCount,1);}
 else { await page.locator('.sb-google-status').getByText('Code : '+({invalid:'invalid_state',partial:'permissions_incomplete',denied:'access_denied'}[mode]),{exact:true}).waitFor(); assert.equal(profileCount,0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('soundblend_google_session_v2')),null); }
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('soundblend_oauth_redirect_pending')),null);
 console.log('OK',mode,'redirection, état unique, fragment effacé et contrôle de session'); await context.close();
}
try {for(const mode of ['success','invalid','partial','denied']) await run(mode);} finally {await browser.close();}
