/* Les vues jamais visitées doivent être disponibles après le premier chargement hors ligne. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||'http://localhost:4173/';
const browser=await chromium.launch({args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1200,height:800}});
await context.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
await context.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(base);await page.locator('.ytm-shell').waitFor();
 await page.waitForFunction(async()=>!!navigator.serviceWorker.controller&&(await caches.keys()).includes('sb-v6-9-45-shell'));
 const cached=await page.evaluate(async()=> (await (await caches.open('sb-v6-9-45-shell')).keys()).map(x=>new URL(x.url).pathname));
 for(const name of ['AssistantView-','BlendView-','HistoryView-']) assert.ok(cached.some(x=>x.includes(name)),`module ${name} préchargé`);
 console.log('✓ modules des trois vues secondaires préchargés');
 // Faire une navigation contrôlée en ligne avant de couper le transport :
 // évite la course Playwright entre clients.claim() et la première navigation.
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('.ytm-shell').waitFor();
 await page.waitForFunction(async()=>navigator.serviceWorker.controller?.state==='activated'&&!!await(await caches.open('sb-v6-9-45-shell')).match(new URL('index.html',location.href).href));
 await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.locator('.ytm-shell').waitFor();
 for(const [nav,title] of [['Assistant','Assistant'],['Blends','Mes blends'],['Réglages du compte','Réglages']]){
  await page.locator(`.ytm-rail [aria-label="${nav}"]`).click();
  await page.getByRole('heading',{name:title,exact:true}).waitFor();console.log('✓ première ouverture hors ligne : '+title);
 }
 assert.deepEqual(errors,[]);console.log('✓ aucune exception JavaScript');
} finally {await browser.close();}
