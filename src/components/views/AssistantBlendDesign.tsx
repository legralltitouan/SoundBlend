import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronRight, Layers3, Loader2, Music2, Plus, Search, Star, X } from 'lucide-react';
import { Art } from '../ui/Art';
import type { Track } from '../../types';
import { norm } from '../../lib/track';
import { youtubeService } from '../../services/youtube';

export type AssistantSourceChoice = { key: string; title: string; kind: 'playlist' | 'blend' | 'catalog'; count: number; tracks: Track[]; thumbnail?: string };
export const AssistantMosaic: React.FC<{ tracks: Track[]; size?: number; title?: string }> = ({ tracks, size = 84, title = 'Pochettes des points de départ' }) => {
  const visible = tracks.slice(0, 3);
  return <span className="sa-mosaic" data-count={visible.length} role="img" aria-label={title} style={{ width: size, height: size }}>
    {visible.length ? visible.map((track, i) => <span className="sa-mosaic-cell" key={`${track.videoId}-${i}`}><Art track={track} size="100%" radius={0} /></span>) : <Music2 size={24} aria-hidden="true" />}
  </span>;
};
const durationLabel = (seconds?: number) => seconds && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '—';
export const AssistantSeedPreview: React.FC<{ tracks: Track[] }> = ({ tracks }) => {
  const ids = tracks.slice(0, 3).map(t => t.videoId).join(',');
  const serial = youtubeService.sessionRevision();
  const [metadata, setMetadata] = useState<{ key: string; durations: Record<string, number> } | null>(null);
  useEffect(() => {
    let active = true;
    void youtubeService.fetchVideoDurations(ids.split(',')).then(durations => { if (active) setMetadata({ key: ids, durations }); }).catch(() => { if (active) setMetadata({ key: ids, durations: {} }); });
    return () => { active = false; };
  }, [ids, serial]);
  return <ol className="sa-track-preview">{tracks.slice(0, 3).map((track, i) => {
    const duration = metadata?.key === ids ? metadata.durations[track.videoId] : undefined;
    return <li key={`${track.id}-${i}`}><span>{String(i + 1).padStart(2, '0')}</span><span className="sa-seed-art"><Art track={track} size={40} radius={9} /></span><div><b>{track.title}</b><small>{track.artist}</small></div><time aria-label={duration ? `Durée ${durationLabel(duration)}` : 'Durée non disponible'} title={duration ? 'Durée fournie par YouTube' : 'Durée indisponible : aucune estimation affichée'}>{durationLabel(duration)}</time></li>;
  })}</ol>;
};
export const AssistantInstruction: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = ref.current; if (!input) return;
    const fit = () => { if (!input.getClientRects().length) return; input.style.height = '0px'; input.style.height = `${input.scrollHeight + 2}px`; };
    const details = input.closest('details');
    details?.addEventListener('toggle', fit); window.addEventListener('resize', fit);
    const observer = new ResizeObserver(() => { if (input.clientWidth !== previousWidth) { previousWidth = input.clientWidth; fit(); } });
    let previousWidth = input.clientWidth; observer.observe(input); fit();
    return () => { observer.disconnect(); details?.removeEventListener('toggle', fit); window.removeEventListener('resize', fit); };
  }, [value]);
  return <label className="sa-instruction-label">Ta direction musicale<textarea ref={ref} className="sa-auto-instruction" aria-label="Consigne transmise à Gemini" value={value} onChange={e => onChange(e.target.value)} rows={1} maxLength={6000} /></label>;
};
export const AssistantDuration: React.FC<{ minutes: number; onChange: (value: number) => void }> = ({ minutes, onChange }) => <div className="sa-duration-control">
  <div><label htmlFor="sa-duration">Le temps d’une parenthèse</label><output htmlFor="sa-duration">{minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60}` : ''}` : `${minutes} min`}</output></div>
  <input id="sa-duration" type="range" aria-label="Durée du blend" min={10} max={180} step={1} value={minutes} onChange={e => onChange(Number(e.target.value))} aria-valuetext={`${minutes} minutes`} style={{ '--sa-range': `${(minutes - 10) / 170 * 100}%` } as React.CSSProperties} />
  <div className="sa-duration-presets" role="group" aria-label="Durées rapides">{[20, 45, 60, 120].map(value => <button type="button" key={value} aria-pressed={minutes === value} onClick={() => onChange(value)}>{value < 60 ? `${value} min` : `${value / 60} h`}</button>)}</div>
