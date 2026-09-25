/** Where things sit on the mat, in mat-local meters (reader on the +Z side). */

import { config } from '../config.js';
import { spreads, type SpreadId } from '../data/spreads.js';

/** X/Z of a spread slot on the mat. Slots run left to right from the reader's view. */
export function slotPosition(spread: SpreadId, slot: number): { x: number; z: number } {
  const count = spreads[spread].positions.length;
  const step = config.card.widthM + config.layout.cardGapM;
  return { x: (slot - (count - 1) / 2) * step, z: config.layout.spreadRowZ };
}

export function deckPosition(): { x: number; z: number } {
  return { x: 0, z: config.layout.deckZ };
}
