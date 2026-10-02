import { createSystem, Quaternion, Vector3, type Entity, type MeshBasicMaterial, type Object3D } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { ease, lerp } from '../lib/tween.js';
import type { ReadingSnapshot } from '../state/readingMachine.js';
import type { TableLayout } from '../visuals/spreadLayout.js';
import {
  buildSlotOutline,
  buildSpotName,
  deckStackHeight,
  loadColorTexture,
  MAT_SURFACE_Y,
  type SlotOutline,
} from '../visuals/tableVisuals.js';
import { getDeck } from '../decks/registry.js';
import { TableGrabSystem } from './tableGrabSystem.js';
import { TableSystem, type TableCard } from './tableSystem.js';

const FLY_SECONDS = 0.5;
const FLY_ARC_M = 0.05;
const MARKER_OPACITY = { rest: 0.35, next: 0.9 } as const;
const MARKER_PULSE_RATE = 2.4;
const NAME_OPACITY = 0.55;

interface Marker {
  slot: number;
  entity: Entity;
  visual: SlotOutline;
  /** A card is in this spot, so its outline is hidden. */
  filled: boolean;
}

/** A spot's name in the cloth. One name can belong to two spots (a card and the card across it). */
interface SpotName {
  slots: number[];
  entity: Entity;
  root: Object3D;
  material: MeshBasicMaterial;
}

/**
 * Drawing cards. Cards come off the top of the deck in order: Past, then
 * Present, then Future. Pinch the top card to take it into your fingers, or
 * tap the deck to send it straight to its spot face down. The spot waiting
 * for the next card glows softly.
 */
export class DrawSystem extends createSystem({}) {
  private table!: TableSystem;
  /** A spot to make breathe outside a reading (the builder's selected spot), or -1. */
  highlightSlot = -1;
  private markers: Marker[] = [];
  private names: SpotName[] = [];
  /** Set while a pinch is drawing, so the new card goes to the hand instead of flying. */
  private pulling = false;
  /** Set by the together system: a card the other person pulled into their hand. */
  onRemotePull: ((card: TableCard, fallback: () => void) => void) | null = null;
  private pulled: TableCard | null = null;
  private time = 0;

  private readonly deckPos = new Vector3();
  private readonly deckQuat = new Quaternion();
  private readonly lift = new Vector3();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.world.getSystem(TableGrabSystem)!.pull = () => this.pull();

