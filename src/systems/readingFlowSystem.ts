import { createSystem, PanelDocument, type Entity, type Object3D, type Texture } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { TarotCard } from '../components/tarotCard.js';
import { UiPanel } from '../components/ui.js';
import type { ReadingSnapshot, ReadingStateName } from '../state/readingMachine.js';
import { ease, lerp, Tweens } from '../lib/tween.js';
import menuTemplate from '../ui/menu.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { deckPosition, slotPosition } from '../visuals/layout.js';
import {
  buildCard,
  buildCardGeometry,
  deckStackHeight,
  loadColorTexture,
  MAT_SURFACE_Y,
  type CardGeometry,
  type CardVisual,
} from '../visuals/tableVisuals.js';
import { TableSystem } from './tableSystem.js';

const SHUFFLE_CARDS = 8;
const RIFFLES = 2;
const DEAL_SECONDS = 0.55;
const DEAL_STAGGER = 0.28;
const DEAL_ARC_M = 0.06;
const GATHER_SECONDS = 0.35;

/** A card on the mat for the current reading. */
export interface DealtCard {
  slot: number;
  cardId: string;
  reversed: boolean;
  entity: Entity;
  visual: CardVisual;
}

const STATUS: Record<Exclude<ReadingStateName, 'PLACING'>, (s: ReadingSnapshot) => string> = {
  IDLE: () => 'Take a breath. When you are ready, choose a reading.',
  SHUFFLING: () => 'Shuffling...',
  DEALING: () => 'Dealing...',
  AWAITING_FLIPS: (s) =>
    s.slots.length === 1
      ? 'Turn the card over when you are ready.'
      : 'Turn each card over when you are ready.',
  REVEALED: () => 'Take your time with what came up.',
};

/**
 * Runs the reading on the table: the menu, the shuffle, the deal, and clearing
 * the table for a new reading. It only reacts to the state machine and sends
 * the SHUFFLE_DONE / DEAL_DONE events when its animations finish.
 */
