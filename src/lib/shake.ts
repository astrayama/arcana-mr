/**
 * Detects a shake from a stream of positions: several quick back-and-forth
 * strokes. Works on displacement rather than raw velocity, so tracking noise
 * and slow drifting don't count, and it never allocates per sample.
 */

export interface ShakeOptions {
  /** How far (meters) the hand must come back from a stroke's far point to count as a reversal. */
  reversalDistance: number;
  /** Longest a single stroke may take (seconds). */
  maxStrokeTime: number;
  /** Reversals needed to count as a shake. */
  reversals: number;
  /** ...within this window (seconds). */
  window: number;
  /** A jump bigger than this between samples (meters) is a tracking glitch; start over. */
  maxJump: number;
}

export const DEFAULT_SHAKE: ShakeOptions = {
  reversalDistance: 0.035,
  maxStrokeTime: 0.45,
  reversals: 3,
  window: 1.2,
  maxJump: 0.25,
};

export interface ShakeDetector {
  /** Feed a sample. Returns true once, on the sample that completes a shake. */
  push(time: number, x: number, y: number, z: number): boolean;
  /** Called with the running count each time a stroke reverses (for haptics). */
  onReversal: ((count: number) => void) | null;
  reset(): void;
}

export function createShakeDetector(options: ShakeOptions = DEFAULT_SHAKE): ShakeDetector {
  const reversalTimes = new Float64Array(16);
  let reversalCount = 0;
  let has = false;
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  // The current stroke: where it started, its farthest point, and when it started.
  let startX = 0;
  let startY = 0;
  let startZ = 0;
  let farX = 0;
  let farY = 0;
  let farZ = 0;
  let farDist = 0;
  let strokeStart = 0;
  let fired = false;

  const detector: ShakeDetector = {
    onReversal: null,
    reset() {
      has = false;
      reversalCount = 0;
      fired = false;
    },
    push(time, x, y, z) {
      if (fired) return false;
      if (!has || Math.hypot(x - lastX, y - lastY, z - lastZ) > options.maxJump) {
        has = true;
        reversalCount = 0;
        startX = farX = x;
        startY = farY = y;
        startZ = farZ = z;
        farDist = 0;
        strokeStart = time;
        lastX = x;
        lastY = y;
        lastZ = z;
        return false;
      }
      lastX = x;
      lastY = y;
      lastZ = z;

      const fromStart = Math.hypot(x - startX, y - startY, z - startZ);
      if (fromStart > farDist) {
        farDist = fromStart;
        farX = x;
        farY = y;
        farZ = z;
      }

      const backFromFar = Math.hypot(x - farX, y - farY, z - farZ);
      if (farDist >= options.reversalDistance && backFromFar >= options.reversalDistance) {
        const quick = time - strokeStart <= options.maxStrokeTime;
        if (quick) {
          // Keep only reversals inside the window.
          let kept = 0;
          for (let i = 0; i < reversalCount; i++) {
            if (time - reversalTimes[i] <= options.window) reversalTimes[kept++] = reversalTimes[i];
          }
          reversalCount = Math.min(kept, reversalTimes.length - 1);
          reversalTimes[reversalCount++] = time;
          detector.onReversal?.(reversalCount);
        } else {
          reversalCount = 0;
        }
        // The far point becomes the start of the next stroke.
        startX = farX;
        startY = farY;
        startZ = farZ;
        farX = x;
        farY = y;
        farZ = z;
        farDist = Math.hypot(x - startX, y - startY, z - startZ);
        strokeStart = time;
        if (reversalCount >= options.reversals) {
          fired = true;
          return true;
        }
      } else if (time - strokeStart > options.maxStrokeTime * 2) {
        // A slow drift isn't part of a shake; start a fresh stroke from here.
        startX = farX = x;
        startY = farY = y;
        startZ = farZ = z;
        farDist = 0;
        strokeStart = time;
      }
      return false;
    },
  };
  return detector;
}
