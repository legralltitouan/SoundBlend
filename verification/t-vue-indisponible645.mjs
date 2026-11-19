/* En cas d'échec de téléchargement d'une vue différée, la navigation survit. */
import { chromium } from 'playwright'; import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||'http://localhost:4173/';
const b=await chromium.launch({args:['--no-sandbox']}),ctx=await b.newContext({serviceWorkers:'block',viewport:{width:1200,height:800}});
try{
 await ctx.addInitScript(()=>localStorage.setItem('soundblend_onboarded','1'));
 await ctx.route('**/*',r=>r.request().url().startsWith(new URL(base).origin+'/')?r.continue():r.abort());
 await ctx.route('**/assets/AssistantView-*.js',r=>r.abort());
 const p=await ctx.newPage();await p.goto(base);await p.locator('.ytm-shell').waitFor();
 await p.locator('.ytm-rail [aria-label="Assistant"]').click();
 await p.getByRole('alert').filter({hasText:'Cette vue n’a pas pu être chargée'}).waitFor();
 assert.ok(await p.locator('.ytm-shell').isVisible());
 await p.locator('.ytm-rail [aria-label="Blends"]').click();await p.getByRole('heading',{name:'Mes blends'}).waitFor();
 console.log('✓ échec d’un module : message explicite, coque et navigation conservées');
}finally{await b.close()}
