import { createComponent, Types } from '@iwsdk/core';

/** A dealt card on the mat. Visuals and animation live in systems. */
export const TarotCard = createComponent(
  'TarotCard',
  {
    /** Position in the spread (0-based). */
    slot: { type: Types.Int8, default: 0 },
    cardId: { type: Types.String, default: '' },
    reversed: { type: Types.Boolean, default: false },
    faceUp: { type: Types.Boolean, default: false },
  },
  'A dealt tarot card',
);

/**
 * An invisible box around a face-down card that near grabs land on. IWSDK's
 * grabbables ignore rays, so grabbing lives on this proxy while the card
 * itself keeps taking rays and pokes.
 */
export const CardGrabProxy = createComponent(
  'CardGrabProxy',
  {
    slot: { type: Types.Int8, default: 0 },
  },
  'Near-grab target for a face-down card',
);
