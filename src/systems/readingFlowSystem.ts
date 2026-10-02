import { createSystem, PanelDocument, Quaternion, type Entity } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { UiPanel } from '../components/ui.js';
import { ease, lerp } from '../lib/tween.js';
import { onScreen } from '../app/screen.js';
import { session } from '../net/session.js';
import type { ReadingSnapshot, ReadingStateName } from '../state/readingMachine.js';
import hudTemplate from '../ui/hud.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { guestReadingStatus, hostShuffleModeStatus, sessionLine } from '../ui/togetherCopy.js';
import type { CardVisual } from '../visuals/tableVisuals.js';
import { HubSystem } from './hubSystem.js';
import { TableGrabSystem } from './tableGrabSystem.js';
import { TableSystem } from './tableSystem.js';
import { TogetherSystem } from './togetherSystem.js';

const GATHER_SECONDS = 0.35;

const STATUS: Record<Exclude<ReadingStateName, 'PLACING' | 'IDLE'>, (s: ReadingSnapshot, drawn: number) => string> = {
  READY: () => 'Shuffle the deck: tap it, or lift it and give it a shake.',
  SHUFFLING: () => 'Shuffling...',
  DRAWING: (s, drawn) => {
    if (s.slots.length === 1) return 'Draw your card: pinch the top card, or tap the deck.';
    const next = s.slots.find((slot) => slot.cardId === null)?.label ?? 'the next spot';
    if (drawn === 0) return `Draw the card for ${next}: pinch the top card, or tap the deck.`;
    return `Now the card for ${next}. Lift the deck and shake it to shuffle what's left.`;
  },
  AWAITING_FLIPS: (s) =>
    s.slots.length === 1
      ? 'Turn the card over: tap it, or pick it up and turn your hand.'
      : 'Turn the cards over in any order: tap one, or pick it up and turn your hand.',
  REVEALED: () => 'Take your time with what came up.',
};

/**
 * The small panel beside the mat during a reading (what to do next, New
 * reading), and clearing the table afterwards. The deck, drawing, and the
 * cards each have their own system; between readings the hub is the menu.
 */
