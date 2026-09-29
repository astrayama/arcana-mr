/**
 * Shapes for spreads you build yourself: where each spot goes, in card cells
 * (x to the right, y away from you), and where the deck sits. Pure, so every
 * shape and count is checked by the layout tests.
 */

export type ShapeId = 'row' | 'rows' | 'arc' | 'ring' | 'cross';

export interface ShapeLayout {
  spots: { x: number; y: number; rotationDeg?: 0 | 90; over?: number }[];
  deck?: { x: number; y: number };
}

export interface Shape {
  id: ShapeId;
  label: string;
  minCount: number;
  maxCount: number;
  generate(count: number): ShapeLayout;
}

const centered = (count: number) => Array.from({ length: count }, (_, i) => i - (count - 1) / 2);

export const SHAPES: readonly Shape[] = [
  {
    id: 'row',
    label: 'Row',
    minCount: 1,
    maxCount: 7,
    generate: (count) => ({ spots: centered(count).map((x) => ({ x, y: 0 })) }),
  },
  {
    id: 'rows',
    label: 'Rows',
    minCount: 4,
    maxCount: 12,
    // Rows of up to four, read from the far row toward you; the deck waits at the left.
    generate(count) {
      const perRow = count <= 6 ? 3 : 4;
      const rows = Math.ceil(count / perRow);
      const spots: ShapeLayout['spots'] = [];
      for (let r = 0; r < rows; r++) {
        const inRow = Math.min(perRow, count - r * perRow);
        for (const x of centered(inRow)) spots.push({ x, y: (rows - 1) / 2 - r });
      }
      return { spots, deck: { x: -(perRow + 1) / 2 - 0.2, y: 0 } };
    },
  },
  {
    id: 'arc',
    label: 'Arc',
    minCount: 3,
    maxCount: 7,
    // A horseshoe opening toward you, with the deck inside it once it's deep enough.
    generate(count) {
      const xs = centered(count);
      const edge = (count - 1) / 2;
      const peak = Math.min(1, edge / 3 + 0.34);
      const spots = xs.map((x) => ({ x, y: Math.round(peak * (1 - (x / edge) ** 2) * 100) / 100 }));
      return count >= 7 ? { spots, deck: { x: 0, y: 0 } } : { spots };
    },
  },
  {
    id: 'ring',
    label: 'Ring',
    minCount: 6,
    maxCount: 12,
    // Around the deck: a row beyond it, one card at each side, a row before it.
    generate(count) {
      const sides = count >= 8 ? 2 : 0;
      const top = Math.ceil((count - sides) / 2);
      const bottom = count - sides - top;
      const reach = Math.max(top, bottom);
      const spots: ShapeLayout['spots'] = [];
      for (const x of centered(top)) spots.push({ x, y: 1 });
      if (sides) spots.push({ x: (reach + 1) / 2, y: 0 });
      for (const x of centered(bottom).reverse()) spots.push({ x, y: -1 });
      if (sides) spots.push({ x: -(reach + 1) / 2, y: 0 });
      return { spots, deck: { x: 0, y: 0 } };
    },
  },
  {
    id: 'cross',
    label: 'Cross',
    minCount: 4,
    maxCount: 6,
    // Four around a center; five adds a center card; six lays one across it.
    generate(count) {
      const around = [
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
      ];
      if (count === 4) return { spots: around, deck: { x: 0, y: 0 } };
      const spots: ShapeLayout['spots'] = [{ x: 0, y: 0 }];
      if (count === 6) spots.push({ x: 0, y: 0, rotationDeg: 90, over: 0 });
      spots.push(...around.map((p) => ({ ...p, x: p.x * (count === 6 ? 1.3 : 1) })));
      return { spots, deck: { x: count === 6 ? -2.6 : -2, y: 1 } };
    },
  },
];

export function getShape(id: string): Shape | undefined {
  return SHAPES.find((s) => s.id === id);
}

/** The shape a spread of `count` cards starts with. */
export function defaultShape(count: number): ShapeId {
  return count <= 5 ? 'row' : 'rows';
}
