import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Sparkles, ShieldCheck, Car, Flame, Disc3, Compass } from 'lucide-react';
import { splitCounts } from '../../services/curator';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { Modal, ModalHeader, ModalFooter, ModalBody } from '../ui/Modal';
import { Button } from '../ui';
import { getStoredTasteMemory } from '../../services/storage';
import type { BlendRatio } from '../../types';
import { RatioWheel, type WheelRatio } from '../ui/RatioWheel';

const DURATIONS = [
  { minutes: 20, label: '20 min', icon: Car, hint: 'Le trajet' },
  { minutes: 45, label: '45 min', icon: Flame, hint: 'La séance' },
  { minutes: 60, label: '1 h', icon: Clock, hint: 'La session' },
  { minutes: 120, label: '2 h', icon: Disc3, hint: 'La route' },
];

const PRESETS: { label: string; ratio: BlendRatio }[] = [
  { label: 'Équilibré', ratio: { anchor: 30, deepDive: 30, fresh: 40 } },
  { label: 'Tout découverte', ratio: { anchor: 20, deepDive: 20, fresh: 60 } },
  { label: 'Confort', ratio: { anchor: 50, deepDive: 25, fresh: 25 } },
];

const CHANNELS = [
  { key: 'anchor' as const, color: 'var(--accent)', label: 'Piliers', desc: 'Tes morceaux d’amorce, ceux que tu viens de cocher.' },
  { key: 'deepDive' as const, color: 'var(--deepc, #ff7a00)', label: 'Faces cachées', desc: 'Albums, faces B, instrumentaux des mêmes artistes.' },
  { key: 'fresh' as const, color: 'var(--freshc, #5e39ff)', label: 'Découvertes', desc: 'Des artistes que tu n’as pas choisis, dans la même texture sonore.' },
];

/* ═══════════════════════════════════════════════════════════════
   Étape 2 — durée + répartition. Les sliders restent couplés
   (somme = 100) et la barre de répartition est animée.
   ═══════════════════════════════════════════════════════════════ */

