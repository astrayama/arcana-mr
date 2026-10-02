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
import { backRegistry, getBack } from '../backs/catalog.js';
import { DECK_BACK } from '../settings/settings.js';
import { config } from '../config.js';
import { DeckPile, ReadingMat } from '../components/table.js';
import { TarotCard } from '../components/tarotCard.js';
import { FocusSystem } from '../interaction/focusSystem.js';
import { ease, lerp, Tweens, type TweenHandle, type TweenOptions } from '../lib/tween.js';
import type { SpreadDef } from '../spreads/spread.schema.js';
import { layoutRules } from '../visuals/layout.js';
import { fitSpread, type Rect, type SlotPose, type TableLayout } from '../visuals/spreadLayout.js';
import {
  buildCard,
  buildCardGeometry,
  applyCardBack,
  buildCardMaterials,
  loadColorTexture,
  buildDeckGlow,
  buildDeckPile,
  buildMat,
  deckStackHeight,
  MAT_SURFACE_Y,
  resizeMat,
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
  heldBy: 'left' | 'right' | 'remote' | null;
  /** The one motion moving this card's root; starting another cancels it. */
  motion: TweenHandle | null;
  face: Texture | null;
  /** App time (seconds) the card landed in its spot. */
  landedAt: number;
  hover: number;
  flipLift: number;
}

const HOVER_RATE = 12;
const RESIZE_SECONDS = 0.4;

