import { createSystem } from '@iwsdk/core';

type Kind = 'grab' | 'ray';
interface MultiPointerInternals {
  pointerStates: Map<string, string>;
  getPointer(kind: Kind): { getIntersection(): { object?: { isVoidObject?: boolean } } | undefined };
  routeUp(kind: 'select' | 'squeeze', target: Kind, event: { timeStamp: number }): void;
}

/**
 * Works around an IWSDK input quirk: if the object a pointer is pressing on
 * disappears (a card swept away by "New reading", a deck that stops taking
 * grabs mid-shuffle), IWSDK never processes the release, and that hand's
 * pointers stay frozen in a selection. When a pointer is selecting nothing
 * while its button is physically up, this releases it.
 */
export class PointerSafetySystem extends createSystem({}) {
  update(_delta: number, time: number): void {
    for (const hand of ['left', 'right'] as const) {
      const pointers = this.input.xr.multiPointers[hand] as unknown as MultiPointerInternals;
      const pad = this.input.xr.gamepads[hand];
      for (const kind of ['grab', 'ray'] as const) {
        if (pointers.pointerStates.get(kind) !== 'select') continue;
        const hit = pointers.getPointer(kind).getIntersection();
        if (hit?.object && !hit.object.isVoidObject) continue;
        const stillHeld =
          kind === 'ray'
            ? pad?.getSelecting()
            : pad?.getButtonPressed('xr-standard-squeeze') || pad?.getSelecting();
        if (stillHeld) continue;
        pointers.routeUp(kind === 'grab' ? 'squeeze' : 'select', kind, { timeStamp: time * 1000 });
        pointers.pointerStates.set(kind, 'normal');
      }
    }
  }
}
