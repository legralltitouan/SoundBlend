import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  Play, Pause, Trash2, RefreshCw, Share2, ExternalLink,
  ChevronUp, ChevronDown, ArrowLeft, Pencil, Lock, Globe, Check, Clock, Sparkles, Cpu, Compass, TriangleAlert,
  MoreHorizontal, ArrowRight, Download, Radio,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useUI } from '../../context/UIContext';
import { usePlayer } from '../../context/PlayerContext';
import { geminiService } from '../../services/gemini';
import { dedupeTracks } from '../../lib/dedupe';
import { youtubeService } from '../../services/youtube';
import { getExclusions, getStoredBlends, isExcluded, isRecentlyProposed, recordDiscoveries } from '../../services/storage';
import { accountRevision, assertAccountRevision } from '../../services/accountScope';
import { beginExportAttempt, clearExportAttempt, exportAttemptStorageKey, getExportAttempt, parsePlaylistId, rememberExportPlaylist, type ExportAttempt } from '../../services/exportRecovery';
import { BlockButton } from '../ui/BlockButton';
import { useReplaceQueue } from '../../context/ReplaceQueueContext';
import { Button, Equalizer } from '../ui';
import { Art } from '../ui/Art';
import type { Track, TrackCategory, GeneratedBlend } from '../../types';

const CAT: Record<TrackCategory, { label: string; color: string }> = {
  anchor: { label: 'Pilier', color: 'var(--anchor)' },
  deep_dive: { label: 'Face cachée', color: 'var(--deep)' },
  fresh: { label: 'Découverte', color: 'var(--fresh)' },
};

/* ═══════════════════════════════════════════════════════════════
   Étape 3 — le résultat. Grande pochette-mosaïque, lecture,
   réordonnancement, remplacement à 1 clic, export YouTube Music.
   ═══════════════════════════════════════════════════════════════ */

export const BlendView: React.FC = () => {
  const { currentBlend } = useData();
  const { setView } = useUI();
  if (!currentBlend) return <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', textAlign: 'center', padding: 24 }}><div><p className="ink-2">Ce blend a expiré ou n’est plus disponible.</p><Button variant="tonal" onClick={() => setView('library')}>Retour à la bibliothèque</Button></div></div>;
  return <BlendViewContent key={currentBlend.id} blend={currentBlend} />;
};

