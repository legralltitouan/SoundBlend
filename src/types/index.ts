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
  /** Indication de vérification à la composition ou à la réparation.
      Les métadonnées oEmbed ne garantissent pas la lecture réelle. */
  verifie?: boolean;
  category?: TrackCategory;
  rationale?: string;
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
  /** Consigne libre fournie par l’assistant, transmise au curateur. */
  instruction?: string;
}

export interface GeneratedBlend {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  expiresAt: string; // ISO string 14 days later
  /** Dernière modification locale, pour réconcilier les appareils. */
  updatedAt?: number;
  instruction?: string;
  seedTracks: Track[];
  tracks: Track[];
  exportedPlaylistId?: string;
  exportedUrl?: string;
  /** Ce que la playlist YouTube contient — et s'appelle — depuis le
      dernier envoi. C'est cette référence qui décide s'il faut proposer
      « Mettre à jour » : on compare le blend à ce qu'on a réellement
      envoyé, et non à une relecture distante qui peut arriver en retard
      (d'où les fausses alertes juste après un export). */
  exportedMeta?: {
    sig: string;
    title: string;
    privacy: 'private' | 'public';
    at: string;
  };
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

/** Une exclusion ne découle jamais implicitement d’un avis sur un titre. */
export interface ExclusionRecord {
  id: string;
  kind: 'track' | 'artist';
  artist: string;
  title?: string;
  videoId?: string;
  updatedAt: number;
  deleted: boolean;
}

export interface Exclusions {
  tracks: ExclusionRecord[];
  artists: string[];
}

export interface DiscoveryRecord {
  title: string;
  artist: string;
  videoId?: string;
  shownAt: number;
}

export interface BlendTombstone { at: number; expiresAt: number }

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
