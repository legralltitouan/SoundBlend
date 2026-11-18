/* Régressions ciblées : iTunes, fusion d'exclusions et annulation réseau.
   Les appels sont simulés ; aucun compte ou service réel n'est utilisé. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({args:['--no-sandbox']});
const ctx = await browser.newContext({serviceWorkers:'block'});
const page = await ctx.newPage();
try {
 await page.goto(new URL('verification/test-harness.html',base).href);
 const result = await page.evaluate(async () => {
  const { resolveCover } = await import('/src/services/covers.ts');
  const original = window.fetch; let inFlight=0, peak=0; const times=[];
  window.fetch = async () => {
   times.push(Date.now()); inFlight++; peak=Math.max(peak,inFlight);
   await new Promise(resolve=>setTimeout(resolve,100)); inFlight--;
   return new Response(JSON.stringify({results:[]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  await Promise.all(['A1','B2','C3'].map(x=>resolveCover(x,'unique')));
  window.fetch=original;
  return { peak, gaps: times.slice(1).map((t,i)=>t-times[i]), total:times.length };
 });
 assert.equal(result.total,3); assert.equal(result.peak,1); assert.ok(result.gaps.every(x=>x>=300),JSON.stringify(result));
 console.log('✓ requêtes pochettes concurrentes : un seul appel à la fois, espacements conservés');
 const quiet = await page.evaluate(async () => {
  const {resolveCover}=await import('/src/services/covers.ts?quiet-test'); const previous=window.fetch; let calls=0;
  window.fetch=async()=>{calls++;return new Response('{}',{status:429})};
  await Promise.all(['D1','E2','F3'].map(x=>resolveCover(x,'autre')));window.fetch=previous;return calls;
 });
 assert.equal(quiet,1);console.log('✓ après 429, les demandes déjà en file ne relancent pas iTunes');
 const fusion = await page.evaluate(async () => {
  const {fusionnerExclusionsAvecGestesLocaux,mergeExclusionRecords}=await import('/src/services/storage.ts');
  const local=Array.from({length:5000},(_,i)=>({id:'id'+i,kind:'artist',artist:'a'+i,updatedAt:i+1,_pending:true,deleted:false}));
  const remote=local.map(x=>({...x,artist:'remote'+x.id,updatedAt:x.updatedAt+10,_pending:false}));
  const old=(a,b)=>{const latest=mergeExclusionRecords(b.map(({_pending,...r})=>r));const rebased=a.map(r=>{const o=latest.find(x=>x.id===r.id);const same=o&&r.id===o.id&&r.kind===o.kind&&r.artist===o.artist&&(r.title||'')===(o.title||'')&&(r.videoId||'')===(o.videoId||'')&&r.deleted===o.deleted;return !r._pending||!o||o.updatedAt<r.updatedAt||same?r:{...r,updatedAt:o.updatedAt+1}});return mergeExclusionRecords(rebased,latest)};
  const t0=performance.now(),reference=old(local,remote),t1=performance.now(),current=fusionnerExclusionsAvecGestesLocaux(local,remote),t2=performance.now();
  return {same:JSON.stringify(reference)===JSON.stringify(current),oldMs:Math.round(t1-t0),newMs:Math.round(t2-t1)};
 });
 assert.ok(fusion.same); console.log(`✓ fusion de 5 000 exclusions identique à la référence ; ${fusion.oldMs} ms → ${fusion.newMs} ms (mesure locale indicative)`);
 const aborted = await page.evaluate(async () => {
  const {verifyVideo}=await import('/src/services/search.ts?timeout-test');
  const oldFetch=window.fetch,oldTimer=window.setTimeout;let wasAborted=false;
  window.setTimeout=(fn,ms,...args)=>oldTimer(fn,ms===6000?25:ms,...args);
  window.fetch=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>{wasAborted=true;reject(new DOMException('aborted','AbortError'))}));
  try { return { value:await verifyVideo('abcdefghijk'),wasAborted }; }
  finally {window.fetch=oldFetch;window.setTimeout=oldTimer;}
 });
 assert.equal(aborted.value,null); assert.equal(aborted.wasAborted,true);
 console.log('✓ délai de recherche : annulation de la requête et résultat indéterminé conservé');
} finally { await browser.close(); }
