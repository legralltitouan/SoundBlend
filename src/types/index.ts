export type TrackCategory = 'anchor' | 'deep_dive' | 'fresh';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  thumbnailUrl: string;
  durationSeconds: number;
  durationFormatted?: string;
  videoUrl?: string;
  videoId: string;
  /** Vérifié sur YouTube (le lecteur répond-il ?) — posé une fois, pour
      toute la vie du morceau, quand le blend est composé. */
  verifie?: boolean;
  category?: TrackCategory;
  rationale?: string;
  userRating?: 'liked' | 'disliked' | null;
}

export interface Playlist {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  trackCount: number;
  tracks?: Track[];
}

export interface BlendRatio {
  anchor: number;      // e.g. 30
  deepDive: number;    // e.g. 30
  fresh: number;       // e.g. 40
}

export interface BlendConfig {
  durationMinutes: number; // e.g. 20, 45, 60, 120
  ratio: BlendRatio;
}

export interface GeneratedBlend {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  expiresAt: string; // ISO string 14 days later
  seedTracks: Track[];
  tracks: Track[];
  exportedPlaylistId?: string;
  exportedUrl?: string;
  /** par quel moyen ce blend a été composé — dit sur le blend lui-même */
  methode?: BlendMethod;
}

/**
 * Comment ce blend a été composé. On le garde sur le blend, pas seulement
 * à l'écran de composition : une semaine plus tard, la question « c'est
 * l'IA ou du voisinage ? » doit encore avoir sa réponse.
 */
export type BlendMethod = {
  /** 'gemini' = le modèle a composé ; 'voisinage' = sans IA ; 'mixte' = les deux */
  kind: 'gemini' | 'voisinage' | 'mixte';
  /** le modèle qui a répondu, s'il y en a un */
  model?: string;
  /** une phrase pour l'écran, déjà rédigée */
  detail: string;
};

export interface TasteMemoryItem {
  id: string;
  title: string;
  artist: string;
  addedAt: string;
}

export interface TasteMemory {
  likedTracks: TasteMemoryItem[];
  dislikedTracks: TasteMemoryItem[];
  likedArtists: string[];
  dislikedArtists: string[];
  /**
   * Tout ce qui a déjà été proposé à cet auditeur, refusé ou non.
   * Un remplacement ne doit jamais reproposer deux fois le même titre :
   * c'est ce journal qui l'en empêche, pas le hasard.
   */
  seenTracks?: string[];
}

export interface AppSettings {
  googleClientId: string;
  youtubeApiKey: string;
  geminiApiKey: string;
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string;
  channelTitle?: string;
}
