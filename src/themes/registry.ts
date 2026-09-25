/**
 * Theme discovery. Every folder under `src/themes/` with a `theme.json` is a
 * theme; adding one needs no code changes. Asset paths in the theme are turned
 * into bundled URLs here so the rest of the app never deals with folders.
 */

import type { Theme } from './theme.schema.js';

const themes = import.meta.glob<Theme>('./*/theme.json', {
  eager: true,
  import: 'default',
});

const assetUrls = import.meta.glob<string>('./*/**/*.{webp,png,jpg,jpeg,ttf,otf}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface ResolvedTheme {
  theme: Theme;
  /** Bundled, absolute URL for a theme-relative asset path, or null if missing. */
  assetUrl(relativePath: string | null): string | null;
}

const resolved = new Map<string, ResolvedTheme>(
  Object.entries(themes).map(([path, theme]) => {
    const id = path.split('/')[1];
    return [
      id,
      {
        theme,
        assetUrl: (relativePath) => {
          if (!relativePath) return null;
          const url = assetUrls[`./${id}/${relativePath.replace(/^\.\//, '')}`];
          return url ? new URL(url, document.baseURI).href : null;
        },
      },
    ];
  }),
);

export function listThemeIds(): string[] {
  return [...resolved.keys()].sort();
}

export function getTheme(id: string): ResolvedTheme | undefined {
  return resolved.get(id);
}
