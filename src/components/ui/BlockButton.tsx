import React from 'react';
import { Ban } from 'lucide-react';
import { useUI } from '../../context/UIContext';
import type { Track } from '../../types';

/** Un seul bouton, deux décisions distinctes dans la feuille partagée. */
export const BlockButton: React.FC<{ track: Track; className?: string; size?: number }> = ({ track, className = '', size = 17 }) => {
  const { openActionSheet } = useUI();
  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      aria-label="Bloquer"
      title="Bloquer"
      onClick={(e) => { e.stopPropagation(); openActionSheet({ kind: 'block', track }, e.currentTarget); }}
    >
      <Ban size={size} strokeWidth={1.9} />
    </button>
  );
};
