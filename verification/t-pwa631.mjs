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
 const initialCaches = await p.evaluate(async()=>{await caches.open('une-autre-application');await caches.open('sb-v6-9-31-shell');await caches.open('sb-v6-9-32-shell');await caches.open('sb-v6-9-33-shell');await caches.open('sb-v6-9-34-shell');return caches.keys();});
 assert.ok(initialCaches.includes('une-autre-application')&&initialCaches.includes('sb-v6-9-31-shell')&&initialCaches.includes('sb-v6-9-32-shell')&&initialCaches.includes('sb-v6-9-33-shell')&&initialCaches.includes('sb-v6-9-34-shell'),'préparation des caches de test');
 await p.goto(base); await p.evaluate(()=>{localStorage.setItem('soundblend_onboarded','1');localStorage.setItem('soundblend_exclusions_v1',JSON.stringify([{id:'artist:hors ligne',kind:'artist',artist:'Hors ligne',updatedAt:Date.now(),deleted:false}]))});
 // waitForFunction ne réévalue pas correctement une fonction async renvoyant
 // une promesse fausse. Ici on attend donc explicitement, avec une échéance,
 // le contrôleur actif ET la suppression effective des caches de test.
 await p.evaluate(async()=>{
   const limit = Date.now() + 15000;
   while (Date.now() < limit) {
     const r = await navigator.serviceWorker.getRegistration();
     const c = navigator.serviceWorker.controller;
     const keys = await caches.keys();
     if (r?.active?.scriptURL.includes('sw.js') && r.active.state === 'activated' && c?.state === 'activated' && !keys.includes('sb-v6-9-31-shell') && !keys.includes('sb-v6-9-32-shell') && !keys.includes('sb-v6-9-33-shell') && !keys.includes('sb-v6-9-34-shell')) return;
     await new Promise(resolve => setTimeout(resolve, 50));
   }
   throw new Error(`Service worker ou nettoyage des anciens caches non prêt : ${(await caches.keys()).join(', ')}`);
 });
 const before=await p.evaluate(async()=>{
   const keys=await caches.keys();const shell=await caches.open('sb-v6-9-35-shell');const req=await shell.keys();
   const manifest=await (await fetch('manifest.webmanifest')).json();
   return {keys,requests:req.map(r=>new URL(r.url).pathname),manifest};
 });
 check(before.keys.includes('sb-v6-9-35-shell'),'service worker de la nouvelle version activé');
 const anciensCachesNettoyes = before.keys.includes('une-autre-application') && !before.keys.includes('sb-v6-9-31-shell') && !before.keys.includes('sb-v6-9-32-shell') && !before.keys.includes('sb-v6-9-33-shell') && !before.keys.includes('sb-v6-9-34-shell');
 if (!anciensCachesNettoyes) console.error('Caches observés :', before.keys.join(', '));
 check(anciensCachesNettoyes,'anciens caches SoundBlend nettoyés sans effacer celui des autres applications');
 check(before.requests.some(x=>x.endsWith('/index.html'))&&before.requests.some(x=>x.endsWith('.js'))&&before.requests.some(x=>x.endsWith('.css')),'page et ressources compilées préchargées');
 check(!!before.manifest.name&&before.manifest.icons.some(x=>x.sizes==='192x192')&&before.manifest.icons.some(x=>x.sizes==='512x512'),'manifeste et icônes d’installation présents');
 await context.setOffline(true); await p.reload({waitUntil:'domcontentloaded'});
 try { await p.waitForSelector('.ytm-shell',{timeout:10000}); }
 catch (e) {
   console.error('Diagnostic hors ligne :', errors, await p.evaluate(async()=>({url:location.href,body:document.body?.innerText?.slice(0,500),onboarded:localStorage.getItem('soundblend_onboarded'),keys:await caches.keys(),html:document.documentElement.outerHTML.slice(0,1800)})));
   throw e;
 }
 check(await p.locator('.ytm-shell').isVisible(),'interface compilée réellement rechargée hors ligne');
 check(await p.evaluate(()=>!!navigator.serviceWorker.controller),'le service worker sert l’interface hors ligne');
 await p.locator('.ytm-rail [aria-label="Réglages du compte"]').click();
 await p.getByRole('button',{name:'Afficher la liste des exclusions'}).click();
 await p.getByRole('tab',{name:/Artistes/}).click();
 check(await p.getByRole('button',{name:'Débloquer Hors ligne'}).isVisible(),'les exclusions locales restent consultables hors ligne');
 await p.getByRole('searchbox',{name:'Rechercher dans les exclusions et le catalogue'}).fill('Artiste');
 await p.getByRole('alert').waitFor({timeout:15000});
 check((await p.getByRole('alert').innerText()).includes('indisponible'),'la recherche catalogue hors ligne signale la panne sans inventer de résultats');
 check(!errors.length,'aucune exception JavaScript pendant le chargement hors ligne');
 console.log(`\n${checks}/${checks} contrôles PWA réussis`);
} finally {await browser.close();}
