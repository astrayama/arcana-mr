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

/** Where the next card waits after a shuffle: just right of the deck, fanned slightly. */
export function offerPosition(): { x: number; z: number; yaw: number } {
  const deck = deckPosition();
  return { x: deck.x + config.card.widthM + 0.03, z: deck.z + 0.01, yaw: -0.08 };
}

/**
 * The empty slot closest to (x, z) in mat-local meters, or -1 if none is
 * within `maxDistance`. `filled[i]` is true when slot i already has a card.
 */
export function nearestEmptySlot(
  spread: SpreadId,
  filled: readonly boolean[],
  x: number,
  z: number,
  maxDistance = 0.15,
): number {
  let best = -1;
  let bestDistance = maxDistance;
  for (let slot = 0; slot < spreads[spread].positions.length; slot++) {
    if (filled[slot]) continue;
    const at = slotPosition(spread, slot);
    const distance = Math.hypot(at.x - x, at.z - z);
    if (distance <= bestDistance) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/** A grab that ends this quickly without moving much counts as a tap on the object. */
export const GRAB_TAP = { maxSeconds: 0.35, maxMeters: 0.02 } as const;

export function isGrabTap(seconds: number, meters: number): boolean {
  return seconds <= GRAB_TAP.maxSeconds && meters <= GRAB_TAP.maxMeters;
}