    this.cleanupFuncs.push(
      // The spots on the mat follow the layout: a reading's spread, or the
      // builder's preview, or nothing between readings.
      this.table.onLayout((layout) => this.buildMarkers(layout)),
      app.machine.subscribe((snapshot, event, origin) => {
        switch (event.type) {
          case 'SHUFFLE_DONE':
            this.preloadUpcoming();
            break;
          case 'DRAW':
            this.drawn(snapshot, event.slot!, origin === 'remote' && event.toHand === true);
            this.preloadUpcoming();
            break;
          case 'RESTORE':
            this.restoreCards(snapshot);
            break;
          case 'NEW_READING':
            this.removeMarkers();
            break;
        }
        if (event.type === 'TURN' || event.type === 'DRAW') this.refreshNames(snapshot);
      }),
      () => this.removeMarkers(),
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
      const lit = drawing ? marker.slot === next : marker.slot === this.highlightSlot;
      const target = lit ? lerp(MARKER_OPACITY.rest, MARKER_OPACITY.next, pulse) : MARKER_OPACITY.rest;
      marker.visual.outline.opacity += (target - marker.visual.outline.opacity) * 0.2;
    }
    for (const name of this.names) name.material.opacity += (NAME_OPACITY - name.material.opacity) * 0.15;
  }

  /** Draw the next card into a pinching hand. Returns the card, or null if drawing isn't allowed now. */
  private pull(): TableCard | null {
    this.pulling = true;
    this.pulled = null;
    try {
      app.machine.send({ type: 'DRAW', toHand: true });
    } finally {
      this.pulling = false;
    }
    const card = this.pulled;
    this.pulled = null;
    return card;
  }

  /** A card came off the deck for `slot`: into the hand that pinched it, or flying to its spot. */
  private drawn(snapshot: ReadingSnapshot, slot: number, remoteToHand = false): void {
    const data = snapshot.slots[slot];
    if (!data?.cardId || !snapshot.spread) return;

    // The new card starts on top of the deck, wherever the deck is and however it's tilted.
    const deck = this.table.deck.object3D!;
    this.lift.set(0, deckStackHeight(app.cards.size) * deck.scale.y, 0).applyQuaternion(deck.quaternion);
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
    // In a shared reading, the other person pinched it off the deck: it waits
    // for their hand's motion, and flies to its spot if none arrives.
    if (remoteToHand && this.onRemotePull) {
      this.onRemotePull(card, () => this.fly(card, app.machine.current));
      return;
    }
    this.fly(card, snapshot);
  }

  /** Send a card to its own spot face down, the way a dealer would. */
  private fly(card: TableCard, snapshot: ReadingSnapshot): void {
    const to = this.table.slotPose(card.slot);
    if (!snapshot.spread || !to) return;
    card.phase = 'flying';
    const root = card.visual.root;
    const from = root.position.clone();
    const fromQuat = root.quaternion.clone();
    // A reversed card lands turned end over end, like a real one would.
    const toQuat = new Quaternion().setFromAxisAngle(UP, to.yaw + (card.reversed ? Math.PI : 0));
    void this.table
      .move(card, {
        duration: FLY_SECONDS,
        easing: ease.inOutCubic,
        onUpdate: (k) => {
          root.position.set(
            lerp(from.x, to.x, k),
            lerp(from.y, to.y, k) + Math.sin(Math.PI * k) * FLY_ARC_M,
            lerp(from.z, to.z, k),
          );
          root.quaternion.slerpQuaternions(fromQuat, toQuat, k);
        },
      })
      .then((done) => {
        if (done) this.table.land(card);
      });
  }

  /** Put the card's face image on it (the deck in use, or the default deck if this one lacks it). */
  loadFace(card: TableCard): void {
    const url = card.cardId ? (app.deck.faceUrl(card.cardId) ?? getDeck(config.defaults.deck)?.faceUrl(card.cardId) ?? null) : null;
    if (!url) return;
    loadColorTexture(url).then((texture) => {
      if (!this.table.cards.includes(card)) return;
      card.face = texture;
      card.visual.face.material.map = texture;
      card.visual.face.material.needsUpdate = true;
    });
  }

  /**
   * A shared reading caught up all at once: put every drawn card in its
   * spot, face up or down, without animation. The table has already been
   * cleared and laid out for the spread.
   */
  private restoreCards(snapshot: ReadingSnapshot): void {
    for (const data of snapshot.slots) {
      const pose = this.table.slotPose(data.slot);
      if (!data.cardId || !pose) continue;
      const card = this.table.createCard(pose.x, pose.y, pose.z, pose.yaw + (data.reversed ? Math.PI : 0));
      card.slot = data.slot;
      card.cardId = data.cardId;
      card.reversed = data.reversed;
      card.faceUp = data.faceUp;
      card.visual.pivot.rotation.z = data.faceUp ? 0 : Math.PI;
      this.loadFace(card);
      this.table.land(card);
    }
    this.refreshNames(snapshot);
  }

  /** Warm the image cache for the next few cards so faces are ready when they're drawn. */
  private preloadUpcoming(): void {
    for (const card of app.machine.upcoming(3)) {
      const url = app.deck.faceUrl(card.cardId);
      if (url) void loadColorTexture(url);
    }
  }

  /** Outline every spot of the layout's spread, and set each spot's name into the cloth. */
  private buildMarkers(layout: TableLayout): void {
    this.removeMarkers();
    const spread = layout.spread;
    if (!spread) return;
    const mat = this.table.mat;
    const filled = app.machine.current.spread?.id === spread.id ? app.machine.current.slots : [];
    layout.slots.forEach((pose, slot) => {
      const visual = buildSlotOutline(app.theme, config.card.widthM, app.cardHeightM);
      visual.root.position.set(pose.x, pose.y - MAT_SURFACE_Y, pose.z);
      visual.root.rotation.set(0, pose.yaw, 0);
      visual.root.scale.setScalar(layout.cardScale);
      // Fade in while the mat grows into place.
      visual.outline.opacity = 0;
      const entity = this.world.createTransformEntity(visual.root, { parent: mat });
      const isFilled = filled[slot]?.cardId != null;
      if (isFilled) visual.root.visible = false;
      this.markers.push({ slot, entity, visual, filled: isFilled });
    });
    for (const group of layout.labelGroups) {
      const text = group.slots.map((slot) => spread.positions[slot].label).join(' / ');
      const r = group.rect;
      const { mesh, material } = buildSpotName(app.theme, text, r.maxX - r.minX, r.maxZ - r.minZ);
      mesh.position.set((r.minX + r.maxX) / 2, MAT_SURFACE_Y + 0.0005, (r.minZ + r.maxZ) / 2);
      material.opacity = 0;
      const entity = this.world.createTransformEntity(mesh, { parent: mat });
      this.names.push({ slots: group.slots, entity, root: mesh, material });
    }
    this.refreshNames(app.machine.current);
  }

  /** A spot's name gives way to the card's own label once its card is face up. */
  private refreshNames(snapshot: ReadingSnapshot): void {
    for (const name of this.names) {
      name.root.visible = !name.slots.some((slot) => snapshot.slots[slot]?.faceUp);
    }
  }

  /** Hide a filled spot's outline. */
  private hideMarker(slot: number): void {
    const marker = this.markers.find((m) => m.slot === slot);
    if (!marker) return;
    marker.filled = true;
    marker.visual.root.visible = false;
  }

  private removeMarkers(): void {
    const roots = [
      ...this.markers.map((m) => ({ root: m.visual.root, entity: m.entity })),
      ...this.names.map((n) => ({ root: n.root, entity: n.entity })),
    ];
    for (const marker of roots) {
      marker.root.traverse((object: Object3D) => {
        const mesh = object as {
          geometry?: { dispose(): void };
          material?: { dispose(): void; map?: { dispose(): void } | null };
        };
        mesh.geometry?.dispose();
        mesh.material?.map?.dispose();
        mesh.material?.dispose();
      });
      marker.root.removeFromParent();
      marker.entity.destroy();
    }
    this.markers = [];
    this.names = [];
  }
}

const UP = new Vector3(0, 1, 0);
