/* Non-régression des horloges désaccordées : deux appareils et Drive simulés.
   Une version future observée ne doit pas écraser un geste local non envoyé.
   Aucun algorithme ne déduit l'ordre réel de deux gestes simultanés hors ligne. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'*'};
const now=Date.now(), future=now+3600000;
const makeRemote=()=>({schema:2,modifie:new Date().toISOString(),appareil:'horloge-avancee',apparence:{mode:'dark',at:future},reglages:{geminiApiKey:'CLE-DISTANTE-FICTIVE',at:future},exclusions:[{id:'artist:horloge',kind:'artist',artist:'Horloge',updatedAt:future,deleted:false}],decouvertes:[],suppressionsBlends:{},blends:[{id:'clock-blend',title:'Distant',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),updatedAt:future,seedTracks:[],tracks:[]}],portrait:null});
const remote={data:makeRemote(),patches:0};
const wait=async(fn,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,70));}throw new Error(`Délai dépassé : ${label}`)};
const ready=async p=>p.evaluate(async()=>{const d=await import('/src/services/drive.ts');return d.etatSync().phase==='pret'&&!d.enAttente()});
const state=async p=>p.evaluate(async()=>{const s=await import('/src/services/storage.ts'),pref=await import('/src/context/prefs.ts');return {mode:pref.getMode(),modeAt:pref.getModeAt(),settings:s.getStoredSettings(),settingsAt:s.getSettingsAt(),exclusions:s.getExclusionRecords(),blends:s.getStoredBlends()}});
async function device(pending=false){
  const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',colorScheme:'light'});
  await c.addInitScript(({pending,now})=>{
    localStorage.setItem('soundblend_onboarded','1');
    sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'FAUX',owner:'google-clock',expiresAt:Date.now()+3600000,profile:{name:'Compte fictif',email:'',avatarUrl:''}}));
    if(pending){
      const prefix='soundblend_account_v1:google-clock:';
      localStorage.setItem(prefix+'soundblend_mode_v2',JSON.stringify({mode:'light',at:now,pending:true}));
      localStorage.setItem(prefix+'soundblend_settings',JSON.stringify({geminiApiKey:'',_updatedAt:now,_pending:true}));
      localStorage.setItem(prefix+'soundblend_exclusions_v1',JSON.stringify([{id:'artist:horloge',kind:'artist',artist:'Horloge',updatedAt:now,deleted:true,_pending:true}]));
      localStorage.setItem(prefix+'soundblend_recent_blends',JSON.stringify([{id:'clock-blend',title:'Choix local',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),updatedAt:now,seedTracks:[],tracks:[],_pending:true}]));
      localStorage.setItem(prefix+'soundblend_sync_pending_v2','1');
    }
  },{pending,now});
  await c.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
  await c.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};'}));
  await c.route('https://www.googleapis.com/youtube/v3/**',r=>r.fulfill({status:200,headers:cors,body:'{"items":[]}'}));
  await c.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
    const req=r.request(),u=new URL(req.url()),m=req.method();
    if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
    if(u.pathname.includes('/upload/')&&m==='PATCH'){remote.patches++;remote.data=JSON.parse(req.postData()||'{}');return r.fulfill({status:200,headers:cors,body:'{"id":"fictif"}'});}
    if(u.searchParams.get('alt')==='media')return r.fulfill({status:200,headers:cors,body:JSON.stringify(remote.data)});
    return r.fulfill({status:200,headers:cors,body:'{"files":[{"id":"fictif","name":"soundblend.json"}]}'});
  });
  const p=await c.newPage(); await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await wait(()=>ready(p),'synchro');return {c,p};
}
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
let A,B;
try{
  A=await device(); let a=await state(A.p);
  check(a.mode==='dark'&&a.settings.geminiApiKey==='CLE-DISTANTE-FICTIVE'&&!a.exclusions[0].deleted,'valeurs futures distantes d’abord reçues sur A');
  await A.p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  await A.p.getByRole('button',{name:'Changer de thème clair/sombre'}).click();
  await A.p.getByLabel('Clé API Gemini').fill(''); await A.p.getByRole('button',{name:'Enregistrer',exact:true}).click();
  await A.p.evaluate(async()=>{const s=await import('/src/services/storage.ts');s.unblock('artist:horloge');});
  await wait(()=>remote.data.apparence.mode==='light'&&remote.data.reglages.geminiApiKey===''&&remote.data.exclusions[0].deleted,'geste A après valeur future'); await wait(()=>ready(A.p),'fin A');
  a=await state(A.p);
  check(a.mode==='light'&&remote.data.apparence.at>future,'choix de thème après observation : conservé malgré l’horloge avancée');
  check(a.settings.geminiApiKey===''&&remote.data.reglages.at>future&&remote.data.exclusions[0].updatedAt>future,'effacement de clé et déblocage restent après la version future observée');
  await A.c.close(); A=null;

  remote.data=makeRemote();
  B=await device(true); const b=await state(B.p);
  check(b.mode==='light'&&remote.data.apparence.mode==='light'&&b.modeAt>future,'choix local non envoyé avant la première lecture : rebasé sur la valeur future');
  check(b.settings.geminiApiKey===''&&remote.data.reglages.geminiApiKey===''&&b.settingsAt>future,'clé effacée hors ligne non rétablie par une horloge distante avancée');
  check(b.exclusions.find(x=>x.id==='artist:horloge')?.deleted&&remote.data.exclusions[0].deleted&&remote.data.exclusions[0].updatedAt>future,'déblocage hors ligne non annulé par l’horloge distante');
  check(b.blends.find(x=>x.id==='clock-blend')?.title==='Choix local'&&remote.data.blends[0].title==='Choix local'&&remote.data.blends[0].updatedAt>future,'version locale non envoyée d’un blend conservée et rebasée');
  check(!JSON.stringify(remote.data).includes('_pending'),'marqueurs internes jamais envoyés dans le fichier Drive');
  console.log(`\n${n}/${n} contrôles d’horloge réussis — aucune garantie d’ordre temporel absolu ni de fusion atomique.`);
} finally{await A?.c.close();await B?.c.close();await browser.close();}
