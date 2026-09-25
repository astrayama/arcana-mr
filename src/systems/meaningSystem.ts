import {
  createSystem,
  PanelDocument,
  Pressed,
  type Entity,
  type UIKitDocument,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import type { CardOrientation } from '../data/cards.schema.js';
import { TarotCard } from '../components/tarotCard.js';
import { UiPanel } from '../components/ui.js';
import type { ReadingSlot } from '../state/readingMachine.js';
import labelTemplate from '../ui/cardLabel.uikitml?raw';
import meaningTemplate from '../ui/meaning.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { slotPosition } from '../visuals/layout.js';
import { TableSystem } from './tableSystem.js';

/**
 * Two candidate layouts for the 3-card spread, selectable with ?layout= while
 * the final choice is made:
 *   focus    - a small label by each flipped card and one full meaning panel
 *              above the mat for the card in focus (tap a card to switch)
 *   triptych - all three full meaning panels at once, in a shallow arc
 */
export type MeaningLayout = 'focus' | 'triptych';
export const MEANING_LAYOUTS: readonly MeaningLayout[] = ['focus', 'triptych'];

const MAX_SLOTS = 3;
const UNWRITTEN: CardOrientation = {
  keywords: ['', '', ''],
  read: "This card's reflection is still being written.",
  prompt: 'What stands out to you first when you look at this card?',
};

/** Shows what each flipped card means. */
export class MeaningSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
  pressedCards: { required: [TarotCard, Pressed] },
}) {
  layout: MeaningLayout = 'focus';
  /** The slot whose full meaning is showing in the focus layout, or -1. */
  focusedSlot = -1;

  private meaningPanels: Entity[] = [];
  private labels: Entity[] = [];
  /** What each panel should show once its document has loaded. */
  private pending = new Map<Entity, ReadingSlot | null>();

  init(): void {
    const requested = new URLSearchParams(window.location.search).get(config.urlParams.layout);
    this.layout = MEANING_LAYOUTS.includes(requested as MeaningLayout)
      ? (requested as MeaningLayout)
      : 'focus';

    const mat = this.world.getSystem(TableSystem)!.mat;
    const panelCount = this.layout === 'focus' ? 1 : MAX_SLOTS;
    for (let i = 0; i < panelCount; i++) {
      this.meaningPanels.push(
        createPanel(this.world, {
          kind: 'meaning',
          slot: i,
          template: meaningTemplate,
          parent: mat,
          name: `MeaningPanel-${i}`,
          scale: config.ui.panelScale,
        }),
      );
    }
    if (this.layout === 'focus') {
      for (let i = 0; i < MAX_SLOTS; i++) {
        this.labels.push(
          createPanel(this.world, {
            kind: 'label',
            slot: i,
            template: labelTemplate,
            parent: mat,
            name: `CardLabel-${i}`,
            scale: config.ui.labelScale,
          }),
        );
      }
    }

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => this.onPanelReady(entity)),
      this.queries.pressedCards.subscribe('qualify', (entity) => {
        // Pressing a card that is already face up brings its meaning into focus.
        if (entity.getValue(TarotCard, 'faceUp')) {
          this.focus(entity.getValue(TarotCard, 'slot') ?? -1);
        }
      }),
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'FLIP') {
          const slot = snapshot.slots[event.slot];
          if (slot) this.reveal(slot, snapshot.slots.length);
        }
        if (snapshot.state === 'IDLE' || snapshot.state === 'PLACING' || event.type === 'START_READING') {
          this.hideAll();
        }
      }),
    );
  }

  private onPanelReady(entity: Entity): void {
    const labelSlot = this.labels.indexOf(entity);
    if (labelSlot >= 0) {
      const document = panelDocument(entity)!;
      this.cleanupFuncs.push(bindClicks(document, { label: () => this.focus(labelSlot) }));
    }
    if (this.pending.has(entity)) {
      this.fill(entity, this.pending.get(entity)!);
    }
  }

  /** A card was just turned over. */
  private reveal(slot: ReadingSlot, cardCount: number): void {
    if (this.layout === 'focus') {
      const label = this.labels[slot.slot];
      this.placeLabel(label, slot.slot, cardCount);
      this.fill(label, slot);
      setPanelActive(label, true);
      this.focus(slot.slot);
    } else {
      const panel = this.meaningPanels[cardCount === 1 ? 1 : slot.slot];
      this.placeTriptych(panel, cardCount === 1 ? 1 : slot.slot);
      this.fill(panel, slot);
      setPanelActive(panel, true);
    }
  }

  /** Focus layout: show one card's full meaning above the mat. */
  focus(slotIndex: number): void {
    if (this.layout !== 'focus') return;
    const slot = app.machine.current.slots[slotIndex];
    if (!slot?.faceUp) return;
    this.focusedSlot = slotIndex;
    const panel = this.meaningPanels[0];
    // Above the far edge of the mat, tipped back toward the reader.
    panel.object3D!.position.set(0, 0.34, -config.layout.matDepthM / 2 - 0.08);
    panel.object3D!.rotation.set(-0.3, 0, 0);
    this.fill(panel, slot);
    setPanelActive(panel, true);
  }

  private placeLabel(label: Entity, slot: number, cardCount: number): void {
    const spread = cardCount === 1 ? 'single' : 'three';
    const at = slotPosition(spread, slot);
    // Just beyond the card's far edge, so it never covers the card itself.
    label.object3D!.position.set(at.x, 0.035, at.z - app.cardHeightM / 2 - 0.012);
    label.object3D!.rotation.set(-0.5, 0, 0);
  }

  private placeTriptych(panel: Entity, index: number): void {
    const side = index - 1;
    panel.object3D!.position.set(side * 0.39, 0.34, -0.32 + Math.abs(side) * 0.09);
    panel.object3D!.rotation.set(-0.25, -side * 0.45, 0, 'YXZ');
  }

  private hideAll(): void {
    this.focusedSlot = -1;
    for (const panel of [...this.meaningPanels, ...this.labels]) {
      setPanelActive(panel, false);
      this.pending.delete(panel);
    }
  }

  private fill(entity: Entity, slot: ReadingSlot | null): void {
    const document = panelDocument(entity);
    if (!document) {
      this.pending.set(entity, slot);
      return;
    }
    this.pending.delete(entity);
    if (!slot) return;
    const card = app.cards.get(slot.cardId);
    const position = (slot.label ?? 'Your card').toUpperCase();
    const show = (doc: UIKitDocument, id: string, visible: boolean) =>
      doc.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });

    if (this.labels.includes(entity)) {
      setText(document, 'lb-position', position);
      setText(document, 'lb-name', card?.name ?? slot.cardId);
      show(document, 'lb-up', !slot.reversed);
      show(document, 'lb-rev', slot.reversed);
      return;
    }

    const orientation = (slot.reversed ? card?.reversed : card?.upright) ?? UNWRITTEN;
    setText(document, 'mg-position', position);
    setText(document, 'mg-name', card?.name ?? slot.cardId);
    show(document, 'mg-badge-up', !slot.reversed);
    show(document, 'mg-badge-rev', slot.reversed);
    orientation.keywords.forEach((keyword, i) => {
      setText(document, `mg-kw-${i}`, keyword);
      show(document, `mg-kw-${i}`, keyword.length > 0);
    });
    setText(document, 'mg-read', orientation.read);
    setText(document, 'mg-prompt', orientation.prompt);
  }
}
