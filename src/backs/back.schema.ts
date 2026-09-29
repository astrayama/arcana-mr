/**
 * A card back design: one image, used on every card and the deck. Backs are
 * their own folders (src/backs/<id>/back.json + back.webp), separate from
 * decks, so any back can go with any deck. Pure, for scripts and tests.
 */

export interface BackManifest {
  id: string;
  name: string;
  /** One line shown in Settings. */
  description: string;
  /** License of the image, e.g. "Same license as the code (MIT)". */
  license: string;
  /** Who made it, or how it was made. */
  source: string;
  /** Width / height of the image. Backs are cropped to fill each deck's cards. */
  aspectRatio: number;
  /** Sort order in Settings. */
  order?: number;
}

export function validateBackManifest(data: unknown, folderId: string, fileExists: (path: string) => boolean): string[] {
  const errors: string[] = [];
  const where = `backs/${folderId}`;
  if (typeof data !== 'object' || data === null) return [`${where}: back.json is not an object`];
  const d = data as Record<string, unknown>;
  for (const key of ['id', 'name', 'description', 'license', 'source'] as const) {
    if (typeof d[key] !== 'string' || !(d[key] as string).trim()) errors.push(`${where}.${key}: missing`);
  }
  if (d.id !== folderId) errors.push(`${where}.id: must match the folder name`);
  if (typeof d.aspectRatio !== 'number' || d.aspectRatio < 0.3 || d.aspectRatio > 1) {
    errors.push(`${where}.aspectRatio: between 0.3 and 1`);
  }
  if (!fileExists('back.webp')) errors.push(`${where}: back.webp is missing`);
  return errors;
}
