import { getAssistantConversations, validAssistantConversations, conversationForDrive, mergeRemoteAssistantConversations, confirmAssistantConversations, type AssistantConversation } from './assistantHistory';
/* Synchronisation privée dans Google Drive appDataFolder.
   Chaque cycle vérifie le compte et le jeton à chaque reprise asynchrone,
   relit les fichiers, fusionne, vérifie juste avant d'écrire puis relit.
   Il ne supprime pas les doublons : entre lecture et DELETE, Drive v3 ne
   fournit pas ici de verrou atomique documenté. Une course après la dernière
   vérification reste possible ; les appareils doivent rester à jour et se
   relire. Les opérations en attente restent dans l'espace de leur compte. */
import { youtubeService } from './youtube';
import { accountRevision, accountScope, belongsToCurrentScope, scopedGetItem, scopedRemoveItem, scopedSetItem, scopedStorageKey } from './accountScope';
import {
  getStoredSettings, saveStoredSettings, getSettingsAt, settingsEnAttente, rebaserSettings, confirmerSettings,
  getStoredPortrait, saveStoredPortrait, portraitPourDrive, rebaserPortrait, confirmerPortrait,
  getStoredBlends, writeStoredBlends, cleanBlend, blendPourDrive, confirmerBlends,
  getExclusionRecords, writeExclusionRecords, fusionnerExclusionsAvecGestesLocaux, exclusionPourDrive, confirmerExclusions,
  getDiscoveryHistory, writeDiscoveryHistory, mergeDiscoveryHistory, learnDiscoveriesFromBlends,
  getBlendTombstones, writeBlendTombstones, mergeBlendTombstones,
  type SoundPortrait,
} from './storage';
import { getMode, getModeAt, appliquerModeDistant, modeEnAttente, rebaserMode, confirmerMode } from '../context/prefs';
import type { BlendTombstone, DiscoveryRecord, ExclusionRecord, GeneratedBlend } from '../types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'soundblend.json';
const APPAREIL_KEY = 'soundblend_appareil';
const DIRTY_KEY = 'soundblend_sync_pending_v2';
const appareil = (): string => {
  try {
    const old = scopedGetItem(APPAREIL_KEY); if (old) return old;
    const id = `app-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    scopedSetItem(APPAREIL_KEY, id); return id;
  } catch { return 'app-inconnu'; }
};

export type DonneesSync = {
  schema: 2;
  modifie: string;
  appareil: string;
  apparence?: { mode: 'light' | 'dark'; at: number };
  reglages?: { geminiApiKey?: string; at?: number };
  exclusions?: ExclusionRecord[];
  decouvertes?: DiscoveryRecord[];
  suppressionsBlends?: Record<string, BlendTombstone>;
  portrait?: SoundPortrait | null;
  blends?: GeneratedBlend[];
  assistantConversations?: AssistantConversation[];
};
export type EtatSync = {
  phase: 'inactif' | 'sans-portee' | 'expire' | 'attente' | 'pret' | 'envoi' | 'erreur';
  enAttente: boolean;
  dernierEnvoi?: string;
  message?: string;
};
let etat: EtatSync = { phase: 'inactif', enAttente: false };
const abonnes = new Set<(e: EtatSync) => void>();
export const surEtatSync = (cb: (e: EtatSync) => void): (() => void) => { abonnes.add(cb); cb(etat); return () => { abonnes.delete(cb); }; };
const poserEtat = (e: Partial<EtatSync>) => { etat = { ...etat, ...e, enAttente: aEnvoyer }; abonnes.forEach((f) => f(etat)); };
export const etatSync = (): EtatSync => etat;

const lireDirty = (): boolean => {
  try { return !!scopedGetItem(DIRTY_KEY) || getAssistantConversations().some(c=>c._pending) || settingsEnAttente() || modeEnAttente()
    || getExclusionRecords().some((r) => r._pending) || getStoredBlends().some((b) => b._pending) || !!getStoredPortrait()?._pending; }
  catch { return true; }
};
let aEnvoyer = lireDirty();
let generation = 0;
let session = 0;
let minuteur: ReturnType<typeof setTimeout> | null = null;
let expiration: ReturnType<typeof setTimeout> | null = null;
let veille: ReturnType<typeof setInterval> | null = null;
let enCours: Promise<boolean> | null = null;
let controle: AbortController | null = null;
let pendingNonPersistant = false;
let retryAttempts = 0;
let lastForeground = 0;
const dirty = (on: boolean, nouveauGeste = false): boolean => {
  aEnvoyer = on;
  try {
    if (on) {
      // Un marqueur différent à chaque geste produit aussi un événement
      // storage si un autre onglet était déjà en attente. Les simples
      // réessais réutilisent la valeur pour éviter une boucle entre onglets.
      const old = scopedGetItem(DIRTY_KEY);
      const value = nouveauGeste ? `${Date.now()}-${Math.random().toString(36).slice(2)}` : old || '1';
      scopedSetItem(DIRTY_KEY, value);
    } else scopedRemoveItem(DIRTY_KEY);
    pendingNonPersistant = false;
    return true;
  } catch {
    // Les données peuvent avoir été sauvées alors que le marqueur ne l'est
    // pas. Le dire, ne pas promettre que l'attente survivra au rechargement.
    pendingNonPersistant = true;
    if (!on) aEnvoyer = true;
    return false;
  }
};

interface Cycle { session: number; revision: number; serial: number; owner: string; token: string; signal: AbortSignal }
const verifier = (c: Cycle): void => {
  if (c.signal.aborted || c.session !== session || c.revision !== accountRevision() || c.owner !== accountScope()
      || c.serial !== youtubeService.sessionRevision() || c.token !== youtubeService.getAccessToken()) {
    throw new DOMException('Session modifiée', 'AbortError');
  }
};
type ReponseDrive = { status: number; ok: boolean; text: () => Promise<string>; json: () => Promise<any> };
/** Borner aussi la lecture du corps : un serveur qui envoie les en-têtes
    puis se fige ne doit pas bloquer indéfiniment l'état « en cours ». */
const requete = async (c: Cycle, url: string, init: RequestInit = {}): Promise<ReponseDrive> => {
  verifier(c);
  const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${c.token}`);
  const controller = new AbortController();
  const annuler = () => controller.abort();
  c.signal.addEventListener('abort', annuler, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const limite = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Délai Drive dépassé : synchronisation en attente.')); }, 12000);
    });
    const lire = (async () => {
      const r = await fetch(url, { ...init, headers, signal: controller.signal, cache: 'no-store' });
      return { r, body: await r.text() };
    })();
    const { r, body } = await Promise.race([lire, limite]);
    verifier(c);
    if (r.status === 401) { youtubeService.invalidateToken(c.token); throw new Error('Drive 401'); }
    return { status: r.status, ok: r.ok, text: async () => body, json: async () => JSON.parse(body) };
  } finally {
    if (timer) clearTimeout(timer);
    c.signal.removeEventListener('abort', annuler);
  }
};
const echec = (r: ReponseDrive): never => { throw new Error(`Drive ${r.status}`); };
const listerFichiers = async (c: Cycle): Promise<string[]> => {
  let page = ''; const seen = new Set<string>(); const ids: string[] = [];
  do {
    const url = `${API}/files?spaces=appDataFolder&pageSize=100&fields=${encodeURIComponent('nextPageToken,files(id,name,modifiedTime)')}&q=${encodeURIComponent(`name='${FILE_NAME}' and trashed=false`)}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`;
    const r = await requete(c, url); if (!r.ok) echec(r);
    const data = await r.json(); verifier(c);
    if (!Array.isArray(data.files)) throw new Error('La liste Drive est illisible ; rien n’a été écrasé.');
    for (const f of data.files) {
      if (!f || typeof f.id !== 'string' || !f.id || f.name !== FILE_NAME) throw new Error('La liste Drive est illisible ; rien n’a été écrasé.');
      if (!ids.includes(f.id)) ids.push(f.id);
    }
    if (data.nextPageToken != null && typeof data.nextPageToken !== 'string') throw new Error('Pagination Drive invalide.');
    page = data.nextPageToken || '';
    if (page && (seen.has(page) || seen.size >= 150)) throw new Error('Pagination Drive invalide ou trop longue.');
    if (page) seen.add(page);
  } while (page);
  return ids.sort();
};
const objet = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const dateLogiqueValide = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER - 1;
const clefsConnues = (v: Record<string, any>, keys: string[]) => Object.keys(v).every((key) => keys.includes(key));
/** Ne pas interpréter un champ endommagé ou inconnu comme une liste vide :
    la réécriture de ce fichier pourrait sinon effacer des données distantes. */
