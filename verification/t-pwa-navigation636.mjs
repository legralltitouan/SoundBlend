/* Un déploiement incomplet ne doit pas remplacer la page hors ligne de la PWA active. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
// Serveur de test isolé : respecter le chemin demandé au lieu de relancer
// silencieusement le site racine quand SOUNDBLEND_URL vise un sous-dossier.
const basePath=process.env.SOUNDBLEND_BASE_PATH||(process.env.SOUNDBLEND_URL?new URL(process.env.SOUNDBLEND_URL).pathname:'/');
if(!basePath.startsWith('/')||!basePath.endsWith('/')||/[?#\\]/.test(basePath)||basePath.split('/').some(s=>s==='.'||s==='..'))throw new Error(`Base de test invalide : ${basePath}`);
const root=path.resolve(process.env.SOUNDBLEND_CURRENT_SITE_DIR||'dist');
const good=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=good.match(/src="([^"]*assets\/[^"?]+\.js)"/)?.[1];
const css=good.match(/href="([^"]*assets\/[^"?]+\.css)"/)?.[1];
if(!js||!css)throw new Error('Ressources Vite introuvables dans le site compilé.');
const origin='http://127.0.0.1';
for(const resource of [js,css]){
 const url=new URL(resource,`${origin}${basePath}`);
 if(url.origin!==origin||!url.pathname.startsWith(`${basePath}assets/`))throw new Error(`Site compilé pour une base différente de ${basePath} : ${resource}`);
}
const bad=good.replace(/assets\/index-[^"?]+\.js/,'assets/index-indisponible.js');
if(good===bad)throw new Error('Script Vite non reconnu dans le site compilé.');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
let broken=false;
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(!pathname.startsWith(basePath)){res.writeHead(404).end();return;}
 const name=pathname.slice(basePath.length)||'index.html';
 if(name==='index.html'&&broken){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','vary':'Origin'}).end(bad);return;}
 const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store','vary':'Origin'});fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}${basePath}`;
const cacheIndex=`${basePath}index.html`;
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext();await ctx.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
await ctx.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
const p=await ctx.newPage();let n=0;const check=(v,label)=>{assert.ok(v,label);n++;console.log(`  ✓ ${label}`)};
const wait=async(fn,label)=>{const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,60));}throw new Error(`Délai dépassé : ${label}`)};
try{
 await p.goto(base);await p.waitForSelector('.ytm-shell');
 await wait(()=>p.evaluate(async()=>!!navigator.serviceWorker.controller&&(await caches.keys()).includes('sb-v6-9-36-shell')),'service worker actif');
 const scope=await p.evaluate(async()=>(await navigator.serviceWorker.getRegistration())?.scope);
 assert.equal(new URL(scope).pathname,basePath,'portée du service worker');
 const cached=()=>p.evaluate(async(index)=>await(await(await caches.open('sb-v6-9-36-shell')).match(index,{ignoreVary:true})).text(),cacheIndex);
 check((await cached())===good,`interface initiale complète sous ${basePath}, mise en cache malgré Vary: Origin`);
 broken=true;await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForTimeout(300);
 check((await cached())===good,'page réseau référençant un script manquant : ancienne page hors ligne préservée');
 await ctx.setOffline(true);await p.reload({waitUntil:'domcontentloaded'});await p.waitForSelector('.ytm-shell',{timeout:10000});
 check(await p.locator('.ytm-shell').isVisible(),'interface précédente réellement rechargée hors ligne après déploiement incomplet');
 console.log(`\n${n}/${n} contrôles de navigation PWA réussis sous ${basePath} — site compilé et réseau de test.`);
}finally{await ctx.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
