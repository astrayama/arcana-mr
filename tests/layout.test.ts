import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGrabTap } from '../src/visuals/layout.ts';

test('grab-taps are quick and still', () => {
  assert.equal(isGrabTap(0.2, 0.005), true);
  assert.equal(isGrabTap(0.6, 0.005), false);
  assert.equal(isGrabTap(0.2, 0.05), false);
});
