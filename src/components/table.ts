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

/**
 * An invisible near-grab target on the table (deck or card). Kept as a sibling
 * of the thing it moves, because IWSDK grabbables stop rays reaching anything
 * beneath them in the scene graph.
 */
export const TableHandle = createComponent(
  'TableHandle',
  {
    /** "deck" or "card". */
    kind: { type: Types.String, default: 'card' },
    /** For cards, the table card's key. */
    key: { type: Types.Int32, default: -1 },
  },
  'Near-grab target for the deck or a card',
);

/** An empty spot in the spread that can be tapped to draw a card into it. */
export const SlotMarker = createComponent(
  'SlotMarker',
  { slot: { type: Types.Int8, default: 0 } },
  'An open spot in the spread',
);

/** The card waiting beside the deck to be drawn next. */
export const OfferedCard = createComponent('OfferedCard', {}, 'The next card to draw');
