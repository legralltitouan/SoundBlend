/* Studio Live — adapté de 6.9.35 : vrai graphe audio Chromium + microphone factice,
   WebSocket/API simulés. Ne teste pas une clé ni le service Google réels. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,DELETE,OPTIONS', 'access-control-allow-headers': '*' };
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; console.log(`  ✓ ${label}`); };
const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Attente du scénario vocal dépassée'); };
async function setup(options = {}) {
  const state = { received: [], sockets: [], writes: [], wiki: [], modelHeaders: [], ...options.state };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(({ auth, deny, key }) => {
    localStorage.setItem('soundblend_onboarded', '1');
    const prefix = auth ? 'soundblend_account_v1:voice-account:' : '';
    localStorage.setItem(prefix + 'soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: key }));
    if (auth) sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'fake', owner: 'voice-account', expiresAt: Date.now() + 3600000, profile: { name: 'Test vocal', email: '', avatarUrl: '' } }));
    const native = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (native) navigator.mediaDevices.getUserMedia = async (...args) => {
      window.__micRequests = (window.__micRequests || 0) + 1;
      if (deny) throw new DOMException('Permission denied', 'NotAllowedError');
      const stream = await native(...args); window.__voiceStream = stream; return stream;
    };
    const WS = window.WebSocket;
    window.WebSocket = class extends WS { constructor(...args) { super(...args); window.__voiceSocket = this; } };
    if (window.AudioBufferSourceNode) {
      const oldStart = AudioBufferSourceNode.prototype.start, oldStop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function(...args) { if(this.buffer?.length>1) window.__voicePlays = (window.__voicePlays || 0) + 1; return oldStart.apply(this, args); };
      AudioBufferSourceNode.prototype.stop = function(...args) { if(this.buffer?.length>1) window.__voiceStops = (window.__voiceStops || 0) + 1; return oldStop.apply(this, args); };
    }
  }, { auth: options.auth !== false, deny: !!options.deny, key: options.key === undefined ? 'test-key' : options.key });
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
  const p = await ctx.newPage(), errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell'); await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
  await p.locator('.sa-welcome').waitFor();
  return { p, ctx, state, errors };
}
const start = async (p) => { await p.getByRole('button', { name: 'Live', exact:true }).click(); await p.getByText(/Micro ouvert ·/).first().waitFor({ timeout: 20000 }); };
try {
  {
    const { p, ctx, state, errors } = await setup();
    check(!(await p.evaluate(() => window.__micRequests)), 'aucun microphone ouvert avant le clic');
    await start(p);
    await until(() => state.received.some((x) => x.realtimeInput?.audio), 15000);
    const setupMsg = state.received.find((x) => x.setup)?.setup, audio = state.received.find((x) => x.realtimeInput?.audio).realtimeInput.audio;
    check(setupMsg.model === 'models/gemini-3.1-flash-live-preview' && setupMsg.generationConfig.responseModalities.includes('AUDIO'), 'modèle vocal annoncé par Google choisi pour une session audio bidirectionnelle');
    check(audio.mimeType === 'audio/pcm;rate=16000' && Buffer.from(audio.data, 'base64').length === 3200, 'microphone réel du navigateur factice encodé en blocs PCM16 mono 16 kHz');
    check(state.modelHeaders.some((h) => h['x-goog-api-key'] === 'test-key') && state.sockets[0].url().includes('key=test-key'), 'clé personnelle utilisée directement, sans serveur ajouté');
    const names = setupMsg.tools.flatMap((t) => (t.functionDeclarations || []).map((f) => f.name));
    check(names.includes('proposer_action_musicale') && !names.some((x) => /modifier|supprimer|executer|delete/i.test(x)) && !names.includes('rechercher_wikipedia'), 'outils vocaux limités à la proposition et aux recherches autorisées');
    check(setupMsg.systemInstruction.parts[0].text.includes('conversation'), 'contexte texte disponible en Live');
    await p.getByRole('button', {name:'Confidentialité de l’assistant'}).click();
    await p.keyboard.press('Escape');
    check(await p.locator('.sa-live').isVisible() && !(await p.getByRole('dialog').count()), 'Échap ferme uniquement la confidentialité pendant le Live');
    const ws = state.sockets[0];
    ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Bonjour SoundBlend.', finished: true }, outputTranscription: { text: 'Bonjour, parlons musique.', finished: true }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(24000 * 2 * 3).toString('base64') } }] } } }));
    await p.getByText('Bonjour SoundBlend.', {exact:true}).waitFor({state:'attached'}); await p.getByText('Bonjour, parlons musique.', {exact:true}).waitFor({state:'attached'});
    await until(() => p.evaluate(() => (window.__voicePlays || 0) > 0));
    check(await p.getByText('Bonjour SoundBlend.', {exact:true}).count() === 1 && await p.getByText('Bonjour, parlons musique.', {exact:true}).count() === 1, 'transcriptions entrante et sortante traitées dans le même message');
    check(await p.evaluate(() => window.__voicePlays > 0), 'réponse PCM 24 kHz envoyée à la sortie audio du navigateur');
    await p.screenshot({path:new URL('./assistant-studio/live-actif.png', import.meta.url).pathname});
    ws.send(JSON.stringify({ serverContent: { interrupted: true, turnComplete: true } }));
    await until(() => p.evaluate(() => (window.__voiceStops || 0) > 0));
    check(await p.evaluate(() => window.__voiceStops > 0), 'interruption vocale vide la file de lecture audio');
    await p.getByRole('button', { name: 'Couper le microphone' }).click();
    await until(() => state.received.some((x) => x.realtimeInput?.audioStreamEnd));
    await p.waitForTimeout(300); const countMuted = state.received.filter((x) => x.realtimeInput?.audio).length;
    await p.waitForTimeout(450);
    check(state.received.filter((x) => x.realtimeInput?.audio).length === countMuted && await p.evaluate(() => window.__voiceStream.getAudioTracks()[0].enabled === false), 'micro coupé : fin de flux signalée et aucun paquet audio supplémentaire');
    await p.getByRole('button', { name: 'Rouvrir le microphone' }).click();
    await until(() => state.received.filter((x) => x.realtimeInput?.audio).length > countMuted);
    check(await p.evaluate(() => window.__voiceStream.getAudioTracks()[0].enabled === true), 'micro rouvert et flux repris par bouton');
    ws.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'proposal-1', name: 'proposer_action_musicale', args: { demande: 'Prépare un blend plus jazz avec Vocal Chill.' } }] } }));
    await p.locator('[aria-label="Proposition de blend"]').waitFor({ state:'attached', timeout: 20000 });
    await until(() => state.received.some((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'proposal-1')));
    check(state.writes.length === 0 && await p.locator('.sa-live-proposal').isVisible(), 'demande vocale crée seulement un aperçu, sans génération ni écriture YouTube');
    check(state.received.some((x) => x.toolResponse?.functionResponses?.some((f) => f.response?.statut === 'aperçu préparé')), 'le modèle vocal reçoit une réponse d’outil honnête et non une fausse exécution');
    const responsesBefore = state.received.filter((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'proposal-1')).length;
    ws.send(JSON.stringify({ toolCall: { functionCalls: [{ id:'proposal-1', name:'proposer_action_musicale', args:{demande:'Copie accidentelle'} }] } }));
    await p.waitForTimeout(250);
    check(state.received.filter((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'proposal-1')).length === responsesBefore, 'appel d’outil retransmis dédoublonné');
    ws.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'wiki-disabled', name: 'rechercher_wikipedia', args: { requete: 'Daft Punk' } }] } }));
    await until(() => state.received.some((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'wiki-disabled')));
    check(state.wiki.length === 0 && state.received.some((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'wiki-disabled' && f.response.error)), 'recherche non activée refusée même si un outil est fabriqué');
    ws.send(JSON.stringify({ toolCall: { functionCalls: [{ id: 'web-disabled', name: 'rechercher_web', args: { requete: 'Actualité' } }] } }));
    await until(() => state.received.some((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'web-disabled')));
    check(state.received.some((x) => x.toolResponse?.functionResponses?.some((f) => f.id === 'web-disabled' && f.response.error)) && await p.locator('.sb-google-result').count() === 0, 'recherche Web payante refusée si non activée, même avec un outil fabriqué');
    await p.getByRole('button', { name: 'Terminer', exact: true }).click();
    await until(async () => state.socketClosed && await p.evaluate(() => window.__voiceStream?.getAudioTracks()[0]?.readyState === 'ended'));
    check(state.socketClosed && await p.evaluate(() => window.__voiceStream.getAudioTracks()[0].readyState === 'ended'), 'arrêt ferme le micro et la connexion');
    check(errors.length === 0, `aucune exception JavaScript (${errors.join('; ')})`); await ctx.close();
  }
  {
    const { p, ctx } = await setup({ deny: true }); await p.getByRole('button', { name: 'Live', exact:true }).click();
    check(/microphone refusé/i.test(await p.getByRole('alert').innerText({ timeout: 10000 })), 'refus de permission micro expliqué clairement'); await ctx.close();
  }
  {
    const { p, ctx } = await setup({ key: '' }); await p.getByRole('button', { name: 'Live', exact:true }).click();
    check(/clé Gemini/i.test(await p.getByRole('alert').innerText({ timeout: 10000 })) && !(await p.evaluate(() => window.__micRequests)), 'clé absente signalée sans ouvrir le micro'); await ctx.close();
  }
  {
    const { p, ctx, state } = await setup({ noLiveModel: true }); await p.getByRole('button', { name: 'Live', exact:true }).click();
    check(/Aucun modèle Gemini Live/i.test(await p.getByRole('alert').innerText({ timeout: 15000 })), 'absence de modèle Live annoncée sans inventer de modèle');
    check(await p.evaluate(() => window.__voiceStream.getAudioTracks()[0].readyState === 'ended') && state.sockets.length === 0, 'micro fermé si aucun modèle vocal disponible'); await ctx.close();
  }
  {
    const { p, ctx, state } = await setup(); await start(p);
    state.sockets[0].send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Phrase privée du compte A.', finished: true } } }));
    await p.getByText('Phrase privée du compte A.', {exact:true}).waitFor({state:'attached'});
    await p.locator('#sb-assistant-input').evaluate(e => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(e,'Texte privé non envoyé'); e.dispatchEvent(new Event('input', {bubbles:true})); });
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('sb:auth-changing')));
    await until(() => p.evaluate(() => window.__voiceStream.getAudioTracks()[0].readyState === 'ended'));
    check(await p.locator('.sa-live').count() === 0, 'changement de session ferme immédiatement le vocal');
    check(await p.getByText('Phrase privée du compte A.').count() === 0 && !(await p.locator('#sb-assistant-input').inputValue()), 'transcription et saisie effacées avant changement de compte'); await ctx.close();
  }
  {
    const { p, ctx, state } = await setup({ noLiveModel: true, extendedOnly: true }); await p.getByRole('button', { name: 'Live', exact:true }).click();
    check(/Aucun modèle Gemini Live compatible/i.test(await p.getByRole('alert').innerText({ timeout: 15000 })) && state.sockets.length === 0, 'modèle Live extended-thinking non compatible avec les outils synchrones écarté honnêtement'); await ctx.close();
  }
  console.log(`\n${checks}/${checks} contrôles vocaux réussis (audio Chromium factice, services simulés).`);
} finally { await browser.close(); }
