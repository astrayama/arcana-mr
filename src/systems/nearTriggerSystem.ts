import { createSystem } from '@iwsdk/core';

/**
 * Near an object you can grab, IWSDK hides the controller ray and only the
 * grip squeezes. This lets the trigger grab too (IWSDK already does the same
 * for a hand's pinch), so a quick trigger press on the deck or a card nearby
 * counts as a tap and holding it picks the object up.
 */
export class NearTriggerSystem extends createSystem({}) {
  private readonly routed = { left: false, right: false };

  update(_delta: number, time: number): void {
    for (const hand of ['left', 'right'] as const) {
      if (!this.input.xr.isPrimary('controller', hand)) {
        this.routed[hand] = false;
        continue;
      }
      const pad = this.input.xr.gamepads[hand];
      const pointers = this.input.xr.multiPointers[hand];
      const timeStamp = time * 1000;
      if (pad?.getSelectStart() && pointers.getActiveKind() === 'grab') {
        pointers.routeDown('squeeze', 'grab', { timeStamp });
        this.routed[hand] = true;
      }
      if (pad?.getSelectEnd() && this.routed[hand]) {
        pointers.routeUp('squeeze', 'grab', { timeStamp });
        this.routed[hand] = false;
      }
    }
  }
}
