import React, { useEffect, useState } from 'react';
import {
  KeyRound, ShieldCheck, Check, ExternalLink, Palette, MonitorSmartphone,
  Loader2, Cpu, Download, Smartphone, Share, Plus, CheckCircle2, Cloud, Ban, ListMusic, ChevronRight,
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
  const { settings, saveSettings, isAuthenticated, accountKnown, authReady, authNotice, userProfile, login, logout, syncState, exclusions } = useData();
  const { mode, toggleMode, showToast, restartOnboarding, openActionSheet } = useUI();
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
  useEffect(() => setGeminiKey(settings.geminiApiKey || ''), [settings.geminiApiKey]);

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

  const [connecting, setConnecting] = useState(false);
  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try { await login(); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Connexion impossible.'); }
    finally { setConnecting(false); }
  };
  const disconnect = () => {
    const pending = syncState.enAttente && accountKnown;
    logout();
    showToast(pending ? 'Modifications en attente conservées : reconnecte ce même compte pour les envoyer.' : 'Compte déconnecté. Ses données restent séparées sur cet appareil.');
  };
  const save = () => {
    try {
      saveSettings({ googleClientId: settings.googleClientId, youtubeApiKey: settings.youtubeApiKey, geminiApiKey: geminiKey.trim() });
      showToast('Réglages enregistrés sur cet appareil.');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Réglages non enregistrés.'); }
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

      {/* compte — c'est aussi la synchro : une seule connexion pour tout */}
      <Card
        icon={<ShieldCheck size={17} />}
        title="Compte Google"
        sub={
          isAuthenticated
            ? `Connecté en tant que ${userProfile?.name || 'ton compte'}`
            : accountKnown ? `Session expirée pour ${userProfile?.name || 'ce compte'} — données locales conservées.`
              : 'Non connecté — espace local séparé et bibliothèque d’exemple.'
        }
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isAuthenticated && <Button onClick={() => void connect()} disabled={!authReady || connecting}>{connecting ? 'Connexion en cours…' : accountKnown ? 'Reconnecter ce compte' : 'Connecter mon compte'}</Button>}
          {accountKnown && <Button variant="outline" onClick={disconnect}>Se déconnecter</Button>}
        </div>
        {!clientIdGoogle(settings.googleClientId) && (
          <p className="sb-field-note" style={{ marginTop: 10 }}>
            Cette installation n’a pas d’identifiant Google : la connexion ne peut pas
            s’ouvrir. Celui qui héberge l’app le renseigne une fois dans
            <code> src/config/app.ts </code> — c’est public, et les personnes qui
            utilisent l’app n’ont jamais à s’en occuper.
          </p>
        )}
        {authNotice && <p className="sb-field-note" role="status">{authNotice}</p>}
        {accountKnown && <p className="ink-3 sb-sync-line" role="status">
          <Cloud size={13} strokeWidth={1.7} />
          <span>{syncState.phase === 'envoi' ? 'Synchronisation en cours…'
            : syncState.phase === 'pret' && !syncState.enAttente ? 'Dernière synchronisation vérifiée sur ce compte.'
              : syncState.message || (syncState.enAttente ? 'Modifications en attente de synchronisation.' : 'Synchronisation en préparation.')}</span>
        </p>}
        {accountKnown && isAuthenticated && syncState.phase === 'sans-portee' && <div style={{ marginTop: 8 }}>
          <button className="btn-ghost" disabled={connecting} onClick={() => void connect()}>Réactiver les autorisations</button>
        </div>}
        <p className="ink-3" style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.45 }}>
          La synchronisation est automatique après une modification et au retour dans l’application ; les changements distants sont aussi recherchés régulièrement tant que l’app reste ouverte et connectée.
        </p>
        <p className="ink-3" style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.45 }}>
          Les anciennes données locales restent séparées : elles ne sont jamais importées automatiquement dans un compte. Chaque compte garde ses propres données, y compris sa clé et son thème.
        </p>
        {accountKnown && <p className="ink-3" style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.45 }}>
          Mets à jour tous les appareils : une ancienne version peut encore mélanger les comptes. Après des changements simultanés, laisse-les se relire ; les conflits sur un même blend sont résolus par version entière, sans garantie de fusion atomique. La durée de 14 jours dépend de l’horloge de l’appareil. Conversation, file et position de lecture ne sont pas synchronisées.
        </p>}
        <p className="ink-3" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
          Une playlist manque ? Vérifie que le compte choisi dans la fenêtre Google est bien celui où se trouvent tes playlists.
        </p>
        <details className="sb-field-note" style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer' }}>Des pubs malgré YouTube Premium ?</summary>
          <p style={{ margin: '8px 0 0' }}>
            La connexion à SoundBlend ne connecte pas automatiquement le lecteur YouTube intégré.
            Dans le même navigateur, connecte-toi sur YouTube avec le compte qui possède
            YouTube Premium, puis vérifie que les cookies YouTube ne sont pas bloqués et recharge SoundBlend.
            YouTube Music Premium seul ne couvre pas forcément toutes les vidéos.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            <a href="https://www.youtube.com/paid_memberships" target="_blank" rel="noopener noreferrer">Vérifier mon abonnement</a>
            {' · '}
            <a href="https://support.google.com/youtube/answer/7437519?hl=fr" target="_blank" rel="noopener noreferrer">Aide YouTube</a>
          </p>
        </details>
      </Card>

      <div id="exclusions">
        <Card icon={<Ban size={17} />} title="Exclusions" sub="Ces musiques et artistes ne seront plus proposés. Synchronisés avec ton compte Google quand tu es connecté.">
          <div className="sb-exclusions-entry">
            <button type="button" className="sb-exclusions-entry__button" aria-label="Afficher la liste des exclusions" onClick={(e) => openActionSheet({ kind: 'exclusions', focusSearch: false }, e.currentTarget)}>
              <span className="sb-exclusions-entry__icon"><ListMusic size={18} /></span>
              <span className="sb-exclusions-entry__text"><strong>Afficher la liste des exclusions</strong><small>{exclusions.tracks.length} musique{exclusions.tracks.length !== 1 ? 's' : ''} · {exclusions.artists.length} artiste{exclusions.artists.length !== 1 ? 's' : ''}</small></span>
              <ChevronRight size={17} aria-hidden />
            </button>
            <button type="button" className="sb-exclusions-entry__button" aria-label="Ajouter une exclusion" onClick={(e) => openActionSheet({ kind: 'exclusions', focusSearch: true }, e.currentTarget)}>
              <span className="sb-exclusions-entry__icon sb-exclusions-entry__icon--accent"><Plus size={18} /></span>
              <span className="sb-exclusions-entry__text"><strong>Ajouter une exclusion</strong><small>Rechercher sur YouTube Music</small></span>
              <ChevronRight size={17} aria-hidden />
            </button>
          </div>
        </Card>
      </div>

      {/* clés */}
      <Card
        icon={<KeyRound size={17} />}
        title="Clés & API"
        sub={
          accountKnown
            ? 'La clé est stockée en clair dans ce navigateur et dans le fichier privé SoundBlend de ton Drive ; elle n’est pas chiffrée par l’application.'
            : 'La clé est stockée en clair dans l’espace local de ce navigateur, séparé de tes comptes.'
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
          Facultative pour un blend classique ; l’assistant et ses consignes ont besoin de Gemini. Sans clé, le blend classique utilise le voisinage YouTube.
        </p>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Button onClick={save}><Check size={16} /> Enregistrer</Button>
        <span style={{ flex: 1 }} />
        <span className="sb-footnote" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <MonitorSmartphone size={13} strokeWidth={1.7} /> SoundBlend AI · v6.9.36
        </span>
      </div>
    </div>
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
