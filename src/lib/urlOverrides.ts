/**
 * Testing overrides from the page URL, e.g. `?deck=rws-1909&theme=dark-gold`.
 * Unknown values fall back to the default with a console warning, so a typo
 * never leaves the app without a deck or theme.
 */

export interface PickedId {
  id: string;
  /** The raw value from the URL, if one was given. */
  requested: string | null;
  /** True when the URL asked for something that doesn't exist. */
  fellBack: boolean;
}

export function pickFromUrl(
  search: string,
  param: string,
  available: readonly string[],
  fallback: string,
): PickedId {
  const requested = new URLSearchParams(search).get(param)?.trim() || null;
  if (requested === null) {
    return { id: fallback, requested, fellBack: false };
  }
  if (available.includes(requested)) {
    return { id: requested, requested, fellBack: false };
  }
  console.warn(
    `[arcana] ?${param}=${requested} is not available (have: ${available.join(', ') || 'none'}). Using "${fallback}".`,
  );
  return { id: fallback, requested, fellBack: true };
}
