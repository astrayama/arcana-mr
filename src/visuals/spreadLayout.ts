/**
 * Fits a spread onto the table. Pure math on plain numbers, so it's tested
 * without a headset. The mat grows to hold the spread (away from the reader
 * and to the sides, never toward them), up to a maximum; past that the cards
 * shrink, down to a minimum.
 *
 * Everything is in mat-local meters: x to the reader's right, z toward the
 * reader, y up. The mat's near edge stays where placement put it.
 */

import type { LabelSide, SpreadDef } from '../spreads/spread.schema.js';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LayoutRules {
  card: { widthM: number; heightM: number; thicknessM: number };
  baseMat: { widthM: number; depthM: number };
  maxMat: { widthM: number; depthM: number };
  /** Space between neighboring cards. */
  gapM: number;
  /** Clear space between the deck and the cards when the deck goes beyond them. */
  deckGapM: number;
  /** Depth of the band a label occupies beside its card. */
  labelBandM: number;
  margins: { nearM: number; sideM: number; farM: number };
  minCardScale: number;
  /** Height of the mat's surface, where cards rest. */
  surfaceY: number;
  candles: { count: number; radiusM: number; insetM: number };
}

export interface SlotPose {
  x: number;
  y: number;
  z: number;
  /** Radians around the vertical: 0, or PI/2 for a crossing card. Reversal is added on top. */
  yaw: number;
  footprint: Rect;
  /** Index into `labelGroups`. */
  labelGroup: number;
  /** The slot this card lies on top of, if any. */
  stackedOn: number | null;
}

export interface LabelGroup {
  /** The slots sharing this label: a card and anything stacked on it. */
  slots: number[];
  rect: Rect;
  side: LabelSide;
}

