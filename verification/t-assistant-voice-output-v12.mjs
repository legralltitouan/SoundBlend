/* Real Chromium audio graph; no physical OS volume claim. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({args:['--no-sandbox','--autoplay-policy=user-gesture-required']});
const base=process.env.SOUNDBLEND_URL||'http://localhost:5173/';
let checks=0;
const check=(v,label)=>{assert.ok(v,label);checks++;console.log('  ✓ '+label)};
try {
 const p=await browser.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
 await p.evaluate(async()=>{window.outmod=await import('/src/services/liveVoiceOutput.ts');});
 await p.evaluate(()=>{const {getLiveVoiceVolume:g,setLiveVoiceVolume:s}=window.outmod;localStorage.removeItem('soundblend_live_voice_volume_v1');window.defaults=[g()];for(const val of ['garbage','-1','1.5',' ','NaN']){localStorage.setItem('soundblend_live_voice_volume_v1',val);window.defaults.push(g())}s(NaN);s(.35);window.saved=g();s(1)});
 check(await p.evaluate(()=>window.defaults.every(v=>v===1)&&window.saved===.35),'stockage absent/corrompu ignoré, préférence valide enregistrée');
 await p.locator('body').evaluate(el=>{const b=document.createElement('button');b.textContent='Audio test';b.id='audio-test';b.onclick=async()=>{const {LiveVoiceOutput}=window.outmod;const ctx=new AudioContext();await ctx.resume();window.testCtx=ctx;window.output=new LiveVoiceOutput(ctx);window.osc=ctx.createOscillator();window.osc.frequency.value=440;window.osc.connect(window.output.input);window.osc.start();const analyser=ctx.createAnalyser();analyser.fftSize=2048;window.output.input.connect(analyser);window.analyser=analyser;window.rms=()=>{const a=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(a);return Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length)}};el.appendChild(b)});
 await p.locator('#audio-test').click();await p.waitForTimeout(350);
 check(await p.evaluate(()=>window.output.route==='media' && document.querySelectorAll('audio[data-sb-live-voice-output]').length===1 && !document.querySelector('audio[data-sb-live-voice-output]').paused),'geste strict : une seule sortie multimédia active');
 const high=await p.evaluate(()=>window.rms());await p.evaluate(()=>window.outmod.setLiveVoiceVolume(.2));await p.waitForTimeout(300);const low=await p.evaluate(()=>window.rms());
 check(high>.5 && low/high>.17&&low/high<.23,'GainNode : atténuation réelle de 80 % du signal PCM');
 await p.evaluate(()=>window.outmod.setLiveVoiceVolume(0));await p.waitForTimeout(120);check(await p.evaluate(()=>window.rms()<.00001),'0 % coupe réellement la voix');
 await p.evaluate(()=>{window.output.pause();window.output.resume()});await p.waitForTimeout(120);check(await p.evaluate(()=>!document.querySelector('audio[data-sb-live-voice-output]').paused),'pause/interruption puis reprise du même élément');
 await p.evaluate(()=>{window.output.dispose();window.output.dispose();window.osc.stop();window.testCtx.close()});
 check(await p.locator('audio[data-sb-live-voice-output]').count()===0,'dispose idempotent : aucun élément ni flux de sortie restant');
 for(const kind of ['reject','throw','pending','error']){
  await p.evaluate(kind=>{const {LiveVoiceOutput,setLiveVoiceVolume}=window.outmod;setLiveVoiceVolume(.4);window.testCtx=new AudioContext();window.testCtx.resume();window.originalPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(kind==='throw')throw new Error('synthetic');if(kind==='pending')return new Promise(()=>{});if(kind==='error')return Promise.resolve();return Promise.reject(new DOMException('blocked','NotAllowedError'))};window.output=new LiveVoiceOutput(window.testCtx);if(kind==='error')document.querySelector('audio[data-sb-live-voice-output]').dispatchEvent(new Event('error'));HTMLMediaElement.prototype.play=window.originalPlay},kind);
  await p.waitForTimeout(kind==='pending'?3200:120);
  check(await p.evaluate(()=>window.output.route==='direct'&&Math.abs(window.output.input.gain.value-.4)<.00001&&document.querySelectorAll('audio[data-sb-live-voice-output]').length===0),`${kind} : repli direct unique, gain conservé, élément supprimé`);
  await p.evaluate(()=>{window.output.dispose();window.testCtx.close()});
 }
 await p.evaluate(()=>{const ctx=new AudioContext();window.testCtx=ctx;const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>new Promise(resolve=>window.lateResolve=resolve);window.output=new window.outmod.LiveVoiceOutput(ctx);HTMLMediaElement.prototype.play=original;window.output.dispose();window.lateResolve();ctx.close()});await p.waitForTimeout(150);
 check(await p.locator('audio[data-sb-live-voice-output]').count()===0,'résolution play tardive après arrêt : aucune résurrection');
 check(errors.length===0,'aucun rejet non géré');
 console.log(`${checks} contrôles audio V12 réussis`);
}finally{await browser.close()}
