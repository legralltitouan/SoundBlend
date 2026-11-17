/* Essai facultatif avec une instance Piped réelle, sans compte Google.
   Les exclusions sont créées puis retirées dans un profil temporaire. Une
   panne, un changement de catalogue ou une restriction réseau peut faire
   échouer ce test sans prouver un défaut de l'interface. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => { localStorage.setItem('soundblend_onboarded', '1'); });
const p = await context.newPage(); const errors = []; const responses = [];
p.on('pageerror', e => errors.push(e.message));
p.on('response', r => { if (/pipedapi\.|api\.piped\./.test(r.url())) responses.push({ status: r.status(), url: r.url() }); });
try {
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
  await p.getByRole('button', { name: 'Ajouter une exclusion' }).click();
  const search = p.getByRole('searchbox', { name: 'Rechercher dans les exclusions et le catalogue' });
  await search.fill('Daft Punk One More Time');
  await p.getByRole('button', { name: 'Exclure One More Time de Daft Punk' }).click({ timeout: 20000 });
  assert.ok(await p.getByRole('button', { name: 'One More Time déjà exclue' }).isDisabled());
  await p.getByRole('tab', { name: /Artistes/ }).click();
  await search.fill('Daft Punk');
  await p.getByRole('button', { name: 'Exclure Daft Punk', exact: true }).click({ timeout: 20000 });
  let records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
  assert.ok(records.some(r => r.kind === 'track' && r.title === 'One More Time' && !r.deleted));
  assert.ok(records.some(r => r.kind === 'artist' && r.artist === 'Daft Punk' && !r.deleted));
  assert.ok(responses.some(r => r.status === 200 && r.url.includes('filter=music_songs')));
  assert.ok(responses.some(r => r.status === 200 && r.url.includes('filter=music_artists')));
  await search.fill('');
  await p.getByRole('button', { name: 'Débloquer Daft Punk' }).click();
  await p.getByRole('tab', { name: /Musiques/ }).click();
  await p.getByRole('button', { name: 'Débloquer One More Time' }).click();
  records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
  assert.ok(records.some(r => r.kind === 'track' && r.deleted) && records.some(r => r.kind === 'artist' && r.deleted));
  assert.deepEqual(errors, []);
  console.log('Recherche réelle : musique et artiste reçus via Piped ; ajout et retrait indépendants vérifiés dans un profil temporaire.');
} finally { await browser.close(); }
