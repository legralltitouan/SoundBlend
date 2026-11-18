/* Création YouTube et panne de stockage : API/compte simulés, jamais réels. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS,PATCH','access-control-allow-headers':'*'};
const state={created:0,serial:0,lists:new Map(),events:[],noIdNext:false,rejectNext:false,wrongMeta:false,failMetaRead:false,replaceJournalNext:false};
await ctx.addInitScript(()=>{
 const now=Date.now(),titles=[['preflight','Précontrôle'],['quota','Quota après création'],['session','Lien en session'],['unknown','Réponse perdue'],['refuse','Création refusée'],['meta','Visibilité non confirmée'],['meta-read','Lecture métadonnées refusée'],['course','Tentative remplacée']];
 const track={id:'RECOV000001',videoId:'RECOV000001',title:'Titre de test',artist:'Artiste de test',thumbnailUrl:'',durationSeconds:180,category:'anchor'};
 const blends=titles.map(([id,title])=>({id,title,description:'',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks:[track]}));
 if(!localStorage.getItem('__seed-reprise')){
  localStorage.setItem('__seed-reprise','1');localStorage.setItem('soundblend_onboarded','1');
  localStorage.setItem('soundblend_account_v1:google-A:soundblend_recent_blends',JSON.stringify(blends));
  localStorage.setItem('soundblend_account_v1:google-B:soundblend_recent_blends',JSON.stringify(blends));
 }
 if(!sessionStorage.getItem('soundblend_google_session_v2')){
  const owner=new URL(location.href).searchParams.get('owner')==='B'?'google-B':'google-A';
  sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'FAUX-'+owner,owner,expiresAt:now+3600000,profile:{name:owner,email:'',avatarUrl:''}}));
 }
 window.__refuse={};
 const original=Storage.prototype.setItem;
 Storage.prototype.setItem=function(key,value){
  const local=this===window.localStorage,session=this===window.sessionStorage, intent=String(key).includes('soundblend_export_intent_v1:');
  if(local&&intent&&window.__refuse.intent)throw new DOMException('quota','QuotaExceededError');
  if(local&&intent&&window.__refuse.known&&String(value).includes('playlistId'))throw new DOMException('quota','QuotaExceededError');
  if(local&&String(key).endsWith(':soundblend_recent_blends')&&window.__refuse.blend)throw new DOMException('quota','QuotaExceededError');
  if(session&&intent&&window.__refuse.session)throw new DOMException('quota','QuotaExceededError');
  return original.call(this,key,value);
 };
});
await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>r.fulfill({status:503,headers:cors,body:'{}'}));
await ctx.route('https://www.googleapis.com/youtube/v3/**',async r=>{
 const req=r.request(),u=new URL(req.url()),m=req.method(),respond=(status,data={})=>r.fulfill({status,headers:cors,body:JSON.stringify(data)});
 if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
 state.events.push({method:m,path:u.pathname,query:u.search,body:req.postData()});
 if(u.pathname.endsWith('/playlists')){
  if(m==='POST'){
   if(state.rejectNext){state.rejectNext=false;return respond(403,{error:{message:'refus'}})}
   const id=`PL-REPRISE-${++state.created}`,body=JSON.parse(req.postData());
   state.lists.set(id,{title:body.snippet.title,privacy:body.status.privacyStatus,items:[]});
   if(state.replaceJournalNext){
    state.replaceJournalNext=false;
    // Simule un autre onglet qui remplace l'intention pendant que YouTube
    // répond ; l'ancienne réponse ne doit pas écraser le nouveau journal.
    await p.evaluate(()=>{const key='soundblend_account_v1:google-A:soundblend_export_intent_v1:course';const rec=JSON.parse(localStorage.getItem(key));rec.attempt='AUTRE-TENTATIVE';localStorage.setItem(key,JSON.stringify(rec));});
   }
   if(state.noIdNext){state.noIdNext=false;return respond(200,{})}
   return respond(200,{id});
  }
  if(m==='PUT'){
   const b=JSON.parse(req.postData()),list=state.lists.get(b.id);if(!list)return respond(404);
   list.title=b.snippet.title;list.privacy=b.status.privacyStatus;return respond(200,{id:b.id});
  }
  if(m==='GET'){
   const id=u.searchParams.get('id');if(id&&state.failMetaRead)return respond(403);
   const list=state.lists.get(id);return respond(200,{items:list?[{id,snippet:{title:list.title},status:{privacyStatus:state.wrongMeta?'public':list.privacy}}]:[]});
  }
 }
 if(u.pathname.endsWith('/playlistItems')){
  if(m==='GET'){
   const list=state.lists.get(u.searchParams.get('playlistId'));if(!list)return respond(404);
   return respond(200,{items:list.items.map(x=>({id:x.itemId,snippet:{resourceId:{videoId:x.videoId}}}))});
  }
  if(m==='POST'){
   const b=JSON.parse(req.postData()),list=state.lists.get(b.snippet.playlistId);if(!list)return respond(404);
   const item={itemId:`item-${++state.serial}`,videoId:b.snippet.resourceId.videoId};
   if(Number.isInteger(b.snippet.position))list.items.splice(b.snippet.position,0,item);else list.items.push(item);
   return respond(200,{id:item.itemId});
  }
  if(m==='DELETE'){
   for(const list of state.lists.values())list.items=list.items.filter(x=>x.itemId!==u.searchParams.get('id'));
   return r.fulfill({status:204,headers:cors,body:''});
  }
 }
 return respond(200,{items:[]});
});
const errors=[],p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const open=async(page,title)=>{await page.locator('.ytm-mobile-bar [aria-label="Blends"]').click();await page.getByRole('button',{name:`Ouvrir ${title}`,exact:true}).click();};
const saved=(page,id)=>page.evaluate(id=>JSON.parse(localStorage.getItem('soundblend_account_v1:google-A:soundblend_recent_blends')||'[]').find(x=>x.id===id),id);
const waitAlert=(page,text)=>page.locator('.sb-action-error[role="alert"]').filter({hasText:text}).waitFor();
const update=async(page)=>{await page.getByRole('button',{name:'Mettre à jour',exact:true}).click();await page.getByText(/Playlist vérifiée et mise à jour|La playlist était déjà à jour/).waitFor()};
const href=async(page)=>page.getByRole('link',{name:'YouTube Music'}).getAttribute('href');
try{
 await p.goto(base);await p.waitForSelector('.ytm-shell');await open(p,'Précontrôle');
 await p.evaluate(()=>window.__refuse.intent=true);await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'aucune demande de création');
 check(state.created===0&&!state.events.some(x=>x.method==='POST'&&x.path.endsWith('/playlists')),'précontrôle du stockage refusé : aucune création envoyée à YouTube');
 check(await p.getByRole('button',{name:'Exporter',exact:true}).isVisible(),'précontrôle refusé : nouvel essai possible après correction du stockage');
 await p.evaluate(()=>window.__refuse.intent=false);await open(p,'Quota après création');
 const other=await ctx.newPage();await other.goto(base);await other.waitForSelector('.ytm-shell');await open(other,'Quota après création');
 await p.evaluate(()=>{window.__refuse.blend=true;window.__refuse.known=true;window.__refuse.session=true});
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'Playlist créée, mais export incomplet');
 check(state.created===1&&!(await saved(p,'quota')).exportedPlaylistId&&state.lists.get('PL-REPRISE-1').items.length===0,'création acceptée puis quota : pas de signature ni de faux succès');
 check((await href(p)).endsWith('PL-REPRISE-1')&&await p.getByRole('button',{name:'Réessayer d’enregistrer le lien'}).isVisible(),'lien créé visible et tentative de sauvegarde proposée dans l’onglet');
 await other.getByRole('button',{name:'Associer ce lien'}).waitFor();
 check(await other.getByRole('button',{name:'Exporter',exact:true}).count()===0,'autre onglet du même compte averti : pas de second bouton de création');await other.close();
 const b=await ctx.newPage();await b.goto(new URL('?owner=B',base).href);await b.waitForSelector('.ytm-shell');await open(b,'Quota après création');
 await b.getByRole('button',{name:'Exporter',exact:true}).waitFor();
 check(await b.getByRole('button',{name:'Exporter',exact:true}).isVisible()&&await b.getByRole('button',{name:'Associer ce lien'}).count()===0,'journal de récupération isolé : le compte B ne voit pas la tentative A');await b.close();
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await open(p,'Quota après création');
 await p.getByRole('button',{name:'Associer ce lien'}).waitFor();
 check(await p.getByRole('button',{name:'Exporter',exact:true}).count()===0&&await p.getByRole('button',{name:'Associer ce lien'}).isVisible(),'après rechargement et perte du lien en session : création bloquée tant que YouTube n’est pas vérifié');
 await p.getByLabel('Lien ou identifiant de la playlist créée').fill('https://example.org/playlist?list=PL-REPRISE-1');await p.getByRole('button',{name:'Associer ce lien'}).click();await waitAlert(p,'lien de playlist YouTube valide');
 check(!(await saved(p,'quota')).exportedPlaylistId,'un lien non YouTube est refusé sans associer la playlist');
 await p.getByLabel('Lien ou identifiant de la playlist créée').fill('https://music.youtube.com/playlist?list=PL-REPRISE-1');await p.getByRole('button',{name:'Associer ce lien'}).click();await waitAlert(p,'Lien enregistré');
 check((await saved(p,'quota')).exportedPlaylistId==='PL-REPRISE-1'&&(await saved(p,'quota')).exportedMeta.sig===''&&state.created===1,'lien retrouvé associé sans prétendre que la playlist est à jour');
 await update(p);check(state.created===1&&state.lists.get('PL-REPRISE-1').items.length===1&&(await saved(p,'quota')).exportedMeta.sig==='Quota après création|private|RECOV000001','reprise et vérification sur la même playlist, sans création de doublon');

 await open(p,'Lien en session');await p.evaluate(()=>{window.__refuse.blend=true;window.__refuse.known=true;window.__refuse.session=false});
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'Playlist créée, mais export incomplet');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await open(p,'Lien en session');
 check((await href(p)).endsWith('PL-REPRISE-2')&&await p.getByRole('button',{name:'Réessayer d’enregistrer le lien'}).isVisible(),'lien secouru par sessionStorage retrouvé après rechargement du même onglet');
 await p.getByRole('button',{name:'Réessayer d’enregistrer le lien'}).click();await waitAlert(p,'Lien enregistré');await update(p);
 check(state.created===2&&state.lists.get('PL-REPRISE-2').items.length===1,'récupération du lien en session et reprise sans nouvelle création');

 await open(p,'Réponse perdue');state.noIdNext=true;
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'Création non confirmée');
 check(state.created===3&&await p.getByRole('button',{name:'Exporter',exact:true}).count()===0,'réponse de création sans identifiant : état incertain et nouvel export bloqué');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await open(p,'Réponse perdue');
 await p.getByLabel('Lien ou identifiant de la playlist créée').fill('PL-REPRISE-3');await p.getByRole('button',{name:'Associer ce lien'}).click();await waitAlert(p,'Lien enregistré');await update(p);
 check(state.created===3&&state.lists.get('PL-REPRISE-3').items.length===1,'réponse perdue : association manuelle puis reprise sans doublon');

 await open(p,'Création refusée');state.rejectNext=true;
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'Création non confirmée');
 check(state.created===3&&await p.getByRole('button',{name:'J’ai vérifié : aucune playlist créée'}).isVisible(),'refus explicite : vérification demandée avant toute nouvelle tentative');
 await p.getByRole('button',{name:'J’ai vérifié : aucune playlist créée'}).click();
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await p.getByText('Playlist créée et contenu vérifié sur YouTube Music.').waitFor();
 check(state.created===4&&(await saved(p,'refuse')).exportedMeta.sig==='Création refusée|private|RECOV000001','nouvelle création seulement après confirmation explicite');

 await open(p,'Visibilité non confirmée');state.wrongMeta=true;
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'titre ou la visibilité');
 check((await saved(p,'meta')).exportedMeta.sig===''&&await p.getByRole('button',{name:'Mettre à jour',exact:true}).isVisible(),'contenu accepté mais visibilité différente : aucun succès ni signature');
 state.wrongMeta=false;await update(p);
 check((await saved(p,'meta')).exportedMeta.sig==='Visibilité non confirmée|private|RECOV000001','signature inscrite seulement après relecture du titre et de la visibilité');

 await open(p,'Lecture métadonnées refusée');state.failMetaRead=true;
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'Lecture des métadonnées');
 check((await saved(p,'meta-read')).exportedMeta.sig===''&&state.lists.get('PL-REPRISE-6').items.length===1,'relecture des métadonnées 403 : export partiel et signature vide');
 state.failMetaRead=false;await update(p);
 check(state.created===6&&(await saved(p,'meta-read')).exportedMeta.sig==='Lecture métadonnées refusée|private|RECOV000001','relecture rétablie : reprise sans recréer la playlist');

 await open(p,'Tentative remplacée');state.replaceJournalNext=true;
 await p.getByRole('button',{name:'Exporter',exact:true}).click();await waitAlert(p,'Une autre tentative a remplacé celle-ci');
 const rec=await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_account_v1:google-A:soundblend_export_intent_v1:course')));
 check(state.created===7&&(await href(p)).endsWith('PL-REPRISE-7')&&rec.attempt==='AUTRE-TENTATIVE'&&!(await saved(p,'course')).exportedPlaylistId,'journal remplacé pendant la création : lien conservé à l’écran, autre tentative non écrasée');
 await p.getByRole('button',{name:'Réessayer d’enregistrer le lien'}).click();await waitAlert(p,'Une autre tentative a remplacé celle-ci');
 check(state.created===7&&!((await saved(p,'course')).exportedPlaylistId),'un nouvel essai ne modifie pas une tentative concurrente ni ne crée de doublon');
 check(errors.length===0,`aucune exception JavaScript (${errors.join('; ')})`);
 console.log(`\n${n}/${n} contrôles de reprise YouTube réussis — services et comptes simulés.`);
}finally{await ctx.close();await browser.close();}
