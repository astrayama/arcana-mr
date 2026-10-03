/**
 * Telling a deliberate shake of a phone from ordinary handling: a few sharp
 * jolts in quick succession, then a rest before the next shake counts.
 * Pure, so it can be tested without a phone.
 */

export interface ShakeOptions {
  /** Jolt strength in m/s², with gravity left out. */
  jolt: number;
  /** Jolts needed within the window. */
  jolts: number;
  windowMs: number;
  /** Jolts closer together than this are one jolt. */
  gapMs: number;
  /** After a shake, ignore jolts for this long. */
  restMs: number;
}

export const PHONE_SHAKE: ShakeOptions = { jolt: 13, jolts: 3, windowMs: 1200, gapMs: 120, restMs: 1500 };

/** Answers true on the reading that completes a shake; `reset` forgets any jolts and rest so far. */
export type PhoneShake = ((strength: number, now: number) => boolean) & { reset(): void };

interface Vec {
  x: number | null;
  y: number | null;
  z: number | null;
}

/** How hard the phone is being moved, from a motion reading (gravity removed where possible). */
export function motionStrength(e: { acceleration?: Vec | null; accelerationIncludingGravity?: Vec | null }): number | null {
  const a = e.acceleration;
  if (a && a.x !== null && a.y !== null && a.z !== null) return Math.hypot(a.x, a.y, a.z);
  const g = e.accelerationIncludingGravity;
  if (!g || g.x === null || g.y === null || g.z === null) return null;
  return Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
}

/** Feed it motion strengths with times; it answers true on the reading that completes a shake. */
export function createPhoneShake(options: ShakeOptions = PHONE_SHAKE): PhoneShake {
  const jolts: number[] = [];
  let lastJolt = -Infinity;
  let lastShake = -Infinity;
  const feel = (strength: number, now: number) => {
    if (strength < options.jolt || now - lastJolt < options.gapMs) return false;
    lastJolt = now;
    if (now - lastShake < options.restMs) return false;
    jolts.push(now);
    while (jolts.length && now - jolts[0] > options.windowMs) jolts.shift();
    if (jolts.length < options.jolts) return false;
    jolts.length = 0;
    lastShake = now;
    return true;
  };
  return Object.assign(feel, {
    reset() {
      jolts.length = 0;
      lastJolt = -Infinity;
      lastShake = -Infinity;
    },
  });
}
