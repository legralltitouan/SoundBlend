/* Bibliothèque GIS Google réelle et non modifiée, mais fenêtre OAuth,
   réponse et toutes les API simulées. Aucun consentement ni compte réel.
   Pour éviter un réseau, SOUNDBLEND_GIS_SCRIPT_PATH peut désigner une copie
   locale du script public https://accounts.google.com/gsi/client. */
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const gsi=process.env.SOUNDBLEND_GIS_SCRIPT_PATH
 ? await readFile(process.env.SOUNDBLEND_GIS_SCRIPT_PATH,'utf8')
 : execFileSync('curl',['-fsSL','--max-time','25','https://accounts.google.com/gsi/client'],{encoding:'utf8',maxBuffer:1000000});
if(!gsi.includes('initTokenClient'))throw Error('La bibliothèque GIS publique n’a pas été chargée.');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const h={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
let n=0;const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('  ✓ '+label)};
async function scenario(kind){
 const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[],profiles=[];
 await c.addInitScript(({kind})=>{
  localStorage.setItem('soundblend_onboarded','1');
  const original=window.open;
  window.open=function(...args){
   if(kind==='blocked')return null;
   const w=original.apply(this,args);if(!w)return w;
   if(kind!=='early-close'&&kind!=='cancel')return w;
   const at=performance.now();
   // Simule un faux signal de fermeture après l'ouverture. La fenêtre factice
   // reste réellement ouverte ; aucune modification du code Google.
   return new Proxy(w,{get(target,key){
    if(key==='closed')return performance.now()-at>200;
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
   }});
  };
 },{kind});
 await c.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await c.route('https://accounts.google.com/gsi/client',r=>r.fulfill({status:200,contentType:'application/javascript',body:gsi}));
 await c.route('https://accounts.google.com/o/oauth2/v2/auth**',r=>{
  const u=new URL(r.request().url()),redirect=u.searchParams.get('redirect_uri');
  // Le simulateur s'adapte aux deux formes observées de la bibliothèque
  // publique. L'application, elle, n'utilise pas ces détails internes.
  const id=redirect==='gis_transform'?Buffer.from(u.searchParams.get('gis_params')||'','base64').toString('latin1').match(/auth\d+/)?.[0]:new URL(redirect).searchParams.get('id');
  const clientId=u.searchParams.get('client_id');if(!id||!clientId)throw Error('Format GIS modifié : mettre à jour le simulateur de test.');
  const params={id,clientId,type:'authResult',authResult:{access_token:'FAUX-SIMULE',expires_in:3600,scope:'https://www.googleapis.com/auth/userinfo.profile'}};
  const send=`window.opener.postMessage(${JSON.stringify(JSON.stringify({params}))},'*');window.close()`;
  const action=kind==='manual-close'?'window.close()':send;
  const delay=kind==='normal'?250:kind==='manual-close'?200:2200;
  return r.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><body>OAuth simulé : aucun compte réel<script>setTimeout(()=>{${action}},${delay})</script></body></html>`});
 });
 await c.route('https://www.googleapis.com/oauth2/**',r=>{profiles.push('profil-fictif');return r.fulfill({status:200,headers:h,body:'{"id":"compte-fictif","name":"Compte fictif"}'})});
 await c.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:h,body:'{"items":[]}'}));
 await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>r.fulfill({status:503,headers:h,body:'{}'}));
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base);await p.waitForSelector('.ytm-shell');await p.waitForFunction(()=>!!window.google?.accounts?.oauth2?.initTokenClient);
  await p.evaluate(()=>{const oauth=window.google.accounts.oauth2,original=oauth.initTokenClient;window.__trace=[];
   oauth.initTokenClient=function(config){const cb=config.callback,err=config.error_callback;
    config.callback=r=>{window.__trace.push({event:'callback',hasToken:!!r?.access_token,error:!!r?.error});return cb?.(r)};
    config.error_callback=e=>{window.__trace.push({event:'error_callback',type:e?.type});return err?.(e)};
    return original.call(this,config)
   }
  });
  const popupPromise=kind==='blocked'?null:p.waitForEvent('popup',{timeout:10000});
  await p.locator('.sb-link-login').click();
  const popup=popupPromise?await popupPromise:null;
  const trace=()=>p.evaluate(()=>window.__trace);
  const session=()=>p.evaluate(()=>JSON.parse(sessionStorage.getItem('soundblend_google_session_v2')||'null')?.owner||null);
  if(kind==='early-close'){
   await p.locator('.sb-google-status').getByText('Code : popup_closed',{exact:true}).waitFor();
   check(popup&&!popup.isClosed()&&(await session())===null,'GIS réel : faux popup_closed alors que la fenêtre simulée reste ouverte');
   await p.waitForFunction(()=>!!sessionStorage.getItem('soundblend_google_session_v2'),null,{timeout:9000});
   const t=await trace();check(t[0]?.type==='popup_closed'&&t.some(x=>x.event==='callback'&&x.hasToken)&&(await session())==='compte-fictif'&&errors.length===0,'GIS réel : réponse fictive après popup_closed acceptée et identité fictive vérifiée');
  }else if(kind==='cancel'){
   await p.locator('.sb-google-status').getByText('Code : popup_closed',{exact:true}).waitFor();
   await p.getByRole('button',{name:'Annuler la connexion Google'}).click();await p.waitForTimeout(2800);
   const t=await trace();check(t.some(x=>x.event==='callback'&&x.hasToken)&&(await session())===null&&profiles.length===0&&errors.length===0,'GIS réel : après annulation, même une réponse fictive ultérieure est ignorée');
  }else if(kind==='normal'){
   await p.waitForFunction(()=>!!sessionStorage.getItem('soundblend_google_session_v2'),null,{timeout:9000});
   check((await trace()).some(x=>x.event==='callback'&&x.hasToken)&&(await session())==='compte-fictif'&&errors.length===0,'GIS réel : ordre normal avec réponse et identité fictives');
  }else if(kind==='manual-close'){
   await p.locator('.sb-google-status').getByText('Code : popup_closed',{exact:true}).waitFor();
   const t=await trace();check(t.some(x=>x.type==='popup_closed')&&!t.some(x=>x.event==='callback')&&(await session())===null&&errors.length===0,'GIS réel : fermeture sans réponse détectée sans exception non traitée');
   await p.getByRole('button',{name:'Annuler la connexion Google'}).click();
   check(await p.locator('.sb-link-login').isEnabled(),'fermeture sans réponse : annuler libère le bouton immédiatement');
  }else{
   await p.locator('.sb-google-status').getByText('Code : popup_failed_to_open',{exact:true}).waitFor();
   check((await trace()).some(x=>x.type==='popup_failed_to_open')&&(await session())===null&&errors.length===0,'GIS réel : popup bloquée signalée sans compte activé');
  }
 }finally{await c.close()}
}
try{for(const kind of ['early-close','cancel','normal','manual-close','blocked'])await scenario(kind);console.log(`\n${n}/${n} contrôles GIS réussis — bibliothèque réelle, fenêtre/réponses/API simulées.`)}finally{await browser.close()}
