/**
 * Hand-pose math for telling a fist from a pinch, from tracked joint
 * positions. Pure functions on plain numbers, so it's testable without a
 * headset and never allocates per frame.
 */

/** The WebXR joints the fist check reads, in the order `fingerRatios` expects them. */
export const FIST_JOINTS = [
  'wrist',
  'index-finger-phalanx-proximal',
  'index-finger-tip',
  'middle-finger-phalanx-proximal',
  'middle-finger-tip',
  'ring-finger-phalanx-proximal',
  'ring-finger-tip',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-tip',
  'thumb-tip',
] as const;

export type FistJoint = (typeof FIST_JOINTS)[number];

/** Index of each joint in `FIST_JOINTS`, for reading packed positions. */
export const JOINT = Object.fromEntries(FIST_JOINTS.map((name, i) => [name, i])) as Record<FistJoint, number>;

/** How many fingers the fist check looks at (index, middle, ring, little). */
export const FINGER_COUNT = 4;

function distance(p: ArrayLike<number>, a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3];
  const dy = p[a * 3 + 1] - p[b * 3 + 1];
  const dz = p[a * 3 + 2] - p[b * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * How far a fingertip reaches from the wrist, relative to that finger's
 * knuckle. Scale-free, so it works for any hand size: about 2 for a straight
 * finger, 1.6 to 1.9 relaxed, and under 1 curled into a fist.
 */
export function curlRatio(positions: ArrayLike<number>, tip: number, knuckle: number): number {
  const reach = distance(positions, knuckle, JOINT.wrist);
  return reach > 1e-6 ? distance(positions, tip, JOINT.wrist) / reach : Infinity;
}

/**
 * Fill `out` with the curl ratio of the index, middle, ring and little finger.
 * `positions` holds x, y, z for each joint in `FIST_JOINTS` order.
 */
export function fingerRatios(positions: ArrayLike<number>, out: Float32Array | number[]): void {
  out[0] = curlRatio(positions, JOINT['index-finger-tip'], JOINT['index-finger-phalanx-proximal']);
  out[1] = curlRatio(positions, JOINT['middle-finger-tip'], JOINT['middle-finger-phalanx-proximal']);
  out[2] = curlRatio(positions, JOINT['ring-finger-tip'], JOINT['ring-finger-phalanx-proximal']);
  out[3] = curlRatio(positions, JOINT['pinky-finger-tip'], JOINT['pinky-finger-phalanx-proximal']);
}

export interface FistOptions {
  /** Every finger's curl ratio must drop below this to make a fist. */
  on: number;
  /** The fist opens once any finger's ratio rises above this. */
  off: number;
}

export const DEFAULT_FIST: FistOptions = { on: 1.3, off: 1.5 };

export interface FistDetector {
  /** Feed the four finger ratios for this frame. Returns whether the hand is a fist. */
  update(ratios: ArrayLike<number>): boolean;
  readonly active: boolean;
  reset(): void;
}

/**
 * A fist is all four fingers curled into the palm. A pinch always leaves the
 * index finger reaching out to meet the thumb, and pointing leaves it
 * straight, so neither reads as a fist even with the other fingers curled.
 * The gap between `on` and `off` keeps it from flickering at the edge.
 */
export function createFistDetector(options: FistOptions = DEFAULT_FIST): FistDetector {
  let active = false;
  return {
    update(ratios) {
      let curled = 0;
      let open = false;
      for (let i = 0; i < FINGER_COUNT; i++) {
        if (ratios[i] < options.on) curled++;
        if (ratios[i] > options.off) open = true;
      }
      if (!active && curled === FINGER_COUNT) active = true;
      else if (active && open) active = false;
      return active;
    },
    get active() {
      return active;
    },
    reset() {
      active = false;
    },
  };
}

/** A card let go with its face turned toward the sky lands face up. */
export function faceUpFromNormalY(y: number): boolean {
  return y > 0;
}
