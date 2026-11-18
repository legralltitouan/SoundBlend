/** Google fournit un fragment HTML/CSS à afficher tel quel avec un résultat
    Search. Il ne doit ni exécuter de script ni modifier l'application. Plutôt
    que de le réécrire (ce qui altérerait les suggestions), on le refuse en
    entier si sa forme sort d'une liste de sécurité. Il sera ensuite inséré
    sans changement dans un Shadow DOM, pas dans une iframe. */
export function parseGoogleSuggestions(html: unknown): DocumentFragment | null {
  if (typeof html !== 'string' || !html.trim() || html.length > 100000 || typeof document === 'undefined') return null;
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowedTags = new Set(['style', 'div', 'span', 'a', 'svg', 'g', 'path', 'circle', 'rect', 'polygon', 'polyline', 'line', 'ellipse', 'br']);
  const allowedAttrs = new Set(['class', 'width', 'height', 'viewbox', 'fill', 'xmlns', 'd', 'fill-rule', 'clip-rule',
    'cx', 'cy', 'r', 'x', 'y', 'rx', 'ry', 'points', 'x1', 'x2', 'y1', 'y2', 'stroke', 'stroke-width',
    'href', 'target', 'rel', 'role', 'aria-label', 'aria-hidden', 'title']);
  let links = 0;
  for (const node of Array.from(template.content.querySelectorAll('*'))) {
    const tag = node.localName.toLowerCase();
    if (!allowedTags.has(tag)) return null;
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name) || name.startsWith('on') || attr.value.length > 8000) return null;
      if (name === 'xmlns' && attr.value !== 'http://www.w3.org/2000/svg') return null;
      if (name === 'target' && !['_self', '_blank'].includes(attr.value.toLowerCase())) return null;
      if ((name === 'fill' || name === 'stroke') && /url\s*\(|https?:|data:|\\/i.test(attr.value)) return null;
      if (name === 'href') {
        if (tag !== 'a') return null;
        try {
          const url = new URL(attr.value);
          const googleSearch = (url.hostname === 'google.com' || url.hostname === 'www.google.com') && url.pathname === '/search';
          const googleRedirect = url.hostname === 'vertexaisearch.cloud.google.com' && url.pathname.startsWith('/grounding-api-redirect/');
          if (url.protocol !== 'https:' || url.username || url.password || url.port || !(googleSearch || googleRedirect)) return null;
          links++;
        } catch { return null; }
      }
    }
    if (tag === 'a' && !node.hasAttribute('href')) return null;
    if (tag === 'style') {
      const css = node.textContent || '';
      // Pas de requête extérieure, d'échappement CSS, d'overlay global ou de
      // règle visant l'hôte. Les sélecteurs du widget restent dans le shadow.
      if (css.length > 30000 || /\\|(?:url|image|image-set|-webkit-image-set|src|element|paint|cross-fade|expression)\s*\(|javascript:|behavior\s*:|-moz-binding|:host|::slotted|position\s*:\s*(fixed|sticky)/i.test(css)
        || css.replace(/@media\b/gi, '').includes('@')) return null;
    }
  }
  return links > 0 ? template.content : null;
}

export function isSafeGoogleSuggestions(html: unknown): html is string {
  return !!parseGoogleSuggestions(html);
}
