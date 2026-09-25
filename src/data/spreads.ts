/** The readings offered in v1 and the labeled positions each one deals into. */

export type SpreadId = 'single' | 'three';

export interface SpreadPosition {
  /** Shown on the meaning panel. Null for a single-card pull. */
  label: string | null;
}

export interface Spread {
  id: SpreadId;
  name: string;
  positions: readonly SpreadPosition[];
}

export const spreads: Record<SpreadId, Spread> = {
  single: {
    id: 'single',
    name: 'Single Card',
    positions: [{ label: null }],
  },
  three: {
    id: 'three',
    name: '3-Card Spread',
    positions: [{ label: 'Past' }, { label: 'Present' }, { label: 'Future' }],
  },
};
