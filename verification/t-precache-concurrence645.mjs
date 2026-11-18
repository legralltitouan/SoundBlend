/* Installe le véritable SW dans un serveur isolé et mesure ses téléchargements. */
import {chromium} from 'playwright';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(process.env.SOUNDBLEND_CURRENT_SITE_DIR||'dist');const basePath='/SoundBlend/';
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');if(!html.includes('src="/SoundBlend/assets/'))throw new Error('Compiler avec BASE_PATH=/SoundBlend/.');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'precache-assets.json'),'utf8'));let active=0,peak=0,requests=0;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(basePath.length)||'index.html';
 if(name==='test-register.html'){res.writeHead(200,{'content-type':'text/html'}).end('<!doctype html><title>test</title>');return;}
 const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 const send=()=>{res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(file).pipe(res)};
 if(name.startsWith('assets/')){active++;requests++;peak=Math.max(peak,active);setTimeout(()=>{active--;send()},100);}else send();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--no-sandbox']});const p=await browser.newPage();
try{
 await p.goto(origin+basePath+'test-register.html');
 await p.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready});
 assert.equal(requests,manifest.assets.length);assert.ok(peak>=2&&peak<=4,`concurrence ${peak}`);
 const keys=await p.evaluate(async()=>(await (await caches.open('sb-v6-9-45-shell')).keys()).map(r=>new URL(r.url).pathname));
 assert.ok(manifest.assets.every(a=>keys.includes(basePath+a)));
 console.log(`✓ ${requests} ressources préchargées, concurrence observée ${peak}/4, toutes présentes`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
