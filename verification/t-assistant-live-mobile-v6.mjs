/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
await mkdir(new URL('./assistant-mentions-v6/',import.meta.url),{recursive:true});
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
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const _start = async (p) => { await p.getByRole('button', { name: 'Live', exact:true }).click(); await p.getByText(/Micro ouvert ·/).first().waitFor({ timeout: 20000 }); };
const open = async p => {await p.getByRole('button',{name:'Live',exact:true}).click();await p.waitForFunction(()=>window.__micRequests===1);};
const visibility = async(p,value) => p.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));},value);
try {
 // Chrome Android simulé : le panneau de permission peut masquer la page.
 {
  const {p,ctx,state,errors}=await setup({hold:true});await open(p);
  check(await p.evaluate(()=>window.__micGesture===true),'getUserMedia invoqué pendant le geste utilisateur, avant réseau/await');
  await visibility(p,'hidden');await p.waitForTimeout(150);
  check(await p.locator('.sa-live').isVisible()&&state.modelHeaders.length===0,'permission en attente : visibilité transitoire ne détruit pas la session et aucun appel Gemini');
  await visibility(p,'visible');await p.evaluate(()=>window.__grantMicrophone());await p.getByText(/Micro ouvert ·/).first().waitFor({timeout:20000});
  await until(()=>state.received.some(m=>m.realtimeInput?.audio));
  check(await p.evaluate(()=>window.__voiceStream.getAudioTracks()[0].readyState==='live'),'permission différée accordée : flux audio réellement actif');
  await visibility(p,'hidden');await p.waitForFunction(()=>window.__voiceStream.getAudioTracks()[0].readyState==='ended');
  check(await p.locator('.sa-live').count()===0,'une session active est toujours coupée au vrai passage en arrière-plan');
  check(errors.length===0,'aucune exception dans la reprise après permission système');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({hold:true});await open(p);await visibility(p,'hidden');await p.evaluate(()=>window.__grantMicrophone());await p.waitForTimeout(150);
  check(state.modelHeaders.length===0&&state.sockets.length===0,'permission résolue avant retour visible : pas de Gemini ni de sortie audio cachée');
  await visibility(p,'visible');await p.getByText(/Micro ouvert ·/).first().waitFor({timeout:20000});check(state.sockets.length===1,'retour visible après permission reprend normalement');await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup({hold:true});await open(p);await p.getByRole('button',{name:'Terminer',exact:true}).click();await p.evaluate(()=>window.__grantMicrophone());
  await p.waitForFunction(()=>window.__voiceStream?.getAudioTracks()[0].readyState==='ended');
  check(state.modelHeaders.length===0&&state.sockets.length===0,'annulation avant permission : tout flux acquis tardivement est immédiatement libéré');
  check(errors.length===0,'pas de rejet non géré après annulation d’une demande de permission');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({hold:true});await open(p);await visibility(p,'hidden');await p.evaluate(()=>window.__grantMicrophone());
  await p.getByRole('alert').waitFor({timeout:8000});
  check((await p.getByRole('alert').innerText()).includes('Reviens sur SoundBlend')&&await p.evaluate(()=>window.__voiceStream.getAudioTracks()[0].readyState==='ended')&&state.modelHeaders.length===0,'absence de retour visible : délai borné, micro fermé, aucun envoi Gemini');await ctx.close();
 }
 {
  const {p,ctx}=await setup();await p.evaluate(()=>Object.defineProperty(document,'permissionsPolicy',{configurable:true,value:{allowsFeature:()=>false}}));
  await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByRole('alert').waitFor();
  check((await p.getByRole('alert').innerText()).includes('onglet Chrome normal')&&!(await p.evaluate(()=>window.__micRequests)),'aperçu bloqué par Permissions Policy : explication utile avant de demander le micro');await ctx.close();
 }
 {
  const {p,ctx}=await setup({deny:true});await open(p);await p.getByRole('alert').waitFor();
  check((await p.getByRole('alert').innerText()).includes('Android')&&(await p.getByRole('alert').innerText()).includes('Chrome'),'refus micro : instructions pour le site et les autorisations Android');await ctx.close();
 }
 {
  const {p,ctx}=await setup({key:''});await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByRole('alert').waitFor();
  check((await p.getByRole('alert').innerText()).includes('clé Gemini')&&!(await p.evaluate(()=>window.__micRequests)),'clé absente sur cet appareil : diagnostic sans fausse demande de permission');
  await p.locator('.sa-live-help summary').click();check(await p.getByText(/réglages du PC ne sont pas automatiquement/).isVisible(),'aide mobile précise les réglages propres à chaque appareil');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({hold:true});await p.clock.install();await open(p);await p.clock.fastForward(36000);await p.getByRole('alert').waitFor();
  check((await p.getByRole('alert').innerText()).includes('autorisation Microphone'),'permission sans réponse : timeout indique le problème micro, pas une panne Gemini');
  await p.evaluate(()=>window.__grantMicrophone());await p.waitForFunction(()=>window.__voiceStream.getAudioTracks()[0].readyState==='ended');
  check(state.modelHeaders.length===0,'permission accordée après timeout : micro fermé sans réseau');await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({noSetup:true});await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByText('Signal micro reçu',{exact:true}).waitFor();
  check(await p.locator('.sa-orb--live').evaluate(e=>parseFloat(e.style.getPropertyValue('--voice-level'))>0)&&!state.received.some(m=>m.realtimeInput?.audio),'vumètre local opérationnel AVANT Gemini, sans envoi ni file d’audio avant connexion');
  check(await p.getByText(/Micro ouvert ·/).count()===0,'pas de statut connecté tant que Gemini n’a pas répondu');
  check(await p.locator('.sa-orb--live').evaluate(e=>getComputedStyle(e).animationName==='sa-orb-unfold'),'animation d’agrandissement présente sur l’orbe Live');
  await p.emulateMedia({reducedMotion:'reduce'});
  check(await p.locator('.sa-orb--live').evaluate(e=>getComputedStyle(e).animationName==='none'),'animation d’entrée supprimée si réduction des mouvements demandée');
  await p.getByRole('button',{name:'Terminer',exact:true}).click();await ctx.close();
 }
 // Les permissions sont accordées dans ces cas : on vérifie des PCM NON NULS,
 // pas simplement l'ouverture d'une piste ou l'étiquette de l'interface.
 for(const mode of ['normal','blocked','no-worklet','module-error','module-hang']){
  const {p,ctx,state,errors}=await setup({captureMode:mode==='normal'?undefined:mode});
  await p.getByRole('button',{name:'Live',exact:true}).click();
  await p.getByText(/Micro ouvert ·/).first().waitFor({timeout:18000});
  await until(()=>state.received.some(m=>m.realtimeInput?.audio&&Buffer.from(m.realtimeInput.audio.data,'base64').some(x=>x!==0)));
  check(state.received.some(m=>m.realtimeInput?.audio&&Buffer.from(m.realtimeInput.audio.data,'base64').length===3200),`capture ${mode} : blocs PCM16 de 100 ms, 16 kHz, transmis sans second clic`);
  await p.getByText('Signal micro reçu',{exact:true}).waitFor();
  check(await p.locator('.sa-orb--live').evaluate(e=>parseFloat(e.style.getPropertyValue('--voice-level'))>0),`capture ${mode} : l'orbe reçoit un niveau mesuré non nul`);
  await p.locator('.sa-live-help summary').click();
  check((await p.locator('.sa-capture-diagnostic').textContent()).includes(mode==='normal'?'AudioWorklet':'Compatibilité'),`capture ${mode} : chemin audio réellement actif indiqué`);
  check(await p.getByRole('button',{name:'Démarrer le vocal'}).count()===0&&await p.evaluate(()=>window.__micRequests===1&&window.__micGesture===true),'démarrage direct, une seule acquisition, activation utilisateur conservée');
  if(mode==='normal'){
   await p.locator('.sa-live-help summary').click();
   await p.screenshot({path:new URL('./assistant-mentions-v6/live-signal-mobile.png',import.meta.url).pathname});
   const count=state.received.filter(m=>m.realtimeInput?.audio).length;
   await p.evaluate(()=>window.__audioContext.suspend());
   await until(()=>state.received.filter(m=>m.realtimeInput?.audio).length>count+5,10000);
   check(await p.evaluate(()=>window.__audioContext.state==='running'&&window.__resumeCalls>1),'un contexte audio suspendu après acquisition est repris et émet de nouveau');
  }
  await p.getByRole('button',{name:'Terminer',exact:true}).click();
  await p.waitForFunction(()=>window.__audioContext.state==='suspended');
  check(await p.evaluate(()=>window.__voiceStream.getTracks().every(t=>t.readyState==='ended')&&window.__audioContext.state==='suspended'),`capture ${mode} : arrêt libère le micro et suspend le contexte`);
  check(errors.length===0,`capture ${mode} : aucun rejet ni erreur JavaScript`);await ctx.close();
 }
 {
  const {p,ctx,state}=await setup({captureMode:'runtime'});await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByText(/Micro ouvert ·/).first().waitFor();
  await p.evaluate(()=>window.__dropWorklet=true);await p.locator('.sa-live-help summary').click();
  await until(async()=> (await p.locator('.sa-capture-diagnostic').textContent()).includes('Compatibilité'),12000);
  check(state.received.some(m=>m.realtimeInput?.audio),'Worklet qui cesse de répondre en cours de session : bascule de secours sans quitter Live');
  await p.getByText('Signal micro reçu',{exact:true}).waitFor();await ctx.close();
 }
 {
  const {p,ctx}=await setup({captureMode:'zero'});await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByText(/Micro ouvert ·/).first().waitFor();await p.locator('.sa-live-help summary').click();
  await until(async()=> (await p.locator('.sa-capture-diagnostic').textContent()).includes('Compatibilité'),14000);
  await p.getByText('Signal micro reçu',{exact:true}).waitFor();
  check(await p.locator('.sa-orb--live').evaluate(e=>parseFloat(e.style.getPropertyValue('--voice-level'))>0),'Worklet qui ne renvoie que des zéros : secours rétablit un signal non nul');await ctx.close();
 }
 {
  const {p,ctx,state,errors}=await setup({captureMode:'blocked-all'});await p.getByRole('button',{name:'Live',exact:true}).click();await p.getByRole('alert').waitFor({timeout:12000});
  check((await p.getByRole('alert').innerText()).includes('aucun échantillon')&&state.modelHeaders.length===0,'deux chemins sans échantillons : erreur explicite, jamais un faux statut Micro ouvert');
  await p.waitForFunction(()=>window.__audioContext.state==='suspended');
  check(await p.evaluate(()=>window.__voiceStream.getTracks().every(t=>t.readyState==='ended')),'capture impossible : aucune piste conservée après erreur');
  check(errors.length===0,'capture impossible : aucun rejet non géré');await ctx.close();
 }
 console.log(`\n${checks} contrôles de démarrage mobile réussis (Chromium émulé, API et permissions simulées).`);
} finally { await browser.close(); }
