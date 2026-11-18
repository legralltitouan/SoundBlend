/* Tests ciblés de la deuxième passe. Réponses réseau et images simulées. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({args:['--no-sandbox']});
const ctx=await browser.newContext({serviceWorkers:'block'}); const p=await ctx.newPage();
try {
 await p.goto(new URL('verification/test-harness.html',base).href);
 const stalled=await p.evaluate(async()=>{
  const {resolveCover}=await import('/src/services/covers.ts?body-test');
  const oldFetch=window.fetch,oldTimer=window.setTimeout;let calls=0,aborted=false;
  window.setTimeout=(fn,ms,...args)=>oldTimer(fn,ms===6000?50:ms,...args);
  window.fetch=async(_url,init)=>{calls++; if(calls===1){init.signal.addEventListener('abort',()=>aborted=true); return {ok:true,status:200,json:()=>new Promise(()=>{})};} return {ok:true,status:200,json:async()=>({results:[]})};};
  try {const values=await Promise.all([resolveCover('ArtA','Titre'),resolveCover('ArtB','Titre')]);return {calls,aborted,values};}
  finally {window.fetch=oldFetch;window.setTimeout=oldTimer;}
 });
 assert.equal(stalled.calls,2); assert.equal(stalled.aborted,true); assert.deepEqual(stalled.values,[null,null]);
 console.log('✓ JSON bloqué : délai borné, requête annulée et file libérée');
 const img=await p.evaluate(async()=>{
  const {imageExists}=await import('/src/services/covers.ts?image-test');
  const OldImage=window.Image;let creations=0;
  class FakeImage {constructor(){creations++;this.naturalWidth=80;} set src(_v){setTimeout(()=>this.onload?.(),30)}}
  window.Image=FakeImage;
  try {const values=await Promise.all(Array.from({length:10},()=>imageExists('https://fake.test/img'))); const cached=await imageExists('https://fake.test/img');return {creations,values,cached};}
  finally {window.Image=OldImage;}
 });
 assert.equal(img.creations,1);assert.ok(img.values.every(Boolean)&&img.cached);console.log('✓ dix contrôles simultanés de la même image partagent une seule demande');
 const piped=await p.evaluate(async()=>{
  const {pipedSearch}=await import('/src/services/search.ts?piped-test');const old=window.fetch;let calls=0;
  window.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return new Response(JSON.stringify({items:[{url:'/watch?v=abcdefghijk',title:'Titre',uploaderName:'Artiste'}]}),{status:200})};
  try {const [a,b]=await Promise.all([pipedSearch('identique'),pipedSearch('identique')]);const isolated=a!==b&&a[0]!==b[0];a[0].title='autre';const intact=b[0].title==='Titre';await pipedSearch('identique');return {calls,isolated,intact};} finally {window.fetch=old;}
 });
 assert.equal(piped.calls,2);assert.ok(piped.isolated&&piped.intact);
 console.log('✓ recherches simultanées identiques mutualisées, résultats indépendants et aucun cache persistant');
 const compare=await p.evaluate(async()=>{
  const {isExcluded,isRecentlyProposed,artistMatches}=await import('/src/services/storage.ts');
  const {cleanTitle,norm}=await import('/src/lib/track.ts'); const titleNorm=s=>norm(cleanTitle(s||'').title);
  const oldExcluded=(t,e)=>{const c=cleanTitle(t.title||''),artists=[t.artist||'',c.artist||''].filter(Boolean);return e.artists.some(a=>artists.some(candidate=>artistMatches(candidate,a)))||e.tracks.some(r=>{if(r.videoId&&t.videoId&&r.videoId===t.videoId)return true;return !!r.title&&titleNorm(r.title)===titleNorm(t.title||'')&&artists.some(a=>artistMatches(a,r.artist))})};
  const oldRecent=(t,h)=>{const artists=[t.artist||'',cleanTitle(t.title||'').artist||''].filter(Boolean);return h.some(x=>!!((x.videoId&&t.videoId&&x.videoId===t.videoId)||(titleNorm(x.title)!==''&&titleNorm(x.title)===titleNorm(t.title||'')&&artists.some(a=>artistMatches(a,x.artist)))))};
  const titles=['One More Time','Air - Titre (Official Audio)','Été','', 'Titre [Live]']; const artists=['Air','Air Supply','Daft Punk','Air feat. Bob',''];let count=0;
  for(const title of titles)for(const artist of artists)for(const videoId of ['', 'vid1','vid2']){
   const t={title,artist,videoId};const e={artists:['Daft Punk','Bob'],tracks:titles.flatMap((x,i)=>artists.map(a=>({title:x,artist:a,videoId:i===1?'vid1':''})))};
   const h=e.tracks.map(x=>({...x,shownAt:Date.now()}));
   if(isExcluded(t,e)!==oldExcluded(t,e)||isRecentlyProposed(t,h)!==oldRecent(t,h))return {same:false,count};count++;
  }
  return {same:true,count};
 });
 assert.equal(compare.same,true);console.log(`✓ exclusions et historique : ${compare.count} cas identiques aux règles précédentes`);
} finally {await browser.close();}
