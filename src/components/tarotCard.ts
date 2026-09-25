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