export interface TableLayout {
  /** Identifies the spread and card size this layout was made for. */
  key: string;
  /** The spread laid out, or null for the empty table between readings. */
  spread: SpreadDef | null;
  /** The mat's extents. `maxZ` is always the base mat's near edge. */
  bounds: Rect;
  mat: { widthM: number; depthM: number; centerZ: number };
  cardScale: number;
  slots: SlotPose[];
  labelGroups: LabelGroup[];
  deck: { x: number; z: number; footprint: Rect };
  candles: { x: number; z: number }[];
  /** True if even the smallest cards on the largest mat don't fit. */
  clipped: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function rect(cx: number, cz: number, w: number, d: number): Rect {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
}

function union(rects: Rect[]): Rect {
  return rects.reduce(
    (u, r) => ({
      minX: Math.min(u.minX, r.minX),
      maxX: Math.max(u.maxX, r.maxX),
      minZ: Math.min(u.minZ, r.minZ),
      maxZ: Math.max(u.maxZ, r.maxZ),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
}

export function overlaps(a: Rect, b: Rect, epsilon = 1e-6): boolean {
  return a.minX < b.maxX - epsilon && b.minX < a.maxX - epsilon && a.minZ < b.maxZ - epsilon && b.minZ < a.maxZ - epsilon;
}

function grow(r: Rect, by: number): Rect {
  return { minX: r.minX - by, maxX: r.maxX + by, minZ: r.minZ - by, maxZ: r.maxZ + by };
}

/** Where a label goes for a card with the given footprint. */
function labelRect(side: LabelSide, footprint: Rect, rules: LayoutRules): Rect {
  const { widthM } = rules.card;
  const band = rules.labelBandM;
  const cx = (footprint.minX + footprint.maxX) / 2;
  const cz = (footprint.minZ + footprint.maxZ) / 2;
  const nudge = rules.gapM / 4;
  switch (side) {
    case 'near':
      return { minX: cx - widthM / 2, maxX: cx + widthM / 2, minZ: footprint.maxZ, maxZ: footprint.maxZ + band };
    case 'far':
      return { minX: cx - widthM / 2, maxX: cx + widthM / 2, minZ: footprint.minZ - band, maxZ: footprint.minZ };
    case 'right':
      return { minX: footprint.maxX + nudge, maxX: footprint.maxX + nudge + widthM, minZ: cz - band / 2, maxZ: cz + band / 2 };
    case 'left':
      return { minX: footprint.minX - nudge - widthM, maxX: footprint.minX - nudge, minZ: cz - band / 2, maxZ: cz + band / 2 };
  }
}

/**
 * Lay out `spread` (or, for null, an empty table between readings, sized
 * like a small reading) on the mat.
 */
export function fitSpread(spread: SpreadDef | null, rules: LayoutRules): TableLayout {
  const W = rules.card.widthM;
  const H = rules.card.heightM;
  const cellX = W + rules.gapM;
  const cellZ = H + rules.labelBandM + rules.gapM;
  // Between readings, keep room for a small reading so the deck sits where it will be.
  const positions = spread?.positions ?? [{ label: '', meaning: '', x: 0, y: 0 }];

  // 1. Unscaled footprints and labels, with y growing away from the reader.
  const footprints: Rect[] = [];
  const stackedOn: (number | null)[] = [];
  const groupOf: number[] = [];
  const groups: { slots: number[]; rect: Rect; side: LabelSide }[] = [];
  positions.forEach((p, i) => {
    const sideways = p.rotationDeg === 90;
    const footprint = rect(p.x * cellX, -p.y * cellZ, sideways ? H : W, sideways ? W : H);
    footprints.push(footprint);
    if (p.over !== undefined && p.over < i) {
      stackedOn.push(p.over);
      groupOf.push(groupOf[p.over]);
      groups[groupOf[p.over]].slots.push(i);
    } else {
      stackedOn.push(null);
      const side = p.labelSide ?? 'near';
      groupOf.push(groups.length);
      groups.push({ slots: [i], rect: labelRect(side, footprint, rules), side });
    }
  });

  const cards = union(footprints);
  let deckCenter: { x: number; z: number };
  if (spread?.deck) {
    deckCenter = { x: spread.deck.x * cellX, z: -spread.deck.y * cellZ };
  } else {
    // Beyond the farthest cards, centered on them.
    const everything = union([cards, ...groups.map((g) => g.rect)]);
    deckCenter = { x: (cards.minX + cards.maxX) / 2, z: everything.minZ - rules.deckGapM - H / 2 };
  }
  const deckRect = rect(deckCenter.x, deckCenter.z, W, H);

  const content = union([...footprints, ...groups.map((g) => g.rect), deckRect]);
  const contentW = content.maxX - content.minX;
  const contentD = content.maxZ - content.minZ;

  // 2. Card scale: shrink only once the mat can't grow any more.
  const { nearM, sideM, farM } = rules.margins;
  const availW = rules.maxMat.widthM - 2 * sideM;
  const availD = rules.maxMat.depthM - nearM - farM;
  let scale = Math.min(1, availW / contentW, availD / contentD);
  const clipped = scale < rules.minCardScale - 1e-9;
  scale = Math.max(scale, rules.minCardScale);

  // 3. Mat size, growing away from the reader from a fixed near edge.
  const matW = clamp(contentW * scale + 2 * sideM, rules.baseMat.widthM, rules.maxMat.widthM);
  const matD = clamp(contentD * scale + nearM + farM, rules.baseMat.depthM, rules.maxMat.depthM);
  const nearEdge = rules.baseMat.depthM / 2;
  const bounds: Rect = { minX: -matW / 2, maxX: matW / 2, minZ: nearEdge - matD, maxZ: nearEdge };

  // 4. Place content: centered left to right, snug against the near margin.
  const centerX = (content.minX + content.maxX) / 2;
  const tx = (x: number) => (x - centerX) * scale;
  const tz = (z: number) => nearEdge - nearM - (content.maxZ - z) * scale;
  const place = (r: Rect): Rect => ({ minX: tx(r.minX), maxX: tx(r.maxX), minZ: tz(r.minZ), maxZ: tz(r.maxZ) });

  const slots: SlotPose[] = spread
    ? positions.map((p, i) => {
        const f = place(footprints[i]);
        const below = stackedOn[i];
        return {
          x: (f.minX + f.maxX) / 2,
          y: below === null ? rules.surfaceY : rules.surfaceY + rules.card.thicknessM * scale + 0.0005,
          z: (f.minZ + f.maxZ) / 2,
          yaw: p.rotationDeg === 90 ? Math.PI / 2 : 0,
          footprint: f,
          labelGroup: groupOf[i],
          stackedOn: below,
        };
      })
    : [];
  const labelGroups: LabelGroup[] = spread ? groups.map((g) => ({ slots: g.slots, rect: place(g.rect), side: g.side })) : [];
  const deck = { x: tx(deckCenter.x), z: tz(deckCenter.z), footprint: place(deckRect) };

  // 5. Candles in the far corners, sliding inward until they clear everything.
  const obstacles = [...slots.map((s) => s.footprint), ...labelGroups.map((g) => g.rect), deck.footprint];
  const candles: { x: number; z: number }[] = [];
  const { count, radiusM, insetM } = rules.candles;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const z = bounds.minZ + insetM;
    let x = (t - 0.5) * (matW - 2 * insetM);
    const step = 0.01 * Math.sign(-x || 1);
    let placed = false;
    for (let tries = 0; tries < 60; tries++) {
      const spot = rect(x, z, radiusM * 2, radiusM * 2);
      if (!obstacles.some((o) => overlaps(grow(spot, 0.01), o))) {
        placed = true;
        break;
      }
      if (Math.abs(x) < Math.abs(step)) break;
      x += step;
    }
    if (placed) candles.push({ x, z });
  }

  return {
    key: `${spread?.id ?? 'base'}|${H.toFixed(4)}`,
    spread,
    bounds,
    mat: { widthM: matW, depthM: matD, centerZ: (bounds.minZ + bounds.maxZ) / 2 },
    cardScale: scale,
    slots,
    labelGroups,
    deck,
    candles,
    clipped,
  };
}

/** Everything on the mat that overlaps something it shouldn't. Empty means a clean layout. */
export function findOverlaps(layout: TableLayout): string[] {
  const items: { name: string; rect: Rect; slot?: number }[] = [{ name: 'deck', rect: layout.deck.footprint }];
  layout.slots.forEach((s, i) => items.push({ name: `card ${i}`, rect: s.footprint, slot: i }));
  layout.labelGroups.forEach((g, i) => items.push({ name: `label ${i}`, rect: g.rect }));
  const problems: string[] = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const A = items[a];
      const B = items[b];
      // A card and the card stacked on it are meant to overlap.
      if (A.slot !== undefined && B.slot !== undefined) {
        const sa = layout.slots[A.slot];
        const sb = layout.slots[B.slot];
        if (sa.stackedOn === B.slot || sb.stackedOn === A.slot) continue;
      }
      if (overlaps(A.rect, B.rect)) problems.push(`${A.name} overlaps ${B.name}`);
    }
  }
  const b = layout.bounds;
  for (const item of items) {
    const r = item.rect;
    if (r.minX < b.minX || r.maxX > b.maxX || r.minZ < b.minZ || r.maxZ > b.maxZ) problems.push(`${item.name} is off the mat`);
  }
  return problems;
}
