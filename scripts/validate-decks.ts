/**
 * Validates every deck under src/decks/. The default deck must cover all 78
 * cards; other decks may be works in progress (missing faces are warnings).
 * All images in a deck must share one size that matches its aspectRatio.
 *
 *   npm run validate:decks
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.ts';
import type { CardData } from '../src/data/cards.schema.ts';
import { validateDeckManifest, type DeckManifest } from '../src/decks/deck.schema.ts';

const root = join(import.meta.dirname, '..');
const decksDir = join(root, 'src/decks');
const cards = JSON.parse(readFileSync(join(root, 'src/data/cards.json'), 'utf8')) as CardData[];
const cardIds = cards.map((c) => c.id);
const MAX_IMAGE_KB = 400;

let failed = false;
const deckIds = readdirSync(decksDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(decksDir, e.name, 'deck.json')))
  .map((e) => e.name);

if (!deckIds.includes(config.defaults.deck)) {
  console.error(`✗ default deck "${config.defaults.deck}" not found in src/decks/`);
  failed = true;
}

for (const id of deckIds) {
  const dir = join(decksDir, id);
  const manifest = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8')) as DeckManifest;
  const isDefault = id === config.defaults.deck;
  const result = validateDeckManifest(
    manifest,
    id,
    (p) => existsSync(join(dir, p)),
    isDefault ? cardIds : undefined,
  );
  const errors = [...result.errors];
  const warnings: string[] = [];

  if (!isDefault) {
    const missing = cardIds.filter((c) => !(c in (manifest.faces ?? {})));
    if (missing.length > 0) warnings.push(`faces for ${cardIds.length - missing.length} of ${cardIds.length} cards`);
  }

  // Image consistency: one size for every card, matching the declared shape.
  const images = [manifest.back, ...Object.values(manifest.faces ?? {})].filter(
    (p) => typeof p === 'string' && existsSync(join(dir, p)),
  );
  const sizes = new Map<string, string[]>();
  for (const image of images) {
    const path = join(dir, image);
    const { width, height } = await sharp(path).metadata();
    const key = `${width}x${height}`;
    sizes.set(key, [...(sizes.get(key) ?? []), image]);
    const kb = statSync(path).size / 1024;
    if (kb > MAX_IMAGE_KB) warnings.push(`${image} is ${kb.toFixed(0)} KB (aim for under ${MAX_IMAGE_KB})`);
    if (width && height && Math.abs(width / height - manifest.aspectRatio) > 0.02) {
      errors.push(`${image} is ${key}, which doesn't match aspectRatio ${manifest.aspectRatio}`);
    }
  }
  if (sizes.size > 1) {
    errors.push(`images come in ${sizes.size} sizes (${[...sizes.keys()].join(', ')}); use one size per deck`);
  }

  const label = `${id}${isDefault ? ' (default)' : ''}`;
  if (errors.length === 0) {
    console.log(`✓ deck ${label}: ${images.length} images, ${[...sizes.keys()][0] ?? 'no images'}`);
  } else {
    failed = true;
    for (const e of errors) console.error(`✗ deck ${label}: ${e}`);
  }
  for (const w of warnings) console.warn(`! deck ${label}: ${w}`);
}

process.exit(failed ? 1 : 0);
