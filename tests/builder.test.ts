import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config } from '../src/config.ts';
import {
  draftToSpread,
  newDraft,
  parseSavedSpreads,
  reduce,
  serializeSavedSpreads,
  shapesFor,
  spreadFromSaved,
  toSaved,
  type Draft,
} from '../src/spreads/builderModel.ts';
import { NAME_GROUPS } from '../src/spreads/positionNames.ts';
import { SHAPES } from '../src/spreads/shapes.ts';
import { validateSpread } from '../src/spreads/spread.schema.ts';
import { layoutRules } from '../src/visuals/layout.ts';
import { findOverlaps, fitSpread } from '../src/visuals/spreadLayout.ts';

const rules = layoutRules(config.card.widthM / 0.5801, 2);

test('every shape, at every count it offers, fits cleanly on the table', () => {
  for (const shape of SHAPES) {
    for (let count = shape.minCount; count <= shape.maxCount; count++) {
      const spread = spreadFromSaved({ id: 'custom-t', title: 'T', shape: shape.id, names: Array.from({ length: count }, (_, i) => `Spot ${i}`) });
      assert.ok(spread, `${shape.id} ${count}`);
      assert.equal(spread!.positions.length, count);
      assert.deepEqual(validateSpread({ ...spread, origin: undefined }, null).errors, [], `${shape.id} ${count}`);
      const layout = fitSpread(spread, rules);
      assert.deepEqual(findOverlaps(layout), [], `${shape.id} ${count}`);
      assert.equal(layout.clipped, false, `${shape.id} ${count} fits`);
    }
  }
});

test('every count from 1 to 12 has at least one shape', () => {
  for (let count = 1; count <= 12; count++) assert.ok(shapesFor(count).length > 0, `${count}`);
});

test('the count stays between 1 and 12, and the shape follows it', () => {
  let d: Draft = newDraft(1);
  d = reduce(d, { type: 'count', delta: -1 });
  assert.equal(d.count, 1);
  for (let i = 0; i < 20; i++) d = reduce(d, { type: 'count', delta: 1 });
  assert.equal(d.count, 12);
  assert.equal(d.names.length, 12);
  assert.ok(shapesFor(12).includes(d.shape));
  assert.equal(reduce(d, { type: 'shape', shape: 'cross' }).shape, d.shape, 'a cross cannot hold 12');
});

test('picking names moves along the spots, and names survive a count change', () => {
  let d = newDraft(3);
  d = reduce(d, { type: 'name', label: 'Heart' });
  assert.equal(d.selected, 1);
  d = reduce(d, { type: 'name', label: 'Lesson' });
  d = reduce(d, { type: 'count', delta: 1 });
  assert.deepEqual(d.names.slice(0, 2), ['Heart', 'Lesson']);
  assert.equal(d.names.length, 4);
  assert.equal(new Set(d.names).size, 4, 'new spots get unused names');
  d = reduce(d, { type: 'select', spot: 3 });
  d = reduce(d, { type: 'name', label: 'Gift' });
  assert.equal(d.selected, 3, 'stays on the last spot');
});

test('saved spreads round-trip, and bad or extra entries are dropped', () => {
  const a = toSaved(newDraft(5), 'custom-a');
  const b = toSaved(reduce(newDraft(4), { type: 'shape', shape: 'cross' }), 'custom-b');
  const stored = JSON.parse(JSON.stringify(serializeSavedSpreads([a, b])));
  assert.deepEqual(parseSavedSpreads(stored), [a, b]);
  assert.deepEqual(parseSavedSpreads(null), []);
  assert.deepEqual(parseSavedSpreads({ v: 2, spreads: [a] }), []);
  const bad = { v: 1, spreads: [a, { ...a, id: 'not-custom' }, { ...b, shape: 'blob' }, { ...b, id: 'custom-c', names: ['x'] }, a] };
  assert.deepEqual(parseSavedSpreads(bad), [a], 'wrong id, unknown shape, wrong count for the shape, duplicate');
  const many = { v: 1, spreads: Array.from({ length: 12 }, (_, i) => ({ ...a, id: `custom-${i}` })) };
  assert.equal(parseSavedSpreads(many).length, 8);
});

test('a draft becomes a readable spread with a meaning for every spot', () => {
  const spread = draftToSpread(newDraft(3));
  assert.deepEqual(spread.positions.map((p) => p.label), ['Past', 'Present', 'Future']);
  assert.ok(spread.positions.every((p) => p.meaning.length > 0));
  assert.equal(spread.origin, 'custom');
});

test('spot names fit on a label and read cleanly', () => {
  const labels = NAME_GROUPS.flatMap((g) => g.names.map((n) => n.label));
  assert.equal(new Set(labels).size, labels.length, 'no duplicates');
  for (const g of NAME_GROUPS) {
    assert.ok(g.names.length <= 12, `${g.title} fits the picker`);
    for (const n of g.names) {
      assert.ok(n.label.length <= 18, n.label);
      assert.ok(!/[–—]/.test(n.meaning), n.label);
    }
  }
});
