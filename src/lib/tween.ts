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
  cancelled: boolean;
  onCancel?: () => void;
}

/** Stops a running tween where it is, without calling onDone. */
export interface TweenHandle {
  cancel(): void;
}

export class Tweens {
  private active: Tween[] = [];
  private added: Tween[] = [];

  get busy(): boolean {
    return this.active.length + this.added.length > 0;
  }

  add(options: TweenOptions): TweenHandle {
    const tween: Tween = { ...options, elapsed: 0, started: false, cancelled: false };
    this.added.push(tween);
    return {
      cancel: () => {
        if (tween.cancelled) return;
        tween.cancelled = true;
        tween.onCancel?.();
      },
    };
  }

  /**
   * Add a tween and resolve when it ends: true if it finished, false if it was
   * cancelled. Pass `handle` to receive its cancel handle.
   */
  play(
    options: Omit<TweenOptions, 'onDone'>,
    handle?: (h: TweenHandle) => void,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const h = this.add({ ...options, onDone: () => resolve(true) });
      const tween = this.added[this.added.length - 1];
      tween.onCancel = () => resolve(false);
      handle?.(h);
    });
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
      if (tween.cancelled) continue;
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

  /** Cancel every running tween. */
  clear(): void {
    for (const tween of [...this.active, ...this.added]) {
      if (!tween.cancelled) {
        tween.cancelled = true;
        tween.onCancel?.();
      }
    }
    this.active.length = 0;
    this.added.length = 0;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
