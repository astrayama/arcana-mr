import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGrabTap, slotPosition } from '../src/visuals/layout.ts';

test('slots run left to right, centered on the mat', () => {
  const [left, middle, right] = [0, 1, 2].map((slot) => slotPosition('three', slot));
  assert.ok(left.x < middle.x && middle.x < right.x);
  assert.equal(middle.x, 0);
  assert.equal(slotPosition('single', 0).x, 0);
});

test('grab-taps are quick and still', () => {
  assert.equal(isGrabTap(0.2, 0.005), true);
  assert.equal(isGrabTap(0.6, 0.005), false);
  assert.equal(isGrabTap(0.2, 0.05), false);
});
