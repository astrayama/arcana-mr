import { createSystem, Pressed, Quaternion, RayInteractable, Vector3, type Object3D } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { DeckPile } from '../components/table.js';
import { FocusSystem } from '../interaction/focusSystem.js';
import { createShakeDetector } from '../lib/shake.js';
import { ease, lerp, Tweens, type TweenHandle } from '../lib/tween.js';
import { allowed } from '../net/permissions.js';
import { permissionContext } from '../net/session.js';
import type { Origin, ReadingSnapshot } from '../state/readingMachine.js';
import { buildCard, deckStackHeight, type CardVisual } from '../visuals/tableVisuals.js';
import { TableGrabSystem } from './tableGrabSystem.js';
import { TableSystem } from './tableSystem.js';

const SHUFFLE_CARDS = 8;
const HOME_SECONDS = 0.3;

/**
 * The deck. Before the first shuffle, tapping it shuffles; after that, a tap
 * sends the next card to its spot. Lift it (close your hand around it, or
 * squeeze the grip) and give it a shake to shuffle it right there in your
 * hand, as often as you like while there are spots left to fill. Let go and
 * it glides back to its place on the mat.
 */
export class DeckSystem extends createSystem({
  pressed: { required: [DeckPile, Pressed] },
}) {
  private table!: TableSystem;
  private grab!: TableGrabSystem;
  private deck!: Object3D;
  private readonly tweens = new Tweens();
  private readonly shake = createShakeDetector();
  private homing: TweenHandle | null = null;
  private shuffling = false;
  private rig!: Object3D;
  private readonly rigCards: CardVisual[] = [];
  private readonly homePosition = new Vector3();
  private readonly homeQuaternion = new Quaternion();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.grab = this.world.getSystem(TableGrabSystem)!;
    this.deck = this.table.deck.object3D!;
    this.homePosition.copy(this.deck.position);
    this.homeQuaternion.copy(this.deck.quaternion);
    // Each spread has its own place for the deck.
    this.cleanupFuncs.push(
      this.table.onLayout((layout) => {
        this.homePosition.set(layout.deck.x, this.homePosition.y, layout.deck.z);
        this.goHome();
      }),
    );
    this.world.getSystem(FocusSystem)!.register(this.deck);

    // Loose cards for the riffle, riding on top of the deck so the shuffle
    // happens wherever the deck is, in a hand or on the mat.
    const rigEntity = this.world.createTransformEntity(undefined, { parent: this.table.deck });
    this.rig = rigEntity.object3D!;
    this.rig.name = 'ShuffleRig';
    this.rig.visible = false;
    this.buildRig();
    this.cleanupFuncs.push(this.table.onDeckChange(() => this.buildRig()));

    this.grab.deckHandlers = {
      onGrab: (hand) => {
        this.homing?.cancel();
        this.homing = null;
        this.shake.reset();
        this.table.deckHeld = true;
        this.grab.pulse(hand, 0.2, 20);
      },
      onRelease: (_hand, tap) => {
        this.table.deckHeld = false;
        // A quick squeeze on the deck shuffles it, when a tap would.
        if (tap && this.tapShuffles()) this.requestShuffle();
        this.goHome();
      },
      onTopTap: () => this.tap(),
    };

    this.shake.onReversal = () => {
      const hand = this.grab.holderOf(this.deck);
      if (hand) this.grab.pulse(hand, 0.3, 25);
    };

    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'SHUFFLE') void this.runShuffle(snapshot, event.passes ?? 2);
        if (event.type === 'RESTORE') this.table.deckHeld = false;
        if (event.type === 'NEW_READING') {
          this.table.deckHeld = false;
          this.goHome();
        }
        this.refresh();
      }),
      // Act when the trigger or pinch is released, like a click. Acting on press
      // and then changing the deck's state mid-press can leave IWSDK's ray stuck.
      this.queries.pressed.subscribe('disqualify', () => this.tap()),
    );
    this.refresh();
  }

  /** The riffle's loose cards, shaped like the deck in use. */
  private buildRig(): void {
    for (const card of this.rigCards) {
      card.root.removeFromParent();
      card.glow.material.dispose();
      card.face.material.dispose();
    }
    this.rigCards.length = 0;
    for (let i = 0; i < SHUFFLE_CARDS; i++) {
      const card = buildCard(this.table.cardMaterials, this.table.geometry);
      card.glow.visible = false;
      this.rigCards.push(card);
      this.rig.add(card.root);
    }
  }

  update(delta: number): void {
    this.tweens.update(delta);
    const hand = this.grab.holderOf(this.deck);
    if (!hand) return;
    const p = this.deck.position;
    if (this.shake.push(this.table.now, p.x, p.y, p.z)) {
      if (this.requestShuffle()) this.grab.pulse(hand, 0.8, 80);
      else this.shake.reset();
    }
  }

  /**
   * A tap on the deck: shuffle before the first shuffle, then draw the next
   * card. Someone who shuffles but doesn't draw (a guest, when guests shuffle)
   * shuffles what's left instead, as often as they like.
   */
  private tap(): void {
    if (this.tapShuffles()) this.requestShuffle();
    else if (app.machine.state === 'DRAWING') app.machine.send({ type: 'DRAW' });
  }

  /** Whether a tap on the deck shuffles it right now (rather than drawing, or nothing). */
  private tapShuffles(): boolean {
    const state = app.machine.state;
    const ctx = permissionContext();
    if (state === 'READY') return allowed(ctx, 'shuffle') !== 'no';
    return state === 'DRAWING' && allowed(ctx, 'draw') !== 'yes' && allowed(ctx, 'shuffle') !== 'no';
  }

  /**
   * Shuffle, from a tap or a shake (or, on a shared reading's host, the
   * guest's shake). In a shared reading a guest's request goes to the host,
   * and this returns true once it's on its way.
   */
  requestShuffle(origin: Origin = 'local'): boolean {
    if (this.shuffling) return false;
    // One quick riffle when shaken in the hand, a fuller one when tapped.
    const passes: 1 | 2 = origin === 'intent' || this.grab.holderOf(this.deck) ? 1 : 2;
    return app.machine.send({ type: 'SHUFFLE', passes }, origin);
  }

  /** A guest's shuffle request was turned down or went unanswered: listen for the next shake. */
  intentEnded(): void {
    this.shake.reset();
  }

  /** Whether a riffle is playing. */
  get busy(): boolean {
    return this.shuffling;
  }

  /** The other person in a shared reading lifted the deck, or put it down. */
  remoteHeld(on: boolean): void {
    this.table.deckHeld = on;
    if (on) {
      this.homing?.cancel();
      this.homing = null;
    } else {
      this.goHome();
    }
  }

  /** The deck's ray target stays on all the time; the glow says when a tap would do something. */
  private refresh(): void {
    if (!this.table.deck.hasComponent(RayInteractable)) this.table.deck.addComponent(RayInteractable);
    const state = app.machine.state;
    const ctx = permissionContext();
    const tapDoes = this.tapShuffles() || (state === 'DRAWING' && allowed(ctx, 'draw') === 'yes');
    this.table.deckInteractive = !this.shuffling && tapDoes;
  }

  /** Glide back to the deck's place on the mat, lying flat. */
  private goHome(): void {
    this.homing?.cancel();
    this.homing = null;
    if (this.grab.holderOf(this.deck) || this.grab.isRemoteHeld('deck')) return;
    const from = this.deck.position.clone();
    const fromQuat = this.deck.quaternion.clone();
    if (from.distanceTo(this.homePosition) < 0.0005 && fromQuat.angleTo(this.homeQuaternion) < 0.001) {
      this.deck.position.copy(this.homePosition);
      this.deck.quaternion.copy(this.homeQuaternion);
      return;
    }
    void this.tweens.play(
      {
        duration: HOME_SECONDS,
        easing: ease.outCubic,
        onUpdate: (k) => {
          this.deck.position.lerpVectors(from, this.homePosition, k);
          this.deck.quaternion.slerpQuaternions(fromQuat, this.homeQuaternion, k);
        },
      },
      (handle) => (this.homing = handle),
    );
  }

  /** Riffle the deck where it is, then tell the reading the shuffle is done. */
  private async runShuffle(snapshot: ReadingSnapshot, passes: 1 | 2): Promise<void> {
    const token = { reading: snapshot.readingNumber, shuffles: snapshot.shuffles };
    this.shuffling = true;
    this.refresh();
    // A shake in the hand gets one quick pass; a tap gets a fuller riffle.
    await this.riffle(passes);
    this.shuffling = false;
    // Ready to hear the next shake.
    this.shake.reset();
    const now = app.machine.current;
    if (now.state === 'SHUFFLING' && now.readingNumber === token.reading && now.shuffles === token.shuffles) {
      app.machine.send({ type: 'SHUFFLE_DONE' });
    }
    this.refresh();
  }

  /** A quick riffle with loose cards on top of the deck. */
  private async riffle(passes: number): Promise<void> {
    const base = deckStackHeight(app.cards.size);
    const t = config.card.thicknessM;
    const half = SHUFFLE_CARDS / 2;
    this.rig.visible = true;
    this.rigCards.forEach((card, i) => {
      card.root.position.set(0, base + i * t, 0);
      card.root.rotation.set(0, 0, 0);
    });
    for (let pass = 0; pass < passes; pass++) {
      // Split into two halves...
      await Promise.all(
        this.rigCards.map((card, i) => {
          const side = i < half ? -1 : 1;
          const x0 = card.root.position.x;
          const y0 = card.root.position.y;
          const r0 = card.root.rotation.y;
          const yHalf = base + (i % half) * t;
          return this.tweens.play({
            duration: 0.32,
            easing: ease.inOutSine,
            onUpdate: (k) => {
              card.root.position.x = lerp(x0, side * config.card.widthM * 0.62, k);
              card.root.position.y = lerp(y0, yHalf, k) + Math.sin(Math.PI * k) * 0.01;
              card.root.rotation.y = lerp(r0, side * 0.12, k);
            },
          });
        }),
      );
      // ...then riffle them back together, alternating sides from the bottom up.
      await Promise.all(
        this.rigCards.map((card, i) => {
          const order = (i % half) * 2 + (i < half ? 0 : 1);
          const x0 = card.root.position.x;
          const y0 = card.root.position.y;
          const r0 = card.root.rotation.y;
          return this.tweens.play({
            duration: 0.22,
            delay: order * 0.045,
            easing: ease.outCubic,
            onUpdate: (k) => {
              card.root.position.x = lerp(x0, 0, k);
              card.root.position.y = lerp(y0, base + order * t, k) + Math.sin(Math.PI * k) * 0.006;
              card.root.rotation.y = lerp(r0, 0, k);
            },
          });
        }),
      );
    }
    this.rig.visible = false;
  }
}
