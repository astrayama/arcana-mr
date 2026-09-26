import { createComponent, Types } from '@iwsdk/core';

/** The cloth the reading happens on. Its transform is the table anchor for everything else. */
export const ReadingMat = createComponent('ReadingMat', {}, 'The reading mat on the table');

/** The face-down deck the reading is drawn from. */
export const DeckPile = createComponent('DeckPile', {}, 'The face-down deck pile');

/**
 * Invisible grab targets over the mat while it is being placed. There are two
 * because IWSDK gives each entity one grab style: `near` for reaching out and
 * grabbing, `ray` for pointing and dragging from a distance.
 */
export const MatHandle = createComponent(
  'MatHandle',
  { kind: { type: Types.String, default: 'near' } },
  'Grab target for moving the reading mat',
);
