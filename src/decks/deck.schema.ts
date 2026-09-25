/**
 * Deck (art pack) manifest format. A deck is a folder under `src/decks/<id>/`
 * holding a `deck.json` plus its images. Shared by the app loader and
 * `scripts/validate-decks.ts`.
 */

export interface DeckManifest {
  /** Must match the folder name. */
  id: string;
  name: string;
  /** Short license statement, e.g. "Public domain". */
  license: string;
  /** Where the art came from (URL or description). Per-image sources go in CREDITS.md. */
  source: string;
  /** Card width divided by height, e.g. 0.58 for a typical tarot card. */
  aspectRatio: number;
  /** Card back image, relative to the deck folder. */
  back: string;
  /** Card id (from cards.json) to face image, relative to the deck folder. */
  faces: Record<string, string>;
}

export const DECK_IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'] as const;

export interface DeckValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a manifest's shape. `folderId` is the deck's folder name.
 * `fileExists` checks a deck-relative path. `cardIds`, when given, requires a
 * face for every card and no faces for unknown cards.
 */
export function validateDeckManifest(
  data: unknown,
  folderId: string,
  fileExists: (relativePath: string) => boolean,
  cardIds?: readonly string[],
): DeckValidationResult {
  const errors: string[] = [];
  const at = `decks/${folderId}/deck.json`;
  if (typeof data !== 'object' || data === null) {
    return { ok: false, errors: [`${at}: not an object`] };
  }
  const d = data as Record<string, unknown>;

  for (const field of ['id', 'name', 'license', 'source', 'back'] as const) {
    if (typeof d[field] !== 'string' || (d[field] as string).trim() === '') {
      errors.push(`${at}: "${field}" must be a non-empty string`);
    }
  }
  if (d.id !== folderId) {
    errors.push(`${at}: "id" is "${String(d.id)}" but the folder is "${folderId}"`);
  }
  if (typeof d.aspectRatio !== 'number' || !(d.aspectRatio > 0.3 && d.aspectRatio < 1)) {
    errors.push(`${at}: "aspectRatio" must be width/height, between 0.3 and 1`);
  }

  const checkImage = (label: string, path: unknown) => {
    if (typeof path !== 'string') {
      errors.push(`${at}: ${label} path missing`);
      return;
    }
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (!(DECK_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
      errors.push(`${at}: ${label} "${path}" must be ${DECK_IMAGE_EXTENSIONS.join('/')}`);
    } else if (!fileExists(path)) {
      errors.push(`${at}: ${label} "${path}" not found`);
    }
  };

  checkImage('back', d.back);

  if (typeof d.faces !== 'object' || d.faces === null || Array.isArray(d.faces)) {
    errors.push(`${at}: "faces" must be an object mapping card id to image path`);
  } else {
    const faces = d.faces as Record<string, unknown>;
    for (const [cardId, path] of Object.entries(faces)) {
      checkImage(`face "${cardId}"`, path);
    }
    if (cardIds) {
      const known = new Set(cardIds);
      const missing = cardIds.filter((id) => !(id in faces));
      const unknown = Object.keys(faces).filter((id) => !known.has(id));
      if (missing.length > 0) {
        errors.push(`${at}: no face for ${missing.length} card(s): ${missing.join(', ')}`);
      }
      if (unknown.length > 0) {
        errors.push(`${at}: faces for unknown card id(s): ${unknown.join(', ')}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
