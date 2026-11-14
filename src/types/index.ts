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
}

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
  /** clés de secours, essayées quand la première est à court de quota */
  geminiApiKeys?: string[];
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl: string;
  channelTitle?: string;
}
