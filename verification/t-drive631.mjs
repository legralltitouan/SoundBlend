/* Google Drive, YouTube et deux appareils SIMULÉS. Pas de compte réel. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'*'};
const now=Date.now();
const track=(title,artist,videoId,category='fresh')=>({id:videoId,title,artist,videoId,category,thumbnailUrl:'',durationSeconds:200});
const valid={id:'valid',title:'Blend à supprimer',createdAt:new Date(now-3600000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks:[{...track('Ancienne découverte','Artiste Z','OLD00000001'),userRating:'disliked'}]};
const expired={...valid,id:'expired',title:'Périmé',createdAt:new Date(now-16*86400000).toISOString(),expiresAt:new Date(now-86400000).toISOString()};
const memory={files:new Map([['f1',{schema:1,modifie:new Date().toISOString(),appareil:'ancien',apparence:{mode:'dark',at:now-10000},reglages:{geminiApiKey:'cle-test'},gouts:{dislikedArtists:['Artiste Z']},avis:{x:'disliked'},blends:[valid,expired]}]]),next:2,fail:false,calls:[],raceCountdown:0,preflightRemaining:0,preflightSerial:0};
const ok=[];
const check=(condition,name)=>{assert.ok(condition,name);ok.push(name);console.log('  ✓ '+name)};
function content(){return memory.files.get([...memory.files.keys()].sort()[0])}
async function makeDevice(name) {
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await ctx.addInitScript(({name})=>{
    if(!localStorage.getItem('__device_seed')){
      localStorage.setItem('__device_seed',name);localStorage.setItem('soundblend_onboarded','1');
      sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'ya29.fake',owner:'google-test',expiresAt:Date.now()+3600000,profile:{name:'Test',email:'',avatarUrl:''}}));
    }
  },{name});
  await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};'}));
  await ctx.route('https://www.youtube.com/**',r=>r.fulfill({status:200,headers:cors,body:'{}'}));
  await ctx.route(/pipedapi\.|api\.piped\./,r=>{
    const u=new URL(r.request().url());
    if(u.pathname==='/search' && u.searchParams.get('q')==='Chanson A' && u.searchParams.get('filter')==='music_songs')
      return r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[{type:'stream',url:'/watch?v=VID00000001',title:'Chanson A',uploaderName:'Artiste A',duration:200}]})});
    return r.abort();
  });
  await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>{
    const u=r.request().url();
    if(u.includes('/playlists')) return r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[{id:'PL1',snippet:{title:'Chill Voiture',description:'',thumbnails:{}},contentDetails:{itemCount:1}}]})});
    if(u.includes('/playlistItems')) return r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[{id:'it1',snippet:{title:'Chanson',videoOwnerChannelTitle:'Artiste A - Topic',thumbnails:{}},contentDetails:{videoId:'VID00000001'}}]})});
    return r.fulfill({status:200,headers:cors,body:'{"items":[]}'});
  });
  await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,async r=>{
    const req=r.request(),u=new URL(req.url()),method=req.method(); memory.calls.push({method,url:u.href,name});
    if(method==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
    if(memory.fail)return r.fulfill({status:503,headers:cors,body:'{}'});
    const isUpload=u.pathname.includes('/upload/');
    if(isUpload && method==='POST'){
      const body=req.postData()||'';
      const matches=[...body.matchAll(/\{[\s\S]*?\}\s*(?=\r\n--|$)/g)];
      const data=JSON.parse(matches.at(-1)[0]); const id=`f${memory.next++}`; memory.files.set(id,data);
      return r.fulfill({status:200,headers:cors,body:JSON.stringify({id})});
    }
    const m=u.pathname.match(/\/files\/([^/]+)$/); const id=m&&decodeURIComponent(m[1]);
    if(isUpload && method==='PATCH'){
      if(!memory.files.has(id))return r.fulfill({status:404,headers:cors,body:'{}'});
      memory.files.set(id,JSON.parse(req.postData()||'{}'));
      // Un second appareil modifie le doublon après sa lecture mais avant
      // le nettoyage ; il faut le conserver et le relire au cycle suivant.
      if (id==='f1' && memory.raceCountdown && --memory.raceCountdown===0) {
        const copy=memory.files.get('f10');
        copy.exclusions.push({id:'artist:arrive-entre-deux',kind:'artist',artist:'Arrivé entre deux',updatedAt:Date.now(),deleted:false});
      }
      return r.fulfill({status:200,headers:cors,body:JSON.stringify({id})});
    }
    if(id && method==='DELETE'){memory.files.delete(id);return r.fulfill({status:204,headers:cors,body:''});}
    if(id && u.searchParams.get('alt')==='media'){
      if(!memory.files.has(id))return r.fulfill({status:404,headers:cors,body:'{}'});
      const snapshot=structuredClone(memory.files.get(id));
      if(id==='f1' && memory.preflightRemaining>0){
        const n=++memory.preflightSerial; memory.preflightRemaining--;
        memory.files.get(id).exclusions.push({id:`artist:preflight-${n}`,kind:'artist',artist:`Précontrôle ${n}`,updatedAt:Date.now(),deleted:false});
      }
      return r.fulfill({status:200,headers:cors,body:JSON.stringify(snapshot)});
    }
    return r.fulfill({status:200,headers:cors,body:JSON.stringify({files:[...memory.files.keys()].map(id=>({id,name:'soundblend.json'}))})});
  });
  const page=await ctx.newPage(); await page.goto(base); await page.waitForSelector('.ytm-shell');
  return {ctx,page};
}
const A=await makeDevice('A');
const sync=async p=>p.evaluate(async()=> (await import('/src/services/drive.ts')).demarrerSync());
const state=async p=>p.evaluate(async()=>{const s=await import('/src/services/storage.ts'),prefs=await import('/src/context/prefs.ts');return {soundblend_exclusions_v1:JSON.stringify(s.getExclusionRecords()),soundblend_settings:JSON.stringify(s.getStoredSettings()),soundblend_mode:prefs.getMode(),soundblend_recent_blends:JSON.stringify(s.getStoredBlends()),soundblend_discoveries_v2:JSON.stringify(s.getDiscoveryHistory())}});
check(await sync(A.page),'premier échange avec le Drive simulé');
check(content().schema===2 && !('gouts'in content()) && !('avis'in content()),'migration Drive : anciens avis retirés, sans conversion en bannissement');
check(content().blends.length===1 && content().blends[0].id==='valid' && !('userRating' in content().blends[0].tracks[0]),'blend expiré réellement retiré du fichier Drive et anciens pouces effacés');
check(content().decouvertes.some(x=>x.title==='Ancienne découverte'),'découverte d’un ancien blend valide reconstruite et synchronisée');

await A.page.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
await A.page.getByRole('button',{name:'Ajouter une exclusion'}).click();
await A.page.getByRole('searchbox',{name:'Rechercher dans les exclusions et le catalogue'}).fill('Chanson A');
await A.page.getByRole('button',{name:'Exclure Chanson A de Artiste A'}).click();
check(await sync(A.page),'envoi du geste de blocage depuis les réglages');
check(content().exclusions.filter(x=>!x.deleted).some(x=>x.kind==='track'&&x.artist==='Artiste A'&&x.title==='Chanson A'),'blocage précis de la musique présent dans Drive');
check(!content().exclusions.some(x=>x.kind==='artist'&&x.artist==='Artiste A'),'le blocage d’un morceau ne bannit pas son artiste');

const B=await makeDevice('B');
check(await sync(B.page),'deuxième appareil synchronisé');
let b=await state(B.page);
check(JSON.parse(b.soundblend_exclusions_v1).some(x=>x.title==='Chanson A'&&!x.deleted),'exclusion reçue sur le second appareil');
check(JSON.parse(b.soundblend_settings).geminiApiKey==='cle-test'&&b.soundblend_mode==='dark','clé Gemini et thème reçus');
check(JSON.parse(b.soundblend_recent_blends).some(x=>x.id==='valid')&&JSON.parse(b.soundblend_discoveries_v2).some(x=>x.title==='Ancienne découverte'),'blend et historique de découvertes reçus');

// B reste sur une vieille copie pendant que A débloque et supprime.
await A.page.evaluate(async()=>{const s=await import('/src/services/storage.ts');const e=s.getExclusionRecords().find(x=>x.title==='Chanson A');s.unblock(e.id);s.deleteStoredBlend('valid');});
check(await sync(A.page),'déblocage et suppression envoyés');
check(!content().blends.some(x=>x.id==='valid') && content().suppressionsBlends.valid,'suppression réelle du blend et tombstone dans le fichier Drive');
check(content().exclusions.some(x=>x.title==='Chanson A'&&x.deleted),'déblocage représenté par un tombstone');
await B.page.evaluate(async()=>{const s=await import('/src/services/storage.ts');s.block({artist:'Nouveau groupe'},'artist');});
check(await sync(B.page),'appareil périmé relit le Drive avant son propre envoi');
b=await state(B.page);
check(!content().blends.some(x=>x.id==='valid')&&!JSON.parse(b.soundblend_recent_blends).some(x=>x.id==='valid'),'la vieille copie ne ressuscite pas le blend supprimé');
check(content().exclusions.some(x=>x.title==='Chanson A'&&x.deleted)&&content().exclusions.some(x=>x.artist==='Nouveau groupe'&&!x.deleted),'la vieille copie ne réactive pas l’exclusion et ajoute sa propre modification');
await sync(A.page);
check((await state(A.page)).soundblend_exclusions_v1.includes('Nouveau groupe'),'la modification du second appareil revient au premier');

// Modifications d’un blend : la plus récente gagne même si elle a moins de titres.
await A.page.evaluate(async()=>{const s=await import('/src/services/storage.ts'); const now=Date.now(); const tracks=Array.from({length:4},(_,i)=>({id:'long'+i,title:'Titre '+i,artist:'Groupe',videoId:'LONG000000'+i,thumbnailUrl:'',durationSeconds:200,category:'fresh'}));s.saveBlendToStorage({id:'edited',title:'Édité',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks});});
await sync(A.page);await sync(B.page);
await A.page.evaluate(async()=>{const s=await import('/src/services/storage.ts');const b=s.getStoredBlends().find(x=>x.id==='edited');s.saveBlendToStorage({...b,tracks:b.tracks.slice(0,1)});});
await sync(A.page); await sync(B.page);
check(content().blends.find(x=>x.id==='edited')?.tracks.length===1,'une suppression de titres gagne sur une ancienne copie plus longue');

// Expiration pendant que l’app reste ouverte. Laisser le temps à un cycle
// déjà en cours de se terminer : demarrerSync peut rejoindre ce cycle plutôt
// que celui qui enverra le nouveau blend. On vérifie d'abord sa présence
// avant l'échéance, puis on attend la suppression automatique sans resynchroniser.
const shortUntil=Date.now()+15000;
await A.page.evaluate(async(until)=>{const s=await import('/src/services/storage.ts');let n=Date.now();s.saveBlendToStorage({id:'short',title:'Expiration imminente',createdAt:new Date(n).toISOString(),expiresAt:new Date(until).toISOString(),seedTracks:[],tracks:[]});},shortUntil);
while(!content().blends.some(x=>x.id==='short') && Date.now()<shortUntil-3000){
  await sync(A.page);
  if(!content().blends.some(x=>x.id==='short'))await A.page.waitForTimeout(100);
}
check(Date.now()<shortUntil && content().blends.some(x=>x.id==='short'),'blend éphémère effectivement présent avant expiration');
while(content().blends.some(x=>x.id==='short') && Date.now()<shortUntil+12000)await A.page.waitForTimeout(100);
check(Date.now()>=shortUntil && !content().blends.some(x=>x.id==='short'),'le minuteur retire le blend du JSON Drive après expiration');

// Un échec réseau laisse un indicateur durable et un nouvel essai reprend.
memory.fail=true;
await A.page.evaluate(async()=>{const s=await import('/src/services/storage.ts');s.block({artist:'Hors ligne'},'artist')});
check(!(await sync(A.page)),'panne réseau signalée sans effacement local');
check(await A.page.evaluate(async()=> (await import('/src/services/drive.ts')).enAttente()),'modification hors ligne conservée en attente');
memory.fail=false;
check(await sync(A.page),'reprise après rétablissement du réseau');
check(content().exclusions.some(x=>x.artist==='Hors ligne'&&!x.deleted),'modification hors ligne effectivement envoyée');

// Clé vidée et nouveau thème, pas seulement les valeurs non vides.
await A.page.evaluate(async()=>{const s=await import('/src/services/storage.ts');s.saveStoredSettings({...s.getStoredSettings(),geminiApiKey:''});const p=await import('/src/context/prefs.ts');p.choisirMode('light');});
await sync(A.page);await sync(B.page);b=await state(B.page);
check(JSON.parse(b.soundblend_settings).geminiApiKey===''&&b.soundblend_mode==='light','suppression de la clé et changement de thème synchronisés');

// Doublons : fusion, mais pas de DELETE non atomique risquant de détruire une écriture concurrente.
memory.files.set('f9',{schema:2,modifie:new Date().toISOString(),appareil:'autre',exclusions:[{id:'artist:surplus',kind:'artist',artist:'Surplus',updatedAt:Date.now(),deleted:false}],decouvertes:[],suppressionsBlends:{},blends:[]});
await sync(A.page);
check(memory.files.size===2&&content().exclusions.some(x=>x.artist==='Surplus')&&!memory.calls.some(x=>x.method==='DELETE'),'doublon Drive fusionné et conservé sans DELETE à risque');

memory.files.set('f10',{schema:2,modifie:new Date().toISOString(),appareil:'autre',exclusions:[{id:'artist:copie',kind:'artist',artist:'Copie',updatedAt:Date.now(),deleted:false}],decouvertes:[],suppressionsBlends:{},blends:[]});
memory.raceCountdown=1;
await sync(A.page);
check(memory.files.has('f10') && memory.files.get('f10').exclusions.some(x=>x.artist==='Arrivé entre deux'),'doublon modifié après lecture conservé au lieu d’être supprimé');
check(await A.page.evaluate(async()=> (await import('/src/services/drive.ts')).enAttente()),'relecture supplémentaire planifiée après conflit détecté');
await sync(A.page);
check(memory.files.size===3 && content().exclusions.some(x=>x.artist==='Arrivé entre deux'),'modification concurrente relue et fusionnée au cycle suivant sans suppression des copies');

memory.preflightRemaining=1;
check(await sync(A.page),'changement distant pendant la première lecture : nouveau contrôle avant écriture');
check(content().exclusions.some(x=>x.artist==='Précontrôle 1'),'la modification détectée au précontrôle est effectivement fusionnée avant PATCH');
const patchesBefore=memory.calls.filter(x=>x.method==='PATCH').length;
memory.preflightRemaining=6;
check(!(await sync(A.page)) && await A.page.evaluate(async()=> (await import('/src/services/drive.ts')).enAttente()),'conflits répétés : arrêt borné et état en attente, sans succès fictif');
check(memory.calls.filter(x=>x.method==='PATCH').length===patchesBefore,'aucun PATCH aveugle après épuisement des contrôles');
memory.preflightRemaining=0;
check(await sync(A.page) && content().exclusions.some(x=>x.artist==='Précontrôle 7'),'reprise après stabilisation, modifications concurrentes conservées');
// Une fenêtre demeure entre la dernière relecture et PATCH : aucune garantie atomique n'est prétendue.
console.log(`\n${ok.length}/${ok.length} contrôles Drive simulés réussis`);
await A.ctx.close();await B.ctx.close();await browser.close();
