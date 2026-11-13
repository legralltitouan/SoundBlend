import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Library, History, Brain, Plus, LogIn, LogOut, Search, Moon, Sun,
} from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import type { ViewName } from '../../context/UIContext';

const NAV: { id: ViewName; label: string; icon: React.ElementType }[] = [
  { id: 'library', label: 'Bibliothèque', icon: Library },
  { id: 'history', label: 'Blends', icon: History },
  { id: 'taste', label: 'Goûts', icon: Brain },
];

/* ═══════════════════════════════════════════════════════════════
   Coque unique, calquée sur l'app mobile :
   · ≥ 820px → rail vertical 76 px à gauche + contenu centré
   · < 820px → barre haute collante + barre de navigation basse
   La connexion Google, la génération et le lecteur restent ceux du
   site (inchangés) : seule la présentation change.
   ═══════════════════════════════════════════════════════════════ */

export const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { mode, toggleMode, view, setView, openModal } = useUI();
  const { selectedTracks } = useData();

  return (
    <div className="ytm-shell" style={{ minHeight: '100dvh' }}>
      {/* ─────────── rail (bureau) ─────────── */}
      <aside className="ytm-rail" aria-label="Navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className="ytm-nav"
              data-active={active}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={21} strokeWidth={active ? 2.2 : 1.7} />
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button className="ytm-nav" onClick={toggleMode} title="Clair / sombre" aria-label="Clair ou sombre">
          {mode === 'dark' ? <Sun size={20} strokeWidth={1.7} /> : <Moon size={20} strokeWidth={1.7} />}
        </button>
        <button
          className="ytm-nav"
          onClick={() => openModal('picker')}
          title="Nouveau blend"
          aria-label="Nouveau blend"
          style={{ position: 'relative' }}
        >
          <Plus size={21} strokeWidth={2} />
          {selectedTracks.length > 0 && <CountBadge n={selectedTracks.length} />}
        </button>
        <span className="avatar-slot rail-avatar"><AvatarButton variant="rail" /></span>
      </aside>

      {/* ─────────── barre haute ─────────── */}
      <div className="ytm-content">
      <header
        className="ytm-topbar"
        /* volontairement sans filet : la barre ne doit pas se détacher */
      >
        <div
          className="ytm-search"
          onClick={() => openModal('picker', { focusSearch: true })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openModal('picker', { focusSearch: true }); }}
          role="button"
          tabIndex={0}
          aria-label="Rechercher un morceau"
        >
          <Search size={17} strokeWidth={1.8} />
          <span>Rechercher un morceau, un artiste</span>
        </div>
      </header>

      <main style={{ paddingBottom: 'calc(var(--bar-h) + 60px)' }}>
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </main>

      {/* ─────────── barre basse (mobile) ─────────── */}
      <nav className="ytm-mobile-bar" aria-label="Navigation mobile" data-count={NAV.length + 1}>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className="ytm-nav"
              data-active={active}
              aria-label={item.label}
            >
              <Icon size={21} strokeWidth={active ? 2.2 : 1.7} />
            </button>
          );
        })}
        <span className="avatar-slot"><AvatarButton variant="bar" /></span>
      </nav>

      </div>

    </div>
  );
};

/* Avatar du compte : ouvre les réglages. Déconnecté, c'est l'icône de
   connexion — un clic y mène aussi, et la connexion se lance depuis les
   réglages. Sans ça, les réglages étaient inatteignables avant de s'être
   connecté, alors qu'on y range justement les clés d'API. */
const AvatarButton: React.FC<{ variant: 'rail' | 'top' | 'bar' }> = ({ variant }) => {
  const { setView } = useUI();
  const { userProfile, isAuthenticated } = useData();
  const size = variant === 'rail' ? 30 : 32;

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={() => setView('settings')}
        className={variant === 'bar' ? 'ytm-nav' : variant === 'rail' ? 'ytm-nav' : 'icon-btn'}
        aria-label="Réglages du compte"
        title="Réglages et connexion"
        style={variant === 'top' ? { border: '1px solid var(--line-2)', width: 32, height: 32 } : undefined}
      >
        <LogIn size={variant === 'rail' ? 20 : 17} strokeWidth={1.8} />
      </button>
    );
  }

  /* La photo de profil vient de Google, sur un domaine qui change
     (lh3.googleusercontent.com) et qui expire parfois. Quand l'image
     échoue, on ne laisse pas un carré cassé : on bascule sur l'initiale,
     et on réessaie une fois avec la version `?sz=` forcée — c'est la
     même photo servie autrement, souvent la seule qui réponde. */
  const initial = (userProfile?.name || '?').trim().charAt(0).toUpperCase();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [avatarRetry, setAvatarRetry] = useState(false);
  useEffect(() => { setAvatarFailed(false); setAvatarRetry(false); }, [userProfile?.avatarUrl]);

  const avatarSrc = userProfile?.avatarUrl
    ? (avatarRetry
      ? userProfile.avatarUrl.replace(/([?&])sz=\d+/, '$1sz=128') + (userProfile.avatarUrl.includes('?') ? '' : '?sz=128')
      : userProfile.avatarUrl)
    : '';

  const photo = avatarSrc && !avatarFailed ? (
    <img
      src={avatarSrc}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      loading="eager"
      onError={() => {
        if (!avatarRetry) setAvatarRetry(true);
        else setAvatarFailed(true);
      }}
      style={{ width: size, height: size, borderRadius: 999, objectFit: 'cover' }}
    />
  ) : (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: 999, display: 'grid', placeItems: 'center',
        background: 'var(--bg-3)', color: 'var(--ink)', fontSize: 13, fontWeight: 600,
      }}
    >
      {initial}
    </span>
  );

  return (
    <button
      type="button"
      onClick={() => setView('settings')}
      className={variant === 'bar' ? 'ytm-nav' : variant === 'rail' ? 'ytm-nav' : 'icon-btn'}
      aria-label="Réglages du compte"
      title={userProfile?.name || 'Mon compte'}
      style={{ padding: 0 }}
    >
      {photo}
    </button>
  );
};

const CountBadge: React.FC<{ n: number }> = ({ n }) => (
  <span
    style={{
      position: 'absolute', top: 4, right: 4,
      minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
      background: 'var(--accent)', color: '#fff',
      fontSize: 10, fontWeight: 600, display: 'grid', placeItems: 'center',
    }}
  >
    {n}
  </span>
);
