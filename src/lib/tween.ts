/**
 * Minimal tweening for card motion. Tweens are created when something happens
 * (a deal, a flip), never per frame, and advanced by a system's update().
 */

export type Easing = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => {
    const c1 = 1.4;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Easing>;

export interface TweenOptions {
  duration: number;
  delay?: number;
  easing?: Easing;
  /** Called once, on the first frame after the delay. */
  onStart?: () => void;
  /** Called every frame with eased progress from 0 to 1. */
  onUpdate: (t: number) => void;
  onDone?: () => void;
}

interface Tween extends TweenOptions {
  elapsed: number;
  started: boolean;
}

export class Tweens {
  private active: Tween[] = [];
  private added: Tween[] = [];

  get busy(): boolean {
    return this.active.length + this.added.length > 0;
  }

  add(options: TweenOptions): void {
    this.added.push({ ...options, elapsed: 0, started: false });
  }

  /** Add a tween and resolve when it finishes. */
  play(options: Omit<TweenOptions, 'onDone'>): Promise<void> {
    return new Promise((resolve) => this.add({ ...options, onDone: resolve }));
  }

  update(delta: number): void {
    if (this.added.length > 0) {
      this.active.push(...this.added);
      this.added.length = 0;
    }
    if (this.active.length === 0) return;

    let write = 0;
    for (let read = 0; read < this.active.length; read++) {
      const tween = this.active[read];
      const delay = tween.delay ?? 0;
      tween.elapsed += delta;
      if (tween.elapsed < delay) {
        this.active[write++] = tween;
        continue;
      }
      if (!tween.started) {
        tween.started = true;
        tween.onStart?.();
      }
      const t = Math.min((tween.elapsed - delay) / Math.max(tween.duration, 1e-4), 1);
      tween.onUpdate((tween.easing ?? ease.inOutCubic)(t));
      if (t < 1) {
        this.active[write++] = tween;
      } else {
        tween.onDone?.();
      }
    }
    this.active.length = write;
  }

  /** Drop every running tween without finishing it. */
  clear(): void {
    this.active.length = 0;
    this.added.length = 0;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
