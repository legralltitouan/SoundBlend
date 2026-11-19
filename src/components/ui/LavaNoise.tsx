import React from 'react';

/* ═══════════════════════════════════════════════════════════════
   La lampe à lave, en bruit.

   Le principe est celui de la vraie lampe : quelques poches de couleur
   chaude qui montent, se rejoignent et se déforment dans le noir. Mais
   ici la déformation n'est pas dessinée — elle est produite par une
   turbulence SVG animée qui pousse les bords de chaque poche, et le
   grain de film est posé par-dessus.

   Trois couches, dans cet ordre :
     1. les poches (ellipses floues) déformées par `feDisplacementMap` ;
     2. une seconde turbulence, plus fine, pour le grain du verre ;
     3. un masque radial : la lampe est posée dans le noir, ses bords
        s'éteignent au lieu de s'arrêter net.

   Deux animations SVG seulement (les fréquences de bruit), plus deux
   dérives CSS : assez pour que ça vive, pas assez pour saccader.
   ═══════════════════════════════════════════════════════════════ */

export type LavaProps = {
  /** teinte principale des poches */
  color?: string;
  /** teinte secondaire, plus froide, pour les poches du fond */
  shade?: string;
  /** 0 → à peine perceptible, 1 → plein écran */
  intensity?: number;
  /** le grain : plus il est fort, plus ça ressemble à de la pellicule */
  grain?: number;
  className?: string;
};

export const LavaNoise: React.FC<LavaProps> = ({
  color = '#ff0033',
  shade = '#5e39ff',
  intensity = 1,
  grain = 0.55,
  className,
}) => {
  const uid = React.useId().replace(/[:]/g, '');
  const soft = `lava-soft-${uid}`;

  return (
    <div className={`sb-lava ${className || ''}`} style={{ opacity: intensity }} aria-hidden>
      <svg
        className="sb-lava-svg"
        viewBox="0 0 1000 620"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* — l'onde qui déforme les poches — */}
          <filter id={soft} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
            <feTurbulence type="turbulence" baseFrequency="0.0038 0.0062" numOctaves="4" seed="14" result="n">
              <animate
                attributeName="baseFrequency"
                dur="46s"
                values="0.0038 0.0062; 0.0072 0.0040; 0.0038 0.0062"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic" in2="n" scale="190"
              xChannelSelector="R" yChannelSelector="B" result="d1"
            />
            {/* le contour : un bruit fin casse le bord lisse de l'ellipse.
                C'est ce qui donne l'aspect « fumée » des références. */}
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="4" seed="31" result="fine">
              <animate attributeName="seed" dur="9s" values="31;38;31" repeatCount="indefinite" calcMode="discrete" />
            </feTurbulence>
            <feDisplacementMap in="d1" in2="fine" scale="26" xChannelSelector="R" yChannelSelector="G" result="d2" />
            <feGaussianBlur in="d2" stdDeviation="11" />
          </filter>

          <radialGradient id={`core-${uid}`}>
            <stop offset="0%" stopColor="#fff" stopOpacity="0.30" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* — 1 · les poches — */}
        <g filter={`url(#${soft})`} className="sb-lava-poches">
          <ellipse className="p1" cx="250" cy="230" rx="330" ry="215" fill={color} opacity="0.95" />
          <ellipse className="p2" cx="700" cy="400" rx="350" ry="230" fill={color} opacity="0.85" />
          <ellipse className="p3" cx="500" cy="120" rx="250" ry="160" fill={shade} opacity="0.55" />
          <ellipse className="p4" cx="820" cy="150" rx="230" ry="160" fill={color} opacity="0.5" />
          {/* une lueur blanche au centre : c'est elle qui fait « verre » */}
          <ellipse cx="470" cy="300" rx="300" ry="200" fill={`url(#core-${uid})`} />
        </g>
      </svg>

      {/* — 2 · le grain de pellicule, en deux épaisseurs — */}
      <span className="sb-lava-grain" style={{ opacity: grain }} />
      <span className="sb-lava-grain sb-lava-grain--fine" style={{ opacity: grain * 0.55 }} />

      {/* — 3 · les bords qui s'éteignent — */}
      <span className="sb-lava-vignette" />
    </div>
  );
};

export default LavaNoise;
