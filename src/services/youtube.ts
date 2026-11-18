import { Playlist, Track, UserProfile } from '../types';
import { MOCK_PLAYLISTS } from '../data/mockData';
import { artistMatches, getStoredSettings, isExcluded } from './storage';
import { accountRevision, selectAccountScope } from './accountScope';
import { cleanTitle, matchesAsked, norm } from '../lib/track';
import type { Video } from './search';
import { pipedSearch, verifyVideo } from './search';

/* Aucun appel réseau ne doit pouvoir pendre indéfiniment : au-delà de
   dix secondes, on considère que c'est perdu et on passe à la suite. */
export const withTimeout = async <T,>(p: Promise<T>, ms = 10000, fallback: T): Promise<T> => {
  let timer: any;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Limiter toute la lecture, corps JSON compris : recevoir les en-têtes
    ne doit pas laisser l’assistant attendre indéfiniment une page bloquée. */
const fetchLibrary = async (url: string, init: RequestInit): Promise<{ resp: Response; data: any }> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException('Délai YouTube dépassé', 'AbortError'));
    }, 12000);
  });
  try {
    const read = (async () => {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      return { resp, data: resp.ok ? await resp.json() : null };
    })();
    return await Promise.race([read, deadline]);
  } finally { clearTimeout(timer!); }
};

const decodeEntities = (s: string) =>
  (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<');

/* Les droits demandés, en un seul endroit.
   `drive.appdata` ne donne accès qu'à un dossier caché réservé à cette
   application : ni les fichiers de la personne, ni son Drive visible.
   Google classe ce scope « non sensible » ; d'autres droits demandés
   peuvent nécessiter une vérification ou déclencher un avertissement.
   C'est ce scope qui permet à la synchro d'exister. */
const SCOPE_YOUTUBE =
  'https://www.googleapis.com/auth/youtube ' +
  'https://www.googleapis.com/auth/drive.appdata ' +
  'https://www.googleapis.com/auth/userinfo.profile';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
/* une vidéo vérifiée l'est pour une heure : ni quota, ni clé, mais pas
   besoin de la redemander à chaque morceau du blend non plus */
const jouableCache = new Map<string, { at: number; val: { ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string } }>();
const JOUABLE_TTL = 60 * 60 * 1000;
const TOKEN_KEY = 'soundblend_yt_token';
const TOKEN_EXP_KEY = 'soundblend_yt_token_exp';
const USER_KEY = 'soundblend_yt_user';
const AUTH_KEY = 'soundblend_google_session_v2';

/** État public du parcours, sans jeton, adresse ni données du compte. */
export type GoogleLoginState =
  | { phase: 'idle' | 'waiting' | 'verifying' }
  | { phase: 'waiting-long'; googleMessageSeen: boolean }
  | { phase: 'error'; code: string; message: string };

class GoogleLoginError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GoogleLoginError';
  }
}

/** Une tentative remplacée par un clic explicite n'est pas un nouvel échec
    à afficher : le nouveau parcours possède son propre état et sa réponse. */
export const isSupersededGoogleLogin = (error: unknown): boolean =>
  error instanceof GoogleLoginError && error.code === 'superseded';

/** Ne jamais afficher la réponse brute de Google : elle peut contenir des
    informations sensibles. Seuls des codes OAuth connus sont conservés. */
const googleOAuthError = (code: unknown): GoogleLoginError => {
  switch (code) {
    case 'access_denied':
      return new GoogleLoginError('access_denied', 'Google n’a pas accordé l’autorisation. Le compte choisi n’a pas été activé.');
    case 'invalid_scope':
      return new GoogleLoginError('invalid_scope', 'Google refuse les autorisations demandées par cette installation.');
    case 'invalid_client':
    case 'unauthorized_client':
    case 'origin_mismatch':
    case 'redirect_uri_mismatch':
      return new GoogleLoginError(code, 'Google refuse la configuration de connexion de cette installation. Vérifie l’identifiant OAuth et l’origine autorisée.');
    case 'server_error':
    case 'temporarily_unavailable':
      return new GoogleLoginError(code, 'Google indique que la connexion est temporairement indisponible. Réessaie plus tard.');
    default:
      return new GoogleLoginError('oauth_error', 'Google n’a pas autorisé la connexion. Le compte choisi n’a pas été activé.');
  }
};

/* ── la mémoire des clips : un morceau ne change pas de clip d'une
   écoute à l'autre, et on ne refait pas la recherche à chaque ouverture du
   lecteur. Une heure suffit — et un « pas de clip » se retente plus tard,
   parce que les clips sortent. ── */
const clipCache = new Map<string, { at: number; val: string | null }>();
const clipEnCours = new Map<string, Promise<string | null>>();
const CLIP_TTL = 60 * 60 * 1000;

/* la comparaison de titres : sans accents, sans casse, sans ponctuation —
   « Stomp!" et « stomp » sont le même morceau */
