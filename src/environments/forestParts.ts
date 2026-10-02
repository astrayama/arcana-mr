/**
 * Low-poly parts for the fairy circle: pebbles, mushrooms, moss, grass,
 * ferns, flowers, trees, and a fallen log. Each is one small geometry with
 * its base at y = 0 (where it meets the ground) and about a meter across or
 * tall, so the scene can instance it many times at different sizes.
 * Deterministic: the same random source gives the same shapes every time.
 */

import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Vector2,
} from '@iwsdk/core';

type Random = () => number;

/** Join geometries into one, unindexed, with flat normals (the low-poly look). */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = flat.reduce((n, g) => n + g.attributes.position.count, 0);
  const positions = new Float32Array(total * 3);
  let at = 0;
  for (const g of flat) {
    positions.set(g.attributes.position.array as ArrayLike<number>, at);
    at += g.attributes.position.count * 3;
  }
  for (const g of new Set([...parts, ...flat])) g.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(positions, 3));
  out.computeVertexNormals();
  return out;
}

/**
 * Nudge every corner of a shape by up to `amount`, keeping shared corners
 * together so faces stay closed (a rough, hand-cut look).
 */
function jitter(geometry: BufferGeometry, amount: number, random: Random): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const p = g.attributes.position;
  const offsets = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    // Centimeter keys: corners meant to coincide (seams, the axis of a lathe) move together.
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    let o = offsets.get(key);
    if (!o) offsets.set(key, (o = [(random() - 0.5) * amount, (random() - 0.5) * amount, (random() - 0.5) * amount]));
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** A flat river pebble, about 2 units across, sitting just into the ground. */
export function pebble(random: Random): BufferGeometry {
  const g = jitter(new IcosahedronGeometry(1, 1), 0.28, random);
  g.scale(1, 0.3, 0.78);
  g.translate(0, 0.18, 0);
  return g;
}

/** A soft cushion of moss, mostly below the ground with a rounded top showing. */
export function mossMound(random: Random): BufferGeometry {
  const g = jitter(new IcosahedronGeometry(1, 1), 0.35, random);
  g.scale(1, 0.4, 1);
  g.translate(0, -0.12, 0);
  return g;
}

/** A mushroom stem, 1 tall, a little thicker at the foot. */
export function mushroomStem(): BufferGeometry {
  const profile = [
    new Vector2(0.17, 0),
    new Vector2(0.14, 0.25),
    new Vector2(0.11, 0.7),
    new Vector2(0.12, 1),
  ];
  return merge([new LatheGeometry(profile, 6)]);
}

/** Cap height relative to its 1-unit radius; the dome the spots sit on. */
const CAP_DOME = { centerY: 0.06, height: 0.54 };

/** A domed mushroom cap, 2 across, its rim at y = 0 so it sits on top of a stem. */
export function mushroomCap(): BufferGeometry {
  const profile = [
    new Vector2(0.001, 0),
    new Vector2(0.86, 0.02),
    new Vector2(1, 0.09),
    new Vector2(0.93, 0.32),
    new Vector2(0.63, 0.53),
    new Vector2(0.001, CAP_DOME.centerY + CAP_DOME.height),
  ];
  return merge([new LatheGeometry(profile, 9)]);
}

/**
 * A point on a cap's dome and the direction straight out of it, for setting
 * spots on the surface. `around` is 0..1 around the cap; `down` is 0 at the
 * top to 1 near the rim.
 */
export function capSurface(around: number, down: number): { p: [number, number, number]; n: [number, number, number] } {
  const phi = 0.2 + down * 0.95;
  const theta = around * Math.PI * 2;
  const x = Math.sin(phi) * Math.cos(theta);
  const z = Math.sin(phi) * Math.sin(theta);
  const y = CAP_DOME.centerY + CAP_DOME.height * Math.cos(phi);
  // The outward direction of an ellipsoid: each axis divided by its radius squared.
  const nx = x;
  const ny = (y - CAP_DOME.centerY) / (CAP_DOME.height * CAP_DOME.height);
  const nz = z;
  const len = Math.hypot(nx, ny, nz);
  return { p: [x * 0.97, y * 0.97, z * 0.97], n: [nx / len, ny / len, nz / len] };
}

/** A white wart for a red cap: a flat little disc, its thickness along +Y. */
export function capSpot(random: Random): BufferGeometry {
  const g = jitter(new IcosahedronGeometry(1, 0), 0.25, random);
  g.scale(1, 0.35, 1);
  return g;
}

