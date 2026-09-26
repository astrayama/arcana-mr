import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGrabTap, nearestEmptySlot, slotPosition } from '../src/visuals/layout.ts';

test('dropping on top of an empty slot picks it', () => {
  const at = slotPosition('three', 2);
  assert.equal(nearestEmptySlot('three', [false, false, false], at.x, at.z), 2);
});

test('filled slots are skipped for the nearest empty one', () => {
  const at = slotPosition('three', 1);
  // Slot 1 is full, so a drop a little right of it lands in slot 2.
  assert.equal(nearestEmptySlot('three', [false, true, false], at.x + 0.07, at.z), 2);
});

test('a drop far from every open slot is rejected', () => {
  assert.equal(nearestEmptySlot('three', [false, false, false], 0, -0.5), -1);
  assert.equal(nearestEmptySlot('single', [true], 0, 0.09), -1);
});

test('grab-taps are quick and still', () => {
  assert.equal(isGrabTap(0.2, 0.005), true);
  assert.equal(isGrabTap(0.6, 0.005), false);
  assert.equal(isGrabTap(0.2, 0.05), false);
});
