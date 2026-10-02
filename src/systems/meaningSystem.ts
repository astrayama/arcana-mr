import {
  createSystem,
  PanelDocument,
  Pressed,
  type Entity,
  type UIKitDocument,
} from '@iwsdk/core';
import { onScreen } from '../app/screen.js';
import { app } from '../app/context.js';
import { config } from '../config.js';
import type { CardOrientation } from '../data/cards.schema.js';
import { TarotCard } from '../components/tarotCard.js';
import { UiPanel } from '../components/ui.js';
import type { ReadingSlot, ReadingSnapshot } from '../state/readingMachine.js';
import labelTemplate from '../ui/cardLabel.uikitml?raw';
import meaningTemplate from '../ui/meaning.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { MAT_SURFACE_Y } from '../visuals/layout.js';
import type { TableLayout } from '../visuals/spreadLayout.js';
import { TableSystem } from './tableSystem.js';

const UNWRITTEN: CardOrientation = {
  keywords: ['', '', ''],
  read: "This card's reflection is still being written.",
  prompt: 'What stands out to you first when you look at this card?',
};

/** Labels lie almost flat, tipped this far up toward the reader so they read easily. */
const LABEL_TILT = 0.45;
const LABEL_LIFT_M = 0.012;
/** The meaning panel grows a little on a deep mat, where it sits farther away. */
const DEEP_MAT_GROWTH = 0.15;
/** Height of the meaning panel's center above the mat at its everyday size. */
const PANEL_HEIGHT_M = 0.36;

/**
 * Shows what the face-up cards mean. Each face-up card gets a small label in
 * front of it (position and name), and one full meaning panel stands beyond
 * the far edge of the mat for the card in focus. Tap a card or its label to
 * bring it into focus, or step through them with Previous and Next.
 */