export const ConfigModal: React.FC = () => {
  const { modal, closeModal, openModal, setView, showToast, design } = useUI();
  const { selectedTracks, generate, settings } = useData();

  const [minutes, setMinutes] = useState(45);
  const [ratio, setRatio] = useState<BlendRatio>({ anchor: 30, deepDive: 30, fresh: 40 });

  const taste = getStoredTasteMemory();
  const target = useMemo(() => Math.max(4, Math.round(minutes / 3.5)), [minutes]);

  /* même fonction que celles du moteur (curator.ts) : ce que cet écran
     annonce est exactement ce que la génération demandera */
  const counts = useMemo(
    () => splitCounts(target, ratio, selectedTracks.length),
    [target, ratio, selectedTracks.length],
  );

  const setOne = (key: keyof BlendRatio, raw: number) => {
    const v = Math.min(80, Math.max(0, raw));
    const rest = 100 - v;
    const keys = (['anchor', 'deepDive', 'fresh'] as const).filter((k) => k !== key);
    const a = Math.round(rest / 2);
    const next: BlendRatio = { anchor: 0, deepDive: 0, fresh: 0 };
    next[key] = v;
    next[keys[0]] = a;
    next[keys[1]] = rest - a;
    setRatio(next);
  };

  const launch = async () => {
    closeModal();
    setTimeout(() => openModal('generating'), 200);
    try {
      const blend = await generate({ durationMinutes: minutes, ratio });
      if (blend) {
        closeModal();
        setView('blend');
        showToast(`Blend prêt : ${blend.tracks.length} titres.`);
      }
    } catch (e: any) {
      closeModal();
      showToast(e?.message || 'La génération a échoué.');
    }
  };

  if (design === 'ytm') {
    return (
      <Modal open={modal === 'config'} onClose={closeModal} size="md" label="Réglages du blend">
        <div style={{ padding: '26px 26px 10px' }}>
          <div className="ink-3" style={{ fontSize: 11.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Étape 2</div>
          <h2 className="title-display" style={{ fontSize: 27, margin: '8px 0 6px', fontWeight: 400 }}>Compose le blend</h2>
          <p className="ink-3" style={{ margin: 0, fontSize: 13 }}>{selectedTracks.length} amorces · ≈ {target} titres</p>
        </div>
        <ModalBody>
          {/* durée : quatre repères + un rail, le chiffre au centre */}
          <div className="sb-dur">
            <div className="sb-dur-chips">
              {DURATIONS.map((d) => {
                const Icon = d.icon;
                const on = minutes === d.minutes;
                return (
                  <button
                    key={d.minutes}
                    onClick={() => setMinutes(d.minutes)}
                    className="sb-dur-chip"
                    data-on={on ? '1' : '0'}
                    title={d.hint}
                  >
                    <Icon size={14} strokeWidth={1.9} />
                    <span>{d.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="sb-dur-read">
              <span className="sb-dur-value">{minutes}</span>
              <span className="sb-dur-unit">min</span>
              <span className="sb-dur-sep">·</span>
              <span className="sb-dur-target">≈ {target} titres</span>
            </div>
            <input
              type="range" min={10} max={180} step={5} value={minutes}
              onChange={(e) => setMinutes(+e.target.value)}
              style={{ ['--fill' as any]: `${((minutes - 10) / 170) * 100}%` }}
              aria-label="Durée du blend"
            />
          </div>

          <div className="sb-mix">
            <div className="sb-mix-head">
              <span className="sb-mix-title">Répartition</span>
              <div className="sb-mix-presets">
                {PRESETS.map((p) => {
                  const on = p.ratio.anchor === ratio.anchor && p.ratio.deepDive === ratio.deepDive && p.ratio.fresh === ratio.fresh;
                  return (
                    <button key={p.label} onClick={() => setRatio(p.ratio)} data-on={on ? '1' : '0'}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sb-mix-body">
              <RatioWheel
                ratio={ratio as WheelRatio}
                onChange={(next) => setRatio(next as BlendRatio)}
                target={target}
                labels={{ anchor: 'Piliers', deepDive: 'Faces cachées', fresh: 'Découvertes' }}
              />
            </div>
          </div>
        </ModalBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 26px 20px', borderTop: '1px solid var(--line)' }}>
          <span className="ink-3" style={{ fontSize: 12 }}>{taste.likedArtists.length} artistes aimés · {taste.dislikedArtists.length} écartés</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={closeModal}>Retour</Button>
          <Button onClick={launch}><Sparkles size={15} /> Générer</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={modal === 'config'} onClose={closeModal} size="md" label="Réglages du blend">
      <ModalHeader
        eyebrow="Étape 2 · Dosage"
        title="Compose le blend"
        subtitle={`${selectedTracks.length} morceau${selectedTracks.length > 1 ? 'x' : ''} d’amorce · l’IA s’occupe du reste.`}
      />

      <ModalBody>
        {/* durée */}
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Durée</h3>
            <span className="ink-3" style={{ fontSize: 12.5 }}>≈ {target} titres</span>
            <span style={{ flex: 1 }} />
            <span className="pill" style={{ color: 'var(--accent)' }}>{minutes} min</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
            {DURATIONS.map((d) => {
              const Icon = d.icon;
              const active = minutes === d.minutes;
              return (
                <motion.button
                  key={d.minutes}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setMinutes(d.minutes)}
                  className="tap"
                  style={{
                    padding: '12px 6px', borderRadius: 14, cursor: 'pointer',
                    border: `1px solid ${active ? 'color-mix(in oklab, var(--accent) 55%, transparent)' : 'var(--line)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-sunken)',
                    color: active ? 'var(--accent)' : 'var(--ink-2)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    transition: 'all .22s var(--ease-out)',
                  }}
                >
                  <Icon size={16} />
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{d.label}</span>
                  <span className="ink-3" style={{ fontSize: 10.5 }}>{d.hint}</span>
                </motion.button>
              );
            })}
          </div>

          <input
            type="range" min={10} max={180} step={5} value={minutes}
            onChange={(e) => setMinutes(parseInt(e.target.value, 10))}
            style={{ marginTop: 12, ['--fill' as any]: `${((minutes - 10) / 170) * 100}%` }}
            aria-label="Durée personnalisée"
          />
        </div>

        {/* répartition */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Répartition</h3>
            <Compass size={15} className="ink-3" />
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setRatio(p.ratio)}
                  className="pill"
                  style={{
                    cursor: 'pointer', fontSize: 11, height: 26,
                    background: JSON.stringify(p.ratio) === JSON.stringify(ratio) ? 'var(--accent-soft)' : 'var(--bg-sunken)',
                    color: JSON.stringify(p.ratio) === JSON.stringify(ratio) ? 'var(--accent)' : 'var(--ink-2)',
                    border: `1px solid ${JSON.stringify(p.ratio) === JSON.stringify(ratio) ? 'color-mix(in oklab, var(--accent) 40%, transparent)' : 'var(--line)'}`,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* barre animée */}
          <div style={{ display: 'flex', height: 12, gap: 3, padding: 3, borderRadius: 999, background: 'var(--bg-sunken)', border: '1px solid var(--line)', marginBottom: 16 }}>
            {CHANNELS.map((c) => (
              <motion.span
                key={c.key}
                layout
                animate={{ flexGrow: ratio[c.key] }}
                transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                style={{ background: c.color, borderRadius: 999, minWidth: 6 }}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {CHANNELS.map((c) => (
              <div key={c.key} style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--bg-sunken)', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: c.color }} />
                  <strong style={{ fontSize: 13.5 }}>{c.label}</strong>
                  <span style={{ flex: 1 }} />
                  <span className="ink-3" style={{ fontSize: 12 }}>{counts[c.key]} titres</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: c.color, minWidth: 38, textAlign: 'right' }}>{ratio[c.key]} %</span>
                </div>
                <p className="ink-3" style={{ margin: '4px 0 8px', fontSize: 11.5 }}>{c.desc}</p>
                <input
                  type="range" min={0} max={80} value={ratio[c.key]}
                  onChange={(e) => setOne(c.key, parseInt(e.target.value, 10))}
                  aria-label={`Part de ${c.label}`}
                  style={{ ['--fill' as any]: `${(ratio[c.key] / 80) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* mémoire des goûts */}
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'var(--accent-soft)' }}>
          <ShieldCheck size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45 }} className="ink-2">
            <strong style={{ color: 'var(--ink)' }}>Mémoire active :</strong> {taste.likedArtists.length} artiste(s) aimé(s),{' '}
            {taste.dislikedArtists.length} écarté(s). Tes avis sont pris en compte.
          </p>
          <button onClick={() => { closeModal(); setTimeout(() => setView('taste'), 180); }} className="ink-3" style={{ background: 'none', border: 0, cursor: 'pointer', fontSize: 12 }}>
            Voir
          </button>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={closeModal}>Retour</Button>
        <span style={{ flex: 1 }} />
        <Button variant="primary" onClick={launch}>
          <Sparkles size={16} />
          Générer {target} titres
        </Button>
      </ModalFooter>
    </Modal>
  );
};
