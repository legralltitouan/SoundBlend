import React from 'react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';

/** Un message et une annulation restent disponibles même si l'on change
    de vue. Aucun jeton, identifiant ni détail brut de Google n'est affiché. */
export const GoogleLoginStatus: React.FC<{ page?: boolean }> = ({ page = false }) => {
  const { googleLoginState, retryGoogleLogin, cancelGoogleLogin, dismissGoogleLoginError } = useData();
  const { showToast } = useUI();
  if (googleLoginState.phase === 'idle') return null;

  const isError = googleLoginState.phase === 'error';
  const message = googleLoginState.phase === 'waiting'
    ? 'Redirection vers Google en cours… Si rien ne se passe, recharge cette page puis réessaie.'
    // waiting-long appartient à l’ancien parcours popup conservé pour comparaison.
    : googleLoginState.phase === 'waiting-long'
      ? 'SoundBlend attend toujours Google : prends ton temps, ce message n’annule pas la connexion. Si la fenêtre Google s’est fermée et que tu n’es toujours pas connecté après quelques secondes, utilise Réessayer et choisis à nouveau ton compte.'
      : googleLoginState.phase === 'verifying'
        ? 'Réponse reçue. Vérification du compte auprès de Google…'
        : googleLoginState.phase === 'error' ? googleLoginState.message : '';
  const code = googleLoginState.phase === 'waiting-long'
    ? (googleLoginState.googleMessageSeen ? 'attente_message_google' : 'attente_sans_message_google')
    : isError ? googleLoginState.code : '';
  const content = (
    <div className="sb-google-status" data-error={isError}>
      <div role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'}>
        <strong>Connexion Google</strong>
        <p>{message}</p>
        {code && <small>Code : {code}</small>}
      </div>
      {googleLoginState.phase === 'waiting-long' && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => { void retryGoogleLogin().catch((e) => showToast(e instanceof Error ? e.message : 'Connexion impossible.')); }}
          aria-label="Réessayer après fermeture de Google"
        >
          Réessayer
        </button>
      )}
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={isError ? dismissGoogleLoginError : cancelGoogleLogin}
        aria-label={isError ? 'Fermer le message de connexion' : 'Annuler la connexion Google'}
      >
        {isError ? 'Fermer' : 'Annuler'}
      </button>
    </div>
  );
  return page ? <div className="sb-google-status-frame">{content}</div> : content;
};
