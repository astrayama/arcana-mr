/**
 * The reading flow as one explicit state machine, kept separate from rendering.
 * Systems send events in and subscribe to state changes; nothing in here knows
 * about Three.js, IWSDK, or the headset.
 *
 *   PLACING ─MAT_PLACED─▶ IDLE ─CHOOSE_SPREAD─▶ READY ─SHUFFLE─▶ SHUFFLING ─SHUFFLE_DONE─▶ DRAWING
 *      ▲                   │                                        ▲                      │  │
 *      └───REPLACE_MAT─────┘                                        └─SHUFFLE (none drawn)─┘  │
 *                                                                                DRAW (last) ▼
 *   IDLE ◀──NEW_READING── READY / DRAWING / AWAITING_FLIPS / REVEALED    AWAITING_FLIPS ─FLIP (last)─▶ REVEALED
 *
 * The deck order is decided at each SHUFFLE (crypto shuffle, per-card
 * reversals). The reader then draws cards one at a time into the spread's
 * spots, in any order, and can turn a card over as soon as it's down.
 */

import { spreads, type SpreadId } from '../data/spreads.js';
import { drawCards, type DrawnCard } from '../lib/shuffle.js';

export type ReadingStateName =
  | 'PLACING'
  | 'IDLE'
  | 'READY'
  | 'SHUFFLING'
  | 'DRAWING'
  | 'AWAITING_FLIPS'
  | 'REVEALED';

export type ReadingEvent =
  | { type: 'MAT_PLACED' }
  | { type: 'REPLACE_MAT' }
  | { type: 'CHOOSE_SPREAD'; spread: SpreadId }
  | { type: 'SHUFFLE' }
  | { type: 'SHUFFLE_DONE' }
  /** Draw the next card into `slot`, or into the first open spot if omitted. */
  | { type: 'DRAW'; slot?: number }
  | { type: 'FLIP'; slot: number }
  | { type: 'NEW_READING' };

export interface ReadingSlot {
  /** Index into the spread's positions. */
  slot: number;
  /** Position label for the meaning panel (Past / Present / Future), or null. */
  label: string | null;
  /** Null until a card has been drawn into this spot. */
  cardId: string | null;
  reversed: boolean;
  faceUp: boolean;
}

export interface ReadingSnapshot {
  state: ReadingStateName;
  spread: SpreadId | null;
  slots: readonly ReadingSlot[];
  /** Increments every time a new reading starts, so systems can tell readings apart. */
  readingNumber: number;
  /** Shuffles in this reading, so systems can tell shuffles apart. */
  shuffles: number;
}

export interface ReadingMachineOptions {
  cardIds: readonly string[];
  reversalChance: number;
  /** Swappable for tests and the dev draw override. Defaults to the crypto-backed `drawCards`. */
  draw?: typeof drawCards;
}

/** Listeners get DRAW with the slot it actually went into. */
export type ResolvedEvent = ReadingEvent;
type Listener = (snapshot: ReadingSnapshot, event: ResolvedEvent) => void;