const BlendViewContent: React.FC<{ blend: GeneratedBlend }> = ({ blend }) => {
  const { updateBlend, settings, isAuthenticated } = useData();
  const { design, showToast, setView } = useUI();
  const { playTrack, currentTrack, isPlaying } = usePlayer();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(blend.title || '');
  /* la visibilité suit ce qui a réellement été envoyé : un blend exporté
     en public ne doit pas afficher « Privée » au rechargement */
  const [priv, setPriv] = useState(() => (blend.exportedMeta?.privacy || 'private') === 'private');
  useEffect(() => {
    if (blend.exportedMeta?.privacy) setPriv(blend.exportedMeta.privacy === 'private');
  }, [blend.exportedPlaylistId, blend.exportedMeta?.privacy]);
  const [exporting, setExporting] = useState(false);
  const [recovery, setRecovery] = useState<ExportAttempt | null>(() => blend.exportedPlaylistId ? null : getExportAttempt(blend.id));
  const [recoveryInput, setRecoveryInput] = useState('');
  const [exported, setExported] = useState<string | null>(() => blend.exportedUrl
    || (getExportAttempt(blend.id)?.playlistId ? `https://music.youtube.com/playlist?list=${encodeURIComponent(getExportAttempt(blend.id)!.playlistId!)}` : null));
  const [exportWarning, setExportWarning] = useState('');
  useEffect(() => { if (blend.exportedUrl) setExported(blend.exportedUrl); }, [blend.exportedUrl]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== exportAttemptStorageKey(blend.id)) return;
      const saved = getStoredBlends().find((b) => b.id === blend.id);
      const next = saved?.exportedPlaylistId ? null : getExportAttempt(blend.id);
      setRecovery(next);
      if (saved?.exportedUrl) setExported(saved.exportedUrl);
      else setExported(next?.playlistId ? `https://music.youtube.com/playlist?list=${encodeURIComponent(next.playlistId)}` : null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [blend.id]);
  const queue = useReplaceQueue();

  const stats = useMemo(() => {
    const seconds = blend.tracks.reduce((a, t) => a + (t.durationSeconds || 200), 0);
    return {
      minutes: Math.round(seconds / 60),
      anchor: blend.tracks.filter((t) => t.category === 'anchor').length,
      deep: blend.tracks.filter((t) => t.category === 'deep_dive').length,
      fresh: blend.tracks.filter((t) => t.category === 'fresh').length,
    };
  }, [blend]);

  /* ── playlist déjà exportée : la garder au diapason ────────────────
     Dès qu'un titre est ajouté, retiré ou remplacé dans le blend, la
     playlist YouTube Music ne correspond plus. On compare les deux
     contenus et, si ça diverge, on propose « Mettre à jour ». */
  const [outOfSync, setOutOfSync] = useState(false);
  const [updating, setUpdating] = useState(false);
  /* sans connexion Google, on ne peut pas comparer : le bouton reste caché */
  const [canSync, setCanSync] = useState(false);
  useEffect(() => { setCanSync(isAuthenticated && youtubeService.isAuthenticated()); }, [blend.exportedPlaylistId, isAuthenticated]);

  /* ═══ « Mettre à jour » : quand, et pourquoi ═══
     Avant, à chaque affichage, on relisait la playlist distante et on la
     comparait au blend. Deux défauts en sortaient :

     · juste après un export, YouTube n'a pas fini d'enregistrer les
       morceaux ; la relecture revenait incomplète et l'app proposait
       aussitôt « Mettre à jour » — pour une playlist qui venait d'être
       mise à jour ;
     · le titre et la confidentialité ne comptaient pas du tout : on
       pouvait renommer un blend ou le passer en public sans que rien ne
       propose de le reporter sur YouTube Music.

     Désormais on compare le blend à ce qu'on a **réellement envoyé**
     (titre, visibilité, liste des morceaux) — une référence locale,
     écrite à chaque export et à chaque mise à jour. Pas de relecture
     réseau, donc pas de course, et le titre compte comme le reste. */
  const signature = useMemo(() => {
    const ids = (blend.tracks.map((t) => t.videoId).filter(Boolean) as string[]).filter((v, i, a) => a.indexOf(v) === i);
    return `${blend.title.trim()}|${priv ? 'private' : 'public'}|${ids.join(',')}`;
  }, [blend.tracks, blend.title, priv]);

  useEffect(() => {
    if (!blend.exportedPlaylistId) { setOutOfSync(false); return; }
    const ref = blend.exportedMeta;
    // Sans référence, par exemple après un export partiel, on ne prétend
    // pas que la playlist est à jour : l'utilisateur peut réessayer.
    setOutOfSync(!ref || ref.sig !== signature);
  }, [blend.exportedPlaylistId, blend.exportedMeta, signature]);

  const updateOnYT = async () => {
    const pid = blend.exportedPlaylistId;
    if (!pid || updating || exporting) return;
    const revision = accountRevision();
    setUpdating(true); setExportWarning('');
    try {
      const ref = blend.exportedMeta;
      // Une signature vide signifie que même les métadonnées n'ont pas
      // été confirmées lors du précédent export partiel.
      const renomme = !ref?.sig || ref.title.trim() !== blend.title.trim();
      const visibilite = !ref?.sig || ref.privacy !== (priv ? 'private' : 'public');
      if (renomme || visibilite) await youtubeService.updatePlaylistMeta(pid, { title: blend.title, privacy: priv ? 'private' : 'public' });
      assertAccountRevision(revision);
      const res = await youtubeService.syncPlaylist(pid, blend.tracks);
      assertAccountRevision(revision);
      const meta = await youtubeService.getPlaylistMeta(pid);
      assertAccountRevision(revision);
      if (meta.title.trim() !== blend.title.trim() || meta.privacy !== (priv ? 'private' : 'public')) {
        throw new Error('YouTube n’a pas confirmé le titre ou la visibilité de la playlist. Vérifie puis réessaie.');
      }
      const current = getStoredBlends().find((b) => b.id === blend.id);
      if (!current) throw new Error('Le blend a été supprimé pendant la mise à jour ; la playlist YouTube est conservée.');
      const ids = [...new Set(blend.tracks.map((t) => t.videoId).filter(Boolean))];
      updateBlend({ ...current, exportedMeta: {
        sig: `${blend.title.trim()}|${priv ? 'private' : 'public'}|${ids.join(',')}`,
        title: blend.title, privacy: priv ? 'private' : 'public', at: new Date().toISOString(),
      } });
      const bits = [renomme ? 'titre' : '', visibilite ? 'visibilité' : '',
        res.added ? `${res.added} ajout${res.added > 1 ? 's' : ''}` : '',
        res.removed ? `${res.removed} retrait${res.removed > 1 ? 's' : ''}` : '',
        res.moved ? `${res.moved} déplacement${res.moved > 1 ? 's' : ''}` : ''].filter(Boolean);
      showToast(bits.length ? `Playlist vérifiée et mise à jour : ${bits.join(', ')}.` : 'La playlist était déjà à jour.');
    } catch (e: any) {
      if (revision === accountRevision()) {
        const msg = e?.message || 'Mise à jour impossible ; la playlist peut être partiellement modifiée.';
        setExportWarning(msg); showToast(msg);
      }
    } finally { if (revision === accountRevision()) setUpdating(false); }
  };

  const saveTitle = () => {
    try {
      if (title.trim() && title !== blend.title) updateBlend({ ...blend, title: title.trim() });
      setEditing(false);
    } catch (e) { showToast(e instanceof Error ? e.message : 'Titre non enregistré.'); }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blend.tracks.length) return;
    const next = [...blend.tracks];
    [next[i], next[j]] = [next[j], next[i]];
    try { updateBlend({ ...blend, tracks: next }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Ordre non enregistré.'); }
  };

  const remove = (id: string) => {
    try { updateBlend({ ...blend, tracks: blend.tracks.filter((t) => t.id !== id) }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Retrait non enregistré.'); }
  };

  /* ── remplacer un morceau ──────────────────────────────────────
     Le travail ne se fait plus ici : on l'empile dans la file, qui
     s'occupe de tout, un morceau à la fois. On peut donc en lancer
     plusieurs d'affilée, quitter le blend et revenir : l'icône tourne
     toujours et la proposition finit par arriver. */
  const replace = (track: Track) => {
    const revision = accountRevision();
    if (!queue) return;
    if (queue.jobFor(blend.id, track.id)) return;      // déjà en file
    queue.enqueue({
      blendId: blend.id,
      trackId: track.id,
      trackTitle: track.title,
      run: async (onStep) => {
        assertAccountRevision(revision);
        /* on transmet l'étape ET la note du moteur : le bandeau affiche
           aussi ce que le modèle a compris du contexte */
        const relay = (s: any) => onStep(s);
        /* deux essais : si la première proposition est déjà dans le blend
           (ou tombe sur la même vidéo), on en demande une autre au lieu de
           rendre un échec à l'auditeur */
        for (let attempt = 0; attempt < 2; attempt++) {
          const fresh = await geminiService.replaceSingleTrack(
            track, blend.tracks, blend.seedTracks, getExclusions(),
            { onStep: relay, nonce: Date.now() + attempt, instruction: blend.instruction },
          );
          assertAccountRevision(revision);
          const note = geminiService.takeEngineNote();
          if (note) onStep(note as any);
          if (!fresh) continue;
          /* la proposition ne doit être ni le morceau remplacé, ni un autre
             morceau du blend — ni le même en double, sous un autre titre */
          const others = blend.tracks.filter((t) => t.id !== track.id);
          if (!fresh.videoId || isExcluded(fresh) || isRecentlyProposed(fresh)) continue;
          if (others.some((t) => (t.videoId && t.videoId === fresh.videoId)
            || t.title.trim().toLowerCase() === fresh.title.trim().toLowerCase())) continue;
          return { title: fresh.title, artist: fresh.artist, track: fresh };
        }
        return null;
      },
    });
  };

  /* une proposition prête est appliquée dès qu'elle arrive — que l'on
     soit resté sur le blend ou revenu après un détour */
  useEffect(() => {
    if (!queue) return;
    const ready = queue.readyFor(blend.id);
    if (!ready?.result) return;
    const target = blend.tracks.find((t) => t.id === ready.trackId);
    if (target && !isExcluded(ready.result.track) && !isRecentlyProposed(ready.result.track)
      && !blend.tracks.some((t) => t.id !== target.id && (t.videoId === ready.result!.track.videoId || t.title.trim().toLowerCase() === ready.result!.track.title.trim().toLowerCase()))) {
      try {
        recordDiscoveries([ready.result.track]);
        updateBlend({ ...blend, tracks: dedupeTracks(blend.tracks.map((t) => (t.id === ready.trackId ? ready.result!.track : t))) });
        showToast(`« ${target.title} » remplacé par « ${ready.result.title} » — ${ready.result.artist}.`);
      } catch (e) { showToast(e instanceof Error ? e.message : 'Remplacement non enregistré.'); }
    }
    queue.consume(ready.id);
  }, [queue, blend, updateBlend, showToast]);

  const saveRecoveredLink = () => {
    if (!recovery || exporting || updating) return;
    try {
      const id = recovery.playlistId || parsePlaylistId(recoveryInput);
      if (!id) throw new Error('Saisis un lien de playlist YouTube valide ou son identifiant.');
      // Si l'écriture du blend échoue encore, garder l'identifiant connu
      // et le lien visible pour ne pas perdre une playlist déjà créée.
      const known = rememberExportPlaylist(recovery, id);
      setRecovery(known);
      const url = `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`;
      setExported(url);
      const current = getStoredBlends().find((b) => b.id === blend.id);
      if (!current) throw new Error('Ce blend n’est plus disponible ; la playlist YouTube est conservée.');
      if (current.exportedPlaylistId && current.exportedPlaylistId !== id) throw new Error('Ce blend est déjà associé à une autre playlist. Vérifie avant de continuer.');
      updateBlend({ ...current, exportedPlaylistId: id, exportedUrl: url, exportedMeta: {
        sig: '', title: known.title || current.title, privacy: known.privacy, at: new Date().toISOString(),
      } });
      try { clearExportAttempt(known); } catch { /* le lien est déjà enregistré dans le blend */ }
      setRecovery(null);
      setExportWarning('Lien enregistré. La playlist n’est pas encore vérifiée : utilise « Mettre à jour » pour la compléter.');
      showToast('Lien enregistré ; la playlist reste à vérifier.');
    } catch (e: any) {
      const msg = e?.message || 'Impossible d’enregistrer le lien de cette playlist.';
      setExportWarning(msg); showToast(msg);
    }
  };

  const forgetUnknownAttempt = () => {
    if (!recovery || recovery.playlistId || exporting || updating) return;
    try {
      clearExportAttempt(recovery); setRecovery(null); setExported(null);
      setExportWarning('Si YouTube avait bien créé une playlist, un nouvel export créerait un doublon.');
    } catch (e: any) { setExportWarning(e?.message || 'Impossible de lever le blocage.'); }
  };

  const exportToYT = async () => {
    if (!isAuthenticated) { showToast('Connecte ton compte YouTube pour exporter ce blend.'); setView('settings'); return; }
    if (exporting || updating) return;
    const revision = accountRevision();
    let created = false, started = false;
    setExporting(true); setExportWarning('');
    try {
      if (blend.tracks.some((t) => !t.videoId)) throw new Error('Un morceau n’a pas d’identifiant YouTube. Export impossible.');
      const desc = `Blend SoundBlend AI — amorces : ${blend.seedTracks.map((t) => t.title).join(', ')}`;
      const nom = title || blend.title;
      // Si cette petite écriture échoue, aucun POST n'est envoyé. Si la
      // réponse disparaît ensuite, l'intention empêche un doublon silencieux.
      const attempt = beginExportAttempt(blend.id, nom, priv ? 'private' : 'public');
      started = true; setRecovery(attempt);
      const id = await youtubeService.createPlaylist(nom, desc, priv);
      assertAccountRevision(revision);
      created = true;
      const url = `https://music.youtube.com/playlist?list=${encodeURIComponent(id)}`;
      // Même si un autre onglet a modifié le journal entre-temps, ne pas
      // perdre l'URL que YouTube vient de renvoyer dans cet onglet.
      setExported(url); setRecovery({ ...attempt, playlistId: id });
      const known = rememberExportPlaylist(attempt, id);
      setRecovery(known);
      // Sauver tout de suite le lien, sans fausse signature : si un ajout
      // échoue, la playlist créée reste accessible et peut être complétée.
      let current = getStoredBlends().find((b) => b.id === blend.id);
      if (!current) throw new Error('Le blend a été supprimé pendant l’export. La playlist YouTube est conservée.');
      if (current.exportedPlaylistId && current.exportedPlaylistId !== id) throw new Error('Ce blend est déjà associé à une autre playlist. Vérifie les deux playlists.');
      updateBlend({ ...current, exportedPlaylistId: id, exportedUrl: url, exportedMeta: {
        sig: '', title: nom, privacy: priv ? 'private' : 'public', at: new Date().toISOString(),
      } });
      try { clearExportAttempt(known); } catch { /* le lien est déjà enregistré dans le blend */ }
      setRecovery(null);
      await youtubeService.addTracksToPlaylist(id, blend.tracks);
      assertAccountRevision(revision);
      const items = await youtubeService.getPlaylistItems(id);
      assertAccountRevision(revision);
      const ids = [...new Set(blend.tracks.map((t) => t.videoId))];
      if (JSON.stringify(items.map((x) => x.videoId)) !== JSON.stringify(ids)) {
        throw new Error('YouTube n’a pas confirmé le contenu et l’ordre. Vérifie la playlist puis utilise « Mettre à jour ».');
      }
      const meta = await youtubeService.getPlaylistMeta(id);
      assertAccountRevision(revision);
      if (meta.title.trim() !== nom.trim() || meta.privacy !== (priv ? 'private' : 'public')) {
        throw new Error('YouTube n’a pas confirmé le titre ou la visibilité de la playlist. Vérifie puis réessaie.');
      }
      current = getStoredBlends().find((b) => b.id === blend.id);
      if (!current) throw new Error('Le blend a été supprimé pendant l’export. La playlist YouTube est conservée.');
      updateBlend({ ...current, exportedPlaylistId: id, exportedUrl: url, exportedMeta: {
        sig: `${nom.trim()}|${priv ? 'private' : 'public'}|${ids.join(',')}`,
        title: nom, privacy: priv ? 'private' : 'public', at: new Date().toISOString(),
      } });
      confetti({ particleCount: 110, spread: 75, origin: { y: 0.62 }, colors: ['#7b61ff', '#0a84ff', '#f0568c'] });
      showToast('Playlist créée et contenu vérifié sur YouTube Music.');
    } catch (e: any) {
      if (revision === accountRevision()) {
        const msg = created ? `Playlist créée, mais export incomplet ou lien non enregistré. ${e?.message || 'Vérifie la playlist avant de réessayer.'}`
          : started ? `Création non confirmée : YouTube a peut-être créé la playlist. Vérifie ta bibliothèque avant tout nouvel export. ${e?.message || ''}`
            : (e?.message || 'Export impossible. Vérifie ta bibliothèque avant de recommencer.');
        setExportWarning(msg); showToast(msg);
      }
    } finally { if (revision === accountRevision()) setExporting(false); }
  };

  return (
    <div className="ytm-page">
      {/* retour */}
      <button className="sb-back" onClick={() => setView('library')}>
        <ArrowLeft size={17} strokeWidth={2} /> Bibliothèque
      </button>

      {/* ─────────── en-tête du blend ─────────── */}
      <motion.header
        className="sb-blend-head"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sb-mosaic">
          {blend.tracks.slice(0, 4).map((t) => (
            <Art key={t.id} track={t} size="100%" radius={0} />
          ))}
        </div>

        <div className="sb-blend-info">
          <div className="sb-eyebrow">Blend · {stats.minutes} min</div>

          {editing ? (
            <div className="sb-rename">
              <input
                className="field"
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
              />
              <button className="btn btn-sm" onClick={saveTitle}><Check size={15} /> OK</button>
            </div>
          ) : (
            <h1>
              {blend.title}
              <button className="sb-title-edit" onClick={() => { setTitle(blend.title); setEditing(true); }} aria-label="Renommer">
                <Pencil size={15} strokeWidth={1.9} />
              </button>
            </h1>
          )}

          {/* les mêmes mots que dans l'écran de composition et dans les
              étiquettes des morceaux — plus de « anchor / deep dives » en
              anglais au milieu d'une interface française */}
          <p className="sb-blend-counts">
            {stats.anchor} {stats.anchor > 1 ? 'piliers' : 'pilier'} · {stats.deep} {stats.deep > 1 ? 'faces cachées' : 'face cachée'} · {stats.fresh} {stats.fresh > 1 ? 'découvertes' : 'découverte'}
          </p>

          {/* D'où vient ce blend ? La question se pose à chaque écoute, et
              la réponse ne doit pas demander d'ouvrir la console : le
              modèle a composé, ou bien c'est le voisinage YouTube — deux
              choses très différentes, dites avec deux icônes. */}
          {blend.methode && (
            <p className="sb-blend-origin" data-kind={blend.methode.kind}>
              {blend.methode.kind === 'gemini' ? <Cpu size={13} strokeWidth={1.9} /> : <Compass size={13} strokeWidth={1.9} />}
              <span>
                <b>{blend.methode.kind === 'gemini' ? 'Composé avec Gemini'
                  : blend.methode.kind === 'mixte' ? 'Gemini et voisinage YouTube'
                    : stats.deep + stats.fresh === 0 ? 'Piliers disponibles' : 'Composé par voisinage YouTube'}</b>
                {blend.methode.model && <span className="sb-blend-origin-model"> {blend.methode.model}</span>}
                {' — '}{blend.methode.detail || 'Origine de la sélection enregistrée lors de la génération.'}
              </span>
            </p>
          )}
          {blend.generation?.warning && (
            <div className="sb-blend-warning" role="status">
              <TriangleAlert size={16} strokeWidth={1.8} aria-hidden />
              <div>
                <strong>{blend.generation.created.anchor + blend.generation.created.deepDive + blend.generation.created.fresh < blend.generation.target
                  ? 'Blend incomplet' : 'Génération adaptée'}</strong>
                <p>{blend.generation.warning}</p>
                <small>Bilan à la création du blend ; tes modifications ultérieures ne sont pas incluses.</small>
              </div>
            </div>
          )}

          <div className="sb-blend-buttons">
            <button
              className="btn"
              onClick={() => blend.tracks[0] && playTrack(blend.tracks[0], blend.tracks)}
            >
              <Play size={15} fill="currentColor" /> Écouter
            </button>

            {exported ? (
              <>
                <a className="btn btn-tonal" href={exported} target="_blank" rel="noreferrer">
                  {blend.exportedPlaylistId && blend.exportedMeta?.sig === signature ? <Check size={15} /> : <ExternalLink size={15} />} YouTube Music
                </a>
                {(canSync && (outOfSync || updating)) && (
                  <button
                    className="btn btn-tonal sb-sync-btn"
                    data-stale="true"
                    onClick={updateOnYT}
                    disabled={updating || exporting}
                    title="Le blend a changé depuis l’export : remettre la playlist YouTube Music à jour"
                  >
                    <RefreshCw size={15} className={updating ? 'anim-spin' : ''} />
                    {updating ? 'Mise à jour…' : 'Mettre à jour'}
                    {!updating && <span className="sb-sync-dot" aria-hidden />}
                  </button>
                )}
              </>
            ) : !recovery || exporting ? (
              <button className="btn btn-tonal" onClick={exportToYT} disabled={exporting}>
                {exporting ? <RefreshCw size={15} className="anim-spin" /> : <Share2 size={15} />}
                {exporting ? 'Export…' : 'Exporter'}
              </button>
            ) : null}

            <button className="chip" disabled={exporting || updating} onClick={() => setPriv((v) => !v)} title="Visibilité de la playlist exportée">
              {priv ? <Lock size={13} strokeWidth={2} /> : <Globe size={13} strokeWidth={2} />}
              {priv ? 'Privée' : 'Publique'}
            </button>

            <button className="chip sb-hide-sm" onClick={() => { setTitle(blend.title); setEditing(true); }}>
              <Pencil size={13} strokeWidth={2} /> Renommer
            </button>
          </div>
          {exportWarning && <p className="sb-action-error" role="alert">{exportWarning}</p>}
          {recovery && !blend.exportedPlaylistId && !exporting && (
            <div className="sb-export-recovery">
              {recovery.playlistId ? (
                <>
                  <p>La playlist existe, mais son lien n’est pas enregistré dans ce blend. Conserve le lien YouTube ci-dessus, libère de l’espace dans le navigateur, puis réessaie. Si tu fermes cet onglet et perds le lien, retrouve la playlist dans YouTube pour l’associer sans en créer une seconde.</p>
                  <button className="btn btn-tonal btn-sm" onClick={saveRecoveredLink} disabled={updating}>Réessayer d’enregistrer le lien</button>
                </>
              ) : (
                <>
                  <p>Une création précédente n’a pas été confirmée ; elle peut encore être en cours dans un autre onglet. Attends sa fin et vérifie ta bibliothèque YouTube. Si la playlist existe, colle son lien ici : la prochaine mise à jour modifiera cette playlist, choisis donc la bonne.</p>
                  <label htmlFor="sb-recovery-playlist">Lien ou identifiant de la playlist créée</label>
                  <input id="sb-recovery-playlist" className="field" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} placeholder="https://music.youtube.com/playlist?list=…" />
                  <div className="sb-blend-buttons">
                    <button className="btn btn-tonal btn-sm" onClick={saveRecoveredLink} disabled={updating}>Associer ce lien</button>
                    <button className="btn btn-sm" onClick={forgetUnknownAttempt} disabled={updating}>J’ai vérifié : aucune playlist créée</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </motion.header>

      {/* ─────────── liste des titres ─────────── */}
      <div className="sb-list sb-list--roomy">
        {blend.tracks.map((t, i) => {
          const playing = currentTrack?.id === t.id && isPlaying;
          const cat = t.category ? CAT[t.category] : null;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.012, 0.18), duration: 0.26 }}
              className="sb-track-row"
              data-playing={currentTrack?.id === t.id ? '1' : '0'}
            >
              <span className="sb-track-index">{String(i + 1).padStart(2, '0')}</span>

              <button
                className="sb-track-art"
                onClick={() => playTrack(t, blend.tracks)}
                aria-label={`Lire ${t.title}`}
              >
                <Art track={t} size="100%" radius={0} />
                <span className="sb-track-play">
                  {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                </span>
              </button>

              <button className="sb-track-meta" onClick={() => playTrack(t, blend.tracks)}>
                <span className="sb-row-title">
                  {/* le titre se tronque, l'étiquette reste entière :
                      deux morceaux dans une même ligne, le premier seul
                      accepte de rétrécir. Avant, l'étiquette était poussée
                      hors du cadre et disparaissait. */}
                  <span className="sb-row-titletext">{t.title}</span>
                  {cat && <span className="sb-cat" data-cat={t.category}>{cat.label}</span>}
                </span>
                <span className="sb-row-sub">
                  {t.artist}{t.rationale ? ` — ${t.rationale}` : ''}
                </span>
              </button>

              <div className="sb-track-actions">
                <BlockButton track={t} size={15} />
                <button
                  className="icon-btn"
                  onClick={() => replace(t)}
                  title={queue?.jobFor(blend.id, t.id) ? 'Remplacement en cours…' : 'Remplacer'}
                  aria-label="Remplacer"
                  aria-busy={!!queue?.jobFor(blend.id, t.id)}
                >
                  <RefreshCw
                    size={15}
                    strokeWidth={1.9}
                    className={queue?.jobFor(blend.id, t.id) ? 'anim-spin' : ''}
                  />
                </button>
                <button className="icon-btn" onClick={() => remove(t.id)} title="Retirer" aria-label="Retirer">
                  <Trash2 size={15} strokeWidth={1.9} />
                </button>
                <span className="sb-reorder sb-hide-sm">
                  <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Monter"><ChevronUp size={15} /></button>
                  <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Descendre"><ChevronDown size={15} /></button>
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <p className="sb-footnote">
        <Sparkles size={13} strokeWidth={1.8} /> {blend.tracks.length} titres · {stats.minutes} min ·
        blend conservé 14 jours sur cet appareil.
      </p>
    </div>
  );
};
