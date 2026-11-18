/* Pagination, délai (en-têtes ET corps) et changement de session ; réseau simulé. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({serviceWorkers:'block'});
const p=await ctx.newPage();await p.goto(new URL('verification/test-harness.html',base).href);
const report=await p.evaluate(async()=>{
 localStorage.clear();
 localStorage.setItem('soundblend_yt_token','old-token');
 localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+3600000));
 const {youtubeService:yt,YouTubeService}=await import('/src/services/youtube.ts');
 const realFetch=window.fetch,realTimer=window.setTimeout;
 // Même chemin de production, délai de 12 s accéléré à 100 ms pour le test.
 window.setTimeout=(fn,ms,...args)=>realTimer(fn,ms===12000?100:ms,...args);
 let mode='',aborts=0,failing=true,releaseSession,requests=[];
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 const item=(id,title)=>({id:'id'+id,snippet:{title,videoOwnerChannelTitle:'Alpha - Topic',thumbnails:{}},contentDetails:{videoId:id}});
 const playlist=(i)=>({id:'PL'+i,snippet:{title:'Playlist '+i,thumbnails:{}},contentDetails:{itemCount:1}});
 window.fetch=async (input,init={})=>{
   const u=new URL(String(input));if(!u.hostname.includes('googleapis.com'))return realFetch(input,init);
   requests.push({mode,playlist:u.searchParams.get('playlistId'),token:u.searchParams.get('pageToken'),raw:u.href,auth:new Headers(init.headers).get('Authorization')});
   if(mode==='headers')return new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>{aborts++;reject(new DOMException('aborted','AbortError'))},{once:true})});
   if(mode==='body'){
     init.signal.addEventListener('abort',()=>{aborts++},{once:true});
     // Réponse 200 dont le flux JSON ne se termine jamais.
     return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"items":['))}}),{status:200,headers:{'content-type':'application/json'}});
   }
   if(mode==='http')return new Response('erreur non JSON',{status:503});
   if(mode==='pages'){
     const pg=u.searchParams.get('pageToken');
     if(!pg)return json({items:[item('FIRST000001','Premier')],nextPageToken:'p+&/='});
     return failing?new Response('page indisponible',{status:503}):json({items:[item('SECOND00001','Second')]});
   }
   if(mode==='cycle')return json({items:[],nextPageToken:'repeat'});
   if(mode==='invalid')return json({items:[],nextPageToken:{not:'text'}});
   if(mode==='many'){
     const pg=Number(u.searchParams.get('pageToken')||'0');
     return json({items:Array.from({length:pg<3?50:1},(_,i)=>playlist(pg*50+i)),...(pg<3?{nextPageToken:String(pg+1)}:{})});
   }
   if(mode==='session')return new Promise(resolve=>{releaseSession=()=>resolve(json({items:[item('OLDUSER0001','Ancien compte')]}))});
   if(mode==='newsession')return json({items:[item('NEWUSER0001','Nouveau compte')]});
   if(mode==='unauthorized')return new Response('refus',{status:401});
   throw new Error('Mode inattendu '+mode);
 };
 const err=async fn=>{try{await fn();return ''}catch(e){return String(e.message||e)}};
 try {
   mode='headers';const started=performance.now();const headersError=await err(()=>yt.fetchPlaylistTracks('WAIT-HEAD'));const headersMs=performance.now()-started;
   mode='body';const startedBody=performance.now();const bodyError=await err(()=>yt.fetchPlaylistTracks('WAIT-BODY'));const bodyMs=performance.now()-startedBody;
   mode='http';const httpError=await err(()=>yt.fetchPlaylistTracks('HTTP'));
   mode='pages';const special='PL&Q/%?É';const pageError=await err(()=>yt.fetchPlaylistTracks(special));failing=false;
   const completed=await yt.fetchPlaylistTracks(special);const pageRequests=requests.filter(r=>r.mode==='pages');
   mode='cycle';const cycleTracks=await err(()=>yt.fetchPlaylistTracks('CYCLE'));const cycleLists=await err(()=>yt.fetchPlaylists());
   mode='invalid';const invalidTracks=await err(()=>yt.fetchPlaylistTracks('INVALID'));const invalidLists=await err(()=>yt.fetchPlaylists());
   mode='many';const allPlaylists=await yt.fetchPlaylists();
   mode='session';const pending=yt.fetchPlaylistTracks('SESSION').then(value=>({value}),e=>({error:e.message}));
   while(!releaseSession)await new Promise(r=>realTimer(r,1));
   yt.logout();releaseSession();const lostSession=await pending;
   localStorage.setItem('soundblend_yt_token','new-token');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+3600000));
   const second=new YouTubeService();mode='newsession';const refreshed=await second.fetchPlaylistTracks('SESSION');
   mode='unauthorized';const unauthorized=await err(()=>second.fetchPlaylistTracks('NOAUTH'));
   return {headersError,headersMs,bodyError,bodyMs,aborts,httpError,pageError,completed,pageRequests,cycleTracks,cycleLists,invalidTracks,invalidLists,
     playlists:allPlaylists.length,lastPlaylist:allPlaylists.at(-1)?.title,lostSession,refreshed,unauthorized,authenticated:second.isAuthenticated()};
 } finally {window.fetch=realFetch;window.setTimeout=realTimer;}
});
let n=0;const check=(ok,label)=>{assert.ok(ok,`${label}\n${JSON.stringify(report)}`);console.log('  ✓ '+label);n++};
check(/Impossible de lire la playlist/.test(report.headersError)&&report.headersMs<3000,'requête sans en-têtes interrompue et erreur explicite');
check(/Impossible de lire la playlist/.test(report.bodyError)&&report.bodyMs<3000,'corps JSON bloqué après les en-têtes également interrompu');
check(report.aborts===2,'signal d’annulation envoyé pour les deux délais');
check(/HTTP 503/.test(report.httpError),'erreur HTTP conservée même si le corps n’est pas du JSON');
check(/page 2, HTTP 503/.test(report.pageError)&&report.completed.map(t=>t.title).join(',')==='Premier,Second','page 2 en échec puis nouvel essai complet, sans cache partiel');
check(report.pageRequests.length===4&&report.pageRequests.every(r=>r.playlist==='PL&Q/%?É')&&report.pageRequests[1].token==='p+&/='&&report.pageRequests[3].token==='p+&/=','identifiant de playlist et jeton de page correctement encodés');
check(report.pageRequests.every(r=>r.auth==='Bearer old-token'),'même session utilisée pour toutes les pages');
check(/pagination invalide/.test(report.cycleTracks)&&/pagination invalide/.test(report.cycleLists),'boucles de pagination détectées pour titres et bibliothèque');
check(/pagination invalide/.test(report.invalidTracks)&&/pagination invalide/.test(report.invalidLists),'jetons de pagination non textuels refusés');
check(report.playlists===151&&report.lastPlaylist==='Playlist 150','plus de 150 playlists chargées intégralement');
check(/session Google a changé/.test(report.lostSession.error)&&report.refreshed[0]?.title==='Nouveau compte','déconnexion en cours de lecture : aucun cache du compte précédent réinjecté');
check(/Session YouTube expirée/.test(report.unauthorized)&&!report.authenticated,'refus 401 signale la session expirée et déconnecte');
console.log(`\n${n}/${n} contrôles bibliothèque YouTube simulés réussis`);await browser.close();