export class ReadingFlowSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
}) {
  /** Cards on the mat for the current reading, by slot. */
  readonly dealt: DealtCard[] = [];

  private readonly tweens = new Tweens();
  private table!: TableSystem;
  private geometry!: CardGeometry;
  private menu!: Entity;
  private shuffleRig!: Entity;
  private shuffleCards: CardVisual[] = [];
  private faceTextures = new Map<number, Texture>();
  private clearing: Promise<void> = Promise.resolve();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.geometry = buildCardGeometry(config.card.widthM, app.cardHeightM);

    this.menu = createPanel(this.world, {
      kind: 'menu',
      template: menuTemplate,
      parent: this.table.mat,
      name: 'MenuPanel',
      scale: config.ui.panelScale,
    });
    this.placeMenu('IDLE');

    // Loose cards used only for the shuffle animation, kept hidden otherwise.
    this.shuffleRig = this.world.createTransformEntity(undefined, { parent: this.table.mat });
    this.shuffleRig.object3D!.name = 'ShuffleRig';
    const deck = deckPosition();
    this.shuffleRig.object3D!.position.set(deck.x, MAT_SURFACE_Y, deck.z);
    this.shuffleRig.object3D!.visible = false;
    for (let i = 0; i < SHUFFLE_CARDS; i++) {
      const card = buildCard(this.table.cardMaterials, this.geometry);
      card.glow.visible = false;
      this.shuffleCards.push(card);
      this.shuffleRig.object3D!.add(card.root);
    }

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.menu) this.wireMenu();
      }),
      app.machine.subscribe((snapshot, event) => this.onState(snapshot, event.type)),
    );
  }

  update(delta: number): void {
    this.tweens.update(delta);
  }

  private wireMenu(): void {
    const document = panelDocument(this.menu)!;
    this.cleanupFuncs.push(
      bindClicks(document, {
        'mn-single': () => app.machine.send({ type: 'START_READING', spread: 'single' }),
        'mn-three': () => app.machine.send({ type: 'START_READING', spread: 'three' }),
        'mn-new': () => app.machine.send({ type: 'NEW_READING' }),
        'mn-move': () => app.machine.send({ type: 'REPLACE_MAT' }),
      }),
    );
    this.refreshMenu(app.machine.current);
  }

  private onState(snapshot: ReadingSnapshot, eventType: string): void {
    this.refreshMenu(snapshot);
    switch (snapshot.state) {
      case 'SHUFFLING':
        if (eventType === 'START_READING') this.runShuffle(snapshot);
        break;
      case 'DEALING':
        this.runDeal(snapshot);
        break;
      case 'IDLE':
        if (eventType === 'NEW_READING') this.clearing = this.clearTable();
        break;
    }
  }

  /**
   * Between readings the menu stands above the far edge of the mat. During a
   * reading it drops to a low, compact spot behind the deck so the meaning
   * panels have the space above the table.
   */
  private placeMenu(state: ReadingStateName): void {
    const menu = this.menu.object3D!;
    const farEdge = -config.layout.matDepthM / 2;
    if (state === 'IDLE' || state === 'PLACING') {
      menu.position.set(0, 0.2, farEdge - 0.03);
      menu.rotation.set(-0.35, 0, 0);
    } else {
      menu.position.set(0, 0.045, farEdge - 0.03);
      menu.rotation.set(-0.75, 0, 0);
    }
  }

  private refreshMenu(snapshot: ReadingSnapshot): void {
    const state = snapshot.state;
    setPanelActive(this.menu, state !== 'PLACING');
    this.placeMenu(state);
    const document = panelDocument(this.menu);
    if (!document || state === 'PLACING') return;
    setText(document, 'mn-status', STATUS[state](snapshot));
    const show = (id: string, visible: boolean) =>
      document.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
    show('mn-title', state === 'IDLE');
    show('mn-choices', state === 'IDLE');
    show('mn-move', state === 'IDLE');
    show('mn-new', state === 'AWAITING_FLIPS' || state === 'REVEALED');
  }

  /** A quick riffle shuffle with loose cards on top of the deck pile. */
  private async runShuffle(snapshot: ReadingSnapshot): Promise<void> {
    const reading = snapshot.readingNumber;
    await this.clearing;
    this.preloadFaces(snapshot);

    const rig = this.shuffleRig.object3D!;
    const base = deckStackHeight(app.cards.size);
    const t = config.card.thicknessM;
    rig.visible = true;
    this.shuffleCards.forEach((card, i) => {
      card.root.position.set(0, base + i * t, 0);
      card.root.rotation.set(0, 0, 0);
    });

    for (let pass = 0; pass < RIFFLES; pass++) {
      // Split into two halves...
      await Promise.all(
        this.shuffleCards.map((card, i) => {
          const side = i < SHUFFLE_CARDS / 2 ? -1 : 1;
          const x0 = card.root.position.x;
          const y0 = card.root.position.y;
          const r0 = card.root.rotation.y;
          const yHalf = base + (i % (SHUFFLE_CARDS / 2)) * t;
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
        this.shuffleCards.map((card, i) => {
          const half = i < SHUFFLE_CARDS / 2 ? 0 : 1;
          const order = (i % (SHUFFLE_CARDS / 2)) * 2 + half;
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

    rig.visible = false;
    if (app.machine.current.readingNumber === reading) {
      app.machine.send({ type: 'SHUFFLE_DONE' });
    }
  }

  /** Start fetching the drawn cards' faces while the shuffle plays. */
  private preloadFaces(snapshot: ReadingSnapshot): void {
    for (const slot of snapshot.slots) {
      const url = app.deck.faceUrl(slot.cardId);
      if (!url) continue;
      loadColorTexture(url).then((texture) => {
        if (app.machine.current.readingNumber !== snapshot.readingNumber) return;
        this.faceTextures.set(slot.slot, texture);
        const card = this.dealt[slot.slot];
        if (card) this.applyFace(card.visual, texture);
      });
    }
  }

  private applyFace(visual: CardVisual, texture: Texture): void {
    visual.face.material.map = texture;
    visual.face.material.needsUpdate = true;
  }

  /** Deal each card face down from the top of the deck into its slot. */
  private async runDeal(snapshot: ReadingSnapshot): Promise<void> {
    const reading = snapshot.readingNumber;
    const deck = deckPosition();
    const top = deckStackHeight(app.cards.size) + MAT_SURFACE_Y;

    await Promise.all(
      snapshot.slots.map((slot) => {
        const visual = buildCard(this.table.cardMaterials, this.geometry);
        const root = visual.root;
        root.name = `Card-${slot.slot}`;
        root.position.set(deck.x, top, deck.z);
        root.visible = false;
        const entity = this.world.createTransformEntity(root, { parent: this.table.mat });
        entity.addComponent(TarotCard, {
          slot: slot.slot,
          cardId: slot.cardId,
          reversed: slot.reversed,
          faceUp: false,
        });
        const dealt: DealtCard = { slot: slot.slot, cardId: slot.cardId, reversed: slot.reversed, entity, visual };
        this.dealt[slot.slot] = dealt;
        const texture = this.faceTextures.get(slot.slot);
        if (texture) this.applyFace(visual, texture);

        const target = slotPosition(snapshot.spread!, slot.slot);
        // A reversed card lands turned end over end, like a real one would.
        const targetYaw = slot.reversed ? Math.PI : 0;
        return this.tweens.play({
          duration: DEAL_SECONDS,
          delay: slot.slot * DEAL_STAGGER,
          easing: ease.inOutCubic,
          onStart: () => {
            root.visible = true;
          },
          onUpdate: (k) => {
            root.position.x = lerp(deck.x, target.x, k);
            root.position.z = lerp(deck.z, target.z, k);
            root.position.y = lerp(top, MAT_SURFACE_Y, k) + Math.sin(Math.PI * k) * DEAL_ARC_M;
            root.rotation.y = lerp(0, targetYaw, k);
          },
        });
      }),
    );

    if (app.machine.current.readingNumber === reading && app.machine.state === 'DEALING') {
      app.machine.send({ type: 'DEAL_DONE' });
    }
  }

  /** Sweep the cards back into the deck, then release everything they used. */
  private async clearTable(): Promise<void> {
    const cards = this.dealt.splice(0);
    const textures = [...this.faceTextures.values()];
    this.faceTextures.clear();
    const deck = deckPosition();
    const top = deckStackHeight(app.cards.size) + MAT_SURFACE_Y;

    await Promise.all(
      cards.map((card, i) => {
        const root = card.visual.root;
        const start = root.position.clone();
        const pivotStart = card.visual.pivot.rotation.z;
        return this.tweens.play({
          duration: GATHER_SECONDS,
          delay: i * 0.05,
          easing: ease.inOutCubic,
          onUpdate: (k) => {
            root.position.x = lerp(start.x, deck.x, k);
            root.position.z = lerp(start.z, deck.z, k);
            root.position.y = lerp(start.y, top, k) + Math.sin(Math.PI * k) * 0.03;
            // Turn face-up cards back over on the way.
            card.visual.pivot.rotation.z = lerp(pivotStart, Math.PI, k);
          },
        });
      }),
    );

    for (const card of cards) this.disposeCard(card);
    // Free GPU memory for the faces; the image stays cached for a quick re-draw.
    for (const texture of textures) texture.dispose();
  }

  private disposeCard(card: DealtCard): void {
    const { visual, entity } = card;
    visual.face.material.dispose();
    visual.glow.material.dispose();
    (visual.root as Object3D).removeFromParent();
    // Shared geometry and back/edge materials stay alive for the next reading.
    entity.destroy();
  }
}
