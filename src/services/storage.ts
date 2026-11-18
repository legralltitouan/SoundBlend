import type { AppSettings, BlendTombstone, DiscoveryRecord, ExclusionRecord, Exclusions, GeneratedBlend, Track } from '../types';
import { cleanTitle, norm, sameTrack } from '../lib/track';
import { scopedGetItem, scopedSetItem } from './accountScope';

/* Données privées, sur cet appareil puis dans le dossier appData de Drive.
   Les anciens avis ne deviennent jamais des exclusions : un pouce sur un
   morceau ne signifiait pas que tout son artiste devait être bloqué. */
const SETTINGS_KEY = 'soundblend_settings';
const SETTINGS_AT_KEY = 'soundblend_settings_at_v2';
const EXCLUSIONS_KEY = 'soundblend_exclusions_v1';
const HISTORY_KEY = 'soundblend_discoveries_v2';
const BLENDS_KEY = 'soundblend_recent_blends';
const TOMBSTONES_KEY = 'soundblend_blend_deletions_v1';
const MIGRATION_KEY = 'soundblend_no_ratings_migration_v1';
export const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

const read = <T,>(key: string, fallback: T): T => {
  try { const raw = scopedGetItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
};
/** Les actions utilisateur ne doivent jamais annoncer un succès si le
    navigateur a refusé l'écriture (quota, stockage interdit, etc.). */
const write = (key: string, value: unknown): void => {
  try { scopedSetItem(key, JSON.stringify(value)); }
  catch { throw new Error('Stockage local indisponible ou plein : modification non enregistrée.'); }
};
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sb:data-changed')); };

export const DEFAULT_SETTINGS: AppSettings = { googleClientId: '', youtubeApiKey: '', geminiApiKey: '' };
export const getStoredSettings = (): AppSettings => {
  const s = read<Partial<AppSettings>>(SETTINGS_KEY, {});
  return { googleClientId: s.googleClientId || '', youtubeApiKey: s.youtubeApiKey || '', geminiApiKey: s.geminiApiKey || '' };
};
export const getSettingsAt = (): number => {
  const settings = read<{ _updatedAt?: number }>(SETTINGS_KEY, {});
  return Number(settings._updatedAt) || Number(read(SETTINGS_AT_KEY, 0)) || 0;
};
/** Valeur et date dans une même écriture atomique de localStorage. */
export const saveStoredSettings = (s: AppSettings, distantAt?: number): void => {
  const at = distantAt === undefined ? Math.max(Date.now(), getSettingsAt() + 1) : distantAt;
  write(SETTINGS_KEY, { ...s, _updatedAt: at, _pending: distantAt === undefined });
  if (distantAt === undefined) notify();
};
export const settingsEnAttente = (): boolean => !!read<{ _pending?: boolean }>(SETTINGS_KEY, {})._pending;
export const rebaserSettings = (at: number): void => {
  write(SETTINGS_KEY, { ...getStoredSettings(), _updatedAt: at, _pending: true });
};
export const confirmerSettings = (at: number): void => {
  if (settingsEnAttente() && getSettingsAt() === at) {
    write(SETTINGS_KEY, { ...getStoredSettings(), _updatedAt: at, _pending: false });
  }
};

const withoutRating = (t: Track): Track => {
  const copy = { ...t } as Track & { userRating?: unknown };
  delete copy.userRating;
  return copy;
};
export const cleanBlend = (b: GeneratedBlend): GeneratedBlend => ({
  ...b,
  seedTracks: Array.isArray(b.seedTracks) ? b.seedTracks.map(withoutRating) : [],
  tracks: Array.isArray(b.tracks) ? b.tracks.map(withoutRating) : [],
});

/** Les anciennes données restent sur l'appareil, sans être importées ou
    supprimées. Les anciens pouces ne deviennent jamais des exclusions. */
export const migrateLegacyData = (): void => {
  try {
    if (scopedGetItem(MIGRATION_KEY)) return;
    scopedSetItem(MIGRATION_KEY, '1');
  } catch { /* la migration non destructive peut être retentée plus tard */ }
};

// Normalisations pures très répétées pendant les filtres. Caches bornés en
// nombre ET en longueur de clé ; titres et artistes restent en mémoire de l’onglet,
// sans stockage persistant ni mise en commun entre onglets.
const memoNormalisation = (compute: (value: string) => string) => {
  const cache = new Map<string, string>();
  return (value: string): string => {
    const key = value || '';
    if (key.length > 512) return compute(key);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const result = compute(key);
    if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  };
};
const artistNorm = memoNormalisation((s) => norm(s.replace(/\s*[-–—]\s*topic$/i, '').replace(/\s+official$/i, '')));
/** Compare les collaborateurs sans confondre « Air » avec « Air Supply ». */
export const artistMatches = (candidate: string, blocked: string) => {
  const a = artistNorm(candidate), b = artistNorm(blocked);
  if (!a || !b) return false;
  if (a === b) return true;
  // Garder les collaborations parenthésées avant la normalisation, qui
  // supprime normalement le contenu des parenthèses et des crochets.
  const withFeatures = (candidate || '')
    .replace(/\(\s*(feat\.?|ft\.?|featuring|with|avec)\s+([^)]*)\)/gi, ' $1 $2 ')
    .replace(/\[\s*(feat\.?|ft\.?|featuring|with|avec)\s+([^\]]*)\]/gi, ' $1 $2 ');
  const parts = withFeatures.split(/\s+(?:feat\.?|ft\.?|featuring|with|avec|vs\.?|and|x)\s+|\s*[,&]\s*/i).map(artistNorm);
  return parts.includes(b);
};
const titleNorm = memoNormalisation((s) => norm(cleanTitle(s).title));
const recordKey = (kind: 'track' | 'artist', t: { title?: string; artist?: string; videoId?: string }) =>
  kind === 'artist' ? `artist:${artistNorm(t.artist || '')}` : `track:${artistNorm(t.artist || '')}|${titleNorm(t.title || '')}`;

