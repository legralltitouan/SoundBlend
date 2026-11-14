import React, { useState } from 'react';
import {
  KeyRound, ShieldCheck, Check, ExternalLink, Palette, MonitorSmartphone,
  Loader2, Cpu, Download, Smartphone, Share, Plus, CheckCircle2, RefreshCw, CloudOff,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { Button, ModeSwitch } from '../ui';
import { inspectModels } from '../../services/gemini';
import { useInstall, InstallHint, installPossible } from '../../lib/pwa';
import { clientIdGoogle, GEMINI_API_KEY } from '../../config/app';

/* Réglages : apparence (clair / sombre), compte YouTube, clés & API.
   Le modèle Gemini n'est plus un choix : la cascade est automatique. */
export const SettingsView: React.FC = () => {
  const { settings, saveSettings, isAuthenticated, userProfile, login, logout, syncState, syncNow } = useData();
  const { mode, toggleMode, showToast, restartOnboarding } = useUI();
  const pwa = useInstall();
  /* aucune clé par défaut : si elles manquent, on le dit ici, en clair,
     au lieu de laisser l'app échouer au premier appel */
  /* une seule clé compte désormais : celle de Gemini. La clé YouTube
     n'est plus demandée — le compte Google la remplace (l'API YouTube
     l'accepte en jeton, c'est écrit dans sa documentation). On signale
     seulement ce qui manque vraiment pour que l'app soit complète. */
  /* la clé de l'application, si celui qui héberge l'app en a mis une,
     rend la clé personnelle inutile */
  const cleFournie = !!GEMINI_API_KEY;
  const missingKeys = [
    !settings.geminiApiKey && !cleFournie && 'ta clé Gemini (facultative)',
  ].filter(Boolean);

  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey || '');

  /* ── le diagnostic du moteur ──
     On demande à l'API, avec la clé saisie, ce qu'elle sait faire. Ce
     n'est pas une liste écrite dans l'app : c'est la réponse de Google,
     triée par la même fonction que celle qui choisit le modèle. */
  const [probe, setProbe] = useState<{ busy: boolean; models?: string[]; ecartes?: { nom: string; raison: string }[]; error?: string }>({ busy: false });
  const probeModels = async () => {
    const key = geminiKey.trim();
    if (!key) { setProbe({ busy: false, error: 'Saisis une clé Gemini d’abord.' }); return; }
    setProbe({ busy: true });
    const r = await inspectModels(key);
    setProbe({ busy: false, models: r.models, ecartes: r.ecartes, error: r.error });
  };

  const save = () => {
    saveSettings({
      googleClientId: settings.googleClientId,
      youtubeApiKey: settings.youtubeApiKey,
      geminiApiKey: geminiKey.trim(),
    });
    showToast('Réglages enregistrés.');
  };

  return (
    <div className="ytm-page">
      <header className="sb-hero sb-hero--compact">
        <h1>Réglages</h1>
        <p>Apparence, connexion YouTube et moteur IA.</p>
      </header>

      {/* apparence */}
      <Card icon={<Palette size={15} />} title="Mode" sub={mode === 'dark' ? 'Sombre — noir pur, accent rouge' : 'Clair — blanc pur, accent rouge'}>
        <Row label="Clair ou sombre">
          <ModeSwitch mode={mode} onToggle={toggleMode} />
        </Row>
        <Row label="Écran de bienvenue">
          <button className="btn-ghost" onClick={restartOnboarding}>Revoir l'introduction</button>
        </Row>
      </Card>

      {/* l'application, hors du navigateur */}
      <Card
        icon={<Smartphone size={17} />}
        title="Installer l’app"
        sub={
          pwa.installed
            ? 'SoundBlend tourne déjà comme une app, hors du navigateur.'
            : pwa.platform === 'ios'
              ? 'Sur iPhone et iPad : trois gestes dans Safari.'
              : 'Une icône sur l’écran d’accueil, et l’app s’ouvre en plein écran.'
        }
      >
        {pwa.installed ? (
          <p className="sb-install-done">
            <CheckCircle2 size={15} /> Installée — c’est bien cette fenêtre, sans barre d’adresse, que tu ouvres depuis l’icône.
          </p>
        ) : !installPossible() ? (
          <p className="ink-3" style={{ margin: 0, fontSize: 11.5 }}>
            L’installation demande une adresse sécurisée (https). Ouvert depuis un fichier
            local ou un aperçu, cette page ne peut pas s’installer.
          </p>
        ) : pwa.canInstall && pwa.platform !== 'ios' ? (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                onClick={async () => {
                  const r = await pwa.install();
                  if (r === 'accepted') showToast('SoundBlend est installé sur ton écran d’accueil.');
                  else if (r === 'unavailable') showToast('L’installation n’est pas disponible dans ce navigateur.');
                }}
              >
                <Download size={16} /> Installer SoundBlend
              </Button>
              <span className="ink-3" style={{ fontSize: 11.5 }}>
                Aucune boutique, aucun compte : le navigateur pose l’icône.
              </span>
            </div>
          </>
        ) : pwa.platform === 'ios' ? (
          <>
            <InstallHint platform="ios" />
            <p className="sb-install-note">
              <Share size={13} /> Le bouton Partager est en bas de Safari, au milieu.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button variant="ghost" onClick={() => window.open(location.href, '_blank')}>
                <ExternalLink size={15} /> Ouvrir dans Chrome
              </Button>
              <span className="ink-3" style={{ fontSize: 11.5 }}>
                Puis menu ⋮ → « Installer l’application ».
              </span>
            </div>
            <p className="sb-install-note">
              <Plus size={13} /> Ce navigateur-ci ne propose pas l’installation : l’invitation
              apparaîtra dès que SoundBlend sera ouvert dans Chrome (ou Safari sur iPhone),
              à une adresse https.
            </p>
          </>
        )}
      </Card>

      {/* compte */}
      <Card icon={<ShieldCheck size={17} />} title="Compte YouTube" sub={isAuthenticated ? `Connecté en tant que ${userProfile?.name || 'compte YouTube'}` : 'Non connecté — une bibliothèque d’exemple est affichée.'}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isAuthenticated ? (
            <Button variant="outline" onClick={logout}>Se déconnecter</Button>
          ) : (
            <Button onClick={login}>Connecter mon compte</Button>
          )}
        </div>
        {!clientIdGoogle(settings.googleClientId) && (
          <p className="sb-field-note" style={{ marginTop: 10 }}>
            Cette installation n’a pas d’identifiant Google : la connexion ne peut pas
            s’ouvrir. Celui qui héberge l’app le renseigne une fois dans
            <code> src/config/app.ts </code> — c’est public, et les personnes qui
            utilisent l’app n’ont jamais à s’en occuper.
          </p>
        )}
        <p className="ink-3" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
          Une playlist manque ? Vérifie que le compte choisi dans la fenêtre Google est bien celui où se trouvent tes playlists.
        </p>
      </Card>

      {/* synchro */}
      <SyncCard
        connecte={isAuthenticated}
        etat={syncState}
        onConnecter={login}
        onSync={() => void syncNow()}
      />

      {/* clés */}
      <Card
        icon={<KeyRound size={17} />}
        title="Clés & API"
        sub={
          isAuthenticated
            ? 'Ta clé reste dans l’app — et, avec la synchro, dans ton Drive privé.'
            : 'Stockée uniquement dans ce navigateur.'
        }
      >
        {!!missingKeys.length && (
          <p className="sb-keys-missing">
            <KeyRound size={14} /> Il manque {missingKeys.join(' et ')} — tout reste sur cet appareil.
          </p>
        )}
        <Field label="Clé API Gemini" value={geminiKey} onChange={setGeminiKey} placeholder="Colle ta clé ici" />
        <p className="sb-field-note">
          La seule clé de toute l’application. Gratuite sur{' '}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">aistudio.google.com/app/apikey</a>.
          Facultative : sans clé, l’app compose par voisinage YouTube et l’écrit sur le blend.
        </p>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Button onClick={save}><Check size={16} /> Enregistrer</Button>
        <span style={{ flex: 1 }} />
        <span className="sb-footnote" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <MonitorSmartphone size={13} strokeWidth={1.7} /> SoundBlend AI · v6.9.22
        </span>
      </div>
    </div>
  );
};

