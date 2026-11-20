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
      <div><dt>Tu gardes la main</dt><dd>Les trois dernières discussions (jusqu’à 120 messages chacune), leurs références et leurs aperçus de création sont conservés sur cet appareil, séparément pour chaque compte, et synchronisés dans le dossier privé appDataFolder de ton Google Drive quand tu es connecté. Aucun enregistrement audio n’est conservé dans cet historique. Le bouton + permet de les retrouver. Une demande continue pendant la navigation tant que le navigateur reste actif ; après une fermeture ou une suspension, sa reprise peut demander une relance explicite. La synchronisation n’est pas instantanée : utilise Actualiser sur l’autre appareil. Restaurer une discussion ne confirme aucune modification. Les données envoyées suivent les conditions de Google. Aucune action musicale sans ta confirmation.</dd></div></dl>
    <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Conditions de l’API Gemini ↗</a>
    <button type="button" className="sa-primary" onClick={onClose}>Compris</button>
  </dialog>, document.body);
};
