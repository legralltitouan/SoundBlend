/* Exclusions : interface, catalogue Piped SIMULÉ, couches et clavier.
   Les réponses du catalogue et le lecteur sont fictifs. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = process.env.SOUNDBLEND_URL || process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const cors = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
const calls = [];
let recovered = false;
let count = 0;
const check = (value, name) => { assert.ok(value, name); count++; console.log('  ✓ ' + name); };
const track = (title, artist, id) => ({ type: 'stream', title, uploaderName: artist, url: `/watch?v=${id}`, duration: 240 });

async function context() {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await c.addInitScript(() => {
    localStorage.setItem('soundblend_onboarded', '1');
    localStorage.setItem('soundblend_mode', 'dark');
    const now = Date.now();
    const t = { id: 'SONG0000001', title: 'One More Time', artist: 'Daft Punk', videoId: 'SONG0000001', thumbnailUrl: '', durationSeconds: 240, category: 'fresh' };
    localStorage.setItem('soundblend_recent_blends', JSON.stringify([{ id: 'blend-test', title: 'Blend test', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), seedTracks: [], tracks: [t] }]));
    // L'iframe réelle est remplacée par un lecteur minimal, sans audio.
    window.YT = { Player: function (_el, opts) {
      let state = -1;
      this.loadVideoById = () => {};
      this.playVideo = () => { state = 1; };
      this.pauseVideo = () => { state = 2; };
      this.getPlayerState = () => state;
      this.getCurrentTime = () => 0;
      this.getDuration = () => 240;
      this.setVolume = () => {};
      this.mute = () => {};
      this.unMute = () => {};
      this.destroy = () => {};
      setTimeout(() => opts.events?.onReady?.({ target: this }), 20);
    } };
  });
  await c.route('https://www.youtube.com/iframe_api', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await c.route(/pipedapi\.|api\.piped\./, async r => {
    const u = new URL(r.request().url());
    if (u.pathname !== '/search') return r.abort();
    const q = u.searchParams.get('q'), filter = u.searchParams.get('filter');
    calls.push({ host: u.host, q, filter });
    if (q === 'panne' && !recovered || q === 'secours' && u.host.includes('ducks.party'))
      return r.fulfill({ status: 503, headers: cors, body: '{}' });
    if (q === 'malforme' || q === 'repli-json' && u.host.includes('ducks.party'))
      return r.fulfill({ status: 200, headers: cors, body: '{"message":"indisponible"}' });
    if (q === 'lent' || q === 'croise' && filter === 'music_songs') {
      await new Promise(resolve => setTimeout(resolve, 1600));
      try { await r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items: [track('Ancien résultat', 'Groupe lent', 'SLOW0000001')] }) }); } catch { /* la requête a été annulée */ }
      return;
    }
    let items = [];
    if (q === 'Daft Punk') items = filter === 'music_artists'
      ? [{ type: 'channel', name: 'Daft Punk', url: '/channel/UC-daft' }, track('Pas un artiste', 'Divers', 'WRNG0000001')]
      : [track('One More Time', 'Daft Punk', 'SONG0000001'), track('One More Time', 'Daft Punk', 'SONG0000001'), track('One More Time (Radio Edit)', 'Daft Punk', 'SONG0000003'), track('One More Time', 'Autre artiste', 'SONG0000004'), track('Around the World', 'Daft Punk', 'SONG0000002'), { type: 'channel', name: 'Pas une musique', url: '/channel/wrong' }];
    if (q === 'repli-json') items = [track('JSON réparé', 'Artiste réseau', 'BACK0000003')];
    if (q === 'secours') items = [track('Secours', 'Artiste réseau', 'BACK0000001')];
    if (q === 'panne' && recovered) items = [track('Panne réparée', 'Artiste réseau', 'BACK0000002')];
    if (q === 'rapide') items = [track('Nouveau résultat', 'Groupe rapide', 'FAST0000001')];
    if (q === 'croise' && filter === 'music_artists') items = [{ type: 'channel', name: 'Artiste croisé', url: '/channel/croise' }];
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ items }) });
  });
  await c.route(/https:\/\/(?:i\.ytimg\.com|piped-proxy\.|proxy\.piped\.|itunes\.apple\.com|is\d+-ssl\.mzstatic\.com)/, r => r.abort());
  return c;
}

