import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawCards, randomInt, shuffle } from '../src/lib/shuffle.ts';

const ids = Array.from({ length: 78 }, (_, i) => `card-${i}`);

test('shuffle keeps every card exactly once', () => {
  const result = shuffle(ids);
  assert.equal(result.length, ids.length);
  assert.deepEqual([...result].sort(), [...ids].sort());
});

test('shuffle does not mutate its input', () => {
  const copy = ids.slice();
  shuffle(ids);
  assert.deepEqual(ids, copy);
});

test('draws never repeat a card within one reading', () => {
  for (let i = 0; i < 2000; i++) {
    const drawn = drawCards(ids, 3, 0.5);
    assert.equal(new Set(drawn.map((c) => c.cardId)).size, 3);
  }
});

test('randomInt stays in range and covers it', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 5000; i++) {
    const n = randomInt(7);
    assert.ok(n >= 0 && n < 7 && Number.isInteger(n));
    seen.add(n);
  }
  assert.equal(seen.size, 7);
});

test('every card lands in first position about equally often', () => {
  const counts = new Map<string, number>();
  const trials = 78 * 400;
  for (let i = 0; i < trials; i++) {
    const [first] = drawCards(ids, 1, 0);
    counts.set(first.cardId, (counts.get(first.cardId) ?? 0) + 1);
  }
  // Expected 400 each; a fair shuffle stays well inside +/-40%.
  for (const id of ids) {
    const c = counts.get(id) ?? 0;
    assert.ok(c > 240 && c < 560, `${id} drawn ${c} times`);
  }
});

test('reversal chance is respected', () => {
  const flips = (chance: number) =>
    Array.from({ length: 20000 }, () => drawCards(ids, 1, chance)[0].reversed).filter(Boolean)
      .length / 20000;
  assert.equal(flips(0), 0);
  assert.equal(flips(1), 1);
  assert.ok(Math.abs(flips(0.5) - 0.5) < 0.02);
});
