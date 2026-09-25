/**
 * Validates src/data/cards.json against the card spec and checks that the
 * default deck has a face for every card. Exits non-zero on any failure.
 *
 *   npm run validate:cards
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { validateCards } from '../src/data/cards.schema.ts';
import type { DeckManifest } from '../src/decks/deck.schema.ts';

const root = join(import.meta.dirname, '..');
const cardsPath = join(root, 'src/data/cards.json');
const raw = readFileSync(cardsPath, 'utf8');

let data: unknown;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error(`✗ cards.json is not valid JSON: ${(error as Error).message}`);
  process.exit(1);
}

const result = validateCards(data, raw);
const errors = [...result.errors];

// Every card needs a face in the default deck.
const deckDir = join(root, 'src/decks', config.defaults.deck);
const deckPath = join(deckDir, 'deck.json');
if (!existsSync(deckPath)) {
  errors.push(`default deck "${config.defaults.deck}" has no deck.json`);
} else if (Array.isArray(data)) {
  const deck = JSON.parse(readFileSync(deckPath, 'utf8')) as DeckManifest;
  const missing = (data as { id?: string }[])
    .map((card) => card.id)
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => {
      const face = deck.faces?.[id];
      return !face || !existsSync(join(deckDir, face));
    });
  if (missing.length > 0) {
    errors.push(
      `default deck "${config.defaults.deck}" is missing ${missing.length} face image(s)` +
        (missing.length <= 10 ? `: ${missing.join(', ')}` : ''),
    );
  }
}

if (errors.length === 0) {
  console.log(`✓ cards.json: ${(data as unknown[]).length} cards, all rules pass`);
  process.exit(0);
}

// Group the common "not written yet" case so the report stays readable.
const unwritten = errors.filter((e) => /\.(upright|reversed): missing$/.test(e));
const other = errors.filter((e) => !unwritten.includes(e));
if (unwritten.length > 0) {
  const cards = new Set(unwritten.map((e) => e.split('.')[0]));
  console.error(`✗ ${cards.size} card(s) still need meanings`);
}
for (const error of other) {
  console.error(`✗ ${error}`);
}
process.exit(1);
