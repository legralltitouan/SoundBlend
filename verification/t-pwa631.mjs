/* Vérifie le vrai service worker du site compilé, réseau puis hors ligne. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}), args:['--no-sandbox'] });
const context = await browser.newContext();
await context.route('https://accounts.google.com/**', r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
await context.route('https://www.youtube.com/**', r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
const p=await context.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
let checks=0; const check=(b,n)=>{assert.ok(b,n);checks++;console.log('  ✓ '+n)};
try {
 await p.goto(new URL('manifest.webmanifest', base).href);
 await p.evaluate(async()=>{await caches.open('une-autre-application');await caches.open('sb-v6-9-31-shell');});
 await p.goto(base); await p.evaluate(()=>localStorage.setItem('soundblend_onboarded','1'));
 await p.waitForFunction(async()=>{const r=await navigator.serviceWorker.ready;return r.active?.scriptURL.includes('sw.js')&&!!navigator.serviceWorker.controller},{timeout:15000});
 const before=await p.evaluate(async()=>{
   const keys=await caches.keys();const shell=await caches.open('sb-v6-9-32-shell');const req=await shell.keys();
   const manifest=await (await fetch('manifest.webmanifest')).json();
   return {keys,requests:req.map(r=>new URL(r.url).pathname),manifest};
 });
 check(before.keys.includes('sb-v6-9-32-shell'),'service worker de la nouvelle version activé');
 check(before.keys.includes('une-autre-application')&&!before.keys.includes('sb-v6-9-31-shell'),'ancien cache SoundBlend nettoyé sans effacer celui des autres applications');
 check(before.requests.some(x=>x.endsWith('/index.html'))&&before.requests.some(x=>x.endsWith('.js'))&&before.requests.some(x=>x.endsWith('.css')),'page et ressources compilées préchargées');
 check(!!before.manifest.name&&before.manifest.icons.some(x=>x.sizes==='192x192')&&before.manifest.icons.some(x=>x.sizes==='512x512'),'manifeste et icônes d’installation présents');
 await context.setOffline(true); await p.reload({waitUntil:'domcontentloaded'});
 await p.waitForSelector('.ytm-shell',{timeout:10000});
 check(await p.locator('.ytm-shell').isVisible(),'interface compilée réellement rechargée hors ligne');
 check(await p.evaluate(()=>!!navigator.serviceWorker.controller),'le service worker sert l’interface hors ligne');
 check(!errors.length,'aucune exception JavaScript pendant le chargement hors ligne');
 console.log(`\n${checks}/${checks} contrôles PWA réussis`);
} finally {await browser.close();}
