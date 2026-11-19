import React from 'react';
import { mentionToken, type AssistantMention } from '../../services/assistantMentions';

/** Décoration pure : le textarea natif reste l’unique contrôle éditable.
 * Pas de contenteditable, de HTML collé ni de dépendance d’éditeur riche.
 * Aucun padding/bordure ne doit modifier la métrique des tokens. */
export function promptWithTags(text: string, mentions: AssistantMention[]): React.ReactNode[] {
  const tokens = [...new Set(mentions.map(mentionToken))].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!tokens.length) return [text];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let at = -1, match = '';
    for (const token of tokens) {
      const index = text.indexOf(token, cursor);
      if (index >= 0 && (at < 0 || index < at)) { at = index; match = token; }
    }
    if (at < 0) { nodes.push(text.slice(cursor)); break; }
    if (at > cursor) nodes.push(text.slice(cursor, at));
    nodes.push(<span key={`${at}:${match}`} className={`sa-inline-tag ${match.startsWith('@') ? 'is-artist' : 'is-track'}`}>{match}</span>);
    cursor = at + match.length;
  }
  return nodes;
}
