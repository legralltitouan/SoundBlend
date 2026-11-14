import React, { useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   La sphère organique — version canvas.

   ─────────── pourquoi ce n'est plus du SVG ───────────

   L'ancienne version composait six ellipses dans un SVG, puis passait le
   tout dans un filtre `feTurbulence` + `feDisplacementMap` dont la région
   couvrait 2100 × 1500 pixels. Ce filtre était recalculé **soixante fois
   par seconde**, sur toute sa surface, à chaque image. Deux choses en
   sortaient :

   · un bord droit, net, là où la région du filtre s'arrêtait — la
     « bordure noire ou blanche » que tu voyais ;
   · dans les zones à faible contraste (le bleu profond du halo sur le
     noir), un tramage en escalier : le filtre travaille en 8 bits, et un
     dégradé sombre y laisse des marches. C'est le halo « cassé » de ta
     capture — bord arrondi à droite, puis des marches verticales.

   Le canvas fait la même chose, mais une seule fois : les nappes y sont
   peintes avec leurs propres dégradés, et le grain est **pré-cuit** dans
   un tampon temporaire qu'on réutilise. Plus de filtre recalculé, donc
   plus de région, donc plus de bord — et un tramage qui disparaît dans
   le bruit du grain.

   ─────────── ce qui n'a pas changé ───────────

   Six nappes, une respiration décalée de 0,24 s, une nage qui ne va
   jamais droit, une palette par thème. Le mouvement est le même : c'est
   seulement la peinture qui change.

   ─────────── et l'espace ───────────

   Avant, la boule restait près du centre parce que son propre halo
   comptait comme une « marge » : on lui interdisait d'approcher du bord
   au tiers de sa taille. Maintenant on borne sur le **cœur** (ce qui se
   voit vraiment), pas sur le halo — qui a le droit de sortir, c'est une
   tache de lumière, pas un objet. Elle exploite donc son écran, sans
   jamais montrer de bord.
   ═══════════════════════════════════════════════════════════════ */

type Props = { mode?: 'light' | 'dark'; className?: string };

/** les nappes, du cœur vers le halo. `dist` = écart au centre, en px. */
type Layer = { rx: number; ry: number; dist: number; blur: number; alpha: number };

const LAYERS: Layer[] = [
  { rx: 40, ry: 40, dist: 0, blur: 9, alpha: 0.98 },
  { rx: 72, ry: 72, dist: 0, blur: 12, alpha: 0.96 },
  { rx: 90, ry: 92, dist: 9, blur: 14, alpha: 0.90 },
  { rx: 104, ry: 112, dist: 20, blur: 16, alpha: 0.80 },
  { rx: 116, ry: 138, dist: 33, blur: 19, alpha: 0.62 },
  { rx: 134, ry: 158, dist: 47, blur: 24, alpha: 0.34 },
];

/** la palette de chaque thème, du cœur vers le halo */
const PALETTE: Record<'light' | 'dark', string[]> = {
  light: ['#f0148c', '#f72598', '#fa4884', '#ff7866', '#ffb27e', '#ffcaa0'],
  dark: ['#ff1a48', '#f0148c', '#c81ad0', '#8e2bd8', '#6532d8', '#4a2cae'],
};

/** le rayon du cœur, celui qui compte pour les limites d'écran */
const CORE = 100;

export const OrganicBlob: React.FC<Props> = ({ mode = 'light', className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState(() =>
    typeof window === 'undefined'
      ? { w: 1400, h: 880 }
      : { w: window.innerWidth, h: window.innerHeight });

  /* on mesure le CONTENEUR, jamais la fenêtre : un écran de composition
     plein écran et une fenêtre avec barre de navigateur n'ont pas la même
     zone peinte, et le canevas plus grand laissait voir un bord */
  useEffect(() => {
    const el = hostRef.current;
    const read = () => {
      const r = el?.getBoundingClientRect();
      const w = Math.round(r && r.width ? r.width : window.innerWidth);
      const h = Math.round(r && r.height ? r.height : window.innerHeight);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null;
    if (el && ro) ro.observe(el);
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const DPR = Math.min(2, window.devicePixelRatio || 1);
    let w = box.w, h = box.h;

    /* le grain est cuit une fois dans un petit tampon, puis répété :
       cuire un bruit plein écran à chaque image coûterait plus cher que
       le filtre qu'on vient de retirer. 220 px suffisent — il est
       répété en motif, et personne ne voit la répétition d'un grain. */
    const grain = document.createElement('canvas');
    const GS = 220;
    grain.width = GS; grain.height = GS;
    const gctx = grain.getContext('2d')!;
    const gdata = gctx.createImageData(GS, GS);
    for (let i = 0; i < gdata.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 150;
      gdata.data[i] = gdata.data[i + 1] = gdata.data[i + 2] = v;
      gdata.data[i + 3] = 26;
    }
    gctx.putImageData(gdata, 0, 0);
    let motif: CanvasPattern | null = null;

    /* un tampon hors écran pour les nappes : on y peint la tache seule,
       puis on la dépose sur le canevas en une fois. C'est ce qui permet
       de lui appliquer un grain à elle, et pas au fond. */
    const tache = document.createElement('canvas');
    const tctx = tache.getContext('2d')!;

    const palette = PALETTE[mode];
    const fond = mode === 'dark' ? '#07060a' : '#fdf7f0';

    const redim = () => {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width || box.w));
      h = Math.max(1, Math.round(r.height || box.h));
      canvas.width = Math.round(w * DPR);
      canvas.height = Math.round(h * DPR);
      tache.width = canvas.width;
      tache.height = canvas.height;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      try { motif = ctx.createPattern(grain, 'repeat'); } catch { motif = null; }
    };

    /* ═══ l'échelle et les limites ═══
       Le cœur vise ~66 % de la largeur, borné. Ce qui borne le
       DÉPLACEMENT, c'est le cœur : le halo, lui, a le droit de sortir de
       l'écran (c'est une tache de lumière, pas un objet à cadre). C'est
       exactement ce qui manquait pour qu'elle ose traverser son écran. */
    const echelle = () => {
      const voulu = Math.max(180, Math.min(700, w * 0.72));
      return Math.max(0.6, Math.min(1.8, voulu / 290));
    };

    type Noeud = { x: number; y: number; rx: number; ry: number; dist: number; angle: number };
    const noeuds: Noeud[] = LAYERS.map((l) => ({ x: w / 2, y: h * 0.4, rx: l.rx, ry: l.ry, dist: l.dist, angle: 0 }));

    let scale = echelle();
    let heading = -Math.PI / 2;
    let swim = 0;
    let breath = 0;
    let last = performance.now();
    let stopped = false;
    let raf = 0;

    const bornes = () => {
      /* marge = rayon du cœur × échelle × 1,1 — le halo déborde, lui */
      const m = CORE * scale * 1.1;
      const x0 = Math.min(m, w * 0.5);
      const x1 = Math.max(x0, w - m);
      const y0 = Math.min(m, h * 0.5);
      const y1 = Math.max(y0, h - m);
      return { x0, x1, y0, y1 };
    };

    let cible = { x: w * 0.72, y: h * 0.3 };
    const choisirCible = () => {
      const { x0, x1, y0, y1 } = bornes();
      /* on évite de retomber à 40 px du point précédent : sans ça, elle
         « piétine » dans un coin au lieu de traverser l'écran */
      for (let essai = 0; essai < 6; essai++) {
        const x = x0 + Math.random() * Math.max(1, x1 - x0);
        const y = y0 + Math.random() * Math.max(1, y1 - y0);
        if (Math.hypot(x - noeuds[1].x, y - noeuds[1].y) > Math.min(w, h) * 0.34 || essai === 5) {
          cible = { x, y };
          return;
        }
      }
    };

    const replacer = () => {
      scale = echelle();
      const { x0, x1, y0, y1 } = bornes();
      if (noeuds[1].x < x0 || noeuds[1].x > x1 || noeuds[1].y < y0 || noeuds[1].y > y1) {
        noeuds[1].x = Math.min(x1, Math.max(x0, noeuds[1].x));
        noeuds[1].y = Math.min(y1, Math.max(y0, noeuds[1].y));
        noeuds[0].x = noeuds[1].x;
        noeuds[0].y = noeuds[1].y;
      }
      choisirCible();
    };

    /* la respiration : montée 2,4 s, plateau, descente 3,4 s, repos.
       Une fois sur quatre, plus fort. */
    const respiration = (t: number) => {
      const T = 7.0;
      const idx = Math.floor(t / T);
      const lt = ((t % T) + T) % T;
      const v = lt < 2.4 ? 0.5 - 0.5 * Math.cos(Math.PI * (lt / 2.4))
        : lt < 2.9 ? 1.0 - 0.015 * Math.sin(Math.PI * ((lt - 2.4) / 0.5))
          : lt < 6.3 ? 0.5 + 0.5 * Math.cos(Math.PI * ((lt - 2.9) / 3.4))
            : 0;
      return v * ((((idx % 4) + 4) % 4) === 3 ? 0.09 : 0.055) * 1.5;
    };

    /* ═══ peindre une nappe ═══
       Erreur de la première version : on peignait un dégradé radial DANS
       un tracé d'ellipse. Le dégradé, lui, est circulaire — il atteint
       zéro à `max(rx, ry)`. Résultat : sur l'axe où l'ellipse est plus
       courte, le tracé coupait le dégradé avant qu'il ne s'éteigne, et
       cet arrêt net formait un bord. Six nappes, six bords : les cercles
       concentriques qu'on voyait, et le « dôme » avec sa rim.

       Ici il n'y a plus aucun tracé. On transforme le contexte à
       l'échelle de la nappe (ce qui rend le dégradé elliptique, pas
       besoin de tracé) et on remplit un rectangle. Le dégradé s'éteint
       de lui-même, en douceur, bien avant le bord du rectangle : aucune
       arête ne peut apparaître, quelle que soit la forme. */
    const RAYON = 100;
    const nappe = (n: Noeud, rx: number, ry: number, couleur: string, alpha: number) => {
      if (rx < 2 || ry < 2 || alpha <= 0.002) return;
      tctx.save();
      tctx.translate(n.x, n.y);
      tctx.rotate(n.angle);
      tctx.scale(rx / RAYON, ry / RAYON);

      const g = tctx.createRadialGradient(0, 0, 0, 0, 0, RAYON);
      /* une queue longue et douce : c'est elle qui fait « tache de
         lumière » plutôt que « boule ». Le cœur reste saturé. */
      g.addColorStop(0.00, hexa(couleur, alpha));
      g.addColorStop(0.22, hexa(couleur, alpha * 0.99));
      g.addColorStop(0.42, hexa(couleur, alpha * 0.88));
      g.addColorStop(0.60, hexa(couleur, alpha * 0.62));
      g.addColorStop(0.74, hexa(couleur, alpha * 0.36));
      g.addColorStop(0.86, hexa(couleur, alpha * 0.17));
      g.addColorStop(0.94, hexa(couleur, alpha * 0.06));
      g.addColorStop(1.00, hexa(couleur, 0));

      tctx.fillStyle = g;
      tctx.fillRect(-RAYON, -RAYON, RAYON * 2, RAYON * 2);
      tctx.restore();
    };

    const peindre = () => {
      tctx.clearRect(0, 0, w, h);
      for (let i = LAYERS.length - 1; i >= 0; i--) {
        const n = noeuds[i];
        const l = LAYERS[i];
        const sc = (1 + respiration(breath - i * 0.24)) * scale;
        nappe(n, n.rx * sc, n.ry * sc, palette[i], l.alpha);
        /* la nappe extérieure reçoit un second passage très large : la
           « queue » du halo qui se dissout dans le fond */
        if (i === LAYERS.length - 1) {
          nappe(n, n.rx * sc * 1.55, n.ry * sc * 1.55, palette[i], l.alpha * 0.30);
        }
      }

      /* le grain, posé sur la tache seulement : il casse le tramage des
         dégradés sombres, exactement là où il se voyait */
      if (motif) {
        tctx.save();
        tctx.globalCompositeOperation = 'source-atop';
        tctx.globalAlpha = mode === 'dark' ? 0.5 : 0.35;
        tctx.fillStyle = motif;
        tctx.fillRect(0, 0, w, h);
        tctx.restore();
      }

      ctx.clearRect(0, 0, w, h);
      /* le fond du conteneur est déjà peint par le parent ; on ne remplit
         que si le parent n'a rien mis (sécurité) */
      if (!cssFondTrouve()) {
        ctx.fillStyle = fond;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(tache, 0, 0, w, h);
    };

    let fondTrouve: boolean | null = null;
    const cssFondTrouve = () => {
      if (fondTrouve !== null) return fondTrouve;
      const el = hostRef.current?.parentElement;
      if (!el) return false;
      const c = getComputedStyle(el).backgroundColor;
      fondTrouve = !!c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
      return fondTrouve;
    };

    const boucle = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      swim += dt * 2.5 * Math.sqrt(0.8);
      breath += dt;

      const tete = noeuds[1];
      const voulu = Math.atan2(cible.y - tete.y, cible.x - tete.x) + Math.sin(swim) * 0.24 * 0.15;
      const ecart = Math.atan2(Math.sin(voulu - heading), Math.cos(voulu - heading));
      heading += Math.max(-1.7, Math.min(1.7, ecart * 2.2)) * dt;

      /* une nage plus franche qu'avant : elle traverse l'écran au lieu de
         flotter sur place */
      const vitesse = 84 * Math.max(0.7, scale);
      tete.x += Math.cos(heading) * vitesse * dt;
      tete.y += Math.sin(heading) * vitesse * dt;
      noeuds[0].x = tete.x + Math.cos(heading) * 4;
      noeuds[0].y = tete.y + Math.sin(heading) * 4;

      const b = bornes();
      if (tete.x < b.x0 || tete.x > b.x1) { heading = Math.PI - heading; tete.x = Math.min(b.x1, Math.max(b.x0, tete.x)); }
      if (tete.y < b.y0 || tete.y > b.y1) { heading = -heading; tete.y = Math.min(b.y1, Math.max(b.y0, tete.y)); }

      if (Math.hypot(cible.x - tete.x, cible.y - tete.y) < 90 * scale) choisirCible();

      for (let i = 2; i < noeuds.length; i++) {
        const p = noeuds[i - 1];
        const c = noeuds[i];
        const seg = (c.dist - p.dist) * scale;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const d = Math.hypot(dx, dy) || 1;
        const vague = Math.sin(swim - i * 0.68) * (3.6 + i * 1.65) * 0.15 * scale;
        c.x += (p.x - (dx / d) * seg + (-dy / d) * vague - c.x) * (1 - Math.exp(-8.5 * dt));
        c.y += (p.y - (dy / d) * seg + (dx / d) * vague - c.y) * (1 - Math.exp(-8.5 * dt));
        c.angle = Math.atan2(p.y - c.y, p.x - c.x) + Math.PI / 2;
      }
      noeuds[0].angle = noeuds[1].angle = heading + Math.PI / 2;

      peindre();
      raf = requestAnimationFrame(boucle);
    };

    redim();
    replacer();
    peindre();
    raf = requestAnimationFrame(boucle);
    window.addEventListener('resize', replacer);

    /* un onglet caché ne peint pas : inutile de chauffer le téléphone */
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(raf);
        stopped = true;
      } else if (stopped && !canvasRef.current?.dataset.dead) {
        stopped = false;
        last = performance.now();
        raf = requestAnimationFrame(boucle);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', replacer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [mode, box.w, box.h]);

  return (
    <div ref={hostRef} className={`sb-organic ${className || ''}`} data-mode={mode} aria-hidden>
      <canvas ref={canvasRef} className="sb-organic-canvas" />
    </div>
  );
};

/** #rrggbb + opacité → rgba() */
const hexa = (hex: string, a: number): string => {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
};

export default OrganicBlob;
