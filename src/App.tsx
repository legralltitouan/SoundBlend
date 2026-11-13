import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { UIProvider, useUI } from './context/UIContext';
import { DataProvider } from './context/DataContext';
import { PlayerProvider } from './context/PlayerContext';
import { Shell } from './components/shell/Shell';
import { LibraryView } from './components/views/LibraryView';
import { BlendView } from './components/views/BlendView';
import { HistoryView } from './components/views/HistoryView';
import { TaskTicker } from './components/ui/TaskTicker';
import { ReplaceQueueProvider } from './context/ReplaceQueueContext';
import { TasteView } from './components/views/TasteView';
import { SettingsView } from './components/views/SettingsView';
import { PickerModal } from './components/modals/PickerModal';
import { ConfigModal } from './components/modals/ConfigModal';
import { GeneratingOverlay } from './components/modals/GeneratingOverlay';
import { PlayerBar, VideoModal } from './components/player/PlayerBar';
import { Check } from 'lucide-react';
import { WelcomeFlow } from './components/shell/WelcomeFlow';
import { Ambience } from './components/shell/Ambience';
import { InstallBanner } from './components/shell/InstallBanner';

const Router: React.FC = () => {
  const { view } = useUI();
  if (view === 'blend') return <BlendView />;
  if (view === 'history') return <HistoryView />;
  if (view === 'taste') return <TasteView />;
  if (view === 'settings') return <SettingsView />;
  return <LibraryView />;
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
          <Check size={15} />
          <span>{toast}</span>
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
    <VideoModal />
  </>
);

export const AppContent: React.FC = () => {
  const { onboarded } = useUI();

  if (!onboarded) {
    return (
      <>
        <Ambience />
        <WelcomeFlow />
        <Toast />
      <TaskTicker />
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
    <Toast />
    <TaskTicker />
    {/* l'invitation à installer : téléphone seulement, une seule fois */}
    <InstallBanner />
  </>
  );
};

export default function App() {
  return (
    <UIProvider>
      <DataProvider>
        <PlayerProvider>
          {/* la file des remplacements vit au-dessus des écrans : elle
              continue quand on change de vue */}
          <ReplaceQueueProvider>
            <AppContent />
          </ReplaceQueueProvider>
        </PlayerProvider>
      </DataProvider>
    </UIProvider>
  );
}
