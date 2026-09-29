import {
  createSystem,
  Hovered,
  Pressed,
  RayInteractable,
  type Entity,
  type Mesh,
  type MeshBasicMaterial,
  type ShapeGeometry,
  type Texture,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { DeckPile, ReadingMat } from '../components/table.js';
import { TarotCard } from '../components/tarotCard.js';
import { FocusSystem } from '../interaction/focusSystem.js';
import { Tweens, type TweenHandle, type TweenOptions } from '../lib/tween.js';
import {
  buildCard,
  buildCardGeometry,
  buildCardMaterials,
  buildDeckGlow,
  buildDeckPile,
  buildMat,
  deckStackHeight,
  MAT_SURFACE_Y,
  type CardGeometry,
  type CardMaterials,
  type CardVisual,
} from '../visuals/tableVisuals.js';

/**
 * Where a physical card is in its life on the table: just pulled into a hand,
 * on its way to its spot, in the spread, or being swept back into the deck.
 */
export type CardPhase = 'held' | 'flying' | 'placed' | 'gathering';

/** One physical card on the mat: in a hand, in flight, or in the spread. */
export interface TableCard {
  /** Unique for the life of the app. */
  key: number;
  phase: CardPhase;
  /** Spread position once drawn, else -1. */
  slot: number;
  cardId: string | null;
  reversed: boolean;
  faceUp: boolean;
  entity: Entity;
  visual: CardVisual;
  /** The hand holding it, if any. */
  heldBy: 'left' | 'right' | null;
  /** The one motion moving this card's root; starting another cancels it. */
  motion: TweenHandle | null;
  face: Texture | null;
  /** App time (seconds) the card landed in its spot. */
  landedAt: number;
  hover: number;
  flipLift: number;
}

const HOVER_RATE = 12;
/** Glow on the card whose meaning is showing, as a share of the hover glow. */
const FOCUS_GLOW = 0.45;

/**
 * Builds the reading mat and the deck pile, and owns every physical card on
 * the table: creating and removing them, the single motion each may be in,
 * and the hover lift and glow that show what a hand is about to act on.
 * Everything on the table is parented to the mat, so moving the mat moves the
 * whole reading.
 */
export class TableSystem extends createSystem({}) {
  mat!: Entity;
  deck!: Entity;
  cardMaterials!: CardMaterials;
  geometry!: CardGeometry;
  readonly tweens = new Tweens();
  readonly cards: TableCard[] = [];
  /** Set by the deck system when tapping the deck would do something. */
  deckInteractive = false;
  /** Set by the deck system while a hand holds the deck. */
  deckHeld = false;
  /** Set by the meaning system: the slot whose meaning is showing, or -1. */
  focusedSlot = -1;
  /** Seconds since the app started, advanced every frame. */
  now = 0;

  private deckGlow!: Mesh<ShapeGeometry, MeshBasicMaterial>;
  private deckHover = 0;
  private nextKey = 0;
  private focus!: FocusSystem;

  init(): void {
    this.focus = this.world.getSystem(FocusSystem)!;
    this.cardMaterials = buildCardMaterials(app.deck, app.theme);
    this.geometry = buildCardGeometry(config.card.widthM, app.cardHeightM);

    this.mat = this.world.createTransformEntity(buildMat(app.theme), { persistent: true });
    this.mat.addComponent(ReadingMat);
    this.mat.object3D!.visible = false;

    const pile = buildDeckPile(this.cardMaterials, config.card.widthM, app.cardHeightM, app.cards.size);
    this.deckGlow = buildDeckGlow(this.cardMaterials, this.geometry);
    pile.add(this.deckGlow);
    this.deck = this.world.createTransformEntity(pile, { parent: this.mat });
    this.deck.addComponent(DeckPile);
    this.deck.object3D!.position.set(0, MAT_SURFACE_Y, config.layout.deckZ);
  }

  /** Top of the deck pile, in mat-local meters. */
  deckTopY(): number {
    return MAT_SURFACE_Y + deckStackHeight(app.cards.size);
  }

  /** Make a new face-down card on the mat. */
  createCard(x: number, y: number, z: number, yaw = 0): TableCard {
    const key = this.nextKey++;
    const visual = buildCard(this.cardMaterials, this.geometry);
    visual.root.name = `TableCard-${key}`;
    visual.root.position.set(x, y, z);
    visual.root.rotation.set(0, yaw, 0);
    const entity = this.world.createTransformEntity(visual.root, { parent: this.mat });
    this.focus.register(visual.root);
    const card: TableCard = {
      key,
      phase: 'flying',
      slot: -1,
      cardId: null,
      reversed: false,
      faceUp: false,
      entity,
      visual,
      heldBy: null,
      motion: null,
      face: null,
      landedAt: 0,
      hover: 0,
      flipLift: 0,
    };
    this.cards.push(card);
    return card;
  }

  cardForEntity(entity: Entity): TableCard | undefined {
    return this.cards.find((card) => card.entity === entity);
  }

  placedCard(slot: number): TableCard | undefined {
    return this.cards.find((card) => card.phase === 'placed' && card.slot === slot);
  }

  /** The card is in its spot: from now on it can be tapped, turned over, or picked up. */
  land(card: TableCard): void {
    if (card.phase !== 'flying') return;
    card.phase = 'placed';
    card.landedAt = this.now;
    // A trigger or pinch still held from drawing mustn't count as a tap on the new card.
    if (card.entity.hasComponent(Pressed)) card.entity.removeComponent(Pressed);
    if (card.entity.hasComponent(Hovered)) card.entity.removeComponent(Hovered);
    if (!card.entity.hasComponent(TarotCard)) {
      card.entity.addComponent(TarotCard, {
        slot: card.slot,
        cardId: card.cardId ?? '',
        reversed: card.reversed,
        faceUp: card.faceUp,
      });
    }
    if (!card.entity.hasComponent(RayInteractable)) card.entity.addComponent(RayInteractable);
  }

  /** Move a card's root with a tween, cancelling whatever was moving it before. */
  move(card: TableCard, options: Omit<TweenOptions, 'onDone'>): Promise<boolean> {
    card.motion?.cancel();
    return this.tweens
      .play(options, (handle) => (card.motion = handle))
      .then((finished) => {
        if (finished) card.motion = null;
        return finished;
      });
  }

  removeCard(card: TableCard): void {
    card.motion?.cancel();
    this.focus.unregister(card.visual.root);
    card.visual.face.material.dispose();
    card.visual.glow.material.dispose();
    // Free the face's GPU memory; the image stays cached for a quick redraw.
    card.face?.dispose();
    card.visual.root.removeFromParent();
    // Shared geometry and back/edge materials stay alive for the next card.
    card.entity.destroy();
    const index = this.cards.indexOf(card);
    if (index >= 0) this.cards.splice(index, 1);
  }

  update(delta: number): void {
    this.now += delta;
    this.tweens.update(delta);

    const { hoverLiftM, intensity } = app.theme.theme.cardHighlight;
    const step = Math.min(1, delta * HOVER_RATE);
    const state = app.machine.state;
    const live = state === 'DRAWING' || state === 'AWAITING_FLIPS' || state === 'REVEALED';
    const baseY = config.card.thicknessM / 2;

    for (const card of this.cards) {
      const interactive = live && card.phase === 'placed';
      const target = interactive && this.focus.isHot(card.visual.root) ? 1 : 0;
      card.hover += (target - card.hover) * step;
      const focused = live && card.phase === 'placed' && card.slot === this.focusedSlot ? FOCUS_GLOW : 0;
      // A card in the hand goes exactly where the hand puts it.
      const lift = card.heldBy ? 0 : card.hover * hoverLiftM;
      card.visual.pivot.position.y = baseY + lift + card.flipLift;
      card.visual.glow.material.opacity = (card.heldBy ? 0 : Math.max(card.hover, focused)) * intensity;
    }

    // The deck glows when a hand could pick it up, or a ray tap on it would do something.
    const deck = this.deck.object3D!;
    const deckHot =
      live && !this.deckHeld && (this.focus.isNearHot(deck) || (this.deckInteractive && this.focus.isHot(deck)));
    const deckTarget = deckHot ? 1 : 0;
    this.deckHover += (deckTarget - this.deckHover) * step;
    this.deckGlow.material.opacity = this.deckHover * intensity;
  }
}
