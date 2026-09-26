import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShakeDetector } from '../src/lib/shake.ts';

/** Feed a sampled path at 72 Hz; returns the time a shake fired, or null. */
function run(path: (t: number) => [number, number, number], seconds: number): number | null {
  const detector = createShakeDetector();
  for (let t = 0; t <= seconds; t += 1 / 72) {
    const [x, y, z] = path(t);
    if (detector.push(t, x, y, z)) return t;
  }
  return null;
}

test('a brisk side-to-side shake fires', () => {
  // 3 Hz, 6 cm swing: a normal "shake the deck" motion.
  const fired = run((t) => [Math.sin(t * Math.PI * 2 * 3) * 0.06, 1, 0], 2);
  assert.ok(fired !== null && fired < 1.2, `fired at ${fired}`);
});

test('holding still does not fire', () => {
  assert.equal(run(() => [0, 1, 0], 3), null);
});

test('tracking jitter does not fire', () => {
  let i = 0;
  assert.equal(run(() => [((i++ % 3) - 1) * 0.004, 1, 0], 3), null);
});

test('a slow sweep back and forth does not fire', () => {
  // 0.4 Hz: each stroke takes over a second.
  assert.equal(run((t) => [Math.sin(t * Math.PI * 2 * 0.4) * 0.15, 1, 0], 4), null);
});

test('moving the deck somewhere and back does not fire', () => {
  assert.equal(run((t) => [t < 1 ? t * 0.3 : Math.max(0.3 - (t - 1) * 0.3, 0), 1, 0], 2.5), null);
});

test('a tracking jump restarts detection instead of counting', () => {
  let t0 = 0;
  const detector = createShakeDetector();
  // Two quick strokes, then a 40 cm teleport, then one more stroke: no shake.
  const samples: [number, number][] = [
    [0, 0], [0.1, 0.05], [0.2, 0], [0.3, 0.05], [0.35, 0.45], [0.45, 0.5], [0.55, 0.45],
  ];
  let fired = false;
  for (const [t, x] of samples) fired ||= detector.push((t0 = t), x, 1, 0);
  assert.equal(fired, false);
});

test('it fires only once per hold until reset', () => {
  const detector = createShakeDetector();
  let fires = 0;
  for (let t = 0; t <= 3; t += 1 / 72) {
    if (detector.push(t, Math.sin(t * Math.PI * 6) * 0.06, 1, 0)) fires++;
  }
  assert.equal(fires, 1);
  detector.reset();
  for (let t = 3; t <= 5; t += 1 / 72) {
    if (detector.push(t, Math.sin(t * Math.PI * 6) * 0.06, 1, 0)) fires++;
  }
  assert.equal(fires, 2);
});
