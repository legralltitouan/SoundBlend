/** Réponses longues de l'Assistant : aucune durée totale maximale.
 * Le délai protège uniquement contre une connexion sans aucune donnée réseau.
 * Les autres usages Gemini gardent leurs politiques existantes. */
const NETWORK_IDLE_MS = 180000;
const MAX_TEXT = 2000000;
export async function requestAssistantText(model: string, url: string, init: RequestInit, signal: AbortSignal, onProgress?: (stage: string) => void): Promise<string> {
  const controller = new AbortController();
  let stalled = false, timer: ReturnType<typeof setTimeout> | undefined;
  const activity = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort(); }, NETWORK_IDLE_MS); };
  const cancel = () => controller.abort();
  if (signal.aborted) controller.abort(); else signal.addEventListener('abort', cancel, { once: true });
  activity();
  try {
    onProgress?.('Envoi de la demande et du contexte musical à Gemini…');
    const response = await fetch(url, { ...init, signal: controller.signal }); activity();
    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(new Error(`${model} ${response.status}`), { status: response.status, detail, model });
    }
    onProgress?.('Connexion établie. Réception de la réponse Gemini…');
    let text = '', finish = '', announcedText = false;
    const accept = (value: any) => {
      if (value?.error) throw Object.assign(new Error(`${model} : erreur Gemini`), { status: value.error.code, detail: String(value.error.message || ''), model });
      const candidate = value?.candidates?.[0];
      if (candidate?.finishReason) finish = candidate.finishReason;
      // Ne pas exposer ni mélanger le raisonnement interne au JSON de réponse.
      for (const part of candidate?.content?.parts || []) if (typeof part?.text === 'string' && !part.thought) { text += part.text; if (!announcedText && text.trim()) { announcedText = true; onProgress?.('Réception de la réponse. Validation de l’aperçu à la fin du flux…'); } }
      if (text.length > MAX_TEXT) throw new Error('Réponse Gemini trop volumineuse.');
    };
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      // JSON accepté pour les intermédiaires renvoyant une réponse non découpée.
      accept(await response.json());
    } else {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Flux Gemini indisponible.');
      const decoder = new TextDecoder(); let pending = '', eventData: string[] = [];
      const dispatch = () => {
        const data = eventData.join('\n').trim(); eventData = [];
        if (data && data !== '[DONE]') accept(JSON.parse(data));
      };
      const line = (value: string) => {
        if (!value) dispatch();
        else if (value.startsWith('data:')) eventData.push(value.slice(5).replace(/^ /, ''));
      };
      const abortReader = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', abortReader, { once: true });
      try {
        while (true) {
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (done) break;
          if (value.length) activity();
          pending += decoder.decode(value, { stream: true });
          if (pending.length > MAX_TEXT) throw new Error('Fragment Gemini trop volumineux.');
          let end: number;
          while ((end = pending.indexOf('\n')) >= 0) { line(pending.slice(0, end).replace(/\r$/, '')); pending = pending.slice(end + 1); }
        }
        pending += decoder.decode(); if (pending) line(pending.replace(/\r$/, '')); dispatch();
      } finally { controller.signal.removeEventListener('abort', abortReader); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!text.trim()) throw Object.assign(new Error(`${model} : réponse sans texte${finish ? ` (${finish})` : ''}`), { status: 200, model, illisible: true });
    return text.trim();
  } catch (error) {
    if (stalled && !signal.aborted) throw new Error('La connexion Gemini n’a transmis aucune donnée pendant 3 minutes. Vérifie le réseau puis réessaie.');
    throw error;
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', cancel); }
}
