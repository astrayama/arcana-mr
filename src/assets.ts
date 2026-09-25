import { defineAssets } from '@iwsdk/core';

/**
 * Arcana MR loads its art through the deck and theme registries (so art packs
 * and themes are drop-in folders), and its panels are theme templates in
 * src/ui. Nothing needs to be preloaded through the scene manifest.
 */
export default defineAssets({});