export class MeaningSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
  pressedCards: { required: [TarotCard, Pressed] },
}) {
  /** The slot whose full meaning is showing, or -1. */
  focusedSlot = -1;

  private table!: TableSystem;
  private panel!: Entity;
  /** One label per label group, reused from reading to reading. */
  private readonly labels: Entity[] = [];
  /** Which slots each label shows (a card, and the card lying across it). */
  private readonly labelSlots: number[][] = [];
  /** What each panel should show once its document has loaded. */
  private readonly pending = new Map<Entity, () => void>();

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.panel = createPanel(this.world, {
      kind: 'meaning',
      slot: 0,
      template: meaningTemplate,
      parent: this.table.mat,
      name: 'MeaningPanel',
      scale: config.ui.panelScale,
    });

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => this.onPanelReady(entity)),
      this.queries.pressedCards.subscribe('qualify', (entity) => {
        // Pressing a card that is already face up brings its meaning into focus.
        if (entity.getValue(TarotCard, 'faceUp')) this.focus(entity.getValue(TarotCard, 'slot') ?? -1);
      }),
      this.table.onLayout((layout) => {
        if (layout.spread && layout.spread.id === app.machine.current.spread?.id) this.prepareLabels(layout);
      }),
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'TURN') {
          if (event.faceUp) this.reveal(event.slot);
          else this.conceal(event.slot, snapshot);
        }
        if (snapshot.state === 'IDLE' || snapshot.state === 'PLACING' || event.type === 'CHOOSE_SPREAD') {
          this.hideAll();
        }
        // A shared reading caught up at once: label every face-up card.
        if (event.type === 'RESTORE') {
          this.hideAll();
          for (const slot of snapshot.slots) if (slot.faceUp) this.refreshLabelFor(slot.slot);
        }
      }),
    );
  }

  private onPanelReady(entity: Entity): void {
    const document = panelDocument(entity)!;
    if (entity === this.panel) {
      this.cleanupFuncs.push(
        bindClicks(document, {
          'mg-prev': () => this.step(-1),
          'mg-next': () => this.step(1),
        }),
      );
    }
    const labelIndex = this.labels.indexOf(entity);
    if (labelIndex >= 0) {
      this.cleanupFuncs.push(
        bindClicks(document, {
          'lb-e1': () => this.focus(this.labelSlots[labelIndex][0] ?? -1),
          'lb-e2': () => this.focus(this.labelSlots[labelIndex][1] ?? -1),
        }),
      );
    }
    const fill = this.pending.get(entity);
    if (fill) {
      this.pending.delete(entity);
      fill();
    }
  }

  /** Run `fill` now if the panel's document is ready, or as soon as it loads. */
  private whenReady(entity: Entity, fill: (doc: UIKitDocument) => void): void {
    const document = panelDocument(entity);
    if (document) {
      this.pending.delete(entity);
      fill(document);
    } else {
      this.pending.set(entity, () => fill(panelDocument(entity)!));
    }
  }

  /** Make sure there's a label for every label group, placed and sized for this layout. */
  private prepareLabels(layout: TableLayout): void {
    while (this.labels.length < layout.labelGroups.length) {
      const i = this.labels.length;
      this.labels.push(
        createPanel(this.world, {
          kind: 'label',
          slot: i,
          template: labelTemplate,
          parent: this.table.mat,
          name: `CardLabel-${i}`,
          scale: config.ui.labelScale,
        }),
      );
      this.labelSlots.push([]);
    }
    layout.labelGroups.forEach((group, i) => {
      const label = this.labels[i].object3D!;
      const r = group.rect;
      label.position.set((r.minX + r.maxX) / 2, MAT_SURFACE_Y + LABEL_LIFT_M, (r.minZ + r.maxZ) / 2);
      label.rotation.set(-Math.PI / 2 + LABEL_TILT, 0, 0);
      label.scale.setScalar(config.ui.labelScale * layout.cardScale);
      this.labelSlots[i] = group.slots;
    });
  }

  /** A card was just turned face up: label it and bring it into focus. */
  private reveal(slot: number): void {
    this.refreshLabelFor(slot);
    this.focus(slot);
  }

  /** A card was turned back face down: its meaning goes away until it's turned up again. */
  private conceal(slot: number, snapshot: ReadingSnapshot): void {
    this.refreshLabelFor(slot);
    if (this.focusedSlot !== slot) {
      this.refreshNav();
      return;
    }
    const other = snapshot.slots.find((s) => s.faceUp && s.cardId);
    if (other) {
      this.focus(other.slot);
    } else {
      this.setFocused(-1);
      setPanelActive(this.panel, false);
      this.pending.delete(this.panel);
    }
  }

  /** Show, update, or hide the label that covers `slot`. */
  private refreshLabelFor(slot: number): void {
    const index = this.labelSlots.findIndex((slots) => slots.includes(slot));
    if (index < 0) return;
    const label = this.labels[index];
    const snapshot = app.machine.current;
    const shown = this.labelSlots[index].map((s) => snapshot.slots[s]).filter((s) => s?.faceUp && s.cardId);
    // Labels sit near the cards you grab, so they only take rays, never pokes.
    setPanelActive(label, shown.length > 0, { poke: false });
    if (shown.length === 0) {
      this.pending.delete(label);
      return;
    }
    this.whenReady(label, (doc) => {
      const [first, second] = shown;
      this.fillLabelEntry(doc, '', first);
      doc.getElementById('lb-e2')?.setProperties({ display: second ? 'flex' : 'none' });
      if (second) this.fillLabelEntry(doc, '2', second);
    });
  }

  private fillLabelEntry(doc: UIKitDocument, suffix: '' | '2', slot: ReadingSlot): void {
    const card = slot.cardId ? app.cards.get(slot.cardId) : undefined;
    setText(doc, `lb${suffix}-position`, slot.label.toUpperCase());
    setText(doc, `lb${suffix}-name`, card?.name ?? slot.cardId ?? '');
    doc.getElementById(`lb${suffix}-rev`)?.setProperties({ display: slot.reversed ? 'flex' : 'none' });
  }

  /** Show one card's full meaning beyond the far edge of the mat. */
  focus(slotIndex: number): void {
    const slot = app.machine.current.slots[slotIndex];
    if (!slot?.faceUp || !slot.cardId) return;
    this.setFocused(slotIndex);
    const panel = this.panel.object3D!;
    const { bounds, mat } = this.table.layout;
    const deep = (mat.depthM - config.layout.matDepthM) / (config.layout.maxMatDepthM - config.layout.matDepthM || 1);
    const growth = 1 + Math.max(0, deep) * DEEP_MAT_GROWTH;
    // A bigger panel stands taller too, so its lower edge never dips onto the cards.
    panel.position.set(0, PANEL_HEIGHT_M * growth, bounds.minZ - 0.08);
    panel.rotation.set(-0.3, 0, 0);
    panel.scale.setScalar(config.ui.panelScale * growth);
    // On a screen, meanings are in the card list beside the view instead.
    if (onScreen.peek()) return;
    setPanelActive(this.panel, true);
    this.whenReady(this.panel, (doc) => this.fillMeaning(doc, slot));
  }

  /** Step to the previous or next face-up card, in spread order. */
  private step(direction: 1 | -1): void {
    const faceUp = this.faceUpSlots();
    if (faceUp.length === 0) return;
    const at = faceUp.indexOf(this.focusedSlot);
    const next = faceUp[(at + direction + faceUp.length) % faceUp.length];
    this.focus(next);
  }

  private faceUpSlots(): number[] {
    return app.machine.current.slots.filter((s) => s.faceUp && s.cardId).map((s) => s.slot);
  }

  private setFocused(slot: number): void {
    this.focusedSlot = slot;
    this.table.focusedSlot = slot;
    this.refreshNav();
  }

  /** Previous and Next appear once more than one card is face up. */
  private refreshNav(): void {
    const faceUp = this.faceUpSlots();
    this.whenReadyIfActive((doc) => {
      doc.getElementById('mg-nav')?.setProperties({ display: faceUp.length > 1 ? 'flex' : 'none' });
      const at = faceUp.indexOf(this.focusedSlot);
      setText(doc, 'mg-count', `${Math.max(at, 0) + 1} of ${faceUp.length}`);
    });
  }

  private whenReadyIfActive(fill: (doc: UIKitDocument) => void): void {
    const doc = panelDocument(this.panel);
    if (doc) fill(doc);
  }

  private hideAll(): void {
    this.setFocused(-1);
    for (const panel of [this.panel, ...this.labels]) {
      setPanelActive(panel, false);
      this.pending.delete(panel);
    }
  }

  private fillMeaning(document: UIKitDocument, slot: ReadingSlot): void {
    const card = slot.cardId ? app.cards.get(slot.cardId) : undefined;
    const show = (id: string, visible: boolean) =>
      document.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
    const orientation = (slot.reversed ? card?.reversed : card?.upright) ?? UNWRITTEN;
    setText(document, 'mg-position', slot.label.toUpperCase());
    setText(document, 'mg-asks', slot.meaning);
    setText(document, 'mg-name', card?.name ?? slot.cardId ?? '');
    show('mg-badge-up', !slot.reversed);
    show('mg-badge-rev', slot.reversed);
    orientation.keywords.forEach((keyword, i) => {
      setText(document, `mg-kw-${i}`, keyword);
      show(`mg-kw-${i}`, keyword.length > 0);
    });
    setText(document, 'mg-read', orientation.read);
    setText(document, 'mg-prompt', orientation.prompt);
    this.refreshNav();
  }
}
