/* Parcours comptes sur le site compilé : interface et services simulés. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||'http://localhost:4173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'light'});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'*'};
const now=Date.now(),blank=()=>({schema:2,modifie:new Date().toISOString(),appareil:'fictif',apparence:{mode:'light',at:0},reglages:{geminiApiKey:'',at:0},exclusions:[],decouvertes:[],suppressionsBlends:{},portrait:null,blends:[]});
const banks={A:{id:'fichier-A',data:{...blank(),reglages:{geminiApiKey:'CLE-DRIVE-A',at:now-1000},exclusions:[{id:'artist:a',kind:'artist',artist:'Artiste A',updatedAt:now-1000,deleted:false}]}},B:{id:'fichier-B',data:blank()}},calls=[];
await ctx.addInitScript(({now})=>{
 if(!localStorage.getItem('__seed-site')){
  localStorage.setItem('__seed-site','1');localStorage.setItem('soundblend_onboarded','1');
  localStorage.setItem('soundblend_settings',JSON.stringify({geminiApiKey:'CLE-HISTORIQUE'}));
  localStorage.setItem('soundblend_exclusions_v1',JSON.stringify([{id:'artist:historique',kind:'artist',artist:'Historique',updatedAt:now,deleted:false}]));
 }
 window.__account='A';window.__expires=3600;
},{now});
await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'FAUX-'+window.__account,expires_in:window.__expires}),10)}),revoke:(_t,cb)=>cb()}}};`}));
await ctx.route('https://www.googleapis.com/oauth2/**',r=>{
 const account=(r.request().headers().authorization||'').split('FAUX-')[1];return r.fulfill({status:200,headers:cors,body:JSON.stringify({id:`google-${account}`,name:`Compte ${account}`})});
});
await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
 const req=r.request(),u=new URL(req.url()),m=req.method();if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
 const account=(req.headers().authorization||'').split('FAUX-')[1],bank=banks[account];calls.push({account,method:m,path:u.pathname});
 if(!bank)return r.fulfill({status:401,headers:cors,body:'{}'});
 if(u.pathname.includes('/upload/')&&m==='PATCH'){
  if(decodeURIComponent(u.pathname.split('/').at(-1))!==bank.id)return r.fulfill({status:404,headers:cors,body:'{}'});
  bank.data=JSON.parse(req.postData());return r.fulfill({status:200,headers:cors,body:JSON.stringify({id:bank.id})});
 }
 if(u.searchParams.get('alt')==='media')return r.fulfill({status:200,headers:cors,body:JSON.stringify(bank.data)});
 return r.fulfill({status:200,headers:cors,body:JSON.stringify({files:[{id:bank.id,name:'soundblend.json'}]})});
});
const errors=[],p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const wait=async(fn,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw new Error(`Délai dépassé : ${label}`)};
const settings=page=>page.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]');
const key=page=>page.getByLabel('Clé API Gemini');
const ready=async page=>(await page.locator('.sb-sync-line').innerText()).includes('Dernière synchronisation vérifiée');
const login=async(page,account,seconds=3600)=>{await page.evaluate(({account,seconds})=>{window.__account=account;window.__expires=seconds},{account,seconds});await page.getByRole('button',{name:/^(Connecter mon compte|Reconnecter ce compte)$/}).click();};
const logout=async page=>{await page.getByRole('button',{name:'Se déconnecter'}).click();await page.getByRole('button',{name:'Connecter mon compte',exact:true}).waitFor()};
try{
 await p.goto(base);await p.waitForSelector('.ytm-shell');await settings(p).click();
 check(await key(p).inputValue()==='CLE-HISTORIQUE','espace local historique visible avant connexion sur le site compilé');
 await login(p,'A');await p.getByRole('button',{name:'Se déconnecter'}).waitFor();await wait(()=>ready(p),'compte A');
 check(await key(p).inputValue()==='CLE-DRIVE-A'&&!JSON.stringify(banks.A.data).includes('Historique'),'compte A reçoit ses données, sans import de l’ancien espace local');
 await key(p).fill('CLE-A-EN-ATTENTE');await p.getByRole('button',{name:'Enregistrer',exact:true}).click();await logout(p);
 check(await key(p).inputValue()==='CLE-HISTORIQUE'&&banks.A.data.reglages.geminiApiKey==='CLE-DRIVE-A','déconnexion immédiate garde l’envoi A en attente et restaure l’espace local');
 await login(p,'B');await p.getByRole('button',{name:'Se déconnecter'}).waitFor();await wait(()=>ready(p),'compte B');
 check(await key(p).inputValue()===''&&!JSON.stringify(banks.B.data).includes('CLE-A-EN-ATTENTE')&&!JSON.stringify(banks.B.data).includes('Historique'),'compte B isolé des données A et historiques');
 await key(p).fill('CLE-B');await p.getByRole('button',{name:'Enregistrer',exact:true}).click();
 await wait(()=>banks.B.data.reglages.geminiApiKey==='CLE-B','envoi B');await logout(p);await login(p,'A');await wait(async()=>ready(p)&&banks.A.data.reglages.geminiApiKey==='CLE-A-EN-ATTENTE','reprise A');
 check(await key(p).inputValue()==='CLE-A-EN-ATTENTE'&&banks.B.data.reglages.geminiApiKey==='CLE-B','reconnexion A reprend son envoi sans toucher B');
 check(!['conversation','selection','file','position'].some(k=>Object.hasOwn(banks.A.data,k)),'conversation, sélection, file et position absentes du fichier Drive');
 await logout(p);await login(p,'B',1);await p.getByRole('button',{name:'Reconnecter ce compte'}).waitFor({timeout:8000});
 await key(p).fill('CLE-B-APRES-EXPIRATION');await p.getByRole('button',{name:'Enregistrer',exact:true}).click();
 check((await p.locator('.sb-sync-line').innerText()).includes('attente')&&banks.B.data.reglages.geminiApiKey==='CLE-B','expiration affichée : geste local en attente et non envoyé');
 await login(p,'B',3600);await wait(async()=>ready(p)&&banks.B.data.reglages.geminiApiKey==='CLE-B-APRES-EXPIRATION','reprise B après expiration');
 check(await key(p).inputValue()==='CLE-B-APRES-EXPIRATION','reconnexion au même compte confirme l’envoi en attente');
 const q=await ctx.newPage();q.on('pageerror',e=>errors.push(e.message));await q.goto(base);await q.waitForSelector('.ytm-shell');await settings(q).click();await login(q,'A');await wait(()=>ready(q),'onglet A');
 check(await key(q).inputValue()==='CLE-A-EN-ATTENTE'&&await key(p).inputValue()==='CLE-B-APRES-EXPIRATION','deux onglets compilés gardent des comptes et clés distincts');
 await logout(q);check(await key(p).inputValue()==='CLE-B-APRES-EXPIRATION'&&await p.getByRole('button',{name:'Se déconnecter'}).isVisible(),'déconnexion d’un onglet ne change pas l’autre');await q.close();
 check(errors.length===0&&calls.every(x=>['A','B'].includes(x.account)),`aucune exception et uniquement les comptes simulés attendus (${errors.join('; ')})`);
 console.log(`\n${n}/${n} contrôles comptes sur site compilé réussis — API simulées.`);
}finally{await ctx.close();await browser.close();}
