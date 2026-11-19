/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-live-v6/',import.meta.url),{recursive:true});
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
      const acquire = async () => { const stream = await native(...args); window.__voiceStream = stream;(window.__streams||=[]).push(stream);return stream; };
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
  await ctx.addInitScript(({mode,driverPoison,slowSuspend}) => {
    const Audio = window.AudioContext;
    window.AudioContext = class extends Audio {
      constructor(...args) {
        super(...args); window.__audioContext = this;
        if(slowSuspend){const suspend=this.suspend.bind(this);this.suspend=()=>new Promise((resolve,reject)=>setTimeout(()=>suspend().then(resolve,reject),550));}
        window.__contexts=(window.__contexts||[]); window.__contexts.push(this);
        const add=this.audioWorklet.addModule.bind(this.audioWorklet);this.audioWorklet.addModule=(...a)=>{window.__moduleLoads=(window.__moduleLoads||0)+1;return add(...a)};
        if(driverPoison&&window.__contexts.length>1){
          this.audioWorklet.addModule=async()=>{throw new Error('Route audio obsolète après fermeture du contexte')};
          const create=this.createScriptProcessor.bind(this);this.createScriptProcessor=(...a)=>{const n=create(...a);n.addEventListener('audioprocess',e=>e.stopImmediatePropagation());return n};
        }
        const resume = this.resume.bind(this); this.resume = (...a) => {window.__resumeCalls=(window.__resumeCalls||0)+1;return resume(...a)};
        if(mode==='module-hang')this.audioWorklet.addModule=()=>new Promise(()=>{});
        if(mode==='module-error')this.audioWorklet.addModule=async()=>{throw new Error('Worklet indisponible')};
        if (mode === 'first-source-blocked') {const script=this.createScriptProcessor.bind(this);this.createScriptProcessor=(...a)=>{const n=script(...a);n.addEventListener('audioprocess',e=>{if(window.__micRequests===1)e.stopImmediatePropagation()});return n};}
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
        constructor(...a){super(...a);this.port.addEventListener('message',e=>{if(window.__dropWorklet||(mode==='first-source-blocked'&&window.__micRequests===1))e.stopImmediatePropagation();else if(mode==='zero')new Int16Array(e.data).fill(0)});this.port.start()}
      };
    }
  },{mode:options.captureMode,driverPoison:!!options.driverPoison,slowSuspend:!!options.slowSuspend});
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const open=async p=>{await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByText('Signal micro reçu',{exact:true}).waitFor({timeout:18000});await p.getByText(/Micro ouvert ·/).first().waitFor({timeout:18000});};
try{
 for(const [driverPoison,slowSuspend,defaultCycles] of [[true,false,8],[false,false,20],[true,true,5]]){
  const {p,ctx,state,errors}=await setup({driverPoison,slowSuspend});
  const cycles=Number(process.env.LIVE_REPEAT_CYCLES||defaultCycles);
  for(let i=0;i<cycles;i++){
   const packets=state.received.filter(m=>m.realtimeInput?.audio).length;
   await open(p);await until(()=>state.received.filter(m=>m.realtimeInput?.audio).length>packets+1);
   check(state.received.slice().reverse().some(m=>m.realtimeInput?.audio&&Buffer.from(m.realtimeInput.audio.data,'base64').some(v=>v!==0)),`cycle ${i+1}/${cycles}, route ${driverPoison?'sensible aux fermetures':'normale'} : signal audio transmis`);
   await p.getByRole('button',{name:'Terminer',exact:true}).click();
   await p.waitForFunction(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
   check(await p.locator('.sa-live').count()===0&&await p.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),`cycle ${i+1} : toutes les pistes fermées et retour au prompt`);
  }
  check(await p.evaluate(()=>window.__contexts.length===1),'un seul contexte audio réutilisé, pas de destruction/recréation concurrente');
  check(await p.evaluate(()=>window.__moduleLoads===1),'module Worklet enregistré une seule fois par contexte réutilisé');
  await p.waitForFunction(()=>window.__audioContext.state==='suspended');
  check(await p.evaluate(()=>window.__audioContext.state==='suspended'&&window.__streams.every(s=>!s.active)),'contexte inactif suspendu, aucune capture conservée entre deux Live');
  check(errors.length===0,'aucune erreur JavaScript ni promesse rejetée pendant les relances');
  check(state.writes.length===0,'aucune écriture musicale lors des cycles de Live');await ctx.close();
 }
 {
  const {p,ctx,errors}=await setup({slowSuspend:true});
  for(let i=0;i<5;i++){
   await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByRole('button',{name:'Terminer',exact:true}).click();
   await open(p);check(await p.evaluate(()=>window.__streams.filter(s=>s.active).length===1),`interruption du démarrage ${i+1} : une seule piste active après reprise`);
   await p.getByRole('button',{name:'Terminer',exact:true}).click();
  }
  await p.waitForFunction(()=>window.__audioContext.state==='suspended');
  check(await p.evaluate(()=>window.__streams.every(s=>!s.active))&&errors.length===0,'arrêts rapides : pas de fuite audio ni rejet non géré');await ctx.close();
 }
 {
  const {p,ctx,errors}=await setup({hold:true});await p.getByRole('button',{name:'Live',exact:true}).click();await p.waitForFunction(()=>window.__micRequests===1);await p.evaluate(()=>window.__oldGrant=window.__grantMicrophone);
  await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.getByRole('button',{name:'Live',exact:true}).click();await p.waitForFunction(()=>window.__micRequests===2);
  await p.evaluate(()=>window.__oldGrant());await p.waitForFunction(()=>window.__streams[0].getTracks().every(t=>t.readyState==='ended'));
  await p.evaluate(()=>window.__grantMicrophone());await p.getByText('Signal micro reçu',{exact:true}).waitFor();await p.getByText(/Micro ouvert ·/).first().waitFor();
  check(await p.evaluate(()=>window.__streams.length===2&&window.__streams[0].active===false&&window.__streams[1].active===true),'permission de l’ancien Live résolue tard : ne stoppe pas le nouveau Live');
  await p.getByRole('button',{name:'Terminer',exact:true}).click();check(errors.length===0,'aucun callback tardif ne corrompt la nouvelle session');await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup({captureMode:'first-source-blocked'});await open(p);
  check(await p.evaluate(()=>window.__micRequests===2&&window.__streams[0].active===false&&window.__streams[1].active===true),'route initiale muette : un réarmement borné réacquiert une nouvelle piste et retrouve les PCM');
  check(state.received.some(m=>m.realtimeInput?.audio)&&errors.length===0,'réarmement réussi : signal envoyé sans erreur ni mutation musicale');
  await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.waitForFunction(()=>window.__streams.every(s=>!s.active));await ctx.close();
 }
 console.log(`\n${checks} contrôles de relance Live réussis (route mobile et API simulées).`);
}finally{await browser.close();}
