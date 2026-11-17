/* Parcours graphique intégral — Gemini, YouTube et Drive simulés. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const base=process.env.SOUNDBLEND_URL||process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const now=Date.now(); const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'*'};
await ctx.addInitScript(({now})=>{
 if(!localStorage.getItem('__setup')){
  localStorage.setItem('__setup','1');localStorage.setItem('soundblend_onboarded','1');localStorage.setItem('soundblend_mode','dark');
  localStorage.setItem('soundblend_yt_token','ya29.fake');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+3600000));
  localStorage.setItem('soundblend_yt_user',JSON.stringify({name:'Test',email:'t@example.test',avatarUrl:''}));
  localStorage.setItem('soundblend_settings',JSON.stringify({googleClientId:'',youtubeApiKey:'',geminiApiKey:'test-key'}));localStorage.setItem('soundblend_settings_at_v2',String(now));
  localStorage.setItem('soundblend_exclusions_v1',JSON.stringify([{id:'artist:blacklisted',kind:'artist',artist:'Blacklisted',updatedAt:now-3000,deleted:false},{id:'track:unaffected|nope',kind:'track',artist:'Unaffected',title:'Nope',videoId:'BADTUNE0001',updatedAt:now-3000,deleted:false}]));
  localStorage.setItem('soundblend_discoveries_v2',JSON.stringify([{title:'Recent Tune',artist:'RecentBand',videoId:'RECENT00001',shownAt:now-86400000}]));
  localStorage.setItem('soundblend_recent_blends',JSON.stringify([{id:'existing-blend',title:'Blend du matin',createdAt:new Date(now-86400000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),seedTracks:[],tracks:[{id:'abc',title:'Vieille ambiance',artist:'OldBand',videoId:'BLEND000001',thumbnailUrl:'',durationSeconds:210,category:'fresh'}]}]));
 }
},{now});
await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};'}));
const memory={data:{schema:2,modifie:new Date().toISOString(),appareil:'test',blends:[],exclusions:[],decouvertes:[],suppressionsBlends:{}}};
await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,async r=>{
 const req=r.request(),url=new URL(req.url()),method=req.method();if(method==='OPTIONS')return r.fulfill({status:200,headers:cors,body:''});
 if(url.pathname.includes('/upload/')&&method==='PATCH'){memory.data=JSON.parse(req.postData());return r.fulfill({status:200,headers:cors,body:'{"id":"f1"}'});}
 if(url.searchParams.get('alt')==='media')return r.fulfill({status:200,headers:cors,body:JSON.stringify(memory.data)});
 return r.fulfill({status:200,headers:cors,body:'{"files":[{"id":"f1","name":"soundblend.json"}]}'});
});
await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>{
 const u=r.request().url();
 if(u.includes('/playlists'))return r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[{id:'PL-CHILL',snippet:{title:'Chill Voiture',description:'',thumbnails:{}},contentDetails:{itemCount:2}}]})});
 if(u.includes('/playlistItems'))return r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[
  {id:'pl-item-1',snippet:{title:'Seed Song',videoOwnerChannelTitle:'Alpha - Topic',thumbnails:{}},contentDetails:{videoId:'ANCHOR00001'}},
  {id:'pl-item-2',snippet:{title:'Bad Seed',videoOwnerChannelTitle:'Blacklisted - Topic',thumbnails:{}},contentDetails:{videoId:'BADSEED0001'}},
 ]})});
 return r.fulfill({status:200,headers:cors,body:'{"items":[]}'});
});
await ctx.route('https://www.youtube.com/iframe_api',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
await ctx.route('https://www.youtube.com/oembed**',r=>{
 const id=new URL(new URL(r.request().url()).searchParams.get('url')).searchParams.get('v');
 const meta={ANCHOR00001:['Seed Song','Alpha'],DEEPSAFE001:['Deep Safe','Alpha'],JAZZSAFE001:['Jazz Safe','NewBand'],OTHERSAFE01:['Other Safe','OtherBand']}[id]||['Titre','Artiste'];
 return r.fulfill({status:200,headers:cors,body:JSON.stringify({title:meta[0],author_name:meta[1]})});
});
await ctx.route(/pipedapi\.|api\.piped\./,r=>r.abort());
const prompts=[];let release;const gate=new Promise(r=>release=r);
await ctx.route('https://generativelanguage.googleapis.com/**',async r=>{
 if(r.request().url().includes('/models?'))return r.fulfill({status:200,headers:cors,body:JSON.stringify({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent'],outputTokenLimit:8192}]})});
 const prompt=JSON.parse(r.request().postData()||'{}').contents?.[0]?.parts?.[0]?.text||'';prompts.push(prompt);let out;
 if(prompt.includes('premier travail est de les ÉCOUTER')){await gate;out={fil:'Jazz plus énergique',genres:['jazz'],textures:['piano'],epoques:[],energie:'énergique',gout:'jazz',eviter:[]};}
 else if(prompt.includes('═══ TA SÉLECTION ═══'))out={analyse:'Une sélection jazz.',titres:prompt.includes('« DEEP DIVE » — les faces cachées')
  ?[{title:'Deep Safe',artist:'Alpha',rationale:'Piano',videoId:'DEEPSAFE001'}]
  :[{title:'Nope',artist:'Unaffected',videoId:'BADTUNE0001'},{title:'Recent Tune',artist:'RecentBand',videoId:'RECENT00001'},{title:'Jazz Safe',artist:'NewBand',rationale:'Saxophone',videoId:'JAZZSAFE001'},{title:'Other Safe',artist:'OtherBand',rationale:'Rythme',videoId:'OTHERSAFE01'}]};
 else out={reply:'Je pars de Chill Voiture, avec davantage de jazz et une énergie plus vive.',source:{type:'playlist',id:'PL-CHILL'},instruction:'Ajouter du jazz et augmenter l’énergie.',durationMinutes:20};
 return r.fulfill({status:200,headers:cors,body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(out)}]}}]})});
});
const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));const ok=[];const check=(b,name)=>{assert.ok(b,name);ok.push(name);console.log('  ✓ '+name)};
await p.goto(base);await p.waitForSelector('.ytm-shell');await p.waitForTimeout(1000);
await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
check(await p.getByRole('heading',{name:'Assistant',exact:true}).isVisible(),'navigation Assistant à la place de Goûts');
const original='Reprends ma playlist YouTube Music Chill Voiture, ajoute du jazz et rends-la plus énergique.';
await p.locator('#sb-assistant-input').fill(original);await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();
await p.getByRole('region',{name:'Proposition de blend'}).waitFor({timeout:15000});
check(await p.getByText(/davantage de jazz/).isVisible(),'réponse Gemini visible dans la conversation');
check(await p.locator('[aria-label="Source du blend"]').inputValue()==='playlist:PL-CHILL','la source proposée correspond à une vraie playlist de la bibliothèque simulée');
check((await p.locator('[aria-label="Consigne transmise à Gemini"]').inputValue()).includes(original),'demande exacte conservée dans la proposition éditable');
check(await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_recent_blends')).length)===1,'aucun blend généré pendant la conversation');
const chatPrompt=prompts.find(x=>x.includes("Tu es l'assistant musical de SoundBlend"));
check(!!chatPrompt&&chatPrompt.includes('Chill Voiture')&&chatPrompt.includes('Seed Song')&&chatPrompt.includes('Blend du matin')&&chatPrompt.includes('Blacklisted')&&chatPrompt.includes('Nope'),'Gemini reçoit la playlist chargée, le blend valide et les exclusions');
await p.getByRole('button',{name:'Générer ce blend'}).click();
await p.locator('.sb-gen').waitFor({timeout:10000});
check(await p.locator('.sb-gen').isVisible(),'génération uniquement après action explicite');
await p.waitForTimeout(650);
check(await p.locator('.sb-organic').getAttribute('data-movement')==='chargement' && await p.evaluate(()=>!!document.elementFromPoint(5,5)?.closest('.sb-gen')),'mode chargement au premier plan après fondu');
const svg=await p.locator('.sb-organic-svg').evaluate(el=>({viewBox:el.getAttribute('viewBox'),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,layers:el.querySelectorAll('[data-layer]').length,frequency:el.querySelector('feTurbulence')?.getAttribute('baseFrequency'),octaves:el.querySelector('feTurbulence')?.getAttribute('numOctaves')}));
check(svg.viewBox==='0 0 390 844'&&svg.width===390&&svg.height===844&&svg.layers===6&&svg.frequency==='0.72'&&svg.octaves==='3','animation plein écran à six nappes et grain conforme à la référence');
fs.mkdirSync(new URL('./captures/',import.meta.url),{recursive:true});
await p.screenshot({path:fileURLToPath(new URL('./captures/composition-mobile.png',import.meta.url))});
await p.setViewportSize({width:844,height:390});await p.waitForTimeout(400);
check(await p.locator('.sb-organic-svg').getAttribute('viewBox')==='0 0 844 390','canevas recadré après rotation du téléphone');
release();
await p.waitForSelector('.sb-gen',{state:'detached',timeout:20000});await p.waitForTimeout(350);
check(await p.locator('.sb-blend-head').isVisible(),'blend effectivement affiché après génération');
const blend=await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_recent_blends')).find(x=>x.id!=='existing-blend'));
check(blend.instruction.includes(original)&&blend.seedTracks.some(x=>x.title==='Seed Song')&&!blend.seedTracks.some(x=>x.artist==='Blacklisted'),'source réelle chargée et amorce bloquée retirée avant génération');
check(blend.tracks.some(x=>x.title==='Jazz Safe')&&!blend.tracks.some(x=>x.title==='Nope'||x.title==='Recent Tune'),'résultat affiché sans exclusion ni découverte récente');
check(prompts.filter(x=>x.includes('═══ TA SÉLECTION ═══')).every(x=>x.includes('Chill Voiture')&&x.includes('jazz')&&x.includes('énergique')),'instruction réellement transmise aux prompts de génération');
const row=p.locator('.sb-track-row').filter({hasText:'Jazz Safe'});await row.locator('[aria-label="Bloquer"]').click();
check(await p.getByRole('dialog',{name:'Bloquer'}).isVisible()&&await p.getByRole('button',{name:'Ne plus proposer cette musique'}).isVisible()&&await p.getByRole('button',{name:'Ne plus proposer cet artiste'}).isVisible(),'bouton unique présente les deux choix explicites');
await p.getByRole('button',{name:'Ne plus proposer cette musique'}).click();
let exclusions=await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(exclusions.some(x=>x.title==='Jazz Safe'&&x.kind==='track'&&!x.deleted)&&!exclusions.some(x=>x.artist==='NewBand'&&x.kind==='artist'&&!x.deleted),'choix musique ne bloque pas l’artiste');
await row.locator('[aria-label="Bloquer"]').click();await p.getByRole('button',{name:'Ne plus proposer cet artiste'}).click();
exclusions=await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(exclusions.some(x=>x.artist==='NewBand'&&x.kind==='artist'&&!x.deleted)&&exclusions.some(x=>x.title==='Jazz Safe'&&x.kind==='track'&&!x.deleted),'choix artiste enregistré séparément du titre déjà bloqué');
await p.setViewportSize({width:390,height:844});await p.locator('.ytm-mobile-bar [aria-label="Réglages du compte"]').click();
await p.getByRole('button',{name:'Afficher la liste des exclusions'}).click();
await p.getByRole('button',{name:'Débloquer Jazz Safe'}).click();
await p.getByRole('tab',{name:/Artistes/}).click();await p.getByRole('button',{name:'Débloquer NewBand'}).click();
exclusions=await p.evaluate(()=>JSON.parse(localStorage.getItem('soundblend_exclusions_v1')));
check(exclusions.some(x=>x.title==='Jazz Safe'&&x.deleted)&&exclusions.some(x=>x.artist==='NewBand'&&x.kind==='artist'&&x.deleted),'déblocage indépendant des deux choix depuis Réglages');
check(!(await p.getByRole('button',{name:/J’aime|Je n’aime pas/}).count()),'aucun bouton pouce dans l’interface');
check(errors.length===0,`aucune exception JavaScript (${errors.join('; ')})`);
console.log(`\n${ok.length}/${ok.length} contrôles du parcours graphique réussis`);
await browser.close();
