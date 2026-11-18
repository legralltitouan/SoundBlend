/* Données, migrations, exclusions et fenêtres de 14 jours — navigateur isolé. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url = process.env.SOUNDBLEND_DEV_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await context.route('https://www.youtube.com/**', r => r.abort());
const page = await context.newPage();
await page.goto(new URL('verification/test-harness.html', url).href);
const results = await page.evaluate(async () => {
  localStorage.clear();
  const s = await import('/src/services/storage.ts');
  const now = Date.now();
  const checks = [];
  const check = (name, ok) => checks.push([name, !!ok]);
  const t = (title, artist, videoId = '12345678901', category = 'fresh') => ({ id: videoId, title, artist, videoId, category, thumbnailUrl: '', durationSeconds: 200 });
  const old = { id:'old',title:'Ancien blend',createdAt:new Date(now-10000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks:[{...t('Avant','Origine'),userRating:'disliked'}] };
  localStorage.setItem('soundblend_taste_memory', JSON.stringify({likedTracks:[],dislikedTracks:[{title:'Avant',artist:'Origine'}],likedArtists:[],dislikedArtists:['Origine']}));
  localStorage.setItem('soundblend_ratings_v1', JSON.stringify({x:'disliked'}));
  localStorage.setItem('soundblend_seen_tracks', JSON.stringify(['journal non daté']));
  localStorage.setItem('soundblend_recent_blends', JSON.stringify([old]));
  s.migrateLegacyData();
  check('les anciens pouces sont supprimés et non convertis en exclusions', !localStorage.getItem('soundblend_taste_memory') && !localStorage.getItem('soundblend_ratings_v1') && s.getExclusionRecords().length===0);
  check('les copies de pouce sont retirées des blends', !('userRating' in s.getStoredBlends()[0].tracks[0]));
  check('le vieux journal sans date n’interdit rien', !localStorage.getItem('soundblend_seen_tracks'));
  s.learnDiscoveriesFromBlends(s.getStoredBlends());
  check('la migration reconstitue les découvertes datées des blends valides', s.isRecentlyProposed(t('Avant','Origine')));

  const one = s.block(t('Été','Artiste A','AAA00000001'),'track');
  check('musique bloquée, casse et accents normalisés', s.isExcluded(t('Ete (Official Audio)','artiste a','AAA00000002')));
  check('une musique bloquée ne bloque pas le reste de son artiste', !s.isExcluded(t('Un autre morceau','Artiste A','AAA00000003')));
  check('un titre homonyme par un autre artiste reste autorisé', !s.isExcluded(t('Été','Artiste B','AAA00000004')));
  check('même vidéo bloquée malgré des métadonnées différentes', s.isExcluded(t('Autre nom','Autre chaîne','AAA00000001')));
  const two = s.block(t('Divers','Air','ZZZ00000001'),'artist');
  check('un artiste bloqué est exclu même en collaboration', s.isExcluded(t('Test','Air feat. Artiste A','ZZZ00000002')));
  check('un nom proche n’est pas banni par sous-chaîne', !s.isExcluded(t('Test','Air Supply','ZZZ00000003')));
  s.unblock(one.id);
  const tomb = s.getExclusionRecords().find(x=>x.id===one.id);
  const merged = s.mergeExclusionRecords([one],[tomb]);
  check('déblocage conservé par une fusion avec un appareil périmé', merged.find(x=>x.id===one.id)?.deleted === true && !s.isExcluded(t('Été','Artiste A','AAA00000001')));
  check('déblocage d’une musique ne retire pas le blocage séparé d’artiste', s.isExcluded(t('Test','Air','ZZZ00000002')));

  localStorage.setItem('soundblend_discoveries_v2', JSON.stringify([
    {title:'Récente',artist:'Groupe',videoId:'RECENT00001',shownAt:now-13*86400000},
    {title:'Vieille',artist:'Groupe',videoId:'OLDER000001',shownAt:now-15*86400000},
  ]));
  check('une découverte proposée il y a 13 jours est interdite', s.isRecentlyProposed(t('Récente','Groupe','RECENT00001')));
  check('une découverte de plus de 14 jours redevient possible', !s.isRecentlyProposed(t('Vieille','Groupe','OLDER000001')));
  check('une autre vidéo du même titre récent reste reconnue', s.isRecentlyProposed(t('Récente','Groupe','NEW00000001')));
  check('un titre récent est identifié même si la chaîne a changé', s.isRecentlyProposed(t('Autre étiquette','Autre artiste','RECENT00001')));
  const filtered = s.mergeDiscoveryHistory(s.getDiscoveryHistory(),[{title:'Vieille',artist:'Groupe',shownAt:now-15*86400000}],now);
  check('la fusion supprime les entrées périmées, sans plafond de 300', filtered.length===1);
  const stale = {id:'blend-a',at:now,expiresAt:now+86400000};
  const dels = s.mergeBlendTombstones({ 'blend-a': {at:stale.at,expiresAt:stale.expiresAt} }, {});
  check('la suppression d’un blend dispose d’un tombstone daté', !!dels['blend-a']);
  localStorage.clear(); return checks;
});
for (const [name, ok] of results) { console.log(`${ok?'  ✓':'  ✗'} ${name}`); assert.ok(ok,name); }
console.log(`\n${results.length}/${results.length} contrôles des données réussis`);
await browser.close();