export class ReadingFlowSystem extends createSystem({
  panels: { required: [UiPanel, PanelDocument] },
}) {
  private table!: TableSystem;
  private menu!: Entity;

  /** Placed cards by slot, for dev tooling and tests. */
  get dealt(): { slot: number; cardId: string | null; reversed: boolean; entity: Entity; visual: CardVisual }[] {
    const cards: { slot: number; cardId: string | null; reversed: boolean; entity: Entity; visual: CardVisual }[] = [];
    for (const card of this.table.cards) {
      if (card.phase === 'placed') cards[card.slot] = card;
    }
    return cards;
  }

  init(): void {
    this.table = this.world.getSystem(TableSystem)!;
    this.menu = createPanel(this.world, {
      kind: 'menu',
      template: hudTemplate,
      parent: this.table.mat,
      name: 'ReadingPanel',
      scale: config.ui.panelScale,
    });

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.menu) this.wireMenu();
      }),
      app.machine.subscribe((snapshot, event) => {
        this.refreshMenu(snapshot);
        if (event.type === 'NEW_READING') this.clearTable();
      }),
      // The panel stays just beyond the mat's left edge as the mat grows.
      this.table.onLayout(() => this.placeMenu()),
      session.subscribe(() => this.refreshMenu(app.machine.current)),
      onScreen.subscribe(() => this.refreshMenu(app.machine.current)),
    );
    this.refreshMenu(app.machine.current);
  }

  private wireMenu(): void {
    const document = panelDocument(this.menu)!;
    this.cleanupFuncs.push(
      bindClicks(document, {
        'mn-new': () => app.machine.send({ type: 'NEW_READING' }),
        'mn-another': () => {
          if (app.machine.send({ type: 'NEW_READING' })) this.world.getSystem(HubSystem)?.openSpreads();
        },
        'mn-leave': () => this.world.getSystem(TogetherSystem)?.leave(),
        // The reading waits while the mat moves, and carries on once it's down.
        'mn-move': () => app.machine.send({ type: 'REPLACE_MAT' }),
        // The host hands the shuffle to the guest, or takes it back.
        'mn-mode': () => {
          const together = this.world.getSystem(TogetherSystem);
          together?.setMode(session.peek().mode === 'watch' ? 'shuffle' : 'watch');
        },
      }),
    );
    this.refreshMenu(app.machine.current);
  }

  /** To the reader's left of the mat, clear of the deck and the cards, turned toward them. */
  private placeMenu(): void {
    const menu = this.menu.object3D!;
    const bounds = this.table.layout.bounds;
    menu.position.set(bounds.minX - 0.1, 0.1, bounds.maxZ - 0.26);
    menu.rotation.set(-0.3, 0.6, 0, 'YXZ');
  }

  private refreshMenu(snapshot: ReadingSnapshot): void {
    const state = snapshot.state;
    const reading = state !== 'IDLE' && state !== 'PLACING' && !onScreen.peek();
    setPanelActive(this.menu, reading);
    if (!reading) return;
    this.placeMenu();
    const document = panelDocument(this.menu);
    if (!document) return;
    const s = session.peek();
    const guest = s.role === 'guest';
    const drawn = app.machine.drawnCount;
    const status = guest
      ? guestReadingStatus(state, s.mode)
      : s.role === 'host' && s.mode === 'shuffle' && s.peerPresent
        ? (hostShuffleModeStatus(state, snapshot, drawn) ?? STATUS[state](snapshot, drawn))
        : STATUS[state](snapshot, drawn);
    setText(document, 'mn-status', status);
    const line = sessionLine(s);
    if (line) setText(document, 'mn-session', line);
    setText(document, 'mn-leave-text', guest ? 'Leave the reading' : 'Close the room');
    const show = (id: string, visible: boolean) =>
      document.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
    // The reader decides when a reading starts over; a guest can only leave.
    show('mn-new', !guest && state !== 'SHUFFLING');
    show('mn-another', !guest && state === 'READY');
    show('mn-session', line !== null);
    show('mn-move', state !== 'SHUFFLING');
    show('mn-mode', s.role === 'host' && s.peerPresent && state !== 'SHUFFLING');
    setText(document, 'mn-mode-text', s.mode === 'watch' ? 'Let your guest shuffle' : 'Shuffle it yourself');
    show('mn-leave', s.role !== 'solo');
  }

  /**
   * Sweep every card back into the deck, including any held or in flight,
   * remove them, then let the mat go back to its everyday size.
   */
  private clearTable(): void {
    this.world.getSystem(TableGrabSystem)!.releaseAll();
    const deck = this.table.deck.object3D!.position;
    const flat = new Quaternion();
    const cards = [...this.table.cards];
    if (cards.length === 0) {
      this.table.resetLayout('reading');
      return;
    }
    let remaining = cards.length;
    cards.forEach((card, i) => {
      card.phase = 'gathering';
      card.heldBy = null;
      const root = card.visual.root;
      const from = root.position.clone();
      const fromQuat = root.quaternion.clone();
      const pivotStart = card.visual.pivot.rotation.z;
      void this.table
        .move(card, {
          duration: GATHER_SECONDS,
          delay: i * 0.05,
          easing: ease.inOutCubic,
          onUpdate: (k) => {
            // Toward the deck wherever it is now (it may be gliding home).
            root.position.set(
              lerp(from.x, deck.x, k),
              lerp(from.y, this.table.deckTopY(), k) + Math.sin(Math.PI * k) * 0.03,
              lerp(from.z, deck.z, k),
            );
            root.quaternion.slerpQuaternions(fromQuat, flat, k);
            // Turn face-up cards back over on the way.
            card.visual.pivot.rotation.z = lerp(pivotStart, Math.PI, k);
          },
        })
        .then(() => {
          this.table.removeCard(card);
          // Only if no new reading has started while the cards were gathering.
          if (--remaining === 0 && app.machine.state === 'IDLE') this.table.resetLayout('reading');
        });
    });
  }
}