/** A tuft of grass: five thin blades splaying out, 1 tall. */
export function grassTuft(random: Random): BufferGeometry {
  const positions: number[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2 + random() * 0.8;
    const lean = 0.15 + random() * 0.3;
    const height = 0.65 + random() * 0.35;
    const width = 0.05;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Base corners across the blade, tip leaning outward.
    positions.push(-s * width, 0, c * width, s * width, 0, -c * width, c * lean, height, s * lean);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  return g;
}

/** A fern: seven arching fronds, about 1 tall and 2 across. */
export function fern(random: Random): BufferGeometry {
  const positions: number[] = [];
  const fronds = 7;
  const steps = 6;
  for (let f = 0; f < fronds; f++) {
    const angle = (f / fronds) * Math.PI * 2 + random() * 0.5;
    const length = 0.8 + random() * 0.25;
    const rise = 0.55 + random() * 0.3;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Along the frond: out and up, then drooping at the tip; widest in the middle.
    const point = (t: number, side: number) => {
      const out = t * length;
      const up = rise * Math.sin(Math.PI * t * 0.85);
      const half = 0.13 * Math.sin(Math.PI * t) * side;
      return [c * out - s * half, up, s * out + c * half];
    };
    for (let i = 0; i < steps; i++) {
      const a = i / steps;
      const b = (i + 1) / steps;
      const al = point(a, 1);
      const ar = point(a, -1);
      const bl = point(b, 1);
      const br = point(b, -1);
      positions.push(...al, ...ar, ...bl, ...ar, ...br, ...bl);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  return g;
}

/** A flower stem, 1 tall and very thin. */
export function flowerStem(): BufferGeometry {
  const g = new CylinderGeometry(0.012, 0.016, 1, 3, 1);
  g.translate(0, 0.5, 0);
  return merge([g]);
}

/** A small five-petal flower head, opening upward, about 0.12 across. */
export function flowerHead(): BufferGeometry {
  const g = new ConeGeometry(0.06, 0.035, 5, 1);
  g.rotateX(Math.PI);
  g.translate(0, 0.018, 0);
  return merge([g]);
}

/** A tree trunk with a flared root base, 1 tall and about 0.6 across at the foot. */
export function trunk(random: Random): BufferGeometry {
  const profile = [
    new Vector2(0.3, -0.05),
    new Vector2(0.2, 0.05),
    new Vector2(0.14, 0.16),
    new Vector2(0.11, 0.6),
    new Vector2(0.08, 1),
  ];
  return jitter(new LatheGeometry(profile, 7), 0.025, random);
}

/** A cut stump: the trunk's flared foot, 1 tall, with a flat top. */
export function stump(random: Random): BufferGeometry {
  const profile = [
    new Vector2(0.001, -0.05),
    new Vector2(0.62, -0.05),
    new Vector2(0.44, 0.15),
    new Vector2(0.34, 0.45),
    new Vector2(0.32, 1),
    new Vector2(0.001, 1),
  ];
  return jitter(new LatheGeometry(profile, 8), 0.04, random);
}

/** A pine's foliage: three stacked tiers, 1 tall and 1.6 across, its base at y = 0. */
export function pineCanopy(random: Random): BufferGeometry {
  const tiers = [
    { r: 0.8, h: 0.5, y: 0.25 },
    { r: 0.62, h: 0.45, y: 0.52 },
    { r: 0.42, h: 0.4, y: 0.8 },
  ].map(({ r, h, y }) => {
    const cone = new ConeGeometry(r, h, 7, 1);
    cone.translate(0, y, 0);
    return cone;
  });
  return jitter(merge(tiers), 0.06, random);
}

/** A broadleaf crown: three overlapping lumps, about 1.6 across and 1.2 tall, base at y = 0. */
export function leafyCanopy(random: Random): BufferGeometry {
  const lumps = [
    { r: 0.62, x: 0, y: 0.6, z: 0 },
    { r: 0.45, x: 0.42, y: 0.42, z: 0.12 },
    { r: 0.48, x: -0.32, y: 0.45, z: -0.25 },
  ].map(({ r, x, y, z }) => {
    const lump = new IcosahedronGeometry(r, 1);
    lump.translate(x, y, z);
    return lump;
  });
  return jitter(merge(lumps), 0.1, random);
}

/** A fallen log lying along X, 1 long and about 0.3 thick, resting on the ground. */
export function fallenLog(random: Random): BufferGeometry {
  const g = new CylinderGeometry(0.15, 0.17, 1, 7, 2);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.13, 0);
  return jitter(g, 0.03, random);
}