const c = await context();
const p = await c.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.goto(base, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.ytm-shell');
await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
check(await p.locator('#exclusions button').count() === 2 && await p.locator('#exclusions input').count() === 0 && await p.locator('#exclusions .sb-exclusion-row').count() === 0, 'Réglages ne montre que les deux accès, sans liste ni formulaire');
await p.getByRole('button', { name: 'Ajouter une exclusion', exact: true }).click();
let dialog = p.getByRole('dialog', { name: 'Exclusions' });
const search = dialog.getByRole('searchbox', { name: 'Rechercher dans les exclusions et le catalogue' });
await dialog.waitFor();
check(await search.evaluate(el => document.activeElement === el) && await p.evaluate(() => document.body.style.overflow === 'hidden'), 'ajout ouvre la même feuille et place immédiatement le focus sur la recherche');
await p.keyboard.press('Tab');
check(await dialog.getByRole('button', { name: 'Fermer' }).evaluate(el => document.activeElement === el), 'Tab boucle à l’intérieur de la fenêtre');
await p.keyboard.press('Shift+Tab');
check(await search.evaluate(el => document.activeElement === el), 'Maj-Tab boucle aussi dans l’autre sens');
await p.keyboard.press('Escape');
await p.waitForFunction(() => !document.querySelector('.sb-action-layer[data-present="true"]'));
await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Ajouter une exclusion');
check(await p.evaluate(() => document.body.style.overflow === ''), 'Échap ferme, restaure le focus et libère le défilement');
await p.getByRole('button', { name: 'Afficher la liste des exclusions' }).click();
await dialog.waitFor();
check(await dialog.getByRole('tab', { name: /Musiques/ }).evaluate(el => document.activeElement === el), 'affichage de la liste ouvre la même fenêtre sur l’onglet Musiques');
await p.keyboard.press('ArrowRight');
check(await dialog.getByRole('tab', { name: /Artistes/ }).getAttribute('aria-selected') === 'true', 'onglets accessibles aux flèches du clavier');
await p.keyboard.press('ArrowLeft');
await search.fill('Daft Punk');
const addSong = dialog.getByRole('button', { name: 'Exclure One More Time de Daft Punk' });
await addSong.waitFor();
check(calls.some(x => x.q === 'Daft Punk' && x.filter === 'music_songs') && !(await dialog.getByText('Pas une musique').count()) && await addSong.count() === 1, 'filtre musical demandé, types étrangers et doublons de résultat ignorés');
await addSong.click();
let records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(records.some(x => x.kind === 'track' && x.title === 'One More Time' && !x.deleted) && !records.some(x => x.kind === 'artist' && !x.deleted), 'exclure une musique ne bannit pas son artiste');
const disabledSong = dialog.getByRole('button', { name: 'One More Time déjà exclue' });
check(await disabledSong.isDisabled() && await dialog.getByRole('button', { name: 'Débloquer One More Time' }).isVisible(), 'doublon reconnu sans masquer la musique du catalogue');
const variant = dialog.getByRole('button', { name: 'One More Time (Radio Edit) déjà exclue' });
check(await variant.isDisabled() && await dialog.getByRole('button', { name: 'Exclure One More Time de Autre artiste' }).isEnabled(), 'une variante parenthésée est rapprochée, mais le même titre d’un artiste différent reste disponible');
check(await dialog.getByText(/homonymes ou des variantes d’un titre/).isVisible(), 'la feuille avertit du rapprochement possible des variantes ou homonymes');
check(await disabledSong.evaluate(el => document.activeElement === el), 'le focus reste sur le résultat après ajout au clavier ou à la souris');
const oldUpdatedAt = records.find(x => x.kind === 'track').updatedAt;
await disabledSong.dispatchEvent('click');
records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(records.filter(x => x.kind === 'track').length === 1 && records.find(x => x.kind === 'track').updatedAt === oldUpdatedAt, 'même une activation forcée d’un doublon ne réécrit pas l’exclusion');
await dialog.getByRole('tab', { name: /Artistes/ }).click();
const addArtist = dialog.getByRole('button', { name: 'Exclure Daft Punk', exact: true });
await addArtist.waitFor();
check(calls.some(x => x.q === 'Daft Punk' && x.filter === 'music_artists') && !(await dialog.getByText('Pas un artiste').count()), 'recherche des artistes via le filtre dédié, pas les chaînes ordinaires');
await addArtist.click();
records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(records.some(x => x.kind === 'artist' && x.artist === 'Daft Punk' && !x.deleted) && records.some(x => x.kind === 'track' && !x.deleted) && await dialog.getByRole('button', { name: 'Daft Punk déjà exclu' }).isDisabled(), 'artiste ajouté séparément et doublon désactivé');
await dialog.getByRole('tab', { name: /Musiques/ }).click();
await dialog.getByRole('button', { name: 'Débloquer One More Time' }).click();
records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(records.some(x => x.kind === 'track' && x.deleted) && records.some(x => x.kind === 'artist' && !x.deleted), 'débloquer la musique conserve l’exclusion de l’artiste');
await dialog.getByRole('button', { name: 'Exclure One More Time de Daft Punk' }).click();
check(await dialog.getByRole('button', { name: 'One More Time déjà exclue' }).isDisabled(), 'une musique peut être exclue indépendamment même si son artiste est déjà exclu');
await dialog.getByRole('tab', { name: /Artistes/ }).click();
await dialog.getByRole('button', { name: 'Débloquer Daft Punk' }).click();
records = await p.evaluate(() => JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(records.some(x => x.kind === 'artist' && x.deleted) && records.some(x => x.kind === 'track' && !x.deleted), 'débloquer l’artiste conserve l’exclusion du titre');
await dialog.getByRole('tab', { name: /Musiques/ }).click();
await search.fill('vide');
await dialog.getByText('Aucun résultat pour cette recherche.').waitFor();
check(await dialog.getByRole('alert').count() === 0, 'une recherche vide est distinguée d’une panne');
await search.fill('secours');
await dialog.getByRole('button', { name: 'Exclure Secours de Artiste réseau' }).waitFor();
check(calls.some(x => x.q === 'secours' && x.host.includes('ducks.party')) && calls.some(x => x.q === 'secours' && x.host.includes('private.coffee')), 'en cas de panne du premier hôte, une seconde instance est essayée');
await search.fill('repli-json');
await dialog.getByRole('button', { name: 'Exclure JSON réparé de Artiste réseau' }).waitFor();
check(calls.filter(x => x.q === 'repli-json').length === 2, 'une réponse mal formée essaie aussi l’instance de secours');
await search.fill('malforme');
await dialog.getByRole('alert').waitFor();
check((await dialog.getByRole('alert').innerText()).includes('indisponible'), 'deux réponses mal formées ne sont pas présentées comme un catalogue vide');
await search.fill('panne');
await dialog.getByRole('alert').waitFor();
check((await dialog.getByRole('alert').innerText()).includes('indisponible') && await dialog.getByRole('button', { name: 'Réessayer' }).isVisible(), 'erreur réseau expliquée avec nouvel essai');
recovered = true;
await dialog.getByRole('button', { name: 'Réessayer' }).click();
await dialog.getByRole('button', { name: 'Exclure Panne réparée de Artiste réseau' }).waitFor();
check(true, 'réessayer relance vraiment la recherche');
let pending = p.waitForRequest(req => req.url().includes('q=lent'));
await search.fill('lent'); await pending;
await search.fill('rapide');
await dialog.getByRole('button', { name: 'Exclure Nouveau résultat de Groupe rapide' }).waitFor();
await p.waitForTimeout(1800);
check(!(await dialog.getByText('Ancien résultat').count()) && await dialog.getByText('Nouveau résultat').isVisible(), 'une réponse tardive ne remplace pas une recherche plus récente');
pending = p.waitForRequest(req => req.url().includes('q=croise') && req.url().includes('music_songs'));
await search.fill('croise'); await pending;
await dialog.getByRole('tab', { name: /Artistes/ }).click();
await dialog.getByRole('button', { name: 'Exclure Artiste croisé' }).waitFor();
await p.waitForTimeout(1800);
check(!(await dialog.getByText('Ancien résultat').count()) && await dialog.getByText('Artiste croisé').isVisible(), 'une réponse de l’autre onglet ne revient pas après changement');
await dialog.getByRole('tab', { name: /Musiques/ }).click();
pending = p.waitForRequest(req => req.url().includes('q=lent'));
await search.fill('lent'); await pending;
await p.keyboard.press('Escape');
await p.waitForFunction(() => !document.querySelector('.sb-action-layer[data-present="true"]'));
await p.getByRole('button', { name: 'Ajouter une exclusion' }).click();
await dialog.waitFor();
await p.waitForTimeout(1800);
check(await search.inputValue() === '' && await search.evaluate(el => document.activeElement === el) && !(await dialog.getByText('Ancien résultat').count()), 'fermeture puis réouverture rapide : recherche réinitialisée, focus correct, ancienne réponse ignorée');
await dialog.getByRole('tab', { name: /Artistes/ }).click();
await p.evaluate(() => {
  const key = 'soundblend_exclusions_v1';
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list.push({ id: 'artist:sync', kind: 'artist', artist: 'Artiste synchronisé', updatedAt: Date.now(), deleted: false });
  localStorage.setItem(key, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent('sb:sync-applied'));
});
await dialog.getByRole('button', { name: 'Débloquer Artiste synchronisé' }).waitFor();
check(true, 'la liste ouverte se met à jour après une synchronisation entrante');

fs.mkdirSync('verification/captures', { recursive: true });
for (const [width, height, mode] of [[320, 568, 'dark'], [360, 640, 'light'], [844, 390, 'dark'], [1280, 800, 'light']]) {
  await p.setViewportSize({ width, height });
  await p.evaluate(m => { localStorage.setItem('soundblend_mode', m); window.dispatchEvent(new CustomEvent('sb:sync-applied')); }, mode);
  await p.waitForTimeout(350);
  const geometry = await dialog.evaluate(el => {
    const r = el.getBoundingClientRect(); const i = el.querySelector('input').getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, inputTop: i.top, inputBottom: i.bottom, scroll: document.documentElement.scrollWidth, width: innerWidth, height: innerHeight };
  });
  check(geometry.x >= -1 && geometry.y >= -1 && geometry.right <= width + 1 && geometry.bottom <= height + 1 && geometry.inputTop >= geometry.y && geometry.inputBottom <= geometry.bottom && geometry.scroll <= width + 1, `feuille et recherche utilisables en ${width}×${height}, thème ${mode}`);
  if (width === 320 || width === 1280) await p.screenshot({ path: `verification/captures/exclusions-${mode}-${width}.png` });
}
await p.setViewportSize({ width: 390, height: 844 });
await p.emulateMedia({ reducedMotion: 'reduce' });
await p.keyboard.press('Escape');
await p.waitForFunction(() => !document.querySelector('.sb-action-layer[data-present="true"]'));
await p.getByRole('button', { name: 'Ajouter une exclusion' }).click();
await dialog.waitFor();
check(await p.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches) && await search.evaluate(el => document.activeElement === el), 'mouvement réduit et focus compatibles');
await p.mouse.click(5, 5);
await p.waitForFunction(() => !document.querySelector('.sb-action-layer[data-present="true"]'));
check(true, 'toucher le fond ferme la feuille');
check(errors.length === 0, `aucune exception JavaScript (${errors.join('; ')})`);
await c.close();

