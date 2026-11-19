/* Studio Assistant : tests UI et services simulés. Aucune clé ni écriture réelle. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const shots = new URL('./assistant-studio/', import.meta.url).pathname;
await mkdir(shots, { recursive: true });
let checks = 0;
const check = (ok, text) => { assert.ok(ok, text); checks++; console.log(`✓ ${text}`); };
const contexts = [];
async function setup(width = 390, height = 844, mode = 'light', key = 'test-key') {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' }); contexts.push(ctx);
  await ctx.addInitScript(({ mode, key }) => {
    localStorage.setItem('soundblend_onboarded', '1'); localStorage.setItem('soundblend_mode', mode);
    localStorage.setItem('soundblend_settings', JSON.stringify({ geminiApiKey: key }));
  }, { mode, key });
  await ctx.route(/^https:\/\//, (r) => r.abort());
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(base); await p.waitForSelector('.ytm-shell');
  await p.locator(`${width < 820 ? '.ytm-mobile-bar' : '.ytm-rail'} [aria-label="Assistant"]`).click();
  await p.waitForSelector('.sa-welcome');
  return { ctx, p, errors };
}
try {
  const { p, errors } = await setup();
  await p.screenshot({ path: shots + 'accueil-mobile.png', fullPage: true });
  check(await p.getByRole('heading', { name: 'Et si on trouvait ton prochain son ?' }).isVisible(), 'accueil inspiré du concept');
  check(await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').getAttribute('data-active') === 'true', 'navbar actuelle conservée');
  check(await p.getByRole('button', { name: 'Envoyer à l’assistant' }).isDisabled(), 'envoi vide désactivé');
  await p.getByRole('button', { name: 'Du jazz, mais à ma façon' }).click();
  check((await p.locator('#sb-assistant-input').inputValue()).includes('jazz'), 'inspiration préremplit la demande sans requête');
  check(await p.locator('#sb-assistant-input').evaluate(e => document.activeElement === e), 'inspiration donne le focus au champ');
  check(await p.locator('.sa-options').isHidden(), 'options repliées');
  await p.getByRole('button', { name: 'Options et contexte' }).click();
  check(await p.getByLabel('Chercher des sources sur Wikipédia').isVisible(), 'recherches conservées dans les options');
  await p.getByLabel('Chercher des sources sur Wikipédia').check();
  await p.getByLabel('Recherche Web Google (quota / coût)').check();
  check(!await p.getByLabel('Chercher des sources sur Wikipédia').isChecked(), 'recherches mutuellement exclusives');
  await p.getByRole('button', { name: 'Options et contexte' }).click();
  await p.getByRole('button', { name: 'Live', exact: true }).click();
  check(await p.getByRole('heading', { name: 'On suit ton envie.' }).isVisible(), 'Live dans une vue dédiée');
  check(await p.getByRole('button', { name: 'Démarrer le vocal' }).isVisible(), 'consentement avant tout accès au micro');
  check(await p.locator('.ytm-mobile-bar').isVisible(), 'navbar conservée dans le Live');
  await p.screenshot({ path: shots + 'live-mobile.png', fullPage: true });
  await p.keyboard.press('Escape');
  check(await p.locator('#sb-assistant-input').evaluate(e => document.activeElement === e), 'Échap quitte le Live et restaure le focus');
  check((await p.locator('#sb-assistant-input').inputValue()).includes('jazz'), 'brouillon conservé au retour du Live');

  // Importer les services depuis Vite utilise les mêmes instances que l'app.
  const result = await p.evaluate(async () => {
    const { blendInstruction, mergeLiveTranscript, uniqueAssistantTracks } = await import('/src/services/assistantConversation.ts');
    const req = [...Array(20)].map((_, i) => `demande ${i} ${'x'.repeat(600)}`); req.push('Dernière correction : moins énergique');
    const instruction = blendInstruction('Jazz doux', req);
    const tracks = uniqueAssistantTracks([{videoId:'1'}, {videoId:'1'}, {videoId:'2'}, {videoId:''}], t => t.videoId === '2');
    return { instruction, tracks, cumulative: mergeLiveTranscript('Bonjour', 'Bonjour toi'), delta: mergeLiveTranscript('Bon', 'jour'), duplicate: mergeLiveTranscript('Salut', 'Salut'), overlap: mergeLiveTranscript('Un peu de jazz', 'jazz doux') };
  });
  check(result.instruction.length <= 6000 && result.instruction.includes('Dernière correction : moins énergique'), 'dernière correction conservée même après un long échange');
  check(result.tracks.length === 1, 'amorces dédoublonnées et exclusions filtrées');
  check(result.cumulative === 'Bonjour toi' && result.delta === 'Bonjour' && result.duplicate === 'Salut' && result.overlap === 'Un peu de jazz doux', 'transcriptions cumulées, deltas, doublons et recouvrements');

  const prompts = [];
  let fail = false, slow = false, release;
  await p.route('https://generativelanguage.googleapis.com/**', async r => {
    const headers = {'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*'};
    if (r.request().method() === 'OPTIONS') return r.fulfill({ headers, body: '' });
    if (r.request().url().includes('/models?')) return r.fulfill({headers, body: JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })});
    const prompt = r.request().postDataJSON()?.contents?.[0]?.parts?.[0]?.text || ''; prompts.push(prompt);
    if (slow) await new Promise(resolve => { release = resolve; });
    if (fail) return r.fulfill({ status: 403, headers, body: JSON.stringify({error:{message:'Test denied'}}) }).catch(()=>{});
    const answer = { reply: 'Une base soul, du jazz feutré et quelques découvertes. Voilà une première direction.', title: 'Jazz, à ta façon', action: 'blend', source: { type: 'playlist', id: 'demo-pl-french-touch' }, extraSources: [], instruction: 'Du jazz doux, une base soul et des découvertes.', durationMinutes: 45, catalogQueries: [], catalogVideoIds: [], followUps: ['Plus de saxophone', 'Plus jazzy', 'Autre chose'] };
    return r.fulfill({headers, body: JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]})}).catch(()=>{});
  });
  // Désactiver les recherches pour tester la proposition seule.
  await p.getByRole('button', { name: 'Options et contexte' }).click();
  await p.getByLabel('Recherche Web Google (quota / coût)').uncheck();
  await p.getByRole('button', { name: 'Options et contexte' }).click();
  await p.getByRole('button', { name: 'Envoyer à l’assistant' }).click();
  await p.getByRole('region', {name:'Proposition de blend', exact:true}).waitFor();
  check(await p.getByRole('heading', { name: 'Jazz, à ta façon' }).isVisible(), 'titre musical du blend affiché');
  check(await p.getByText('Ces titres inspirent le blend : ce n’est pas la sélection finale.').isVisible(), 'aperçu honnête : amorces et non fausse sélection finale');
  check(await p.locator('.sa-track-preview li').count() === 3, 'trois vrais titres de source affichés');
  check((await p.locator('.sa-track-preview').innerText()).includes('Midnight City'), 'morceaux issus de la bibliothèque, pas inventés');
  await p.waitForTimeout(400);
  check(await p.getByRole('button', {name:'Générer et ajouter à mes blends'}).evaluate(button => {
    const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.top >= 0 && r.bottom <= innerHeight && (hit === button || button.contains(hit));
  }), 'confirmation du blend non masquée par le composeur après la réponse');
  await p.screenshot({path: shots + 'conversation-mobile-vue.png'});
  await p.screenshot({path: shots + 'conversation-mobile.png', fullPage:true});
  check(prompts.length === 1, 'aucune génération déclenchée par la conversation');
  await p.getByRole('button', {name:'Plus de saxophone', exact:true}).click();
  await p.waitForFunction(() => document.querySelectorAll('.sb-chat-message--assistant').length === 2);
  check(prompts[1].includes('propositionEnCours') && prompts[1].includes('Jazz, à ta façon'), 'relance reçoit le contexte de la proposition courante');
  await p.locator('.sa-adjust > summary').click();
  check((await p.getByLabel('Consigne transmise à Gemini', {exact:true}).inputValue()).includes('Plus de saxophone'), 'ajustement gardé dans la consigne');
  fail = true;
  await p.locator('#sb-assistant-input').fill('Encore plus doux'); await p.locator('#sb-assistant-input').press('Enter');
  await p.getByRole('alert').waitFor();
  check(await p.getByRole('region', {name:'Proposition de blend', exact:true}).isVisible(), 'proposition précédente non détruite par une erreur API');
  fail = false; slow = true;
  await p.locator('#sb-assistant-input').fill('Réponse lente'); await p.locator('#sb-assistant-input').press('Enter');
  await p.getByRole('button', {name:'Arrêter la réponse'}).click();
  check(await p.getByText('Réponse interrompue. Tu peux reformuler ta demande.').isVisible(), 'annulation de réponse disponible');
  release?.(); slow = false;
  check(await p.getByRole('button', {name:'Envoyer à l’assistant'}).isDisabled(), 'champ vidé après envoi');
  await p.getByRole('button', {name:'Nouvelle conversation'}).click();
  check(await p.locator('.sa-welcome').isVisible() && await p.locator('.sa-blend-card').count() === 0, 'nouvelle conversation réinitialise le plan');
  check(errors.length === 0, `aucune erreur JS : ${errors.join(', ')}`);

  for (const [w,h,mode] of [[320,568,'light'],[390,844,'dark'],[768,1024,'light'],[1440,1000,'light'],[1440,1000,'dark']]) {
    const {p:q,errors:es} = await setup(w,h,mode);
    check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `pas de débordement horizontal ${w}×${h} ${mode}`);
    await q.screenshot({path:shots+`accueil-${w}-${mode}.png`,fullPage:true});
    await q.getByRole('button',{name:'Live',exact:true}).click();
    check(await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Live sans débordement ${w} ${mode}`);
    check(es.length === 0, `pas d’erreur JS ${w} ${mode}`);
  }
  console.log(`\n${checks} vérifications réussies. Captures : ${shots}`);
} finally { for (const ctx of contexts) await ctx.close(); await browser.close(); }