export class ReadingMachine {
  private snapshot: ReadingSnapshot = {
    state: 'PLACING',
    spread: null,
    slots: [],
    readingNumber: 0,
    shuffles: 0,
  };
  /** The shuffled cards still waiting to be drawn, top first. */
  private pending: DrawnCard[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly draw: typeof drawCards;

  constructor(private readonly options: ReadingMachineOptions) {
    this.draw = options.draw ?? drawCards;
  }

  get current(): ReadingSnapshot {
    return this.snapshot;
  }

  get state(): ReadingStateName {
    return this.snapshot.state;
  }

  /** How many cards have been drawn into the spread so far. */
  get drawnCount(): number {
    return this.snapshot.slots.filter((slot) => slot.cardId !== null).length;
  }

  /** The next few cards on top of the deck, for preloading art. Never shown to the reader. */
  upcoming(count: number): readonly DrawnCard[] {
    return this.pending.slice(0, count);
  }

  /** Listen for accepted transitions. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether `event` would be accepted in the current state. */
  can(event: ReadingEvent): boolean {
    return this.next(event) !== null;
  }

  /**
   * Apply an event. Returns true if it caused a transition. Events that make
   * no sense in the current state (a double tap, a late animation callback)
   * are ignored rather than thrown, so input glitches can't break the flow.
   */
  send(event: ReadingEvent): boolean {
    const result = this.next(event);
    if (result === null) return false;
    this.snapshot = result.snapshot;
    if (result.pending) this.pending = result.pending;
    for (const listener of this.listeners) {
      listener(result.snapshot, result.event);
    }
    return true;
  }

  private next(
    event: ReadingEvent,
  ): { snapshot: ReadingSnapshot; event: ResolvedEvent; pending?: DrawnCard[] } | null {
    const s = this.snapshot;
    const same = (snapshot: ReadingSnapshot) => ({ snapshot, event });

    if (event.type === 'NEW_READING') {
      const allowed = ['READY', 'DRAWING', 'AWAITING_FLIPS', 'REVEALED'].includes(s.state);
      return allowed ? { snapshot: this.cleared(), event, pending: [] } : null;
    }

    switch (s.state) {
      case 'PLACING':
        return event.type === 'MAT_PLACED' ? same({ ...s, state: 'IDLE' }) : null;

      case 'IDLE':
        if (event.type === 'REPLACE_MAT') return same({ ...s, state: 'PLACING' });
        if (event.type === 'CHOOSE_SPREAD') {
          const spread = spreads[event.spread];
          return same({
            ...s,
            state: 'READY',
            spread: event.spread,
            readingNumber: s.readingNumber + 1,
            shuffles: 0,
            slots: spread.positions.map((position, index) => ({
              slot: index,
              label: position.label,
              cardId: null,
              reversed: false,
              faceUp: false,
            })),
          });
        }
        return null;

      case 'READY':
        return event.type === 'SHUFFLE' ? this.shuffled(event) : null;

      case 'SHUFFLING':
        return event.type === 'SHUFFLE_DONE' ? same({ ...s, state: 'DRAWING' }) : null;

      case 'DRAWING':
        if (event.type === 'SHUFFLE') {
          // Shuffle again as often as you like, until the first card is drawn.
          return this.drawnCount === 0 ? this.shuffled(event) : null;
        }
        if (event.type === 'DRAW') return this.drawn(event);
        if (event.type === 'FLIP') return this.flipped(event);
        return null;

      case 'AWAITING_FLIPS':
        return event.type === 'FLIP' ? this.flipped(event) : null;

      case 'REVEALED':
        return null;
    }
  }

  private shuffled(event: ReadingEvent) {
    const s = this.snapshot;
    const pending = this.draw(this.options.cardIds, s.slots.length, this.options.reversalChance);
    return {
      snapshot: { ...s, state: 'SHUFFLING' as const, shuffles: s.shuffles + 1 },
      event,
      pending,
    };
  }

  private drawn(event: Extract<ReadingEvent, { type: 'DRAW' }>) {
    const s = this.snapshot;
    const slot = event.slot ?? s.slots.findIndex((candidate) => candidate.cardId === null);
    const target = s.slots[slot];
    const card = this.pending[0];
    if (target === undefined || target.cardId !== null || card === undefined) return null;
    const slots = s.slots.map((candidate) =>
      candidate.slot === slot ? { ...candidate, cardId: card.cardId, reversed: card.reversed } : candidate,
    );
    return {
      snapshot: { ...s, slots, state: this.settledState(slots) },
      event: { type: 'DRAW' as const, slot },
      pending: this.pending.slice(1),
    };
  }

  private flipped(event: Extract<ReadingEvent, { type: 'FLIP' }>) {
    const s = this.snapshot;
    const target = s.slots[event.slot];
    if (target === undefined || target.cardId === null || target.faceUp) return null;
    const slots = s.slots.map((slot) => (slot.slot === event.slot ? { ...slot, faceUp: true } : slot));
    return { snapshot: { ...s, slots, state: this.settledState(slots) }, event };
  }

  /** Still drawing, waiting on flips, or fully revealed. */
  private settledState(slots: readonly ReadingSlot[]): ReadingStateName {
    if (slots.some((slot) => slot.cardId === null)) return 'DRAWING';
    return slots.every((slot) => slot.faceUp) ? 'REVEALED' : 'AWAITING_FLIPS';
  }

  private cleared(): ReadingSnapshot {
    return { ...this.snapshot, state: 'IDLE', spread: null, slots: [], shuffles: 0 };
  }
}
