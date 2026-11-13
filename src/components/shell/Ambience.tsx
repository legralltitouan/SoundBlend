import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { useUI } from '../../context/UIContext';
import { usePalette, paletteToCss, paletteKey } from '../../lib/palette';
import { useCover } from '../ui/Art';

/* ═══════════════════════════════════════════════════════════════
   Ambiance de fond, commune à tout le site.

   · trois nappes de couleur qui viennent de la pochette du morceau
     en cours (teintes réellement lues dans l'image), elles dérivent
     lentement et respirent au rythme de la lecture ;
   · un grain fin par-dessus, façon pellicule, pour casser les dégradés.

   Quand la pochette change, les trois nappes se croisent en fondu :
   la nouvelle palette arrive par-dessus l'ancienne.
   ═══════════════════════════════════════════════════════════════ */

type Layer = { id: string; src: string; css: React.CSSProperties; fading: boolean };

export const Ambience: React.FC = () => {
  const { currentTrack, isPlaying } = usePlayer();
  const { mode } = useUI();
  /* l'ambiance se lit dans la vraie pochette d'album, et non dans la
     vignette YouTube : celle-ci ne transmet pas d'en-tête CORS, ses pixels
     seraient illisibles — et elle manque carrément quand la vidéo est retirée. */
  const cover = useCover(currentTrack ?? { videoId: '', title: '', artist: '' });
  const src = currentTrack ? cover.small : '';
  const palette = usePalette(src);
  const key = paletteKey(palette);
  /* la même palette garde le même objet de styles : pas de boucle de rendu */
  const css = useMemo(() => paletteToCss(palette), [key]);

  /* deux couches au plus : l'ancienne s'efface pendant que la nouvelle arrive */
  const [layers, setLayers] = useState<Layer[]>([
    { id: `base-${src || 'none'}`, src, css, fading: false },
  ]);
  const lastSrc = useRef(src);
  const lastKey = useRef(key);

  useEffect(() => {
    if (lastSrc.current === src) {
      if (lastKey.current === key) return;          // rien n'a bougé
      /* même morceau, palette affinée : on met à jour sans fondu */
      lastKey.current = key;
      setLayers((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, css } : x)));
      return;
    }
    lastSrc.current = src;
    lastKey.current = key;
    const id = `${src}-${Date.now()}`;
    setLayers((l) => [...l.slice(-1).map((x) => ({ ...x, fading: true })), { id, src, css, fading: false }]);
  }, [src, key, css]);

  /* la palette est publiée sur :root : la vague et le plein écran la lisent */
  useEffect(() => {
    const root = document.documentElement.style;
    Object.entries(css).forEach(([k, v]) => root.setProperty(k, String(v)));
    window.dispatchEvent(new CustomEvent('sb:palette'));
  }, [css]);

  return (
    <div className="ambience" data-mode={mode} data-playing={isPlaying} aria-hidden>
      {layers.map((l) => (
        <div key={l.id} className="ambience__layer" data-fading={l.fading} style={l.css}>
          <div className="ambience__blob ambience__blob--1" />
          <div className="ambience__blob ambience__blob--2" />
          <div className="ambience__blob ambience__blob--3" />
        </div>
      ))}
      <div className="ambience__grain" />
    </div>
  );
};
