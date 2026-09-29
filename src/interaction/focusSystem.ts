import { createSystem, type Object3D } from '@iwsdk/core';

type Hand = 'left' | 'right';

/**
 * Tracks what each hand would act on right now, so it can glow. Up close
 * that's whatever the table grab would pick up (set by the grab system each
 * frame); from a distance it's whatever the hand's ray is touching. Table
 * objects register the meshes that stand for them and glow when "hot".
 */
export class FocusSystem extends createSystem({}) {
  private readonly owners = new Map<Object3D, Object3D>();
  private readonly hot = new Set<Object3D>();
  private readonly nearHot = new Set<Object3D>();
  private readonly near: Record<Hand, Object3D | null> = { left: null, right: null };

  /** `owner` counts as focused when any of `parts` (or their children) is hit. */
  register(owner: Object3D, ...parts: Object3D[]): void {
    this.owners.set(owner, owner);
    for (const part of parts) this.owners.set(part, owner);
  }

  unregister(owner: Object3D, ...parts: Object3D[]): void {
    this.owners.delete(owner);
    for (const part of parts) this.owners.delete(part);
    this.hot.delete(owner);
    this.nearHot.delete(owner);
    if (this.near.left === owner) this.near.left = null;
    if (this.near.right === owner) this.near.right = null;
  }

  /** What a hand would pick up if it pinched or closed now (null when nothing is in reach). */
  setNear(hand: Hand, owner: Object3D | null): void {
    this.near[hand] = owner;
  }

  isHot(owner: Object3D): boolean {
    return this.hot.has(owner);
  }

  /** Hot because a hand is close enough to pick it up (not just pointing at it). */
  isNearHot(owner: Object3D): boolean {
    return this.nearHot.has(owner);
  }

  update(): void {
    this.hot.clear();
    this.nearHot.clear();
    for (const hand of ['left', 'right'] as const) {
      const near = this.near[hand];
      if (near) {
        this.hot.add(near);
        this.nearHot.add(near);
        continue;
      }
      const pointers = this.input.xr.multiPointers[hand];
      const kind = pointers.getActiveKind();
      if (kind !== 'grab' && kind !== 'ray') continue;
      const hit = pointers.getPointer(kind).getIntersection() as
        | { object?: Object3D & { isVoidObject?: boolean } }
        | undefined;
      let object: Object3D | null | undefined = hit?.object;
      if (!object || object.isVoidObject) continue;
      while (object) {
        const owner = this.owners.get(object);
        if (owner) {
          this.hot.add(owner);
          break;
        }
        object = object.parent;
      }
    }
  }
}
