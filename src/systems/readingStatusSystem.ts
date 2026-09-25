import { createSystem } from '@iwsdk/core';
import { app } from '../app/context.js';
import { ReadingStatus } from '../components/ui.js';
import type { ReadingSnapshot } from '../state/readingMachine.js';

/** Mirrors the reading state machine onto an ECS entity for inspection and tests. */
export class ReadingStatusSystem extends createSystem({}) {
  init(): void {
    const entity = this.world.createTransformEntity(undefined, { persistent: true });
    entity.object3D!.name = 'ReadingStatus';
    entity.addComponent(ReadingStatus, {
      deck: app.deck.manifest.id,
      theme: app.theme.theme.id,
    });
    const write = (s: ReadingSnapshot) => {
      entity.setValue(ReadingStatus, 'state', s.state);
      entity.setValue(ReadingStatus, 'spread', s.spread ?? '');
      entity.setValue(ReadingStatus, 'readingNumber', s.readingNumber);
      entity.setValue(
        ReadingStatus,
        'slots',
        s.slots
          .map((slot) => `${slot.cardId}:${slot.reversed ? 'R' : 'U'}:${slot.faceUp ? 'up' : 'down'}`)
          .join(','),
      );
    };
    write(app.machine.current);
    this.cleanupFuncs.push(app.machine.subscribe(write));
  }
}
