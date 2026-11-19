/* V2 — composeur fixe, sobriété, confidentialité, responsive. APIs simulées. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({args:['--no-sandbox']});
const base=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const shots=new URL('./assistant-refinement/',import.meta.url).pathname;await mkdir(shots,{recursive:true});
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('✓ '+label)};
const contexts=[];
async function setup(w=390,h=844,mode='light',motion='reduce'){
 const c=await browser.newContext({viewport:{width:w,height:h},reducedMotion:motion,serviceWorkers:'block'});contexts.push(c);
 await c.addInitScript(mode=>{localStorage.setItem('soundblend_onboarded','1');localStorage.setItem('soundblend_mode',mode)},mode);
 const calls=[];await c.route(/^https:\/\//,r=>{calls.push(r.request().url());return r.abort()});
 const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.locator(`${w<820?'.ytm-mobile-bar':'.ytm-rail'} [aria-label="Assistant"]`).click();await p.waitForSelector('.sa-welcome');
 await p.evaluate(async()=>{const {geminiService}=await import('/src/services/gemini.ts');window.__calls=[];geminiService.converse=async(messages,pls,blends,exclusions,options)=>{
   window.__calls.push({messages,options});if(window.__delay)await new Promise(resolve=>window.__release=resolve);
   return {reply:window.__long?'Une ambiance douce et nocturne. '.repeat(90):'Une base soul, du jazz feutré et quelques découvertes.',title:'Jazz, à ta façon',action:'blend',source:{type:'playlist',id:'demo-pl-french-touch'},extraSources:[],instruction:'Du jazz doux et des découvertes.',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],followUps:['Plus jazzy','Moins de voix','Plus de découvertes'],playlistEdits:null};
 }});
 return {c,p,errors,calls};
}
const rect=p=>p.locator('.sa-compose').boundingBox();
const send=async(p,t)=>{await p.locator('#sb-assistant-input').fill(t);await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();await p.locator('.sb-chat-thinking').waitFor({state:'detached'});};
try{
 const {p,errors,calls}=await setup();
 check(await p.getByRole('button',{name:'Mes blends',exact:true}).count()===0,'historique retiré du header');
 check(await p.locator('input[type="checkbox"]').count()===0,'aucune case de recherche sur la page');
 check(await p.locator('.sa-options,.sa-compose-caption,.sa-context').count()===0,'options et textes sous le composeur supprimés');
 check(await p.locator('.ytm-mobile-bar [aria-label="Blends"]').isVisible(),'historique toujours accessible dans la navbar inchangée');
 check(await p.locator('.sa-floating-compose').evaluate(e=>getComputedStyle(e).position==='fixed'),'composeur réellement fixe, pas sticky');
 const initial=await rect(p);check(Math.abs(initial.y+initial.height-(844-62-10))<2,'composeur aligné juste au-dessus de la navbar');
 check(await p.locator('.sa-floating-compose').evaluate(e=>getComputedStyle(e).backgroundImage==='none'&&getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'),'aucun rectangle ni dégradé de fond autour du composeur');
 check(await p.locator('.sb-assistant-studio').evaluate(e=>getComputedStyle(e,'::before').content==='none'),'suppression de la deuxième ambiance locale délimitée');
 await p.screenshot({path:shots+'accueil-mobile.png'});
 await p.getByRole('button',{name:'Du jazz, mais à ma façon'}).click();
 check((await p.locator('#sb-assistant-input').inputValue()).includes('jazz'),'suggestion préremplit le champ');
 await p.getByRole('button',{name:'Confidentialité de l’assistant'}).click();await p.getByRole('dialog').waitFor();
 check(await p.getByRole('heading',{name:'Ta musique, tes choix.'}).isVisible(),'petite modal de confidentialité ouverte depuis le header');
 check(await p.getByRole('dialog').evaluate(e=>e.contains(document.activeElement)),'focus à l’intérieur de la modal');
 check(await p.evaluate(()=>document.body.style.overflow==='hidden'),'défilement arrière-plan verrouillé');
 await p.screenshot({path:shots+'confidentialite-mobile.png'});await p.keyboard.press('Escape');
 check(await p.getByRole('dialog').count()===0,'Échap ferme la confidentialité');
 check(await p.getByRole('button',{name:'Confidentialité de l’assistant'}).evaluate(e=>document.activeElement===e),'focus rendu au bouton confidentialité');
 check((await p.locator('#sb-assistant-input').inputValue()).includes('jazz'),'brouillon conservé après la modal');
 await p.getByRole('button',{name:'Confidentialité de l’assistant'}).click();await p.getByRole('button',{name:'Compris'}).click();check(await p.getByRole('dialog').count()===0,'fermeture par Compris');
 await p.getByRole('button',{name:'Confidentialité de l’assistant'}).click();await p.mouse.click(3,3);check(await p.getByRole('dialog').count()===0,'fermeture par clic sur le fond');
 await send(p,'Un blend jazz');await p.getByRole('region',{name:'Proposition de blend',exact:true}).waitFor();
 await p.waitForTimeout(450);
 check(await p.getByRole('button',{name:'Générer et ajouter à mes blends'}).evaluate(e=>{const r=e.getBoundingClientRect(),d=document.querySelector('.sa-compose').getBoundingClientRect();return r.top>=58&&r.bottom<d.top}), 'confirmation visible après le défilement automatique de la réponse');
 const after=await rect(p);check(Math.abs(initial.y-after.y)<2,'composeur à la même position après réponse et carte blend');
 await p.screenshot({path:shots+'conversation-mobile.png'});
 await p.evaluate(()=>window.__long=true);await send(p,'Une autre envie');await p.waitForFunction(()=>document.querySelectorAll('.sb-chat-message--assistant').length===2);
 await p.evaluate(()=>scrollTo(0,0));const top=await rect(p);await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight/2));const mid=await rect(p);await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));const end=await rect(p);
 check(Math.abs(top.y-mid.y)<2&&Math.abs(top.y-end.y)<2,'composeur fixe en haut, au milieu et en bas d’une longue conversation');
 check(await p.getByRole('button',{name:'Générer et ajouter à mes blends'}).evaluate(e=>{let r=e.getBoundingClientRect(),d=document.querySelector('.sa-compose').getBoundingClientRect();return r.bottom<d.top}),'confirmation du blend dégagée en bas de la conversation');
 await p.getByRole('button',{name:'Plus jazzy',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.sb-chat-message--assistant').length===3);
 check(await p.evaluate(()=>window.__calls.at(-1).options.proposal?.title==='Jazz, à ta façon'),'contexte des relances préservé');
 check(!calls.some(url=>/wikipedia|googleSearch/.test(url)),'pas de recherche externe déclenchée en cachette');
 await p.locator('#sb-assistant-input').fill('Une première ligne\nUne deuxième ligne\nUne troisième ligne\nUne quatrième ligne');
 const grown=await rect(p);check(grown.height>initial.height,'composeur grandit avec le texte');
 check(await p.locator('.sb-assistant-studio').evaluate(e=>parseFloat(e.style.getPropertyValue('--sa-compose-height'))>100),'espace sous le contenu suit la hauteur du composeur');
 // Simule l’inset VisualViewport, pas un test de clavier iOS réel.
 await p.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:500});visualViewport.dispatchEvent(new Event('resize'));});
 check(await p.locator('.sa-floating-compose').getAttribute('data-keyboard')==='true','détection de l’inset du clavier mobile');
 check((await rect(p)).y+grown.height<=500,'composeur au-dessus du clavier simulé');
 await p.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
 await p.locator('#sb-assistant-input').fill('Brouillon Live');await p.getByRole('button',{name:'Live',exact:true}).click();check(await p.locator('.sa-floating-compose').isHidden(),'composeur masqué pendant le Live');
 await p.getByRole('button',{name:'Fermer le mode Live'}).click();check(await p.locator('.sa-floating-compose').isVisible()&&await p.locator('#sb-assistant-input').inputValue()==='Brouillon Live','retour du Live sans perte du brouillon');
 await p.locator('.ytm-mobile-bar [aria-label="Blends"]').click();check(await p.locator('.sa-floating-compose').count()===0,'portail nettoyé en quittant l’Assistant');
 check(errors.length===0,`aucune erreur JS : ${errors.join(', ')}`);
 for(const [w,h,mode]of[[320,568,'light'],[390,844,'dark'],[768,1024,'light'],[1440,1000,'light'],[1440,1000,'dark']]){
  const {p:q,errors:es}=await setup(w,h,mode);await send(q,'Un blend jazz');
  check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`pas de débordement ${w} ${mode}`);
  const r=await rect(q),bottom=w<820?h-72:h-16;
  check(Math.abs(r.y+r.height-bottom)<2,`composeur fixé en bas ${w} ${mode}`);
  await q.evaluate(()=>{document.querySelector('.sa-floating-compose').classList.add('has-player')});const player=await rect(q);
  check(Math.abs((r.y-player.y)-78)<2,`composeur au-dessus du lecteur ${w} ${mode}`);
  await q.evaluate(()=>{document.querySelector('.sa-floating-compose').classList.remove('has-player')});
  await q.screenshot({path:shots+`conversation-${w}-${mode}.png`});
  await q.getByRole('button',{name:'Confidentialité de l’assistant'}).click();check(await q.getByRole('dialog').isVisible()&&await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`modal responsive ${w} ${mode}`);
  await q.keyboard.press('Escape');check(es.length===0,`pas d’erreur JS ${w} ${mode}`);
 }
 const {p:a}=await setup(390,844,'light','no-preference');
 check(await a.locator('.sa-inspiration').evaluate(e=>getComputedStyle(e).animationName==='sa-arrive'),'animation d’entrée légère sur les suggestions');
 await a.emulateMedia({reducedMotion:'reduce'});check(await a.locator('.sa-inspiration').evaluate(e=>getComputedStyle(e).animationName==='none'),'réduction des animations respectée');
 console.log(`\n${checks} contrôles V2 réussis (services simulés).`);
}finally{for(const c of contexts)await c.close();await browser.close()}
