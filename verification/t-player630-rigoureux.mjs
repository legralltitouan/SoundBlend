/* Test de comportement de l'application avec l'API YouTube SIMULÉE.
 * Ce test ne prouve ni la peinture vidéo, ni la prise en compte de Premium.
 * Le seek audio répond après un délai, les deux horloges sont indépendantes,
 * et le faux lecteur remplace son élément par une iframe comme l'API réelle.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
const context = await browser.newContext({ viewport:{width:1280,height:800} });
const cors = {'content-type':'application/json','access-control-allow-origin':'*'};
await context.route('https://www.youtube.com/iframe_api', r => r.fulfill({status:200,headers:{'content-type':'application/javascript'},body:''}));
await context.route('https://www.youtube.com/oembed**', r => {
  const id = new URL(new URL(r.request().url()).searchParams.get('url') || 'https://youtube.com/').searchParams.get('v');
  const topic = id === 'TCd6PfxOy0Y';
  return r.fulfill({status:200,headers:cors,body:JSON.stringify({title:topic?'Veridis Quo':'M83 - Midnight City (Official Video)',author_name:topic?'Daft Punk - Topic':'M83'})});
});
await context.route(/pipedapi\.|api\.piped\./, r => {
  const url=decodeURIComponent(r.request().url()).toLowerCase();
  if (url.includes('/search')) {
    const items = url.includes('veridis') ? [] : [{url:'/watch?v=CLIP0000009',title:'M83 - Midnight City (Official Video)',uploaderName:'M83',duration:244,type:'stream'}];
    return r.fulfill({status:200,headers:cors,body:JSON.stringify({items})});
  }
  return r.abort();
});
await context.addInitScript(() => {
  const fake = { audio:null, clips:[], logs:[], invalidCalls:0 };
  window.__fake = fake;
  window.YT = {Player:function(element,opts){
    const kind = typeof element === 'string' ? 'audio' : 'clip';
    const target = typeof element === 'string' ? document.getElementById(element) : element;
    if (!target) throw Error('cible manquante');
    const iframe=document.createElement('iframe');
    iframe.className=target.className;
    iframe.dataset.fake=kind;
    iframe.src='about:blank';
    target.replaceWith(iframe);
    const self=this;
    let pos = Number(opts?.playerVars?.start)||0, stamp=performance.now(), state=-1, destroyed=false, vid=opts.videoId;
    const record=(what,extra={})=>fake.logs.push({kind,what,at:performance.now(),...extra});
    const read=()=> state===1 ? pos+(performance.now()-stamp)/1000 : pos;
    const change=(s)=>{
      if (destroyed) return;
      pos=read(); stamp=performance.now(); state=s;
      setTimeout(()=>{ if (!destroyed) opts.events?.onStateChange?.({target:self,data:s}); },0);
    };
    const alive=()=> { if(destroyed) { fake.invalidCalls++; throw Error('lecteur détruit'); } };
    this.kind=kind;
    this.destroyed=false;
    this.frame=iframe;
    this.getIframe=()=>{alive();return iframe};
    this.getPlayerState=()=>{alive();return state};
    this.getCurrentTime=()=>{alive();return read()};
    this.getDuration=()=>self.duration ?? 244;
    this.getVideoData=()=>({video_id:vid});
    this.setVolume=()=>{};
    this.mute=()=>{self.muted=true;record('mute')};
    this.unMute=()=>{self.muted=false};
    this.loadVideoById=(arg)=>{
      alive();vid=typeof arg==='string'?arg:arg.videoId;pos=typeof arg==='object'?(arg.startSeconds||0):0;stamp=performance.now();record('load',{vid});
    };
    this.playVideo=()=>{alive();record('play');change(1)};
    this.pauseVideo=()=>{alive();record('pause');change(2)};
    this.seekTo=(s)=>{
      alive(); record('seek',{seconds:s});
      const was=state;
      /* Asynchrone : pendant 600 ms l'audio renvoie encore l'ancienne
         position. Le clip est plus rapide. */
      setTimeout(()=>{ if(destroyed)return; pos=Math.max(0,s-(self.seekOffset||0)); stamp=performance.now(); if(was!==2 && state===-1) change(1); },kind==='audio'?600:70);
    };
    this.destroy=()=>{if(destroyed)return;record('destroy');destroyed=true;self.destroyed=true;iframe.remove()};
    this.forceTime=(n)=>{alive();pos=n;stamp=performance.now()};
    this.forceState=(n)=>{alive();change(n)};
    this.error=(n)=>opts.events?.onError?.({target:self,data:n});
    if(kind==='audio') fake.audio=self; else fake.clips.push(self);
    record('create',{vid});
    setTimeout(()=>{if(!destroyed)opts.events?.onReady?.({target:self})},40);
  }};
});
const page = await context.newPage();
const errors=[];
page.on('pageerror', e => errors.push(String(e)));
let count=0;
const check = (value, message) => { assert.ok(value,message); count++; console.log('  ✓ '+message); };
const snapshot=()=>page.evaluate(()=>{
  const f=window.__fake,a=f.audio; const last=f.clips.at(-1); const c=last?.destroyed ? null : last;
  const safely=(fn)=>{try{return fn()}catch{return null}};
  return {audio:safely(()=>a?.getCurrentTime()), clip:safely(()=>c?.getCurrentTime()), audioState:safely(()=>a?.getPlayerState()), clipState:safely(()=>c?.getPlayerState()),
    muted:c?.muted, clips:f.clips.length, audioLogs:f.logs.filter(l=>l.kind==='audio'), clipLogs:f.logs.filter(l=>l.kind==='clip'), invalid:f.invalidCalls,
    clipOn:document.querySelector('.nowplaying-clip')?.getAttribute('data-on'), mode:document.querySelector('.sb-artmode')?.getAttribute('data-mode'),
    audioId:a?.getVideoData()?.video_id, clipId:safely(()=>c?.getVideoData()?.video_id),
    appValue:Number(document.querySelector('.nowplaying .big-rail')?.getAttribute('aria-valuenow')) };
});
const clickMode=async(name)=>{const b=page.getByRole('button',{name,exact:true}); await b.waitFor(); await b.click({force:true});};
try {
  await page.goto(process.env.SOUNDBLEND_URL || 'http://localhost:4173/');
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('soundblend_onboarded','1')});
  await page.reload();
  await page.locator('.sb-play-badge').first().waitFor();
  await page.locator('.sb-play-badge').first().click({force:true});
  await page.waitForFunction(()=>!!window.__fake.audio && window.__fake.audio.getPlayerState()===1);
  await page.locator('.nowbar-track').click({force:true});
  await page.locator('.nowplaying').waitFor();
  await page.waitForTimeout(500);
  const host=await page.locator('#youtube-player-host').evaluate(h=>({op:getComputedStyle(h).opacity,z:getComputedStyle(h).zIndex}));
  check(host.op==='0'&&host.z==='-1','lecteur audio natif masqué');

  await page.evaluate(()=>window.__fake.audio.forceTime(80));
  await clickMode('Vidéo');
  await page.waitForFunction(()=>window.__fake.clips.length===1 && window.__fake.clips[0].getPlayerState()===1,{timeout:10000});
  await page.waitForTimeout(600);
  let a=await snapshot();
  check(a.clipId==='CLIP0000009','bon clip créé, pas un autre');
  check(a.muted===true,'clip muet, unique source audio');
  check(Math.abs(a.audio-a.clip)<1,`au démarrage clip/audio alignés (écart ${Math.abs(a.audio-a.clip).toFixed(2)} s)`);
  check(Math.abs(a.appValue-a.audio)<1.5,`curseur affiché suit le son (app ${a.appValue}, audio ${a.audio.toFixed(1)})`);

  await page.evaluate(()=>window.__fake.clips.at(-1).forceTime(15));
  await page.waitForTimeout(1800);
  a=await snapshot();
  check(Math.abs(a.audio-a.clip)<1,`une dérive forcée est corrigée (écart ${Math.abs(a.audio-a.clip).toFixed(2)} s)`);

  /* Le vrai rail déclenche un vrai changement, puis on lit le journal :
     le précédent test pouvait passer sans avoir déclenché de seek. */
  const beforeSeek=await snapshot();
  await page.locator('.nowplaying .big-rail').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  const during=await snapshot();
  const seekAudio=during.audioLogs.filter(x=>x.what==='seek').at(-1);
  const seekClip=during.clipLogs.filter(x=>x.what==='seek').at(-1);
  check(!!seekAudio && seekAudio.seconds>beforeSeek.audio+3.5,'le clavier a vraiment demandé un saut sur le lecteur audio');
  check(!!seekClip && Math.abs(seekAudio.seconds-seekClip.seconds)<0.05,'le même saut est demandé au clip');
  const seekCount=during.clipLogs.filter(x=>x.what==='seek').length;
  await page.waitForTimeout(300); // audio seek still pending: 450ms < 600ms
  const waiting=await snapshot();
  check(waiting.clipLogs.filter(x=>x.what==='seek').length===seekCount,'pas de seek du clip vers l’ancienne position audio pendant le saut');
  await page.waitForTimeout(1100);
  a=await snapshot();
  check(Math.abs(a.audio-a.clip)<1,`après le saut différé, le clip rejoint le son (écart ${Math.abs(a.audio-a.clip).toFixed(2)} s)`);

  /* buffering du son : le curseur ne doit pas avancer ni le clip continuer */
  await page.evaluate(()=>window.__fake.audio.forceState(3));
  await page.waitForTimeout(500);
  const buffering1=await snapshot();
  await page.waitForTimeout(1100);
  const buffering2=await snapshot();
  check(buffering2.clipState===2,'le clip est en pause pendant la mise en tampon du son');
  check(Math.abs(buffering2.appValue-buffering1.appValue)<=1,'l’horloge de l’app ne progresse pas pendant le tampon');
  await page.evaluate(()=>window.__fake.audio.forceState(1));
  await page.waitForTimeout(1800);
  a=await snapshot();
  check(a.clipState===1&&Math.abs(a.audio-a.clip)<1,`reprise et recalage après tampon (écart ${Math.abs(a.audio-a.clip).toFixed(2)} s)`);

  await page.locator('.nowplaying-play').click({force:true});
  await page.waitForTimeout(550);
  const paused=await snapshot();
  await page.waitForTimeout(1100);
  const stillPaused=await snapshot();
  check(paused.audioState===2&&stillPaused.clipState===2,'pause par le grand lecteur : audio et clip figés');
  check(Math.abs(stillPaused.appValue-paused.appValue)<=1,'horloge de l’app figée en pause');
  await page.locator('.nowplaying .big-rail').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1700);
  const pausedSeek=await snapshot();
  check(pausedSeek.audioState===2&&pausedSeek.clipState===2&&Math.abs(pausedSeek.audio-pausedSeek.clip)<1,
    'saut en pause : les deux lecteurs restent en pause et rejoignent le nouvel instant');
  await page.locator('.nowplaying-play').click({force:true});
  await page.waitForTimeout(1000);
  a=await snapshot();
  check(a.audioState===1&&a.clipState===1,'reprise de la musique et du clip');

  await page.evaluate(()=>{window.__fake.clips.at(-1).duration=15});
  await page.waitForTimeout(500);
  a=await snapshot();
  check(a.clipOn==='1','une vidéo courte n’est pas classée à tort comme une publicité');
  await page.evaluate(()=>{window.__fake.clips.at(-1).duration=244});

  const beforeKeyframes=(await snapshot()).clipLogs.filter(x=>x.what==='seek').length;
  await page.evaluate(()=>{const f=window.__fake,c=f.clips.at(-1); c.seekOffset=2; c.forceTime(f.audio.getCurrentTime()-15)});
  await page.waitForTimeout(3700);
  const afterKeyframes=await snapshot();
  const repeats=afterKeyframes.clipLogs.filter(x=>x.what==='seek').length-beforeKeyframes;
  check(repeats>=1&&repeats<=3,`si l’image-clé reste décalée, les corrections sont espacées (${repeats} seeks en 3,7 s)`);
  await page.evaluate(()=>{const f=window.__fake,c=f.clips.at(-1); c.seekOffset=0;c.forceTime(f.audio.getCurrentTime())});
  a=await snapshot();
  const audioBeforeToggle=a.audioLogs.filter(x=>['pause','seek','load'].includes(x.what)).length;
  const originalClipCount=a.clips;
  for(let i=0;i<3;i++){
    await clickMode('Titre'); await page.waitForTimeout(350);
    let t=await snapshot(); check(t.mode==='audio'&&t.clipState===2,`passage ${i+1} en Titre : clip figé`);
    await page.waitForTimeout(300);
    await clickMode('Vidéo'); await page.waitForTimeout(900);
    t=await snapshot(); check(t.mode==='clip'&&t.clips===originalClipCount&&Math.abs(t.audio-t.clip)<1.1,`retour ${i+1} en Vidéo : même clip, écart ${Math.abs(t.audio-t.clip).toFixed(2)} s`);
  }
  a=await snapshot();
  check(a.audioLogs.filter(x=>['pause','seek','load'].includes(x.what)).length===audioBeforeToggle,'les bascules ne commandent jamais pause, seek ou chargement du lecteur audio');

  await page.locator('.nowplaying-reduce').click({force:true});
  await page.waitForFunction(()=>!document.querySelector('.nowplaying'),null,{timeout:5000});
  await page.waitForTimeout(400);
  const afterClose=await snapshot();
  check(afterClose.clipLogs.some(x=>x.what==='destroy'),'fermeture : iframe du grand lecteur démontée proprement');
  check(afterClose.audioLogs.filter(x=>['pause','seek','load'].includes(x.what)).length===audioBeforeToggle,'la fermeture du grand lecteur ne modifie pas la musique');
  await page.locator('.nowbar-progress').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1000);
  const miniSeek=await snapshot();
  check(miniSeek.audioLogs.filter(x=>x.what==='seek').length===afterClose.audioLogs.filter(x=>x.what==='seek').length+1,
    'un saut depuis la mini-barre commande réellement le lecteur audio');
  await page.locator('.nowbar-track').click({force:true});
  await page.locator('.nowplaying').waitFor();
  await page.waitForFunction(()=>window.__fake.clips.length>=2 && window.__fake.clips.at(-1).getPlayerState()===1,null,{timeout:10000});
  await page.waitForTimeout(900);
  a=await snapshot();
  check(a.clipId==='CLIP0000009' && a.clips===2,'réouverture : nouveau lecteur du même clip, pas de référence détachée');
  check(Math.abs(a.audio-a.clip)<1.1,`réouverture synchronisée (écart ${Math.abs(a.audio-a.clip).toFixed(2)} s)`);
  check(a.audioLogs.filter(x=>['pause','seek','load'].includes(x.what)).length===audioBeforeToggle+1,'la réouverture ne rajoute aucune commande audio après le saut volontaire');
  check(a.invalid===0,'aucun appel au faux lecteur déjà détruit');

  await page.locator('.nowplaying-controls [aria-label="Suivant"]').click({force:true});
  await page.waitForFunction(()=>document.querySelector('.nowplaying-meta h2')?.textContent.includes('Veridis'));
  await page.waitForFunction(()=>document.querySelector('.sb-artmode')?.getAttribute('data-mode')==='audio',null,{timeout:10000});
  const noClip=await page.getByRole('button',{name:'Vidéo',exact:true}).isDisabled();
  check(noClip,'morceau sans clip : retour à Titre et Vidéo grisé');
  await page.locator('.nowplaying-controls [aria-label="Précédent"]').click({force:true});
  await page.waitForFunction(()=>document.querySelector('.nowplaying-meta h2')?.textContent.includes('Midnight City'));
  await page.waitForTimeout(300);
  await clickMode('Vidéo');
  await page.waitForFunction(()=>window.__fake.clips.at(-1)?.getPlayerState()===1 && window.__fake.clips.at(-1)?.getVideoData().video_id==='CLIP0000009',null,{timeout:10000});
  a=await snapshot();
  check(a.clipId==='CLIP0000009'&&a.mode==='clip','retour sur un morceau déjà joué : recherche/cached clip fonctionne');

  await page.evaluate(()=>window.__fake.clips.at(-1).error(150));
  await page.waitForFunction(()=>document.querySelector('.sb-artmode')?.getAttribute('data-mode')==='audio');
  check(await page.getByRole('button',{name:'Vidéo',exact:true}).isDisabled(),'erreur de lecteur clip : repli Titre au lieu de rester noir');
  check(errors.length===0,'aucune exception JavaScript dans la page');
  console.log(`\n${count}/${count} contrôles simulés réussis`);
} finally {await browser.close();}
