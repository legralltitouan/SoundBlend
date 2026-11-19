/* Régression ciblée : cache petit/grand, courses réseau et diagnostics
   émis à la suite dans le même tour JavaScript. Toutes les API sont simulées. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const dev = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox']});
let count=0;
const check=(ok,label)=>{assert.ok(ok,label);count++;console.log('  ✓ '+label);};
const coverTrack=(who, videoId)=>({artist:who, title:`${who}Song`, videoId});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#8b6799"/></svg>';
const cors={'access-control-allow-origin':'*'};
try {
  const ctx=await browser.newContext({viewport:{width:800,height:600},serviceWorkers:'block'});
  const requests=[];let oldRequestedResolve;
  const oldRequested=new Promise(r=>{oldRequestedResolve=r;});
  await ctx.route('https://itunes.apple.com/**',async route=>{
    const term=new URL(route.request().url()).searchParams.get('term')||'';
    requests.push(term);
    const who=term.split(' ')[0];
    if(who==='RaceOld') {oldRequestedResolve();await new Promise(r=>setTimeout(r,900));}
    const results=who==='NoAlbum'?[]:[{artistName:who,trackName:`${who}Song`,artworkUrl100:`https://is1-ssl.mzstatic.com/${who}/100x100bb.jpg`}];
    await route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({results})});
  });
  await ctx.route('https://is1-ssl.mzstatic.com/**',r=>r.fulfill({status:200,headers:cors,contentType:'image/svg+xml',body:svg}));
  await ctx.route('https://i.ytimg.com/**',r=>r.request().url().includes('/maxresdefault.jpg')
    ?r.fulfill({status:404,headers:cors,body:'missing'})
    :r.fulfill({status:200,headers:cors,contentType:'image/svg+xml',body:svg}));
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('verification/cover-test.html',dev).href);
  const render=configs=>p.evaluate(c=>window.testCovers(c),configs);
  const probe=name=>p.locator(`[data-probe="${name}"]`);
  const waitUrl=(name,text)=>p.waitForFunction(([n,s])=>document.querySelector(`[data-probe="${n}"] output`)?.dataset.url?.includes(s),[name,text],{timeout:8000});
  const data=name=>probe(name).locator('output').evaluate(e=>({...e.dataset}));
  const first=coverTrack('FirstAlbum','first000001');
  await render([{name:'big',track:first,large:true}]);
  await waitUrl('big','/FirstAlbum/2000x2000bb.jpg');
  let d=await data('big');
  check(d.url===d.large&&d.small.includes('/600x600bb.jpg')&&d.large.includes('/2000x2000bb.jpg'),'résolution album : la grande demande reçoit la grande image et conserve la petite');
  await render([{name:'big',track:first,large:true},{name:'small',track:first,large:false}]);
  await waitUrl('small','/FirstAlbum/600x600bb.jpg');
  check((await data('big')).url.endsWith('/2000x2000bb.jpg')&&(await data('small')).url.endsWith('/600x600bb.jpg'),'après une grande demande, le cache rend la petite aux autres appelants');
  check(requests.filter(x=>x.startsWith('FirstAlbum ')).length===1,'demandes simultanées pour un album regroupées');
  check((await probe('big').locator('img').getAttribute('src')).endsWith('/2000x2000bb.jpg')&&(await probe('small').locator('img').getAttribute('src')).endsWith('/600x600bb.jpg'),'les deux composants Art affichent leur taille respective');
  await render([{name:'big',track:first,large:false},{name:'small',track:first,large:false}]);
  await waitUrl('big','/FirstAlbum/600x600bb.jpg');
  check((await data('big')).url.endsWith('/600x600bb.jpg'),'changer la taille choisie ne modifie pas le cache partagé');
  const second=coverTrack('SecondAlbum','second00001');
  await render([{name:'secondSmall',track:second,large:false}]);
  await waitUrl('secondSmall','/SecondAlbum/600x600bb.jpg');
  await render([{name:'secondSmall',track:second,large:false},{name:'secondBig',track:second,large:true}]);
  await waitUrl('secondBig','/SecondAlbum/2000x2000bb.jpg');
  check((await data('secondSmall')).url.endsWith('/600x600bb.jpg')&&(await data('secondBig')).url.endsWith('/2000x2000bb.jpg'),'après une petite demande, le cache rend aussi la grande');
  const noAlbum=coverTrack('NoAlbum','fallback001');
  await render([{name:'fallback',track:noAlbum,large:true}]);
  await p.waitForFunction(()=>document.querySelector('[data-probe="fallback"] img')?.getAttribute('src')?.includes('hqdefault.jpg'),null,{timeout:8000});
  check((await probe('fallback').locator('img').getAttribute('src')).endsWith('/hqdefault.jpg'),'vignette grand format absente : retour à la petite au lieu des initiales');
  const old=coverTrack('RaceOld','raceold0001'),next=coverTrack('RaceNew','racenew0001');
  await render([{name:'race',track:old,large:true}]);await oldRequested;
  await render([{name:'race',track:next,large:true}]);
  await waitUrl('race','racenew0001');
  check(!(await data('race')).url.includes('RaceOld'),'au changement de morceau, la réponse immédiate n’emprunte pas l’ancienne pochette');
  await waitUrl('race','/RaceNew/2000x2000bb.jpg');await p.waitForTimeout(400);
  check((await data('race')).url.endsWith('/RaceNew/2000x2000bb.jpg'),'une ancienne réponse tardive ne remplace pas la nouvelle pochette');
  check(errors.length===0,'pochettes : aucune exception JavaScript');
  await ctx.close();

  const diagContext=await browser.newContext({viewport:{width:240,height:400},serviceWorkers:'block'});
  await diagContext.route('https://**',r=>r.abort());
  const q=await diagContext.newPage(),diagErrors=[];q.on('pageerror',e=>diagErrors.push(e.message));
  await q.goto(new URL('verification/diagnostic-test.html',dev).href,{waitUntil:'domcontentloaded'});
  await q.waitForFunction(()=>typeof window.testGenerate==='function');
  await q.evaluate(()=>{window.testGenerate().catch(e=>{window.__generationError=String(e)});});
  await q.waitForSelector('.sb-gen-history summary');
  check((await q.locator('[role="status"]').innerText())==='Vérification des morceaux sur YouTube…','le statut courant reflète la dernière étape réelle');
  const summary=q.locator('.sb-gen-history summary');await summary.focus();await q.keyboard.press('Enter');
  check(await q.locator('.sb-gen-history').evaluate(e=>e.open),'le détail des étapes précédentes s’ouvre au clavier');
  check((await q.locator('.sb-gen-history li').allTextContents()).some(x=>x.includes('Clé Gemini refusée (403)')),'le diagnostic transitoire émis juste avant le statut courant reste consultable');
  const b=await q.locator('.sb-gen-caption').boundingBox();
  check(b.y>=0&&b.y+b.height<=400,'statut et historique ouvert tiennent sur un petit écran');
  await q.evaluate(()=>{for(let i=0;i<70;i++) window.testPush(`Étape réelle numéro ${i} : une précision sur la recherche.`);});
  await q.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent?.includes('numéro 69'));
  const rows=await q.locator('.sb-gen-history li').allTextContents();
  check(rows.length===49&&rows.at(-1).includes('numéro 68'),'historique borné aux 50 derniers messages, sans dupliquer le statut courant');
  const list=q.locator('.sb-gen-history ol');await list.focus();await q.keyboard.press('End');await q.waitForTimeout(120);
  check(await list.evaluate(e=>e.tabIndex===0&&e.scrollHeight>e.clientHeight&&e.scrollTop>0),'historique long défilable au clavier');
  await q.evaluate(()=>window.finishGenerate());await q.waitForSelector('.sb-gen',{state:'detached'});
  await q.evaluate(()=>{window.testGenerate().catch(e=>{window.__generationError=String(e)});});
  await q.waitForSelector('.sb-gen-history summary');await q.locator('.sb-gen-history summary').click();
  check((await q.locator('.sb-gen-history li').allTextContents()).every(x=>!x.includes('numéro')),'les messages de l’ancienne génération sont effacés au nouveau départ');
  await q.evaluate(()=>window.finishGenerate());await q.waitForSelector('.sb-gen',{state:'detached'});
  check(diagErrors.length===0&&!await q.evaluate(()=>window.__generationError),'diagnostics : aucune exception JavaScript');
  await diagContext.close();
  console.log(`\n${count}/${count} contrôles pochettes et diagnostics réussis`);
} finally {await browser.close();}