// Retour système depuis Réglages, sans quitter la page au premier retour.
const cb = await context();
const pb = await cb.newPage();
await pb.goto(base, { waitUntil: 'domcontentloaded' }); await pb.waitForSelector('.ytm-shell');
await pb.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
await pb.waitForFunction(() => history.state?.sb === 1);
await pb.getByRole('button', { name: 'Ajouter une exclusion' }).click();
await pb.waitForFunction(() => history.state?.sb === 2);
await pb.goBack();
await pb.waitForFunction(() => !document.querySelector('.sb-action-layer[data-present="true"]'));
check(await pb.getByRole('heading', { name: 'Réglages', exact: true }).isVisible(), 'retour Android ferme la feuille avant de quitter Réglages');
await pb.goBack();
await pb.waitForSelector('.sb-hero-line2');
check(true, 'retour suivant rejoint la bibliothèque');
await cb.close();

// Bannissement depuis le grand lecteur : la feuille passe avant le lecteur.
const cp = await context();
const pp = await cp.newPage();
const playerErrors = []; pp.on('pageerror', e => playerErrors.push(e.message));
await pp.goto(base, { waitUntil: 'domcontentloaded' }); await pp.waitForSelector('.sb-tile--resume');
await pp.locator('.sb-tile--resume').click();
await pp.getByRole('button', { name: 'Écouter', exact: true }).click();
await pp.locator('.nowbar-track').click();
await pp.locator('.nowplaying').waitFor();
await pp.waitForTimeout(500);
await pp.locator('.nowplaying [aria-label="Bloquer"]').click();
await pp.getByRole('dialog', { name: 'Bloquer' }).waitFor();
await pp.waitForFunction(() => history.state?.sb === 3);
await pp.waitForTimeout(450); // fin de l'entrée animée avant de mesurer
const box = await pp.getByRole('dialog', { name: 'Bloquer' }).boundingBox();
check(box && Math.abs(box.y + box.height - 844) < 1 && await pp.getByRole('button', { name: 'Ne plus proposer cette musique' }).isVisible() && await pp.getByRole('button', { name: 'Ne plus proposer cet artiste' }).isVisible(), 'feuille de bannissement au bas de l’écran, au-dessus du lecteur');
await pp.screenshot({ path: 'verification/captures/exclusions-block-player.png' });
for (const [width, height, mode] of [[320, 568, 'light'], [844, 390, 'dark'], [1280, 800, 'light']]) {
  await pp.setViewportSize({ width, height });
  await pp.evaluate(m => { localStorage.setItem('soundblend_mode', m); window.dispatchEvent(new CustomEvent('sb:sync-applied')); }, mode);
  const choice = pp.getByRole('button', { name: 'Ne plus proposer cet artiste' });
  await choice.scrollIntoViewIfNeeded();
  const rects = await choice.evaluate(el => {
    const b = el.getBoundingClientRect(), s = el.closest('[role="dialog"]').getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, sheetTop: s.top, sheetBottom: s.bottom };
  });
  if (!(rects.top >= rects.sheetTop - 1 && rects.bottom <= rects.sheetBottom + 1 && rects.left >= 0 && rects.right <= width + 1 && rects.sheetTop >= 0 && rects.sheetBottom <= height + 1)) console.log('  géométrie du panneau :', rects);
  check(rects.top >= rects.sheetTop - 1 && rects.bottom <= rects.sheetBottom + 1 && rects.left >= 0 && rects.right <= width + 1 && rects.sheetTop >= 0 && rects.sheetBottom <= height + 1, `choix de bannissement atteignables en ${width}×${height}, thème ${mode}`);
}
await pp.setViewportSize({ width: 390, height: 844 });
await pp.goBack();
await pp.waitForFunction(() => !document.querySelector('.sb-action-layer[data-present="true"]'));
check(await pp.locator('.nowplaying').count() === 1, 'premier retour ferme le bannissement, sans réduire le lecteur');
await pp.goBack();
// Un changement de hauteur pendant la descente ne doit pas laisser le
// lecteur monté hors champ avec une ancienne cible de translation.
await pp.waitForFunction(() => document.querySelector('.nowplaying')?.getAttribute('data-anim') === '1');
await pp.setViewportSize({ width: 390, height: 1000 });
await pp.waitForFunction(() => !document.querySelector('.nowplaying'), null, { timeout: 5000 });
check(await pp.locator('.sb-blend-head').isVisible(), 'retour suivant réduit le lecteur même si la hauteur change pendant la fermeture');
await pp.setViewportSize({ width: 390, height: 844 });
await pp.locator('.nowbar-track').click(); await pp.locator('.nowplaying').waitFor(); await pp.waitForTimeout(500);
await pp.locator('.nowplaying-sheet').evaluate(el => {
  const send = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 17, clientX: 200, clientY: y }));
  send('pointerdown', 200); send('pointermove', 650); send('pointerup', 650);
});
await pp.waitForFunction(() => !document.querySelector('.nowplaying'), null, { timeout: 5000 });
check(true, 'glissement vertical long ferme toujours le lecteur');
await pp.locator('.nowbar-track').evaluate(async el => {
  const send = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 20, clientX: 100, clientY: y }));
  send('pointerdown', 800); await new Promise(r => setTimeout(r, 250)); send('pointermove', 775); await new Promise(r => setTimeout(r, 100)); send('pointerup', 775);
});
await pp.waitForFunction(() => !document.querySelector('.nowplaying'), null, { timeout: 5000 });
check(true, 'glissement trop court depuis la barre range la feuille');
await pp.locator('.nowbar-track').evaluate(el => {
  const send = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 18, clientX: 100, clientY: y }));
  send('pointerdown', 800); send('pointermove', 560); send('pointerup', 560);
});
await pp.locator('.nowplaying').waitFor(); await pp.waitForTimeout(500);
check(await pp.locator('.nowplaying').count() === 1, 'glissement depuis la barre ouvre toujours le lecteur');
await pp.locator('.nowplaying-sheet').evaluate(async el => {
  const send = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 19, clientX: 200, clientY: y }));
  send('pointerdown', 200); await new Promise(r => setTimeout(r, 250)); send('pointermove', 230); send('pointerup', 230);
});
await pp.waitForTimeout(500);
check(await pp.locator('.nowplaying').count() === 1, 'glissement trop court laisse le lecteur ouvert');
await pp.locator('.nowplaying-sheet').evaluate(async el => {
  const send = (type, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 21, clientX: 200, clientY: y }));
  send('pointerdown', 100); send('pointermove', 620); await new Promise(r => setTimeout(r, 100)); send('pointercancel', 620);
});
await pp.waitForFunction(() => !document.querySelector('.nowplaying'), null, { timeout: 5000 });
check(true, 'un geste annulé au-delà de la moitié range le lecteur');
await pp.emulateMedia({ reducedMotion: 'reduce' });
await pp.locator('.nowbar-track').click(); await pp.locator('.nowplaying').waitFor();
await pp.locator('.nowplaying-reduce').click();
await pp.waitForFunction(() => !document.querySelector('.nowplaying'), null, { timeout: 5000 });
check(true, 'le lecteur se ferme aussi avec les mouvements réduits');
check(playerErrors.length === 0, `aucune exception côté lecteur simulé (${playerErrors.join('; ')})`);
await cp.close();
await browser.close();
console.log(`\n${count}/${count} contrôles Exclusions réussis (services simulés).`);
