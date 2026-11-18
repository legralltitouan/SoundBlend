import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './context/prefs'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/pwa'
import { youtubeService } from './services/youtube'

// Vérifier le retour OAuth avant le montage : aucune synchro de l'ancien
// compte ne démarre pendant la vérification du nouveau compte.
async function start() {
  await youtubeService.completeRedirectLogin();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  registerServiceWorker()
}
void start()
