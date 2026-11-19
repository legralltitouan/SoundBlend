import React, { useEffect, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   L'installation de l'app.

   Sur un téléphone, SoundBlend peut vivre en dehors du navigateur :
   posée sur l'écran d'accueil, elle s'ouvre en plein écran, sans barre
   d'adresse, et garde son icône. Il n'y a pas de boutique : c'est le
   navigateur qui l'installe, à condition de lui en donner les moyens.

   Trois familles :

   1. Android / Chrome, Edge, Opera — le navigateur émet `beforeinstallprompt`.
      On le garde de côté et on l'appelle quand la personne appuie sur
      « Installer ». C'est le seul chemin silencieux, sans quitter l'app.
   2. iOS / Safari — Apple n'offre aucune API. On explique le geste :
      Partager → « Sur l'écran d'accueil ».
   3. Déjà installée, ou navigateur sans installation (Firefox sur
      ordinateur) — on n'affiche rien.

   Ce que ce module ne fait pas : promettre une installation qui
   n'existe pas. Si l'app tourne depuis un simple dossier `file://` ou
   depuis un aperçu sans HTTPS, l'installation est impossible et le
   module le dit.
   ═══════════════════════════════════════════════════════════════ */

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'soundblend_install_dismissed';
const SEEN_KEY = 'soundblend_install_seen';

export type Platform = 'chromium' | 'ios' | 'other';

export type InstallState = {
  /** le navigateur sait installer, et l'app ne l'est pas encore */
  canInstall: boolean;
  /** l'app tourne déjà en plein écran, installée */
  installed: boolean;
  platform: Platform;
  /** demande l'installation ; renvoie ce que la personne a choisi */
  install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** l'invitation a été écartée (mémorisé) */
  dismissed: boolean;
  dismiss: () => void;
};

const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && (navigator as any).standalone === true);

const detectPlatform = (): Platform => {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  /* iPad récent se présente comme un Mac : on teste le tactile */
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadOS) return 'ios';
  if (/Android/.test(ua)) return 'chromium';
  return 'other';
};

let deferredPrompt: PromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    /* on empêche la mini-barre du navigateur : c'est nous qui posons la
       question, au bon moment, dans notre langue */
    e.preventDefault();
    deferredPrompt = e as PromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    emit();
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', emit);
}

export const useInstall = (): InstallState => {
  const [tick, setTick] = useState(0);
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const platform = detectPlatform();

  useEffect(() => {
    const on = () => {
      setTick((t) => t + 1);
      setInstalled(isStandalone());
    };
    listeners.add(on);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', on);
    return () => {
      listeners.delete(on);
      mq?.removeEventListener?.('change', on);
    };
  }, []);

  const canInstall = !installed && (!!deferredPrompt || platform === 'ios');
  void tick;

  const install = async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (deferredPrompt) {
      const e = deferredPrompt;
      deferredPrompt = null;
      emit();
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
      }
      return choice.outcome;
    }
    /* iOS : il n'y a pas de prompt programmatique. L'appelant affiche
       les trois gestes ; on renvoie « indisponible » pour qu'il sache
       qu'il ne doit pas attendre un événement. */
    return 'unavailable';
  };

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
  };

  return { canInstall, installed, platform, install, dismissed, dismiss };
};

/* la phrase qui explique le geste, selon l'appareil */
export const installHint = (platform: Platform) =>
  platform === 'ios'
    ? 'Sur iPhone : bouton Partager, puis « Sur l’écran d’accueil ».'
    : 'Le navigateur posera SoundBlend sur ton écran d’accueil comme une app.';

/* l'installation n'est possible que sur une origine sûre : HTTPS, ou
   localhost pour les tests. Un aperçu ouvert en `file://` n'y a pas droit. */
export const installPossible = () =>
  typeof window !== 'undefined' &&
  (window.isSecureContext === true ||
    location.protocol === 'https:' ||
    ['localhost', '127.0.0.1'].includes(location.hostname));

export const InstallHint: React.FC<{ platform: Platform; compact?: boolean }> = ({ platform, compact }) => {
  if (platform !== 'ios') {
    return <p className="sb-install-hint">{installHint(platform)}</p>;
  }
  return (
    <ol className="sb-install-steps" data-compact={compact ? '1' : undefined}>
      <li><b>Partager</b> — la case avec la flèche, en bas de Safari.</li>
      <li>Faire défiler et choisir <b>« Sur l’écran d’accueil »</b>.</li>
      <li><b>Ajouter</b> — l’icône SoundBlend apparaît avec tes autres apps.</li>
    </ol>
  );
};

/* ── le service worker ──
   Il est enregistré une fois, après le premier rendu : il ne sert à rien
   avant, et le retarder évite de voler la bande passante du premier
   écran. En développement on ne l'enregistre pas — il servirait des
   fichiers périmés à chaque rechargement. */
export const registerServiceWorker = () => {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!installPossible()) return;
  if (import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* pas de service worker : l'app fonctionne quand même, seule
         l'installation automatique et le hors-ligne manqueront */
    });
  });
};

export default useInstall;
