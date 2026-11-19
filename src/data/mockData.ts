import { Playlist, Track } from '../types';

export const MOCK_PLAYLISTS: Playlist[] = [
  {
    id: 'demo-pl-french-touch',
    title: 'French Touch & Electronic Vibes',
    description: 'Le son électro français intemporel : Daft Punk, Justice, Kavinsky, Gesaffelstein.',
    thumbnailUrl: '',
    trackCount: 7,
    tracks: [
      {
        id: 'ft-0',
        videoId: 'dX3k_QDnzHE',
        title: 'Midnight City',
        artist: 'M83',
        album: 'Hurry Up, We’re Dreaming',
        thumbnailUrl: '',
        durationSeconds: 243,
        durationFormatted: '4:03'
      },
      {
        id: 'ft-1',
        videoId: 'TCd6PfxOy0Y',
        title: 'Veridis Quo',
        artist: 'Daft Punk',
        album: 'Discovery',
        thumbnailUrl: '',
        durationSeconds: 345,
        durationFormatted: '5:45'
      },
      {
        id: 'ft-2',
        videoId: 'MV_3Dpw-BRY',
        title: 'Nightcall',
        artist: 'Kavinsky',
        album: 'OutRun',
        thumbnailUrl: '',
        durationSeconds: 259,
        durationFormatted: '4:19'
      },
      {
        id: 'ft-3',
        videoId: 'tCnBrrnOefs',
        title: 'D.A.N.C.E.',
        artist: 'Justice',
        album: 'Cross',
        thumbnailUrl: '',
        durationSeconds: 242,
        durationFormatted: '4:02'
      },
      {
        id: 'ft-4',
        videoId: '_XhLIXjUtFg',
        title: 'OPR',
        artist: 'Gesaffelstein',
        album: 'Aleph',
        thumbnailUrl: '',
        durationSeconds: 236,
        durationFormatted: '3:56'
      },
      {
        id: 'ft-5',
        videoId: 'yr_HIrfr7is',
        title: 'Intro',
        artist: 'M83',
        album: 'Hurry Up, We\'re Dreaming',
        thumbnailUrl: '',
        durationSeconds: 322,
        durationFormatted: '5:22'
      },
      {
        id: 'ft-6',
        videoId: 'QpxFcMYRV08',
        title: 'A New Error',
        artist: 'Moderat',
        album: 'Moderat',
        thumbnailUrl: '',
        durationSeconds: 367,
        durationFormatted: '6:07'
      }
    ]
  },
  {
    id: 'demo-pl-chill-rap',
    title: 'Melodic Rap & Chill Sunset',
    description: 'Textes soignés et mélodies enveloppantes : Lomepal, Orelsan, Disiz, Damso.',
    thumbnailUrl: '',
    trackCount: 6,
    tracks: [
      {
        id: 'cr-0',
        videoId: 'dX3k_QDnzHE',
        title: 'Midnight City',
        artist: 'M83',
        album: 'Hurry Up, We’re Dreaming',
        thumbnailUrl: '',
        durationSeconds: 243,
        durationFormatted: '4:03'
      },
      {
        id: 'cr-1',
        videoId: 'Bkm03KcnKHE',
        title: 'Trop beau',
        artist: 'Lomepal',
        album: 'Jeannine',
        thumbnailUrl: '',
        durationSeconds: 243,
        durationFormatted: '4:03'
      },
      {
        id: 'cr-2',
        videoId: 'dcAfOv5gyQw',
        title: 'Rencontre',
        artist: 'Disiz ft. Damso',
        album: 'L\'Amour',
        thumbnailUrl: '',
        durationSeconds: 202,
        durationFormatted: '3:22'
      },
      {
        id: 'cr-3',
        videoId: 'rXF1Si3LEEU',
        title: 'La Quête',
        artist: 'Orelsan',
        album: 'Civilisation',
        thumbnailUrl: '',
        durationSeconds: 244,
        durationFormatted: '4:04'
      },
      {
        id: 'cr-4',
        videoId: 'iXp9xuNi0mU',
        title: '1000°C',
        artist: 'Lomepal ft. Roméo Elvis',
        album: 'Jeannine',
        thumbnailUrl: '',
        durationSeconds: 236,
        durationFormatted: '3:56'
      },
      {
        id: 'cr-5',
        videoId: 'GUqYdsBjZxg',
        title: 'Dua Lipa',
        artist: 'Jack Harlow',
        album: 'Come Home The Kids Miss You',
        thumbnailUrl: '',
        durationSeconds: 135,
        durationFormatted: '2:15'
      }
    ]
  },
  {
    id: 'demo-pl-midnight-indie',
    title: 'Midnight Indie & Dream Pop',
    description: 'Atmosphères nocturnes, reverbs douces et voix éthérées.',
    thumbnailUrl: '',
    trackCount: 5,
    tracks: [
      {
        id: 'mi-1',
        videoId: 'RBtlPT23PTM',
        title: 'Space Song',
        artist: 'Beach House',
        album: 'Depression Cherry',
        thumbnailUrl: '',
        durationSeconds: 320,
        durationFormatted: '5:20'
      },
      {
        id: 'mi-2',
        videoId: 'sBzrzS1Ag_g',
        title: 'The Less I Know The Better',
        artist: 'Tame Impala',
        album: 'Currents',
        thumbnailUrl: '',
        durationSeconds: 216,
        durationFormatted: '3:36'
      },
      {
        id: 'mi-3',
        videoId: 'sElE_BfQ67s',
        title: 'Apocalypse',
        artist: 'Cigarettes After Sex',
        album: 'Cigarettes After Sex',
        thumbnailUrl: '',
        durationSeconds: 290,
        durationFormatted: '4:50'
      },
      {
        id: 'mi-4',
        videoId: 'kz9jhG963no',
        title: 'Chamber of Reflection',
        artist: 'Mac DeMarco',
        album: 'Salad Days',
        thumbnailUrl: '',
        durationSeconds: 231,
        durationFormatted: '3:51'
      },
      {
        id: 'mi-5',
        videoId: 'q7qdpyjHyNk',
        title: 'Perfect Girl',
        artist: 'Mareux',
        album: 'Predicament',
        thumbnailUrl: '',
        durationSeconds: 194,
        durationFormatted: '3:14'
      }
    ]
  },
  {
    id: 'demo-pl-synth-groove',
    title: 'Retro Synthwave & Neon Drive',
    description: 'Basses analogiques et ambiances cyberpunk pour rouler sous les néons.',
    thumbnailUrl: '',
    trackCount: 4,
    tracks: [
      {
        id: 'sg-1',
        videoId: 'xs9_uU18Bt4',
        title: 'Resonance',
        artist: 'HOME',
        album: 'Odyssey',
        thumbnailUrl: '',
        durationSeconds: 212,
        durationFormatted: '3:32'
      },
      {
        id: 'sg-2',
        videoId: '4NRXx6U8ABQ',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        album: 'After Hours',
        thumbnailUrl: '',
        durationSeconds: 200,
        durationFormatted: '3:20'
      },
      {
        id: 'sg-3',
        videoId: 'er416Ad3R1g',
        title: 'Turbo Killer',
        artist: 'Carpenter Brut',
        album: 'Trilogy',
        thumbnailUrl: '',
        durationSeconds: 208,
        durationFormatted: '3:28'
      },
      {
        id: 'sg-4',
        videoId: '-nC5TBv3sfU',
        title: 'Tech Noir',
        artist: 'GUNSHIP',
        album: 'GUNSHIP',
        thumbnailUrl: '',
        durationSeconds: 297,
        durationFormatted: '4:57'
      }
    ]
  }
];
