import React, { useEffect, useState } from 'react';
import type { Track } from '../../types';
import { resolveCover, getCachedCover, youtubeThumb, imageExists } from '../../services/covers';

/* ═══════════════════════════════════════════════════════════════
   Pochette d'un morceau.

   Ordre de préférence :
   1. la vraie pochette d'album, trouvée par le catalogue iTunes ;
   2. la vignette de la vidéo YouTube, si elle existe encore ;
   3. un dégradé aux initiales, dessiné localement.

   Les deux premières sont vérifiées (une vidéo retirée renvoie 404) :
   on n'affiche jamais d'image cassée, et on ne remplace jamais une
   image valide par un repli.
   ═══════════════════════════════════════════════════════════════ */

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
};

export const initials = (t: { title?: string; artist?: string }) => {
  const a = (t.artist || '').trim();
  const ti = (t.title || '').trim();
  const src = a || ti || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : src.slice(0, 2)).toUpperCase();
};

/** la meilleure URL connue, sans requête réseau bloquante */
export const bestCover = (t: { videoId?: string; title?: string; artist?: string; thumbnailUrl?: string }) => {
  const cached = getCachedCover(t.artist || '', t.title || '');
  if (cached) return { url: cached.small, large: cached.large, small: cached.small };
  const yt = youtubeThumb(t.videoId, 480);
  if (yt) return { url: yt, large: youtubeThumb(t.videoId, 1280), small: yt };
  return { url: t.thumbnailUrl || '', large: t.thumbnailUrl || '', small: t.thumbnailUrl || '' };
};

type Size = number | string;

const coverCache = new Map<string, string>();

export const useCover = (
  t: { videoId?: string; title?: string; artist?: string; thumbnailUrl?: string },
  wantLarge = false,
): { url: string; large: string; small: string } => {
  const cacheKey = `${t.videoId || ''}|${t.artist || ''}|${t.title || ''}`;
  const [state, setState] = useState(() => {
    const known = coverCache.get(cacheKey);
    if (known) return { url: known, large: known, small: known };
    return bestCover(t);
  });

  useEffect(() => {
    let alive = true;
    const known = coverCache.get(cacheKey);
    if (known) { setState({ url: known, large: known, small: known }); return; }

    void (async () => {
      /* 1. la vraie pochette d'album */
      const cover = await resolveCover(t.artist || '', t.title || '');
      if (!alive) return;
      if (cover) {
        coverCache.set(cacheKey, wantLarge ? cover.large : cover.small);
        setState({ url: cover.small, large: cover.large, small: cover.small });
        return;
      }
      /* 2. sinon la vignette YouTube — mais seulement si elle existe */
      const yt = youtubeThumb(t.videoId, 480);
      if (yt) {
        const ok = await imageExists(yt);
        if (!alive) return;
        if (ok) {
          coverCache.set(cacheKey, yt);
          setState({ url: yt, large: youtubeThumb(t.videoId, 1280), small: yt });
          return;
        }
      }
      /* 3. le repli dessiné */
      setState({ url: '', large: '', small: '' });
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, wantLarge]);

  return state;
};

export const Art: React.FC<{
  track: Pick<Track, 'videoId' | 'title' | 'artist' | 'thumbnailUrl'>;
  size?: Size;
  radius?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
  /** demande l'artwork 1000 px (plein écran) */
  large?: boolean;
}> = ({ track, size = '100%', radius = 6, className, style, alt = '', large = false }) => {
  const { url } = useCover(track, large);
  const [shown, setShown] = useState(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => { setShown(url); setFailed(false); }, [url]);

  const h = hash(`${track.artist}|${track.title}`);
  const hue = (h * 37) % 360;
  const hue2 = (hue + 42) % 360;
  const px = typeof size === 'number' ? size : 0;

  return (
    <span
      className={className}
      style={{
        position: 'relative', display: 'block', overflow: 'hidden',
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        borderRadius: radius, flex: '0 0 auto',
        background: `linear-gradient(135deg, hsl(${hue} 52% 34%), hsl(${hue2} 58% 20%))`,
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: px ? Math.max(10, px * 0.3) : 13,
          fontWeight: 700, letterSpacing: '.02em', color: 'rgba(255,255,255,.82)',
        }}
      >
        {initials(track)}
      </span>
      {shown && !failed && (
        <img
          src={shown}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </span>
  );
};

/* ─────────── vignette d'une playlist : mosaïque de quatre pochettes ───────────
   Une playlist n'a pas de pochette unique. Plutôt qu'un dégradé anonyme,
   on montre les quatre premiers morceaux, comme les vraies applications. */

export const PlaylistArt: React.FC<{
  tracks?: Pick<Track, 'videoId' | 'title' | 'artist' | 'thumbnailUrl'>[];
  title: string;
  size?: Size;
  radius?: number;
  className?: string;
}> = ({ tracks, title, size = '100%', radius = 10, className }) => {
  const four = (tracks || []).slice(0, 4);
  const px = typeof size === 'number' ? size : 0;

  if (four.length < 2) {
    return (
      <Art
        track={four[0] ?? { videoId: '', title, artist: '', thumbnailUrl: '' }}
        size={size}
        radius={radius}
        className={className}
      />
    );
  }

  const cell = px ? Math.ceil(px / 2) : '100%';
  return (
    <span
      className={className}
      style={{
        position: 'relative', display: 'grid', overflow: 'hidden',
        gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
        borderRadius: radius, flex: '0 0 auto', gap: 0,
        background: 'rgba(0,0,0,.25)',
      }}
    >
      {four.map((t, i) => (
        <Art key={`${t.videoId}-${i}`} track={t} size={cell} radius={0} />
      ))}
    </span>
  );
};
