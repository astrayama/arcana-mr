import { createSystem, Grabbed, Pressed, type Entity } from '@iwsdk/core';
import { app } from '../app/context.js';
import { TableHandle } from '../components/table.js';
import { TarotCard } from '../components/tarotCard.js';
import { ease, lerp } from '../lib/tween.js';
import { slotPosition } from '../visuals/layout.js';
import { MAT_SURFACE_Y } from '../visuals/tableVisuals.js';
import { MeaningSystem } from './meaningSystem.js';
import { TableSystem, type TableCard } from './tableSystem.js';

const FLIP_SECONDS = 0.6;
const FLIP_LIFT_M = 0.05;
const RETURN_SECONDS = 0.3;
/** Ignore presses that began before the card landed (a trigger still held from drawing). */
const LANDING_GRACE_S = 0.1;

/**
 * Cards in the spread. Tap one (controller trigger or hand pinch from a
 * distance, or a quick grab up close) to turn it over, or to bring its meaning
 * into focus once it's face up. Pick one up to look at it closely: when you
 * let go it glides back to its own spot, the way it was.
 */
export class CardInteractionSystem extends createSystem({
  pressed: { required: [TarotCard, Pressed] },
  heldHandles: { required: [TableHandle, Grabbed] },
}) {
  private table!: TableSystem;
  private meaning!: MeaningSystem;

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.meaning = this.world.getSystem(MeaningSystem)!;

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        const card = this.table.cardForEntity(entity);
        if (!card || card.phase !== 'placed' || card.handle.held) return;
        if (this.table.now - card.landedAt < LANDING_GRACE_S) return;
        this.tap(card);
      }),
      this.queries.heldHandles.subscribe('qualify', (entity) => {
        const card = this.placedByHandle(entity);
        if (!card) return;
        card.motion?.cancel();
        card.handle.markGrabStart(this.table.now);
      }),
      this.queries.heldHandles.subscribe('disqualify', (entity) => {
        const card = this.placedByHandle(entity);
        if (!card) return;
        if (card.handle.wasTap(this.table.now)) this.tap(card);
        this.returnToSpot(card);
      }),
    );
  }

  update(): void {
    for (const card of this.table.cards) {
      if (card.phase !== 'placed') continue;
      if (card.handle.held) card.handle.readInto(card.visual.root);
      else if (!card.motion) card.handle.syncFrom(card.visual.root);
    }
  }

  private placedByHandle(entity: Entity): TableCard | undefined {
    const card = this.table.cardForHandle(entity);
    return card?.phase === 'placed' ? card : undefined;
  }

  /** Turn a face-down card over; a face-up one brings its meaning into focus. */
  private tap(card: TableCard): void {
    if (card.faceUp) {
      this.meaning.focus(card.slot);
      return;
    }
    // The state machine is the gatekeeper: it ignores flips it doesn't allow.
    if (!app.machine.send({ type: 'FLIP', slot: card.slot })) return;
    card.faceUp = true;
    card.entity.setValue(TarotCard, 'faceUp', true);
    const pivot = card.visual.pivot;
    this.table.tweens.add({
      duration: FLIP_SECONDS,
      easing: ease.inOutCubic,
      onUpdate: (k) => {
        pivot.rotation.z = Math.PI * (1 - k);
        card.flipLift = Math.sin(Math.PI * k) * FLIP_LIFT_M;
      },
      onDone: () => {
        card.flipLift = 0;
      },
    });
  }

  /** Glide back to the card's own spot and orientation. */
  private returnToSpot(card: TableCard): void {
    const spread = app.machine.current.spread;
    if (!spread || card.phase !== 'placed') return;
    const root = card.visual.root;
    const to = slotPosition(spread, card.slot);
    const toYaw = card.reversed ? Math.PI : 0;
    const from = root.position.clone();
    const fromYaw = root.rotation.y;
    // Turn the short way round.
    const turn = Math.atan2(Math.sin(toYaw - fromYaw), Math.cos(toYaw - fromYaw));
    void this.table.move(card, {
      duration: RETURN_SECONDS,
      easing: ease.outCubic,
      onUpdate: (k) => {
        root.position.set(lerp(from.x, to.x, k), lerp(from.y, MAT_SURFACE_Y, k), lerp(from.z, to.z, k));
        root.rotation.set(0, fromYaw + turn * k, 0);
      },
    });
  }
}
