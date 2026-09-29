import { createSystem, PanelDocument, Quaternion, type Entity } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { UiPanel } from '../components/ui.js';
import { ease, lerp } from '../lib/tween.js';
import type { ReadingSnapshot, ReadingStateName } from '../state/readingMachine.js';
import menuTemplate from '../ui/menu.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { getSpread } from '../spreads/catalog.js';
import type { CardVisual } from '../visuals/tableVisuals.js';
import { TableGrabSystem } from './tableGrabSystem.js';
import { TableSystem } from './tableSystem.js';

const GATHER_SECONDS = 0.35;

const STATUS: Record<Exclude<ReadingStateName, 'PLACING'>, (s: ReadingSnapshot, drawn: number) => string> = {
  IDLE: () => 'Take a breath. When you are ready, choose a reading.',
  READY: () => 'Shuffle the deck: tap it, or lift it and give it a shake.',
  SHUFFLING: () => 'Shuffling...',
  DRAWING: (s, drawn) => {
    const next = s.slots.find((slot) => slot.cardId === null)?.label;
    if (drawn === 0) {
      return next
        ? `Draw the card for ${next}: pinch the top card, or tap the deck.`
        : 'Draw your card: pinch the top card, or tap the deck.';
    }
    return `Now the card for ${next ?? 'the next spot'}. Lift the deck and shake it to shuffle what's left.`;
  },
  AWAITING_FLIPS: (s) =>
    s.slots.length === 1
      ? 'Turn the card over: tap it, or pick it up and turn your hand.'
      : 'Turn the cards over in any order: tap one, or pick it up and turn your hand.',
  REVEALED: () => 'Take your time with what came up.',
};

/**
 * The reading menu, and clearing the table for a new reading. The deck,
 * drawing, and the cards themselves each have their own system; this one
 * follows the state machine to show the right choices and words.
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
      template: menuTemplate,
      parent: this.table.mat,
      name: 'MenuPanel',
      scale: config.ui.panelScale,
    });
    this.placeMenu('IDLE');

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.menu) this.wireMenu();
      }),
      app.machine.subscribe((snapshot, event) => {
        this.refreshMenu(snapshot);
        if (event.type === 'NEW_READING') this.clearTable();
      }),
    );
  }

  private wireMenu(): void {
    const document = panelDocument(this.menu)!;
    this.cleanupFuncs.push(
      bindClicks(document, {
        'mn-single': () => this.choose('single'),
        'mn-three': () => this.choose('past-present-future'),
        'mn-new': () => app.machine.send({ type: 'NEW_READING' }),
        'mn-move': () => app.machine.send({ type: 'REPLACE_MAT' }),
        'mn-view-room': () => (app.surroundings.value = 'room'),
        ...Object.fromEntries(
          app.theme.theme.environments.map((env, i) => [`mn-view-env-${i}`, () => (app.surroundings.value = env.id)]),
        ),
      }),
      app.surroundings.subscribe(() => this.refreshViewToggle()),
    );
    // One chip per environment the theme offers, with an icon for its kind.
    app.theme.theme.environments.forEach((env, i) => {
      const show = (id: string, on: boolean) =>
        document.getElementById(id)?.setProperties({ display: on ? 'flex' : 'none' });
      show(`mn-view-env-${i}`, true);
      show(`mn-view-env-${i}-moon`, env.kind === 'night-sanctum');
      show(`mn-view-env-${i}-sun`, env.kind === 'cloud-sea');
      setText(document, `mn-view-env-${i}-text`, env.label);
    });
    this.refreshMenu(app.machine.current);
  }

  private choose(id: string): void {
    const spread = getSpread(id);
    if (spread) app.machine.send({ type: 'CHOOSE_SPREAD', spread });
  }

  /** Highlight whichever surroundings are active, using the theme's accent. */
  private refreshViewToggle(): void {
    const document = panelDocument(this.menu);
    if (!document) return;
    const { colors } = app.theme.theme;
    const current = app.surroundings.peek();
    const options = [
      { chip: 'mn-view-room', id: 'room', icons: ['mn-view-room-icon'] },
      ...app.theme.theme.environments.map((env, i) => ({
        chip: `mn-view-env-${i}`,
        id: env.id,
        icons: [`mn-view-env-${i}-moon`, `mn-view-env-${i}-sun`],
      })),
    ];
    for (const option of options) {
      const on = option.id === current;
      document.getElementById(option.chip)?.setProperties({
        backgroundColor: on ? colors.accent : 'transparent',
        borderColor: on ? colors.accent : colors.panelBorder,
      });
      const ink = on ? colors.accentText : colors.panelText;
      document.getElementById(`${option.chip}-text`)?.setProperties({ color: ink });
      for (const icon of option.icons) document.getElementById(icon)?.setProperties({ color: ink });
    }
  }

  /**
   * Between readings the menu stands above the far edge of the mat. During a
   * reading it moves to the reader's left, clear of the deck and the cards,
   * so reaching for them never brushes a button.
   */
  private placeMenu(state: ReadingStateName): void {
    const menu = this.menu.object3D!;
    // Between readings the mat is its everyday size; during one it may have grown.
    const bounds = state === 'IDLE' || state === 'PLACING' ? this.table.fit(null).bounds : this.table.layout.bounds;
    if (state === 'IDLE' || state === 'PLACING') {
      menu.position.set(0, 0.2, bounds.minZ - 0.03);
      menu.rotation.set(-0.35, 0, 0, 'YXZ');
    } else {
      menu.position.set(bounds.minX - 0.1, 0.1, bounds.maxZ - 0.26);
      menu.rotation.set(-0.3, 0.6, 0, 'YXZ');
    }
  }

  private refreshMenu(snapshot: ReadingSnapshot): void {
    const state = snapshot.state;
    setPanelActive(this.menu, state !== 'PLACING');
    this.placeMenu(state);
    const document = panelDocument(this.menu);
    if (!document || state === 'PLACING') return;
    setText(document, 'mn-status', STATUS[state](snapshot, app.machine.drawnCount));
    const show = (id: string, visible: boolean) =>
      document.getElementById(id)?.setProperties({ display: visible ? 'flex' : 'none' });
    show('mn-title', state === 'IDLE');
    show('mn-choices', state === 'IDLE');
    show('mn-move', state === 'IDLE');
    // The surroundings toggle only appears when the theme has VR surroundings.
    show('mn-view', state === 'IDLE' && app.theme.theme.environments.length > 0);
    show('mn-new', state !== 'IDLE' && state !== 'SHUFFLING');
    this.refreshViewToggle();
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
          if (--remaining === 0) this.table.resetLayout('reading');
        });
    });
  }
}