export const getExclusionRecords = (): ExclusionRecord[] => {
  const raw = read<ExclusionRecord[]>(EXCLUSIONS_KEY, []);
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === 'string' && (r.kind === 'track' || r.kind === 'artist') && typeof r.updatedAt === 'number') : [];
};
export const mergeExclusionRecords = (a: ExclusionRecord[] = [], b: ExclusionRecord[] = []): ExclusionRecord[] => {
  const byId = new Map<string, ExclusionRecord>();
  for (const r of [...a, ...b]) {
    if (!r || !r.id || !['artist', 'track'].includes(r.kind) || !Number.isFinite(r.updatedAt)) continue;
    const old = byId.get(r.id);
    if (!old || r.updatedAt > old.updatedAt || (r.updatedAt === old.updatedAt && r.deleted && !old.deleted)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
};
export const writeExclusionRecords = (records: ExclusionRecord[]): void => write(EXCLUSIONS_KEY, mergeExclusionRecords(records));
/** Les marqueurs sont purement locaux, jamais interprétés dans le Drive. */
export const exclusionPourDrive = (r: ExclusionRecord): ExclusionRecord => {
  const { _pending, ...remote } = r; return remote;
};
const memeExclusion = (a: ExclusionRecord, b: ExclusionRecord): boolean =>
  a.id === b.id && a.kind === b.kind && a.artist === b.artist && (a.title || '') === (b.title || '')
  && (a.videoId || '') === (b.videoId || '') && a.deleted === b.deleted;
/** Index de recherche équivalent à Array.find : le premier doublon gagne.
    Utilisé lors des confirmations pour éviter une recherche quadratique. */
const indexPremierParId = <T extends { id: string }>(records: T[]): Map<string, T> => {
  const index = new Map<string, T>();
  for (const record of records) if (!index.has(record.id)) index.set(record.id, record);
  return index;
};
export const fusionnerExclusionsAvecGestesLocaux = (local: ExclusionRecord[], remote: ExclusionRecord[]): ExclusionRecord[] => {
  const latest = mergeExclusionRecords(remote.map(exclusionPourDrive));
  const latestById = indexPremierParId(latest);
  const rebased = local.map((r) => {
    const other = latestById.get(r.id);
    if (!r._pending || !other || other.updatedAt < r.updatedAt || memeExclusion(r, other)) return r;
    return { ...r, updatedAt: other.updatedAt + 1 };
  });
  return mergeExclusionRecords(rebased, latest);
};
export const confirmerExclusions = (sent: ExclusionRecord[]): void => {
  const records = getExclusionRecords(); let changed = false;
  const sentById = indexPremierParId(sent);
  const next = records.map((r) => {
    const s = sentById.get(r.id);
    if (!r._pending || !s || r.updatedAt !== s.updatedAt || !memeExclusion(r, s)) return r;
    changed = true; return exclusionPourDrive(r);
  });
  if (changed) writeExclusionRecords(next);
};
export const getExclusions = (): Exclusions => {
  const active = getExclusionRecords().filter((r) => !r.deleted);
  return { tracks: active.filter((r) => r.kind === 'track'), artists: active.filter((r) => r.kind === 'artist').map((r) => r.artist) };
};
export const block = (t: { title?: string; artist?: string; videoId?: string }, kind: 'track' | 'artist'): ExclusionRecord => {
  const artist = (t.artist || '').trim();
  const title = (t.title || '').trim();
  if (!artist || (kind === 'track' && !title)) throw new Error('Titre ou artiste manquant : impossible de bloquer.');
  const records = getExclusionRecords();
  const id = recordKey(kind, t);
  const old = records.find((r) => r.id === id);
  const record: ExclusionRecord = { id, kind, artist, ...(kind === 'track' ? { title, videoId: t.videoId || undefined } : {}), updatedAt: Math.max(Date.now(), (old?.updatedAt || 0) + 1), deleted: false, _pending: true };
  writeExclusionRecords([...records.filter((r) => r.id !== id), record]);
  notify();
  return record;
};
export const unblock = (id: string): void => {
  const records = getExclusionRecords();
  const old = records.find((r) => r.id === id);
  if (!old || old.deleted) return;
  writeExclusionRecords([...records.filter((r) => r.id !== id), { ...old, deleted: true, updatedAt: Math.max(Date.now(), old.updatedAt + 1), _pending: true }]);
  notify();
};
/** S'applique à la suggestion ET au résultat YouTube réel. */
export const isExcluded = (t: { title?: string; artist?: string; videoId?: string }, exclusions = getExclusions()): boolean => {
  const cleaned = cleanTitle(t.title || '');
  const artists = [t.artist || '', cleaned.artist || ''].filter(Boolean);
  if (exclusions.artists.some((a) => artists.some((candidate) => artistMatches(candidate, a)))) return true;
  let title: string | undefined;
  return exclusions.tracks.some((r) => {
    if (r.videoId && t.videoId && r.videoId === t.videoId) return true;
    return !!r.title && titleNorm(r.title) === (title ??= titleNorm(t.title || '')) && artists.some((candidate) => artistMatches(candidate, r.artist));
  });
};

export const getDiscoveryHistory = (now = Date.now()): DiscoveryRecord[] => {
  const raw = read<DiscoveryRecord[]>(HISTORY_KEY, []);
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r.title === 'string' && typeof r.artist === 'string' && Number.isFinite(r.shownAt) && r.shownAt > now - FOURTEEN_DAYS) : [];
};
const discoveryKey = (r: { title: string; artist: string; videoId?: string }) => `${artistNorm(r.artist)}|${titleNorm(r.title)}`;
export const mergeDiscoveryHistory = (a: DiscoveryRecord[] = [], b: DiscoveryRecord[] = [], now = Date.now()): DiscoveryRecord[] => {
  const map = new Map<string, DiscoveryRecord>();
  for (const r of [...a, ...b]) {
    if (!r || typeof r.title !== 'string' || typeof r.artist !== 'string' || !Number.isFinite(r.shownAt) || r.shownAt <= now - FOURTEEN_DAYS) continue;
    const key = discoveryKey(r);
    const prev = map.get(key);
    if (!prev || prev.shownAt < r.shownAt) map.set(key, r);
  }
  return [...map.values()].sort((x, y) => x.shownAt - y.shownAt);
};
export const writeDiscoveryHistory = (h: DiscoveryRecord[]) => write(HISTORY_KEY, mergeDiscoveryHistory(h));
export const isRecentlyProposed = (t: { title?: string; artist?: string; videoId?: string }, history = getDiscoveryHistory()): boolean => {
  const artists = [t.artist || '', cleanTitle(t.title || '').artist || ''].filter(Boolean);
  let title: string | undefined;
  return history.some((h) => {
    if (h.videoId && t.videoId && h.videoId === t.videoId) return true;
    const historicalTitle = titleNorm(h.title);
    return historicalTitle !== '' && historicalTitle === (title ??= titleNorm(t.title || ''))
      && artists.some((a) => artistMatches(a, h.artist));
  });
};
export const recentArtists = (history = getDiscoveryHistory()): string[] => [...new Set(history.map((h) => h.artist).filter(Boolean))];
export const recordDiscoveries = (tracks: Track[], shownAt = Date.now(), emit = true): void => {
  const records = tracks.filter((t) => t && t.category !== 'anchor' && t.title && t.artist).map((t) => ({ title: t.title, artist: t.artist, videoId: t.videoId || undefined, shownAt }));
  if (!records.length) return;
  writeDiscoveryHistory(mergeDiscoveryHistory(getDiscoveryHistory(), records));
  if (emit) notify();
};
/** Pour une ancienne version : les blends encore vivants suffisent à
    reconstruire un historique daté ; l'ancien journal sans date est ignoré. */
export const learnDiscoveriesFromBlends = (blends: GeneratedBlend[]): void => {
  const records: DiscoveryRecord[] = [];
  for (const b of blends) {
    const at = Date.parse(b.createdAt);
    if (!Number.isFinite(at)) continue;
    for (const t of b.tracks || []) {
      if (t.category === 'anchor' || (b.seedTracks || []).some((s) => sameTrack(s, t))) continue;
      records.push({ title: t.title, artist: t.artist, videoId: t.videoId, shownAt: at });
    }
  }
  const before = getDiscoveryHistory();
  const next = mergeDiscoveryHistory(before, records);
  if (JSON.stringify(before) !== JSON.stringify(next)) writeDiscoveryHistory(next);
};

export const getBlendTombstones = (): Record<string, BlendTombstone> => {
  const raw = read<Record<string, BlendTombstone>>(TOMBSTONES_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([_, v]) => v && Number.isFinite(v.at) && Number.isFinite(v.expiresAt) && v.expiresAt > Date.now()));
};
export const mergeBlendTombstones = (a: Record<string, BlendTombstone> = {}, b: Record<string, BlendTombstone> = {}): Record<string, BlendTombstone> => {
  const result = { ...a };
  for (const [id, t] of Object.entries(b || {})) {
    if (t && Number.isFinite(t.at) && Number.isFinite(t.expiresAt) && t.expiresAt > Date.now() && (!result[id] || t.at > result[id].at)) result[id] = t;
  }
  return Object.fromEntries(Object.entries(result).filter(([_, t]) => t && t.expiresAt > Date.now()));
};
export const writeBlendTombstones = (t: Record<string, BlendTombstone>) => write(TOMBSTONES_KEY, mergeBlendTombstones(t));
export const getStoredBlends = (): GeneratedBlend[] => {
  const raw = read<GeneratedBlend[]>(BLENDS_KEY, []);
  if (!Array.isArray(raw)) return [];
  const deleted = getBlendTombstones();
  const now = Date.now();
  const valid = raw.filter((b) => {
    if (!b || !b.id || deleted[b.id]) return false;
    const expiresAt = Date.parse(b.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now;
  }).map(cleanBlend);
  // La lecture ne modifie pas l'archive historique ni les données expirées.
  // Le nettoyage des champs obsolètes ne s'applique qu'à la copie utilisée.
  return valid;
};
export const writeStoredBlends = (blends: GeneratedBlend[]): void => write(BLENDS_KEY, blends.map(cleanBlend));
export const blendPourDrive = (b: GeneratedBlend): GeneratedBlend => { const { _pending, ...remote } = cleanBlend(b); return remote; };
export const confirmerBlends = (sent: GeneratedBlend[]): void => {
  let changed = false;
  const sentById = indexPremierParId(sent);
  const next = getStoredBlends().map((b) => {
    const s = sentById.get(b.id);
    if (!b._pending || !s || b.updatedAt !== s.updatedAt || JSON.stringify(blendPourDrive(b)) !== JSON.stringify(blendPourDrive(s))) return b;
    changed = true; return blendPourDrive(b);
  });
  if (changed) writeStoredBlends(next);
};
export const saveBlendToStorage = (blend: GeneratedBlend): GeneratedBlend => {
  const existing = getStoredBlends();
  const old = existing.find((b) => b.id === blend.id);
  const b = cleanBlend({ ...blend, updatedAt: Math.max(Date.now(), (old?.updatedAt || 0) + 1), _pending: true });
  writeStoredBlends([b, ...existing.filter((x) => x.id !== b.id)]);
  notify();
  return b;
};
export const deleteStoredBlend = (id: string): void => {
  const existing = getStoredBlends();
  const b = existing.find((x) => x.id === id);
  if (!b) return;
  // La pierre tombale est l'opération décisive, écrite atomiquement avant
  // tout nettoyage. Elle empêche la résurrection par un ancien appareil.
  const tombstones = getBlendTombstones();
  tombstones[id] = { at: Math.max(Date.now(), (b.updatedAt || 0) + 1), expiresAt: Date.parse(b.expiresAt) };
  writeBlendTombstones(tombstones);
  try { writeStoredBlends(existing.filter((x) => x.id !== id)); } catch { /* déjà masqué par la pierre tombale */ }
  notify();
};

/* Portrait technique du curateur. Il n'est pas une liste d'avis. */
const PORTRAIT_KEY = 'soundblend_portrait_v1';
export type SoundPortrait = { style: string; genres: string[]; textures: string[]; avoid: string[]; energy: string; at: string; _pending?: boolean };
export const getStoredPortrait = (): SoundPortrait | null => {
  const p = read<SoundPortrait | null>(PORTRAIT_KEY, null);
  return p && typeof p.style === 'string' ? p : null;
};
export const portraitPourDrive = (p: SoundPortrait): SoundPortrait => { const { _pending, ...remote } = p; return remote; };
export const saveStoredPortrait = (p: SoundPortrait, distant = false): void => {
  const previous = getStoredPortrait();
  const at = distant ? p.at : new Date(Math.max(Date.parse(p.at) || Date.now(), (Date.parse(previous?.at || '') || 0) + 1)).toISOString();
  write(PORTRAIT_KEY, { ...portraitPourDrive(p), at, _pending: !distant });
  if (!distant) notify();
};
export const rebaserPortrait = (p: SoundPortrait, at: number): void => write(PORTRAIT_KEY, { ...p, at: new Date(at).toISOString(), _pending: true });
export const confirmerPortrait = (sent: SoundPortrait | null | undefined): void => {
  const p = getStoredPortrait();
  if (p?._pending && sent && JSON.stringify(portraitPourDrive(p)) === JSON.stringify(portraitPourDrive(sent))) write(PORTRAIT_KEY, portraitPourDrive(p));
};