/** Who asked for the current layout, so only they can put the table back. */
export type LayoutOwner = 'base' | 'reading' | 'builder';
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
  /** Where everything goes for the current spread (the target while the mat is resizing). */
  layout!: TableLayout;
  /** The mat's extents right now, following `layout` as it resizes. */
  readonly bounds: Rect = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  private layoutOwner: LayoutOwner = 'base';
  private readonly layoutListeners = new Set<(layout: TableLayout) => void>();
  private resizing: TweenHandle | null = null;
  private backRequest = 0;
  private readonly deckListeners = new Set<() => void>();
  private deckGlow!: Mesh<ShapeGeometry, MeshBasicMaterial>;
  private deckHover = 0;
  private nextKey = 0;
  private focus!: FocusSystem;

  init(): void {
    this.focus = this.world.getSystem(FocusSystem)!;
    this.cardMaterials = buildCardMaterials(app.theme);
    this.geometry = buildCardGeometry(config.card.widthM, app.cardHeightM);

    this.layout = this.fit(null);
    Object.assign(this.bounds, this.layout.bounds);
    this.mat = this.world.createTransformEntity(buildMat(app.theme, this.bounds), { persistent: true });
    this.mat.addComponent(ReadingMat);
    this.mat.object3D!.visible = false;

    const pile = buildDeckPile(this.cardMaterials, config.card.widthM, app.cardHeightM, app.cards.size);
    this.deckGlow = buildDeckGlow(this.cardMaterials, this.geometry);
    pile.add(this.deckGlow);
    this.deck = this.world.createTransformEntity(pile, { parent: this.mat });
    this.deck.addComponent(DeckPile);
    this.deck.object3D!.position.set(this.layout.deck.x, MAT_SURFACE_Y, this.layout.deck.z);

    let firstDeck = true;
    this.cleanupFuncs.push(
      app.back.subscribe((id) => this.showBack(id)),
      // A back added on the headset may be the chosen one; show it once it loads.
      backRegistry.onChange(() => this.showBack(app.back.peek())),
      app.deckId.subscribe(() => {
        if (firstDeck) firstDeck = false;
        else this.rebuildForDeck();
      }),
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'CHOOSE_SPREAD') this.setLayout(this.fit(snapshot.spread), 'reading');
        // Placing always uses the everyday mat, which is what placement fits to the table.
        if (event.type === 'REPLACE_MAT') this.setLayout(this.fit(null), 'base', false);
        // A shared reading caught up at once: clear the table and lay out its spread.
        if (event.type === 'RESTORE') {
          this.removeAllCards();
          if (snapshot.spread) this.setLayout(this.fit(snapshot.spread), 'reading', false);
          else this.resetLayout('reading');
        }
      }),
    );
  }

  /** Hear when the deck changes, after cards and the pile have been reshaped for it. */
  onDeckChange(listener: () => void): () => void {
    this.deckListeners.add(listener);
    return () => this.deckListeners.delete(listener);
  }

  /**
   * A different deck can have different proportions: reshape the card and
   * deck-pile geometry, re-crop the back, and re-fit the table. Only happens
   * between readings, when no cards are out.
   */
  private rebuildForDeck(): void {
    const old = this.geometry;
    this.geometry = buildCardGeometry(config.card.widthM, app.cardHeightM);
    const pile = buildDeckPile(this.cardMaterials, config.card.widthM, app.cardHeightM, app.cards.size);
    const deck = this.deck.object3D!;
    for (const name of ['DeckPileSides', 'DeckPileTop']) {
      const mesh = deck.getObjectByName(name) as Mesh | undefined;
      const fresh = pile.getObjectByName(name) as Mesh | undefined;
      if (!mesh || !fresh) continue;
      mesh.geometry.dispose();
      mesh.geometry = fresh.geometry;
    }
    this.deckGlow.geometry = this.geometry.glow;
    old.panel.dispose();
    old.edge.dispose();
    old.glow.dispose();
    this.showBack(app.back.peek());
    this.setLayout(this.fit(null), 'base', false);
    for (const listener of this.deckListeners) listener();
  }

  /** Show the chosen card back (or the deck's own) on every card and the deck. */
  private showBack(id: string): void {
    const chosen = id === DECK_BACK ? undefined : getBack(id);
    const url = chosen?.url ?? app.deck.backUrl;
    if (!url) return;
    const aspect = chosen?.manifest.aspectRatio ?? app.deck.manifest.aspectRatio;
    const request = ++this.backRequest;
    void loadColorTexture(url).then((texture) => {
      // A later choice wins if the reader switched again while this loaded.
      if (request !== this.backRequest) return;
      applyCardBack(this.cardMaterials.back, texture, aspect, app.deck.manifest.aspectRatio);
    });
  }

  /** Fit a spread (or, for null, the empty table between readings) to the mat. */
  fit(spread: SpreadDef | null): TableLayout {
    return fitSpread(spread, layoutRules(app.cardHeightM, app.theme.theme.ambient.candles?.count ?? 0));
  }

  /**
   * Resize the mat and move everything for a new layout. Listeners (deck,
   * candles, panels, markers) follow along. `owner` says who asked, so only
   * they put the table back later.
   */
  setLayout(layout: TableLayout, owner: LayoutOwner, animate = true): void {
    this.layout = layout;
    this.layoutOwner = owner;
    this.resizing?.cancel();
    this.resizing = null;
    const from = { ...this.bounds };
    const to = layout.bounds;
    const deck = this.deck.object3D!;
    const fromScale = deck.scale.x;
    const apply = (k: number) => {
      this.bounds.minX = lerp(from.minX, to.minX, k);
      this.bounds.maxX = lerp(from.maxX, to.maxX, k);
      this.bounds.minZ = lerp(from.minZ, to.minZ, k);
      this.bounds.maxZ = lerp(from.maxZ, to.maxZ, k);
      resizeMat(this.mat.object3D!, this.bounds);
      deck.scale.setScalar(lerp(fromScale, layout.cardScale, k));
    };
    const same = (Object.keys(to) as (keyof Rect)[]).every((key) => Math.abs(to[key] - from[key]) < 1e-6);
    if (!animate || !this.mat.object3D!.visible || (same && fromScale === layout.cardScale)) {
      apply(1);
    } else {
      this.resizing = this.tweens.add({
        duration: RESIZE_SECONDS,
        easing: ease.inOutCubic,
        onUpdate: apply,
        onDone: () => (this.resizing = null),
      });
    }
    for (const listener of this.layoutListeners) listener(layout);
  }

  /** Put the everyday mat back, if `owner` is still the one whose layout is showing. */
  resetLayout(owner: LayoutOwner): void {
    if (this.layoutOwner === owner) this.setLayout(this.fit(null), 'base');
  }

  get layoutOwnedBy(): LayoutOwner {
    return this.layoutOwner;
  }

  /** Hear about every new layout. Returns an unsubscribe function. */
  onLayout(listener: (layout: TableLayout) => void): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  /** Where a spread position's card goes. */
  slotPose(slot: number): SlotPose | undefined {
    return this.layout.slots[slot];
  }

  /** Top of the deck pile above its base, in mat-local meters. */
  deckTopY(): number {
    return MAT_SURFACE_Y + deckStackHeight(app.cards.size) * this.deck.object3D!.scale.y;
  }

  /** Make a new face-down card on the mat. */
  createCard(x: number, y: number, z: number, yaw = 0): TableCard {
    const key = this.nextKey++;
    const visual = buildCard(this.cardMaterials, this.geometry);
    visual.root.name = `TableCard-${key}`;
    visual.root.position.set(x, y, z);
    visual.root.rotation.set(0, yaw, 0);
    visual.root.scale.setScalar(this.layout.cardScale);
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

  /** Take every card off the table at once, without animation. */
  removeAllCards(): void {
    for (const card of [...this.cards]) this.removeCard(card);
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
      // A card in the hand goes exactly where the hand puts it. A card with
      // another lying across it stays put, and the one on top rises with it
      // when it turns, so they never pass through each other.
      const covered = this.isCovered(card);
      const lift = card.heldBy || covered ? 0 : card.hover * hoverLiftM;
      const under = this.cardUnder(card);
      card.visual.pivot.position.y = baseY + lift + card.flipLift + (under && !card.heldBy ? under.flipLift : 0);
      const glow = (card.heldBy ? 0 : Math.max(card.hover, focused)) * intensity;
      card.visual.glow.material.opacity = glow;
      // An unlit glow still costs a draw call; skip it until it shows.
      card.visual.glow.visible = glow > 0.002;
    }

    // The deck glows when a hand could pick it up, or a ray tap on it would do something.
    const deck = this.deck.object3D!;
    const deckHot =
      live && !this.deckHeld && (this.focus.isNearHot(deck) || (this.deckInteractive && this.focus.isHot(deck)));
    const deckTarget = deckHot ? 1 : 0;
    this.deckHover += (deckTarget - this.deckHover) * step;
    this.deckGlow.material.opacity = this.deckHover * intensity;
    this.deckGlow.visible = this.deckGlow.material.opacity > 0.002;
  }

  /** True if another placed card lies across this one. */
  private isCovered(card: TableCard): boolean {
    for (const other of this.cards) {
      if (other !== card && other.phase === 'placed' && this.layout.slots[other.slot]?.stackedOn === card.slot) return true;
    }
    return false;
  }

  /** The card this one lies across, if any. */
  private cardUnder(card: TableCard): TableCard | undefined {
    const below = this.layout.slots[card.slot]?.stackedOn;
    return below === null || below === undefined ? undefined : this.placedCard(below);
  }
}
