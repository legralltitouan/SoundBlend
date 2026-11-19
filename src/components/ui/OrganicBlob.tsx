import React, { useEffect, useRef, useState } from 'react';

/* Port du moteur du fichier de référence : six nappes, grain masqué,
   respiration asymétrique sur 7 s et chaîne cinématique amortie. Le cœur
   et ses couleurs ne changent pas. Les deux nappes arrière gardent leurs
   rayons et leurs flous, mais se courbent doucement dans les virages au
   lieu de pivoter comme des ellipses rigides. */
type Props = { mode?: 'light' | 'dark'; movement?: 'balade' | 'chargement'; className?: string };
type Layer = { rx: number; ry: number; restDist: number; stretch: number; blur: number };
const LAYERS: Layer[] = [
  { rx: 46, ry: 46, restDist: 0, stretch: 0, blur: 9 },
  { rx: 84, ry: 84, restDist: 0, stretch: .02, blur: 12 },
  { rx: 94, ry: 98, restDist: 26, stretch: .04, blur: 14 },
  { rx: 102, ry: 114, restDist: 56, stretch: .07, blur: 16 },
  { rx: 108, ry: 142, restDist: 92, stretch: .14, blur: 19 },
  { rx: 132, ry: 158, restDist: 114, stretch: .10, blur: 24 },
];
const PALETTE = {
  light: [
    { fill: '#f0148c', opacity: .85 }, { fill: '#f72598', opacity: .96 },
    { fill: '#fa4884', opacity: .92 }, { fill: '#ff7866', opacity: .88 },
    { fill: '#ffb27e', opacity: .78 }, { fill: '#ffcaa0', opacity: .42 },
  ],
  dark: [
    { fill: '#ff1a48', opacity: .92 }, { fill: '#f0148c', opacity: .94 },
    { fill: '#c81ad0', opacity: .88 }, { fill: '#8e2bd8', opacity: .80 },
    { fill: '#6532d8', opacity: .62 }, { fill: '#4a2cae', opacity: .34 },
  ],
};
const PAD = 420; // hors cadre uniquement : évite une coupure interne du filtre près du bord
const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/* Une ellipse cubique légèrement cintrée autour de son axe. À courbure
   nulle elle coïncide pratiquement avec l'ellipse SVG d'origine ; les
   quatre raccords restent lisses lorsque les extrémités fléchissent. */
const curvedLayer = (rx: number, ry: number, bend: number) => {
  const k = .5522847498307936;
  const pt = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return `M ${pt(bend, -ry)} C ${pt(bend + k * rx, -ry)} ${pt(rx, -k * ry)} ${pt(rx, 0)}`
    + ` C ${pt(rx, k * ry)} ${pt(bend + k * rx, ry)} ${pt(bend, ry)}`
    + ` C ${pt(bend - k * rx, ry)} ${pt(-rx, k * ry)} ${pt(-rx, 0)}`
    + ` C ${pt(-rx, -k * ry)} ${pt(bend - k * rx, -ry)} ${pt(bend, -ry)} Z`;
};

