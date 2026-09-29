import { createSystem, Matrix4, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { FocusSystem } from '../interaction/focusSystem.js';
import { HANDS, HandGestures, type Hand, type HandGesture } from '../interaction/handGestures.js';
import { ease } from '../lib/tween.js';
import type { ReadingStateName } from '../state/readingMachine.js';
import { isGrabTap } from '../visuals/layout.js';
import { deckStackHeight } from '../visuals/tableVisuals.js';
import { TableSystem, type TableCard } from './tableSystem.js';

export type { Hand } from '../interaction/handGestures.js';

/** What a hand is holding: the deck, a card, or a pinch on the deck that pulled nothing. */
type HoldKind = 'deck' | 'card' | 'deckTop';

interface Hold {
  kind: HoldKind;
  card: TableCard | null;
  /** What moves with the hand; null for a pinch on the deck that pulled nothing. */
  object: Object3D | null;
  /** The object's pose relative to the hand when it was picked up. */
  readonly offset: Matrix4;
  /** Hand-local slide that brings the touched spot under the fingers or into the palm. */
  readonly settle: Vector3;
  settled: number;
  startedAt: number;
  /** Where the hand's grip was when it took hold, for telling a tap from a move. */
  readonly startGrip: Vector3;
  /** Pulled off the deck by this pinch, rather than picked up from the spread. */
  fromDeck: boolean;
}

export interface DeckGrabHandlers {
  onGrab(hand: Hand): void;
  onRelease(hand: Hand, tap: boolean): void;
  /** A quick pinch on the deck that didn't pull a card (before the shuffle, say). */
  onTopTap(hand: Hand): void;
}

export interface CardGrabHandlers {
  onGrab(card: TableCard, hand: Hand): void;
  onRelease(card: TableCard, tap: boolean, fromDeck: boolean): void;
}

interface MultiPointerInternals {
  pointerStates: Map<string, string>;
}

/** Reading states where the deck and cards can be handled. */
const LIVE: ReadonlySet<ReadingStateName> = new Set(['READY', 'SHUFFLING', 'DRAWING', 'AWAITING_FLIPS', 'REVEALED']);

/**
 * Picking things up off the table. Pinch (or pull the trigger) to take a card,
 * off the top of the deck or out of the spread; close your hand (or squeeze
 * the grip) to lift the whole deck. Whatever you hold follows your hand
 * completely, position and rotation, so a card turns over when you turn your
 * hand. What happens when you let go is up to the deck and card systems.
 *
 * Up close, a hand's ray is switched off, so a pinch at the table never also
 * clicks something behind it; it comes back once the hand moves away.
 */
export class TableGrabSystem extends createSystem({}) {
  deckHandlers: DeckGrabHandlers | null = null;
  cardHandlers: CardGrabHandlers | null = null;
  /** Draws the next card off the deck into the hand, if drawing is allowed now. */
  pull: (() => TableCard | null) | null = null;

  private gestures!: HandGestures;
  private table!: TableSystem;
  private focus!: FocusSystem;
  private deck!: Object3D;
  private readonly holds: Record<Hand, Hold | null> = { left: null, right: null };
  private readonly nearMode: Record<Hand, boolean> = { left: false, right: false };
  private readonly rayOn: Record<Hand, boolean> = { left: true, right: true };

  // Scratch space, so nothing is allocated per frame.
  private readonly inverse = new Matrix4();
  private readonly composed = new Matrix4();
  private readonly localPoint = new Vector3();
  private readonly closest = new Vector3();
  private readonly scale = new Vector3();
  private readonly holdQuat = new Quaternion();
  private readonly holdPos = new Vector3();
  private foundCard: TableCard | null = null;

  private readonly cardHalf = new Vector3();
  private readonly deckHalf = new Vector3();
  /** Height of the deck box's center above the deck's origin. */
  private deckCenterY = 0;

  init(): void {
    this.gestures = new HandGestures(this.world);
    this.table = this.world.getSystem(TableSystem)!;
    this.focus = this.world.getSystem(FocusSystem)!;
    this.deck = this.table.deck.object3D!;
    this.refreshSizes();

    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event) => {
        // A new reading sweeps everything away; let go of it all first.
        if (event.type === 'NEW_READING' || !LIVE.has(snapshot.state)) this.releaseAll();
      }),
      this.table.onDeckChange(() => this.refreshSizes()),
      () => {
        this.gestures.dispose();
        for (const hand of HANDS) this.setRay(hand, true, true);
      },
    );
  }

  /** Grab boxes match the deck in use (its cards may be a different shape). */
  private refreshSizes(): void {
    const stack = deckStackHeight(app.cards.size);
    this.cardHalf.set(config.card.widthM / 2, 0.004, app.cardHeightM / 2);
    this.deckHalf.set(config.card.widthM / 2 + 0.005, stack / 2 + 0.005, app.cardHeightM / 2 + 0.005);
    this.deckCenterY = stack / 2;
  }

  /** Which hand is holding `object` (the deck or a card's root), if any. */
  holderOf(object: Object3D): Hand | null {
    for (const hand of HANDS) if (this.holds[hand]?.object === object) return hand;
    return null;
  }

  /** Let go of everything without telling anyone (the caller is clearing up). */
  releaseAll(): void {
    for (const hand of HANDS) this.release(hand, false);
  }

  /** A short buzz on a controller, where supported. */
  pulse(hand: Hand, intensity: number, ms: number): void {
    const pad = this.input.xr.gamepads[hand] as unknown as {
      inputSource?: { gamepad?: { hapticActuators?: { pulse?: (v: number, d: number) => unknown }[] } };
    };
    try {
      pad?.inputSource?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
    } catch {
      // Haptics are a nicety; ignore devices that don't support them.
    }
  }

  update(delta: number): void {
    this.gestures.update();
    const live = LIVE.has(app.machine.state);
    const { reachM, releaseNearM } = config.grab;

    for (const hand of HANDS) {
      const g = this.gestures.get(hand);
      const held = this.holds[hand];
      if (held && (!g.connected || (held.kind === 'deck' ? !g.fist : !g.pinch))) {
        this.release(hand, true);
      }

      // What this hand could pick up, and how far away it is.
      let owner: Object3D | null = null;
      let distance = Infinity;
      if (!this.holds[hand] && live && g.connected) {
        const radius = this.nearMode[hand] ? releaseNearM : reachM;
        const pinch = this.pinchTarget(g);
        const pinchCard = this.foundCard;
        const fist = this.fistTarget(hand, g);
        distance = Math.min(pinch, fist);
        if (distance <= radius) {
          const byPinch = pinch <= fist;
          owner = byPinch ? (pinchCard ? pinchCard.visual.root : this.deck) : this.deck;
          if (g.fistStarted && fist <= radius) this.grabDeck(hand, g);
          else if (g.pinchStarted && pinch <= radius) this.grabByPinch(hand, g, pinchCard);
        }
      }

      const hold = this.holds[hand];
      if (hold) {
        this.follow(hold, g, delta);
        owner = hold.object ?? this.deck;
      }
      const near = hold !== null || owner !== null;
      this.nearMode[hand] = near;
      this.focus.setNear(hand, owner);
      this.setRay(hand, !near);
    }
  }

  /** Distance from the pinch to the nearest thing a pinch can take; sets `foundCard` (null means the deck). */
  private pinchTarget(g: HandGesture): number {
    this.foundCard = null;
    let best = this.boxDistance(this.deck, this.deckCenterY, this.deckHalf, g.pinchPoint);
    let bestHeight = -Infinity;
    for (const card of this.table.cards) {
      if (card.phase !== 'placed' || card.heldBy) continue;
      const d = this.boxDistance(card.visual.root, config.card.thicknessM / 2, this.cardHalf, g.pinchPoint);
      // Two cards can be equally close when one lies across the other: take the one on top.
      const height = card.visual.root.position.y;
      if (d < best - 1e-4 || (d <= best + 1e-4 && height > bestHeight)) {
        best = d;
        bestHeight = height;
        this.foundCard = card;
      }
    }
    return best;
  }

  /** Distance from the palm to the deck, unless the other hand has it. */
  private fistTarget(hand: Hand, g: HandGesture): number {
    const holder = this.holderOf(this.deck);
    if (holder && holder !== hand) return Infinity;
    return this.boxDistance(this.deck, this.deckCenterY, this.deckHalf, g.palmPoint);
  }

  private grabDeck(hand: Hand, g: HandGesture): void {
    this.deckHandlers?.onGrab(hand);
    this.startHold(hand, 'deck', this.deck, null, g, g.palmPoint, this.deckCenterY, this.deckHalf, false);
  }

  private grabByPinch(hand: Hand, g: HandGesture, card: TableCard | null): void {
    if (card) {
      this.cardHandlers?.onGrab(card, hand);
      card.heldBy = hand;
      this.startHold(hand, 'card', card.visual.root, card, g, g.pinchPoint, config.card.thicknessM / 2, this.cardHalf, false);
      return;
    }
    // A pinch on the deck draws the next card straight into the fingers.
    const pulled = this.pull?.() ?? null;
    if (pulled) {
      pulled.heldBy = hand;
      this.startHold(hand, 'card', pulled.visual.root, pulled, g, g.pinchPoint, config.card.thicknessM / 2, this.cardHalf, true);
    } else {
      this.startHold(hand, 'deckTop', null, null, g, g.pinchPoint, 0, this.cardHalf, false);
    }
  }

  private startHold(
    hand: Hand,
    kind: HoldKind,
    object: Object3D | null,
    card: TableCard | null,
    g: HandGesture,
    point: Vector3,
    centerY: number,
    half: Vector3,
    fromDeck: boolean,
  ): void {
    const hold: Hold = {
      kind,
      card,
      object,
      offset: new Matrix4(),
      settle: new Vector3(),
      settled: 0,
      startedAt: this.table.now,
      startGrip: new Vector3().setFromMatrixPosition(g.hold),
      fromDeck,
    };
    if (object) {
      object.updateWorldMatrix(true, false);
      this.inverse.copy(g.hold).invert();
      hold.offset.multiplyMatrices(this.inverse, object.matrixWorld);
      // Slide the object so the spot nearest the fingers (or palm) ends up under them.
      this.boxDistance(object, centerY, half, point);
      hold.settle.subVectors(point, this.closest);
      const max = config.grab.releaseNearM;
      if (hold.settle.length() > max) hold.settle.setLength(max);
      g.hold.decompose(this.holdPos, this.holdQuat, this.scale);
      hold.settle.applyQuaternion(this.holdQuat.invert());
    }
    this.holds[hand] = hold;
  }

  /** Put the held object where the hand says, in its parent's (the mat's) space. */
  private follow(hold: Hold, g: HandGesture, delta: number): void {
    const object = hold.object;
    if (!object?.parent) return;
    hold.settled = Math.min(1, hold.settled + delta / config.grab.settleSeconds);
    const k = ease.outCubic(hold.settled);
    this.composed.copy(hold.offset);
    const e = this.composed.elements;
    e[12] += hold.settle.x * k;
    e[13] += hold.settle.y * k;
    e[14] += hold.settle.z * k;
    this.composed.premultiply(g.hold);
    object.parent.updateWorldMatrix(true, false);
    this.inverse.copy(object.parent.matrixWorld).invert();
    this.composed.premultiply(this.inverse);
    this.composed.decompose(object.position, object.quaternion, this.scale);
  }

  private release(hand: Hand, notify: boolean): void {
    const hold = this.holds[hand];
    if (!hold) return;
    this.holds[hand] = null;
    if (hold.card) hold.card.heldBy = null;
    if (!notify) return;
    const g = this.gestures.get(hand);
    // Measured at the grip: closing a pinch moves the fingertips a few
    // centimeters even when the hand itself holds still.
    const moved = this.holdPos.setFromMatrixPosition(g.hold).distanceTo(hold.startGrip);
    const tap = g.connected && isGrabTap(this.table.now - hold.startedAt, moved);
    if (hold.kind === 'deck') this.deckHandlers?.onRelease(hand, tap);
    else if (hold.kind === 'card' && hold.card) this.cardHandlers?.onRelease(hold.card, tap, hold.fromDeck);
    else if (hold.kind === 'deckTop' && tap) this.deckHandlers?.onTopTap(hand);
  }

  /**
   * Distance (meters) from a world point to a box on `object`: centered
   * `centerY` above its origin with half-extents `half`, in its local space.
   * Leaves the nearest point of the box, in world space, in `this.closest`.
   */
  private boxDistance(object: Object3D, centerY: number, half: Vector3, point: Vector3): number {
    object.updateWorldMatrix(true, false);
    this.inverse.copy(object.matrixWorld).invert();
    const p = this.localPoint.copy(point).applyMatrix4(this.inverse);
    this.closest.set(
      Math.min(Math.max(p.x, -half.x), half.x),
      Math.min(Math.max(p.y, centerY - half.y), centerY + half.y),
      Math.min(Math.max(p.z, -half.z), half.z),
    );
    this.closest.applyMatrix4(object.matrixWorld);
    return this.closest.distanceTo(point);
  }

  /** Switch a hand's ray on or off. A far press already in progress is left to finish first. */
  private setRay(hand: Hand, on: boolean, force = false): void {
    if (this.rayOn[hand] === on) return;
    const pointers = this.input.xr.multiPointers[hand];
    if (!on && !force && (pointers as unknown as MultiPointerInternals).pointerStates?.get('ray') === 'select') return;
    pointers.toggleSubPointer('ray', on);
    this.rayOn[hand] = on;
  }
}
