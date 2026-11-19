/* Mesure sur les DEUX instances réelles de YT.Player. La recherche du
   clip est simulée pour obtenir une vidéo reproductible, pas le lecteur.
   Aucune affirmation sur les pixels (Chromium sans écran), ni sur Premium. */
import {chromium} from 'playwright';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const ctx=await browser.newContext({viewport:{width:1280,height:800}});
const cors={'content-type':'application/json','access-control-allow-origin':'*'};
await ctx.route('https://www.youtube.com/oembed**',r=>r.fulfill({status:200,headers:cors,body:JSON.stringify({title:'Midnight City (Official Video)',author_name:'M83'})}));
await ctx.route(/pipedapi\.|api\.piped\./,r=>{ const u=r.request().url(); return u.includes('/search')?r.fulfill({status:200,headers:cors,body:'{"items":[]}'}):r.abort(); });
const p=await ctx.newPage();
const pageErrors=[];p.on('pageerror',e=>pageErrors.push(String(e)));
try{
 await p.goto(process.env.SOUNDBLEND_URL || 'http://localhost:4173/');
 await p.evaluate(()=>{localStorage.clear();localStorage.setItem('soundblend_onboarded','1')});
 await p.reload();
 await p.waitForFunction(()=>!!window.YT?.Player,null,{timeout:30000});
 await p.evaluate(()=>{
   window.__real=[]; const Original=window.YT.Player; const testVideo='M7lc1UVf-VE';
   const wrapper=function(el,opts){
     const kind=typeof el==='string'?'audio':'clip';
     const oldReady=opts.events.onReady;
     opts={...opts,videoId:testVideo,events:{...opts.events,onReady:(e)=>{
       if(kind==='audio') { const originalLoad=e.target.loadVideoById.bind(e.target); e.target.loadVideoById=(arg)=>originalLoad(typeof arg==='object'?{...arg,videoId:testVideo}:testVideo); }
       oldReady(e);
     }}};
     const obj=new Original(el,opts); window.__real.push({kind,p:obj,vid:opts.videoId}); return obj;
   };
   wrapper.prototype=Original.prototype; window.YT.Player=wrapper;
 });
 await p.locator('.sb-play-badge').first().waitFor();
 await p.locator('.sb-play-badge').first().click({force:true});
 await p.locator('.nowbar-track').waitFor();
 await p.evaluate(()=>document.querySelector('.nowbar-track')?.click());
 await p.waitForSelector('.sb-artmode',{timeout:12000});
 await p.evaluate(()=>[...document.querySelectorAll('.sb-artmode__opt')].find(x=>/Vidéo/.test(x.textContent))?.click());
 await p.waitForFunction(()=>window.__real.filter(x=>x.kind==='clip').length>0,null,{timeout:30000});
 await p.evaluate(()=>{window.__audioFrame=document.querySelector('#youtube-player-host iframe')});
 const measure=async(label)=>{
   const r=await p.evaluate(()=>{
     const a=window.__real.filter(x=>x.kind==='audio').at(-1)?.p;
     const c=window.__real.filter(x=>x.kind==='clip').at(-1)?.p;
     const read=(x)=>{try{return {time:x?.getCurrentTime?.()??null,state:x?.getPlayerState?.()??null,duration:x?.getDuration?.()??null,muted:x?.isMuted?.()??null}}catch{return null}};
     return {audio:read(a),clip:read(c),clips:window.__real.filter(x=>x.kind==='clip').length,
       sameAudioFrame:window.__audioFrame===document.querySelector('#youtube-player-host iframe'),
       mode:document.querySelector('.sb-artmode')?.getAttribute('data-mode'),
       app:document.querySelector('.nowplaying .big-rail')?.getAttribute('aria-valuenow')};
   });
   const frameData=async(selector)=>{
     try{const h=await p.$(selector); const f=await h?.contentFrame(); if(!f)return null;
       return await f.evaluate(()=>{let v=document.querySelector('video');return v?{ct:v.currentTime,rs:v.readyState,w:v.videoWidth,paused:v.paused}:null}).catch(()=>null);
     }catch{return null}
   };
   r.audioElement=await frameData('#youtube-player-host iframe');
   r.clipElement=await frameData('.nowplaying-clip iframe');
   const delta=(r.audio?.time!=null&&r.clip?.time!=null)?+(r.clip.time-r.audio.time).toFixed(2):null;
   console.log(JSON.stringify({label,...r,delta}));
   return {...r,delta};
 };
 let started=true;
 try{await p.waitForFunction(()=>{let a=window.__real.find(x=>x.kind==='audio')?.p,c=window.__real.find(x=>x.kind==='clip')?.p;try{return a?.getPlayerState?.()===1&&c?.getPlayerState?.()===1&&a?.getCurrentTime?.()>1&&c?.getCurrentTime?.()>1}catch{return false}},null,{timeout:60000});}
 catch{started=false;process.exitCode=2;}
 let base=await measure(started?'lecteurs démarrés':'démarrage incomplet (mesure non concluante)');
 if(started){
   await p.waitForTimeout(3500); await measure('lecture continue');
   for(let i=0;i<3;i++){
     await p.getByRole('button',{name:'Titre',exact:true}).click({force:true}); await p.waitForTimeout(1400);
     await p.getByRole('button',{name:'Vidéo',exact:true}).click({force:true}); await p.waitForTimeout(3000);
     await measure('retour Vidéo '+(i+1));
   }
   await p.locator('.nowplaying-reduce').click({force:true});
   await p.waitForFunction(()=>!document.querySelector('.nowplaying'),null,{timeout:7000});
   await p.locator('.nowbar-track').click({force:true});
   await p.waitForFunction(()=>window.__real.filter(x=>x.kind==='clip').length>=2,null,{timeout:15000});
   await p.waitForTimeout(8000);await measure('mini vers grand lecteur');
 }
 console.log('exceptions JS:',JSON.stringify(pageErrors));
}catch(e){process.exitCode=2;console.log('ERREUR/TEST INCOMPLET:',String(e));console.log('DIAGNOSTIC:',JSON.stringify(await p.evaluate(()=>({body:document.body.innerText.slice(0,700), nowplaying:!!document.querySelector('.nowplaying'), artmode:!!document.querySelector('.sb-artmode'), players:window.__real?.map(x=>({kind:x.kind,vid:x.vid})), url:location.href})).catch(()=>null)));console.log('exceptions JS:',JSON.stringify(pageErrors));}
finally{await browser.close()}
