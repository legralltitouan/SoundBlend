/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-activation-v7/',import.meta.url),{recursive:true});
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=user-gesture-required'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; console.log(`  ✓ ${label}`); };
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Attente du scénario vocal dépassée'); };
async function setup(options = {}) {
  const state = { received: [], sockets: [], writes: [], wiki: [], modelHeaders: [], ...options.state };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', serviceWorkers: 'block' });
  await ctx.addInitScript(({ auth, deny, key, hold }) => {
    localStorage.setItem('soundblend_onboarded', '1');
    const prefix = auth ? 'soundblend_account_v1:voice-account:' : '';
    localStorage.setItem(prefix + 'soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: key }));
    if (auth) sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'fake', owner: 'voice-account', expiresAt: Date.now() + 3600000, profile: { name: 'Test vocal', email: '', avatarUrl: '' } }));
    const native = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (native) navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__micGesture = navigator.userActivation?.isActive;
      window.__micRequests = (window.__micRequests || 0) + 1;
      if (deny) throw new DOMException('Permission denied', 'NotAllowedError');
      const acquire = async () => { const stream = await native(...args); window.__voiceStream = stream; return stream; };
      if (hold) return new Promise((resolve,reject) => { window.__grantMicrophone = () => acquire().then(resolve,reject); });
      return acquire();
    };
    const WS = window.WebSocket;
    window.WebSocket = class extends WS { constructor(...args) { super(...args); window.__voiceSocket = this; } };
    if (window.AudioBufferSourceNode) {
      const oldStart = AudioBufferSourceNode.prototype.start, oldStop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function(...args) { window.__voicePlays = (window.__voicePlays || 0) + 1; return oldStart.apply(this, args); };
      AudioBufferSourceNode.prototype.stop = function(...args) { window.__voiceStops = (window.__voiceStops || 0) + 1; return oldStop.apply(this, args); };
    }
  }, { hold: !!options.hold, auth: options.auth !== false, deny: !!options.deny, key: options.key === undefined ? 'test-key' : options.key });
  await ctx.routeWebSocket(/wss:\/\/generativelanguage\.googleapis\.com\/.*/, (ws) => {
    state.sockets.push(ws);
    ws.onClose(() => { state.socketClosed = true; void ws.close().catch(() => {}); });
    ws.onMessage((message) => {
      const parsed = JSON.parse(String(message)); state.received.push(parsed);
      if (parsed.setup && !options.noSetup) ws.send(JSON.stringify({ setupComplete: {} }));
    });
  });
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.google={accounts:{oauth2:{initTokenClient:()=>({})}}};' }));
  await ctx.route('https://www.youtube.com/**', (r) => r.fulfill({ status: 200, headers: cors, body: '{}' }));
  await ctx.route(/pipedapi\.|api\.piped\./, (r) => r.abort());
  await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//, (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    if (r.request().url().includes('alt=media')) return r.fulfill({ status: 200, headers: cors, body: '{"schema":2,"blends":[],"exclusions":[],"decouvertes":[],"suppressionsBlends":{}}' });
    if (r.request().method() === 'PATCH') return r.fulfill({ status: 200, headers: cors, body: '{"id":"f1"}' });
    return r.fulfill({ status: 200, headers: cors, body: '{"files":[{"id":"f1","name":"soundblend.json"}]}' });
  });
  await ctx.route('https://fr.wikipedia.org/w/api.php**', (r) => {
    state.wiki.push(new URL(r.request().url()).searchParams.get('gsrsearch'));
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ query: { pages: { 1: { pageid: 1, index: 1, title: 'Daft Punk', extract: 'Daft Punk est un duo français.' } } } }) });
  });
  await ctx.route('https://www.googleapis.com/youtube/v3/**', (r) => {
    const u = new URL(r.request().url()), method = r.request().method();
    if (method === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
    if (method !== 'GET') state.writes.push({ method, path: u.pathname });
    if (u.pathname.endsWith('/playlists')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'PL-VOICE', snippet: { title: 'Vocal Chill', thumbnails: {} }, contentDetails: { itemCount: 1 } }] }) });
    if (u.pathname.endsWith('/playlistItems')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'item-v', snippet: { title: 'Musique', videoOwnerChannelTitle: 'Alpha - Topic', resourceId: { videoId: 'aaaaaaaaaaa' }, thumbnails: {} }, contentDetails: { videoId: 'aaaaaaaaaaa' } }] }) });
    if (u.pathname.endsWith('/search')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: { videoId: 'bbbbbbbbbbb' }, snippet: { title: 'Artist - Song', channelTitle: 'Artist - Topic', thumbnails: {} } }] }) });
    return r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' });
  });
  await ctx.route('https://generativelanguage.googleapis.com/**', async (r) => {
    if (r.request().url().includes('/models?')) {
      state.modelHeaders.push(r.request().headers());
      const models = [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192 }];
      if (!options.noLiveModel) models.push({ name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] });
      if (options.extendedOnly) models.push({ name: 'models/gemini-3.8-live-extended-thinking', supportedGenerationMethods: ['bidiGenerateContent'] });
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ models }) });
    }
    if (state.waitGemini) await state.waitGemini;
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: 'Je prépare un blend à partir de Vocal Chill.', action: 'blend', source: { type: 'playlist', id: 'PL-VOICE' }, extraSources: [], instruction: 'Plus jazz', durationMinutes: 45, catalogQueries: [], catalogVideoIds: [], researchQuery: '', playlistEdits: null }) }] } }] }) }).catch(() => {});
  });
  await ctx.addInitScript(({mode}) => {
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      constructor(...args) {
        super(...args); window.__audioContext = this;
        const resume = this.resume.bind(this); this.resume = (...a) => {window.__resumeCalls=(window.__resumeCalls||0)+1;return resume(...a)};
        if(mode==='module-hang')this.audioWorklet.addModule=()=>new Promise(()=>{});
        if(mode==='module-error')this.audioWorklet.addModule=async()=>{throw new Error('Worklet indisponible')};
        if (mode === 'blocked-all') {
          const script = this.createScriptProcessor.bind(this);
          this.createScriptProcessor = (...a) => {const node=script(...a);node.addEventListener('audioprocess',e=>e.stopImmediatePropagation());return node};
        }
      }
    };
    if(mode==='no-worklet')Object.defineProperty(window,'AudioWorkletNode',{configurable:true,value:undefined});
    else if(mode){
      const Worklet=window.AudioWorkletNode;window.__dropWorklet=mode==='blocked'||mode==='blocked-all';
      window.AudioWorkletNode=class extends Worklet {
        constructor(...a){super(...a);this.port.addEventListener('message',e=>{if(window.__dropWorklet)e.stopImmediatePropagation();else if(mode==='zero')new Int16Array(e.data).fill(0)});this.port.start()}
      };
    }
  },{mode:options.captureMode});
  await ctx.addInitScript(({gated,mode})=>{
    if(!gated)return;
    document.addEventListener('click',e=>{if(e.isTrusted){window.__trustedAudioClick=true;setTimeout(()=>window.__trustedAudioClick=false,0)}},true);
    const Audio=window.AudioContext;
    window.AudioContext=class extends Audio{
      constructor(...a){super(...a);const resume=this.resume.bind(this);window.__nativeResume=resume;this.resume=()=>{
        if(window.__requiresAudioTap&&(!window.__trustedAudioClick||mode==='permanent')){window.__ignoredResumes=(window.__ignoredResumes||0)+1;if(mode==='pending')return new Promise(()=>{});return mode==='reject'?Promise.reject(new DOMException('Gesture required','NotAllowedError')):Promise.resolve()}
        if(window.__trustedAudioClick)window.__requiresAudioTap=false;return resume();
      }};
    };
    const mic=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async(...a)=>{const stream=await mic(...a);window.__requiresAudioTap=true;await window.__audioContext.suspend();return stream};
  },{gated:options.gated!==false,mode:options.activationMode});
  await ctx.addInitScript(theme=>{localStorage.setItem('soundblend_mode',theme);localStorage.setItem('soundblend_account_v1:voice-account:soundblend_mode',theme)},options.theme||'light');
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const activationButton=p=>p.getByRole('button',{name:'Activer l’audio',exact:true});
const connected=async p=>{await p.getByText('Signal micro reçu',{exact:true}).waitFor();await p.getByText(/Micro ouvert ·|Audio réactivé ·/).first().waitFor();};
const nonzero=state=>state.received.some(m=>m.realtimeInput?.audio&&Buffer.from(m.realtimeInput.audio.data,'base64').some(v=>v!==0));
try{
 for(const mode of ['resolve','reject','pending']){
  const {p,ctx,state,errors}=await setup({activationMode:mode});await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor({timeout:12000});
  check(await p.evaluate(()=>window.__audioContext.state==='suspended')&&state.modelHeaders.length===0,`${mode} : vrai contexte suspended reconnu indépendamment du sort de la promesse resume()`);
  check(await p.evaluate(()=>window.__micRequests===1)&&await p.getByRole('button',{name:'Réessayer le Live'}).count()===0,'pas de réacquisition en boucle ni de faux échec de capture pendant l’attente du geste');
  check(await activationButton(p).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=55&&r.bottom<innerHeight-65}),'bouton d’activation amené dans la zone mobile visible');
  await p.evaluate(()=>document.getElementById('sa-activate-audio').click());await p.waitForTimeout(250);
  check(await p.evaluate(()=>window.__audioContext.state==='suspended'),'un clic JavaScript artificiel ne prétend pas résoudre le blocage');
  await p.screenshot({path:new URL(`./assistant-activation-v7/activation-${mode}-mobile.png`,import.meta.url).pathname});
  await activationButton(p).tap();await connected(p);await until(()=>nonzero(state));
  check(nonzero(state),`${mode} : tap tactile réel → contexte running → PCM non nuls envoyés`);
  check(await p.evaluate(()=>window.__micRequests===1)&&await activationButton(p).count()===0,'la session existante reprend sans nouvel accès micro et le bouton disparaît');
  await p.evaluate(()=>{window.__requiresAudioTap=true;return window.__audioContext.suspend()});await activationButton(p).waitFor({timeout:15000});
  const before=state.received.filter(m=>m.realtimeInput?.audio).length;await activationButton(p).focus();await p.keyboard.press('Enter');await connected(p);
  await until(()=>state.received.filter(m=>m.realtimeInput?.audio).length>before+1);
  check(await p.evaluate(()=>window.__audioContext.state==='running'),'suspension en cours de Live : activation clavier reprend aussi l’envoi');
  await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.waitForFunction(()=>window.__voiceStream.getAudioTracks().every(t=>t.readyState==='ended'));
  check(errors.length===0&&state.writes.length===0,'aucun rejet non géré ni écriture musicale');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();
  for(let i=0;i<3;i++){
   await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor();await activationButton(p).tap();await connected(p);
   check(await p.evaluate(()=>window.__audioContext.state==='running'),`relance ${i+1} après Terminer : activation réussie`);
   await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.waitForFunction(()=>!window.__voiceStream.active);
  }
  check(state.sockets.length===3&&state.writes.length===0,'trois sessions distinctes, pas de duplication de connexion ni mutation');await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup();await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor();
  await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.waitForFunction(()=>!window.__voiceStream.active);
  check(state.modelHeaders.length===0&&errors.length===0,'Terminer pendant l’attente du geste : micro fermé, aucun appel Gemini ni rejet tardif');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor();await p.evaluate(()=>window.dispatchEvent(new CustomEvent('sb:auth-changing')));
  check(await p.locator('.sa-live').count()===0&&await p.evaluate(()=>!window.__voiceStream.active)&&state.modelHeaders.length===0,'changement de compte annule aussi l’activation tactile en attente');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup();await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor();await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  check(await p.locator('.sa-live').count()===0&&await p.evaluate(()=>!window.__voiceStream.active)&&state.modelHeaders.length===0,'passage en arrière-plan pendant l’activation : micro coupé sans appel Gemini');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({gated:false});await p.getByRole('button',{name:'Live',exact:true}).tap();await connected(p);await until(()=>nonzero(state));
  check(await activationButton(p).count()===0&&nonzero(state),'Chrome non bloqué : le Live reste en un seul tap, sans bouton supplémentaire');await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup({activationMode:'permanent'});await p.clock.install();await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor();await activationButton(p).tap();await p.clock.fastForward(31000);await p.getByRole('alert').waitFor();
  check((await p.getByRole('alert').innerText()).includes('moteur audio en pause')&&!(await p.getByRole('alert').innerText()).includes('aucun échantillon'),'blocage persistant : erreur spécifique d’activation, pas un faux problème de micro');
  check(await p.evaluate(()=>!window.__voiceStream.active&&window.__micRequests===1)&&state.modelHeaders.length===0&&errors.length===0,'timeout borné, micro libéré et aucune boucle de permission');await ctx.close();
 }
 const {default:AxeBuilder}=await import(process.env.SOUNDBLEND_AXE_MODULE||'@axe-core/playwright');
 for(const theme of ['light','dark']){
  const {p,ctx}=await setup({theme});await p.emulateMedia({reducedMotion:'reduce'});await p.getByRole('button',{name:'Live',exact:true}).click();await activationButton(p).waitFor();
  check(await p.locator('html').getAttribute('data-mode')===theme,`thème ${theme} effectivement appliqué au compte de test`);
  const ax=await new AxeBuilder({page:p}).include('.sa-audio-activation').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  check(ax.violations.length===0,`audit axe activation ${theme} : ${JSON.stringify(ax.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.failureSummary)})))}`);
  await p.screenshot({path:new URL(`./assistant-activation-v7/activation-${theme}.png`,import.meta.url).pathname});await ctx.close();
 }
 console.log(`\n${checks} contrôles d’activation réussis, dont 2 audits axe (Chromium à politique de geste stricte, panne suspended simulée).`);
}finally{await browser.close();}
