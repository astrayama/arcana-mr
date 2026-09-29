/**
 * The reader's choices, remembered on this headset: deck, card back, what
 * surrounds the reading, and whether they've seen the introduction. Pure
 * parsing, so it's tested without a browser. Readings themselves are never
 * stored.
 */

import { DEVICE_PREFIX } from '../lib/registry.js';

export const SETTINGS_KEY = 'arcana.settings.v1';

/** "deck" means the deck's own back. */
export const DECK_BACK = 'deck';

export interface Settings {
  v: 1;
  deck: string;
  back: string;
  /** "room" for passthrough, or an environment id. */
  surroundings: string;
  seenIntro: boolean;
}

export interface KnownIds {
  decks: readonly string[];
  backs: readonly string[];
  surroundings: readonly string[];
}

export function defaultSettings(defaultDeck: string): Settings {
  return { v: 1, deck: defaultDeck, back: DECK_BACK, surroundings: 'room', seenIntro: false };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read saved settings, keeping only values that still make sense: an
 * uninstalled deck or back, or a removed environment, falls back to the
 * default rather than breaking the app.
 */
export function parseSettings(raw: unknown, known: KnownIds, defaults: Settings): Settings {
  if (!isObject(raw) || raw.v !== 1) return { ...defaults };
  // Things added on the headset ("device:" ids) load a moment after start-up,
  // so they're kept here and checked once they've loaded.
  const pick = (value: unknown, allowed: readonly string[], fallback: string) =>
    typeof value === 'string' && (allowed.includes(value) || value.startsWith(DEVICE_PREFIX)) ? value : fallback;
  return {
    v: 1,
    deck: pick(raw.deck, known.decks, defaults.deck),
    back: pick(raw.back, [DECK_BACK, ...known.backs], defaults.back),
    surroundings: pick(raw.surroundings, ['room', ...known.surroundings], defaults.surroundings),
    seenIntro: raw.seenIntro === true,
  };
}
