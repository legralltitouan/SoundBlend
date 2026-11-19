/* Échec de génération : bilan lisible, pas de fausse feuille bloquée.
   Services simulés. Par défaut, moteur remplacé pour un échec immédiat sur
   les sources ; SOUNDBLEND_REAL_FAILURE=1 teste le vrai moteur sur le site. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const realFailure = process.env.SOUNDBLEND_REAL_FAILURE === '1';
const calls = { gemini: 0, youtube: 0 };
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PATCH,POST,OPTIONS', 'access-control-allow-headers': '*' };
await ctx.addInitScript(() => {
  localStorage.setItem('soundblend_onboarded', '1');
  sessionStorage.setItem('soundblend_google_session_v2', JSON.stringify({ token: 'FAUX', owner: 'ui-vide', expiresAt: Date.now() + 3600000, profile: { name: 'Test', email: '', avatarUrl: '' } }));
  if (!localStorage.getItem('soundblend_account_v1:ui-vide:soundblend_settings')) localStorage.setItem('soundblend_account_v1:ui-vide:soundblend_settings', JSON.stringify({ googleClientId: '', youtubeApiKey: '', geminiApiKey: 'test-key', _updatedAt: Date.now() }));
});
await ctx.route('**/*', (r) => r.request().url().startsWith(new URL(base).origin + '/') ? r.continue() : r.abort());
await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await ctx.route('https://generativelanguage.googleapis.com/**', (r) => {
  if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: '' });
  if (new URL(r.request().url()).pathname.endsWith('/models')) return r.fulfill({ status: 200, headers: cors, body: '{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"],"outputTokenLimit":8192}]}' });
  calls.gemini++; return r.fulfill({ status: 429, headers: cors, body: '{"error":{"message":"quota per day"}}' });
});
await ctx.route('https://www.youtube.com/oembed**', (r) => { calls.youtube++; return r.fulfill({ status: 404, headers: cors, body: '{}' }); });
await ctx.route(/pipedapi\.|api\.piped\./, (r) => r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' }));
await ctx.route('https://www.googleapis.com/youtube/v3/**', (r) => {
  const u = r.request().url();
  if (u.includes('/playlists?')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'PL1', snippet: { title: 'Sélection', thumbnails: {} }, contentDetails: { itemCount: 1 } }] }) });
  if (u.includes('/playlistItems?')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [{ id: 'it-1', snippet: { title: 'Seed 1', videoOwnerChannelTitle: 'Alpha - Topic', thumbnails: {} }, contentDetails: { videoId: 'P0000000001' } }] }) });
  return r.fulfill({ status: 200, headers: cors, body: '{"items":[]}' });
});
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
let n = 0; const check = (ok, label) => { assert.ok(ok, label); n++; console.log(`  ✓ ${label}`); };
try {
  await page.goto(base); await page.waitForSelector('.ytm-shell');
  await page.locator('.sb-tile--new').click();
  await page.getByRole('dialog', { name: 'Choisir des morceaux' }).waitFor();
  await page.locator('.pick-row').filter({ hasText: 'Seed 1' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('dialog', { name: 'Réglages du blend' }).waitFor();
  await page.getByRole('button', { name: '20 min', exact: true }).click();
  if (!realFailure) await page.evaluate(async () => {
    const { geminiService: g } = await import('/src/services/gemini.ts');
    let attempts = 0;
    g.generateBlend = async (seeds) => {
      attempts++;
      const counts = { anchor: 0, deepDive: 0, fresh: 0 };
      g.derniereMethode = 'voisinage'; g.dernierModele = ''; g.derniereNote = 'Essai simulé';
      g.dernierRapport = { target: 6, requested: { anchor: 2, deepDive: 2, fresh: 2 }, before: counts,
        created: attempts === 1 ? counts : { ...counts, anchor: 1 }, added: { anchor: 0, fresh: 0, neighbour: 0 },
        warning: attempts === 1 ? 'Limite Gemini constatée (429). Blend incomplet : 0/6 titres.' : 'Blend incomplet : 1/6 titres.', cause: attempts === 1 ? 'quota' : 'other' };
      return attempts === 1 ? [] : [{ ...seeds[0], category: 'anchor' }];
    };
  });
  await page.getByRole('button', { name: 'Générer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Réglages du blend' });
  await dialog.waitFor();
  let alert = await dialog.getByRole('alert').innerText();
  check(alert.includes('Génération impossible') && alert.includes('429') && alert.includes('0/6'), 'l’échec sans aucun titre conserve le diagnostic Gemini et le total');
  await page.waitForTimeout(3500);
  check(await dialog.isVisible() && await dialog.getByRole('alert').isVisible(), 'l’erreur reste lisible au lieu de disparaître en quelques secondes');
  check(await page.getByRole('dialog', { name: /génération en cours/i }).count() === 0, 'une erreur immédiate ne rouvre pas la feuille de génération après coup');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('soundblend_account_v1:ui-vide:soundblend_recent_blends') || '[]').length === 0), 'aucun blend vide n’est enregistré');
  if (realFailure) {
    check(calls.gemini > 0 && calls.youtube > 0, 'le moteur compilé a bien rencontré un 429 Gemini et un refus YouTube simulés');
  } else {
    await dialog.getByRole('button', { name: 'Générer', exact: true }).click();
    await page.locator('.sb-blend-warning[role="status"]').waitFor();
    check((await page.locator('.sb-blend-warning[role="status"]').innerText()).includes('1/6'), 'une nouvelle tentative peut produire un résultat et son nouveau bilan');
  }
  check(errors.length === 0, `aucune exception JavaScript (${errors.join('; ')})`);
  console.log(`\n${n}/${n} contrôles de l’échec graphique réussis — services simulés.`);
} finally { await ctx.close(); await browser.close(); }
