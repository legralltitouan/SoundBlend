import React, { useEffect, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════
   La boule.

   Une seule tache de couleur, très douce, qui se promène sur l'écran et
   rebondit contre les bords. Elle ne « tourne » pas : elle gambade. Pour
   ça, trois choses :

   1. **la tache** est un dégradé radial à cinq arrêts — le cœur dense,
      puis un halo qui s'évanouit dans le fond. À basse résolution, puis
      agrandie avec un lissage : c'est ce qui donne ce bord mou, presque
      flou, impossible à obtenir avec un `border-radius` ou un flou CSS.

   2. **la traînée** vient de la persistance. On ne nettoie jamais la
      toile de travail : à chaque image on la recouvre d'un voile du
      fond, à 5 % d'opacité. Les images anciennes s'effacent
      progressivement, et le passage de la boule reste visible comme une
      queue de comète en dégradé.

   3. **le grain** est une tuile de bruit blanc, nette et animée par
      sauts de quelques pixels. Il mord sur la couleur et sur le fond :
      c'est lui qui empêche la tache de ressembler à un dégradé CSS.

   La couleur suit le thème : magenta → corail → pêche sur fond clair,
   rouge → magenta → violet sur fond sombre. La forme du dégradé est la
   même, seule la palette change.
   ═══════════════════════════════════════════════════════════════ */

type Props = {
  /** 'light' : fond clair crème ; 'dark' : fond noir */
  mode?: 'light' | 'dark';
  /** rayon de la tache, en fraction du plus petit côté */
  size?: number;
  /** vitesse de croisière, en fraction de la largeur par seconde */
  speed?: number;
  className?: string;
};

/* la tuile de grain, fabriquée une fois pour toutes */
function grainTile(size = 180): string {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const cx = cv.getContext('2d');
  if (!cx) return '';
  const im = cx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 140 + Math.random() * 115;
    im.data[i * 4] = v;
    im.data[i * 4 + 1] = v;
    im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  return cv.toDataURL();
}

export const BlobField: React.FC<Props> = ({
  mode = 'light',
  size = 0.3,
  speed = 0.16,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grainRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = grainRef.current;
    if (el) el.style.backgroundImage = `url(${grainTile(180)})`;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dark = mode === 'dark';
    const BG = dark ? '#08060A' : '#FBF5EF';

    /* la toile de travail, en basse résolution : c'est l'agrandissement
       qui fabrique le bord flou de la tache et de sa traînée */
    const SUB = 3;
    const work = document.createElement('canvas');
    const wctx = work.getContext('2d');
    if (!wctx) return;

    let w = 0, h = 0, raf = 0, stopped = false;
    /* position et vitesse en pixels de la toile de travail — jamais en
       fraction : mélanger les deux unités envoyait la tache hors champ */
    let x = 0, y = 0;
    let vx = 0, vy = 0;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = w;
      canvas.height = h;
      work.width = Math.max(1, Math.round(w / SUB));
      work.height = Math.max(1, Math.round(h / SUB));
      wctx.fillStyle = BG;
      wctx.fillRect(0, 0, work.width, work.height);
      /* la tache repart d'un point stable, proportionnel à la toile */
      if (!x) { x = work.width * 0.62; y = work.height * 0.46; }
      else { x = Math.min(x, work.width - 1); y = Math.min(y, work.height - 1); }
      /* la vitesse est exprimée en largeur d'écran par seconde */
      vx = work.width * speed;
      vy = work.height * speed * 0.62;
    };

    /* le dégradé de la tache. Sur fond clair il faut une lumière : le
       magenta cède au corail puis à la pêche. Sur fond noir, le magenta
       cède au violet. */
    const paint = (cx: number, cy: number, r: number, alpha: number) => {
      const g = wctx.createRadialGradient(cx, cy, r * 0.02, cx, cy, r);
      if (dark) {
        g.addColorStop(0, `rgba(255,26,72,${0.95 * alpha})`);
        g.addColorStop(0.34, `rgba(226,20,96,${0.85 * alpha})`);
        g.addColorStop(0.62, `rgba(150,32,190,${0.62 * alpha})`);
        g.addColorStop(0.84, `rgba(96,44,180,${0.26 * alpha})`);
        g.addColorStop(1, 'rgba(8,6,10,0)');
      } else {
        g.addColorStop(0, `rgba(232,48,138,${0.92 * alpha})`);
        g.addColorStop(0.38, `rgba(240,98,119,${0.86 * alpha})`);
        g.addColorStop(0.66, `rgba(247,166,124,${0.70 * alpha})`);
        g.addColorStop(0.86, `rgba(250,206,166,${0.34 * alpha})`);
        g.addColorStop(1, 'rgba(251,245,239,0)');
      }
      wctx.fillStyle = g;
      wctx.beginPath();
      wctx.arc(cx, cy, r, 0, 6.283);
      wctx.fill();
    };

    const frame = (t: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;

      const bw = work.width;
      const bh = work.height;

      /* le voile : c'est lui qui fabrique la traînée. Plus il est clair,
         plus la queue est longue. */
      wctx.globalCompositeOperation = 'source-over';
      wctx.fillStyle = dark ? 'rgba(8,6,10,0.046)' : 'rgba(251,245,239,0.038)';
      wctx.fillRect(0, 0, bw, bh);

      /* une dérive lente : la boule ne va jamais droit, elle flâne */
      const wob = Math.sin(t * 0.0007) * 0.18;
      const cos = Math.cos(wob), sin = Math.sin(wob);
      const nx = vx * cos - vy * sin;
      const ny = vx * sin + vy * cos;
      vx = nx;
      vy = ny;

      x += vx * dt;
      y += vy * dt;

      const rr = Math.min(bw, bh) * size;
      /* les rebonds : on bute sur le bord et on repart, sans s'arrêter */
      const mx = rr * 0.72, my = rr * 0.62;
      if (x < mx) { x = mx; vx = Math.abs(vx); }
      if (x > bw - mx) { x = bw - mx; vx = -Math.abs(vx); }
      if (y < my) { y = my; vy = Math.abs(vy); }
      if (y > bh - my) { y = bh - my; vy = -Math.abs(vy); }

      /* deux dépôts par image, légèrement décalés : la tache garde un
         cœur dense et une queue plus pâle */
      paint(x, y, rr, 0.55);

      /* on agrandit la toile de travail sur la toile visible */
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(work, 0, 0, w, h);

      raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, size, speed]);

  return (
    <div className={`sb-blobfield ${className || ''}`} data-mode={mode} aria-hidden>
      <canvas ref={canvasRef} className="sb-blobfield-canvas" />
      <span ref={grainRef} className="sb-blobfield-grain" />
    </div>
  );
};

export default BlobField;
