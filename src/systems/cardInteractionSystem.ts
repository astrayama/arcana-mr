import { createSystem, Pressed, Quaternion, Vector3 } from '@iwsdk/core';
import { app } from '../app/context.js';
import { TarotCard } from '../components/tarotCard.js';
import { faceUpFromNormalY } from '../lib/handPose.js';
import { ease, lerp, type TweenHandle } from '../lib/tween.js';
import { MeaningSystem } from './meaningSystem.js';
import { TableGrabSystem } from './tableGrabSystem.js';
import { TableSystem, type TableCard } from './tableSystem.js';

const FLIP_SECONDS = 0.6;
const FLIP_LIFT_M = 0.05;
const SETTLE_SECONDS = 0.35;
/** Ignore presses that began before the card landed (a trigger still held from drawing). */
const LANDING_GRACE_S = 0.1;
const UP = new Vector3(0, 1, 0);

/**
 * Cards in the hand and in the spread. Pick a card up (pinch, or the
 * trigger up close) and it follows your hand; turn your hand over and the
 * card turns with it. Let go and it glides to its own spot, landing face up
 * or face down the way you left it. A quick tap turns a face-down card over,
 * or brings a face-up card's meaning into focus. Cards can be turned in any
 * order, and turned back down again.
 */
export class CardInteractionSystem extends createSystem({
  pressed: { required: [TarotCard, Pressed] },
}) {
  private table!: TableSystem;
  private meaning!: MeaningSystem;
  private readonly flips = new Map<TableCard, TweenHandle>();
  private readonly normal = new Vector3();
  private readonly pivotBefore = new Quaternion();
  private readonly pivotAfter = new Quaternion();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.meaning = this.world.getSystem(MeaningSystem)!;
    this.world.getSystem(TableGrabSystem)!.cardHandlers = {
      onGrab: (card) => {
        card.motion?.cancel();
        this.finishFlip(card);
      },
      onRelease: (card, tap, fromDeck) => this.letGo(card, tap, fromDeck),
    };

    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        const card = this.table.cardForEntity(entity);
        if (!card || card.phase !== 'placed' || card.heldBy) return;
        if (this.table.now - card.landedAt < LANDING_GRACE_S) return;
        this.tap(card);
      }),
    );
  }

  private letGo(card: TableCard, tap: boolean, fromDeck: boolean): void {
    if (tap && !fromDeck) {
      // A quick pinch on a card in the spread, like touching it.
      this.settle(card);
      this.tap(card);
      return;
    }
    // Whichever way up it was let go is the way it lands.
    card.visual.face.getWorldDirection(this.normal);
    const faceUp = faceUpFromNormalY(this.normal.y);
    if (faceUp !== card.faceUp) this.turn(card, faceUp);
    this.settle(card);
  }

  /** Tell the reading a card turned over. Returns false if it wasn't allowed. */
  private turn(card: TableCard, faceUp: boolean): boolean {
    if (!app.machine.send({ type: 'TURN', slot: card.slot, faceUp })) return false;
    card.faceUp = faceUp;
    if (card.entity.hasComponent(TarotCard)) card.entity.setValue(TarotCard, 'faceUp', faceUp);
    return true;
  }

  /** Turn a face-down card over; a face-up one brings its meaning into focus. */
  private tap(card: TableCard): void {
    if (card.faceUp) {
      this.meaning.focus(card.slot);
      return;
    }
    if (!this.turn(card, true)) return;
    const pivot = card.visual.pivot;
    this.flips.get(card)?.cancel();
    const handle = this.table.tweens.add({
      duration: FLIP_SECONDS,
      easing: ease.inOutCubic,
      onUpdate: (k) => {
        pivot.rotation.z = Math.PI * (1 - k);
        card.flipLift = Math.sin(Math.PI * k) * FLIP_LIFT_M;
      },
      onDone: () => {
        card.flipLift = 0;
        this.flips.delete(card);
      },
    });
    this.flips.set(card, handle);
  }

  /** Jump a flip in progress to its end, so a card picked up mid-flip is already turned. */
  private finishFlip(card: TableCard): void {
    const flip = this.flips.get(card);
    if (!flip) return;
    flip.cancel();
    this.flips.delete(card);
    card.flipLift = 0;
    card.visual.pivot.rotation.z = card.faceUp ? 0 : Math.PI;
  }

  /**
   * Glide to the card's own spot, lying flat, upright or reversed as it was
   * drawn, and face up or down as it is now.
   */
  private settle(card: TableCard): void {
    const to = this.table.slotPose(card.slot);
    if (!to || card.phase === 'gathering') return;
    const root = card.visual.root;
    const pivot = card.visual.pivot;

    // The pivot holds the face-up or face-down turn; the root holds everything
    // the hand did. Move the turn into its final place without the card
    // visibly jumping, then let the root glide flat.
    this.pivotBefore.copy(pivot.quaternion);
    pivot.rotation.set(0, 0, card.faceUp ? 0 : Math.PI);
    this.pivotAfter.copy(pivot.quaternion).invert();
    root.quaternion.multiply(this.pivotBefore).multiply(this.pivotAfter);

    const from = root.position.clone();
    const fromQuat = root.quaternion.clone();
    const toQuat = new Quaternion().setFromAxisAngle(UP, to.yaw + (card.reversed ? Math.PI : 0));
    if (card.phase === 'held') card.phase = 'flying';
    void this.table
      .move(card, {
        duration: SETTLE_SECONDS,
        easing: ease.outCubic,
        onUpdate: (k) => {
          root.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k), lerp(from.z, to.z, k));
          root.quaternion.slerpQuaternions(fromQuat, toQuat, k);
        },
      })
      .then((done) => {
        if (done) this.table.land(card);
      });
  }
}
