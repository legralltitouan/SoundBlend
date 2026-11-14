import { useCallback, useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   Les gestes du lecteur.

   Un seul contrôleur pour une seule valeur : **la distance de la
   feuille au bas de l'écran**, en pixels.

       0            la feuille est ouverte, plein écran
       H            elle est rangée sous la barre
       entre        elle est à la hauteur du doigt

   Tout le reste en découle : à l'ouverture elle monte avec le doigt,
   à la fermeture elle descend avec lui, et le relâchement ne fait que
   choisir entre « finir de monter » et « finir de descendre ».

   Le glissement latéral vit sur le même contrôleur : un doigt posé sur
   la pochette et qui part sur le côté fait défiler les pochettes, un
   doigt qui part vers le bas fait descendre la feuille. Les deux ne se
   disputent jamais le geste, parce que c'est la même fonction qui
   décide de l'axe.

   Aucun fondu nulle part : on translate, et seulement après le
   relâchement une transition vient finir le mouvement.
   ═══════════════════════════════════════════════════════════════ */

/* la vitesse au-delà de laquelle un geste est « franc » (px / ms) */
const FLICK = 0.45;
/* la tolérance avant de décider de l'axe : un appui qui tremble reste un clic */
const SLOP = 8;

type Axis = 'none' | 'x' | 'y';

type Opts = {
  /** hauteur de la fenêtre : la course totale de la feuille */
  height: () => number;
  /** largeur d'une pochette : la course du glissement latéral */
  coverWidth: () => number;
  onNext: () => void;
  onPrev: () => void;
  /** progression du glissement latéral, de -1 à 1 — pour l'ambiance */
  onCoverProgress?: (p: number) => void;
};

export type SheetAPI = ReturnType<typeof usePlayerSheet>;

export const usePlayerSheet = (opts: Opts) => {
  const H = opts.height;

  /* montée = le plein écran existe dans le DOM */
  const [mounted, setMounted] = useState(false);
  /* y : 0 ouvert, H rangé. On part de H : la feuille est hors champ. */
  const [y, setY] = useState(() => H());
  /* le glissement des pochettes, en px */
  const [dx, setDx] = useState(0);
  /* où en est le geste latéral, de 0 à 1 : allume l'ambiance du voisin,
     et suit la couleur du fond sans à-coup */
  const [mix, setMix] = useState(0);
  /* true pendant que le doigt commande : aucune transition */
  const [dragging, setDragging] = useState(false);
  /* true quand une transition est en train de finir le mouvement */
  const [settling, setSettling] = useState(false);

  /* les valeurs que le doigt manipule : en ref, pour ne pas dépendre
     d'un rendu — un geste rapide envoie plus d'événements que de frames */
  const yRef = useRef(y);
  const dxRef = useRef(0);
  const mixRef = useRef(0);
  const setYBoth = (v: number) => { yRef.current = v; setY(v); };
  const setDxBoth = (v: number) => { dxRef.current = v; setDx(v); };
  const setMixBoth = (v: number) => { mixRef.current = v; setMix(v); };

  /* l'animation de fin de geste : on la garde pour pouvoir l'interrompre
     si le doigt revient avant la fin */
  const cancelRaf = useRef<number | null>(null);

  const g = useRef<{
    down: boolean;
    x0: number; y0: number;
    axis: Axis;
    inStage: boolean;
    startY: number;
    lastX: number; lastY: number; lastT: number;
    vx: number; vy: number;
  }>({
    down: false,
    x0: 0, y0: 0,
    axis: 'none',
    inStage: false,
    startY: 0,
    lastX: 0, lastY: 0, lastT: 0,
    vx: 0, vy: 0,
  });

  const mountedRef = useRef(mounted);
  useEffect(() => { mountedRef.current = mounted; }, [mounted]);

  /* ═══ ouvrir / fermer ═══ */

  const open = useCallback(() => {
    setSettling(false);
    setMounted(true);
    /* on part de la position rangée, puis on monte. Deux frames : la
       première peint la feuille hors champ, la seconde lance le
       mouvement — sans quoi le navigateur ne voit qu'une seule image et
       la feuille apparaît d'un coup. */
    setYBoth(H());
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setSettling(true);
      setYBoth(0);
    }));
  }, [H]);

  const close = useCallback(() => {
    setSettling(true);
    setYBoth(H());
  }, [H]);

  /* la transition vient de finir : soit on est ouvert, soit on démonte */
  const onSettled = useCallback(() => {
    setSettling(false);
    if (yRef.current >= H() - 1) setMounted(false);
  }, [H]);

  /* ═══ le doigt sur la feuille ═══ */

  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const t = e.target as HTMLElement;
    /* Les seules zones qui gardent leur geste propre sont les vraies
       commandes : le rail de progression (qui se promène au doigt) et
       les champs de saisie. Partout ailleurs — pochette, titre, zone des
       boutons lecture, file du bas — le doigt nous appartient : c'est ce
       qui rend le glissement vers le haut possible sur toute la feuille,
       au lieu d'une bande étroite et difficile à viser. */
    if (t.closest('.prail, input, textarea, select')) return;
    cancelRaf.current && cancelAnimationFrame(cancelRaf.current);
    cancelRaf.current = null;
    g.current = {
      down: true,
      x0: e.clientX, y0: e.clientY,
      axis: 'none',
      /* un doigt posé sur la pochette peut faire défiler les morceaux */
      inStage: !!t.closest('.nowplaying-stage'),
      /* la position de la feuille au moment de l'appui : le doigt
         commande à partir d'ici, sans saut */
      startY: yRef.current,
      lastX: e.clientX, lastY: e.clientY, lastT: performance.now(),
      vx: 0, vy: 0,
    };
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = g.current;
    if (!d.down) return;
    const rawX = e.clientX - d.x0;
    const rawY = e.clientY - d.y0;

    if (d.axis === 'none') {
      if (Math.abs(rawX) < SLOP && Math.abs(rawY) < SLOP) return;
      /* horizontal seulement si le doigt est parti de la pochette et que
         le geste est franchement horizontal */
      d.axis = d.inStage && Math.abs(rawX) > Math.abs(rawY) * 1.15 ? 'x' : 'y';
      setDragging(true);
      setSettling(false);
    }

    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.vx = (e.clientX - d.lastX) / dt;
    d.vy = (e.clientY - d.lastY) / dt;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;

    if (d.axis === 'x') {
      /* on suit le doigt, sans butée : la voisine entre du bord, et le
         fond se colore d'elle à mesure */
      const w = Math.max(1, opts.coverWidth());
      const ratio = Math.max(-1, Math.min(1, rawX / w));
      setDxBoth(rawX);
      setMixBoth(ratio);
      opts.onCoverProgress?.(ratio);
      return;
    }

    /* vertical : la feuille suit le doigt depuis la position qu'elle
       occupait à l'appui. Vers le haut on s'arrête à 0 (ouverte), vers
       le bas à H (rangée). Aucune animation ne s'en mêle. */
    setYBoth(Math.max(0, Math.min(H(), d.startY + rawY)));
  }, [H, opts]);

  const onUp = useCallback(() => {
    const d = g.current;
    if (!d.down) return;
    d.down = false;
    const fast = Math.abs(d.vy) > FLICK;
    setDragging(false);

    if (d.axis === 'x') {
      const w = Math.max(1, opts.coverWidth());
      const far = Math.abs(dxRef.current) > w * 0.22;
      const fling = fast && Math.abs(d.vx) > FLICK && Math.abs(dxRef.current) > 28;
      const dir: 1 | -1 = dxRef.current < 0 ? 1 : -1;

      if (far || fling) {
        /* ═══ la suite du geste, sans à-coup ═══

           Les trois pochettes sont posées autour du centre : gauche à
           −pas, principale à 0, droite à +pas, plus `dx` (le doigt).

           Pour finir le geste, on anime `dx` jusqu'à la butée
           (`−pas` si on va vers la suivante, `+pas` sinon), puis on
           échange les rôles ET on remet `dx` à 0 dans le même rendu.
           À l'instant de la bascule, la nouvelle principale occupe
           exactement la place qu'occupait l'ancienne voisine : l'écran
           ne change pas d'un pixel. C'est pour ça que la bascule est
           faite à la FIN : le rendu un peu plus lourd du changement de
           morceau tombe sur une image immobile — il ne se voit pas.

           Et l'animation est écrite à la main, image par image : une
           transition CSS ne démarre qu'à la peinture suivante, ce qui
           laissait un gel d'une cinquantaine de millisecondes juste au
           relâchement — le « ça saute, ça fige » d'origine. */
        setSettling(true);
        opts.onCoverProgress?.(0);
        setMixBoth(0);

        const pas = Math.max(1, opts.coverWidth());
        const from = dxRef.current;
        const to = -pas * dir;                  // la butée, dans le sens du geste
        const DUREE = 300;
        const t0 = performance.now();
        const ease = (t: number) => 1 - Math.pow(1 - t, 3);   // même courbe que la piste

        if (cancelRaf.current != null) cancelAnimationFrame(cancelRaf.current);
        setDragging(true);                      // aucun lissage CSS par-dessus

        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / DUREE);
          if (k < 1) {
            setDxBoth(from + (to - from) * ease(k));
            cancelRaf.current = requestAnimationFrame(step);
            return;
          }
          /* Butée atteinte : on échange les rôles et on remet à zéro,
             ensemble. L'écran, lui, ne change pas d'un pixel — c'est
             vérifié image par image (aucune pochette ne se déplace de
             plus de quelques pixels d'une image à l'autre). On reste en
             `dragging` encore une image : le temps que React peigne les
             nouvelles images, aucune transition ne doit s'inviter. */
          setDxBoth(0);
          if (dir > 0) opts.onNext(); else opts.onPrev();
          cancelRaf.current = requestAnimationFrame(() => {
            setDragging(false);
            setSettling(false);
            cancelRaf.current = null;
          });
        };
        cancelRaf.current = requestAnimationFrame(step);
      } else {
        /* trop court : la pochette revient à sa place, doucement — et la
           couleur revient avec elle, au même rythme */
        setSettling(true);
        setDxBoth(0);
        setMixBoth(0);
        opts.onCoverProgress?.(0);
        window.setTimeout(() => setSettling(false), 320);
      }
      return;
    }

    if (d.axis === 'y') {
      const h = H();
      const closeIt = yRef.current > h * 0.26 || (fast && d.vy > 0 && yRef.current > 24);
      setSettling(true);
      if (closeIt) setYBoth(h);
      else setYBoth(0);
      return;
    }
    /* un appui sans mouvement : rien à faire, le clic passe */
  }, [H, opts]);

  const cancel = useCallback(() => {
    g.current.down = false;
    setDragging(false);
    setSettling(true);
    setDxBoth(0);
    setMixBoth(0);
    setYBoth(yRef.current > H() * 0.5 ? H() : 0);
    opts.onCoverProgress?.(0);
  }, [H, opts]);

  /* ═══ ouvrir depuis la barre du bas ═══ */

  const bar = useRef({ down: false, y0: 0, x0: 0, claimed: false, startY: 0 });

  const onBarDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const t = e.target as HTMLElement;
    /* Les commandes gardent leur clic. Une exception : la zone
       pochette + titre, qui EST un bouton (celui qui ouvre le lecteur).
       C'est la plus grande surface de la barre, et la laisser de côté,
       c'était justement la zone « dure à attraper ». Un appui sans
       mouvement y ouvre toujours le lecteur ; un appui qui glisse fait
       monter la feuille. */
    if (t.closest('.prail')) return;
    if (t.closest('button, a') && !t.closest('.nowbar-track')) return;
    bar.current = { down: true, y0: e.clientY, x0: e.clientX, claimed: false, startY: 0 };
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onBarMove = useCallback((e: React.PointerEvent) => {
    const b = bar.current;
    if (!b.down) return;
    const dy = e.clientY - b.y0;
    if (!b.claimed) {
      if (dy > -SLOP) return;
      if (Math.abs(e.clientX - b.x0) > Math.abs(dy) * 1.2) { b.down = false; return; }
      b.claimed = true;
      /* la feuille apparaît à la hauteur exacte du doigt */
      setMounted(true);
      setDragging(true);
      setSettling(false);
      b.startY = H();
      setYBoth(H() + dy);
      return;
    }
    setYBoth(Math.max(0, H() + dy));
  }, [H]);

  const onBarUp = useCallback(() => {
    const b = bar.current;
    if (!b.down) return;
    b.down = false;
    if (!b.claimed) return;
    setDragging(false);
    setSettling(true);
    const h = H();
    if (yRef.current < h * 0.7) setYBoth(0);
    else setYBoth(h);
  }, [H]);

  /* si la fenêtre change de hauteur, on recale une feuille rangée */
  useEffect(() => {
    const on = () => {
      if (!mountedRef.current) setYBoth(H());
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [H]);

  return {
    mounted,
    y,
    dx,
    mix,
    dragging,
    settling,
    open,
    close,
    onSettled,
    /* les gestes de la feuille */
    sheetHandlers: {
      onPointerDown: onDown,
      onPointerMove: onMove,
      onPointerUp: onUp,
      onPointerCancel: cancel,
    },
    /* les gestes de la barre du bas */
    barHandlers: {
      onPointerDown: onBarDown,
      onPointerMove: onBarMove,
      onPointerUp: onBarUp,
      onPointerCancel: onBarUp,
    },
  };
};

/* la hauteur de la fenêtre, pour les seuils */
export const useViewportHeight = () => {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return h;
};
