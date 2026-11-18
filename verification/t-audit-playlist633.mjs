/* Non-régression des playlists YouTube : toutes les API sont simulées.
   Un refus de lecture/ajout/retrait/métadonnées ne valide jamais la signature. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS,PATCH','access-control-allow-headers':'*'};
const state={failRead:true,failAdd:false,failRemove:false,failMeta:false,failFinal:false,created:0,serial:1,events:[],lists:new Map([['PL-FAUX',{title:'Audit playlist',privacy:'private',items:[{itemId:'ancien',videoId:'OLDS0000001'}]}]])};
await ctx.addInitScript(()=>{
  const now=Date.now();
  const t={id:'NEWS0000001',videoId:'NEWS0000001',title:'Nouveau titre',artist:'Artiste test',thumbnailUrl:'',durationSeconds:180,category:'fresh'};
  const common={description:'',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks:[t]};
  const updated={...common,id:'audit-update',title:'Audit playlist',exportedPlaylistId:'PL-FAUX',exportedUrl:'https://music.youtube.com/playlist?list=PL-FAUX',exportedMeta:{sig:'Audit playlist|private|OLDS0000001',title:'Audit playlist',privacy:'private',at:new Date(now-60000).toISOString()}};
  const fresh={...common,id:'audit-export',title:'Audit export'};
  const verify={...common,id:'audit-verify',title:'Audit vérification'};
  localStorage.setItem('soundblend_onboarded','1');
  sessionStorage.setItem('soundblend_google_session_v2',JSON.stringify({token:'FAUX-JETON',owner:'google-yt',expiresAt:now+3600000,profile:{name:'Compte fictif',email:'',avatarUrl:''}}));
  localStorage.setItem('soundblend_account_v1:google-yt:soundblend_recent_blends',JSON.stringify([updated,fresh,verify]));
});
await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}}),revoke:(_t,cb)=>cb()}}};'}));
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>r.fulfill({status:503,headers:cors,body:'{}'}));
await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>{
  const req=r.request(),u=new URL(req.url()),m=req.method();
  if(m==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
  state.events.push({method:m,path:u.pathname,query:u.search,body:req.postData()});
  const respond=(status,data={})=>r.fulfill({status,headers:cors,body:JSON.stringify(data)});
  if(u.pathname.endsWith('/playlists')){
    if(m==='GET'){
      const id=u.searchParams.get('id'),list=state.lists.get(id);
      return respond(200,{items:list?[{id,snippet:{title:list.title},status:{privacyStatus:list.privacy}}]:[]});
    }
    if(m==='POST'){
      const id=`PL-NOUVELLE-${++state.created}`; const body=JSON.parse(req.postData());
      state.lists.set(id,{title:body.snippet.title,privacy:body.status.privacyStatus,items:[]});return respond(200,{id});
    }
    if(m==='PUT'){
      if(state.failMeta)return respond(403,{error:{message:'refus métadonnées'}});
      const body=JSON.parse(req.postData()),list=state.lists.get(body.id); if(!list)return respond(404);
      list.title=body.snippet.title;list.privacy=body.status.privacyStatus;return respond(200,{id:body.id});
    }
  }
  if(u.pathname.endsWith('/playlistItems')){
    if(m==='GET'){
      const id=u.searchParams.get('playlistId');
      if(id==='PL-PAGINATION')return u.searchParams.has('pageToken')?respond(403):respond(200,{items:[{id:'p1',snippet:{resourceId:{videoId:'PAGE0000001'}}}],nextPageToken:'suite'});
      const list=state.lists.get(id); if(!list)return respond(404);
      if((state.failRead&&id==='PL-FAUX')||(state.failFinal&&id.startsWith('PL-NOUVELLE-')&&list.items.length))return respond(403,{error:{message:'refus lecture'}});
      return respond(200,{items:list.items.map(x=>({id:x.itemId,snippet:{resourceId:{videoId:x.videoId}}}))});
    }
    if(m==='POST'){
      if(state.failAdd)return respond(403,{error:{message:'refus ajout'}});
      const body=JSON.parse(req.postData()),id=body.snippet.playlistId,list=state.lists.get(id); if(!list)return respond(404);
      const item={itemId:`item-${state.serial++}`,videoId:body.snippet.resourceId.videoId};
      const position=body.snippet.position; if(Number.isInteger(position))list.items.splice(position,0,item);else list.items.push(item);
      return respond(200,{id:item.itemId});
    }
    if(m==='DELETE'){
      if(state.failRemove)return respond(403,{error:{message:'refus retrait'}});
      const itemId=u.searchParams.get('id'); for(const list of state.lists.values())list.items=list.items.filter(x=>x.itemId!==itemId);
      return r.fulfill({status:204,headers:cors,body:''});
    }
  }
  return respond(200,{items:[]});
});
const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const saved=id=>p.evaluate(async id=>(await import('/src/services/storage.ts')).getStoredBlends().find(x=>x.id===id),id);
const openHistory=async()=>{await p.locator('.ytm-mobile-bar [aria-label="Blends"]').click();};
const open=async title=>{await p.getByRole('button',{name:`Ouvrir ${title}`,exact:true}).click();};
const update=async()=>{await p.getByRole('button',{name:'Mettre à jour',exact:true}).click();};
const alert=async text=>{await p.locator('.sb-action-error[role="alert"]').filter({hasText:text}).waitFor();};
try{
  await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await openHistory();await open('Audit playlist');
  const orig=(await saved('audit-update')).exportedMeta.sig;
  await update();await alert('Lecture de la playlist refusée');
  check((await saved('audit-update')).exportedMeta.sig===orig && await p.getByRole('button',{name:'Mettre à jour',exact:true}).isVisible(),'lecture 403 : ancienne signature conservée et nouvel essai proposé');
  check(!state.events.some(x=>x.method==='POST'&&x.path.endsWith('/playlistItems')),'lecture refusée : aucun ajout aveugle');

  state.failRead=false;state.failRemove=true;await update();await alert('Retrait d’un titre refusé');
  check((await saved('audit-update')).exportedMeta.sig===orig&&state.lists.get('PL-FAUX').items[0].videoId==='OLDS0000001','retrait 403 : aucune fausse mise à jour');
  state.failRemove=false;state.failAdd=true;await update();await alert('Ajout ou déplacement d’un titre refusé');
  check((await saved('audit-update')).exportedMeta.sig===orig&&state.lists.get('PL-FAUX').items.length===0,'ajout 403 après retrait : état partiel signalé sans signature');
  state.failAdd=false;await update();await p.getByText(/Playlist vérifiée et mise à jour/).waitFor();
  check((await saved('audit-update')).exportedMeta.sig==='Audit playlist|private|NEWS0000001'&&state.lists.get('PL-FAUX').items[0].videoId==='NEWS0000001','reprise réussie : contenu relu et signature seulement ensuite');

  await p.locator('.sb-title-edit').click();await p.locator('.sb-rename input').fill('Audit renommé');await p.locator('.sb-rename button').click();
  state.failMeta=true;await update();await alert('Modification du titre ou de la visibilité refusée');
  check((await saved('audit-update')).exportedMeta.sig==='Audit playlist|private|NEWS0000001','métadonnées refusées : signature précédente conservée');
  state.failMeta=false;await update();await p.getByText(/Playlist vérifiée et mise à jour/).waitFor();
  check((await saved('audit-update')).exportedMeta.sig==='Audit renommé|private|NEWS0000001'&&state.lists.get('PL-FAUX').title==='Audit renommé','titre confirmé avant de mettre à jour la signature');

  await openHistory();await open('Audit export');state.failAdd=true;
  await p.getByRole('button',{name:'Exporter',exact:true}).click();await alert('Playlist créée, mais export incomplet');
  const partial=await saved('audit-export');
  check(state.created===1&&partial.exportedPlaylistId==='PL-NOUVELLE-1'&&partial.exportedMeta.sig===''&&state.lists.get('PL-NOUVELLE-1').items.length===0,'export partiel : lien conservé, signature vide et avertissement visible');
  check(await p.getByRole('button',{name:'Mettre à jour',exact:true}).isVisible(),'export partiel : bouton de reprise disponible au lieu d’une nouvelle playlist');
  state.failAdd=false;await update();await p.getByText(/Playlist vérifiée et mise à jour/).waitFor();
  check(state.created===1&&(await saved('audit-export')).exportedMeta.sig==='Audit export|private|NEWS0000001'&&state.lists.get('PL-NOUVELLE-1').items.length===1,'reprise sur la même playlist sans doublon');

  await openHistory();await open('Audit vérification');state.failFinal=true;
  await p.getByRole('button',{name:'Exporter',exact:true}).click();await alert('Playlist créée, mais export incomplet');
  check((await saved('audit-verify')).exportedMeta.sig===''&&state.lists.get('PL-NOUVELLE-2').items.length===1,'ajout accepté mais relecture 403 : aucune signature de succès');
  state.failFinal=false;await update();await p.getByText(/Playlist vérifiée et mise à jour|La playlist était déjà à jour/).waitFor();
  check((await saved('audit-verify')).exportedMeta.sig==='Audit vérification|private|NEWS0000001'&&state.lists.get('PL-NOUVELLE-2').items.length===1,'relecture ultérieure confirme le contenu sans ajouter deux fois');
  const pagination=await p.evaluate(async()=>{try{await (await import('/src/services/youtube.ts')).youtubeService.getPlaylistItems('PL-PAGINATION');return 'succès incorrect'}catch(e){return e.message}});
  check(pagination.includes('HTTP 403'),'panne sur la seconde page : lecture incomplète signalée, pas de liste partielle validée');

  await openHistory();const row=p.locator('.sb-blend-row').filter({hasText:'Audit export'});
  await row.getByRole('button',{name:'Supprimer',exact:true}).click();
  check(await p.getByText(/playlist YouTube sera conservée/).isVisible(),'confirmation explique que la playlist YouTube sera conservée');
  await row.getByRole('button',{name:'Supprimer',exact:true}).click();
  check(!(await saved('audit-export'))&&state.lists.get('PL-NOUVELLE-1').items.length===1&&!state.events.some(x=>x.method==='DELETE'&&x.path.endsWith('/playlists')),'suppression du blend seul : playlist YouTube inchangée');
  const noAuth=await p.evaluate(async()=>{const y=(await import('/src/services/youtube.ts')).youtubeService;y.logout();try{await y.createPlaylist('test','',true);return false}catch{return true}});
  check(noAuth,'sans session, la création ne renvoie jamais une fausse playlist fictive');
  check(errors.length===0,`aucune exception JavaScript (${errors.join('; ')})`);
  console.log(`\n${n}/${n} contrôles playlist réussis — API et comptes simulés.`);
} finally{await ctx.close();await browser.close();}