const normaliser = (t: string): string =>
  (t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(official|video|clip|hd|hq|version|single|album|feat|ft)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Cache des recherches libres, distinct de celui des morceaux résolus.
const searchCache = new Map<string, string>();
export type PlayableVideo = {
  videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string; verifie?: boolean;
  /** Identité renvoyée par YouTube, à contrôler aussi après résolution. */
  sourceTitle?: string; sourceArtist?: string;
};

/** Un élément de playlist, distinct de la vidéo : deux occurrences de la
    même vidéo ont deux identifiants d'élément et ne doivent pas être perdues. */
export type PlaylistSnapshotItem = { itemId: string; videoId: string };
export type PlaylistMove = { itemId: string; position: number };
export type AssistantCatalogTrack = Track & { youtubeTitle: string; youtubeChannel: string };
/** Tenir compte aussi de l'identité brute de la chaîne et de la vidéo,
    notamment lorsqu'une exclusion est ajoutée après la recherche. */
export const isAssistantTrackExcluded = (track: Track): boolean => {
  const raw = track as Partial<AssistantCatalogTrack>;
  return isExcluded(track) || (!!raw.youtubeTitle && isExcluded({ videoId: track.videoId, title: raw.youtubeTitle, artist: raw.youtubeChannel }));
};
const findCache = new Map<string, { at: number; val: PlayableVideo | null }>();
const FIND_TTL = 60 * 60 * 1000;

/** Le titre doit correspondre et, quand la vidéo nomme explicitement un
    artiste ou une chaîne « Topic », celui-ci ne doit pas être différent.
    Une chaîne de label, moins précise, ne suffit pas à conclure. */
export const matchesVideoIdentity = (askedTitle: string, askedArtist: string, videoTitle: string, videoAuthor = ''): boolean => {
  if (!videoTitle.trim() || !matchesAsked(askedTitle, askedArtist, videoTitle, videoAuthor)) return false;
  if (!askedArtist.trim()) return true;
  const namedArtist = cleanTitle(videoTitle).artist || '';
  const topic = /[-–—]\s*topic$/i.test(videoAuthor) ? videoAuthor : '';
  const agrees = (candidate: string) => artistMatches(candidate, askedArtist) || artistMatches(askedArtist, candidate);
  return [namedArtist, topic].filter(Boolean).every(agrees);
};
// Cache playlist tracks
const playlistTracksCache = new Map<string, Track[]>();

declare global {
  interface Window {
    google?: any;
    __sbOAuthReturn?: { token: string | null; error: string | null; state: string | null; scope: string | null; expiresIn: string | null; receivedAt: number };
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

export class YouTubeService {
  private accessToken: string | null = null;
  private owner: string | null = null;
  private profile: UserProfile | null = null;
  private expiresAt = 0;
  private serial = 0;
  private attempt = 0;
  private expiredNotified = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelLogin: ((replaced?: boolean) => void) | null = null;
  // Référence utilisée uniquement par l'ancien parcours popup conservé pour les tests historiques.
  private loginClient: any = null;
  private loginState: GoogleLoginState = { phase: 'idle' };
  private operations = new Set<AbortController>();
  private restoreWarning = '';
  private abortOperations(): void { this.operations.forEach((c) => c.abort()); this.operations.clear(); }

  constructor() {
    // sessionStorage est propre à l'onglet : changer de compte dans un autre
    // onglet ne change ni son jeton ni sa portée de stockage locale.
    try {
      const s = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null');
      if (s && typeof s.token === 'string' && typeof s.owner === 'string'
          && /^[A-Za-z0-9._-]{1,128}$/.test(s.owner) && Number.isFinite(s.expiresAt)) {
        this.accessToken = s.token; this.owner = s.owner; this.expiresAt = s.expiresAt;
        this.profile = s.profile || null;
        selectAccountScope(s.owner);
        this.armExpiry();
      }
    } catch { /* pas de session fiable : rester dans l'espace local */ }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.owner && !this.isAuthenticated()) this.notifyExpired();
    });
  }
  private persistSession(): void {
    try {
      if (this.owner && this.accessToken) sessionStorage.setItem(AUTH_KEY, JSON.stringify({
        token: this.accessToken, owner: this.owner, expiresAt: this.expiresAt, profile: this.profile,
      }));
      else sessionStorage.removeItem(AUTH_KEY);
    } catch { /* la session reste en mémoire jusqu'à la fermeture de l'onglet */ }
  }
  private armExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (!this.owner || !this.accessToken) return;
    const delay = Math.max(0, this.expiresAt - Date.now());
    this.expiryTimer = setTimeout(() => {
      if (this.isAuthenticated()) this.armExpiry(); else this.notifyExpired();
    }, Math.min(delay + 5, 2147483000));
  }
  private notifyExpired(): void {
    if (this.expiredNotified || !this.owner) return;
    this.expiredNotified = true;
    this.expiresAt = 0; this.persistSession();
    this.serial++; this.abortOperations();
    window.dispatchEvent(new CustomEvent('sb:auth-expired'));
  }
  /** Un refus 401 invalide le jeton, sans changer d'espace de données. */
  public invalidateToken(token: string | null): void {
    if (!token || token !== this.accessToken) return;
    this.expiresAt = 0; this.persistSession(); this.notifyExpired();
  }
  public isAuthenticated(): boolean { return !!this.owner && !!this.accessToken && Date.now() < this.expiresAt; }
  public getAccessToken(): string | null { return this.isAuthenticated() ? this.accessToken : null; }
  public getUserProfile(): UserProfile | null { return this.profile; }
  public accountId(): string | null { return this.owner; }
  public sessionRevision(): number { return this.serial; }
  public getRestoreWarning(): string { return this.restoreWarning; }
  public getLoginState(): GoogleLoginState { return this.loginState; }
  private setLoginState(state: GoogleLoginState): void {
    this.loginState = state;
    window.dispatchEvent(new CustomEvent('sb:google-login-state'));
  }
  public cancelPendingLogin(): void { this.cancelLogin?.(); }
  /** Clic explicite seulement, après l'aide d'attente. La fenêtre précédente
      est supposée fermée par l'utilisateur ; on n'en déduit rien de Google.
      Invalider son callback AVANT d'ouvrir le nouveau client, sans await :
      un ancien retour ne doit jamais se substituer au compte choisi ensuite. */
  public retryPendingLogin(clientId?: string): Promise<string> | null {
    if (!this.cancelLogin || this.loginState.phase !== 'waiting-long') return null;
    this.cancelLogin(true);
    return this.login(clientId);
  }
  public dismissLoginError(): void {
    if (!this.cancelLogin && this.loginState.phase === 'error') this.setLoginState({ phase: 'idle' });
  }
  private assertSession(token: string | null, serial: number, scopeRevision: number): void {
    if (!token || token !== this.accessToken || serial !== this.serial || scopeRevision !== accountRevision() || !this.isAuthenticated()) {
      throw new Error('La session Google a changé ou a expiré pendant cette opération. Reconnecte-toi et réessaie.');
    }
  }

  /** Aucun nom ni adresse ne sert à identifier un compte : l'ID stable est
      obtenu auprès de Google avec LE jeton qui sera utilisé pour la synchro. */
  private async verifiedProfile(token: string): Promise<{ id: string; profile: UserProfile }> {
    const { resp, data } = await fetchLibrary('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    if (!resp.ok) {
      throw new Error(`Impossible de vérifier l’identité Google (HTTP ${resp.status}). Le compte choisi n’a pas été activé.`);
    }
    if (typeof data?.id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(data.id)) {
      throw new Error('Impossible de vérifier l’identité Google : identifiant de compte absent ou invalide. Le compte choisi n’a pas été activé.');
    }
    return { id: data.id, profile: {
      name: data.name || 'Compte Google', email: data.email || '', avatarUrl: data.picture || '',
    } };
  }
  private activate(token: string, expiresAt: number, id: string, profile: UserProfile, attempt: number): boolean {
    window.dispatchEvent(new CustomEvent('sb:auth-changing'));
    // Un écouteur peut déconnecter ou annuler pendant cet événement
    // synchrone : ne pas réactiver un compte après cette décision.
    if (attempt !== this.attempt) return false;
    this.serial++; this.abortOperations();
    playlistTracksCache.clear();
    this.owner = id; this.profile = profile; this.accessToken = token; this.expiresAt = expiresAt;
    this.expiredNotified = false; this.restoreWarning = '';
    selectAccountScope(id);
    this.persistSession(); this.armExpiry();
    // Après une connexion vérifiée, l'ancien jeton global ne doit plus
    // réapparaître dans un nouvel onglet à la place du compte choisi.
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXP_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('sb:auth-changed'));
    return true;
  }

  /** Mise à jour depuis l'ancien jeton partagé : on vérifie d'abord son
      identité. Les données historiques sans compte restent séparées. */
  public async restoreLegacySession(): Promise<boolean> {
    // Une restauration ne doit pas invalider une fenêtre Google déjà ouverte.
    if (this.cancelLogin) return false;
    if (this.owner) return this.isAuthenticated();
    let token: string | null = null, expiresAt = 0;
    try { token = localStorage.getItem(TOKEN_KEY); expiresAt = Number(localStorage.getItem(TOKEN_EXP_KEY)); } catch { return false; }
    if (!token) return false;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      this.restoreWarning = 'L’ancienne session Google a expiré ou sa durée est inconnue : reconnecte ton compte.';
      return false;
    }
    const attempt = ++this.attempt;
    try {
      const verified = await this.verifiedProfile(token);
      if (attempt !== this.attempt || this.owner) return false;
      if (expiresAt <= Date.now()) {
        this.restoreWarning = 'L’ancienne session Google a expiré pendant sa vérification : reconnecte ton compte.';
        return false;
      }
      if (!this.activate(token, expiresAt, verified.id, verified.profile, attempt)) return false;
      try {
        if (localStorage.getItem(TOKEN_KEY) === token) {
          localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXP_KEY); localStorage.removeItem(USER_KEY);
        }
      } catch { /* sans conséquence sur l'isolation */ }
      return true;
    } catch {
      if (attempt === this.attempt) this.restoreWarning = 'Ancienne session non vérifiée : reconnecte ton compte pour activer la synchronisation.';
      return false;
    }
  }

  public async initOAuth(_clientId: string): Promise<void> {
    // Le client GIS est créé au moment du clic, avec le callback de cette
    // tentative seulement. Aucun callback de préparation ne peut connecter.
  }
  /** Parcours courant : retour sur la base autorisée, sans message entre fenêtres. */
  public login(clientId?: string): Promise<string> {
    const id = clientId || getStoredSettings().googleClientId;
    if (!id) {
      const e = new GoogleLoginError('client_missing', "Cette installation n'a pas d'identifiant Google.");
      this.setLoginState({ phase: 'error', code: e.code, message: e.message });
      return Promise.reject(e);
    }
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const state = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
      const redirectUri = new URL(import.meta.env.BASE_URL, window.location.origin).href;
      sessionStorage.setItem('soundblend_oauth_redirect_pending', JSON.stringify({ state, startedAt: Date.now() }));
      const params = new URLSearchParams({
        client_id: id, redirect_uri: redirectUri, response_type: 'token',
        scope: SCOPE_YOUTUBE, state, prompt: 'select_account',
      });
      this.setLoginState({ phase: 'waiting' });
      window.location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
      // La navigation remplace cette page. Ne pas déclarer de succès avant retour.
      return new Promise(() => {});
    } catch {
      try { sessionStorage.removeItem('soundblend_oauth_redirect_pending'); } catch { /* ignore */ }
      const e = new GoogleLoginError('opening_failed', 'Impossible de démarrer la connexion Google. Vérifie le stockage du navigateur et réessaie.');
      this.setLoginState({ phase: 'error', code: e.code, message: e.message });
      return Promise.reject(e);
    }
  }

  /** Traitement unique du retour, avant montage React ou synchronisation. */
  public async completeRedirectLogin(): Promise<void> {
    const response = window.__sbOAuthReturn;
    delete window.__sbOAuthReturn;
    if (!response) return;
    let pending: { state?: string; startedAt?: number } | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem('soundblend_oauth_redirect_pending') || 'null');
      sessionStorage.removeItem('soundblend_oauth_redirect_pending');
    } catch { pending = null; /* impossible de consommer le marqueur : refuser */ }
    const fail = (e: GoogleLoginError) => this.setLoginState({ phase: 'error', code: e.code, message: e.message });
    if (!pending || typeof pending.state !== 'string' || !response.state || pending.state !== response.state ||
        !Number.isFinite(pending.startedAt) || response.receivedAt < pending.startedAt! || response.receivedAt - pending.startedAt! > 600000) {
      fail(new GoogleLoginError('invalid_state', 'Retour Google non reconnu ou expiré. Aucun compte n’a été activé. Recommence la connexion.')); return;
    }
    if (response.error) { fail(googleOAuthError(response.error)); return; }
    if (!response.token?.trim()) { fail(new GoogleLoginError('token_missing', "Google n’a pas renvoyé de jeton. Recommence la connexion.")); return; }
    const scopes = new Set((response.scope || '').split(/\s+/));
    if (!scopes.has('https://www.googleapis.com/auth/youtube') || !scopes.has('https://www.googleapis.com/auth/drive.appdata') ||
        !(scopes.has('https://www.googleapis.com/auth/userinfo.profile') || scopes.has('profile'))) {
      fail(new GoogleLoginError('permissions_incomplete', 'Les autorisations YouTube, Drive et profil sont nécessaires. Le compte choisi n’a pas été activé.')); return;
    }
    const seconds = Number(response.expiresIn), expiresAt = response.receivedAt + seconds * 1000;
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      fail(new GoogleLoginError('invalid_expiry', 'La durée du jeton Google est invalide ou expirée. Reconnecte-toi.')); return;
    }
    const attempt = ++this.attempt;
    this.setLoginState({ phase: 'verifying' });
    try {
      const verified = await this.verifiedProfile(response.token);
      if (attempt !== this.attempt) return;
      if (expiresAt <= Date.now()) throw new GoogleLoginError('token_expired', 'Le jeton a expiré pendant la vérification.');
      if (!this.activate(response.token, expiresAt, verified.id, verified.profile, attempt)) throw new GoogleLoginError('session_changed', 'La session a changé pendant la connexion.');
      this.setLoginState({ phase: 'idle' });
    } catch (e) {
      if (attempt !== this.attempt) return;
      fail(e instanceof GoogleLoginError ? e : new GoogleLoginError('profile_check', 'Impossible de vérifier le profil Google. Le compte choisi n’a pas été activé.'));
    }
  }

  /** Ancien parcours popup, conservé pour les tests et comparaisons historiques.
      Les boutons de l’application utilisent login(), par redirection. */
  public loginPopup(clientId?: string): Promise<string> {
    // Ne pas ouvrir une seconde fenêtre ni invalider silencieusement la
    // première tentative en cas de double clic ou de changement de vue.
    if (this.cancelLogin) return Promise.reject(new GoogleLoginError('already_pending', 'Une connexion Google est déjà en cours.'));
    const attempt = ++this.attempt;
    return new Promise((resolve, reject) => {
      let settled = false;
      let responseStarted = false;
      let googleMessageSeen = false;
      let client: any = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let hintTimer: ReturnType<typeof setTimeout> | undefined;
      // Diagnostic local seulement : noter l'origine d'un message, sans
      // lire son contenu, l'enregistrer ou l'utiliser pour se connecter.
      // Un message Google n'est pas nécessairement la réponse OAuth.
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== 'https://accounts.google.com' || settled || responseStarted || attempt !== this.attempt) return;
        googleMessageSeen = true;
        if (this.loginState.phase === 'waiting-long') this.setLoginState({ phase: 'waiting-long', googleMessageSeen });
      };
      const finish = (error?: GoogleLoginError, token?: string, silent = false) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (hintTimer) clearTimeout(hintTimer);
        window.removeEventListener('message', onMessage);
        if (this.cancelLogin === cancel) this.cancelLogin = null;
        if (this.loginClient === client) this.loginClient = null;
        // Le remplacement passe directement de l'attente au nouvel essai,
        // sans annoncer une annulation alors qu'une autre fenêtre s'ouvre.
        if (!silent) this.setLoginState(error ? { phase: 'error', code: error.code, message: error.message } : { phase: 'idle' });
        if (error) reject(error); else resolve(token!);
      };
      const cancel = (replaced = false) => {
        if (!settled && attempt === this.attempt) this.attempt++;
        finish(new GoogleLoginError(
          replaced ? 'superseded' : 'cancelled',
          replaced ? 'Une nouvelle tentative a remplacé la précédente.' : 'Connexion annulée. Si la fenêtre Google est encore ouverte, ferme-la.',
        ), undefined, replaced);
      };
      this.cancelLogin = cancel;
      try {
        const effectiveClientId = clientId || getStoredSettings().googleClientId;
        if (typeof window.google?.accounts?.oauth2?.initTokenClient !== 'function') {
          finish(new GoogleLoginError('script_unavailable', "La connexion Google n'est pas encore prête. Vérifie ta connexion, puis réessaie.")); return;
        }
        if (!effectiveClientId) {
          finish(new GoogleLoginError('client_missing', "Cette installation n'a pas d'identifiant Google : la connexion ne peut pas s'ouvrir.")); return;
        }
        this.setLoginState({ phase: 'waiting' });
        if (settled || attempt !== this.attempt) return;
        window.addEventListener('message', onMessage);
        timer = setTimeout(() => finish(new GoogleLoginError(
          'timeout', 'SoundBlend n’a pas reçu de réponse de Google dans les dix minutes. Si sa fenêtre est encore ouverte, ferme-la avant de réessayer.',
        )), 600000);
        hintTimer = setTimeout(() => {
          if (!settled && !responseStarted && attempt === this.attempt) this.setLoginState({ phase: 'waiting-long', googleMessageSeen });
        }, 12500);
        // Reprise du mode d'ouverture 6.9.33 : le client reste référencé
        // et aucun error_callback n'est installé. Contrairement à la 6.9.34,
        // un signal de fermeture ne peut donc pas rejeter le retour Google.
        // Cela ne garantit pas qu'un résultat perdu nous sera transmis.
        client = window.google.accounts.oauth2.initTokenClient({
          client_id: effectiveClientId, scope: SCOPE_YOUTUBE,
          callback: async (resp: any) => {
            if (settled || responseStarted || attempt !== this.attempt) return;
            responseStarted = true;
            window.removeEventListener('message', onMessage);
            // Le délai de la fenêtre ne doit pas interrompre un résultat
            // déjà reçu : la vérification du profil a son propre délai.
            if (timer) { clearTimeout(timer); timer = undefined; }
            if (hintTimer) { clearTimeout(hintTimer); hintTimer = undefined; }
            if (!resp || typeof resp !== 'object') {
              finish(new GoogleLoginError('invalid_response', 'Google a renvoyé une réponse de connexion invalide. Réessaie.')); return;
            }
            if (resp.error) { finish(googleOAuthError(resp.error)); return; }
            if (typeof resp.access_token !== 'string' || !resp.access_token.trim()) {
              finish(new GoogleLoginError('token_missing', "Google n'a pas renvoyé de jeton d'accès. Réessaie.")); return;
            }
            // Le consentement granulaire peut accorder seulement une partie
            // des droits. Ne pas activer une session qui paraît complète mais
            // ne pourrait ni charger YouTube ni synchroniser Drive. Conserver
            // l'ancien comportement lorsque scope est absent (anciens mocks).
            if (typeof resp.scope === 'string') {
              const granted = new Set(resp.scope.trim().split(/\s+/));
              const required = SCOPE_YOUTUBE.split(/\s+/);
              if (required.some(scope => !granted.has(scope) && !(scope.endsWith('/userinfo.profile') && granted.has('profile')))) {
                finish(new GoogleLoginError('permissions_incomplete', 'Les autorisations nécessaires à YouTube, Drive et au profil n’ont pas toutes été accordées. Le compte choisi n’a pas été activé.')); return;
              }
            }
            this.setLoginState({ phase: 'verifying' });
            if (settled || attempt !== this.attempt) return;
            try {
              // expires_in commence à la réception du jeton, pas après la
              // lecture du profil qui peut prendre plusieurs secondes.
              const seconds = Number(resp.expires_in);
              if (!Number.isFinite(seconds) || seconds <= 0) throw new GoogleLoginError('invalid_expiry', 'Google a renvoyé un jeton expiré ou sans durée fiable.');
              const expiresAt = Date.now() + seconds * 1000;
              if (!Number.isFinite(expiresAt)) throw new GoogleLoginError('invalid_expiry', 'Google a renvoyé un jeton expiré ou sans durée fiable.');
              const verified = await this.verifiedProfile(resp.access_token);
              if (settled || attempt !== this.attempt) return;
              if (expiresAt <= Date.now()) throw new GoogleLoginError('token_expired', 'Le jeton Google a expiré pendant la vérification. Reconnecte-toi.');
              if (!this.activate(resp.access_token, expiresAt, verified.id, verified.profile, attempt)) {
                finish(new GoogleLoginError('session_changed', 'La session a changé pendant la connexion. Recommence si nécessaire.'));
                return;
              }
              finish(undefined, resp.access_token);
            } catch (e) {
              if (e instanceof GoogleLoginError) finish(e);
              else finish(new GoogleLoginError('profile_check', e instanceof Error && e.message.startsWith('Impossible de vérifier l’identité Google')
                ? e.message : 'Impossible de vérifier l’identité Google (réseau ou délai). Le compte choisi n’a pas été activé.'));
            }
          },
        });
        if (settled || attempt !== this.attempt) return;
        this.loginClient = client;
        // Sans error_callback, Google ne signale pas ici de façon fiable une
        // fenêtre bloquée ou fermée. L'aide, Annuler et le délai restent
        // disponibles sans prétendre qu'un compte est connecté.
        // Comme le diagnostic local P : choisir le compte sans forcer à
        // chaque fois le consentement. Google peut encore demander l'accord
        // si nécessaire. Le client et les trois droits restent inchangés.
        // Aucun await avant cet appel : la fenêtre reste liée au clic réel.
        client.requestAccessToken({ prompt: 'select_account' });
      } catch {
        finish(new GoogleLoginError('opening_failed', 'Impossible d’ouvrir la connexion Google. Réessaie.'));
      }
    });
  }
  public async jeton(): Promise<string | null> { return this.getAccessToken(); }
  public logout(): void {
    this.attempt++; this.cancelLogin?.();
    window.dispatchEvent(new CustomEvent('sb:auth-changing'));
    const token = this.accessToken;
    this.serial++; this.abortOperations();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.accessToken = null; this.owner = null; this.profile = null; this.expiresAt = 0;
    this.expiredNotified = false;
    playlistTracksCache.clear(); this.persistSession();
    // Ne pas réutiliser une ancienne session globale lors d'un rechargement.
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_EXP_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
    selectAccountScope(null);
    window.dispatchEvent(new CustomEvent('sb:auth-changed'));
    if (token && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(token, () => {}); } catch { /* déjà expiré */ }
    }
  }

  /**
   * Fetch all user playlists via YouTube Data API v3
   */
  public async fetchPlaylists(): Promise<Playlist[]> {
    if (!this.isAuthenticated()) {
      return MOCK_PLAYLISTS;
    }

    const token = this.accessToken;
    const serial = this.serial, revision = accountRevision();
    try {
      const allPlaylists: Playlist[] = [];
      let nextPageToken = '';
      let pageCount = 0;
      const seenPages = new Set<string>();

      do {
        pageCount++;
        const tokenQuery = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : '';
        const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=50${tokenQuery}`;
        const { resp, data } = await fetchLibrary(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        this.assertSession(token, serial, revision);

        if (!resp.ok) {
          if (resp.status === 401) {
            this.invalidateToken(token);
            throw new Error("Session YouTube expirée. Veuillez vous reconnecter.");
          }
          throw new Error(`Impossible de lire la bibliothèque YouTube (HTTP ${resp.status}). Vérifie les autorisations du compte, puis réessaie.`);
        }

        const pageItems: Playlist[] = (data.items || []).map((item: any) => ({
          id: item.id,
          title: item.snippet.title,
          description: item.snippet.description || 'Playlist YouTube Music',
          thumbnailUrl: item.snippet.thumbnails?.medium?.url ||
                        item.snippet.thumbnails?.default?.url ||
                        'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
          trackCount: item.contentDetails?.itemCount || 0,
        }));

        allPlaylists.push(...pageItems);
        if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') {
          throw new Error('Impossible de lire la bibliothèque YouTube en entier : pagination invalide. Réessaie.');
        }
        nextPageToken = data.nextPageToken || '';
        if (nextPageToken && (seenPages.has(nextPageToken) || pageCount >= 150)) {
          throw new Error('Impossible de lire la bibliothèque YouTube en entier : pagination invalide ou trop longue. Réessaie.');
        }
        if (nextPageToken) seenPages.add(nextPageToken);
      } while (nextPageToken);

      this.assertSession(token, serial, revision);
      return allPlaylists;
    } catch (e) {
      console.warn('Impossible de charger les playlists YouTube :', e);
      if (e instanceof Error && /Impossible de lire la bibliothèque|Session YouTube expirée|La session Google/.test(e.message)) throw e;
      throw new Error('Impossible de lire la bibliothèque YouTube. Vérifie la connexion, puis réessaie.');
    }
  }

  /**
   * Fetch ALL tracks from a specific playlist with complete pagination
   */
  public async fetchPlaylistTracks(
    playlistId: string,
    onProgress?: (loaded: number) => void,
    options: { fresh?: boolean } = {},
  ): Promise<Track[]> {
    if (!options.fresh && playlistTracksCache.has(playlistId)) {
      return playlistTracksCache.get(playlistId)!;
    }

    const demo = MOCK_PLAYLISTS.find(p => p.id === playlistId);
    if (demo && demo.tracks) {
      return demo.tracks;
    }

    if (!this.isAuthenticated()) {
      throw new Error('Connecte ton compte Google pour lire cette playlist YouTube.');
    }

    const token = this.accessToken;
    const serial = this.serial, revision = accountRevision();
    try {
      const allTracks: Track[] = [];
      let nextPageToken = '';
      let pageCount = 0;
      const seenPages = new Set<string>();

      do {
        pageCount++;
        const tokenQuery = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : '';
        const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(playlistId)}&maxResults=50${tokenQuery}`;

        const { resp, data } = await fetchLibrary(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        this.assertSession(token, serial, revision);

        if (!resp.ok) {
          // Une page refusée ne doit pas être mémorisée comme playlist vide
          // ou complète : l’assistant doit pouvoir signaler l’échec et réessayer.
          if (resp.status === 401) {
            this.invalidateToken(token);
            throw new Error('Session YouTube expirée. Veuillez vous reconnecter.');
          }
          throw new Error(`Impossible de lire la playlist YouTube (page ${pageCount}, HTTP ${resp.status}). Vérifie la connexion et les autorisations, puis réessaie.`);
        }

        const pageTracks: Track[] = (data.items || [])
          .filter((item: any) => item.snippet?.title !== 'Deleted video' && item.snippet?.title !== 'Private video')
          .map((item: any) => {
            const rawTitle = decodeEntities(item.snippet.title || 'Titre inconnu');
            const cleaned = cleanTitle(rawTitle);
            const artist = cleaned.artist
              || decodeEntities(item.snippet.videoOwnerChannelTitle?.replace(' - Topic', '') || 'Artiste inconnu');
            const title = cleaned.title;

            const videoId = item.contentDetails?.videoId || item.snippet.resourceId?.videoId;

            return {
              id: item.id || videoId,
              videoId: videoId,
              title: title,
              artist: artist,
              thumbnailUrl: item.snippet.thumbnails?.medium?.url ||
                            item.snippet.thumbnails?.default?.url ||
                            (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ''),
              durationSeconds: 210,
              durationFormatted: '3:30',
              videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
            };
          });

        allTracks.push(...pageTracks);
        onProgress?.(allTracks.length);
        if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') {
          throw new Error('Impossible de lire la playlist YouTube en entier : pagination invalide. Réessaie.');
        }
        nextPageToken = data.nextPageToken || '';
        if (nextPageToken && (seenPages.has(nextPageToken) || pageCount >= 150)) {
          throw new Error('Impossible de lire la playlist YouTube en entier : pagination invalide ou trop longue. Réessaie.');
        }
        if (nextPageToken) seenPages.add(nextPageToken);
      } while (nextPageToken);

      // Une déconnexion pendant la lecture ne doit pas réintroduire dans
      // le cache les morceaux du compte précédent.
      this.assertSession(token, serial, revision);
      playlistTracksCache.set(playlistId, allTracks);
      return allTracks;
    } catch (e) {
      console.warn('Impossible de lire les morceaux de la playlist :', e);
      if (e instanceof Error && /Impossible de lire la playlist|Session YouTube expirée|La session Google/.test(e.message)) throw e;
      throw new Error('Impossible de lire la playlist YouTube. Vérifie la connexion, puis réessaie.');
    }
  }

  /**
   * L'identifiant d'une vidéo pour un titre donné, ou `null`.
   *
   * `null` est une réponse à part entière : elle dit « ce morceau n'existe
   * pas sur YouTube avec cette clé ». Avant, on renvoyait un identifiant
   * tiré au hasard dans une liste de secours — et on le mettait en cache,
   * si bien que le même titre recevait toujours la même vidéo, sans aucun
   * rapport avec ce qu'on cherchait. C'était le « morceau aléatoire » du
   * remplacement. Un morceau qu'on ne trouve pas n'est pas un morceau :
   * il faut en proposer un autre.
   */
  public async resolveVideoId(title: string, artist: string): Promise<string | null> {
    const found = await this.findPlayable(title, artist);
    return found?.videoId ?? null;
  }

  /**
   * ─────────── réparer un identifiant mort ───────────
   *
   * Le cas de l'auditeur : un blend composé il y a quelques jours, dont
   * une partie des vidéos ne se lit plus — retirées, bloquées, ou
   * réservées. Le lecteur les traversait une par une, en silence.
   *
   * On redemande donc à YouTube le morceau, par son titre et son
   * artiste, et on garde le premier résultat **réellement jouable**.
   * `null` = rien à faire : ce morceau-là ne s'écoute pas ici. On ne
   * remplace jamais par autre chose que le même morceau.
   */
  public async reparerVideoId(title: string, artist: string): Promise<string | null> {
    const found = await this.findPlayable(title, artist).catch(() => null);
    if (!found || isExcluded(found) || isExcluded({
      videoId: found.videoId,
      title: found.sourceTitle || found.title,
      artist: found.sourceArtist || found.artist,
    })) return null;
    return found.videoId;
  }

  /**
   * Cherche un morceau jouable et rend ce qu'on a réellement trouvé :
   * identifiant, titre propre, artiste, durée. Sert au remplacement, qui a
   * besoin de vérifier qu'une proposition existe avant de l'afficher.
   */
  public async findPlayable(
    title: string,
    artist: string,
  ): Promise<PlayableVideo | null> {
    const cacheKey = `find::${artist} - ${title}`.toLowerCase().trim();
    const cached = findCache.get(cacheKey);
    if (cached && Date.now() - cached.at < FIND_TTL) return cached.val ? { ...cached.val } : null;
    const remember = (val: PlayableVideo | null): PlayableVideo | null => {
      // Un réseau muet ou une recherche vide ne doit pas empoisonner les
      // prochains essais ; ne mémoriser qu'une identité confirmée.
      if (val?.verifie) findCache.set(cacheKey, { at: Date.now(), val });
      return val;
    };

    const settings = getStoredSettings();
    const apiKey = settings.youtubeApiKey;

    const fmt = (v: Video) => ({
      videoId: v.videoId,
      title: v.title || title,
      artist: v.artist || artist,
      durationSeconds: v.durationSeconds,
      durationFormatted: v.durationSeconds
        ? `${Math.floor(v.durationSeconds / 60)}:${String(v.durationSeconds % 60).padStart(2, '0')}`
        : undefined,
    });

    /* oEmbed aide à reconnaître le titre et à écarter une vidéo signalée
       comme indisponible. Il ne garantit pas la lecture réelle : les
       restrictions, le pays et le compte restent décidés par YouTube. */
    const jouable = async (v: { videoId: string; title?: string; artist?: string; durationSeconds?: number }) => {
      const test = await this.estJouable(v.videoId).catch(() => null);
      if (test && test.ok === false) {
        console.debug(`[YouTube] ${title} / ${artist} : « ${test.raison} » — écarté`);
        return null;
      }
      if (test?.titre && !matchesVideoIdentity(title, artist, test.titre, test.artiste)) {
        console.debug(`[YouTube] ${title} / ${artist} : identité officielle différente — écarté`);
        return null;
      }
      /* la durée réelle, quand on l'apprend là : le blend compte juste */
      return {
        videoId: v.videoId,
        title: v.title || title,
        artist: v.artist || artist,
        durationSeconds: v.durationSeconds || test?.duree,
        durationFormatted: (v.durationSeconds || test?.duree)
          ? `${Math.floor((v.durationSeconds || test!.duree!) / 60)}:${String((v.durationSeconds || test!.duree!) % 60).padStart(2, '0')}`
          : undefined,
        sourceTitle: test?.titre || undefined,
        sourceArtist: test?.artiste || undefined,
        verifie: test?.ok === true,
      };
    };

    /* ── 1. l'API officielle, avec la clé ou avec le jeton du compte ──
       Google l'écrit noir sur blanc : `key` est « required **unless**
       you provide an OAuth 2.0 token ». Une personne connectée n'a donc
       pas besoin de clé YouTube — c'est ce qui permet de ne plus la
       demander. */
    const jwt = this.isAuthenticated() ? this.accessToken : null;
    if (apiKey || jwt) {
      for (const q of [`${artist} ${title} audio`, `${title} ${artist}`]) {
        try {
          const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(q)}&maxResults=5`
            + (apiKey ? `&key=${apiKey}` : '');
          const resp = await fetch(url, jwt && !apiKey
            ? { headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' } }
            : { headers: { Accept: 'application/json' } });
          if (!resp.ok) {
            console.warn(`Recherche YouTube (clé) : ${resp.status}`);
            break;
          }
          const data = await resp.json();
          /* ── les chaînes « Artiste - Topic » d'abord ──
             C'est le catalogue officiel de YouTube Music : pochette
             propre, durée, et surtout des vidéos **qui s'intègrent
             toujours**. Un clip déposé par un label peut, lui, refuser
             l'iframe. On trie donc avant de choisir, sans changer le
             nombre de requêtes. */
          const items: any[] = (data.items || [])
            .filter((i: any) => i?.id?.videoId)
            .sort((a: any, b: any) =>
              Number(/-\s*Topic$/.test(String(b?.snippet?.videoOwnerChannelTitle || b?.snippet?.channelTitle || '')))
              - Number(/-\s*Topic$/.test(String(a?.snippet?.videoOwnerChannelTitle || a?.snippet?.channelTitle || ''))));
          /* plusieurs résultats : on garde celui qui correspond au titre
             demandé, pas forcément le premier de la liste */
          for (const item of items) {
            const rawTitle = decodeEntities(item.snippet?.title || '');
            const author = decodeEntities(item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || '');
            if (!matchesVideoIdentity(title, artist, rawTitle, author)) continue;
            const cleaned = cleanTitle(rawTitle);
            const cand = {
              videoId: item.id.videoId as string,
              /* le titre demandé reste le titre : YouTube rend souvent
                 « M83 - Quatrieme (Official Audio) », et c'est ce texte-là
                 qui finissait dans le blend au lieu du nom du morceau.
                 On nettoie, mais on préfère le titre demandé quand la
                 vidéo le confirme (matchesAsked ci-dessous le vérifie). */
              title: (cleaned.title && norm(cleaned.title) !== norm(title) ? cleaned.title : title),
              artist: cleaned.artist
                || decodeEntities(item.snippet?.videoOwnerChannelTitle?.replace(' - Topic', '')
                  || item.snippet?.channelTitle?.replace(' - Topic', '')
                  || artist),
            };
            if (matchesAsked(title, artist, cand.title, cand.artist)) {
              const ok = await jouable(cand);
              if (ok) {
                return remember(ok);
              }
            }
          }
        } catch (err) {
          console.warn('Recherche YouTube (clé) impossible :', err);
          break;
        }
      }
    }

    /* ── 2. la même API, avec le jeton du compte ──
       Plus de clé à fournir : Google accepte le jeton à la place. */
    if (this.isAuthenticated()) {
      try {
        const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&q=${encodeURIComponent(`${artist} ${title} audio`)}&maxResults=5`;
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
        });
        if (resp.ok) {
          const items: any[] = ((await resp.json()).items || []).filter((i: any) => i?.id?.videoId);
          for (const item of items) {
            const rawTitle = decodeEntities(item.snippet?.title || '');
            const author = decodeEntities(item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || '');
            if (!matchesVideoIdentity(title, artist, rawTitle, author)) continue;
            const cleaned = cleanTitle(rawTitle);
            const cand = {
              videoId: item.id.videoId as string,
              title: cleaned.title || title,
              artist: cleaned.artist || author.replace(/\s*-\s*Topic$/i, '') || artist,
            };
            if (matchesAsked(title, artist, cand.title, cand.artist)) {
              const ok = await jouable(cand);
              if (ok) {
                return remember(ok);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Recherche YouTube (jeton) impossible :', err);
      }
    }

    /* ── 2. une instance Piped : le même catalogue, sans clé ──
       C'est la voie qui a manqué jusqu'ici : sans clé YouTube (ou avec
       un quota épuisé), tous les titres proposés par le modèle étaient
       déclarés introuvables, et le blend ne gardait que les piliers.
       On essaie trois formulations, du plus précis au plus large. */
    for (const q of [`${artist} ${title}`, `${title} ${artist}`, title]) {
      const vids = await pipedSearch(q, 'music_songs');
      /* on essaie les candidats dans l'ordre : le premier n'est pas
         toujours le bon, et le bon n'est pas toujours lisible ici */
      // Ne jamais accepter le premier résultat par défaut : il peut être
      // un autre titre ou le même titre d'un artiste clairement différent.
      const hits = vids.filter((v) => matchesVideoIdentity(title, artist, v.title, v.artist));
      for (const hit of hits.slice(0, 4)) {
        const cleaned = cleanTitle(hit.title || title);
        const ok = await jouable({
          videoId: hit.videoId,
          title: cleaned.title || hit.title || title,
          artist: cleaned.artist || hit.artist || artist,
          durationSeconds: hit.durationSeconds,
        });
        if (ok) {
          return remember(ok);
        }
      }
    }

    /* ── 3. dans les listes déjà chargées (1 unité de quota) ──
       Le pont final : une playlist contient déjà les identifiants, on
       n'a qu'à y chercher le titre. C'est ce qui rattrape les morceaux
       que les recherches ne trouvent pas. */
    const fromLists = this.searchLoadedLists(title, artist);
    if (fromLists) {
      const ok = await jouable(fromLists);
      if (ok) {
        return remember(ok);
      }
    }

    return remember(null);
  }

  /**
   * ─────────── le morceau est-il vraiment **jouable** ? ───────────
   *
   * C'est la différence entre « trouvé » et « écoutable ». Une recherche
   * peut rendre un identifiant dont la vidéo est protégée, bloquée dans
   * le pays, retirée, ou réservée à un abonnement : le lecteur intégré
   * n'affichera alors rien du tout, et le morceau sera sauté — c'est
   * exactement ce que montrait la console de l'auditeur, une liste
   * entière traversée sans qu'une seule note ne sorte.
   *
   * Le contrôle utilisable ici est `oembed` : il renseigne le titre et
   * la chaîne, et peut signaler une vidéo supprimée ou privée. Il ne dit
   * pas si elle sera effectivement lisible dans ce pays ou ce compte.
   * `null` = on ne sait pas (réseau muet, page illisible) ; seul un refus
   * clair est écarté. Les réponses concluantes sont mises en cache une
   * heure, pas les échecs réseau temporaires.
   */
  public async estJouable(videoId: string): Promise<{
    ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string;
  }> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return { ok: false, raison: 'identifiant invalide' };
    const memo = jouableCache.get(videoId);
    if (memo && Date.now() < memo.at) return memo.val;

    /* ── le seul juge utilisable depuis un navigateur : oembed ──
       `youtubei/v1/player` (la page publique du lecteur) dirait tout —
       statut de lecture, blocage pays, refus d'intégration — mais il
       répond 403 à un navigateur et n'envoie aucun en-tête CORS : c'est
       une voie morte, on ne la prend pas. `oembed`, lui, répond avec
       CORS, sans clé et sans quota : une réponse 200 fournit l'identité,
       tandis qu'un 400/401/404 peut signaler une vidéo inaccessible.
       Même avec 200, la lecture intégrée peut échouer pour d'autres raisons.
       403/5xx/réseau muet = on ne sait pas : on ne condamne pas. */
    const meta = await verifyVideo(videoId).catch(() => null);
    const val: { ok: boolean | null; raison: string; duree?: number; titre?: string; artiste?: string } = meta
      ? (meta.jouable === false
        ? { ok: false, raison: 'vidéo retirée, privée, ou intégration refusée' }
        : { ok: true, raison: '', titre: meta.title, artiste: meta.author })
      : { ok: null, raison: 'vérification impossible' };

    // Un réseau muet est un état temporaire, pas un avis d'une heure.
    if (val.ok !== null) jouableCache.set(videoId, { at: Date.now() + JOUABLE_TTL, val });
    return val;
  }

  /**
   * ─────────── un VRAI clip, pour l'image ───────────
   *
   * Beaucoup de morceaux de la file pointent vers une vidéo « audio » (la
   * piste seule, une pochette fixe, publiée par un compte « - Topic »).
   * Pour écouter, c'est parfait ; pour *regarder*, c'est une image
   * immobile. On cherche donc, une fois par morceau et seulement quand on
   * le demande, une vidéo qui montre quelque chose :
   *
   *   1. une recherche « artiste titre official video », sans clé ;
   *   2. on écarte tout ce qui est un « Topic », un « audio », un
   *      « lyrics », un concert d'une heure ou une version accélérée ;
   *   3. on exige que le titre et l'artiste se retrouvent dans le
   *      résultat — on ne remplace pas un morceau par un autre ;
   *   4. `oembed` confirme qu'elle existe et accepte l'intégration.
   *
   * `null` veut dire « pas de clip connu » — et ce n'est pas une erreur :
   * on gardera alors la pochette, sans jamais rien inventer.
   */
  public async trouverClip(track: { title: string; artist: string; videoId: string; durationSeconds?: number }): Promise<string | null> {
    /* la clé comprend l'identifiant : deux morceaux homonymes (une version
       studio, un live) ne doivent pas se partager la même réponse */
    const cle = `${track.videoId}::${track.artist}::${track.title}`.toLowerCase();
    const memo = clipCache.get(cle);
    if (memo && Date.now() < memo.at) return memo.val;
    if (clipEnCours.has(cle)) return clipEnCours.get(cle)!;

    const travail = (async (): Promise<string | null> => {
      /* la vidéo d'origine est peut-être déjà un clip : on regarde ce que
         YouTube dit d'elle avant de chercher ailleurs */
      const propre = await verifyVideo(track.videoId).catch(() => null);
      const nomPropre = `${propre?.author || ''}`.toLowerCase();
      const dejaUnClip = !!propre?.ok && !!nomPropre && !/topic|vevo\s*-?\s*topic/.test(nomPropre);

      const requete = `${track.artist} ${track.title} official video`;
      const vus: Video[] = [];
      try {
        const api = await this.searchTracks(requete, 8);
        for (const t of api.tracks) {
          if (t.videoId) vus.push({ videoId: t.videoId, title: t.title, artist: t.artist });
        }
      } catch { /* la recherche du compte peut manquer : Piped prend la suite */ }
      if (!vus.length) {
        const p = await pipedSearch(requete, 'music_songs').catch(() => []);
        vus.push(...p);
      }

      const mots = normaliser(track.title);
      const artiste = normaliser(track.artist);
      const mauvais = /\b(audio|lyrics?|paroles|topic|instrumental|karaoke|reaction|cover|live|concert|remix|sped up|slowed|nightcore)\b/;
      /* la longueur : un clip qui dure 30 s ou 1 h 20 n'est pas la même
         chanson — et, surtout, il déplacerait la barre de progression.
         On exige donc une durée comparable quand on la connaît. */
      const duree = track.durationSeconds || 0;
      const dureeOk = (d?: number) => !duree || !d || Math.abs(d - duree) <= Math.max(25, duree * 0.22);

      for (const v of vus) {
        if (!v.videoId || v.videoId === track.videoId) continue;
        const titre = normaliser(v.title);
        const auteur = normaliser(v.artist);
        if (mauvais.test(titre) || mauvais.test(auteur)) continue;
        /* le titre du morceau doit se retrouver dans le résultat, et
           l'artiste aussi : sinon c'est une autre chanson */
        if (!titre.includes(mots) && !mots.includes(titre.slice(0, Math.max(4, mots.length)))) continue;
        if (artiste && !titre.includes(artiste) && !auteur.includes(artiste)) continue;
        if (!dureeOk(v.durationSeconds)) continue;
        /* `oembed` tranche : intégration acceptée, ou rien */
        const ok = await verifyVideo(v.videoId).catch(() => null);
        if (ok?.ok && ok.jouable !== false) return v.videoId;
      }

      /* ═══ ce qui ne compte PAS comme un clip ═══
         Avant, on rendait `candidat` même quand `oembed` n'avait pas
         confirmé : un identifiant jamais vérifié devenait « le clip » du
         morceau. C'est exactement ce qui affichait une vidéo sans rapport.
         Désormais : pas de confirmation, pas de clip. */
      /* et si la vidéo qu'on écoute est DÉJÀ un clip (un vrai compte
         d'artiste, pas un « - Topic »), on la renvoie telle quelle */
      if (dejaUnClip && propre?.ok) return track.videoId;
      return null;
    })();

    clipEnCours.set(cle, travail);
    try {
      const val = await travail;
      clipCache.set(cle, { at: Date.now() + CLIP_TTL, val });
      return val;
    } finally {
      clipEnCours.delete(cle);
    }
  }

  /**
   * Cherche un morceau dans les listes de lecture **déjà en mémoire**
   * (aucun appel réseau, aucun quota). Sert de dernier recours, et de
   * premier recours quand la clé YouTube manque.
   */
  public searchLoadedLists(title: string, artist: string): { videoId: string; title: string; artist: string; durationSeconds?: number; durationFormatted?: string; verifie?: boolean } | null {
    for (const tracks of playlistTracksCache.values()) {
      for (const t of tracks) {
        if (!t.videoId) continue;
        if (matchesAsked(title, artist, t.title, t.artist)
          && (!artist || artistMatches(t.artist, artist) || artistMatches(artist, t.artist))) {
          return {
            videoId: t.videoId,
            title: t.title,
            artist: t.artist,
            durationSeconds: t.durationSeconds,
            durationFormatted: t.durationFormatted,
            verifie: true,
          };
        }
      }
    }
    return null;
  }

  /**
   * Recherche libre dans le catalogue YouTube (hors playlists de l'utilisateur).
   * Utilise la clé API si elle existe, sinon le jeton OAuth de la session.
   * Coût : 100 unités de quota par appel → mise en cache.
   */
  public async searchTracks(query: string, maxResults = 20): Promise<{ tracks: Track[]; error: string | null }> {
    const q = query.trim();
    if (q.length < 2) return { tracks: [], error: null };

    const cacheKey = `search::${q.toLowerCase()}`;
    if (searchCache.has(cacheKey)) {
      try { return { tracks: JSON.parse(searchCache.get(cacheKey)!) as Track[], error: null }; } catch { /* ignore */ }
    }

    const settings = getStoredSettings();
    const apiKey = settings.youtubeApiKey;
    const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=${maxResults}&q=${encodeURIComponent(q)}`;

    const parse = (data: any): Track[] =>
      (data.items || [])
        .map((item: any) => {
          const videoId = item.id?.videoId;
          if (!videoId) return null;
          const rawTitle = decodeEntities(item.snippet?.title || 'Titre inconnu');
          /* « Lomepal - Evidemment (lyrics video) » devient « Evidemment » */
          const cleaned = cleanTitle(rawTitle);
          let artist = cleaned.artist
            || decodeEntities(item.snippet?.videoOwnerChannelTitle?.replace(' - Topic', '')
              || item.snippet?.channelTitle?.replace(' - Topic', '')
              || 'Artiste inconnu');
          let title = cleaned.title;
          return {
            id: `yt-${videoId}`,
            videoId,
            title,
            artist,
            thumbnailUrl: item.snippet?.thumbnails?.medium?.url ||
                          item.snippet?.thumbnails?.default?.url ||
                          `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            durationSeconds: 0, // inconnu tant que la vidéo n'a pas été lue
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          } as Track;
        })
        .filter(Boolean) as Track[];

    let lastError: string | null = null;
    try {
      if (apiKey) {
        const resp = await fetch(`${url}&key=${apiKey}`, { headers: { Accept: 'application/json' } });
        if (resp.ok) {
          const tracks = parse(await resp.json());
          searchCache.set(cacheKey, JSON.stringify(tracks));
          return { tracks, error: null };
        }
        lastError = resp.status === 403
          ? 'La clé YouTube refuse cette adresse (restriction de référent) ou le quota est épuisé.'
          : `YouTube a répondu ${resp.status}.`;
      }
      if (this.isAuthenticated()) {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
        });
        if (resp.ok) {
          const tracks = parse(await resp.json());
          searchCache.set(cacheKey, JSON.stringify(tracks));
          return { tracks, error: null };
        }
        if (!lastError) lastError = `YouTube a répondu ${resp.status} pour cette recherche.`;
      }
      if (!apiKey && !this.isAuthenticated()) {
        lastError = 'Recherche YouTube indisponible : connecte ton compte Google (Réglages → Compte YouTube).';
      }
    } catch (e) {
      console.warn('YouTube search failed:', e);
      lastError = 'Recherche impossible : le réseau a bloqué la requête.';
    }
    return { tracks: [], error: lastError };
  }

  private captureSession(): { token: string; serial: number; revision: number } {
    const token = this.getAccessToken();
    if (!token) throw new Error('Session Google expirée ou non connectée. Reconnecte-toi pour utiliser YouTube.');
    return { token, serial: this.serial, revision: accountRevision() };
  }
  /** Toutes les mutations sont liées au jeton capturé et interrompues au
      changement de compte ; une requête déjà reçue par Google peut avoir agi. */
  private async apiRequest(c: { token: string; serial: number; revision: number }, url: string, init: RequestInit = {}): Promise<{ resp: Response; data: any }> {
    this.assertSession(c.token, c.serial, c.revision);
    const controller = new AbortController(); this.operations.add(controller);
    const callerSignal = init.signal;
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) controller.abort(); else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Délai YouTube dépassé. L’opération peut être partielle : vérifie YouTube avant une nouvelle tentative.')); }, 12000);
      });
      const work = (async () => {
        const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${c.token}`);
        const resp = await fetch(url, { ...init, headers, signal: controller.signal, cache: 'no-store' });
        const text = await resp.text();
        let data: any = null;
        if (text) { try { data = JSON.parse(text); } catch { /* une réponse non JSON reste une erreur explicite */ } }
        return { resp, data };
      })();
      const result = await Promise.race([work, deadline]);
      this.assertSession(c.token, c.serial, c.revision);
      if (result.resp.status === 401) { this.invalidateToken(c.token); throw new Error('Session YouTube expirée. Reconnecte-toi.'); }
      return result;
    } finally { if (timer) clearTimeout(timer); callerSignal?.removeEventListener('abort', abortFromCaller); this.operations.delete(controller); }
  }
  private apiError(action: string, resp: Response): Error {
    return new Error(`${action} (YouTube HTTP ${resp.status}). L’opération peut être partielle : vérifie YouTube avant une nouvelle tentative.`);
  }

  public async createPlaylist(title: string, description: string, isPrivate = true): Promise<string> {
    const c = this.captureSession();
    const { resp, data } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlists?part=snippet,status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { title, description }, status: { privacyStatus: isPrivate ? 'private' : 'public' } }),
    });
    if (!resp.ok) throw this.apiError('Création de la playlist refusée', resp);
    if (typeof data?.id !== 'string' || !data.id) throw new Error('YouTube n’a pas confirmé l’identifiant de la playlist créée. Vérifie ta bibliothèque avant de réessayer.');
    return data.id;
  }
  public async updatePlaylistMeta(playlistId: string, meta: { title: string; privacy?: 'private' | 'public'; description?: string }): Promise<boolean> {
    const c = this.captureSession();
    const body: any = { id: playlistId, snippet: { title: meta.title } };
    if (meta.description) body.snippet.description = meta.description;
    if (meta.privacy) body.status = { privacyStatus: meta.privacy };
    const { resp } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlists?part=snippet,status`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!resp.ok) throw this.apiError('Modification du titre ou de la visibilité refusée', resp);
    playlistTracksCache.delete(playlistId); return true;
  }
  /** Le contenu ne suffit pas : relire aussi le titre et la confidentialité
      avant d'affirmer que l'export ou la mise à jour est vérifié. */
  public async getPlaylistMeta(playlistId: string): Promise<{ title: string; privacy: string }> {
    const c = this.captureSession();
    const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,status&id=${encodeURIComponent(playlistId)}`;
    const { resp, data } = await this.apiRequest(c, url);
    if (!resp.ok) throw this.apiError('Lecture des métadonnées de la playlist refusée', resp);
    const item = Array.isArray(data?.items) ? data.items.find((x: any) => x?.id === playlistId) : null;
    if (typeof item?.snippet?.title !== 'string' || typeof item?.status?.privacyStatus !== 'string') {
      throw new Error('YouTube n’a pas confirmé le titre et la visibilité de la playlist. Vérifie puis réessaie.');
    }
    return { title: item.snippet.title, privacy: item.status.privacyStatus };
  }
  public async addTracksToPlaylist(playlistId: string, tracks: Track[], onProgress?: (index: number, total: number) => void): Promise<void> {
    const c = this.captureSession();
    const seen = new Set<string>();
    const unique = tracks.filter((t) => {
      if (!t.videoId) return true;
      if (seen.has(t.videoId)) return false;
      seen.add(t.videoId);
      return true;
    });
    if (unique.some((t) => !t.videoId)) throw new Error('Un morceau n’a pas d’identifiant YouTube : ajout incomplet.');
    for (let i = 0; i < unique.length; i++) {
      const track = unique[i];
      const { resp } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: track.videoId } } }),
      });
      if (!resp.ok) throw this.apiError(`Ajout de « ${track.title} » refusé`, resp);
      playlistTracksCache.delete(playlistId); onProgress?.(i + 1, unique.length);
    }
  }
  public async getPlaylistItems(playlistId: string): Promise<{ itemId: string; videoId: string }[]> {
    const c = this.captureSession();
    const out: { itemId: string; videoId: string }[] = []; const pages = new Set<string>();
    let pageToken = '';
    do {
      const url = `${YOUTUBE_API_BASE}/playlistItems?part=id,snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=50${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const { resp, data } = await this.apiRequest(c, url);
      if (!resp.ok) throw this.apiError('Lecture de la playlist refusée', resp);
      if (!data || !Array.isArray(data.items)) throw new Error('Réponse YouTube illisible : la playlist n’a pas été vérifiée.');
      for (const it of data.items) {
        const vid = it?.snippet?.resourceId?.videoId;
        if (typeof it?.id !== 'string' || typeof vid !== 'string' || !vid) throw new Error('Un élément YouTube est inaccessible : la playlist ne peut pas être vérifiée sans risque.');
        out.push({ itemId: it.id, videoId: vid });
      }
      if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') throw new Error('Pagination YouTube invalide : playlist non vérifiée.');
      pageToken = data.nextPageToken || '';
      if (pageToken && (pages.has(pageToken) || pages.size >= 150)) throw new Error('Pagination YouTube invalide ou trop longue : playlist non vérifiée.');
      if (pageToken) pages.add(pageToken);
    } while (pageToken);
    return out;
  }
  /** Recherche explicite de l'assistant : liée au compte et sans cache de
      réponse entre comptes. Chaque appel YouTube consomme du quota. */
  public async searchAssistantCatalog(query: string): Promise<AssistantCatalogTrack[]> {
    const q = query.trim().slice(0, 180);
    if (q.length < 2) throw new Error('Précise le titre ou l’artiste à rechercher.');
    const c = this.captureSession();
    const url = `${YOUTUBE_API_BASE}/search?part=snippet&type=video&videoCategoryId=10&maxResults=8&q=${encodeURIComponent(q)}`;
    const { resp, data } = await this.apiRequest(c, url);
    if (!resp.ok) throw this.apiError('Recherche musicale refusée', resp);
    if (!Array.isArray(data?.items)) throw new Error('Réponse de recherche YouTube illisible.');
    const items = [...data.items].sort((a: any, b: any) =>
      Number(/-\s*Topic$/i.test(String(b?.snippet?.channelTitle || '')))
      - Number(/-\s*Topic$/i.test(String(a?.snippet?.channelTitle || ''))));
    return items.flatMap((item: any): AssistantCatalogTrack[] => {
      const videoId = item?.id?.videoId;
      if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return [];
      const raw = decodeEntities(String(item?.snippet?.title || ''));
      const cleaned = cleanTitle(raw);
      const channelRaw = decodeEntities(String(item?.snippet?.videoOwnerChannelTitle || item?.snippet?.channelTitle || ''));
      const channel = channelRaw.replace(/\s*-\s*Topic$/i, '');
      const track: AssistantCatalogTrack = { id: `yt-${videoId}`, videoId, title: cleaned.title || raw,
        artist: cleaned.artist || channel || 'Artiste inconnu', thumbnailUrl: item?.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        durationSeconds: 0, videoUrl: `https://www.youtube.com/watch?v=${videoId}`, youtubeTitle: raw, youtubeChannel: channelRaw };
      return track.title && !isAssistantTrackExcluded(track) ? [track] : [];
    });
  }

  /** Appliquer uniquement un plan approuvé à la playlist d'origine.
      Chaque écriture est précédée d'une relecture de l'état attendu ; la
      dernière fenêtre avant écriture n'est toutefois pas atomique. */
  public async applyAssistantPlaylistEdits(
    playlistId: string,
    snapshot: PlaylistSnapshotItem[],
    edits: { removeItemIds: string[]; moves: PlaylistMove[]; additions: Track[] },
    onProgress?: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<{ removed: number; moved: number; added: number }> {
    const c = this.captureSession();
    if (!/^[A-Za-z0-9_-]{2,200}$/.test(playlistId)) throw new Error('Identifiant de playlist invalide.');
    if (!Array.isArray(snapshot) || snapshot.length > 5000 || snapshot.some((x) => !x?.itemId || !/^[A-Za-z0-9_-]{11}$/.test(x.videoId))
      || new Set(snapshot.map((x) => x.itemId)).size !== snapshot.length) throw new Error('État initial de playlist invalide ; aucune modification envoyée.');
    const removeIds = edits.removeItemIds;
    const snapshotIds = new Set(snapshot.map((item) => item.itemId));
    if (!Array.isArray(removeIds) || new Set(removeIds).size !== removeIds.length || removeIds.some((id) => !snapshotIds.has(id))) {
      throw new Error('Un retrait ne correspond pas à la playlist ; aucune modification envoyée.');
    }
    if (!Array.isArray(edits.moves) || !Array.isArray(edits.additions) || removeIds.length + edits.moves.length + edits.additions.length > 25) {
      throw new Error('Cette proposition dépasse 25 modifications : demande des étapes plus petites.');
    }
    const simulate = snapshot.filter((x) => !removeIds.includes(x.itemId));
    for (const move of edits.moves) {
      const at = simulate.findIndex((x) => x.itemId === move.itemId);
      if (at < 0 || !Number.isInteger(move.position) || move.position < 0 || move.position >= simulate.length) {
        throw new Error('Un déplacement ne correspond pas à la playlist ; aucune modification envoyée.');
      }
      const [item] = simulate.splice(at, 1); simulate.splice(move.position, 0, item);
    }
    const videos = new Set(simulate.map((x) => x.videoId));
    for (const t of edits.additions) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(t?.videoId || '') || videos.has(t.videoId) || isAssistantTrackExcluded(t)) {
        throw new Error('Un titre à ajouter est invalide, déjà présent ou bloqué ; aucune modification envoyée.');
      }
      videos.add(t.videoId);
    }
    let expected = snapshot.map((x) => ({ ...x }));
    let removed = 0, moved = 0, added = 0;
    const check = async () => {
      this.assertSession(c.token, c.serial, c.revision);
      if (signal?.aborted) throw new Error('Opération interrompue. Vérifie la playlist : elle peut être partiellement modifiée.');
      const actual = await this.getPlaylistItems(playlistId);
      this.assertSession(c.token, c.serial, c.revision);
      if (signal?.aborted) throw new Error('Opération interrompue. Vérifie la playlist : elle peut être partiellement modifiée.');
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('La playlist a changé depuis l’aperçu. Arrête et demande une nouvelle proposition ; des changements précédents peuvent déjà avoir été appliqués.');
      }
    };
    try {
      await check();
      for (const itemId of removeIds) {
        await check();
        const { resp } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?id=${encodeURIComponent(itemId)}`, { method: 'DELETE', signal });
        if (!resp.ok) throw this.apiError('Retrait d’un titre refusé', resp);
        expected = expected.filter((x) => x.itemId !== itemId); removed++;
        onProgress?.(`Retrait ${removed}/${removeIds.length}`);
      }
      for (const move of edits.moves) {
        const at = expected.findIndex((x) => x.itemId === move.itemId);
        if (at === move.position) continue;
        await check();
        const item = expected[at];
        const { resp } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ id: item.itemId, snippet: { playlistId, position: move.position, resourceId: { kind: 'youtube#video', videoId: item.videoId } } }),
        });
        if (!resp.ok) throw this.apiError('Déplacement d’un titre refusé', resp);
        expected.splice(at, 1); expected.splice(move.position, 0, item); moved++;
        onProgress?.(`Déplacement ${moved}/${edits.moves.length}`);
      }
      for (const t of edits.additions) {
        if (isAssistantTrackExcluded(t)) throw new Error('Un titre a été bloqué entre-temps. Vérifie la playlist avant de réessayer.');
        await check();
        const { resp, data } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ snippet: { playlistId, position: expected.length, resourceId: { kind: 'youtube#video', videoId: t.videoId } } }),
        });
        if (!resp.ok) throw this.apiError('Ajout d’un titre refusé', resp);
        if (typeof data?.id !== 'string' || !data.id) throw new Error('YouTube n’a pas confirmé l’ajout. Vérifie la playlist avant de réessayer.');
        expected.push({ itemId: data.id, videoId: t.videoId }); added++;
        onProgress?.(`Ajout ${added}/${edits.additions.length}`);
      }
      await check();
      return { removed, moved, added };
    } finally { playlistTracksCache.delete(playlistId); }
  }

  /** Remplir une copie privée fraîchement créée sans dédupliquer les
      occurrences volontairement présentes dans la playlist d'origine. */
  public async fillAssistantCopy(playlistId: string, tracks: Track[], onProgress?: (done: number, total: number) => void, additions: Track[] = [], signal?: AbortSignal): Promise<void> {
    const c = this.captureSession();
    if (!/^[A-Za-z0-9_-]{2,200}$/.test(playlistId) || !Array.isArray(tracks) || tracks.length > 150
      || tracks.some((t) => !/^[A-Za-z0-9_-]{11}$/.test(t?.videoId || ''))) {
      throw new Error('Copie invalide ou trop longue (150 titres maximum).');
    }
    if (signal?.aborted) throw new Error('Opération interrompue. Vérifie la copie sur YouTube.');
    if (additions.some((t) => isAssistantTrackExcluded(t))) throw new Error('Un ajout est maintenant bloqué. La copie ne sera pas remplie.');
    const before = await this.getPlaylistItems(playlistId); this.assertSession(c.token, c.serial, c.revision);
    if (signal?.aborted) throw new Error('Opération interrompue. Vérifie la copie sur YouTube.');
    if (before.length) throw new Error('La nouvelle playlist n’est pas vide. Vérifie-la avant de continuer.');
    try {
      for (let i = 0; i < tracks.length; i++) {
        this.assertSession(c.token, c.serial, c.revision);
        if (signal?.aborted) throw new Error('Opération interrompue. La copie peut être partielle ; vérifie-la.');
        if (additions.some((t) => isAssistantTrackExcluded(t))) throw new Error('Un ajout a été bloqué entre-temps. La copie peut être partielle ; vérifie-la.');
        const { resp, data } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ snippet: { playlistId, position: i, resourceId: { kind: 'youtube#video', videoId: tracks[i].videoId } } }),
        });
        if (!resp.ok) throw this.apiError(`Ajout ${i + 1}/${tracks.length} refusé`, resp);
        if (typeof data?.id !== 'string' || !data.id) throw new Error('YouTube n’a pas confirmé un ajout. La copie peut être partielle ; vérifie-la.');
        onProgress?.(i + 1, tracks.length);
      }
      if (signal?.aborted) throw new Error('Opération interrompue. Vérifie la copie sur YouTube.');
      const final = await this.getPlaylistItems(playlistId); this.assertSession(c.token, c.serial, c.revision);
      if (signal?.aborted) throw new Error('Opération interrompue. Vérifie la copie sur YouTube.');
      if (JSON.stringify(final.map((x) => x.videoId)) !== JSON.stringify(tracks.map((x) => x.videoId))) {
        throw new Error('YouTube n’a pas confirmé le contenu et l’ordre de la copie. Vérifie-la avant de réessayer.');
      }
    } finally { playlistTracksCache.delete(playlistId); }
  }

  public async removePlaylistItem(itemId: string): Promise<boolean> {
    const c = this.captureSession();
    const { resp } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?id=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    if (!resp.ok) throw this.apiError('Retrait d’un titre refusé', resp);
    playlistTracksCache.clear(); return true;
  }
  /** Lecture complète, modifications comptées uniquement après confirmation,
      puis relecture de l'ordre exact. Un refus laisse la signature inchangée. */
  public async syncPlaylist(playlistId: string, tracks: Track[], onProgress?: (message: string, pct: number) => void): Promise<{ added: number; removed: number; moved: number }> {
    const c = this.captureSession();
    if (tracks.some((t) => !t.videoId)) throw new Error('Un morceau n’a pas d’identifiant YouTube : mise à jour incomplète.');
    const target = [...new Set(tracks.map((t) => t.videoId))];
    const wanted = new Set(target);
    let removed = 0, added = 0, moved = 0;
    const initial = await this.getPlaylistItems(playlistId);
    this.assertSession(c.token, c.serial, c.revision);
    const kept = new Set<string>();
    const toRemove = initial.filter((item) => {
      if (!wanted.has(item.videoId) || kept.has(item.videoId)) return true;
      kept.add(item.videoId); return false;
    });
    for (let i = 0; i < toRemove.length; i++) {
      this.assertSession(c.token, c.serial, c.revision);
      await this.removePlaylistItem(toRemove[i].itemId); this.assertSession(c.token, c.serial, c.revision); removed++;
      onProgress?.('Retrait des morceaux qui ne sont plus dans le blend…', Math.round(((i + 1) / Math.max(1, toRemove.length + target.length)) * 100));
    }
    for (let i = 0; i < target.length; i++) {
      this.assertSession(c.token, c.serial, c.revision);
      const list = await this.getPlaylistItems(playlistId); this.assertSession(c.token, c.serial, c.revision);
      const ids = list.map((x) => x.videoId), want = target[i];
      if (ids[i] === want) continue;
      const at = ids.indexOf(want);
      if (at >= 0) { await this.removePlaylistItem(list[at].itemId); this.assertSession(c.token, c.serial, c.revision); }
      await this.insertPlaylistItem(playlistId, want, i, c);
      if (at >= 0) moved++; else added++;
      onProgress?.('Mise à jour de la playlist YouTube Music…', Math.round(((i + 1) / Math.max(1, target.length)) * 100));
    }
    const final = await this.getPlaylistItems(playlistId); this.assertSession(c.token, c.serial, c.revision);
    if (JSON.stringify(final.map((x) => x.videoId)) !== JSON.stringify(target)) {
      throw new Error('YouTube n’a pas confirmé le contenu et l’ordre de la playlist. Vérifie puis réessaie.');
    }
    return { added, removed, moved };
  }
  private async insertPlaylistItem(playlistId: string, videoId: string, position: number, c: { token: string; serial: number; revision: number }): Promise<void> {
    const { resp, data } = await this.apiRequest(c, `${YOUTUBE_API_BASE}/playlistItems?part=snippet`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { playlistId, position, resourceId: { kind: 'youtube#video', videoId } } }),
    });
    if (!resp.ok) throw this.apiError('Ajout ou déplacement d’un titre refusé', resp);
    if (!data?.id) throw new Error('YouTube n’a pas confirmé l’ajout : playlist à vérifier.');
    playlistTracksCache.delete(playlistId);
  }

}

export const youtubeService = new YouTubeService();

