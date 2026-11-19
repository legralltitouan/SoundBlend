import type { Track } from '../types';

/** Les transcriptions Live arrivent selon le modèle en deltas ou cumulées. */
export function mergeLiveTranscript(previous: string, next: string): string {
  if (!next || previous.endsWith(next)) return previous;
  if (!previous || next.startsWith(previous)) return next;
  // Une frontière de fragments peut partager plusieurs caractères.
  for (let n = Math.min(previous.length, next.length); n >= 3; n--) {
    if (previous.endsWith(next.slice(0, n))) return previous + next.slice(n);
  }
  return previous + next;
}

/** La dernière correction ne doit jamais disparaître lors d'une troncature. */
export function blendInstruction(summary: string, requests: string[]): string {
  const recent = requests.slice(-10).join('\n').slice(-4000);
  return `Direction musicale (actualisée) :\n${summary.trim().slice(0, 1800)}\n\nDemandes récentes de l’auditeur (la dernière prévaut en cas de correction) :\n${recent}`.slice(0, 6000);
}

export function uniqueAssistantTracks(tracks: Track[], excluded: (track: Track) => boolean): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => {
    if (!track.videoId || seen.has(track.videoId) || excluded(track)) return false;
    seen.add(track.videoId); return true;
  });
}
