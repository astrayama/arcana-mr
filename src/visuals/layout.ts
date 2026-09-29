/** Where things sit on the mat, in mat-local meters (reader on the +Z side). */

import { config } from '../config.js';
import type { LayoutRules } from './spreadLayout.js';

/** Height of the cloth's top surface above the mat origin. Things resting on the mat sit here. */
export const MAT_SURFACE_Y = 0.001;

/** Layout rules for cards of the given height, from config. */
export function layoutRules(cardHeightM: number, candleCount: number): LayoutRules {
  const { layout, card } = config;
  return {
    card: { widthM: card.widthM, heightM: cardHeightM, thicknessM: card.thicknessM },
    baseMat: { widthM: layout.matWidthM, depthM: layout.matDepthM },
    maxMat: { widthM: layout.maxMatWidthM, depthM: layout.maxMatDepthM },
    gapM: layout.cardGapM,
    deckGapM: layout.deckGapM,
    labelBandM: layout.labelBandM,
    margins: { ...layout.margins },
    minCardScale: layout.minCardScale,
    surfaceY: MAT_SURFACE_Y,
    candles: { count: candleCount, radiusM: 0.012, insetM: 0.04 },
  };
}

/** A grab that ends this quickly without moving much counts as a tap on the object. */
export const GRAB_TAP = { maxSeconds: 0.35, maxMeters: 0.02 } as const;

export function isGrabTap(seconds: number, meters: number): boolean {
  return seconds <= GRAB_TAP.maxSeconds && meters <= GRAB_TAP.maxMeters;
}
