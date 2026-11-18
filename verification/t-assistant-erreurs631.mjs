/* Erreurs visibles, source réelle différée et pagination — APIs simulées. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.SOUNDBLEND_URL||process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const cors={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'GET,PATCH,POST,DELETE,OPTIONS','access-control-allow-headers':'*'};
let n=0;const check=(b,s)=>{assert.ok(b,s);n++;console.log('  ✓ '+s)};
async function setup({auth=false,key='',playlists=[],onPlaylistItems,onGemini}={}){
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await ctx.addInitScript(({auth,key})=>{
  if(localStorage.getItem('test-initialise'))return;localStorage.setItem('test-initialise','1');localStorage.setItem('soundblend_onboarded','1');
  localStorage.setItem('soundblend_settings',JSON.stringify({googleClientId:'',youtubeApiKey:'',geminiApiKey:key}));
  if(auth){localStorage.setItem('soundblend_yt_token','ya29.fake');localStorage.setItem('soundblend_yt_token_exp',String(Date.now()+3600000));localStorage.setItem('soundblend_yt_user',JSON.stringify({name:'Test'}));}
 },{auth,key});
 await ctx.route('https://accounts.google.com/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.google={accounts:{oauth2:{initTokenClient:()=>({})}}};'}));
 await ctx.route('https://www.youtube.com/**',r=>r.fulfill({status:200,headers:cors,body:'{}'}));
 await ctx.route(/pipedapi\.|api\.piped\./,r=>r.abort());
 await ctx.route(/https:\/\/www\.googleapis\.com\/(drive|upload\/drive)\//,r=>{
  const u=r.request().url();if(u.includes('alt=media'))return r.fulfill({status:200,headers:cors,body:'{"schema":2,"blends":[],"exclusions":[],"decouvertes":[],"suppressionsBlends":{}}'});
  if(r.request().method()==='PATCH')return r.fulfill({status:200,headers:cors,body:'{"id":"f1"}'});
  return r.fulfill({status:200,headers:cors,body:'{"files":[{"id":"f1"}]}'});
 });
 await ctx.route('https://www.googleapis.com/youtube/v3/**',r=>{
  const u=new URL(r.request().url());if(u.pathname.endsWith('/playlists'))return r.fulfill({status:200,headers:cors,body:JSON.stringify({items:playlists.map(p=>({id:p.id,snippet:{title:p.title,thumbnails:{}},contentDetails:{itemCount:p.count||1}}))})});
  if(u.pathname.endsWith('/playlistItems'))return onPlaylistItems?.(r,u)??r.fulfill({status:200,headers:cors,body:'{"items":[]}'});
  return r.fulfill({status:200,headers:cors,body:'{"items":[]}'});
 });
 await ctx.route('https://generativelanguage.googleapis.com/**',r=>{
  if(r.request().url().includes('/models?'))return r.fulfill({status:200,headers:cors,body:'{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"],"outputTokenLimit":8192}]}'});
  return onGemini?.(r)??r.fulfill({status:500,headers:cors,body:'{}'});
 });
 const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForSelector('.ytm-shell');await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();
 return {ctx,p,errors};
}
const send=async(p,text)=>{await p.locator('#sb-assistant-input').fill(text);await p.getByRole('button',{name:'Envoyer à l’assistant'}).click();};
const geminiReply=(r,obj)=>r.fulfill({status:200,headers:cors,body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(obj)}]}}]})});
const item=(id,title,artist)=>({id:'i'+id,snippet:{title,videoOwnerChannelTitle:artist+' - Topic',thumbnails:{}},contentDetails:{videoId:id}});
try {
 {const {ctx,p}=await setup();await send(p,'Prépare un blend de ma playlist.');
  check((await p.getByRole('alert').innerText()).includes('clé Gemini'),'clé manquante clairement signalée dans l’assistant');
  check(await p.getByRole('region',{name:'Proposition de blend'}).count()===0,'aucune proposition inventée en l’absence de clé');await ctx.close();}
 {const {ctx,p}=await setup({key:'test-key',onGemini:r=>r.fulfill({status:403,headers:cors,body:'{"error":{"message":"forbidden"}}'})});
  await send(p,'Bonjour !');check(/clé Gemini refusée.*403/.test(await p.getByRole('alert').innerText()),'refus Gemini 403 visible et expliqué');await ctx.close();}
 {const {ctx,p}=await setup({key:'test-key',onGemini:r=>geminiReply(r,{reply:'Voici une proposition.',source:{type:'playlist',id:'ID-INVENTE'},instruction:'jazz'})});
  await send(p,'Propose un blend.');await p.getByText(/Je ne retrouve pas cette source/).waitFor({timeout:10000});
  check(await p.getByRole('region',{name:'Proposition de blend'}).count()===0,'une source inventée par Gemini ne peut pas être lancée');await ctx.close();}
 {let failing=true;const prompts=[];
  const {ctx,p,errors}=await setup({auth:true,key:'test-key',playlists:[{id:'PL-CHILL',title:'Chill Voiture',count:2}],
   onPlaylistItems:(r,u)=>u.searchParams.get('pageToken')==='2'
    ?failing?r.fulfill({status:503,headers:cors,body:'{}'}):r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[item('SECOND00001','Deuxième morceau','Beta')]})})
    :r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[item('FIRST000001','Premier morceau','Alpha')],nextPageToken:'2'})}),
   onGemini:r=>{const prompt=JSON.parse(r.request().postData()).contents[0].parts[0].text;prompts.push(prompt);return geminiReply(r,{reply:'Repartons de Chill Voiture.',source:{type:'playlist',id:'PL-CHILL'},instruction:'Plus jazz',durationMinutes:20});}});
  await p.waitForTimeout(700);await send(p,'Reprends Chill Voiture.');
  check(/playlist YouTube.*page 2.*503/.test(await p.getByRole('alert').innerText()),'échec d’une page YouTube visible, au lieu de prétendre que la source est vide');
  check(prompts.length===0,'aucun contexte partiel transmis à Gemini après échec de pagination');
  failing=false;await send(p,'Réessaie Chill Voiture.');await p.getByRole('region',{name:'Proposition de blend'}).waitFor({timeout:12000});
  check(prompts.some(x=>x.includes('Premier morceau')&&x.includes('Deuxième morceau')),'nouvel essai relit toutes les pages, sans mettre en cache la liste partielle');
  await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem('soundblend_settings'));s.geminiApiKey='';localStorage.setItem('soundblend_settings',JSON.stringify(s));});
  await p.getByRole('button',{name:'Générer ce blend'}).click();
  check(/clé Gemini.*nécessaire/i.test(await p.getByRole('alert').innerText({timeout:12000})),'erreur de génération visible après clic si la clé a disparu');
  check(await p.locator('.sb-gen').count()===0,'écran de composition retiré après l’échec');
  check(errors.length===0,'aucune exception non gérée pendant les erreurs');await ctx.close();}
 {const prompts=[];const pls=Array.from({length:7},(_,i)=>({id:`PL${i+1}`,title:`Playlist ${i+1}`}));
  const {ctx,p}=await setup({auth:true,key:'test-key',playlists:pls,onPlaylistItems:(r,u)=>r.fulfill({status:200,headers:cors,body:JSON.stringify({items:[item(u.searchParams.get('playlistId')==='PL7'?'SEVENTH0001':'OTHERS00001',u.searchParams.get('playlistId')==='PL7'?'Titre de la septième':'Autre titre','Artiste')]})}),
   onGemini:r=>{prompts.push(JSON.parse(r.request().postData()).contents[0].parts[0].text);return geminiReply(r,{reply:'Utilisons ta septième playlist.',source:{type:'playlist',id:'PL7'},instruction:'plus rythmé'});}});
  await p.waitForTimeout(1300);await send(p,'Utilise la septième playlist.');await p.getByRole('region',{name:'Proposition de blend'}).waitFor({timeout:10000});
  check(prompts.length===2 && !prompts[0].includes('Titre de la septième') && prompts[1].includes('Titre de la septième'),'source non nommée chargée, puis contexte réel renvoyé à Gemini avant proposition');await ctx.close();}
 {const prompts=[];const {ctx,p}=await setup({auth:true,key:'test-key',playlists:[{id:'LONG',title:'Longue',count:550}],
  onPlaylistItems:(r,u)=>{let page=Number(u.searchParams.get('pageToken')||'0');let count=page<11?50:0;
   let items=Array.from({length:count},(_,i)=>item(`V${String(page*50+i).padStart(10,'0')}`,`Piste ${page*50+i}`,'Alpha'));
   return r.fulfill({status:200,headers:cors,body:JSON.stringify({items,...(page<10?{nextPageToken:String(page+1)}:{})})});},
  onGemini:r=>{prompts.push(JSON.parse(r.request().postData()).contents[0].parts[0].text);return geminiReply(r,{reply:'Utilisons Longue.',source:{type:'playlist',id:'LONG'},instruction:'jazz'});}});
  await p.waitForTimeout(700);await send(p,'Utilise la playlist Longue.');await p.getByRole('region',{name:'Proposition de blend'}).waitFor({timeout:12000});
  check(prompts.some(x=>x.includes('Piste 0')&&x.includes('Piste 549')),'playlist de plus de 500 titres transmise entièrement au lieu d’être tronquée silencieusement');await ctx.close();}
 console.log(`\n${n}/${n} contrôles des erreurs et sources réussis`);
} finally {await browser.close();}
