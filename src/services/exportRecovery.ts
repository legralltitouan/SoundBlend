import { accountScope, scopedStorageKey } from './accountScope';

/* Une création YouTube n'est pas transactionnelle avec localStorage.
   Écrire l'intention AVANT le POST : si la réponse ou le stockage du lien
   se perd, ne pas recréer silencieusement une playlist au rechargement.
   Ce journal reste sur l'appareil, séparé par compte et par blend. */
export type ExportAttempt = {
  owner: string;
  blendId: string;
  attempt: string;
  title: string;
  privacy: 'private' | 'public';
  playlistId?: string;
};
const keyFor = (owner: string, blendId: string) =>
  scopedStorageKey(`soundblend_export_intent_v1:${encodeURIComponent(blendId)}`, owner);
const memory = new Map<string, ExportAttempt>();
export const exportAttemptStorageKey = (blendId: string): string | null => {
  const owner = accountScope();
  return owner ? keyFor(owner, blendId) : null;
};
const valid = (v: unknown, owner: string, blendId: string): v is ExportAttempt => {
  const r = v as ExportAttempt | null;
  return !!r && r.owner === owner && r.blendId === blendId && typeof r.attempt === 'string'
    && !!r.attempt && typeof r.title === 'string' && (r.privacy === 'private' || r.privacy === 'public')
    && (r.playlistId === undefined || (typeof r.playlistId === 'string' && !!r.playlistId));
};
const parse = (raw: string | null): unknown => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

export const getExportAttempt = (blendId: string): ExportAttempt | null => {
  const owner = accountScope();
  if (!owner) return null;
  const key = keyFor(owner, blendId);
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return memory.get(key) || null; }
  if (!raw) return null;
  const saved = parse(raw);
  // Une intention endommagée bloque aussi une nouvelle création : il faut
  // que l'utilisateur vérifie YouTube avant de la remettre à zéro.
  if (!valid(saved, owner, blendId)) return { owner, blendId, attempt: 'journal-illisible', title: '', privacy: 'private' };
  const inMemory = memory.get(key);
  let inSession: unknown = null;
  try { inSession = parse(sessionStorage.getItem(key)); } catch { /* la mémoire suffit tant que l'onglet reste ouvert */ }
  for (const candidate of [inMemory, inSession]) {
    if (valid(candidate, owner, blendId) && candidate.attempt === saved.attempt && candidate.playlistId) return candidate;
  }
  return saved;
};

export const beginExportAttempt = (blendId: string, title: string, privacy: 'private' | 'public'): ExportAttempt => {
  const owner = accountScope();
  if (!owner) throw new Error('Connecte un compte Google avant de créer une playlist.');
  if (getExportAttempt(blendId)) throw new Error('Une création précédente reste à vérifier avant un nouvel export.');
  const rec: ExportAttempt = { owner, blendId, title, privacy, attempt: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
  try { localStorage.setItem(keyFor(owner, blendId), JSON.stringify(rec)); }
  catch { throw new Error('Stockage local indisponible ou plein : aucune demande de création de playlist n’a été envoyée.'); }
  return rec;
};

/** Conserver immédiatement l'ID en mémoire et dans l'onglet si possible ;
    la petite écriture locale peut encore échouer après le POST YouTube. */
export const rememberExportPlaylist = (rec: ExportAttempt, playlistId: string): ExportAttempt => {
  if (accountScope() !== rec.owner) throw new Error('Le compte a changé pendant cet export.');
  const known = { ...rec, playlistId };
  const key = keyFor(rec.owner, rec.blendId);
  let raw: string | null = null, readable = true;
  try { raw = localStorage.getItem(key); } catch { readable = false; }
  if (readable) {
    const current = parse(raw);
    const same = valid(current, rec.owner, rec.blendId) && current.attempt === rec.attempt;
    const repairCorrupt = !!raw && !valid(current, rec.owner, rec.blendId) && rec.attempt === 'journal-illisible';
    if (!same && !repairCorrupt) throw new Error('Une autre tentative a remplacé celle-ci. Conserve le lien et vérifie les playlists dans YouTube.');
  }
  memory.set(key, known);
  try { sessionStorage.setItem(key, JSON.stringify(known)); } catch { /* lien disponible dans l'onglet courant */ }
  try { localStorage.setItem(key, JSON.stringify(known)); } catch { /* l'intention écrite avant le POST reste présente */ }
  return known;
};

export const clearExportAttempt = (rec: ExportAttempt): void => {
  if (accountScope() !== rec.owner) throw new Error('Le compte a changé pendant cet export.');
  const key = keyFor(rec.owner, rec.blendId);
  const current = getExportAttempt(rec.blendId);
  if (current && current.attempt !== rec.attempt) throw new Error('Une autre tentative d’export est en cours.');
  try { localStorage.removeItem(key); }
  catch { throw new Error('Stockage local indisponible : la tentative précédente ne peut pas être effacée.'); }
  memory.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* sans effet si le journal local a été effacé */ }
};

/** N'accepter qu'une URL YouTube ou un identifiant brut, jamais un lien
    arbitraire. L'utilisateur choisit explicitement la playlist à associer. */
export const parsePlaylistId = (input: string): string | null => {
  let id = input.trim();
  if (/^https?:\/\//i.test(id)) {
    try {
      const u = new URL(id);
      if (u.protocol !== 'https:' || !/^(?:www\.|music\.|m\.)?youtube\.com$/i.test(u.hostname)) return null;
      id = u.searchParams.get('list') || '';
    } catch { return null; }
  }
  return /^[A-Za-z0-9_-]{2,200}$/.test(id) ? id : null;
};
