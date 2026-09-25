import { createComponent } from '@iwsdk/core';

/** The cloth the reading happens on. Its transform is the table anchor for everything else. */
export const ReadingMat = createComponent('ReadingMat', {}, 'The reading mat on the table');

/** The face-down deck the reading is drawn from. */
export const DeckPile = createComponent('DeckPile', {}, 'The face-down deck pile');
