import { createSystem, type Object3D } from '@iwsdk/core';

/**
 * Tracks what each hand would act on right now: whatever the active near-grab
 * or ray pointer is touching. Table objects register the meshes that stand for
 * them (including invisible grab handles), and glow when they are "hot". This
 * matches the object a pinch, squeeze, or trigger would actually affect.
 */
export class FocusSystem extends createSystem({}) {
  private readonly owners = new Map<Object3D, Object3D>();
  private readonly hot = new Set<Object3D>();

  /** `owner` counts as focused when any of `parts` (or their children) is hit. */
  register(owner: Object3D, ...parts: Object3D[]): void {
    this.owners.set(owner, owner);
    for (const part of parts) this.owners.set(part, owner);
  }

  unregister(owner: Object3D, ...parts: Object3D[]): void {
    this.owners.delete(owner);
    for (const part of parts) this.owners.delete(part);
    this.hot.delete(owner);
  }

  isHot(owner: Object3D): boolean {
    return this.hot.has(owner);
  }

  update(): void {
    this.hot.clear();
    for (const hand of ['left', 'right'] as const) {
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
