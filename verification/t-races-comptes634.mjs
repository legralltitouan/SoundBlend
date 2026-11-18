/* Opérations en vol, changement de compte, minuterie d'expiration et quota.
   Aucun réseau utilisateur : OAuth, Drive, Gemini et YouTube simulés. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'light'});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,PUT,DELETE,OPTIONS','access-control-allow-headers':'*'};
const now=Date.now(),blank=()=>({schema:2,modifie:new Date().toISOString(),appareil:'serveur',apparence:{mode:'light',at:0},reglages:{geminiApiKey:'',at:0},exclusions:[],decouvertes:[],suppressionsBlends:{},portrait:null,blends:[]});
const banks={A:{id:'drive-A',data:{...blank(),reglages:{geminiApiKey:'CLE-REMOTE-A',at:now-1000},exclusions:[{id:'artist:secret-a',kind:'artist',artist:'Secret A distant',updatedAt:now-1000,deleted:false}]}},B:{id:'drive-B',data:blank()}};
let releaseDrive,releaseGemini,releaseYT,driveSeen=false,geminiSeen=false,ytSeen=false;
const driveGate=new Promise(r=>releaseDrive=r),geminiGate=new Promise(r=>releaseGemini=r),ytGate=new Promise(r=>releaseYT=r);
let holdDrive=true,holdGemini=false,holdYT=false;
const calls=[],ytPosts=[];
const wait=async(fn,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error(`Délai dépassé : ${label}`)};
const ready=async p=>p.evaluate(async()=>{const d=await import('/src/services/drive.ts');return d.etatSync().phase==='pret'&&!d.enAttente()});
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
await ctx.addInitScript(()=>{localStorage.setItem('soundblend_onboarded','1');window.__account='A';window.__expires=3600;});
await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:o=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'FAUX-'+window.__account,expires_in:window.__expires}),10)}),revoke:(_t,cb)=>cb()}}};`}));
await ctx.route('https://www.googleapis.com/oauth2/**',r=>{const a=r.request().headers().authorization.split('FAUX-')[1];return r.fulfill({status:200,headers:cors,body:JSON.stringify({id:'id-'+a,name:'Compte '+a})});});
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,async r=>{
  const req=r.request(),u=new URL(req.url()),m=req.method(),a=(req.headers().authorization||'').split('FAUX-')[1],bank=banks[a];
  if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
  calls.push({a,m,path:u.pathname});if(!bank)return r.fulfill({status:401,headers:cors,body:'{}'});
  if(u.searchParams.get('alt')==='media'){
    const snapshot=structuredClone(bank.data);
    if(a==='A'&&holdDrive){driveSeen=true;await driveGate;}
    return r.fulfill({status:200,headers:cors,body:JSON.stringify(snapshot)}).catch(()=>{});
  }
  if(u.pathname.includes('/upload/')&&m==='PATCH'){bank.data=JSON.parse(req.postData());return r.fulfill({status:200,headers:cors,body:JSON.stringify({id:bank.id})});}
  return r.fulfill({status:200,headers:cors,body:JSON.stringify({files:[{id:bank.id,name:'soundblend.json'}]})});
});
await ctx.route('https://generativelanguage.googleapis.com/**',async r=>{
  if(r.request().url().includes('/models?'))return r.fulfill({status:200,headers:cors,body:JSON.stringify({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent'],outputTokenLimit:8192}]})});
  if(holdGemini){geminiSeen=true;await geminiGate;}
  return r.fulfill({status:200,headers:cors,body:JSON.stringify({candidates:[{content:{parts:[{text:'réponse sans JSON'}]}}]})}).catch(()=>{});
});
await ctx.route('https://www.googleapis.com/youtube/v3/**',async r=>{
  const req=r.request(),u=new URL(req.url());
  if(req.method()==='POST'&&u.pathname.endsWith('/playlistItems')){
    ytPosts.push({auth:req.headers().authorization,body:req.postData()});if(holdYT){ytSeen=true;await ytGate;}
    return r.fulfill({status:200,headers:cors,body:'{"id":"element-fictif"}'}).catch(()=>{});
  }
  return r.fulfill({status:200,headers:cors,body:'{"items":[]}'});
});
const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
const state=()=>p.evaluate(async()=>{const s=await import('/src/services/storage.ts'),a=await import('/src/services/accountScope.ts'),pr=await import('/src/context/prefs.ts');return {scope:a.accountScope(),key:s.getStoredSettings().geminiApiKey,exclusions:s.getExclusionRecords(),blends:s.getStoredBlends(),portrait:s.getStoredPortrait(),mode:pr.getMode()}});
const login=async(a,expires=3600)=>{await p.evaluate(({a,expires})=>{window.__account=a;window.__expires=expires},{a,expires});await p.getByRole('button',{name:/^(Connecter mon compte|Reconnecter ce compte)$/}).click();await p.getByRole('button',{name:'Se déconnecter'}).waitFor();};
const logout=async()=>{await p.getByRole('button',{name:'Se déconnecter'}).click();await p.getByRole('button',{name:'Connecter mon compte',exact:true}).waitFor();};
try{
  await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await p.waitForFunction(()=>!!window.google?.accounts?.oauth2);await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  await login('A');await wait(()=>driveSeen,'lecture Drive A suspendue');
  await p.getByLabel('Clé API Gemini').fill('CLE-LOCALE-A-EN-ATTENTE');await p.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await logout();await login('B');await wait(()=>ready(p),'synchro B pendant attente A');
  holdDrive=false;releaseDrive();await p.waitForTimeout(700);
  let b=await state();
  check(b.scope==='id-B'&&b.key===''&&!b.exclusions.some(x=>x.artist==='Secret A distant')&&!JSON.stringify(banks.B.data).includes('CLE-LOCALE-A'),'réponse Drive A tardive annulée : aucune donnée A appliquée ou envoyée à B');
  check(!calls.some(x=>x.a==='A'&&x.m==='PATCH'),'lecture A interrompue avant tout envoi non confirmé');
  await logout();await login('A');await wait(()=>ready(p)&&banks.A.data.reglages.geminiApiKey==='CLE-LOCALE-A-EN-ATTENTE','reprise des données A');
  check((await state()).key==='CLE-LOCALE-A-EN-ATTENTE','la modification A en attente survit et repart uniquement vers A');

  holdGemini=true;
  await p.evaluate(async()=>{
    const g=(await import('/src/services/gemini.ts')).geminiService,s=await import('/src/services/storage.ts');
    const t={id:'AAA00000001',videoId:'AAA00000001',title:'Titre privé A',artist:'Artiste A',thumbnailUrl:'',durationSeconds:180,category:'anchor'};
    window.__generation={done:false};
    void g.generateBlend([t],{durationMinutes:20,ratio:{anchor:30,deepDive:30,fresh:40}},s.getExclusions(),()=>{}).then(()=>window.__generation={done:true,ok:true},e=>window.__generation={done:true,ok:false,error:e.message});
  });
  await wait(()=>geminiSeen,'réponse Gemini A suspendue');await logout();await login('B');await wait(()=>ready(p),'B après génération A');
  holdGemini=false;releaseGemini();await wait(()=>p.evaluate(()=>window.__generation.done),'arrêt génération ancienne');
  b=await state();const gen=await p.evaluate(()=>window.__generation);
  check(!gen.ok&&b.scope==='id-B'&&b.portrait===null&&b.blends.length===0,'génération A tardive abandonnée : aucun portrait ni blend écrit dans B');

  await logout();await login('A');await wait(()=>ready(p),'A avant opération YouTube');holdYT=true;
  await p.evaluate(async()=>{const y=(await import('/src/services/youtube.ts')).youtubeService;window.__yt={done:false};void y.addTracksToPlaylist('PL-A',[{id:'AAA00000001',videoId:'AAA00000001',title:'Piste A',artist:'A',thumbnailUrl:'',durationSeconds:180}]).then(()=>window.__yt={done:true,ok:true},e=>window.__yt={done:true,ok:false,error:e.message});});
  await wait(()=>ytSeen,'ajout YouTube A suspendu');await logout();await login('B');await wait(()=>ready(p),'B après requête YouTube A');holdYT=false;releaseYT();await wait(()=>p.evaluate(()=>window.__yt.done),'fin opération YouTube A');
  const yt=await p.evaluate(()=>window.__yt);
  check(!yt.ok&&ytPosts.length===1&&ytPosts[0].auth==='Bearer FAUX-A'&&(await state()).scope==='id-B','mutation YouTube en vol interrompue sans utiliser le jeton B');

  await logout();await login('B',1);await p.getByRole('button',{name:'Reconnecter ce compte'}).waitFor({timeout:6000});
  const expired=await p.evaluate(async()=>({sync:(await import('/src/services/drive.ts')).etatSync(),auth:(await import('/src/services/youtube.ts')).youtubeService.isAuthenticated()}));
  check(!expired.auth&&expired.sync.phase==='expire','expiration réelle du minuteur met à jour l’interface sans attendre un clic');
  await p.evaluate(async()=>{(await import('/src/services/storage.ts')).block({artist:'En attente après minuteur'},'artist')});
  check((await p.evaluate(async()=> (await import('/src/services/drive.ts')).etatSync())).enAttente,'geste après expiration réelle reste en attente dans B');
  await login('B',3600);await wait(()=>ready(p)&&banks.B.data.exclusions.some(x=>x.artist==='En attente après minuteur'),'reprise après minuteur');
  check(banks.B.data.exclusions.some(x=>x.artist==='En attente après minuteur'),'reconnexion après expiration envoie au même compte');

  const restore=()=>p.evaluate(()=>{if(window.__setItemOrig)Storage.prototype.setItem=window.__setItemOrig});
  const refuse=suffix=>p.evaluate(suffix=>{window.__setItemOrig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k).endsWith(suffix))throw new DOMException('Quota simulé','QuotaExceededError');return window.__setItemOrig.call(this,k,v)}},suffix);
  await refuse(':soundblend_settings');await p.getByLabel('Clé API Gemini').fill('CLE-REFUSEE');await p.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await p.getByText(/Stockage local indisponible ou plein/).first().waitFor();
  check((await state()).key===''&&!JSON.stringify(banks.B.data).includes('CLE-REFUSEE'),'quota réglages : clé non enregistrée et erreur visible');await restore();
  const modeBefore=(await state()).mode;await refuse(':soundblend_mode_v2');await p.getByRole('button',{name:'Changer de thème clair/sombre'}).click();
  check((await state()).mode===modeBefore&&(await p.evaluate(()=>document.documentElement.dataset.mode))===modeBefore,'quota thème : ni préférence ni apparence ne changent faussement');await restore();

  await p.evaluate(async()=>{const s=await import('/src/services/storage.ts');s.block({artist:'Déblocage quota'},'artist');const n=Date.now();s.saveBlendToStorage({id:'blend-quota',title:'Blend quota',createdAt:new Date(n).toISOString(),expiresAt:new Date(n+86400000).toISOString(),seedTracks:[],tracks:[]});window.dispatchEvent(new CustomEvent('sb:sync-applied'))});
  await p.getByRole('button',{name:'Afficher la liste des exclusions'}).click();await p.getByRole('tab',{name:/Artistes/}).click();
  await refuse(':soundblend_exclusions_v1');await p.getByRole('button',{name:'Débloquer Déblocage quota'}).click();
  check((await p.locator('.sb-exclusions-notice').innerText()).includes('Stockage local indisponible')&&(await state()).exclusions.some(x=>x.artist==='Déblocage quota'&&!x.deleted),'quota déblocage : erreur visible et exclusion conservée');await restore();await p.keyboard.press('Escape');
  await p.locator('.ytm-mobile-bar [aria-label="Blends"]').click();const row=p.locator('.sb-blend-row').filter({hasText:'Blend quota'});await refuse(':soundblend_blend_deletions_v1');
  await row.getByRole('button',{name:'Supprimer',exact:true}).click();await row.getByRole('button',{name:'Supprimer',exact:true}).click();
  check((await state()).blends.some(x=>x.id==='blend-quota')&&await p.getByText(/Stockage local indisponible ou plein/).first().isVisible(),'quota suppression : blend conservé et échec annoncé');await restore();
  await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();await refuse(':soundblend_sync_pending_v2');
  await p.getByLabel('Clé API Gemini').fill('CLE-MARQUEUR');await p.getByRole('button',{name:'Enregistrer',exact:true}).click();
  const pending=await p.evaluate(async()=> (await import('/src/services/drive.ts')).etatSync());
  check((await state()).key==='CLE-MARQUEUR'&&pending.enAttente&&pending.message?.includes('n’a pas pu mémoriser'),'échec du marqueur d’envoi : sauvegarde locale réelle, avertissement sur l’attente');await restore();
  check(errors.length===0,`aucune exception JavaScript (${errors.join('; ')})`);
  console.log(`\n${n}/${n} contrôles opérations et stockage réussis — services simulés.`);
} catch(e){console.error('Diagnostic',await state().catch(()=>null),'appels',calls.slice(-15),'erreurs',errors);throw e;}
finally{releaseDrive();releaseGemini();releaseYT();await ctx.close();await browser.close();}
