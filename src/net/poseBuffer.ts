/**
 * Smooth playback of someone else's hand moving a card or the deck. Poses
 * arrive about 20 times a second with the sender's timestamps; this plays
 * them back a little behind, interpolating between samples, so motion looks
 * continuous (including a quick shake) instead of jumping.
 */

import type { Q4, V3 } from './protocol.js';

export interface Pose {
  p: V3;
  q: Q4;
}

interface Sample extends Pose {
  ts: number;
}

/** How far behind the sender to play (seconds). */
const DELAY_S = 0.1;
/** How far past the last sample to keep moving (seconds). */
const MAX_EXTRAPOLATE_S = 0.1;
const MAX_SAMPLES = 24;

export function slerp(a: Q4, b: Q4, t: number, out: Q4): Q4 {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number;
  let k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    k0 = Math.sin((1 - t) * angle) / sin;
    k1 = Math.sin(t * angle) / sin;
  }
  out[0] = a[0] * k0 + bx * k1;
  out[1] = a[1] * k0 + by * k1;
  out[2] = a[2] * k0 + bz * k1;
  out[3] = a[3] * k0 + bw * k1;
  const length = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= length;
  return out;
}

export class PoseBuffer {
  private samples: Sample[] = [];
  /** Smallest (arrival - sent) seen: maps the sender's clock onto ours. */
  private offset = Infinity;

  push(pose: Pose, sentAt: number, receivedAt: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && sentAt <= last.ts) return;
    this.offset = Math.min(this.offset, receivedAt - sentAt);
    this.samples.push({ p: [...pose.p], q: [...pose.q], ts: sentAt });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get empty(): boolean {
    return this.samples.length === 0;
  }

  /** The pose to show at local time `now`, written into `out`. False if there's nothing yet. */
  sample(now: number, out: Pose): boolean {
    const samples = this.samples;
    if (samples.length === 0) return false;
    const at = now - this.offset - DELAY_S;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (samples.length === 1 || at <= first.ts) {
      copy(at <= first.ts ? first : last, out);
      return true;
    }
    if (at >= last.ts) {
      const prev = samples[samples.length - 2];
      const ahead = Math.min(at - last.ts, MAX_EXTRAPOLATE_S);
      const span = last.ts - prev.ts || 1;
      for (let i = 0; i < 3; i++) out.p[i] = last.p[i] + ((last.p[i] - prev.p[i]) / span) * ahead;
      for (let i = 0; i < 4; i++) out.q[i] = last.q[i];
      return true;
    }
    let i = 1;
    while (samples[i].ts < at) i++;
    const a = samples[i - 1];
    const b = samples[i];
    const t = (at - a.ts) / (b.ts - a.ts);
    for (let k = 0; k < 3; k++) out.p[k] = a.p[k] + (b.p[k] - a.p[k]) * t;
    slerp(a.q, b.q, t, out.q);
    return true;
  }

  clear(): void {
    this.samples = [];
    this.offset = Infinity;
  }
}

function copy(from: Pose, out: Pose): void {
  for (let i = 0; i < 3; i++) out.p[i] = from.p[i];
  for (let i = 0; i < 4; i++) out.q[i] = from.q[i];
}
