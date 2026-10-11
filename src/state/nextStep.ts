/**
 * What one press of Next does in a "Press Next" room: the reading moves one
 * small step at a time. Shuffle first; then lay a card face down, turn it
 * face up, lay the next one down, and so on. If the reader drew cards by
 * hand, Next turns those over in spread order before drawing more.
 * Pure, so the host and the tests share it.
 */

import type { ReadingSnapshot } from './readingMachine.js';

export type NextStep = { type: 'SHUFFLE' } | { type: 'DRAW' } | { type: 'TURN'; slot: number };

export function nextStep(snapshot: ReadingSnapshot): NextStep | null {
  switch (snapshot.state) {
    case 'READY':
      return { type: 'SHUFFLE' };
    case 'DRAWING':
    case 'AWAITING_FLIPS': {
      const down = snapshot.slots.find((slot) => slot.cardId !== null && !slot.faceUp);
      if (down) return { type: 'TURN', slot: down.slot };
      return snapshot.state === 'DRAWING' ? { type: 'DRAW' } : null;
    }
    default:
      return null;
  }
}

/** Words for what Next will do, for the screens that offer it. */
export function describeNextStep(snapshot: ReadingSnapshot): string {
  const step = nextStep(snapshot);
  if (!step) {
    if (snapshot.state === 'REVEALED') return 'Every card is turned over.';
    if (snapshot.state === 'SHUFFLING') return 'Shuffling...';
    return 'Waiting for your reader to choose a spread.';
  }
  if (step.type === 'SHUFFLE') return 'Next: shuffle the deck';
  if (step.type === 'TURN') return `Next: turn over the ${snapshot.slots[step.slot]?.label ?? 'next'} card`;
  const open = snapshot.slots.find((slot) => slot.cardId === null);
  return `Next: lay down the ${open?.label ?? 'next'} card`;
}
