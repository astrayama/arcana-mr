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

/** A grab that ends this quickly without moving much counts as a tap on the object. */
export const GRAB_TAP = { maxSeconds: 0.35, maxMeters: 0.02 } as const;

export function isGrabTap(seconds: number, meters: number): boolean {
  return seconds <= GRAB_TAP.maxSeconds && meters <= GRAB_TAP.maxMeters;
}
