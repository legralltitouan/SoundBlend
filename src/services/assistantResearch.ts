import { accountRevision, assertAccountRevision } from './accountScope';
import type { AssistantResearch } from './gemini';

/** Recherche encyclopédique explicite, directe et sans cache local.
    Wikipédia ne représente pas tout le Web et les extraits ne prouvent pas
    chaque phrase générée. Les pages sont présentées avec leur attribution. */
export async function searchEncyclopedia(query: string, signal?: AbortSignal): Promise<AssistantResearch> {
  const revision = accountRevision();
  const subject = query.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (subject.length < 2) throw new Error('Précise le sujet de la recherche.');
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: subject,
    gsrnamespace: '0', gsrlimit: '4', prop: 'extracts|info', exintro: '1', explaintext: '1',
    exsentences: '2', inprop: 'url', format: 'json', origin: '*', maxlag: '5' });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://fr.wikipedia.org/w/api.php?${params}`, {
      signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Wikipédia a refusé la recherche (HTTP ${response.status}).`);
    const data = await response.json();
    assertAccountRevision(revision);
    if (data?.error) throw new Error('La recherche Wikipédia est temporairement indisponible.');
    const pages = Object.values(data?.query?.pages || {}) as any[];
    const sources = pages.sort((a, b) => Number(a?.index || 999) - Number(b?.index || 999)).flatMap((page) => {
      const id = Number(page?.pageid);
      if (!Number.isSafeInteger(id) || id <= 0 || typeof page?.title !== 'string') return [];
      return [{ title: page.title.slice(0, 250), url: `https://fr.wikipedia.org/?curid=${id}`,
        extract: typeof page.extract === 'string' ? page.extract.slice(0, 1000) : '' }];
    }).slice(0, 4);
    return { query: subject, sources };
  } catch (e: any) {
    assertAccountRevision(revision);
    if (e?.name === 'AbortError') throw new Error(signal?.aborted ? 'Recherche interrompue.' : 'La recherche Wikipédia a dépassé le délai. Réessaie.');
    throw e instanceof Error ? e : new Error('Recherche Wikipédia indisponible.');
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
  }
}
