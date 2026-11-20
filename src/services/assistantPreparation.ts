import { geminiService, type AssistantMessage, type AssistantReply, type AssistantSource } from './gemini';
import { blendInstruction, uniqueAssistantTracks } from './assistantConversation';
import { mentionTrack, type AssistantMention } from './assistantMentions';
import { prepareAssistantBlendDraft } from './assistantBlend';
import { prepareAssistantPlaylistDraft } from './assistantPlaylist';
import { getStoredBlends } from './storage';
import { isAssistantTrackExcluded, youtubeService } from './youtube';
import { guardVoicePreparation, updateVoicePreparation, type VoicePreparation, type VoicePreparationResult } from './assistantVoiceTask';
import { stampAssistantMessage } from './assistantHistory';
import { norm } from '../lib/track';
import type { Playlist, Track } from '../types';

export type AssistantPreparationContext = {
  conversation: AssistantMessage[]; playlists: Playlist[];
  exclusions: Parameters<typeof geminiService.converse>[3];
  proposal?: NonNullable<Parameters<typeof geminiService.converse>[4]>['proposal'];
  catalog: Track[]; selected: string[]; references: AssistantMention[];
  loadPlaylistTracks: (id: string) => Promise<Track[]>;
};
const sourceKey = (s: AssistantSource) => `${s.type}:${s.id}`;
const validSource = (s: AssistantSource | null, playlists: Playlist[]) => !!s && (s.type === 'playlist'
  ? playlists.some(p=>p.id===s.id) : getStoredBlends().some(b=>b.id===s.id && Date.parse(b.expiresAt)>Date.now()));

/** Account-owned read-only work. No React state, mounted-view guard or UI callback. */
export async function prepareAssistantConversation(task: VoicePreparation, context: AssistantPreparationContext): Promise<VoicePreparationResult> {
  const guard=()=>guardVoicePreparation(task);
  const progress=(stage:string)=>updateVoicePreparation(task,stage);
  const {conversation, exclusions, references, catalog, selected, proposal, loadPlaylistTracks}=context;
  progress('Lecture de ton contexte musical…');
  let playlists=context.playlists.map(p=>({...p}));
  const namedText=norm(conversation.filter(m=>m.role==='user').map(m=>m.text).join(' '));
  for(const p of playlists.filter(p=>norm(p.title).length>=3 && namedText.includes(norm(p.title)) && !p.tracks).slice(0,3)) {
    const tracks=await loadPlaylistTracks(p.id);guard();playlists=playlists.map(x=>x.id===p.id?{...x,tracks}:x);
  }
  const ask=async(catalogData:Track[])=>{
    guard();progress('Gemini réfléchit à ta demande…');
    const result=await geminiService.converse(conversation,playlists,getStoredBlends(),exclusions,{catalog:catalogData,proposal,signal:task.controller.signal,onProgress:progress});
    guard();return result;
  };
  const referenced=references.map(mentionTrack).filter((t):t is Track=>!!t);
  const previous=uniqueAssistantTracks([...referenced,...catalog.filter(t=>selected.includes(t.videoId))],isAssistantTrackExcluded);
  let answer=await ask(previous);
  const loadChosen=async(r:AssistantReply)=>{
    let loaded=false;
    for(const s of [r.source,...r.extraSources].filter((s):s is AssistantSource=>!!s && s.type==='playlist').slice(0,4)) {
      const p=playlists.find(p=>p.id===s.id);
      if(p && !p.tracks){progress(`Lecture de « ${p.title} » sur YouTube…`);const tracks=await loadPlaylistTracks(p.id);guard();playlists=playlists.map(x=>x.id===p.id?{...x,tracks}:x);loaded=true;}
    }
    return loaded;
  };
  if(await loadChosen(answer))answer=await ask(previous);
  guard();const warnings:string[]=[];const found=[...previous];const searched=answer.catalogQueries.length>0;
  if(searched){
    if(!youtubeService.isAuthenticated())warnings.push('Connecte ton compte Google pour rechercher des morceaux sur YouTube.');
    else {
      progress('Recherche musicale sur YouTube…');
      for(const query of answer.catalogQueries.slice(0,2))try{const hits=await youtubeService.searchAssistantCatalog(query);guard();found.push(...hits.filter(t=>!found.some(x=>x.videoId===t.videoId)));}
      catch(e){guard();warnings.push(e instanceof Error?e.message:'Recherche YouTube indisponible.');break;}
    }
  }
  if(found.some(t=>!previous.some(x=>x.videoId===t.videoId))){answer=await ask(found);if(await loadChosen(answer))answer=await ask(found);}
  guard();
  const recommended=[...new Set([...answer.catalogVideoIds,...referenced.map(t=>t.videoId),...selected])].filter(id=>found.some(t=>t.videoId===id && !isAssistantTrackExcluded(t)));
  if(answer.source && !validSource(answer.source,playlists))answer={...answer,action:'none',source:null,reply:`${answer.reply}\n\nJe ne retrouve pas cette source dans ta bibliothèque. Précise son nom.`};
  const reply=`${answer.reply}${warnings.length?`\n\n${warnings.join(' ')}`:''}`;
  let prepared=false;
  let playlistDraft:VoicePreparationResult['playlistDraft']=null;
  let blendDraft:VoicePreparationResult['blendDraft']=null;
  if(answer.action==='blend_edit'){
    if(!answer.source || answer.source.type!=='blend' || !answer.blendEdits)throw new Error('Précise le blend à modifier et les changements souhaités.');
    progress('Vérification du blend et préparation des changements…');
    blendDraft=await prepareAssistantBlendDraft(answer.source.id,answer.blendEdits);guard();
    if(blendDraft.mode==='regenerate' && !answer.instruction.trim())throw new Error('Il manque la direction musicale pour recomposer ce blend.');
    prepared=true;
  } else if(answer.action==='playlist_edit'){
    if(!answer.source || answer.source.type!=='playlist' || !answer.playlistEdits)throw new Error('Il me manque la playlist ou les changements précis. Demande une nouvelle proposition en indiquant les titres.');
    const p=playlists.find(p=>p.id===answer.source!.id);if(!p)throw new Error('Cette playlist n’est plus disponible.');
    progress('Vérification complète de la playlist et préparation de l’aperçu…');
    playlistDraft=await prepareAssistantPlaylistDraft(p,answer.playlistEdits);guard();prepared=true;
  } else if(answer.action==='blend' && (validSource(answer.source,playlists) || recommended.length))prepared=true;
  guard();return {
    messages:[...conversation,stampAssistantMessage({role:'assistant',text:reply,...(searched?{catalog:found}:{})})],
    answer,catalog:found,selected:recommended,prepared,playlistDraft,blendDraft,
    source:answer.source && validSource(answer.source,playlists)?sourceKey(answer.source):'catalog',
    extraSources:[...new Set(answer.extraSources.filter(s=>validSource(s,playlists) && (!answer.source || sourceKey(s)!==sourceKey(answer.source))).map(sourceKey))].slice(0,3),
    instruction:blendInstruction(answer.instruction,conversation.filter(m=>m.role==='user').map(m=>m.text)),
  };
}