/* ── la synchro ──
   Elle n'a qu'un bouton, et seulement quand il sert. Le reste du temps,
   elle dit simplement où elle en est : c'est tout ce qu'on demande à un
   réglage qui doit être invisible. */
const SyncCard: React.FC<{
  connecte: boolean;
  etat: { phase: string; dernierEnvoi?: string; message?: string };
  onConnecter: () => void;
  onSync: () => void;
}> = ({ connecte, etat, onConnecter, onSync }) => {
  const heure = etat.dernierEnvoi
    ? new Date(etat.dernierEnvoi).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const sous = !connecte
    ? 'Connecte ton compte : tes goûts, tes avis et tes blends suivront sur tous tes appareils.'
    : etat.phase === 'sans-portee'
      ? 'La connexion actuelle ne couvre pas le Drive : reconnecte-toi une fois pour l’activer.'
      : etat.phase === 'erreur'
        ? 'La synchro n’a pas abouti — rien n’est perdu, tout reste sur cet appareil.'
        : etat.phase === 'envoi'
          ? 'Enregistrement en cours…'
          : heure
            ? `Activée · enregistré à ${heure}`
            : 'Activée · en attente du premier envoi';

  return (
    <Card icon={<RefreshCw size={17} />} title="Synchro" sub={sous}>
      <p className="ink-3" style={{ margin: '0 0 10px', fontSize: 11.5 }}>
        Un fichier discret, rangé dans l’espace privé de ton Drive (invisible dans
        ton dossier) : goûts, avis, blends récents, clair ou sombre, et ta clé Gemini
        si tu en as une. Tes jetons de connexion n’y sont jamais.
      </p>
      {!connecte ? (
        <Button onClick={onConnecter}>Connecter mon compte</Button>
      ) : etat.phase === 'sans-portee' ? (
        <Button onClick={onConnecter}>Réactiver la synchro</Button>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="outline" onClick={onSync} disabled={etat.phase === 'envoi'}>
            {etat.phase === 'envoi'
              ? <><Loader2 size={15} className="anim-spin" /> Synchronisation…</>
              : <><RefreshCw size={15} /> Synchroniser maintenant</>}
          </Button>
          {etat.phase === 'erreur' && (
            <span className="ink-3" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CloudOff size={13} /> {etat.message || 'Nouvel essai au prochain geste.'}
            </span>
          )}
        </div>
      )}
    </Card>
  );
};

const Card: React.FC<{ icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }> = ({ icon, title, sub, children }) => (
  <section className="sb-setting">
    <div className="sb-setting-head">
      <span className="sb-setting-icon">{icon}</span>
      <div className="sb-setting-text">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </div>
    <div className="sb-setting-body">{children}</div>
  </section>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ fontSize: 13, color: 'var(--ink-2)', flex: 1 }}>{label}</span>
    {children}
  </div>
);

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
  <label style={{ display: 'grid', gap: 6 }}>
    <span className="ink-3" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
    <input className="field" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} />
  </label>
);
