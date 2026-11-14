import React, { useCallback, useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   La répartition — trois barres, et rien d'autre.

   Pas de cartes, pas de boutons, pas de pourcentage à côté : la barre
   suffit. Chaque part porte son nombre de titres et son nom ; on pousse
   une frontière pour rééquilibrer, on peut aussi cliquer un bloc pour
   l'agrandir d'un titre.

   Le rendu suit le reste de l'application : matière translucide, filet
   d'un pixel, texte en `ink`, et le grain de l'app par-dessus (posé par
   `.sb-dose-track::before`, pas une texture inventée ici).
   ═══════════════════════════════════════════════════════════════ */

export type WheelKey = 'anchor' | 'deepDive' | 'fresh';
export type WheelRatio = Record<WheelKey, number>;

export const MIX_ORDER: WheelKey[] = ['anchor', 'deepDive', 'fresh'];

type Props = {
  ratio: WheelRatio;
  onChange: (next: WheelRatio) => void;
  /** le nombre total de titres visé (durée ÷ longueur moyenne) */
  target: number;
  labels: Record<WheelKey, string>;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ── pourquoi ce GAP apparaît partout ────────────────────────────
   Les trois blocs sont dans une rangée flexible avec 3 px de souffle
   entre eux. Flexbox ne partage donc pas la largeur totale : il partage
   l'espace *restant*, largeur moins les deux souffles. Une frontière
   posée à « 18 % de la largeur » tombait donc 1 ou 2 px à côté du vrai
   bord, et le décalage changeait avec la largeur de la fenêtre.

   Tous les calculs se font maintenant sur l'espace utile — et les
   frontières sont posées au milieu du souffle, pas sur le bord du bloc. */
const GAP = 3;

/** trois parts arrondies dont la somme fait exactement 100 */
function normalise(a: number, b: number, c: number): WheelRatio {
  const total = Math.max(1, Math.round(a) + Math.round(b) + Math.round(c));
  const A = Math.round((a / total) * 100);
  const B = Math.round((b / total) * 100);
  return { anchor: A, deepDive: B, fresh: Math.max(0, 100 - A - B) };
}

export const RatioWheel: React.FC<Props> = ({ ratio, onChange, target, labels }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [hover, setHover] = useState<WheelKey | null>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  /* ── pousser une frontière ──────────────────────────────────── */
  const dragTo = useCallback((edge: number, frac: number) => {
    const cur = ratioRef.current;
    /* `frac` vient d'une position en pixels ramenée à la largeur totale.
       On la reprojette sur l'espace utile : les souffles ne comptent pas
       dans les proportions. */
    const p = clamp(frac * 100, 5, 95);
    if (edge === 0) {
      const fixed = cur.fresh;
      const room = 100 - fixed;
      const A = clamp(p, 5, room - 5);
      onChange(normalise(A, room - A, fixed));
    } else {
      const fixed = cur.anchor;
      const room = 100 - fixed;
      const D = clamp(p - fixed, 5, room - 5);
      onChange(normalise(fixed, D, room - D));
    }
  }, [onChange]);

  useEffect(() => {
    if (dragging === null) return;
    const move = (e: PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      /* la position du curseur, ramenée à l'espace utile : on retire le
         souffle qui précède la frontière, puis on divise par la largeur
         utile */
      const usable = Math.max(1, box.width - GAP * 2);
      const offset = dragging === 0 ? GAP / 2 : GAP * 1.5;
      dragTo(dragging, (e.clientX - box.left - offset) / usable);
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, dragTo]);

  /* un clic sur un bloc lui donne un titre de plus, pris à celui qui en
     a le plus — c'est le réglage au doigt, sans glisser */
  const grow = (key: WheelKey) => {
    const cur = ratioRef.current;
    const per = 100 / Math.max(4, target);
    const donor = MIX_ORDER.filter((k) => k !== key).sort((a, b) => cur[b] - cur[a])[0];
    if (cur[donor] - per < 4) return;
    onChange(normalise(
      cur.anchor + (key === 'anchor' ? per : 0) - (donor === 'anchor' ? per : 0),
      cur.deepDive + (key === 'deepDive' ? per : 0) - (donor === 'deepDive' ? per : 0),
      cur.fresh + (key === 'fresh' ? per : 0) - (donor === 'fresh' ? per : 0),
    ));
  };

  const counts = {
    anchor: Math.round((ratio.anchor / 100) * target),
    deepDive: Math.round((ratio.deepDive / 100) * target),
    fresh: 0,
  };
  counts.fresh = Math.max(0, target - counts.anchor - counts.deepDive);

  return (
    <div className="sb-dose">
      <div
        className="sb-dose-track"
        ref={trackRef}
        data-dragging={dragging !== null ? '1' : '0'}
      >
        {MIX_ORDER.map((key) => (
          <div
            key={key}
            className="sb-dose-seg"
            data-key={key}
            data-on={hover === key ? '1' : '0'}
            style={{ flexGrow: Math.max(ratio[key], 1) }}
            onPointerEnter={() => setHover(key)}
            onPointerLeave={() => setHover((h) => (h === key ? null : h))}
            onClick={() => grow(key)}
            role="button"
            tabIndex={0}
            aria-label={`Ajouter un titre à ${labels[key]}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); grow(key); }
            }}
          >
            <span className="sb-dose-num">{counts[key]}</span>
            <span className="sb-dose-name">{labels[key]}</span>
          </div>
        ))}

        {/* les deux frontières : larges et hautes, on ne vise rien */}
        {[0, 1].map((edge) => (
          <button
            key={edge}
            type="button"
            className="sb-dose-edge"
            data-on={dragging === edge ? '1' : '0'}
            /* le bord exact : espace utile × part, plus les souffles déjà
               traversés, plus la moitié du souffle courant */
            style={{
              left: edge === 0
                ? `calc((100% - ${GAP * 2}px) * ${ratio.anchor / 100} + ${GAP / 2}px)`
                : `calc((100% - ${GAP * 2}px) * ${(ratio.anchor + ratio.deepDive) / 100} + ${GAP * 1.5}px)`,
            }}
            role="slider"
            aria-label={edge === 0
              ? `Frontière entre ${labels.anchor} et ${labels.deepDive}`
              : `Frontière entre ${labels.deepDive} et ${labels.fresh}`}
            aria-valuemin={5}
            aria-valuemax={95}
            aria-valuenow={edge === 0 ? ratio.anchor : ratio.anchor + ratio.deepDive}
            aria-valuetext={`${ratio.anchor} % · ${ratio.deepDive} % · ${ratio.fresh} %`}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              setDragging(edge);
            }}
            onKeyDown={(e) => {
              const delta = e.key === 'ArrowRight' ? 0.02 : e.key === 'ArrowLeft' ? -0.02 : 0;
              if (!delta) return;
              e.preventDefault();
              const base = (edge === 0 ? ratio.anchor : ratio.anchor + ratio.deepDive) / 100;
              const usable = Math.max(1, (trackRef.current?.getBoundingClientRect().width || 1) - GAP * 2);
              const offset = edge === 0 ? GAP / 2 : GAP * 1.5;
              dragTo(edge, (base * usable + offset + delta * usable) / ((trackRef.current?.getBoundingClientRect().width || 1)));
            }}
          >
            <span className="sb-dose-grip" aria-hidden />
          </button>
        ))}
      </div>

      {/* une seule ligne, discrète : le pourcentage exact, en petit */}
      <div className="sb-dose-legend">
        {MIX_ORDER.map((key) => (
          <span key={key} data-on={hover === key ? '1' : '0'}>
            <i data-c={key} /> {labels[key]} · {ratio[key]} %
          </span>
        ))}
      </div>
    </div>
  );
};

export default RatioWheel;
