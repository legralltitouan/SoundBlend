/* Animation : SVG, rotation d’écran et changement de préférence de mouvement. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));let n=0;
const check=(v,s)=>{assert.ok(v,s);console.log('  ✓ '+s);n++};
const url=(q)=>new URL(`verification/orb-test.html?${q}`,base).href;
const head=()=>p.locator('.sb-organic').getAttribute('data-tete');
try {
 await p.goto(url('mode=light&movement=chargement'));await p.waitForSelector('.sb-organic[data-tete]');
 const initial=await head();await p.waitForTimeout(1100);const later=await head();
 check(initial!==later,'la sphère de chargement se déplace');
 const shape=await p.evaluate(()=>{
  const svg=document.querySelector('.sb-organic-svg');
  return {mode:document.querySelector('.sb-organic').dataset.movement,viewBox:svg.getAttribute('viewBox'),
   nodes:[...svg.querySelectorAll('ellipse')].map(e=>['cx','cy','rx','ry'].map(a=>Number(e.getAttribute(a)))),
   fills:[...svg.querySelectorAll('ellipse')].map(e=>e.getAttribute('fill')),
   turbulence:svg.querySelector('feTurbulence')?.getAttribute('baseFrequency'),octaves:svg.querySelector('feTurbulence')?.getAttribute('numOctaves'),
   mask:svg.querySelector('feComposite')?.getAttribute('operator'),blend:svg.querySelector('feBlend')?.getAttribute('mode')};
 });
 check(shape.mode==='chargement'&&shape.viewBox==='0 0 390 844','mode chargement et canevas mobile');
 check(shape.nodes.length===6&&shape.nodes.every(row=>row.every(Number.isFinite)&&row[2]>0&&row[3]>0),'six couches avec géométrie numérique valide');
 check(shape.fills.join(',')==='#ffcaa0,#ffb27e,#ff7866,#fa4884,#f72598,#f0148c','palette claire de la référence');
 check(shape.turbulence==='0.72'&&shape.octaves==='3'&&shape.mask==='in'&&shape.blend==='overlay','grain fin masqué sur le pigment');
 const points=[];for(let i=0;i<6;i++){points.push((await head()).split(',').map(Number));await p.waitForTimeout(320);}
 check(points.every(([x,y])=>x>=390*.5-390*.21-1&&x<=390*.5+390*.21+1&&y>=844*.43-82*.62-1&&y<=844*.43+82*.62+1),'trajectoire de chargement en huit bornée comme la référence');
 fs.mkdirSync(new URL('./captures/',import.meta.url),{recursive:true});
 await p.screenshot({path:fileURLToPath(new URL('./captures/sphere-claire.png',import.meta.url))});
 await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(150);const frozen=await head();
 await p.waitForTimeout(900);check(await head()===frozen,'mouvements réduits : la sphère se fige, même si la préférence change en cours de route');
 await p.setViewportSize({width:844,height:390});await p.waitForTimeout(300);
 check(await p.locator('.sb-organic-svg').getAttribute('viewBox')==='0 0 844 390','rotation : canevas recalculé sans relancer l’animation');
 const frozen2=await head();await p.waitForTimeout(500);check(await head()===frozen2,'mouvements réduits conservés après rotation');
 const bounds=await p.evaluate(()=>[...document.querySelectorAll('ellipse')].map(e=>['cx','cy','rx','ry'].map(a=>Number(e.getAttribute(a)))));
 check(bounds.every(x=>x.every(Number.isFinite)&&x[2]>0&&x[3]>0),'géométrie redessinée et valide après rotation');
 await p.emulateMedia({reducedMotion:'no-preference'});await p.waitForTimeout(900);
 check(await head()!==frozen2,'la sphère repart si les mouvements sont de nouveau autorisés');
 await p.goto(url('mode=dark&movement=balade'));await p.waitForSelector('.sb-organic[data-tete]');const roam=await head();await p.waitForTimeout(800);
 check(await p.locator('.sb-organic').getAttribute('data-movement')==='balade'&&await head()!==roam,'l’autre trajectoire de la référence reste disponible');
 check(errors.length===0,'aucune exception JavaScript');
 console.log(`\n${n}/${n} contrôles de l’animation réussis`);
} finally {await browser.close()}
