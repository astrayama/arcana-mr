import {
  createSystem,
  Grabbed,
  GrabSystem,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { DeckPile, TableHandle } from '../components/table.js';
import { FocusSystem } from '../interaction/focusSystem.js';
import { GrabHandle } from '../interaction/grabHandle.js';
import { createShakeDetector } from '../lib/shake.js';
import { ease, lerp, Tweens } from '../lib/tween.js';
import type { ReadingSnapshot } from '../state/readingMachine.js';
import { buildCard, deckStackHeight, type CardVisual } from '../visuals/tableVisuals.js';
import { TableSystem } from './tableSystem.js';

const SHUFFLE_CARDS = 8;
const HOME_SECONDS = 0.3;

/**
 * The deck: tap it (controller trigger, hand pinch, or a quick grab) to
 * shuffle, or pick it up and give it a shake. Shuffling is only possible
 * before the first card is drawn. When the deck is let go it glides back to
 * its spot, and the riffle plays there.
 */
export class DeckSystem extends createSystem({
  pressed: { required: [DeckPile, Pressed] },
  heldHandles: { required: [TableHandle, Grabbed] },
}) {
  private table!: TableSystem;
  private deck!: Object3D;
  private handle!: GrabHandle;
  private readonly tweens = new Tweens();
  private readonly shake = createShakeDetector();
  private shakeFired = false;
  private going: Promise<boolean> | null = null;
  private shuffling = false;
  private rig!: Object3D;
  private readonly rigCards: CardVisual[] = [];
  private readonly homePosition = new Vector3();
  private readonly homeQuaternion = new Quaternion();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.deck = this.table.deck.object3D!;
    this.homePosition.copy(this.deck.position);
    this.homeQuaternion.copy(this.deck.quaternion);

    const stack = deckStackHeight(app.cards.size);
    this.handle = new GrabHandle(
      this.world,
      this.table.mat,
      { width: config.card.widthM + 0.01, height: stack + 0.02, depth: app.cardHeightM + 0.01 },
      'deck',
      -1,
      stack / 2,
    );
    this.handle.syncFrom(this.deck);
    this.world.getSystem(FocusSystem)!.register(this.deck, this.handle.mesh);

    // Loose cards used only for the riffle animation, kept hidden otherwise.
    const rigEntity = this.world.createTransformEntity(undefined, { parent: this.table.mat });
    this.rig = rigEntity.object3D!;
    this.rig.name = 'ShuffleRig';
    this.rig.position.copy(this.homePosition);
    this.rig.visible = false;
    for (let i = 0; i < SHUFFLE_CARDS; i++) {
      const card = buildCard(this.table.cardMaterials, this.table.geometry);
      card.glow.visible = false;
      this.rigCards.push(card);
      this.rig.add(card.root);
    }

    this.shake.onReversal = () => this.pulse(0.3, 25);

    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'SHUFFLE') void this.runShuffle(snapshot);
        if (event.type === 'NEW_READING') this.letGo();
        this.refresh();
      }),
      // Act when the trigger or pinch is released, like a click. Acting on press
      // and then changing the deck's state mid-press can leave IWSDK's ray stuck.
      this.queries.pressed.subscribe('disqualify', () => {
        if (!this.handle.held) this.requestShuffle();
      }),
      this.queries.heldHandles.subscribe('qualify', (entity) => {
        if (entity !== this.handle.entity) return;
        this.handle.markGrabStart(this.table.now);
        this.shake.reset();
        this.shakeFired = false;
      }),
      this.queries.heldHandles.subscribe('disqualify', (entity) => {
        if (entity !== this.handle.entity) return;
        if (!this.shakeFired && this.handle.wasTap(this.table.now)) this.requestShuffle();
        void this.goHome();
      }),
    );
    this.refresh();
  }

  update(delta: number): void {
    this.tweens.update(delta);
    if (this.handle.held && !this.going) {
      this.handle.readInto(this.deck);
      const p = this.handle.mesh.position;
      if (!this.shakeFired && this.shake.push(this.table.now, p.x, p.y, p.z)) {
        this.shakeFired = true;
        this.pulse(0.8, 80);
        this.requestShuffle();
        // The shake has done its job: put the deck back down to riffle.
        this.world.getSystem(GrabSystem)?.forceRelease(this.handle.entity);
      }
    } else if (!this.going) {
      this.handle.syncFrom(this.deck);
    }
  }

  private requestShuffle(): void {
    if (this.shuffling || app.machine.state === 'PLACING') return;
    app.machine.send({ type: 'SHUFFLE' });
  }

  /**
   * The deck can be grabbed, and glows, only while shuffling is allowed. Its
   * ray target stays on all the time (taps are simply ignored when shuffling
   * isn't allowed), because removing it mid-press can leave IWSDK's ray stuck.
   */
  private refresh(): void {
    const canShuffle = !this.shuffling && app.machine.can({ type: 'SHUFFLE' });
    if (!this.table.deck.hasComponent(RayInteractable)) this.table.deck.addComponent(RayInteractable);
    this.handle.setEnabled(canShuffle);
    this.table.deckInteractive = canShuffle;
  }

  /** Drop the deck (if held) and send it home. */
  private letGo(): void {
    if (this.handle.held) this.world.getSystem(GrabSystem)?.forceRelease(this.handle.entity);
    void this.goHome();
  }

  private goHome(): Promise<boolean> {
    if (this.going) return this.going;
    const from = this.deck.position.clone();
    const fromQuat = this.deck.quaternion.clone();
    if (from.distanceTo(this.homePosition) < 0.0005) {
      this.deck.position.copy(this.homePosition);
      this.deck.quaternion.copy(this.homeQuaternion);
      return Promise.resolve(true);
    }
    this.going = this.tweens
      .play({
        duration: HOME_SECONDS,
        easing: ease.outCubic,
        onUpdate: (k) => {
          this.deck.position.lerpVectors(from, this.homePosition, k);
          this.deck.quaternion.slerpQuaternions(fromQuat, this.homeQuaternion, k);
        },
      })
      .then((done) => {
        this.going = null;
        this.handle.syncFrom(this.deck);
        return done;
      });
    return this.going;
  }

  /** Riffle once the deck is home, then tell the reading the shuffle is done. */
  private async runShuffle(snapshot: ReadingSnapshot): Promise<void> {
    const token = { reading: snapshot.readingNumber, shuffles: snapshot.shuffles };
    this.shuffling = true;
    this.refresh();
    if (this.handle.held) this.world.getSystem(GrabSystem)?.forceRelease(this.handle.entity);
    await this.goHome();
    await this.riffle(this.shakeFired ? 1 : 2);
    this.shuffling = false;
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

  /** A short buzz on the controller holding the deck, where supported. */
  private pulse(intensity: number, ms: number): void {
    const hand = this.world.getSystem(GrabSystem)?.getHolderHand(this.handle.entity);
    if (!hand) return;
    const pad = this.input.xr.gamepads[hand] as unknown as {
      inputSource?: { gamepad?: { hapticActuators?: { pulse?: (v: number, d: number) => unknown }[] } };
    };
    try {
      pad?.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      // Haptics are a nicety; ignore devices that don't support them.
    }
  }
}
