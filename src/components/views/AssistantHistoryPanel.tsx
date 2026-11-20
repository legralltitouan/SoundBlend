import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, MessageCircle, Plus, RefreshCw, X } from 'lucide-react';
import { assistantHistoryWarning, getAssistantConversations, type AssistantConversation } from '../../services/assistantHistory';

export const AssistantHistoryPanel: React.FC<{
  activeId: string; onSelect: (id: string) => void; onNew: () => void; onClose: () => void;
  onRefresh: () => void; syncLabel: string; syncing: boolean;
}> = ({ activeId, onSelect, onNew, onClose, onRefresh, syncLabel, syncing }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows,setRows] = React.useState<AssistantConversation[]>(getAssistantConversations);
  useEffect(()=>{
    const refresh=()=>setRows(getAssistantConversations());
    window.addEventListener('sb:assistant-history-changed',refresh);window.addEventListener('sb:assistant-history-remote',refresh);
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=ref.current;dialog?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{dialog?.close();document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus({preventScroll:true});window.removeEventListener('sb:assistant-history-changed',refresh);window.removeEventListener('sb:assistant-history-remote',refresh);};
  },[]);
  return createPortal(<dialog ref={ref} className="sa-privacy sa-history" aria-labelledby="sa-history-title" aria-describedby="sa-history-intro" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget){const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose();}}}>
    <div className="sa-privacy-heading"><span><MessageCircle size={20}/></span><button type="button" className="sa-icon" aria-label="Fermer les discussions" onClick={onClose} autoFocus><X size={19}/></button></div>
    <h2 id="sa-history-title">Tes discussions</h2><p id="sa-history-intro">Les 3 dernières discussions, celle en cours comprise. Jusqu’à 120 messages chacune.</p>
    <button type="button" className="sa-primary" onClick={onNew}><Plus size={18}/>Nouvelle discussion</button>
    {rows.length ? <ul className="sa-history-list">{rows.map(c=>{
      const title=c.messages.find(m=>m.role==='user')?.text || c.snapshot.text || 'Discussion musicale';
      return <li key={c.id}><button type="button" onClick={()=>onSelect(c.id)} aria-current={activeId===c.id?'true':undefined}>
        <span className="sa-history-symbol">{activeId===c.id?<Check size={17}/>:<MessageCircle size={17}/>}</span><span><b>{title}</b><small>{new Date(c.updatedAt).toLocaleString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})} · {c.run?.status==='running'?'Demande lancée':`${c.messages.length} messages`}</small></span><ChevronRight size={16}/>
      </button></li>;
    })}</ul>:<p className="sa-small">Ta première discussion apparaîtra ici dès que tu commenceras à écrire.</p>}
    <div className="sa-history-sync"><p role="status">{assistantHistoryWarning() || syncLabel}</p><button type="button" className="sb-assistant-inline-button" disabled={syncing} onClick={onRefresh}><RefreshCw size={14} className={syncing?'anim-spin':''}/>Actualiser</button></div>
    <p className="sa-small">Dossier privé de l’application dans Google Drive pour le même compte connecté. Sans connexion, les discussions restent sur cet appareil. Une ancienne proposition ne confirme jamais une action.</p>
  </dialog>,document.body);
};
