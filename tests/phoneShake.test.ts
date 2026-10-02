import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPhoneShake, motionStrength } from '../src/lib/phoneShake.ts';

test('a few sharp jolts in quick succession are a shake, then it rests', () => {
  const felt = createPhoneShake();
  assert.equal(felt(18, 0), false);
  assert.equal(felt(19, 200), false);
  assert.equal(felt(20, 400), true, 'third jolt within the window');
  assert.equal(felt(20, 600), false, 'resting after a shake');
  assert.equal(felt(20, 900), false);
  assert.equal(felt(20, 1200), false);
  assert.equal(felt(18, 3000), false, 'a new shake starts counting again');
  assert.equal(felt(18, 3200), false);
  assert.equal(felt(18, 3400), true);
});

test('gentle handling, slow jolts, and one long jolt are not shakes', () => {
  const felt = createPhoneShake();
  for (let t = 0; t < 3000; t += 50) assert.equal(felt(6, t), false, 'walking around with the phone');
  assert.equal(felt(20, 4000), false);
  assert.equal(felt(20, 5500), false, 'too far apart');
  assert.equal(felt(20, 7000), false);
  const steady = createPhoneShake();
  assert.equal(steady(20, 0), false);
  assert.equal(steady(20, 40), false, 'one jolt read twice');
  assert.equal(steady(20, 80), false);
});

test('motion strength leaves gravity out, whichever reading the phone gives', () => {
  assert.equal(motionStrength({ acceleration: { x: 3, y: 4, z: 0 } }), 5);
  assert.ok(Math.abs(motionStrength({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 } })!) < 1e-9);
  assert.equal(motionStrength({ acceleration: { x: null, y: null, z: null }, accelerationIncludingGravity: null }), null);
});
