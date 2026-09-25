import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fallbackPose,
  pickTable,
  placeMatOnSurface,
  snapYaw,
  type SurfaceRect,
} from '../src/placement/tableMath.ts';

const rules = { heightRange: [0.35, 1.2] as const, minEdge: 0.3, maxDistance: 2.5 };
const mat = { width: 0.56, depth: 0.42, margin: 0.04, surfaceOffset: 0.002 };
const viewer = { x: 0, y: 1.2, z: 0 };
const rect = (over: Partial<SurfaceRect>): SurfaceRect => ({
  cx: 0, cz: -0.8, y: 0.74, yaw: 0, halfW: 0.6, halfD: 0.4, label: '', source: 'plane', ...over,
});
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a Space Setup table beats a closer unlabeled surface', () => {
  const shelf = rect({ cz: -0.5, label: 'other' });
  const table = rect({ cz: -1.4, label: 'table' });
  assert.equal(pickTable([shelf, table], viewer, rules), table);
});

test('floors, couches, tiny and out-of-range surfaces are rejected', () => {
  assert.equal(pickTable([rect({ label: 'floor', y: 0 })], viewer, rules), null);
  assert.equal(pickTable([rect({ label: 'couch', y: 0.45 })], viewer, rules), null);
  assert.equal(pickTable([rect({ halfW: 0.1, halfD: 0.1 })], viewer, rules), null);
  assert.equal(pickTable([rect({ y: 1.6 })], viewer, rules), null);
  assert.equal(pickTable([rect({ cz: -5 })], viewer, rules), null);
});

test('with no labels, the nearest usable surface wins', () => {
  const far = rect({ cz: -2 });
  const close = rect({ cz: -0.9 });
  assert.equal(pickTable([far, close], viewer, rules), close);
});

test('the mat sits on the near edge, fully on the table, facing the reader', () => {
  // Table spans z from -1.2 to -0.4; the reader is at z = 0 in front of it.
  const pose = placeMatOnSurface(rect({}), viewer, mat);
  near(pose.y, 0.742);
  near(pose.x, 0);
  // Near edge at -0.4, mat depth 0.42 plus a 0.04 margin: center at -0.4 - 0.25.
  near(pose.z, -0.65);
  near(pose.yaw, 0);
});

test('a reader at the side of the table gets a mat squared to that side', () => {
  const pose = placeMatOnSurface(rect({ cx: -1, cz: 0, halfW: 0.5, halfD: 0.9 }), viewer, mat);
  near(pose.yaw, Math.PI / 2);
  // Pose is within the table: x from -1.5 to -0.5.
  assert.ok(pose.x < -0.5 && pose.x > -1.5, `x=${pose.x}`);
});

test('a small table centers the mat instead of hanging it off one side', () => {
  const pose = placeMatOnSurface(rect({ halfW: 0.2, halfD: 0.2, cz: -0.6 }), viewer, mat);
  near(pose.x, 0);
  near(pose.z, -0.6);
});

test('rotated tables keep the mat square to their edges', () => {
  const yaw = Math.PI / 6;
  const pose = placeMatOnSurface(rect({ yaw }), viewer, mat);
  near(snapYaw(pose.yaw, yaw), pose.yaw);
});

test('the fallback puts the mat below eye level, in front, facing the reader', () => {
  const pose = fallbackPose({ x: 1, y: 1.6, z: 2 }, 0, -1, { belowEyeM: 0.45, forwardM: 0.5 });
  near(pose.x, 1);
  near(pose.y, 1.15);
  near(pose.z, 1.5);
  near(pose.yaw, 0);
});
