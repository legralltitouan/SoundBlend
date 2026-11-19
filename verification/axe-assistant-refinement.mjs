/* Optionnel : npm install --no-save playwright @axe-core/playwright */
import { chromium } from 'playwright';
const { default:AxeBuilder } = await import(process.env.SOUNDBLEND_AXE_MODULE || '@axe-core/playwright');
const b=await chromium.launch({args:['--no-sandbox']});let failed=0;
try {for(const mode of ['light','dark']) {
 const c=await b.newContext({viewport:{width:390,height:844}});await c.addInitScript(m=>{localStorage.setItem('soundblend_onboarded','1');localStorage.setItem('soundblend_mode',m)},mode);await c.route(/^https:\/\//,r=>r.abort());const p=await c.newPage();await p.goto(process.env.SOUNDBLEND_DEV_URL||'http://localhost:5173/');await p.locator('.ytm-mobile-bar [aria-label="Assistant"]').click();await p.waitForSelector('.sa-welcome');
 for(const live of [false,true]) {if(live)await p.getByRole('button',{name:'Live',exact:true}).click();const r=await new AxeBuilder({page:p}).include('.sb-assistant-studio').include('.sa-floating-compose').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();console.log(mode,live?'Live':'Accueil',r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({selector:n.target,summary:n.failureSummary}))})));failed+=r.violations.length;}
 await p.getByRole('button',{name:'Fermer le mode Live'}).click();
 await p.evaluate(async()=>{ const {geminiService}=await import('/src/services/gemini.ts'); geminiService.converse=async()=>({reply:'Une direction jazz et soul.',title:'Jazz, à ta façon',action:'blend',source:{type:'playlist',id:'demo-pl-french-touch'},extraSources:[],instruction:'Du jazz doux',durationMinutes:45,catalogQueries:[],catalogVideoIds:[],researchQuery:'',playlistEdits:null}); });
 await p.locator('#sb-assistant-input').fill('Un blend jazz');await p.locator('#sb-assistant-input').press('Enter');await p.getByRole('region',{name:'Proposition de blend',exact:true}).waitFor();
 const chat=await new AxeBuilder({page:p}).include('.sb-assistant-studio').include('.sa-floating-compose').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();console.log(mode,'Conversation',chat.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({selector:n.target,summary:n.failureSummary}))})));failed+=chat.violations.length;
 await p.getByRole('button',{name:'Confidentialité de l’assistant'}).click();
 const privacy=await new AxeBuilder({page:p}).include('.sa-privacy').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();console.log(mode,'Confidentialité',privacy.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({selector:n.target,summary:n.failureSummary}))})));failed+=privacy.violations.length;
 await c.close();
} }finally{await b.close()}if(failed)process.exitCode=1;
