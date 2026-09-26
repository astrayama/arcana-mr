import { createComponent, Types } from '@iwsdk/core';

/** Marks an app panel so systems can find it once its document loads. */
export const UiPanel = createComponent(
  'UiPanel',
  {
    /** Which panel this is, e.g. "landing", "menu", "meaning". */
    kind: { type: Types.String, default: '' },
    /** For per-card panels, the spread slot they belong to. */
    slot: { type: Types.Int8, default: -1 },
  },
  'An Arcana MR UI panel',
);

/**
 * Mirror of the reading state machine, kept on one entity so the flow can be
 * inspected with IWSDK's ECS tools. Written only by ReadingStatusSystem.
 */
export const ReadingStatus = createComponent(
  'ReadingStatus',
  {
    state: { type: Types.String, default: 'PLACING' },
    spread: { type: Types.String, default: '' },
    readingNumber: { type: Types.Int32, default: 0 },
    shuffles: { type: Types.Int32, default: 0 },
    /** Comma-separated `cardId:U|R:up|down` per slot, or `-` for an empty spot. */
    slots: { type: Types.String, default: '' },
    deck: { type: Types.String, default: '' },
    theme: { type: Types.String, default: '' },
  },
  'Read-only mirror of the reading flow for debugging',
);
