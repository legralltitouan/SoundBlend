import React, { useEffect, useState } from 'react';
import {
  KeyRound, ShieldCheck, Check, ExternalLink, Palette, MonitorSmartphone,
  Loader2, Cpu, Download, Smartphone, Share, Plus, CheckCircle2, Cloud, Ban, X,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { Button, ModeSwitch } from '../ui';
import { inspectModels } from '../../services/gemini';
import { useInstall, InstallHint, installPossible } from '../../lib/pwa';
import { clientIdGoogle, GEMINI_API_KEY } from '../../config/app';
import { getExclusionRecords } from '../../services/storage';

/* Réglages : apparence (clair / sombre), compte YouTube, clés & API.
   Le modèle Gemini n'est plus un choix : la cascade est automatique. */
export const SettingsView: React.FC = () => {
  const { settings, saveSettings, isAuthenticated, userProfile, login, logout, syncState, exclusions, blockTrack, unblockExclusion } = useData();
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
  const [banArtist, setBanArtist] = useState('');
  const [banTitle, setBanTitle] = useState('');
  useEffect(() => setGeminiKey(settings.geminiApiKey || ''), [settings.geminiApiKey]);
  const records = getExclusionRecords().filter((r) => !r.deleted);
  const addBan = (kind: 'track' | 'artist') => {
    try {
      blockTrack({ artist: banArtist, title: banTitle }, kind);
      setBanTitle(''); if (kind === 'artist') setBanArtist('');
      showToast(kind === 'artist' ? 'Artiste bloqué.' : 'Musique bloquée.');
    } catch (e: any) { showToast(e?.message || 'Impossible de bloquer.'); }
  };

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

      {/* compte — c'est aussi la synchro : une seule connexion pour tout */}
      <Card
        icon={<ShieldCheck size={17} />}
        title="Compte Google"
        sub={
          isAuthenticated
            ? `Connecté en tant que ${userProfile?.name || 'ton compte'}`
            : 'Non connecté — une bibliothèque d’exemple est affichée.'
        }
      >
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
        {/* ── la synchro : une ligne, pas un réglage ──
            Elle se fait toute seule dès qu'il y a un changement, et se
            rattrape toutes les trois minutes si un envoi a été manqué.
            Il n'y a donc rien à boutonner — sauf quand Google refuse, et
            dans ce cas un seul geste suffit. */}
        {isAuthenticated && (
          <p className="ink-3 sb-sync-line">
            <Cloud size={13} strokeWidth={1.7} />
            <span>
              {syncState.phase === 'sans-portee'
                ? 'La synchro demande un accès Drive qui manque à cette connexion.'
                : syncState.phase === 'erreur'
                  ? 'Synchro en attente — tes données restent sur cet appareil ; un nouvel essai sera fait quand l’app sera ouverte et connectée.'
                  : syncState.phase === 'envoi'
                    ? 'Synchronisation en cours…'
                    : 'Synchronisation active : exclusions, historique récent, mode, clé Gemini et blends sont échangés avec ton compte.'}
            </span>
            {syncState.phase === 'sans-portee' && (
              <button className="btn-ghost" onClick={login}>Réactiver</button>
            )}
          </p>
        )}
        {isAuthenticated && <p className="ink-3" style={{ margin: '8px 0 0', fontSize: 11.5, lineHeight: 1.45 }}>
          Après des changements simultanés, laisse les appareils connectés quelques minutes pour qu’ils se relisent. Drive ne garantit pas une fusion atomique ; hors ligne, l’envoi et le nettoyage attendent la connexion.
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
          <p className="sb-field-note" style={{ marginTop: 0 }}>
            {exclusions.tracks.length} musique(s) · {exclusions.artists.length} artiste(s). Bloquer une musique ne bloque pas automatiquement son artiste.
            Les anciens pouces ne sont pas convertis en blocages.
          </p>
          {records.length ? <div className="sb-exclusion-list">
            {records.map((r) => <div className="sb-exclusion-row" key={r.id}>
              <span><strong>{r.kind === 'artist' ? r.artist : r.title}</strong><small>{r.kind === 'artist' ? 'Artiste' : `Musique · ${r.artist}`}</small></span>
              <button className="chip" aria-label={`Débloquer ${r.kind === 'artist' ? r.artist : r.title}`} onClick={() => { unblockExclusion(r.id); showToast('Exclusion retirée.'); }}><X size={14} /> Débloquer</button>
            </div>)}
          </div> : <p className="sb-field-note">Aucune exclusion pour le moment.</p>}
          <div className="sb-exclusion-add">
            <label>Artiste<input value={banArtist} onChange={(e) => setBanArtist(e.target.value)} placeholder="Nom de l’artiste" /></label>
            <label>Musique <span className="ink-3">(pour bloquer un titre)</span><input value={banTitle} onChange={(e) => setBanTitle(e.target.value)} placeholder="Titre du morceau" /></label>
            <div className="sb-exclusion-buttons">
              <button className="chip" disabled={!banArtist.trim() || !banTitle.trim()} onClick={() => addBan('track')}>Bloquer cette musique</button>
              <button className="chip" disabled={!banArtist.trim()} onClick={() => addBan('artist')}>Bloquer cet artiste</button>
            </div>
          </div>
        </Card>
      </div>

      {/* clés */}
      <Card
        icon={<KeyRound size={17} />}
        title="Clés & API"
        sub={
          isAuthenticated
            ? 'La clé est enregistrée en clair dans les données privées de l’application sur ton Drive et suit ton compte sur tes autres appareils.'
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
          Facultative pour un blend classique ; l’assistant et ses consignes ont besoin de Gemini. Sans clé, le blend classique utilise le voisinage YouTube.
        </p>
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <Button onClick={save}><Check size={16} /> Enregistrer</Button>
        <span style={{ flex: 1 }} />
        <span className="sb-footnote" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
          <MonitorSmartphone size={13} strokeWidth={1.7} /> SoundBlend AI · v6.9.31
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
