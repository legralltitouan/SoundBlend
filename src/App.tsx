import React, { Suspense, lazy, useEffect, useState } from 'react';
import { accountRevision } from './services/accountScope';
import { AnimatePresence, motion } from 'framer-motion';
import { UIProvider, useUI } from './context/UIContext';
import { DataProvider } from './context/DataContext';
import { PlayerProvider } from './context/PlayerContext';
import { Shell } from './components/shell/Shell';
import { LibraryView } from './components/views/LibraryView';
import { SettingsView } from './components/views/SettingsView';
import { TaskTicker } from './components/ui/TaskTicker';
import { ReplaceQueueProvider } from './context/ReplaceQueueContext';
import { PickerModal } from './components/modals/PickerModal';
import { ConfigModal } from './components/modals/ConfigModal';
import { GeneratingOverlay } from './components/modals/GeneratingOverlay';
import { ActionSheets } from './components/modals/ActionSheets';
import { PlayerBar } from './components/player/PlayerBar';
import { WelcomeFlow } from './components/shell/WelcomeFlow';
import { Ambience } from './components/shell/Ambience';
import { InstallBanner } from './components/shell/InstallBanner';
import { BackHandler } from './components/shell/BackHandler';

// Les vues secondaires sont téléchargées à leur première ouverture. Le
// service worker précharge leurs modules pour conserver la navigation hors ligne.
const BlendView = lazy(() => import('./components/views/BlendView').then(m => ({ default: m.BlendView })));
const HistoryView = lazy(() => import('./components/views/HistoryView').then(m => ({ default: m.HistoryView })));
const AssistantView = lazy(() => import('./components/views/AssistantView').then(m => ({ default: m.AssistantView })));

/** Un échec de téléchargement d'une vue ne doit pas démonter toute la coque. */
class ViewBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <div className="sb-assistant-error" role="alert">
        Cette vue n’a pas pu être chargée. Vérifie ta connexion, puis recharge la page si nécessaire.
        Les éléments non enregistrés peuvent être perdus lors du rechargement.
      </div>
    );
    return this.props.children;
  }
}

const Router: React.FC = () => {
  const { view } = useUI();
  const content = view === 'blend' ? <BlendView />
    : view === 'history' ? <HistoryView />
    : view === 'assistant' ? <AssistantView />
    : view === 'settings' ? <SettingsView /> : <LibraryView />;
  return <ViewBoundary key={view}>
    <Suspense fallback={<p role="status">Chargement…</p>}>{content}</Suspense>
  </ViewBoundary>;
};

const Toast: React.FC = () => {
  const { toast, design } = useUI();
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          style={{
            position: 'fixed', zIndex: 90, left: '50%', transform: 'translateX(-50%)',
            bottom: 168,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 16px', borderRadius: 999, maxWidth: 'min(520px, 90vw)',
            background: 'var(--ink)', color: 'var(--bg)',
            boxShadow: 'var(--shadow-2)', fontSize: 13, fontWeight: 550,
          }}
        >
          <span role="status">{toast}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Modals: React.FC = () => (
  <>
    <PickerModal />
    <ConfigModal />
    <GeneratingOverlay />
  </>
);

export const AppContent: React.FC = () => {
  const { onboarded } = useUI();

  if (!onboarded) {
    return (
      <>
        {/* L'ambiance lit le contexte lecteur ; pendant l'accueil, lui
            fournir un lecteur inactif sans remonter le parcours à chaque
            changement de compte. */}
        <PlayerProvider><Ambience /></PlayerProvider>
        <WelcomeFlow />
        <Toast />
      </>
    );
  }

  return (
  <>
    <Ambience />
    <Shell>
      <Router />
    </Shell>
    {/* hors de <main> : sinon ils restent piégés dans son contexte d'empilement */}
    <Modals />
    <PlayerBar />
    <ActionSheets />
    <Toast />
    <TaskTicker />
    {/* l'invitation à installer : téléphone seulement, une seule fois */}
    <InstallBanner />
    <BackHandler />
  </>
  );
};

/* La conversation, le lecteur et sa file restent sur cet appareil et sont
   remis à zéro lors d'un changement de compte : aucun état en mémoire de A
   ne doit devenir la session de B. */
const AccountBoundContent: React.FC = () => {
  const { onboarded } = useUI();
  const [revision, setRevision] = useState(accountRevision);
  useEffect(() => {
    const onAccount = () => setRevision(accountRevision());
    window.addEventListener('sb:account-changed', onAccount);
    return () => window.removeEventListener('sb:account-changed', onAccount);
  }, []);
  if (!onboarded) return <AppContent />;
  return <PlayerProvider key={revision}><ReplaceQueueProvider><AppContent /></ReplaceQueueProvider></PlayerProvider>;
};
export default function App() {
  return <UIProvider><DataProvider><AccountBoundContent /></DataProvider></UIProvider>;
}
