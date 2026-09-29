/**
 * The spread builder's state, and turning it into a spread you can read.
 * Pure: the builder panel sends actions here and shows the result.
 */

import { defaultNames, meaningFor } from './positionNames.js';
import { defaultShape, getShape, SHAPES, type ShapeId } from './shapes.js';
import { MAX_LABEL_LENGTH, MAX_SPREAD_CARDS, type SpreadDef } from './spread.schema.js';

export const MAX_SAVED_SPREADS = 8;
export const CUSTOM_SPREADS_KEY = 'arcana.spreads.v1';

export interface Draft {
  count: number;
  shape: ShapeId;
  /** One name per spot. */
  names: string[];
  /** The spot being named. */
  selected: number;
  /** True once the reader has picked a name themselves. */
  touched: boolean;
}

export type BuilderAction =
  | { type: 'count'; delta: 1 | -1 }
  | { type: 'shape'; shape: ShapeId }
  | { type: 'select'; spot: number }
  | { type: 'name'; label: string };

export function newDraft(count = 3): Draft {
  return { count, shape: defaultShape(count), names: defaultNames(count), selected: 0, touched: false };
}

/** Shapes that work for `count` cards. */
export function shapesFor(count: number): ShapeId[] {
  return SHAPES.filter((s) => count >= s.minCount && count <= s.maxCount).map((s) => s.id);
}

export function reduce(draft: Draft, action: BuilderAction): Draft {
  switch (action.type) {
    case 'count': {
      const count = Math.min(Math.max(draft.count + action.delta, 1), MAX_SPREAD_CARDS);
      if (count === draft.count) return draft;
      let names: string[];
      if (!draft.touched) {
        names = defaultNames(count);
      } else {
        names = draft.names.slice(0, count);
        // New spots get defaults the reader hasn't used yet.
        for (const name of defaultNames(MAX_SPREAD_CARDS)) {
          if (names.length >= count) break;
          if (!names.includes(name)) names.push(name);
        }
      }
      const shape = shapesFor(count).includes(draft.shape) ? draft.shape : defaultShape(count);
      return { ...draft, count, names, shape, selected: Math.min(draft.selected, count - 1) };
    }
    case 'shape':
      return shapesFor(draft.count).includes(action.shape) ? { ...draft, shape: action.shape } : draft;
    case 'select':
      return action.spot >= 0 && action.spot < draft.count ? { ...draft, selected: action.spot } : draft;
    case 'name': {
      const names = draft.names.slice();
      names[draft.selected] = action.label;
      // Move on to the next spot, so naming a whole spread is a run of taps.
      return { ...draft, names, touched: true, selected: Math.min(draft.selected + 1, draft.count - 1) };
    }
  }
}

export function draftTitle(draft: Pick<Draft, 'count' | 'shape'>): string {
  if (draft.count === 1) return 'My single card';
  const shape = getShape(draft.shape)?.label.toLowerCase() ?? 'spread';
  return `My ${shape} of ${draft.count}`;
}

/** "Past, Present, Future" or "You, Heart, and 6 more". */
export function summaryOf(names: readonly string[]): string {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')}, and ${names.length - 2} more`;
}

/** What a saved spread keeps: its shape and names. Positions are regenerated. */
export interface SavedSpread {
  id: string;
  title: string;
  shape: ShapeId;
  names: string[];
}

export function toSaved(draft: Draft, id: string): SavedSpread {
  return { id, title: draftTitle(draft), shape: draft.shape, names: draft.names.slice(0, draft.count) };
}

/** A readable spread from a saved one, or null if it no longer makes sense. */
export function spreadFromSaved(saved: SavedSpread): SpreadDef | null {
  const shape = getShape(saved.shape);
  const count = saved.names.length;
  if (!shape || count < shape.minCount || count > shape.maxCount) return null;
  const layout = shape.generate(count);
  return {
    id: saved.id,
    name: saved.title,
    summary: summaryOf(saved.names),
    origin: 'custom',
    positions: layout.spots.map((spot, i) => ({
      label: saved.names[i],
      meaning: meaningFor(saved.names[i]),
      x: spot.x,
      y: spot.y,
      ...(spot.rotationDeg ? { rotationDeg: spot.rotationDeg } : {}),
      ...(spot.over !== undefined ? { over: spot.over } : {}),
    })),
    ...(layout.deck ? { deck: layout.deck } : {}),
  };
}

export function draftToSpread(draft: Draft, id = 'draft'): SpreadDef {
  return spreadFromSaved(toSaved(draft, id))!;
}

/** Saved spreads from storage, keeping only ones that still make sense. */
export function parseSavedSpreads(raw: unknown): SavedSpread[] {
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return [];
  const list = (raw as { spreads?: unknown }).spreads;
  if (!Array.isArray(list)) return [];
  const out: SavedSpread[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== 'string' || !/^custom-[a-z0-9-]+$/.test(s.id)) continue;
    if (typeof s.title !== 'string' || !s.title || s.title.length > 40) continue;
    if (typeof s.shape !== 'string' || !getShape(s.shape)) continue;
    if (!Array.isArray(s.names) || !s.names.every((n) => typeof n === 'string' && n && n.length <= MAX_LABEL_LENGTH)) continue;
    const saved: SavedSpread = { id: s.id, title: s.title, shape: s.shape as ShapeId, names: s.names as string[] };
    if (spreadFromSaved(saved) && !out.some((o) => o.id === saved.id)) out.push(saved);
    if (out.length >= MAX_SAVED_SPREADS) break;
  }
  return out;
}

export function serializeSavedSpreads(spreads: readonly SavedSpread[]): unknown {
  return { v: 1, spreads };
}
