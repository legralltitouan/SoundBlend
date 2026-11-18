import React from 'react';
import { useData } from '../../context/DataContext';

/** Un message et une annulation restent disponibles même si l'on change
    de vue. Aucun jeton, identifiant ni détail brut de Google n'est affiché. */
export const GoogleLoginStatus: React.FC<{ page?: boolean }> = ({ page = false }) => {
  const { googleLoginState, cancelGoogleLogin, dismissGoogleLoginError } = useData();
  if (googleLoginState.phase === 'idle') return null;

  const isError = googleLoginState.phase === 'error';
  const message = googleLoginState.phase === 'waiting'
    ? 'Termine la connexion dans la fenêtre Google. Si elle ne s’ouvre pas, autorise les fenêtres pour ce site, puis annule et réessaie.'
    : googleLoginState.phase === 'waiting-long'
      ? 'SoundBlend attend toujours la réponse de Google. Si la fenêtre est ouverte, termine la validation ; si elle est fermée sans connexion, tu peux annuler et réessayer.'
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
