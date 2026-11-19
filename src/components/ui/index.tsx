import React from 'react';
import { Moon, Sun } from 'lucide-react';
/* Bascule clair / sombre */
export const ModeSwitch: React.FC<{ mode: 'light' | 'dark'; onToggle: () => void }> = ({ mode, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className={'icon-btn mode-switch'}
    title={mode === 'dark' ? 'Passer en clair' : 'Passer en sombre'}
    aria-label="Changer de thème clair/sombre"
  >
    <span
      style={{
        display: 'grid', placeItems: 'center',
        transition: 'transform .35s var(--ease)',
        transform: mode === 'dark' ? 'rotate(0deg)' : 'rotate(-90deg)',
      }}
    >
      {mode === 'dark' ? <Moon size={19} /> : <Sun size={19} />}
    </span>
  </button>
);

/* Bouton générique */
export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'tonal' | 'ghost' | 'outline';
    size?: 'sm' | 'md' | 'lg';
    block?: boolean;
  }
> = ({ variant = 'primary', size = 'md', block, className = '', children, onClick, ...rest }) => {
  const cls = [
    'btn',
    `btn-${variant}`,
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button
      {...rest}
      className={cls}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

/* Indicateur « en lecture » animé */
export const Equalizer: React.FC<{ active?: boolean; className?: string }> = ({ active = true, className = '' }) => (
  <span className={`eq ${className}`} aria-hidden>
    <span style={{ animationPlayState: active ? 'running' : 'paused' }} />
    <span style={{ animationPlayState: active ? 'running' : 'paused' }} />
    <span style={{ animationPlayState: active ? 'running' : 'paused' }} />
  </span>
);

/* Carte de section avec titre + action */
export const SectionTitle: React.FC<{ title: string; sub?: string; action?: React.ReactNode }> = ({ title, sub, action }) => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16 }}>
    <div style={{ minWidth: 0 }}>
      <h2 className="title-display" style={{ fontSize: 21, margin: 0, color: 'var(--ink)' }}>{title}</h2>
      {sub && <p className="ink-3" style={{ fontSize: 13, margin: '4px 0 0' }}>{sub}</p>}
    </div>
    <div style={{ flex: 1 }} />
    {action}
  </div>
);
