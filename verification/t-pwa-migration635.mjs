/* Mise à niveau avec le vrai site 6.9.34, puis le site 6.9.35 compilé.
   SOUNDBLEND_PREVIOUS_SITE_ZIP (ou SOUNDBLEND_PREVIOUS_SITE_DIR) choisit
   l'ancienne version ; aucune API Google réelle n'est appelée. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Ce test utilise son propre serveur ; seul le chemin de SOUNDBLEND_URL
// détermine le point de montage. Les deux sites doivent être compilés pour
// cette même base, faute de quoi l'essai échoue au lieu de tester la racine.
const basePath=process.env.SOUNDBLEND_BASE_PATH||(process.env.SOUNDBLEND_URL?new URL(process.env.SOUNDBLEND_URL).pathname:'/');
if(!basePath.startsWith('/')||!basePath.endsWith('/')||/[?#\\]/.test(basePath)||basePath.split('/').some(s=>s==='.'||s==='..'))throw new Error(`Base de test invalide : ${basePath}`);
const current=path.resolve(process.env.SOUNDBLEND_CURRENT_SITE_DIR||'dist');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'soundblend-pwa-'));
let previous=process.env.SOUNDBLEND_PREVIOUS_SITE_DIR?path.resolve(process.env.SOUNDBLEND_PREVIOUS_SITE_DIR):path.join(temp,'old');
if(!process.env.SOUNDBLEND_PREVIOUS_SITE_DIR){
 const zip=path.resolve(process.env.SOUNDBLEND_PREVIOUS_SITE_ZIP||'../SoundBlend-v6.9.34-site.zip');
 if(!fs.existsSync(zip))throw new Error(`Ancien site introuvable : ${zip}. Indique SOUNDBLEND_PREVIOUS_SITE_ZIP ou SOUNDBLEND_PREVIOUS_SITE_DIR.`);
 fs.mkdirSync(previous,{recursive:true});execFileSync('unzip',['-q',zip,'-d',previous]);
}
if(!fs.existsSync(path.join(current,'index.html')))throw new Error(`Site courant introuvable dans ${current} : le construire pour ${basePath} avant ce test.`);
const previousHtml=fs.readFileSync(path.join(previous,'index.html'),'utf8');
const currentHtml=fs.readFileSync(path.join(current,'index.html'),'utf8');
const verifyBuild=(html,label)=>{
 const js=html.match(/src="([^"]*assets\/[^"?]+\.js)"/)?.[1];
 const css=html.match(/href="([^"]*assets\/[^"?]+\.css)"/)?.[1];
 if(!js||!css)throw new Error(`${label} : ressources Vite introuvables.`);
 const origin='http://127.0.0.1';
 for(const resource of [js,css]){
  const url=new URL(resource,`${origin}${basePath}`);
  if(url.origin!==origin||!url.pathname.startsWith(`${basePath}assets/`))throw new Error(`${label} compilé pour une base différente de ${basePath} : ${resource}`);
 }
 return js;
};
const previousJs=verifyBuild(previousHtml,'Site 6.9.34');
verifyBuild(currentHtml,'Site 6.9.35');
let mode='old',brokenHits=0;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer((req,res)=>{
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
 if(!pathname.startsWith(basePath)){res.writeHead(404).end();return;}
 const relative=pathname.slice(basePath.length)||'index.html';
 if(mode==='broken'&&/^assets\/.*\.js$/.test(relative)){brokenHits++;res.writeHead(503,{'content-type':'text/plain','cache-control':'no-store'}).end('indisponible');return;}
 const root=mode==='old'?previous:current,file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}${basePath}`;
const cacheIndex=`${basePath}index.html`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext();
await ctx.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
await ctx.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const wait=async(fn,label,ms=25000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw new Error(`Délai dépassé : ${label}`)};
const reg=()=>p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return {scope:r?.scope,active:r?.active?.state,installing:r?.installing?.state,keys:await caches.keys(),controller:navigator.serviceWorker.controller?.state}});
try{
 await p.goto(base);await p.waitForSelector('.ytm-shell');
 await wait(async()=>{const s=await reg();return s.active==='activated'&&s.controller==='activated'&&s.keys.includes('sb-v6-9-34-shell')},'worker 6.9.34 actif');
 const oldState=await reg();
 assert.equal(new URL(oldState.scope).pathname,basePath,'portée de l’ancien service worker');
 const oldHtml=await p.evaluate(async(index)=>await (await (await caches.open('sb-v6-9-34-shell')).match(index)).text(),cacheIndex);
 check(oldHtml.includes(previousJs),`véritable interface 6.9.34 et ancien service worker installés sous ${basePath}`);
 await p.evaluate(async()=>{
  localStorage.setItem('soundblend_settings',JSON.stringify({geminiApiKey:'CLE-LOCALE-ANCIENNE'}));
  localStorage.setItem('soundblend_exclusions_v1',JSON.stringify([{id:'artist:archives',kind:'artist',artist:'Archives',updatedAt:Date.now(),deleted:false}]));
  await caches.open('une-autre-application');
 });
 mode='broken';await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
 await wait(()=>brokenHits>0,'ressource de mise à jour refusée');
 await wait(async()=>!(await reg()).installing,'échec de l’installation');
 let s=await reg();
 check(s.active==='activated'&&s.keys.includes('sb-v6-9-34-shell'),'mise à jour incomplète : ancien service worker et cache conservés');
 const oldStill=await p.evaluate(async(index)=>await (await (await caches.open('sb-v6-9-34-shell')).match(index)).text(),cacheIndex);
 check(oldStill.includes(previousJs),'échec de téléchargement : ancienne interface hors ligne non remplacée');
 await ctx.setOffline(true);await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await p.locator('.ytm-rail [aria-label="Réglages du compte"]').click();
 check(await p.getByText('SoundBlend AI · v6.9.34').isVisible(),'après échec de mise à jour, ancienne interface réellement rechargeable hors ligne');
 await ctx.setOffline(false);
 mode='new';await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
 await wait(async()=>{const x=await reg();return x.active==='activated'&&x.controller==='activated'&&x.keys.includes('sb-v6-9-35-shell')&&!x.keys.includes('sb-v6-9-34-shell')},'activation de la 6.9.35');
 s=await reg();assert.equal(new URL(s.scope).pathname,basePath,'portée du nouveau service worker');
 check(s.keys.includes('une-autre-application'),'nouveau cache activé, ancien cache supprimé et autre application préservée');
 const fresh=await p.evaluate(async(index)=>{const c=await caches.open('sb-v6-9-35-shell');return {html:await(await c.match(index)).text(),keys:(await c.keys()).map(x=>new URL(x.url).pathname)}},cacheIndex);
 check(!fresh.html.includes(previousJs)&&fresh.keys.some(x=>x.endsWith('.js'))&&fresh.keys.some(x=>x.endsWith('.css')),'nouvelle page et ressources compilées cohérentes mises en cache');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await p.locator('.ytm-rail [aria-label="Réglages du compte"]').click();
 check(await p.getByText('SoundBlend AI · v6.9.35').isVisible(),'après rechargement, interface 6.9.35 réellement exécutée');
 check(await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_settings')).geminiApiKey)==='CLE-LOCALE-ANCIENNE','anciennes données locales conservées après mise à jour');
 await ctx.setOffline(true);await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell');await p.locator('.ytm-rail [aria-label="Réglages du compte"]').click();
 await p.getByRole('button',{name:'Afficher la liste des exclusions'}).click();await p.getByRole('tab',{name:/Artistes/}).click();
 check(await p.getByRole('button',{name:'Débloquer Archives'}).isVisible(),'nouvelle interface et anciennes exclusions accessibles hors ligne');
 check(errors.length===0,`aucune exception JavaScript (${errors.join('; ')})`);
 console.log(`\n${n}/${n} contrôles de mise à jour PWA réussis sous ${basePath} — ancienne version compilée, réseau de test.`);
}finally{await ctx.close();await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
