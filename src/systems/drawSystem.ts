import {
  createSystem,
  Grabbed,
  Hovered,
  Pressed,
  RayInteractable,
  type Entity,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { OfferedCard, SlotMarker, TableHandle } from '../components/table.js';
import { TarotCard } from '../components/tarotCard.js';
import { FocusSystem } from '../interaction/focusSystem.js';
import { ease, lerp } from '../lib/tween.js';
import type { ReadingSnapshot } from '../state/readingMachine.js';
import { deckPosition, nearestEmptySlot, offerPosition, slotPosition } from '../visuals/layout.js';
import {
  buildSlotMarker,
  loadColorTexture,
  MAT_SURFACE_Y,
  type SlotMarkerVisual,
} from '../visuals/tableVisuals.js';
import { TableSystem, type TableCard } from './tableSystem.js';

const OFFER_SECONDS = 0.35;
const FLY_SECONDS = 0.5;
const FLY_ARC_M = 0.05;
const NEXT_OFFER_DELAY_MS = 180;
/** A card dropped higher than this above the cloth doesn't count as placed. */
const MAX_DROP_HEIGHT_M = 0.2;
const MARKER_OPACITY = { rest: 0.45, hot: 0.95 } as const;

interface Marker {
  slot: number;
  entity: Entity;
  visual: SlotMarkerVisual;
  /** A card is in this spot; the marker is hidden and ignores taps. */
  filled: boolean;
}

/**
 * Drawing cards by hand. After a shuffle the next card waits beside the deck:
 * tap it and it goes to the next open spot, tap an open spot to draw into it,
 * or pick the card up and drop it on the spot you want. Each drawn card flies
 * to its spot face down and only then becomes a card you can turn over.
 */
export class DrawSystem extends createSystem({
  offeredPressed: { required: [OfferedCard, Pressed] },
  markerPressed: { required: [SlotMarker, Pressed] },
  heldHandles: { required: [TableHandle, Grabbed] },
}) {
  private table!: TableSystem;
  private focus!: FocusSystem;
  private offered: TableCard | null = null;
  private markers: Marker[] = [];
  private dropTarget = -1;
  private offerTimer: ReturnType<typeof setTimeout> | undefined;

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.focus = this.world.getSystem(FocusSystem)!;

    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event) => {
        switch (event.type) {
          case 'CHOOSE_SPREAD':
            this.buildMarkers(snapshot);
            break;
          case 'SHUFFLE':
            this.retractOffered();
            break;
          case 'SHUFFLE_DONE':
            this.preloadUpcoming();
            this.offerNext();
            break;
          case 'DRAW':
            this.placeDrawn(snapshot, event.slot!);
            break;
          case 'NEW_READING':
            this.reset();
            break;
        }
      }),
      // Taps act on release, like a click. Acting on press and then changing the
      // object's state mid-press can leave IWSDK's ray stuck in a selection.
      this.queries.offeredPressed.subscribe('disqualify', (entity) => {
        if (this.offered?.entity === entity && !this.offered.handle.held) app.machine.send({ type: 'DRAW' });
      }),
      this.queries.markerPressed.subscribe('disqualify', (entity) => {
        const slot = entity.getValue(SlotMarker, 'slot') ?? 0;
        const marker = this.markers.find((m) => m.slot === slot && m.entity === entity);
        if (!marker || marker.filled || this.offered?.handle.held) return;
        app.machine.send({ type: 'DRAW', slot });
      }),
      this.queries.heldHandles.subscribe('qualify', (entity) => {
        if (this.offered && entity === this.offered.handle.entity) {
          this.offered.motion?.cancel();
          this.offered.handle.markGrabStart(this.table.now);
        }
      }),
      this.queries.heldHandles.subscribe('disqualify', (entity) => {
        if (this.offered && entity === this.offered.handle.entity) this.dropOffered();
      }),
      () => clearTimeout(this.offerTimer),
    );
  }

  update(): void {
    const offered = this.offered;
    this.dropTarget = -1;
    if (offered?.handle.held) {
      offered.handle.readInto(offered.visual.root);
      const snapshot = app.machine.current;
      const root = offered.visual.root;
      if (snapshot.spread && root.position.y - MAT_SURFACE_Y < MAX_DROP_HEIGHT_M) {
        this.dropTarget = nearestEmptySlot(
          snapshot.spread,
          snapshot.slots.map((slot) => slot.cardId !== null),
          root.position.x,
          root.position.z,
        );
      }
    } else if (offered && !offered.motion) {
      offered.handle.syncFrom(offered.visual.root);
    }

    // Open spots brighten when a hand is about to act on them, or a card is over them.
    const drawing = app.machine.state === 'DRAWING';
    for (const marker of this.markers) {
      if (marker.filled) continue;
      const hot = drawing && (this.focus.isHot(marker.visual.root) || marker.slot === this.dropTarget);
      const opacity = hot ? MARKER_OPACITY.hot : MARKER_OPACITY.rest;
      marker.visual.outline.opacity += (opacity - marker.visual.outline.opacity) * 0.25;
    }
  }

  /** Where drawn cards come from: the top of the deck. */
  private deckTop(): { x: number; y: number; z: number } {
    const deck = deckPosition();
    return { x: deck.x, y: this.table.deckTopY(), z: deck.z };
  }

  /** Put the next card beside the deck, ready to draw. */
  private offerNext(): void {
    clearTimeout(this.offerTimer);
    const snapshot = app.machine.current;
    if (snapshot.state !== 'DRAWING' || this.offered) return;
    if (snapshot.slots.every((slot) => slot.cardId !== null)) return;

    const from = this.deckTop();
    const to = offerPosition();
    const card = this.table.createCard(from.x, from.y, from.z);
    card.phase = 'offered';
    card.entity.addComponent(OfferedCard);
    card.entity.addComponent(RayInteractable);
    this.offered = card;
    const root = card.visual.root;
    void this.table
      .move(card, {
        duration: OFFER_SECONDS,
        easing: ease.outCubic,
        onUpdate: (k) => {
          root.position.set(lerp(from.x, to.x, k), lerp(from.y, MAT_SURFACE_Y, k), lerp(from.z, to.z, k));
          root.rotation.y = lerp(0, to.yaw, k);
        },
      })
      .then((done) => {
        if (!done || card !== this.offered) return;
        card.handle.syncFrom(root);
        card.handle.setEnabled(true);
      });
  }

  /** Slide the waiting card back into the deck (before a reshuffle). */
  private retractOffered(): void {
    const card = this.offered;
    if (!card) return;
    this.offered = null;
    card.handle.setEnabled(false);
    if (card.entity.hasComponent(OfferedCard)) card.entity.removeComponent(OfferedCard);
    card.phase = 'gathering';
    const root = card.visual.root;
    const from = root.position.clone();
    const to = this.deckTop();
    void this.table
      .move(card, {
        duration: 0.25,
        easing: ease.inOutCubic,
        onUpdate: (k) => root.position.set(lerp(from.x, to.x, k), lerp(from.y, to.y, k), lerp(from.z, to.z, k)),
      })
      .then(() => this.table.removeCard(card));
  }

  /** Where the waiting card goes when it's let go. */
  private dropOffered(): void {
    const card = this.offered;
    if (!card) return;
    if (card.handle.wasTap(this.table.now)) {
      if (!app.machine.send({ type: 'DRAW' })) this.returnOffered();
      return;
    }
    const target = this.dropTarget;
    if (target < 0 || !app.machine.send({ type: 'DRAW', slot: target })) this.returnOffered();
  }

  /** Glide the waiting card back beside the deck. */
  private returnOffered(): void {
    const card = this.offered;
    if (!card) return;
    const root = card.visual.root;
    const from = root.position.clone();
    const fromYaw = root.rotation.y;
    const to = offerPosition();
    void this.table.move(card, {
      duration: 0.3,
      easing: ease.outCubic,
      onUpdate: (k) => {
        root.position.set(lerp(from.x, to.x, k), lerp(from.y, MAT_SURFACE_Y, k), lerp(from.z, to.z, k));
        root.rotation.set(0, lerp(fromYaw, to.yaw, k), 0);
      },
    });
  }

  /** A card was drawn into `slot`: fly it there face down, then offer the next one. */
  private placeDrawn(snapshot: ReadingSnapshot, slot: number): void {
    const data = snapshot.slots[slot];
    if (!data?.cardId || !snapshot.spread) return;

    let card = this.offered;
    this.offered = null;
    if (!card) {
      const from = this.deckTop();
      card = this.table.createCard(from.x, from.y, from.z);
    }
    card.handle.setEnabled(false);
    if (card.entity.hasComponent(OfferedCard)) card.entity.removeComponent(OfferedCard);
    // Its ray target stays through the flight (removing it mid-press can leave
    // IWSDK's ray stuck); taps on a card in flight are ignored.
    if (!card.entity.hasComponent(RayInteractable)) card.entity.addComponent(RayInteractable);
    card.phase = 'flying';
    card.slot = slot;
    card.cardId = data.cardId;
    card.reversed = data.reversed;
    this.loadFace(card);
    this.hideMarker(slot);

    const root = card.visual.root;
    const from = root.position.clone();
    const fromYaw = root.rotation.y;
    const to = slotPosition(snapshot.spread, slot);
    // A reversed card lands turned end over end, like a real one would.
    const toYaw = data.reversed ? Math.PI : 0;
    const flown = card;
    void this.table
      .move(card, {
        duration: FLY_SECONDS,
        easing: ease.inOutCubic,
        onUpdate: (k) => {
          root.position.set(
            lerp(from.x, to.x, k),
            lerp(from.y, MAT_SURFACE_Y, k) + Math.sin(Math.PI * k) * FLY_ARC_M,
            lerp(from.z, to.z, k),
          );
          root.rotation.set(0, lerp(fromYaw, toYaw, k), 0);
        },
      })
      .then((done) => {
        if (done) this.land(flown);
      });

    clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(() => this.offerNext(), NEXT_OFFER_DELAY_MS);
  }

  /** The card is in its spot: from now on it can be turned over or picked up. */
  private land(card: TableCard): void {
    if (card.phase !== 'flying') return;
    card.phase = 'placed';
    card.landedAt = this.table.now;
    // A trigger or pinch still held from drawing mustn't count as a tap on the new card.
    if (card.entity.hasComponent(Pressed)) card.entity.removeComponent(Pressed);
    if (card.entity.hasComponent(Hovered)) card.entity.removeComponent(Hovered);
    card.entity.addComponent(TarotCard, {
      slot: card.slot,
      cardId: card.cardId ?? '',
      reversed: card.reversed,
      faceUp: false,
    });
    card.handle.syncFrom(card.visual.root);
    card.handle.setEnabled(true);
  }

  private loadFace(card: TableCard): void {
    const url = card.cardId ? app.deck.faceUrl(card.cardId) : null;
    if (!url) return;
    loadColorTexture(url).then((texture) => {
      if (!this.table.cards.includes(card)) return;
      card.face = texture;
      card.visual.face.material.map = texture;
      card.visual.face.material.needsUpdate = true;
    });
  }

  /** Warm the image cache for the next few cards so faces are ready when they land. */
  private preloadUpcoming(): void {
    for (const card of app.machine.upcoming(3)) {
      const url = app.deck.faceUrl(card.cardId);
      if (url) void loadColorTexture(url);
    }
  }

  private buildMarkers(snapshot: ReadingSnapshot): void {
    this.removeMarkers();
    if (!snapshot.spread) return;
    for (const slot of snapshot.slots) {
      const visual = buildSlotMarker(app.theme, slot.label, config.card.widthM, app.cardHeightM);
      const at = slotPosition(snapshot.spread, slot.slot);
      visual.root.position.set(at.x, 0, at.z);
      const entity = this.world.createTransformEntity(visual.root, { parent: this.table.mat });
      entity.addComponent(SlotMarker, { slot: slot.slot });
      entity.addComponent(RayInteractable);
      this.focus.register(visual.root, visual.hit);
      this.markers.push({ slot: slot.slot, entity, visual, filled: false });
    }
  }

  /**
   * Hide a filled spot's outline and name. Its (invisible) tap target stays,
   * because removing it mid-press can leave IWSDK's ray stuck; taps on a
   * filled spot are ignored, and the card above it catches rays first anyway.
   */
  private hideMarker(slot: number): void {
    const marker = this.markers.find((m) => m.slot === slot);
    if (!marker) return;
    marker.filled = true;
    for (const child of marker.visual.root.children) {
      if (child !== marker.visual.hit) child.visible = false;
    }
  }

  private removeMarkers(): void {
    for (const marker of this.markers) {
      this.focus.unregister(marker.visual.root, marker.visual.hit);
      marker.visual.root.traverse((object) => {
        const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } | null } };
        mesh.geometry?.dispose();
        mesh.material?.map?.dispose();
        mesh.material?.dispose();
      });
      marker.visual.root.removeFromParent();
      marker.entity.destroy();
    }
    this.markers = [];
  }

  /** New reading: the reading flow gathers the cards; this clears the spots and the queue. */
  private reset(): void {
    clearTimeout(this.offerTimer);
    this.offered = null;
    this.dropTarget = -1;
    this.removeMarkers();
  }
}
