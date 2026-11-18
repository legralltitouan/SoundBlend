import React from 'react';
import { useData } from '../../context/DataContext';

/** Un message et une annulation restent disponibles même si l'on change
    de vue. Aucun jeton, identifiant ni détail brut de Google n'est affiché. */
export const GoogleLoginStatus: React.FC<{ page?: boolean }> = ({ page = false }) => {
  const { googleLoginState, cancelGoogleLogin, dismissGoogleLoginError } = useData();
  if (googleLoginState.phase === 'idle') return null;

  const isError = googleLoginState.phase === 'error';
  const message = googleLoginState.phase === 'waiting'
    ? 'Termine la connexion dans la fenêtre Google. Tu peux annuler ici si nécessaire.'
    : googleLoginState.phase === 'window-closed'
      ? 'Google signale que sa fenêtre est peut-être fermée. Si elle est encore ouverte, termine la validation. Si tu viens de valider, attends quelques secondes ; sinon, annule et réessaie.'
      : googleLoginState.phase === 'verifying'
        ? 'Réponse reçue. Vérification du compte auprès de Google…'
        : googleLoginState.phase === 'error' ? googleLoginState.message : '';
  const code = googleLoginState.phase === 'window-closed' ? 'popup_closed'
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
