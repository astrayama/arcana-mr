/**
 * Tunable defaults for Arcana MR. Everything a designer might want to adjust
 * without reading system code lives here.
 */

export const config = {
  /** Deck and theme used when the URL does not ask for another one. */
  defaults: {
    deck: 'rws-1909',
    theme: 'dark-gold',
  },

  /** Query-string names for testing overrides, e.g. `?deck=rws-1909&theme=dark-gold`. */
  urlParams: {
    deck: 'deck',
    theme: 'theme',
  },

  reading: {
    /** Chance (0 to 1) that each drawn card lands reversed. */
    reversalChance: 0.5,
  },

  card: {
    /**
     * Card width in meters. A physical RWS card is about 70 mm wide; this is
     * 1.25x that so the art reads well in the headset. Height comes from the
     * active deck's aspect ratio.
     */
    widthM: 0.0875,
    /** Card thickness in meters, just enough to catch the light on edges. */
    thicknessM: 0.0012,
  },

  /**
   * Table layout in mat-local meters. The reader sits on the +Z side, so
   * negative Z is the far edge of the mat.
   */
  layout: {
    matWidthM: 0.56,
    matDepthM: 0.42,
    /** Gap between cards in the 3-card row. */
    cardGapM: 0.03,
    /** Z of the row where readings are dealt (near the reader). */
    spreadRowZ: 0.09,
    /** Z of the deck pile (far side of the mat). */
    deckZ: -0.1,
    /** How far the mat sits above the detected surface, to avoid flicker. */
    surfaceOffsetM: 0.002,
  },

  placement: {
    /**
     * Where the reading mat goes when no table is found, relative to the
     * viewer's head: this far below eye level and this far in front.
     */
    fallback: {
      belowEyeM: 0.45,
      forwardM: 0.5,
    },
    /** Horizontal planes between these heights (meters above the floor) count as table candidates. */
    tableHeightRangeM: [0.35, 1.2] as const,
    /** Smallest plane edge (meters) that can hold the mat. */
    minTableEdgeM: 0.3,
  },
} as const;

export type AppConfig = typeof config;
