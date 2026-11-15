/* Vérifications visuelles et comportementales de 6.9.32. Les pochettes,
   YouTube et l'API vidéo sont simulés ; aucune affirmation sur leurs pixels
   ni sur un compte YouTube réel. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dev=process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const site=process.env.SOUNDBLEND_URL||'http://localhost:4173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
let count=0;const check=(v,m)=>{assert.ok(v,m);console.log('  ✓ '+m);count++;};
const caps=new URL('./captures/',import.meta.url);fs.mkdirSync(caps,{recursive:true});
try {
  /* Accélération du seul cycle décoratif, pas de l'animation de la sphère. */
  const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await c.addInitScript(()=>{const original=window.setInterval;window.setInterval=(f,ms,...args)=>original(f,ms===3000?220:ms,...args);});
  const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(new URL('verification/composition-test.html?mode=light',dev).href);
  await p.waitForSelector('.sb-gen-flip-word');
  check((await p.locator('.sb-gen-caption-title').textContent())==='Génération en cours','titre de génération en français');
  const first=(await p.locator('.sb-gen-flip-word').allTextContents()).at(-1);
  await p.waitForFunction(f=>[...document.querySelectorAll('.sb-gen-flip-word')].some(e=>e.textContent!==f),first,{timeout:6000});
  check(true,'les phrases changent même si le statut du moteur reste identique');
  check(await p.locator('.sb-gen-diagnostic').innerText().then(x=>x.includes('Analyse de l’empreinte')),'étape réelle conservée sous les phrases');
  const diagnostic='Clé Gemini refusée (403) — on réessaie par voisinage sur YouTube.';
  await p.evaluate(s=>window.testDiagnostic(s),diagnostic);
  check((await p.locator('[role="status"]').innerText())===diagnostic,'diagnostic réel visible et annoncé sans être remplacé par une phrase décorative');
  check(await p.locator('.sb-gen-flip-line').getAttribute('aria-hidden')==='true','le lecteur d’écran ne répète pas les phrases décoratives');
  await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(500);
  const frozen=(await p.locator('.sb-gen-flip-word').allTextContents()).at(-1);
  const head=await p.locator('.sb-organic').getAttribute('data-tete');
  await p.waitForTimeout(1000);
  check((await p.locator('.sb-gen-flip-word').allTextContents()).at(-1)===frozen,'changement de préférence à chaud : texte figé');
  check(await p.locator('.sb-organic').getAttribute('data-tete')===head,'changement de préférence à chaud : sphère figée');
  await p.emulateMedia({reducedMotion:'no-preference'});
  await p.waitForFunction(f=>[...document.querySelectorAll('.sb-gen-flip-word')].some(e=>e.textContent!==f),frozen,{timeout:6000});
  check(true,'le texte repart quand les animations sont autorisées');
  await p.setViewportSize({width:320,height:568});await p.waitForTimeout(400);
  let layout=await p.evaluate(()=>{const caption=document.querySelector('.sb-gen-caption').getBoundingClientRect(),line=document.querySelector('.sb-gen-flip').getBoundingClientRect(),word=document.querySelector('.sb-gen-flip-word:last-child').getBoundingClientRect();return {caption:{top:caption.top,bottom:caption.bottom,left:caption.left,right:caption.right},line:{left:line.left,right:line.right},word:{left:word.left,right:word.right},w:innerWidth,h:innerHeight}});
  check(layout.caption.top>=0&&layout.caption.bottom<=layout.h&&layout.line.left>=0&&layout.line.right<=layout.w&&layout.word.left>=0&&layout.word.right<=layout.w,'légende et phrase restent dans un petit écran');
  await p.setViewportSize({width:240,height:400});
  const longDiagnostic='Diagnostic détaillé : '+('une information utile sur la génération et son réseau. ').repeat(20);
  await p.evaluate(s=>window.testDiagnostic(s),longDiagnostic);await p.waitForTimeout(150);
  const diag=await p.locator('.sb-gen-diagnostic').evaluate(e=>({text:e.textContent,client:e.clientHeight,scroll:e.scrollHeight,top:e.getBoundingClientRect().top,tab:e.tabIndex,events:getComputedStyle(e).pointerEvents}));
  check(diag.text===longDiagnostic&&diag.scroll>diag.client&&diag.top>=0&&diag.tab===0&&diag.events==='auto','diagnostic long accessible et défilable sur écran étroit, sans sortir du cadre');
  await p.evaluate(()=>window.testDiagnostic('Vérification des titres sur YouTube…'));
  await p.setViewportSize({width:844,height:390});await p.waitForTimeout(350);
  check(await p.locator('.sb-organic-svg').getAttribute('viewBox')==='0 0 844 390','composition adaptée après rotation');
  await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);
  const bendSamples=[];for(let i=0;i<12;i++){bendSamples.push(Number(await p.locator('path[data-layer="4"]').getAttribute('data-bend')));await p.waitForTimeout(180);}
  check(bendSamples.every(x=>Number.isFinite(x)&&Math.abs(x)<=.421)&&Math.max(...bendSamples)-Math.min(...bendSamples)>.08,'la traînée se courbe et reste bornée pendant les virages');
  const smooth=await p.locator('path[data-layer]').evaluateAll(paths=>paths.every(path=>{
    const n=(path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);if(n.length!==26||!n.every(Number.isFinite))return false;
    const pt=i=>({x:n[i*2],y:n[i*2+1]});const start=pt(0);
    const segments=Array.from({length:4},(_,i)=>({a:i?pt(3*i):start,b:pt(3*i+1),c:pt(3*i+2),d:pt(3*i+3)}));
    return segments.every((s,i)=>{const next=segments[(i+1)%4],u={x:s.d.x-s.c.x,y:s.d.y-s.c.y},v={x:next.b.x-next.a.x,y:next.b.y-next.a.y};const norm=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);return norm>0&&(u.x*v.x+u.y*v.y)>0&&Math.abs(u.x*v.y-u.y*v.x)/norm<.005;});
  }));
  check(smooth,'les quatre raccords des courbes sont continus, sans coin');
  check(errors.length===0,'composition : aucune exception JavaScript');
  await c.close();

  /* Pochettes unies déterministes : rouge pour le titre, bleu pour le
     suivant, vert pour le précédent. Le canvas lit ces images en CORS. */
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const cors={'access-control-allow-origin':'*'};
  await ctx.route('https://itunes.apple.com/**',r=>r.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:'{"results":[]}'}));
  await ctx.route('https://i.ytimg.com/**',r=>{
    const url=r.request().url();const fill=url.includes('dX3k_QDnzHE')?'#e63c3c':url.includes('TCd6PfxOy0Y')?'#3c69e6':'#3cc67e';
    return r.fulfill({status:200,headers:{...cors,'content-type':'image/svg+xml'},body:`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${fill}"/></svg>`});
  });
  await ctx.route('https://www.youtube.com/iframe_api',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await ctx.route('https://www.youtube.com/oembed**',r=>r.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({title:'M83 - Midnight City (Official Video)',author_name:'M83'})}));
  await ctx.route(/pipedapi\.|api\.piped\./,r=>r.request().url().includes('/search')?r.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({items:[{url:'/watch?v=CLIP0000009',title:'M83 - Midnight City (Official Video)',uploaderName:'M83',duration:244,type:'stream'}]})}):r.abort());
  await ctx.addInitScript(()=>{
    if(!localStorage.getItem('__visuel632')){localStorage.clear();localStorage.setItem('__visuel632','1');localStorage.setItem('soundblend_onboarded','1');localStorage.setItem('soundblend_mode','dark');}
    const f={players:[]};window.__visuelFake=f;
    window.YT={Player:function(target,opts){
      const kind=typeof target==='string'?'audio':'clip';const mount=typeof target==='string'?document.getElementById(target):target;
      const frame=document.createElement('iframe');frame.className=mount.className;frame.src='about:blank';mount.replaceWith(frame);
      let state=-1,id=opts.videoId,pos=0;const self=this;
      this.getIframe=()=>frame;this.getPlayerState=()=>state;this.getCurrentTime=()=>pos;this.getDuration=()=>244;this.getVideoData=()=>({video_id:id});
      this.setVolume=()=>{};this.mute=()=>{};this.unMute=()=>{};this.seekTo=n=>{pos=n};this.loadVideoById=x=>{id=typeof x==='string'?x:x.videoId};
      this.playVideo=()=>{state=1;setTimeout(()=>opts.events?.onStateChange?.({target:self,data:1}),0)};
      this.pauseVideo=()=>{state=2;setTimeout(()=>opts.events?.onStateChange?.({target:self,data:2}),0)};
      this.destroy=()=>frame.remove();f.players.push({kind,opts,player:this});
      setTimeout(()=>opts.events?.onReady?.({target:self}),40);
    }};
  });
  const q=await ctx.newPage();const playerErrors=[];q.on('pageerror',e=>playerErrors.push(e.message));
  await q.goto(site);await q.locator('.sb-play-badge').first().waitFor();await q.locator('.sb-play-badge').first().click({force:true});
  await q.locator('.nowbar-track').click({force:true});await q.locator('.sb-artmode').waitFor();
  await q.waitForFunction(()=>document.querySelector('.sb-artmode')?.style.getPropertyValue('--art-tint').includes('hsl(0 '),null,{timeout:10000});
  await q.waitForTimeout(600);
  const colors=()=>q.evaluate(()=>{
    const el=document.querySelector('.sb-artmode'),a=el.querySelector('[data-on="1"]'),b=el.querySelector('[data-on="0"]');
    const rgb=(str)=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=str;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)};
    const contrast=(aa,bb)=>{const lum=v=>{const z=v.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return .2126*z[0]+.7152*z[1]+.0722*z[2]};const a=lum(aa),b=lum(bb);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    const rail=rgb(getComputedStyle(el).backgroundColor),pill=rgb(getComputedStyle(el,'::before').backgroundColor);
    return {tint:el.style.getPropertyValue('--art-tint'),rail,pill,active:contrast(rgb(getComputedStyle(a).color),pill),inactive:contrast(rgb(getComputedStyle(b).color),rail),theme:document.documentElement.dataset.mode};
  });
  const sweep=()=>q.evaluate(()=>{
    const el=document.querySelector('.sb-artmode'),sheet=el.closest('.nowplaying'),original=el.style.getPropertyValue('--art-tint'),oldDrag=sheet.dataset.drag;
    sheet.dataset.drag='1';
    const rgb=str=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=str;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3)};
    const lum=v=>{const z=v.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return .2126*z[0]+.7152*z[1]+.0722*z[2]};
    const contrast=(a,b)=>{a=lum(a);b=lum(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    const a=el.querySelector('[data-on="1"]'),b=el.querySelector('[data-on="0"]');let worst=100;
    for(let h=0;h<360;h+=30)for(const s of [38,78])for(const l of [34,60]){
      el.style.setProperty('--art-tint',`hsl(${h} ${s}% ${l}%)`);
      const rail=rgb(getComputedStyle(el).backgroundColor),pill=rgb(getComputedStyle(el,'::before').backgroundColor);
      worst=Math.min(worst,contrast(rgb(getComputedStyle(a).color),pill),contrast(rgb(getComputedStyle(b).color),rail));
    }
    el.style.setProperty('--art-tint',original);sheet.dataset.drag=oldDrag;return worst;
  });
  let dark=await colors();console.log('  palette sombre',JSON.stringify(dark));
  check(dark.theme==='dark'&&dark.rail[0]>dark.rail[1]&&dark.pill[0]>dark.pill[1],'le galet et la pastille héritent de la pochette rouge en sombre');
  check(dark.active>=4.5&&dark.inactive>=4.5&&(await sweep())>=4.5,'contraste lisible en sombre sur un éventail de 48 palettes');
  await q.screenshot({path:fileURLToPath(new URL('./captures/selecteur-sombre-632.png',import.meta.url))});
  await q.evaluate(()=>{localStorage.setItem('soundblend_mode','light');window.dispatchEvent(new CustomEvent('sb:sync-applied'))});await q.waitForTimeout(500);
  let light=await colors();console.log('  palette claire',JSON.stringify(light));
  const chroma=a=>Math.max(...a)-Math.min(...a);
  check(light.theme==='light'&&chroma(light.rail)<chroma(dark.rail)&&chroma(light.pill)<chroma(dark.pill),'en clair, la même teinte est plus subtile');
  check(light.active>=4.5&&light.inactive>=4.5&&(await sweep())>=4.5,'contraste lisible en clair sur un éventail de 48 palettes');
  await q.screenshot({path:fileURLToPath(new URL('./captures/selecteur-clair-632.png',import.meta.url))});
  await q.evaluate(()=>{localStorage.setItem('soundblend_mode','dark');window.dispatchEvent(new CustomEvent('sb:sync-applied'))});await q.waitForTimeout(500);
  await q.getByRole('button',{name:'Vidéo',exact:true}).click({force:true});
  await q.waitForFunction(()=>window.__visuelFake.players.some(x=>x.kind==='clip'),null,{timeout:10000});
  const clipOptions=await q.evaluate(()=>{const x=window.__visuelFake.players.find(x=>x.kind==='clip');return {vars:x.opts.playerVars, width:x.opts.width,height:x.opts.height,on:document.querySelector('.nowplaying-clip')?.dataset.on}});
  check(clipOptions.vars.controls===0&&clipOptions.vars.fs===0&&clipOptions.vars.mute===1&&clipOptions.on==='1','clip muet et commandes configurables YouTube désactivées');
  for(const [w,h] of [[320,568],[320,480],[320,400],[844,390],[560,320]]) {
    await q.setViewportSize({width:w,height:h});await q.waitForTimeout(180);
    const b=await q.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      const queue=document.querySelector('.nowplaying-queue');
      return {frame:rect('.nowplaying-clip iframe'),body:rect('.nowplaying-body'),play:rect('.nowplaying-play'),queue:getComputedStyle(queue).display==='none'?null:rect('.nowplaying-queue')};
    });
    console.log(`  clip ${w}×${h}`,JSON.stringify(b));
    check(b.frame.width>=199.5&&b.frame.height>=199.5&&b.frame.left>=0&&b.frame.right<=w&&b.frame.top>=b.body.top-1&&b.frame.bottom<=b.body.bottom+1&&b.play.width>=44&&b.play.height>=44&&b.play.top>=b.body.top-1&&b.play.bottom<=b.body.bottom+1&&(!b.queue||b.play.bottom<=b.queue.top+1),`clip 200 px et commandes visibles en ${w} × ${h}`);
    if(w===320&&h===568)await q.screenshot({path:fileURLToPath(new URL('./captures/lecteur-court-632.png',import.meta.url))});
    if(w===844&&h===390)await q.screenshot({path:fileURLToPath(new URL('./captures/lecteur-paysage-632.png',import.meta.url))});
  }
  await q.setViewportSize({width:390,height:844});await q.waitForTimeout(300);
  await q.getByRole('button',{name:'Titre',exact:true}).click({force:true});
  await q.evaluate(()=>{
    const e=document.querySelector('.nowplaying-stage');const r=e.getBoundingClientRect();const x=r.left+r.width*.6,y=r.top+r.height*.5;
    const send=(type,x)=>e.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:7,clientX:x,clientY:y}));
    send('pointerdown',x);send('pointermove',x-115);window.__releaseVisuel=()=>send('pointerup',x-115);
  });
  await q.waitForTimeout(100);
  let during=await q.evaluate(()=>({tint:document.querySelector('.sb-artmode').style.getPropertyValue('--art-tint'),layers:[...document.querySelectorAll('.nowplaying-ambience__layer')].map(x=>x.style.opacity)}));
  console.log('  pendant le geste',JSON.stringify(during));
  check(during.tint.includes('hsl(0 ')&&(/hsl\((210|240)/.test(during.tint))&&Number(during.layers[2])>0&&Number(during.layers[1])===0,'glissement gauche : le sélecteur et le fond suivent la prochaine pochette bleue');
  await q.evaluate(()=>{
    window.__couleurs=[];const t=performance.now();const sample=()=>{const e=document.querySelector('.sb-artmode');window.__couleurs.push({at:performance.now()-t,title:document.querySelector('.nowplaying-meta h2')?.textContent,tint:e?.style.getPropertyValue('--art-tint')});if(performance.now()-t<480)requestAnimationFrame(sample);};
    window.__releaseVisuel();requestAnimationFrame(sample);
  });
  await q.waitForFunction(()=>document.querySelector('.nowplaying-meta h2')?.textContent.includes('Veridis'),null,{timeout:6000});await q.waitForTimeout(500);
  const samples=await q.evaluate(()=>window.__couleurs);
  const beforeCommit=samples.filter(x=>x.title?.includes('Midnight')).map(x=>Number(x.tint?.match(/([\d.]+)%\)$/)?.[1]));
  console.log('  fin du geste',JSON.stringify({beforeCommit:beforeCommit.slice(0,12),last:samples.at(-1)}));
  check(beforeCommit.length>2&&beforeCommit.every((x,i)=>Number.isFinite(x)&&(i===0||x+1>=beforeCommit[i-1])),'la teinte ne revient pas en arrière pendant la fin du geste');
  await q.waitForTimeout(300);const next=await colors();
  check(next.rail[2]>next.rail[0]&&next.tint.match(/^color-mix\(in srgb, hsl\((210|240)/),'au changement de morceau la teinte passe au bleu sans reprendre l’ancienne pochette');
  const swipeRight=async(dx)=>q.evaluate(dx=>{
    const e=document.querySelector('.nowplaying-stage'),r=e.getBoundingClientRect(),x=r.left+r.width*.4,y=r.top+r.height*.5;
    const send=(type,xx)=>e.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:8,clientX:xx,clientY:y}));
    send('pointerdown',x);send('pointermove',x+dx);window.__releaseVisuel=()=>send('pointerup',x+dx);
  },dx);
  await swipeRight(50);await q.waitForTimeout(100);
  const backward=await q.evaluate(()=>({tint:document.querySelector('.sb-artmode').style.getPropertyValue('--art-tint'),layers:[...document.querySelectorAll('.nowplaying-ambience__layer')].map(x=>x.style.opacity)}));
  check(backward.tint.includes('hsl(0 ')&&Number(backward.layers[1])>0&&Number(backward.layers[2])===0,'glissement droite : la teinte suit la pochette précédente');
  await q.evaluate(()=>window.__releaseVisuel());await q.waitForTimeout(500);
  check((await q.locator('.nowplaying-meta h2').textContent()).includes('Veridis')&&(await colors()).rail[2]>(await colors()).rail[0],'geste trop court : retour à la couleur et au morceau actuels');
  await swipeRight(115);await q.waitForTimeout(80);await q.evaluate(()=>window.__releaseVisuel());
  await q.waitForFunction(()=>document.querySelector('.nowplaying-meta h2')?.textContent.includes('Midnight'),null,{timeout:6000});await q.waitForTimeout(300);
  const back=await colors();check(back.rail[0]>back.rail[2]&&back.tint.includes('hsl(0 '),'retour au morceau précédent et à sa palette rouge');
  await q.setViewportSize({width:320,height:568});await q.waitForTimeout(350);
  const mobile=await q.evaluate(()=>{const el=document.querySelector('.sb-artmode').getBoundingClientRect();const art=document.querySelector('.nowplaying-stage').getBoundingClientRect();const play=document.querySelector('.nowplaying-play').getBoundingClientRect();return {selector:[el.left,el.right],art:[art.width,art.height],play:[play.top,play.bottom],h:innerHeight,w:innerWidth}});
  console.log('  dimensions mobile',JSON.stringify(mobile));
  check(mobile.selector[0]>=0&&mobile.selector[1]<=mobile.w&&mobile.play[0]>=0&&mobile.play[1]<=mobile.h,'lecteur et commandes restent dans le petit écran');
  check(playerErrors.length===0,'lecteur : aucune exception JavaScript');
  await ctx.close();
  console.log(`\n${count}/${count} contrôles visuels et comportementaux réussis`);
} finally {await browser.close();}