</div>;
const SourceArtwork: React.FC<{ choice?: AssistantSourceChoice; size: number }> = ({ choice, size }) => choice?.thumbnail && !choice.tracks.length
  ? <span className="sa-source-thumbnail" style={{ width: size, height: size }}><Music2 size={18} /><img src={choice.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.hidden = true; }} /></span>
  : <AssistantMosaic tracks={choice?.tracks || []} size={size} title={`Pochettes ${choice?.title || 'Source indisponible'}`} />;
export const AssistantSourcePalette: React.FC<{
  choices: AssistantSourceChoice[]; primary: string; extras: string[];
  onChange: (primary: string, extras: string[]) => void; disabled?: boolean;
}> = ({ choices, primary, extras, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const selected = [primary, ...extras].filter(Boolean);
  const remove = (key: string) => key === primary ? onChange(extras[0] || '', extras.slice(1)) : onChange(primary, extras.filter(x => x !== key));
  return <div className="sa-source-palette">
    <div className="sa-palette-heading"><div><strong>Ta palette musicale</strong><small>Une base, jusqu’à trois nuances à combiner.</small></div><button type="button" className="sa-palette-add" disabled={disabled} onClick={() => setOpen(true)} aria-label="Choisir les sources musicales"><Plus size={15} /> Explorer</button></div>
    {selected.length ? <ul className="sa-source-selection">{selected.map((key, index) => {
      const choice = choices.find(c => c.key === key);
      return <li key={key}><SourceArtwork choice={choice} size={44} /><div><small>{index === 0 ? 'BASE DU BLEND' : 'NUANCE'}</small><b>{choice?.title || 'Source indisponible'}</b><span>{choice?.count ?? 0} titres · {choice?.kind === 'blend' ? 'Blend' : choice?.kind === 'catalog' ? 'Sélection YouTube' : 'Playlist'}</span></div>
        {index > 0 && <button type="button" className="sa-palette-icon" aria-label={`Utiliser ${choice?.title} comme base`} title="En faire la base" disabled={disabled} onClick={() => onChange(key, [primary, ...extras.filter(x => x !== key)].filter(Boolean))}><Star size={15} /></button>}
        <button type="button" className="sa-palette-icon" aria-label={`Retirer la source ${choice?.title}`} disabled={disabled} onClick={() => remove(key)}><X size={15} /></button></li>;
    })}</ul> : <button type="button" className="sa-source-empty" onClick={() => setOpen(true)} disabled={disabled}><Layers3 size={19} /> Choisir une première inspiration <ChevronRight size={16} /></button>}
    {open && <AssistantSourceDialog choices={choices} selected={selected} onToggle={key => {
      if (selected.includes(key)) remove(key);
      else if (!primary) onChange(key, extras); else if (extras.length < 3) onChange(primary, [...extras, key]);
    }} onClose={() => setOpen(false)} />}
  </div>;
};
const AssistantSourceDialog: React.FC<{ choices: AssistantSourceChoice[]; selected: string[]; onToggle: (key: string) => void; onClose: () => void }> = ({ choices, selected, onToggle, onClose }) => {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [limit, setLimit] = useState(20);
  useEffect(() => {
    const element = dialog.current, opener = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = 'hidden'; input.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const fit = () => { const height = viewport?.height || innerHeight; element?.style.setProperty('--sa-picker-available', `${height}px`); element?.style.setProperty('--sa-picker-inset', `${Math.max(0, innerHeight - height - (viewport?.offsetTop || 0))}px`); };
    fit(); viewport?.addEventListener('resize', fit);
    return () => { element?.close(); document.body.style.overflow = overflow; viewport?.removeEventListener('resize', fit); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  const matches = choices.filter(c => (filter === 'all' || c.kind === filter) && norm(c.title).includes(norm(query)));
  return createPortal(<dialog ref={dialog} className="sb-action-sheet sb-action-sheet--exclusions sa-mention-picker sa-source-dialog" aria-labelledby="sa-source-title" aria-describedby="sa-source-intro" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <span className="sb-action-grip" aria-hidden="true" /><header className="sb-exclusions-header sb-action-heading"><div><p className="sb-action-eyebrow">LES COULEURS DE TON BLEND</p><h2 id="sa-source-title">Tes inspirations</h2><p id="sa-source-intro">Choisis jusqu’à quatre sources à faire dialoguer.</p></div><button type="button" className="sb-action-close" aria-label="Fermer les sources musicales" onClick={onClose}><X size={19} /></button></header>
    <div className="sb-exclusions-controls"><div className="sb-exclusions-search"><Search size={17} /><input ref={input} aria-label="Rechercher une source musicale" placeholder="Une playlist, un blend…" value={query} onChange={e => { setQuery(e.target.value); setLimit(20); }} />{query && <button type="button" aria-label="Effacer la recherche de sources" onClick={() => setQuery('')}><X size={15} /></button>}</div>
      <div className="sa-source-filters" role="group" aria-label="Filtrer les sources">{[['all', 'Tout'], ['playlist', 'Playlists'], ['blend', 'Blends'], ['catalog', 'Titres choisis']].map(([key, text]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setLimit(20); }}>{text}</button>)}</div></div>
    <div className="sb-exclusions-scroll"><ul className="sa-source-results">{matches.slice(0, limit).map(choice => {
      const chosen = selected.includes(choice.key); return <li key={choice.key}><button type="button" aria-label={`${chosen ? 'Retirer' : 'Ajouter'} ${choice.title}`} aria-pressed={chosen} disabled={!chosen && selected.length >= 4} onClick={() => onToggle(choice.key)}><SourceArtwork choice={choice} size={48} /><span><b>{choice.title}</b><small>{choice.kind === 'blend' ? 'Blend' : choice.kind === 'catalog' ? 'Titres YouTube choisis' : 'Playlist'} · {choice.count} titres</small></span><i aria-hidden="true">{chosen ? <Check size={16} /> : <Plus size={16} />}</i></button></li>;
    })}</ul>{!matches.length && <p className="sa-source-no-results">Aucune source ne correspond à cette recherche.</p>}{matches.length > limit && <button type="button" className="sb-assistant-inline-button" onClick={() => setLimit(n => n + 20)}>Afficher plus de sources</button>}</div>
    <footer className="sa-picker-footer"><span role="status">{selected.length}/4 inspirations sélectionnées</span><button type="button" className="btn" onClick={onClose}>Garder cette palette <Check size={15} /></button></footer>
  </dialog>, document.body);
};
export const AssistantThinking: React.FC<{ stage: string; long: boolean }> = ({ stage, long }) => {
  const reduced = useReducedMotion(), [tick, setTick] = useState(0);
  useEffect(() => { if (reduced) return; const timer = setInterval(() => setTick(n => n + 1), 3200); return () => clearInterval(timer); }, [reduced]);
  const generic = /Gemini réfléchit|Envoi de la demande|Connexion établie|Réception de la réponse/.test(stage);
  const lines = generic ? [stage, 'Tes sources et tes exclusions accompagnent la demande.', 'L’aperçu sera affiché après validation de la réponse complète.'] : [stage];
  const current = lines[tick % lines.length] || 'Lecture de ton contexte musical…';
  return <div className="sb-chat-thinking sa-thinking"><span className="sa-thinking-mark" aria-hidden="true"><Loader2 size={17} className="anim-spin" /></span><div><strong>Gemini réfléchit à ta demande…</strong><span className="sr-only" role="status" aria-live="polite">{stage}</span><div className="sa-thinking-line" aria-hidden="true"><AnimatePresence initial={false} mode="wait"><motion.p key={current} initial={reduced ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? {} : { opacity: 0, y: -7 }} transition={{ duration: reduced ? 0 : .24 }}>{current}</motion.p></AnimatePresence></div>{long && <small>La préparation continue. Tu peux l’arrêter à tout moment.</small>}</div></div>;
};
