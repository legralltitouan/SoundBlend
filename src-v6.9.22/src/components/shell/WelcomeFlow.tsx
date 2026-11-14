import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Loader2, Moon, Sun } from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';

/* ═══════════════════════════════════════════════════════════════
   Accueil de première visite — trois temps, une seule décision
   par écran : le thème, puis le compte, puis c'est parti.
   On peut tout à fait continuer sans compte : la bibliothèque
   d'exemple sert de terrain de jeu.
   ═══════════════════════════════════════════════════════════════ */

const THEMES = [
  { id: 'dark' as const, label: 'Sombre', hint: 'Noir pur, comme la nuit' },
  { id: 'light' as const, label: 'Clair', hint: 'Blanc pur, en plein jour' },
];

export const WelcomeFlow: React.FC = () => {
  const { mode, setMode, finishOnboarding } = useUI();
  const { isAuthenticated, login, userProfile, settings, saveSettings } = useData();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey || '');

  /* quatre temps : le thème, la clé, le compte, c'est parti */
  const next = () => setStep((s) => Math.min(3, s + 1));

  /* la clé n'est enregistrée que si elle a changé : on ne réécrit pas
     les réglages pour rien, et un champ laissé vide n'efface pas une clé
     déjà saisie dans Réglages */
  const saveKey = () => {
    const k = geminiKey.trim();
    if (!k || k === settings.geminiApiKey) return;
    saveSettings({ ...settings, geminiApiKey: k });
  };

  const connect = () => {
    setBusy(true);
    login();
    /* la fenêtre Google prend la main ; si elle est refusée on reste ici */
    window.setTimeout(() => setBusy(false), 2500);
  };

  return (
    <div className="welcome">
      <div className="welcome-glow" aria-hidden key={`glow-${mode}`}>
        <i /><i /><i />
      </div>

      <div className="welcome-card">
        <div className="welcome-brand">
          {/* Le vrai logo, dans sa pastille sombre : le triangle de lecture
              est blanc, il disparaîtrait sur le fond crème. Posé sur le
              noir de l'icône, il se lit sur les deux thèmes — et c'est
              exactement l'image que la personne aura sur son écran
              d'accueil une fois l'app installée. */}
          <img className="welcome-mark" src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" aria-hidden />
          <span>SoundBlend</span>
        </div>

        <AnimatePresence mode="wait">
          {/* ─────────── 1. le thème ─────────── */}
          {step === 0 && (
            <motion.section
              key="theme"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="welcome-title">Bienvenue.</h1>
              <p className="welcome-sub">On commence par l’ambiance : tu pourras changer d’avis à tout moment.</p>

              <div className="theme-picker">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className="theme-card"
                    data-theme-choice={t.id}
                    data-active={mode === t.id}
                    onClick={() => setMode(t.id)}
                    aria-pressed={mode === t.id}
                  >
                    <span className="theme-preview" aria-hidden>
                      <span className="theme-preview-bar" />
                      <span className="theme-preview-tile" />
                      <span className="theme-preview-tile" />
                      <span className="theme-preview-line" />
                      <span className="theme-preview-line short" />
                    </span>
                    <span className="theme-meta">
                      <span className="theme-name">
                        {t.id === 'dark' ? <Moon size={15} strokeWidth={1.9} /> : <Sun size={15} strokeWidth={1.9} />}
                        {t.label}
                      </span>
                      <span className="theme-hint">{t.hint}</span>
                    </span>
                    {mode === t.id && <span className="theme-check"><Check size={13} strokeWidth={3} /></span>}
                  </button>
                ))}
              </div>

              <button className="welcome-cta" onClick={next}>
                Continuer <ArrowRight size={17} />
              </button>
            </motion.section>
          )}

          {/* ─────────── 2. la clé Gemini ───────────
              Une seule clé, et c'est celle qui fait le travail : c'est
              elle qui analyse les goûts et compose le blend. On la
              demande ici, au moment où la personne comprend à quoi elle
              sert — pas dans un écran de réglages qu'on découvre trois
              jours plus tard. Facultatif : sans clé, l'app compose par
              voisinage et le dit. */}
          {step === 1 && (
            <motion.section
              key="keys"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="welcome-title">La clé qui compose.</h1>
              <p className="welcome-sub">
                SoundBlend utilise Gemini pour lire tes goûts et choisir les morceaux.
                Ta clé reste dans ce navigateur — elle n’est envoyée qu’à Google.
                Facultative : sans elle, l’app compose par voisinage et le dit.
              </p>

              <label className="welcome-field">
                <span>Clé API Gemini</span>
                <input
                  type="password"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Colle ta clé ici"
                  aria-label="Clé API Gemini"
                />
              </label>

              <p className="welcome-note welcome-note--tight">
                Gratuite, et deux minutes à obtenir :{' '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                  aistudio.google.com/app/apikey
                </a>
                . Tu peux la mettre plus tard dans Réglages.
              </p>

              <div className="welcome-actions">
                <button className="welcome-cta" onClick={() => { saveKey(); next(); }}>
                  {geminiKey.trim() ? 'Continuer' : 'Plus tard'} <ArrowRight size={17} />
                </button>
                <button className="welcome-back" onClick={() => setStep((s) => s - 1)}>Retour</button>
              </div>
            </motion.section>
          )}

          {/* ─────────── 3. le compte ─────────── */}
          {step === 2 && (
            <motion.section
              key="account"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="welcome-title">Ton compte Google.</h1>
              <p className="welcome-sub">
                Il sert à lire tes playlists, à y exporter les blends, et à retrouver tes
                goûts sur ton autre téléphone ou ton ordinateur.
              </p>
              <p className="welcome-note welcome-note--tight">
                La synchro ne touche à rien de ton Drive : elle range un seul petit fichier
                dans un espace privé que Google réserve à SoundBlend. Tu ne le vois pas,
                personne d’autre ne le voit.
              </p>
              <p className="welcome-note welcome-note--tight">
                La connexion n’est possible que si l’application a un identifiant Google
                (un « ID client OAuth ») — celui du propriétaire de l’app, pas le tien.
                Sans lui, tu as une bibliothèque d’exemple et la recherche YouTube.
              </p>

              {isAuthenticated ? (
                <div className="welcome-account">
                  {userProfile?.avatarUrl
                    ? <img src={userProfile.avatarUrl} alt="" />
                    : <span className="welcome-avatar-fallback">{(userProfile?.name || '?').charAt(0)}</span>}
                  <span>
                    <span className="welcome-account-name">{userProfile?.name || 'Compte connecté'}</span>
                    <span className="welcome-account-mail">{userProfile?.email || 'Prêt à composer'}</span>
                  </span>
                  <Check size={16} className="welcome-ok" />
                </div>
              ) : (
                <button className="welcome-google" onClick={connect} disabled={busy}>
                  {busy ? <Loader2 size={17} className="anim-spin" /> : <GoogleGlyph />}
                  {busy ? 'Connexion en cours…' : 'Se connecter avec Google'}
                </button>
              )}

              <div className="welcome-actions">
                <button className="welcome-cta" onClick={next}>
                  {isAuthenticated ? 'Continuer' : 'Plus tard'} <ArrowRight size={17} />
                </button>
                {step > 0 && (
                  <button className="welcome-back" onClick={() => setStep((s) => s - 1)}>
                    Retour
                  </button>
                )}
              </div>
              {!isAuthenticated && (
                <p className="welcome-note">
                  Sans compte, une bibliothèque d’exemple t’attend — tu verras toute l’application.
                </p>
              )}
            </motion.section>
          )}

          {/* ─────────── 4. prêt ─────────── */}
          {step === 3 && (
            <motion.section
              key="ready"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="welcome-title">Tout est prêt.</h1>
              <p className="welcome-sub">
                Choisis quelques morceaux, l’IA compose le reste. Commence par ce que tu
                écoutes en ce moment.
              </p>

              <ul className="welcome-steps">
                <li><span>1</span> Tu coches trois ou quatre morceaux.</li>
                <li><span>2</span> Tu choisis la durée et l’audace.</li>
                <li><span>3</span> Le blend apparaît, avec le pourquoi de chaque titre.</li>
              </ul>

              <button className="welcome-cta" onClick={finishOnboarding}>
                Entrer dans SoundBlend <ArrowRight size={17} />
              </button>
            </motion.section>
          )}
        </AnimatePresence>

        <div className="welcome-dots" aria-hidden>
          {[0, 1, 2, 3].map((i) => <span key={i} data-on={i === step} />)}
        </div>
      </div>
    </div>
  );
};

/* le « G » de Google, en SVG inline */
const GoogleGlyph = () => (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.2 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4.1H24v8.4h12.7c-.3 2.1-1.6 5.2-4.5 7.3l7.7 6c4.5-4.2 6.6-10.3 6.6-17.6z" />
    <path fill="#FBBC05" d="M10.5 28.7A14.6 14.6 0 0 1 9.7 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.9l-7.7-6c-2.1 1.4-4.8 2.4-8.2 2.4-6.3 0-11.6-3.7-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
);
