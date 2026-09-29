/**
 * The shape of a spread: its positions, where each card goes, and what each
 * position asks. Built-in spreads are JSON files in this folder; spreads you
 * build in the headset use the same shape. Pure, so tests and scripts can use
 * it without a browser.
 */

export const MAX_SPREAD_CARDS = 12;
export const MAX_LABEL_LENGTH = 18;

/** Which side of its card a position's label sits on. */
export type LabelSide = 'near' | 'far' | 'left' | 'right';
export const LABEL_SIDES: readonly LabelSide[] = ['near', 'far', 'left', 'right'];

export interface SpreadPosition {
  /** Short name shown on the mat and the card's label ("Past", "Challenge"). */
  label: string;
  /** What this position asks, shown with the card's meaning. One short sentence. */
  meaning: string;
  /** Card cells to the reader's right. One cell is a card's width plus a gap. */
  x: number;
  /** Card cells away from the reader, as in a diagram. One cell is a card's height, its label, and a gap. */
  y: number;
  /** 90 lays the card sideways (the Celtic Cross crossing card). */
  rotationDeg?: 0 | 90;
  /** Index of an earlier position this card lies on top of. It shares that card's label. */
  over?: number;
  /** Where the label goes. Defaults to the reader's side. */
  labelSide?: LabelSide;
}

export interface SpreadDef {
  id: string;
  name: string;
  /** One line for the spread picker. */
  summary: string;
  /** Sort order in the picker (built-ins). */
  order?: number;
  origin: 'builtin' | 'custom';
  positions: readonly SpreadPosition[];
  /** Where the deck sits, in cells. Defaults to centered beyond the farthest cards. */
  deck?: { x: number; y: number };
}

export interface SpreadValidation {
  ok: boolean;
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Kebab-case ids, so they are safe as file names and settings keys. */
export const SPREAD_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Check a spread. `fileId` is the file name (built-ins) or null for spreads
 * made in the headset. Positions are checked for shape, not for overlaps;
 * the layout tests cover overlaps.
 */
export function validateSpread(data: unknown, fileId: string | null): SpreadValidation {
  const errors: string[] = [];
  const where = fileId ?? 'spread';
  if (!isObject(data)) return { ok: false, errors: [`${where}: not an object`] };

  if (!nonEmpty(data.id) || !SPREAD_ID.test(data.id)) errors.push(`${where}.id: must be kebab-case`);
  else if (fileId !== null && data.id !== fileId) errors.push(`${where}.id: "${data.id}" must match the file name`);
  if (!nonEmpty(data.name)) errors.push(`${where}.name: missing`);
  if (!nonEmpty(data.summary)) errors.push(`${where}.summary: missing`);
  if (data.order !== undefined && !isFiniteNumber(data.order)) errors.push(`${where}.order: must be a number`);
  if (data.deck !== undefined && !(isObject(data.deck) && isFiniteNumber(data.deck.x) && isFiniteNumber(data.deck.y))) {
    errors.push(`${where}.deck: must be { x, y }`);
  }

  const positions = data.positions;
  if (!Array.isArray(positions) || positions.length === 0) {
    errors.push(`${where}.positions: needs at least one position`);
  } else if (positions.length > MAX_SPREAD_CARDS) {
    errors.push(`${where}.positions: at most ${MAX_SPREAD_CARDS} cards`);
  } else {
    positions.forEach((p: unknown, i: number) => {
      const at = `${where}.positions[${i}]`;
      if (!isObject(p)) {
        errors.push(`${at}: not an object`);
        return;
      }
      if (!nonEmpty(p.label)) errors.push(`${at}.label: missing`);
      else if (p.label.length > MAX_LABEL_LENGTH) errors.push(`${at}.label: longer than ${MAX_LABEL_LENGTH} characters`);
      if (!nonEmpty(p.meaning)) errors.push(`${at}.meaning: missing`);
      else if (/[–—]/.test(p.meaning)) errors.push(`${at}.meaning: no em or en dashes`);
      if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) errors.push(`${at}: needs numeric x and y`);
      if (p.rotationDeg !== undefined && p.rotationDeg !== 0 && p.rotationDeg !== 90) {
        errors.push(`${at}.rotationDeg: 0 or 90`);
      }
      if (p.labelSide !== undefined && !LABEL_SIDES.includes(p.labelSide as LabelSide)) {
        errors.push(`${at}.labelSide: one of ${LABEL_SIDES.join(', ')}`);
      }
      if (p.over !== undefined) {
        if (!Number.isInteger(p.over) || (p.over as number) < 0 || (p.over as number) >= i) {
          errors.push(`${at}.over: must point at an earlier position`);
        } else if (isObject(positions[p.over as number]) && positions[p.over as number].over !== undefined) {
          errors.push(`${at}.over: can't stack on a card that is itself stacked`);
        }
      }
      const known = ['label', 'meaning', 'x', 'y', 'rotationDeg', 'over', 'labelSide'];
      for (const key of Object.keys(p)) if (!known.includes(key)) errors.push(`${at}.${key}: unknown field`);
    });
  }
  const known = ['id', 'name', 'summary', 'order', 'origin', 'positions', 'deck'];
  for (const key of Object.keys(data)) if (!known.includes(key)) errors.push(`${where}.${key}: unknown field`);
  return { ok: errors.length === 0, errors };
}