export const OrganicBlob: React.FC<Props> = ({ mode = 'light', movement = 'balade', className = '' }) => {
  const host = useRef<HTMLDivElement | null>(null);
  const refs = useRef<(SVGElement | null)[]>([]);
  const [box, setBox] = useState(() => ({ w: window.innerWidth || 1024, h: window.innerHeight || 768 }));

  useEffect(() => {
    const el = host.current;
    if (!el || refs.current.some((n) => !n)) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      return { w: Math.max(1, Math.round(rect.width || window.innerWidth)), h: Math.max(1, Math.round(rect.height || window.innerHeight)) };
    };
    let { w, h } = measure();
    let scale = Math.max(.62, Math.min(1.06, Math.min(w, h) / 700));
    /* La tête part sur la trajectoire de chargement, pas à 6 % de hauteur
       de celle-ci : pas de saut ni d'étirement parasite à la première image. */
    const initialX = w * .5, initialY = h * (movement === 'chargement' ? .43 : .37);
    const nodes = LAYERS.map((layer, i) => ({ ...layer, el: refs.current[i]!, x: initialX,
      y: initialY + (i === 0 ? -4 : layer.restDist) * scale, angle: 0, bend: 0 }));
    let heading = -Math.PI / 2, turnRate = 0, currentSpeed = 48;
    let swimPhase = 0, breathTime = .8, loaderAngle = 0, waypointTimer = 2.8, curiosityTimer = 0, deepBreathBoost = 0;
    let waypoint = { x: w * .64, y: h * .34 };
    let last = performance.now(), raf = 0, stopped = false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    setBox({ w, h });

    const resize = () => {
      const next = measure();
      if (next.w === w && next.h === h) return;
      const sx = next.w / w, sy = next.h / h;
      nodes.forEach((n) => { n.x = Math.max(0, Math.min(next.w, n.x * sx)); n.y = Math.max(0, Math.min(next.h, n.y * sy)); });
      waypoint = { x: Math.max(0, Math.min(next.w, waypoint.x * sx)), y: Math.max(0, Math.min(next.h, waypoint.y * sy)) };
      w = next.w; h = next.h;
      scale = Math.max(.62, Math.min(1.06, Math.min(w, h) / 700));
      setBox({ w, h });
      draw(); // indispensable si la préférence « mouvements réduits » fige la boucle
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(el);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    const pickWaypoint = () => {
      const padX = Math.min(180, w * .22), padY = Math.min(160, h * .22);
      waypoint = { x: padX + Math.random() * Math.max(1, w - padX * 2), y: padY + Math.random() * Math.max(1, h - padY * 2) };
    };
    const pointerMove = (e: PointerEvent) => {
      if (movement !== 'balade' || curiosityTimer > 0 || reduced?.matches) return;
      const r = el.getBoundingClientRect();
      waypoint = { x: Math.max(0, Math.min(w, e.clientX - r.left)), y: Math.max(0, Math.min(h, e.clientY - r.top)) };
      curiosityTimer = 1.6;
    };
    const pointerDown = (e: PointerEvent) => {
      if (reduced?.matches) return;
      if (movement === 'balade') {
        const r = el.getBoundingClientRect();
        waypoint = { x: Math.max(0, Math.min(w, e.clientX - r.left)), y: Math.max(0, Math.min(h, e.clientY - r.top)) };
        waypointTimer = 3.5; curiosityTimer = 2.4;
      }
      deepBreathBoost = 1;
    };
    const stage = el.parentElement;
    stage?.addEventListener('pointermove', pointerMove);
    stage?.addEventListener('pointerdown', pointerDown);

    const breathCurve = (t: number) => {
      const period = 7, cycle = Math.floor(t / period), lt = ((t % period) + period) % period;
      const phase = lt < 2.4 ? .5 - .5 * Math.cos(Math.PI * (lt / 2.4))
        : lt < 2.9 ? 1 - .015 * Math.sin(Math.PI * ((lt - 2.4) / .5))
        : lt < 6.3 ? .5 + .5 * Math.cos(Math.PI * ((lt - 2.9) / 3.4)) : 0;
      const peak = (((cycle % 4) + 4) % 4) === 3 ? .09 : .055;
      return phase * (peak + deepBreathBoost * .032);
    };
    const draw = () => {
      const velocityStretch = Math.min(1.3, currentSpeed / 90);
      nodes.forEach((node, i) => {
        const breathScale = 1 + breathCurve(breathTime - i * .24);
        const rx = node.rx * scale * breathScale * (1 - node.stretch * .35 * velocityStretch);
        const ry = node.ry * scale * breathScale * (1 + node.stretch * velocityStretch);
        if (![node.x, node.y, rx, ry].every(Number.isFinite)) return;
        if (i < 4) {
          /* Les quatre nappes du cœur sont exactement celles de la référence. */
          node.el.setAttribute('cx', node.x.toFixed(2)); node.el.setAttribute('cy', node.y.toFixed(2));
          node.el.setAttribute('rx', Math.max(1, rx).toFixed(2)); node.el.setAttribute('ry', Math.max(1, ry).toFixed(2));
          node.el.setAttribute('transform', `rotate(${(node.angle * 180 / Math.PI).toFixed(2)} ${node.x.toFixed(2)} ${node.y.toFixed(2)})`);
        } else {
          /* Même pigment et même flou, mais silhouette pliable. La courbure
             est bornée et amortie, sans changement brutal dans les virages. */
          node.el.setAttribute('d', curvedLayer(Math.max(1, rx), Math.max(1, ry), node.bend * rx));
          node.el.setAttribute('transform', `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)}) rotate(${(node.angle * 180 / Math.PI).toFixed(2)})`);
          node.el.setAttribute('data-bend', node.bend.toFixed(4));
        }
      });
      el.setAttribute('data-tete', `${Math.round(nodes[1].x)},${Math.round(nodes[1].y)}`);
    };
    const frame = (now: number) => {
      raf = 0;
      if (stopped || reduced?.matches) return;
      const dt = Math.min(.05, Math.max(.001, (now - last) / 1000)); last = now;
      swimPhase += dt * 2.5; breathTime += dt;
      if (curiosityTimer > 0) curiosityTimer -= dt;
      if (deepBreathBoost > 0) deepBreathBoost = Math.max(0, deepBreathBoost - dt * .22);
      const heart = nodes[0], head = nodes[1];
      if (movement === 'chargement') {
        // Trajectoire en huit du mode Chargement de la référence.
        loaderAngle += dt * .85;
        const nextX = w * .5 + Math.sin(loaderAngle) * Math.min(w * .21, 165);
        const nextY = h * .43 + Math.sin(loaderAngle * 2) * Math.min(h * .11, 82) * .62;
        const dx = nextX - head.x, dy = nextY - head.y;
        head.x = nextX; head.y = nextY;
        if (Math.hypot(dx, dy) > .001) {
          const targetHeading = Math.atan2(dy, dx);
          heading = normalizeAngle(heading + normalizeAngle(targetHeading - heading) * Math.min(1, dt * 8));
        }
        currentSpeed = Math.hypot(dx, dy) / Math.max(.001, dt);
      } else {
        waypointTimer -= dt;
        if (Math.hypot(waypoint.x - head.x, waypoint.y - head.y) < 80 || waypointTimer <= 0) {
          pickWaypoint(); waypointTimer = 3 + Math.random() * 2.6;
        }
        const targetAngle = Math.atan2(waypoint.y - head.y, waypoint.x - head.x);
        const headSway = Math.sin(swimPhase) * .24;
        let desiredAngle = targetAngle + headSway;
        const margin = Math.min(135, Math.min(w, h) * .18);
        if (head.x < margin || head.x > w - margin || head.y < margin || head.y > h - margin) {
          desiredAngle = Math.atan2(h * .45 - head.y, w * .5 - head.x) + headSway * .45;
        }
        const desiredTurn = Math.max(-1.65, Math.min(1.65, normalizeAngle(desiredAngle - heading) * 2.1));
        turnRate += (desiredTurn - turnRate) * (1 - Math.exp(-4.6 * dt));
        heading = normalizeAngle(heading + turnRate * dt);
        const curveSlowdown = 1 - Math.min(.34, Math.abs(turnRate) * .21);
        currentSpeed += (80 * curveSlowdown - currentSpeed) * (1 - Math.exp(-3.2 * dt));
        head.x += Math.cos(heading) * currentSpeed * dt;
        head.y += Math.sin(heading) * currentSpeed * dt;
      }
      // Borne de sécurité sur de très petits écrans, sans toucher au halo.
      head.x = Math.max(0, Math.min(w, head.x)); head.y = Math.max(0, Math.min(h, head.y));
      heart.x = head.x + Math.cos(heading) * 4 * scale;
      heart.y = head.y + Math.sin(heading) * 4 * scale;
      heart.angle = normalizeAngle(heading + Math.PI / 2); head.angle = heart.angle;
      const velocityNorm = Math.min(1.35, currentSpeed / 85);
      for (let i = 2; i < nodes.length; i++) {
        const prev = nodes[i - 1], curr = nodes[i], segDist = (curr.restDist - prev.restDist) * scale;
        const dx = prev.x - curr.x, dy = prev.y - curr.y, dist = Math.hypot(dx, dy) || .001;
        const dirX = dx / dist, dirY = dy / dist, perpX = -dirY, perpY = dirX;
        const wave = Math.sin(swimPhase - i * .68) * (3.6 + i * 1.65) * velocityNorm * scale;
        const goalX = prev.x - dirX * segDist + perpX * wave, goalY = prev.y - dirY * segDist + perpY * wave;
        const followStiffness = Math.max(4.8, 12 - i * 1.15), alpha = 1 - Math.exp(-followStiffness * dt);
        curr.x += (goalX - curr.x) * alpha; curr.y += (goalY - curr.y) * alpha;
        const postDx = prev.x - curr.x, postDy = prev.y - curr.y, postDist = Math.hypot(postDx, postDy) || .001;
        const maxAllowed = segDist * 1.38;
        if (postDist > maxAllowed) { curr.x = prev.x - postDx / postDist * maxAllowed; curr.y = prev.y - postDy / postDist * maxAllowed; }
        const tangent = Math.atan2(prev.y - curr.y, prev.x - curr.x) + Math.PI / 2;
        const turnFollow = i >= 4 ? 1 - Math.exp(-4.5 * dt) : Math.min(1, dt * 10);
        curr.angle = normalizeAngle(curr.angle + normalizeAngle(tangent - curr.angle) * turnFollow);
      }
      for (let i = 4; i < nodes.length; i++) {
        /* L'écart des tangentes le long de la chaîne donne la courbure du
           sillage. Un filtre temporel évite les à-coups quand le huit se
           croise ; la borne préserve la rondeur et l'identité de la sphère. */
        const ahead = nodes[i - 2], behind = nodes[Math.min(i + 1, nodes.length - 1)];
        const turn = normalizeAngle(behind.angle - ahead.angle);
        const target = Math.max(-.42, Math.min(.42, -turn * .32 * nodes[i].ry / nodes[i].rx));
        nodes[i].bend += (target - nodes[i].bend) * (1 - Math.exp(-3.8 * dt));
      }
      draw();
      if (!reduced?.matches) raf = requestAnimationFrame(frame);
    };
    const motionPreferenceChanged = () => {
      if (reduced?.matches) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        draw();
      } else if (!raf && !stopped) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    reduced?.addEventListener?.('change', motionPreferenceChanged);
    draw();
    motionPreferenceChanged();
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      reduced?.removeEventListener?.('change', motionPreferenceChanged);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      stage?.removeEventListener('pointermove', pointerMove);
      stage?.removeEventListener('pointerdown', pointerDown);
    };
  }, [movement]);

  return <div ref={host} className={`sb-organic ${className}`} data-mode={mode} data-movement={movement} aria-hidden="true">
    <svg className="sb-organic-svg" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="sbOrganicPigment" filterUnits="userSpaceOnUse" x={-PAD} y={-PAD} width={box.w + 2 * PAD} height={box.h + 2 * PAD} colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="11" xChannelSelector="R" yChannelSelector="G" result="dispersed" />
          <feColorMatrix in="noise" type="matrix" values="0.25 0 0 0 0.85  0 0.15 0 0 0.42  0 0 0.15 0 0.48  0 0 0 0.22 0" result="warmGrain" />
          <feComposite in="warmGrain" in2="dispersed" operator="in" result="clippedGrain" />
          <feBlend in="dispersed" in2="clippedGrain" mode="overlay" />
        </filter>
        {LAYERS.map((l, i) => <filter key={i} id={`sbOrganicB${i}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation={l.blur} /></filter>)}
      </defs>
      <g filter="url(#sbOrganicPigment)">{[5, 4, 3, 2, 1, 0].map((i) => i >= 4
        ? <path key={i} ref={(node) => { refs.current[i] = node; }} data-layer={i} fill={PALETTE[mode][i].fill} opacity={PALETTE[mode][i].opacity} filter={`url(#sbOrganicB${i})`} />
        : <ellipse key={i} ref={(node) => { refs.current[i] = node; }} data-layer={i} cx={0} cy={0} rx={LAYERS[i].rx} ry={LAYERS[i].ry} fill={PALETTE[mode][i].fill} opacity={PALETTE[mode][i].opacity} filter={`url(#sbOrganicB${i})`} />)}</g>
    </svg>
  </div>;
};
export default OrganicBlob;
