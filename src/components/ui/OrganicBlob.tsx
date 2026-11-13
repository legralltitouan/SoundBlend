import React, { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════
   La sphère organique.

   Six nappes superposées, de la plus pâle à la plus dense, qui avancent
   en file : la tête cherche un point au hasard, le corps suit avec un
   léger retard et une ondulation latérale, comme un animal qui nage.
   Chaque nappe respire à son tour, d'un décalage de 0,24 s — c'est ce
   qui fait « vivant » plutôt que « boule qui se déplace ».

   Le grain n'est pas un calque posé par-dessus : c'est le filtre
   `organic-pigment` qui déplace les bords avec un bruit fractal et
   mélange un grain coloré **à l'intérieur** de la forme. Le pigment a
   donc un grain qui lui appartient, et des bords qui ne sont jamais
   lisses.

   Les nappes portent leur propre flou (`b0`…`b5`), croissant vers
   l'extérieur : la tache n'a pas de contour, elle se dissout.

   Les couleurs suivent le thème : magenta → corail → pêche sur fond
   crème, rouge → magenta → violet sur fond noir. Le fond, lui, est peint
   par le parent (`.sb-gen`), pas ici.
   ═══════════════════════════════════════════════════════════════ */

type Props = { mode?: 'light' | 'dark'; className?: string };

/* Le filtre de pigment travaille en unités utilisateur, et son `viewBox`
   doit être la fenêtre — sinon le grain se met à l'échelle du SVG et
   devient plus fin sur un petit écran que sur un grand.

   On déborde volontairement de 140 px de chaque côté : les nappes sont
   floutées et déplacées par le bruit, elles dépassent donc largement leur
   ellipse. Sans cette marge, le bord du filtre les coupait net — c'est ça
   qu'on voyait comme un cadre autour de la boule. */
const FILTER_PAD = 140;
const viewBoxFor = (w: number, h: number) =>
  `${-FILTER_PAD} ${-FILTER_PAD} ${w + FILTER_PAD * 2} ${h + FILTER_PAD * 2}`;

/** les nappes, du cœur vers le halo. `dist` = écart au centre, en px. */
type Layer = { rx: number; ry: number; dist: number; blur: number };

const LAYERS: Layer[] = [
  { rx: 46, ry: 46, dist: 0, blur: 9 },
  { rx: 84, ry: 84, dist: 0, blur: 12 },
  { rx: 94, ry: 98, dist: 26, blur: 14 },
  { rx: 102, ry: 114, dist: 56, blur: 16 },
  { rx: 108, ry: 142, dist: 92, blur: 19 },
  { rx: 132, ry: 158, dist: 114, blur: 24 },
];

/** la palette de chaque thème, du cœur vers le halo */
const PALETTE: Record<'light' | 'dark', { fill: string; opacity: number }[]> = {
  light: [
    { fill: '#f0148c', opacity: 0.85 },
    { fill: '#f72598', opacity: 0.96 },
    { fill: '#fa4884', opacity: 0.92 },
    { fill: '#ff7866', opacity: 0.88 },
    { fill: '#ffb27e', opacity: 0.78 },
    { fill: '#ffcaa0', opacity: 0.42 },
  ],
  dark: [
    { fill: '#ff1a48', opacity: 0.92 },
    { fill: '#f0148c', opacity: 0.94 },
    { fill: '#c81ad0', opacity: 0.88 },
    { fill: '#8e2bd8', opacity: 0.80 },
    { fill: '#6532d8', opacity: 0.62 },
    { fill: '#4a2cae', opacity: 0.34 },
  ],
};

export const OrganicBlob: React.FC<Props> = ({ mode = 'light', className }) => {
  const refs = useRef<(SVGEllipseElement | null)[]>([]);
  const [vb, setVb] = React.useState(() =>
    viewBoxFor(
      typeof window === 'undefined' ? 1400 : window.innerWidth,
      typeof window === 'undefined' ? 880 : window.innerHeight,
    ));
  useEffect(() => {
    const on = () => setVb(viewBoxFor(window.innerWidth, window.innerHeight));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const palette = PALETTE[mode];

  useEffect(() => {
    const nodes = LAYERS.map((l, i) => ({
      el: refs.current[i],
      x: 0, y: 0, rx: l.rx, ry: l.ry, dist: l.dist, angle: 0,
    }));
    if (nodes.some((n) => !n.el)) return;

    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;

    nodes[0].x = nodes[1].x = vw() * 0.62;
    nodes[0].y = nodes[1].y = vh() * 0.42;

    let heading = -Math.PI / 2;
    let swim = 0;
    let breath = 0;
    let last = performance.now();
    let stopped = false;
    let raf = 0;
    let target = { x: vw() * 0.7, y: vh() * 0.3 };

    /* la respiration : une montée de 2,4 s, un plateau, une descente de
       3,4 s, puis un repos. Une fois sur quatre, elle respire plus fort. */
    const breathCurve = (t: number) => {
      const T = 7.0;
      const idx = Math.floor(t / T);
      const lt = ((t % T) + T) % T;
      const v = lt < 2.4 ? 0.5 - 0.5 * Math.cos(Math.PI * (lt / 2.4))
        : lt < 2.9 ? 1.0 - 0.015 * Math.sin(Math.PI * ((lt - 2.4) / 0.5))
        : lt < 6.3 ? 0.5 + 0.5 * Math.cos(Math.PI * ((lt - 2.9) / 3.4))
        : 0;
      return v * ((((idx % 4) + 4) % 4) === 3 ? 0.09 : 0.055) * 1.5;
    };

    /* la taille des nappes suit le plus petit côté : sur un téléphone,
       une sphère de 300 px de large nage sur l'écran sans le remplir */
    let scale = 1;
    const rescale = () => {
      scale = Math.max(0.52, Math.min(0.98, Math.min(vw(), vh()) / 900));
      target = {
        x: 120 + Math.random() * Math.max(1, vw() - 240),
        y: 120 + Math.random() * Math.max(1, vh() - 240),
      };
    };
    rescale();

    const loop = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      swim += dt * 2.5 * Math.sqrt(0.8);
      breath += dt;

      const head = nodes[1];
      /* elle vise un point, avec un léger lacet : elle ne va jamais droit */
      const desired = Math.atan2(target.y - head.y, target.x - head.x) + Math.sin(swim) * 0.24 * 0.15;
      const diff = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
      heading += Math.max(-1.65, Math.min(1.65, diff * 2.1)) * dt;

      const speed = 64 * scale;
      head.x += Math.cos(heading) * speed * dt;
      head.y += Math.sin(heading) * speed * dt;
      nodes[0].x = head.x + Math.cos(heading) * 4;
      nodes[0].y = head.y + Math.sin(heading) * 4;

      /* arrivée : on choisit un autre point, jamais hors de l'écran */
      if (Math.hypot(target.x - head.x, target.y - head.y) < 85 * scale) {
        target = {
          x: 120 + Math.random() * Math.max(1, vw() - 240),
          y: 120 + Math.random() * Math.max(1, vh() - 240),
        };
      }

      /* le corps suit, en gardant son écart et en ondulant */
      for (let i = 2; i < nodes.length; i++) {
        const p = nodes[i - 1];
        const c = nodes[i];
        const seg = (c.dist - p.dist) * scale;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        const wave = Math.sin(swim - i * 0.68) * (3.6 + i * 1.65) * 0.15 * scale;
        c.x += (p.x - (dx / d) * seg + (-dy / d) * wave - c.x) * (1 - Math.exp(-8.5 * dt));
        c.y += (p.y - (dy / d) * seg + (dx / d) * wave - c.y) * (1 - Math.exp(-8.5 * dt));
        c.angle = Math.atan2(p.y - c.y, p.x - c.x) + Math.PI / 2;
      }
      nodes[0].angle = nodes[1].angle = heading + Math.PI / 2;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const el = n.el!;
        const sc = (1 + breathCurve(breath - i * 0.24)) * scale;
        el.setAttribute('cx', n.x.toFixed(1));
        el.setAttribute('cy', n.y.toFixed(1));
        el.setAttribute('rx', (n.rx * sc).toFixed(1));
        el.setAttribute('ry', (n.ry * sc).toFixed(1));
        el.setAttribute(
          'transform',
          `rotate(${((n.angle * 180) / Math.PI).toFixed(1)} ${n.x.toFixed(1)} ${n.y.toFixed(1)})`,
        );
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    window.addEventListener('resize', rescale);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', rescale);
    };
  }, [mode]);

  return (
    <div className={`sb-organic ${className || ''}`} data-mode={mode} aria-hidden>
      <svg
        className="sb-organic-svg"
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
        /* le filtre de pigment travaille sur toute la surface */
        viewBox={vb}
        /* `slice` : le viewBox élargi remplit la fenêtre, donc la boule
           garde sa taille et la marge de filtre déborde simplement hors
           champ. En `meet` tout le viewBox tiendrait dans l'écran, et la
           boule rétrécirait d'autant. */
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <filter
            id="sbOrganicPigment"
            filterUnits="userSpaceOnUse"
            /* le viewBox déborde déjà de 140 px : 100 % du viewBox, c'est
               la fenêtre plus la marge. Aucun bord net ne coupe la boule. */
            x="0" y="0" width="100%" height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="12.5" xChannelSelector="R" yChannelSelector="G" result="dispersed" />
            <feColorMatrix
              in="noise"
              type="matrix"
              values="0.25 0 0 0 0.85  0 0.15 0 0 0.42  0 0 0.15 0 0.48  0 0 0 0.25 0"
              result="warmGrain"
            />
            <feComposite in="warmGrain" in2="dispersed" operator="in" result="clippedGrain" />
            <feBlend in="dispersed" in2="clippedGrain" mode="overlay" />
          </filter>

          {LAYERS.map((l, i) => (
            <filter key={i} id={`sbOrganicB${i}`} x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation={l.blur} />
            </filter>
          ))}
        </defs>

        <g filter="url(#sbOrganicPigment)">
          {/* le halo d'abord : les nappes se peignent du plus large au
              plus dense, donc sans trou au centre */}
          {LAYERS.map((l, i) => {
            const idx = LAYERS.length - 1 - i;
            const p = palette[idx];
            return (
              <ellipse
                key={idx}
                ref={(el) => { refs.current[idx] = el; }}
                rx={l.rx}
                ry={l.ry}
                fill={p.fill}
                opacity={p.opacity}
                filter={`url(#sbOrganicB${idx})`}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
};

export default OrganicBlob;
