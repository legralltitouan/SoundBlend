/* Espace local indépendant par identité Google vérifiée.
   Les clés historiques sans préfixe restent l'espace local déconnecté :
   elles ne sont jamais importées automatiquement dans un compte. La portée
   active appartient à cet onglet, non à localStorage partagé entre onglets. */
const PREFIX = 'soundblend_account_v1:';
let account: string | null = null;
let revision = 0;

export const accountScope = (): string | null => account;
export const accountRevision = (): number => revision;
export const assertAccountRevision = (expected: number): void => {
  if (revision !== expected) throw new Error('Le compte a changé pendant cette opération ; recommence avec le compte actuel.');
};
export const scopedStorageKey = (key: string, owner = account): string =>
  owner ? `${PREFIX}${encodeURIComponent(owner)}:${key}` : key;

export const selectAccountScope = (id: string | null): void => {
  const next = id?.trim() || null;
  if (next && (next.length > 128 || !/^[A-Za-z0-9._-]+$/.test(next))) throw new Error('Identité Google invalide.');
  if (next === account) return;
  account = next;
  revision += 1;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sb:account-changed'));
};

export const scopedGetItem = (key: string): string | null => localStorage.getItem(scopedStorageKey(key));
export const scopedSetItem = (key: string, value: string): void => localStorage.setItem(scopedStorageKey(key), value);
export const scopedRemoveItem = (key: string): void => localStorage.removeItem(scopedStorageKey(key));
/** Un événement storage ne concerne ce contexte que si sa portée est active. */
export const belongsToCurrentScope = (key: string | null): boolean => {
  if (!key) return false;
  if (account) return key.startsWith(`${PREFIX}${encodeURIComponent(account)}:`);
  return key.startsWith('soundblend_') && !key.startsWith(PREFIX);
};
