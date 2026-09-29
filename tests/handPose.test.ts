import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFistDetector,
  faceUpFromNormalY,
  FIST_JOINTS,
  fingerRatios,
  JOINT,
  type FistJoint,
} from '../src/lib/handPose.ts';

type Vec = [number, number, number];
type Finger = 'index' | 'middle' | 'ring' | 'pinky';
type Shape = 'straight' | 'relaxed' | 'curled' | 'pinching';

/** Knuckles of a right hand, palm down, fingers pointing toward -Z, wrist at the origin. */
const KNUCKLES: Record<Finger, Vec> = {
  index: [0.025, 0, -0.09],
  middle: [0.005, 0, -0.092],
  ring: [-0.015, 0, -0.085],
  pinky: [-0.032, 0, -0.075],
};

/** Where a fingertip ends up, relative to its knuckle, for each finger shape. */
const TIPS: Record<Shape, Vec> = {
  straight: [0, 0, -0.085],
  relaxed: [0, -0.035, -0.06],
  // Curled into the palm: back under the knuckle toward the wrist.
  curled: [0, -0.03, 0.035],
  // Reaching down and in to meet the thumb.
  pinching: [-0.01, -0.045, -0.03],
};

function hand(shapes: Record<Finger, Shape>): Float32Array {
  const p = new Float32Array(FIST_JOINTS.length * 3);
  const set = (joint: FistJoint, v: Vec) => p.set(v, JOINT[joint] * 3);
  set('wrist', [0, 0, 0]);
  set('thumb-tip', [0.03, -0.04, -0.1]);
  for (const finger of Object.keys(KNUCKLES) as Finger[]) {
    const knuckle = KNUCKLES[finger];
    const tip = TIPS[shapes[finger]];
    set(`${finger === 'pinky' ? 'pinky' : finger}-finger-phalanx-proximal` as FistJoint, knuckle);
    set(`${finger}-finger-tip` as FistJoint, [knuckle[0] + tip[0], knuckle[1] + tip[1], knuckle[2] + tip[2]]);
  }
  return p;
}

const all = (shape: Shape): Record<Finger, Shape> => ({ index: shape, middle: shape, ring: shape, pinky: shape });

function ratios(shapes: Record<Finger, Shape>): number[] {
  const out = [0, 0, 0, 0];
  fingerRatios(hand(shapes), out);
  return out;
}

test('curl ratios separate straight, relaxed, and curled fingers', () => {
  const straight = ratios(all('straight'));
  const relaxed = ratios(all('relaxed'));
  const curled = ratios(all('curled'));
  for (let i = 0; i < 4; i++) {
    assert.ok(straight[i] > 1.8, `straight ${straight[i]}`);
    assert.ok(relaxed[i] > 1.5 && relaxed[i] < straight[i], `relaxed ${relaxed[i]}`);
    assert.ok(curled[i] < 1, `curled ${curled[i]}`);
  }
});

test('ratios do not depend on hand size', () => {
  const small = hand(all('relaxed'));
  const big = small.map((v) => v * 1.3);
  const a = [0, 0, 0, 0];
  const b = [0, 0, 0, 0];
  fingerRatios(small, a);
  fingerRatios(big, b);
  a.forEach((ratio, i) => assert.ok(Math.abs(ratio - b[i]) < 1e-5));
});

test('a fist is all four fingers curled', () => {
  assert.equal(createFistDetector().update(ratios(all('curled'))), true);
  assert.equal(createFistDetector().update(ratios(all('relaxed'))), false);
  assert.equal(createFistDetector().update(ratios(all('straight'))), false);
});

test('pinching or pointing with the other fingers curled is not a fist', () => {
  const tightPinch = ratios({ index: 'pinching', middle: 'curled', ring: 'curled', pinky: 'curled' });
  const point = ratios({ index: 'straight', middle: 'curled', ring: 'curled', pinky: 'curled' });
  assert.equal(createFistDetector().update(tightPinch), false);
  assert.equal(createFistDetector().update(point), false);
});

test('a fist holds through small wobbles and opens when a finger straightens', () => {
  const fist = createFistDetector({ on: 1.3, off: 1.5 });
  assert.equal(fist.update([1, 1, 1, 1]), true);
  assert.equal(fist.update([1.4, 1.35, 1.2, 1.1]), true, 'between the thresholds it stays closed');
  assert.equal(fist.update([1.6, 1, 1, 1]), false);
  assert.equal(fist.update([1.4, 1, 1, 1]), false, 'and stays open until every finger curls again');
  assert.equal(fist.update([1.2, 1, 1, 1]), true);
  fist.reset();
  assert.equal(fist.active, false);
});

test('a card faces up when its face points at the sky', () => {
  assert.equal(faceUpFromNormalY(0.9), true);
  assert.equal(faceUpFromNormalY(-0.2), false);
});
