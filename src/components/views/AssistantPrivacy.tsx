import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, X } from 'lucide-react';

/** Le dialogue natif apporte focus captif, Échap et restitution du focus. */
export const AssistantPrivacy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={ref} className="sa-privacy" aria-labelledby="sa-privacy-title" aria-describedby="sa-privacy-intro" onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <div className="sa-privacy-heading"><span><ShieldCheck size={20} /></span><button type="button" className="sa-icon" aria-label="Fermer la confidentialité" onClick={onClose} autoFocus><X size={19} /></button></div>
    <h2 id="sa-privacy-title">Ta musique, tes choix.</h2>
    <p id="sa-privacy-intro">L’essentiel sur tes données et l’assistant.</p>
    <dl><div><dt>Ce qui est envoyé à Gemini</dt><dd>Tes messages, les références YouTube choisies, le contexte musical chargé et tes exclusions, via ta clé. Quotas et frais possibles.</dd></div>
      <div><dt>Quand tu passes en Live</dt><dd>Le micro s’ouvre avec ton accord et transmet ta voix à Google, avec les références de ton brouillon. Quitter le Live ou passer en arrière-plan coupe immédiatement le micro et le son. Une demande déjà transmise peut finir dans le chat tant que le navigateur reste actif.</dd></div>
      <div><dt>Tu gardes la main</dt><dd>La conversation reste en mémoire. Pendant une préparation vocale, seule sa consigne textuelle est temporairement conservée sur cet appareil, par compte, pour proposer une reprise après fermeture, disponible pendant 30 minutes. Aucun audio ni clé dans ce journal. Il est effacé à la réussite, à l’annulation ou à la déconnexion. Les données envoyées suivent les conditions de Google. Aucune action musicale sans ta confirmation.</dd></div></dl>
    <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Conditions de l’API Gemini ↗</a>
    <button type="button" className="sa-primary" onClick={onClose}>Compris</button>
  </dialog>, document.body);
};
