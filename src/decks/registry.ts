/**
 * Deck discovery. Every folder under `src/decks/` with a `deck.json` is a deck;
 * adding one needs no code changes. Images are bundled as URLs only, so a face
 * is fetched the first time a reading draws it.
 */

import { createRegistry, type RegistryItem } from '../lib/registry.js';
import type { DeckManifest } from './deck.schema.js';

const manifests = import.meta.glob<DeckManifest>('./*/deck.json', {
  eager: true,
  import: 'default',
});

const imageUrls = import.meta.glob<string>('./*/**/*.{webp,png,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface ResolvedDeck extends RegistryItem {
  manifest: DeckManifest;
  /** Bundled URL for the card back, or null if the file is missing. */
  backUrl: string | null;
  /** Bundled URL for a card's face, or null if this deck has none for it. */
  faceUrl(cardId: string): string | null;
}

const folderOf = (manifestPath: string) => manifestPath.split('/')[1];

function resolveImage(deckId: string, relativePath: string): string | null {
  const key = `./${deckId}/${relativePath.replace(/^\.\//, '')}`;
  return imageUrls[key] ?? null;
}

/**
 * Built-in decks, plus any added while the app runs. Decks added on the
 * headset later register here with a "device:" id and blob URLs for their
 * images, so the rest of the app treats every deck the same way.
 */
export const deckRegistry = createRegistry<ResolvedDeck>(
  Object.entries(manifests).map(([path, manifest]) => {
    const id = folderOf(path);
    return {
      id,
      origin: 'builtin' as const,
      manifest,
      backUrl: resolveImage(id, manifest.back),
      faceUrl: (cardId: string) => {
        const face = manifest.faces[cardId];
        return face ? resolveImage(id, face) : null;
      },
    };
  }),
);

export function listDeckIds(): string[] {
  return deckRegistry
    .list()
    .map((deck) => deck.id)
    .sort();
}

export function getDeck(id: string): ResolvedDeck | undefined {
  return deckRegistry.get(id);
}
