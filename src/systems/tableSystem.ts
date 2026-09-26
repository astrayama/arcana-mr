import { createSystem, type Entity, type Mesh, type MeshBasicMaterial, type ShapeGeometry, type Texture } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { DeckPile, ReadingMat } from '../components/table.js';
import { GrabHandle } from '../interaction/grabHandle.js';
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

/** Where a physical card is in its life on the table. */
export type CardPhase = 'offered' | 'flying' | 'placed' | 'gathering';

/** One physical card on the mat: the next card to draw, one in flight, or one in the spread. */
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
  handle: GrabHandle;
  /** The one motion moving this card's root; starting another cancels it. */
  motion: TweenHandle | null;
  face: Texture | null;
  /** App time (seconds) the card landed in its spot. */
  landedAt: number;
  hover: number;
  flipLift: number;
}

const HOVER_RATE = 12;
const HELD_LIFT_M = 0.015;
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
  /** Set by the deck system when the deck can be tapped or grabbed. */
  deckInteractive = false;
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

  /** Make a new face-down card on the mat. It starts hidden from grabs until a system enables its handle. */
  createCard(x: number, y: number, z: number, yaw = 0): TableCard {
    const key = this.nextKey++;
    const visual = buildCard(this.cardMaterials, this.geometry);
    visual.root.name = `TableCard-${key}`;
    visual.root.position.set(x, y, z);
    visual.root.rotation.set(0, yaw, 0);
    const entity = this.world.createTransformEntity(visual.root, { parent: this.mat });
    const handle = new GrabHandle(
      this.world,
      this.mat,
      { width: config.card.widthM + 0.01, height: 0.03, depth: app.cardHeightM + 0.01 },
      'card',
      key,
      0.012,
    );
    handle.setEnabled(false);
    handle.syncFrom(visual.root);
    this.focus.register(visual.root, handle.mesh);
    const card: TableCard = {
      key,
      phase: 'offered',
      slot: -1,
      cardId: null,
      reversed: false,
      faceUp: false,
      entity,
      visual,
      handle,
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

  cardForHandle(entity: Entity): TableCard | undefined {
    return this.cards.find((card) => card.handle.entity === entity);
  }

  placedCard(slot: number): TableCard | undefined {
    return this.cards.find((card) => card.phase === 'placed' && card.slot === slot);
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
    this.focus.unregister(card.visual.root, card.handle.mesh);
    card.handle.dispose();
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
      const interactive = live && (card.phase === 'offered' || card.phase === 'placed');
      const target = interactive && this.focus.isHot(card.visual.root) ? 1 : 0;
      card.hover += (target - card.hover) * step;
      const focused = live && card.phase === 'placed' && card.slot === this.focusedSlot ? FOCUS_GLOW : 0;
      const held = card.handle.held ? HELD_LIFT_M : 0;
      card.visual.pivot.position.y = baseY + card.hover * hoverLiftM + card.flipLift + held;
      card.visual.glow.material.opacity = Math.max(card.hover, focused) * intensity;
    }

    const deckTarget = this.deckInteractive && this.focus.isHot(this.deck.object3D!) ? 1 : 0;
    this.deckHover += (deckTarget - this.deckHover) * step;
    this.deckGlow.material.opacity = this.deckHover * intensity;
  }
}
