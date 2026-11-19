import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';


/* ═══════════════════════════════════════════════════════════════
   Une primitive de feuille pour toute l'app : fond assombri,
   panneau qui glisse depuis le bas sur téléphone, dialogue centré
   sur bureau. Aucune ombre, aucun flou de verre — juste des filets.
   ═══════════════════════════════════════════════════════════════ */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  label?: string;
  hideClose?: boolean;
  className?: string;
}

const WIDTHS: Record<string, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-5xl',
  full: 'max-w-[min(1180px,94vw)]',
};

export const Modal: React.FC<ModalProps> = ({
  open, onClose, children, size = 'md', label, hideClose, className = '',
}) => {

  /* une seule chorégraphie : la feuille monte, sans rebond */
  const panelMotion = {
    initial: { y: 28, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: 22, opacity: 0 },
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="sb-modal-layer fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-6">
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0,0,0,.55)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
          />

          <motion.section
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            {...panelMotion}
            className={`relative z-10 w-full ${WIDTHS[size]} ${className}`}
            style={{
              background: 'var(--bg)',
              borderRadius: 20,
              border: '1px solid var(--line)',
              boxShadow: 'var(--shadow-2)',
              maxHeight: 'min(92dvh, 980px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            {!hideClose && (
              <button
                onClick={onClose}
                aria-label="Fermer"
                className="icon-btn"
                style={{ position: 'absolute', top: 14, right: 14, zIndex: 3, background: 'var(--bg-sunken)' }}
              >
                <X size={18} />
              </button>
            )}
            {children}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
};

export const ModalHeader: React.FC<{
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}> = ({ eyebrow, title, subtitle, right }) => {
  return (
    <header
      style={{
        padding: '18px 22px 12px',
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'flex-start', gap: 16, flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {eyebrow && (
          <div className="ink-3" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', marginBottom: 6 }}>
            {eyebrow}
          </div>
        )}
        <h2 className={`title-display sb-modal-title`} style={{ fontSize: 23, margin: 0, color: 'var(--ink)' }}>
          {title}
        </h2>
        {subtitle && <p className="ink-2" style={{ fontSize: 13.5, margin: '6px 0 0', lineHeight: 1.45 }}>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
};

export const ModalFooter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <footer
    style={{
      padding: '16px 24px', borderTop: '1px solid var(--line)',
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--bg)', flexShrink: 0,
    }}
  >
    {children}
  </footer>
);

/* Corps scrollable */
export const ModalBody: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ padding: '18px 24px', overflow: 'auto', flex: 1, minHeight: 0, ...style }}>{children}</div>
);
