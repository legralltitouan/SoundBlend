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

/* ═══ pourquoi un simple `viewBox` ne suffisait pas ═══

   Les nappes sont positionnées en PIXELS de fenêtre (`innerWidth`,
   `innerHeight`). Or l'ancien montage agrandissait le viewBox de 140 px
   de chaque côté : le SVG était alors mis à l'échelle pour couvrir
   l'écran (`slice`), si bien qu'un pixel écrit dans le code ne tombait
   plus sur un pixel de l'écran. Le halo sortait du cadre, et surtout la
   région du filtre — en unités utilisateur, donc décalée de ces 140 px —
   s'arrêtait net au milieu de la boule. C'est cette limite qu'on voyait
   comme une « bordure de délimitation » quand la sphère approchait du
   bord.

   Maintenant le SVG fait exactement la taille de son conteneur, sans
   viewBox d'écart : 1 unité = 1 pixel. Le filtre garde une région plus
   large que l'écran (il en a besoin pour flouter ce qui touche le bord),
   mais cette région DÉBORDE de tous les côtés de la même façon : aucune
   ligne ne peut apparaître à l'intérieur. Ce qui sort de l'écran est
   simplement coupé par l'écran. */
const FILTER_PAD = 420;

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
  const host = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState(() =>
    typeof window === 'undefined'
      ? { w: 1400, h: 880 }
      : { w: window.innerWidth, h: window.innerHeight });
  /* On mesure le CONTENEUR, pas la fenêtre : dans un écran de composition
     en plein écran les deux coïncident, mais sur un ordinateur avec une
     barre de navigateur, la fenêtre fait quelques pixels de plus que la
     zone peinte — et le canevas, légèrement plus grand, laissait voir un
     bord. Ils sont désormais strictement de la même taille. */
  useEffect(() => {
    const el = host.current;
    const read = () => {
      const r = el?.getBoundingClientRect();
      const w = Math.round(r && r.width ? r.width : window.innerWidth);
      const h = Math.round(r && r.height ? r.height : window.innerHeight);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    /* la barre d'adresse mobile qui se replie change la hauteur sans
       prévenir personne : on suit aussi la taille du document */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
      ro?.disconnect();
    };
  }, []);
  const vb = `0 0 ${box.w} ${box.h}`;
  /* ═══ l'échelle courante, pour les filtres ═══
     Les nappes grandissent avec l'échelle (×0.7 sur un téléphone, ×1.7
     sur un grand écran) mais leur FLOU, lui, était fixe : sur un ordinateur
     les ellipses devenaient énormes avec un contour à peine adouci, et
     c'est ce contour qu'on voyait comme une « bordure » quand la boule
     approchait du bord. On calcule donc la même échelle ici, à partir de
     la taille du conteneur, et chaque flou la suit. */
  const shrink = Math.max(0.66, Math.min(1.75, Math.max(200, Math.min(640, box.w * 0.66)) / 290));
  const palette = PALETTE[mode];

  useEffect(() => {
    const nodes = LAYERS.map((l, i) => ({
      el: refs.current[i],
      x: 0, y: 0, rx: l.rx, ry: l.ry, dist: l.dist, angle: 0,
    }));
    if (nodes.some((n) => !n.el)) return;

    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;

    nodes[0].x = nodes[1].x = vw() * 0.5;
    nodes[0].y = nodes[1].y = vh() * 0.40;

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

    /* ═══ la taille de la sphère ═══
       Le cœur fait ~290 px de diamètre au repos. On veut qu'il occupe
       environ **la moitié de la largeur** d'un téléphone (l'ordre de
       grandeur demandé), et un peu plus que la moitié sur un écran très
       étroit. On calcule donc l'échelle à partir de la largeur, et non
       du plus petit côté : avant, un téléphone de 390 px tombait sur le
       plancher (0.52), d'où une boule de 150 px — une bille au milieu
       du vide. La marge de nage suit la taille réelle, sinon elle sort
       de l'écran. */
    /* ═══ la taille de la sphère, et ses limites ═══
       On vise 66 % de la largeur du cœur — mais la HALO compte aussi :
       les nappes extérieures vont jusqu'à ~272 px du centre (rx 132 +
       respiration + le flou du filtre), soit un rayon de 272 × scale.
       Si ce rayon dépasse la demi-largeur de l'écran, la tache se fait
       couper net par le bord du canevas — et c'est ce qu'on voyait :
       « les bordures de délimitation quand la boule est proche du bord ».
       On borne donc l'échelle pour que le halo tienne entièrement dans
       le plus petit côté, et on n'autorise le déplacement qu'à
       l'intérieur de ces limites. */
    let scale = 1;
    /* rayon réel du halo, en px, pour l'échelle courante */
    let reach = 150;

    /* les limites de déplacement : la boule entière reste dans le cadre,
       moins une marge de respiration */
    const bounds = () => {
      const w = vw();
      const h = vh();
      const m = reach * 0.94;          // 6 % de débord : un bord qui respire
      const x0 = Math.min(m, w * 0.5);
      const x1 = Math.max(x0, w - m);
      const y0 = Math.min(m, h * 0.5);
      const y1 = Math.max(y0, h - m);
      return { x0, x1, y0, y1 };
    };
    const pickTarget = () => {
      const { x0, x1, y0, y1 } = bounds();
      target = {
        x: x0 + Math.random() * Math.max(1, x1 - x0),
        y: y0 + Math.random() * Math.max(1, y1 - y0),
      };
    };

    const rescale = () => {
      const w = vw();
      const h = vh();
      /* 1. la largeur visée du cœur, bornée courts écrans comme grands */
      const voulu = Math.max(200, Math.min(640, w * 0.66));
      let s2 = Math.max(0.66, Math.min(1.75, voulu / 290));
      /* 2. le halo a le droit de sortir de l'écran — c'est une tache,
         pas un objet ; mais pas au point de n'être qu'un aplat. On plafonne
         son rayon à 90 % de la plus grande dimension. */
      const HALO = 272;                 // rayon de la plus grande nappe
      s2 = Math.min(s2, (Math.max(w, h) * 0.9) / HALO);
      scale = s2;
      reach = HALO * scale;
      /* 3. on replace la boule si elle se retrouve dehors après un
         changement de taille (rotation du téléphone, fenêtre redimensionnée) */
      const { x0, x1, y0, y1 } = bounds();
      if (nodes[1].x < x0 || nodes[1].x > x1 || nodes[1].y < y0 || nodes[1].y > y1) {
        nodes[1].x = Math.min(x1, Math.max(x0, nodes[1].x));
        nodes[1].y = Math.min(y1, Math.max(y0, nodes[1].y));
        nodes[0].x = nodes[1].x;
        nodes[0].y = nodes[1].y;
      }
      pickTarget();
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

      /* arrivée : on choisit un autre point, jamais hors du cadre */
      if (Math.hypot(target.x - head.x, target.y - head.y) < 85 * scale) pickTarget();

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
    <div ref={host} className={`sb-organic ${className || ''}`} data-mode={mode} aria-hidden>
      <svg
        className="sb-organic-svg"
        width={box.w}
        height={box.h}
        xmlns="http://www.w3.org/2000/svg"
        /* un pixel de code = un pixel d'écran, sans mise à l'échelle */
        viewBox={vb}
        preserveAspectRatio="none"
      >
        <defs>
          <filter
            id="sbOrganicPigment"
            filterUnits="userSpaceOnUse"
            /* la région du filtre : l'écran, plus une marge égale de
               chaque côté. Le flou et le déplacement du bruit peuvent
               donc travailler sur toute la surface visible, et même
               au-delà — aucune arête franche ne traverse l'écran. */
            x={-FILTER_PAD}
            y={-FILTER_PAD}
            width={box.w + FILTER_PAD * 2}
            height={box.h + FILTER_PAD * 2}
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="11" xChannelSelector="R" yChannelSelector="G" result="dispersed" />
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
            <filter key={i} id={`sbOrganicB${i}`} x="-90%" y="-90%" width="280%" height="280%">
              {/* le flou suit la taille réelle de la nappe : une ellipse
                  deux fois plus grande est floutée deux fois plus */}
              <feGaussianBlur stdDeviation={l.blur * (0.85 + 0.4 * shrink)} />
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
