import { createSystem, Quaternion, Vector3, type Entity, type Object3D } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { ease, lerp } from '../lib/tween.js';
import type { ReadingSnapshot } from '../state/readingMachine.js';
import { slotPosition } from '../visuals/layout.js';
import {
  buildSlotMarker,
  deckStackHeight,
  loadColorTexture,
  MAT_SURFACE_Y,
  type SlotMarkerVisual,
} from '../visuals/tableVisuals.js';
import { TableGrabSystem } from './tableGrabSystem.js';
import { TableSystem, type TableCard } from './tableSystem.js';

const FLY_SECONDS = 0.5;
const FLY_ARC_M = 0.05;
const MARKER_OPACITY = { rest: 0.35, next: 0.9 } as const;
const MARKER_PULSE_RATE = 2.4;

interface Marker {
  slot: number;
  entity: Entity;
  visual: SlotMarkerVisual;
  /** A card is in this spot, so its outline is hidden. */
  filled: boolean;
}

/**
 * Drawing cards. Cards come off the top of the deck in order: Past, then
 * Present, then Future. Pinch the top card to take it into your fingers, or
 * tap the deck to send it straight to its spot face down. The spot waiting
 * for the next card glows softly.
 */
export class DrawSystem extends createSystem({}) {
  private table!: TableSystem;
  private markers: Marker[] = [];
  /** Set while a pinch is drawing, so the new card goes to the hand instead of flying. */
  private pulling = false;
  private pulled: TableCard | null = null;
  private time = 0;

  private readonly deckPos = new Vector3();
  private readonly deckQuat = new Quaternion();
  private readonly lift = new Vector3();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.world.getSystem(TableGrabSystem)!.pull = () => this.pull();

    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event) => {
        switch (event.type) {
          case 'CHOOSE_SPREAD':
            this.buildMarkers(snapshot);
            break;
          case 'SHUFFLE_DONE':
            this.preloadUpcoming();
            break;
          case 'DRAW':
            this.drawn(snapshot, event.slot!);
            this.preloadUpcoming();
            break;
          case 'NEW_READING':
            this.removeMarkers();
            break;
        }
      }),
    );
  }

  update(delta: number): void {
    this.time += delta;
    // The spot the next card belongs to breathes gently while you draw.
    const snapshot = app.machine.current;
    const drawing = snapshot.state === 'DRAWING';
    const next = snapshot.slots.findIndex((slot) => slot.cardId === null);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * MARKER_PULSE_RATE * Math.PI);
    for (const marker of this.markers) {
      if (marker.filled) continue;
      const target =
        drawing && marker.slot === next
          ? lerp(MARKER_OPACITY.rest, MARKER_OPACITY.next, pulse)
          : MARKER_OPACITY.rest;
      marker.visual.outline.opacity += (target - marker.visual.outline.opacity) * 0.2;
    }
  }

  /** Draw the next card into a pinching hand. Returns the card, or null if drawing isn't allowed now. */
  private pull(): TableCard | null {
    this.pulling = true;
    this.pulled = null;
    try {
      app.machine.send({ type: 'DRAW' });
    } finally {
      this.pulling = false;
    }
    const card = this.pulled;
    this.pulled = null;
    return card;
  }

  /** A card came off the deck for `slot`: into the hand that pinched it, or flying to its spot. */
  private drawn(snapshot: ReadingSnapshot, slot: number): void {
    const data = snapshot.slots[slot];
    if (!data?.cardId || !snapshot.spread) return;

    // The new card starts on top of the deck, wherever the deck is.
    const deck = this.table.deck.object3D!;
    this.lift.set(0, deckStackHeight(app.cards.size), 0).applyQuaternion(deck.quaternion);
    this.deckPos.copy(deck.position).add(this.lift);
    this.deckQuat.copy(deck.quaternion);
    const card = this.table.createCard(this.deckPos.x, this.deckPos.y, this.deckPos.z);
    card.visual.root.quaternion.copy(this.deckQuat);
    card.slot = slot;
    card.cardId = data.cardId;
    card.reversed = data.reversed;
    this.loadFace(card);
    this.hideMarker(slot);

    if (this.pulling) {
      card.phase = 'held';
      this.pulled = card;
      return;
    }
    this.fly(card, snapshot);
  }

  /** Send a card to its own spot face down, the way a dealer would. */
  private fly(card: TableCard, snapshot: ReadingSnapshot): void {
    if (!snapshot.spread) return;
    card.phase = 'flying';
    const root = card.visual.root;
    const from = root.position.clone();
    const fromQuat = root.quaternion.clone();
    const to = slotPosition(snapshot.spread, card.slot);
    // A reversed card lands turned end over end, like a real one would.
    const toQuat = new Quaternion().setFromAxisAngle(UP, card.reversed ? Math.PI : 0);
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
          root.quaternion.slerpQuaternions(fromQuat, toQuat, k);
        },
      })
      .then((done) => {
        if (done) this.table.land(card);
      });
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

  /** Warm the image cache for the next few cards so faces are ready when they're drawn. */
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
      this.markers.push({ slot: slot.slot, entity, visual, filled: false });
    }
  }

  /** Hide a filled spot's outline and name. */
  private hideMarker(slot: number): void {
    const marker = this.markers.find((m) => m.slot === slot);
    if (!marker) return;
    marker.filled = true;
    marker.visual.root.visible = false;
  }

  private removeMarkers(): void {
    for (const marker of this.markers) {
      marker.visual.root.traverse((object: Object3D) => {
        const mesh = object as {
          geometry?: { dispose(): void };
          material?: { dispose(): void; map?: { dispose(): void } | null };
        };
        mesh.geometry?.dispose();
        mesh.material?.map?.dispose();
        mesh.material?.dispose();
      });
      marker.visual.root.removeFromParent();
      marker.entity.destroy();
    }
    this.markers = [];
  }
}

const UP = new Vector3(0, 1, 0);