const fichierValide = (d: unknown): d is DonneesSync => {
  if (!objet(d) || (d.schema !== 1 && d.schema !== 2)) return false;
  const known = ['schema', 'modifie', 'appareil', 'apparence', 'reglages', 'exclusions', 'decouvertes', 'suppressionsBlends', 'portrait', 'blends', 'assistantConversations'];
  if (d.schema === 1) known.push('gouts', 'avis');
  if (!clefsConnues(d, known)) return false;
  if (d.assistantConversations !== undefined && !validAssistantConversations(d.assistantConversations)) return false;
  if (d.modifie !== undefined && typeof d.modifie !== 'string') return false;
  if (d.appareil !== undefined && typeof d.appareil !== 'string') return false;
  if (d.apparence !== undefined && (!objet(d.apparence) || !clefsConnues(d.apparence, ['mode', 'at'])
      || !['light', 'dark'].includes(d.apparence.mode) || !dateLogiqueValide(d.apparence.at))) return false;
  if (d.reglages !== undefined && (!objet(d.reglages) || !clefsConnues(d.reglages, ['geminiApiKey', 'at'])
      || (d.reglages.geminiApiKey !== undefined && typeof d.reglages.geminiApiKey !== 'string')
      || (d.reglages.at !== undefined && !dateLogiqueValide(d.reglages.at)))) return false;
  if (d.exclusions !== undefined && (!Array.isArray(d.exclusions) || !d.exclusions.every((r: unknown) =>
    objet(r) && typeof r.id === 'string' && !!r.id && ['artist', 'track'].includes(r.kind)
    && typeof r.artist === 'string' && (r.title === undefined || typeof r.title === 'string')
    && (r.videoId === undefined || typeof r.videoId === 'string') && typeof r.deleted === 'boolean' && dateLogiqueValide(r.updatedAt)))) return false;
  if (d.decouvertes !== undefined && (!Array.isArray(d.decouvertes) || !d.decouvertes.every((r: unknown) =>
    objet(r) && typeof r.title === 'string' && typeof r.artist === 'string'
    && (r.videoId === undefined || typeof r.videoId === 'string') && dateLogiqueValide(r.shownAt)))) return false;
  if (d.suppressionsBlends !== undefined && (!objet(d.suppressionsBlends) || !Object.entries(d.suppressionsBlends).every(([id, t]) =>
    !['__proto__', 'constructor', 'prototype'].includes(id) && objet(t) && dateLogiqueValide(t.at) && dateLogiqueValide(t.expiresAt)))) return false;
  if (d.blends !== undefined && (!Array.isArray(d.blends) || !d.blends.every((b: unknown) =>
    objet(b) && typeof b.id === 'string' && !!b.id && typeof b.title === 'string'
    && typeof b.createdAt === 'string' && Number.isFinite(Date.parse(b.createdAt))
    && typeof b.expiresAt === 'string' && Number.isFinite(Date.parse(b.expiresAt))
    && (b.updatedAt === undefined || dateLogiqueValide(b.updatedAt))
    && Array.isArray(b.tracks) && b.tracks.every(objet)
    && (b.seedTracks === undefined || (Array.isArray(b.seedTracks) && b.seedTracks.every(objet)))))) return false;
  if (d.portrait !== undefined && d.portrait !== null && (!objet(d.portrait) || typeof d.portrait.style !== 'string'
      || typeof d.portrait.at !== 'string' || !Number.isFinite(Date.parse(d.portrait.at)))) return false;
  return true;
};
const lireFichier = async (c: Cycle, id: string): Promise<DonneesSync | null> => {
  const r = await requete(c, `${API}/files/${encodeURIComponent(id)}?alt=media`);
  // S'il vient d'être listé mais n'est plus lisible, ne pas conclure
  // immédiatement que le dossier est vide et créer un second fichier.
  if (r.status === 404) throw new Error('Le fichier Drive a changé pendant la synchronisation. Réessaie.');
  if (!r.ok) echec(r);
  const text = await r.text(); verifier(c);
  try {
    const d: unknown = JSON.parse(text);
    if (!fichierValide(d)) throw new Error('format');
    return d;
  } catch { throw new Error('Le fichier Drive est illisible ou plus récent ; il n’a pas été écrasé.'); }
};
const ecrireDistant = async (c: Cycle, id: string | null, data: DonneesSync): Promise<void> => {
  const json = JSON.stringify(data);
  if (id) {
    const r = await requete(c, `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json,
    });
    // Un fichier disparu doit être relisté et fusionné au prochain cycle,
    // pas remplacé aveuglément par le contenu d'une ancienne lecture.
    if (r.status === 404) throw new Error('Le fichier Drive a changé pendant la synchronisation. Réessaie.');
    if (!r.ok) echec(r); return;
  }
  const boundary = `sb${Math.random().toString(36).slice(2)}`;
  const fiche = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${fiche}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--`;
  const r = await requete(c, `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!r.ok) echec(r);
  const created = await r.json(); verifier(c);
  if (!created?.id) throw new Error('Drive n’a pas confirmé la création du fichier.');
};

/** Fusion par version complète du blend ; une suppression reste prioritaire. */
export const fusionnerBlends = (a: GeneratedBlend[] = [], b: GeneratedBlend[] = [], deleted: Record<string, BlendTombstone> = {}): GeneratedBlend[] => {
  const map = new Map<string, GeneratedBlend>();
  for (const raw of [...a, ...b]) {
    if (!raw?.id || deleted[raw.id] || !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= Date.now()) continue;
    const x = cleanBlend(raw); const prev = map.get(x.id);
    const at = x.updatedAt || Date.parse(x.createdAt) || 0;
    const prevAt = prev?.updatedAt || Date.parse(prev?.createdAt || '') || 0;
    if (!prev || at > prevAt) map.set(x.id, x);
  }
  return [...map.values()].sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
};
const composer = (): DonneesSync => ({
  schema: 2, modifie: new Date().toISOString(), appareil: appareil(),
  apparence: { mode: getMode(), at: getModeAt() },
  reglages: { geminiApiKey: getStoredSettings().geminiApiKey || '', at: getSettingsAt() },
  exclusions: getExclusionRecords().map(exclusionPourDrive), decouvertes: getDiscoveryHistory(),
  suppressionsBlends: getBlendTombstones(),
  portrait: getStoredPortrait() ? portraitPourDrive(getStoredPortrait()!) : null,
  blends: getStoredBlends().map(blendPourDrive),
  assistantConversations: getAssistantConversations().map(conversationForDrive),
});
const logicalTime = (n: unknown): number => {
  const t = Number(n || 0);
  if (!Number.isSafeInteger(t) || t < 0 || t >= Number.MAX_SAFE_INTEGER - 1) throw new Error('Date de synchronisation invalide dans Drive ; fichier non écrasé.');
  return t;
};
const appliquerDistant = (d: DonneesSync): void => {
  if (d.assistantConversations) mergeRemoteAssistantConversations(d.assistantConversations);
  const remoteExclusions = Array.isArray(d.exclusions) ? d.exclusions.map(exclusionPourDrive) : [];
  remoteExclusions.forEach((r) => logicalTime(r?.updatedAt));
  writeExclusionRecords(fusionnerExclusionsAvecGestesLocaux(getExclusionRecords(), remoteExclusions));
  writeDiscoveryHistory(mergeDiscoveryHistory(getDiscoveryHistory(), Array.isArray(d.decouvertes) ? d.decouvertes : []));
  const deleted = mergeBlendTombstones(getBlendTombstones(), d.suppressionsBlends || {});
  writeBlendTombstones(deleted);
  const remoteBlends = (Array.isArray(d.blends) ? d.blends : []).map(blendPourDrive);
  // Comme find(), conserver la première entrée en cas de doublon distant.
  const remoteById = new Map<string, GeneratedBlend>();
  for (const blend of remoteBlends) if (!remoteById.has(blend.id)) remoteById.set(blend.id, blend);
  const localBlends = getStoredBlends().map((b) => {
    const other = remoteById.get(b.id);
    if (!b._pending || !other) return b;
    const remoteAt = logicalTime(other.updatedAt || Date.parse(other.createdAt) || 0);
    const localAt = logicalTime(b.updatedAt || Date.parse(b.createdAt) || 0);
    const sansDate = (x: GeneratedBlend) => JSON.stringify({ ...blendPourDrive(x), updatedAt: 0 });
    return remoteAt >= localAt && sansDate(b) !== sansDate(other) ? { ...b, updatedAt: remoteAt + 1 } : b;
  });
  const blends = fusionnerBlends(localBlends, remoteBlends, deleted);
  writeStoredBlends(blends); learnDiscoveriesFromBlends(blends);
  const here = getStoredPortrait();
  if (Number(d.schema) >= 2 && d.portrait && typeof d.portrait.style === 'string') {
    const other = portraitPourDrive(d.portrait);
    const localAt = Date.parse(here?.at || '') || 0, remoteAt = Date.parse(other.at || '') || 0;
    if (here?._pending && remoteAt >= localAt && JSON.stringify({ ...portraitPourDrive(here), at: '' }) !== JSON.stringify({ ...other, at: '' })) rebaserPortrait(here, remoteAt + 1);
    else if (!here || remoteAt > localAt) saveStoredPortrait(other, true);
  }
  const settings = getStoredSettings();
  const remoteAt = logicalTime(d.reglages?.at || 0), remoteKey = d.reglages?.geminiApiKey;
  const localAt = logicalTime(getSettingsAt());
  if (typeof remoteKey === 'string') {
    if (settingsEnAttente() && remoteAt >= localAt && remoteKey !== settings.geminiApiKey) rebaserSettings(remoteAt + 1);
    else if (remoteAt > localAt || (!localAt && !settings.geminiApiKey && remoteKey)) saveStoredSettings({ ...settings, geminiApiKey: remoteKey }, remoteAt);
  }
  if (d.apparence?.mode === 'light' || d.apparence?.mode === 'dark') {
    const at = logicalTime(d.apparence.at || 0), local = logicalTime(getModeAt());
    if (modeEnAttente() && at >= local && d.apparence.mode !== getMode()) rebaserMode(at + 1);
    else if (at > local) appliquerModeDistant(d.apparence.mode, at);
  }
  window.dispatchEvent(new CustomEvent('sb:sync-applied'));
};
const fingerprint = (d: DonneesSync | null): string => d ? JSON.stringify({
  schema: d.schema, apparence: d.apparence, reglages: d.reglages, exclusions: d.exclusions,
  decouvertes: d.decouvertes, suppressionsBlends: d.suppressionsBlends, portrait: d.portrait, blends: d.blends, assistantConversations: d.assistantConversations || [],
}) : '';
const signalerErreur = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e || '');
  if (!youtubeService.isAuthenticated() && accountScope()) {
    poserEtat({ phase: 'expire', message: 'Session Google expirée : reconnecte le même compte pour reprendre les envois en attente.' }); return;
  }
  const sansDroit = msg.includes('403') || msg.includes('401');
  poserEtat({ phase: sansDroit ? 'sans-portee' : 'erreur', message: sansDroit
    ? 'Accès Drive refusé. Vérifie les autorisations et reconnecte-toi.'
    : /illisible|invalide|plus récent|Stockage local|changé pendant|Délai Drive/.test(msg) ? msg
      : 'La synchro n’a pas abouti. Les données restent sur cet appareil ; un nouvel essai sera lancé automatiquement.' });
};

const armerExpiration = () => {
  if (expiration) clearTimeout(expiration);
  const dates = getStoredBlends().map((b) => Date.parse(b.expiresAt)).filter((n) => n > Date.now());
  if (!dates.length) { expiration = null; return; }
  const delay = Math.max(20, Math.min(...dates) - Date.now() + 30);
  expiration = setTimeout(() => {
    getStoredBlends(); window.dispatchEvent(new CustomEvent('sb:sync-applied')); planifierEnvoi();
  }, Math.min(delay, 2147483000));
};
const armerVeille = () => {
  if (!veille && accountScope()) veille = setInterval(() => { if (youtubeService.isAuthenticated()) void demarrerSync(); }, 3 * 60 * 1000);
  armerExpiration();
};
const programmer = (ms: number) => {
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => { minuteur = null; void envoyerSync(); }, ms);
};
const contenu = async (c: Cycle): Promise<{ ids: string[]; values: Map<string, DonneesSync> }> => {
  const ids = await listerFichiers(c); const values = new Map<string, DonneesSync>();
  for (const id of ids) { const d = await lireFichier(c, id); if (d) values.set(id, d); }
  verifier(c); return { ids: ids.filter((id) => values.has(id)), values };
};
const identique = (a: { ids: string[]; values: Map<string, DonneesSync> }, b: { ids: string[]; values: Map<string, DonneesSync> }) =>
  JSON.stringify(a.ids) === JSON.stringify(b.ids) && a.ids.every((id) => JSON.stringify(a.values.get(id)) === JSON.stringify(b.values.get(id)));

const cycle = (): Promise<boolean> => {
  if (enCours) return enCours;
  const owner = accountScope(), token = youtubeService.getAccessToken();
  if (!owner || !token) {
    poserEtat({ phase: owner ? 'expire' : 'inactif', message: owner ? 'Session expirée : reconnecte ce compte pour synchroniser.' : 'Les données locales restent séparées des comptes Google.' });
    return Promise.resolve(false);
  }
  const controller = new AbortController(); controle = controller;
  const c: Cycle = { session, revision: accountRevision(), serial: youtubeService.sessionRevision(), owner, token, signal: controller.signal };
  const run = (async () => {
    poserEtat({ phase: 'envoi', message: undefined });
    try {
      let snapshot: Awaited<ReturnType<typeof contenu>> | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const initial = await contenu(c);
        for (const d of initial.values.values()) { verifier(c); appliquerDistant(d); }
        const checked = await contenu(c);
        if (identique(initial, checked)) { snapshot = checked; break; }
      }
      if (!snapshot) throw new Error('Le fichier Drive a changé pendant la synchronisation. Réessaie.');
      verifier(c);
      const before = generation; const marqueur = scopedGetItem(DIRTY_KEY); const sent = composer();
      const id = snapshot.ids[0] || null;
      if (!id || fingerprint(snapshot.values.get(id) || null) !== fingerprint(sent)) await ecrireDistant(c, id, sent);
      const after = await contenu(c);
      for (const d of after.values.values()) { verifier(c); appliquerDistant(d); }
      verifier(c);
      const merged = composer();
      const confirmed = after.ids[0] ? after.values.get(after.ids[0]) || null : null;
      if (generation === before && scopedGetItem(DIRTY_KEY) === marqueur && fingerprint(confirmed) === fingerprint(merged)) {
        // N'acquitter que les versions effectivement relues ; un geste plus
        // récent conserve son marqueur et sera renvoyé au cycle suivant.
        confirmAssistantConversations(sent.assistantConversations || []);
        confirmerExclusions(sent.exclusions || []); confirmerBlends(sent.blends || []);
        confirmerSettings(sent.reglages?.at || 0); confirmerMode(sent.apparence?.at || 0); confirmerPortrait(sent.portrait);
        if (!dirty(false)) throw new Error('Stockage local indisponible : état de synchronisation non enregistré.');
        retryAttempts = 0;
        if (minuteur) clearTimeout(minuteur);
        minuteur = null;
        poserEtat({ phase: 'pret', dernierEnvoi: new Date().toISOString(), message: undefined });
      } else {
        dirty(true); programmer(1200);
        poserEtat({ phase: 'attente', message: 'De nouvelles modifications sont en attente de synchronisation.' });
      }
      armerVeille(); return true;
    } catch (e) {
      if (c.session !== session || c.revision !== accountRevision() || c.signal.aborted) return false;
      dirty(true); signalerErreur(e);
      // Le bouton manuel n'est pas nécessaire : après un échec temporaire,
      // reprendre avec un délai croissant. Un refus d'autorisation demande
      // une action de l'utilisateur et ne doit pas être martelé.
      if (accountScope() && youtubeService.isAuthenticated() && etat.phase !== 'sans-portee' && etat.phase !== 'expire') {
        const delay = Math.min(3 * 60 * 1000, 10000 * 2 ** Math.min(retryAttempts, 5));
        retryAttempts++; programmer(delay);
      }
      return false;
    }
  })();
  enCours = run;
  void run.finally(() => { if (enCours === run) { enCours = null; if (controle === controller) controle = null; } });
  return run;
};
export const surveillerExpirations = (): void => armerExpiration();
export const demarrerSync = (): Promise<boolean> => { armerVeille(); return cycle(); };
export const envoyerSync = (): Promise<boolean> => cycle();
export const planifierEnvoi = (): void => {
  generation++; dirty(true, true); armerExpiration();
  if (!accountScope()) { poserEtat({ phase: 'inactif', message: 'Modification enregistrée localement, séparée des comptes Google.' }); return; }
  if (!youtubeService.isAuthenticated()) { poserEtat({ phase: 'expire', message: 'Modification en attente : reconnecte ce même compte pour l’envoyer.' }); return; }
  poserEtat({ phase: 'attente', message: pendingNonPersistant ? 'Envoi en attente ; le navigateur n’a pas pu mémoriser son état. Ne ferme pas l’app avant la synchronisation.' : 'Modification enregistrée sur cet appareil, envoi en attente.' });
  programmer(2500);
};
/** Interrompt l'ancien cycle sans effacer son marqueur de modifications. */
export const oublierSync = (): void => {
  session++; controle?.abort(); controle = null; enCours = null;
  if (minuteur) clearTimeout(minuteur); if (veille) clearInterval(veille); if (expiration) clearTimeout(expiration);
  minuteur = null; veille = null; expiration = null; retryAttempts = 0; lastForeground = 0;
  poserEtat({ phase: 'inactif', dernierEnvoi: undefined, message: undefined });
};
export const enAttente = (): boolean => aEnvoyer;

if (typeof window !== 'undefined') {
  window.addEventListener('sb:assistant-history-dirty', planifierEnvoi);
  window.addEventListener('sb:auth-changing', oublierSync);
  window.addEventListener('sb:account-changed', () => {
    oublierSync(); generation = 0; aEnvoyer = lireDirty(); pendingNonPersistant = false;
    poserEtat({ phase: accountScope() ? (youtubeService.isAuthenticated() ? 'attente' : 'expire') : 'inactif', dernierEnvoi: undefined,
      message: accountScope() ? 'Préparation de la synchronisation de ce compte.' : 'Les anciennes données locales restent séparées des comptes Google.' });
  });
  window.addEventListener('sb:auth-expired', () => {
    oublierSync(); poserEtat({ phase: 'expire', message: 'Session Google expirée : reconnecte le même compte pour reprendre les envois en attente.' });
  });
  window.addEventListener('online', () => {
    if (accountScope() && youtubeService.isAuthenticated()) { retryAttempts = 0; void demarrerSync(); }
  });
  // Drive ne pousse pas les changements à ce site statique. Relire au
  // premier plan en plus de la veille périodique (3 min), sans prétendre
  // à une propagation instantanée lorsque l'app est fermée ou hors ligne.
  const relireAuPremierPlan = () => {
    if (document.visibilityState === 'hidden' || !accountScope() || !youtubeService.isAuthenticated()) return;
    if (Date.now() - lastForeground < 5000) return;
    lastForeground = Date.now(); void demarrerSync();
  };
  window.addEventListener('focus', relireAuPremierPlan);
  document.addEventListener('visibilitychange', relireAuPremierPlan);
  window.addEventListener('storage', (event) => {
    if (!belongsToCurrentScope(event.key)) return;
    if (event.key === scopedStorageKey(DIRTY_KEY)) {
      if (event.newValue) {
        // Le même compte a changé dans un autre onglet : ne pas afficher
        // « à jour » pendant que son écriture attend, et reprendre au besoin.
        generation++; aEnvoyer = true;
        if (accountScope() && youtubeService.isAuthenticated()) {
          if (etat.phase !== 'envoi') poserEtat({ phase: 'attente', message: 'Modification d’un autre onglet en attente de synchronisation.' });
          else poserEtat({});
          if (!enCours) programmer(2500);
        } else poserEtat({ phase: accountScope() ? 'expire' : 'inactif' });
      } else if (!lireDirty()) {
        aEnvoyer = false;
        if (etat.phase === 'attente' && !enCours && accountScope() && youtubeService.isAuthenticated()) poserEtat({ phase: 'pret', message: 'Synchronisation confirmée dans un autre onglet.' });
      }
    }
    window.dispatchEvent(new CustomEvent('sb:sync-applied'));
  });
}
