/**
 * The reading flow as one explicit state machine, kept separate from rendering.
 * Systems send events in and subscribe to state changes; nothing in here knows
 * about Three.js, IWSDK, or the headset.
 *
 *   PLACING ─MAT_PLACED─▶ IDLE ─CHOOSE_SPREAD─▶ READY ─SHUFFLE─▶ SHUFFLING ─SHUFFLE_DONE─▶ DRAWING
 *      ▲                   │                                        ▲                          │  │
 *      └───REPLACE_MAT─────┘                                        └─SHUFFLE (a spot is open)─┘  │
 *                                                                                    DRAW (last) ▼
 *   IDLE ◀──NEW_READING── READY / DRAWING / AWAITING_FLIPS / REVEALED    AWAITING_FLIPS ◀─TURN─▶ REVEALED
 *
 * The deck order is decided at each SHUFFLE (crypto shuffle, per-card
 * reversals). The reader draws cards one at a time, always into the next spot
 * in order, and can shuffle what's left of the deck between draws. Cards can
 * be turned face up or back down at any time, in any order; the reading is
 * REVEALED while every card is face up.
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
  /** Draw the top card into the next open spot. Listeners get the spot it went into. */
  | { type: 'DRAW'; slot?: number }
  /** Turn a drawn card face up or face down. */
  | { type: 'TURN'; slot: number; faceUp: boolean }
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
        if (event.type === 'SHUFFLE_DONE') return same({ ...s, state: 'DRAWING' });
        // A card already down can be turned over while the deck is being shuffled.
        return event.type === 'TURN' ? this.turned(event) : null;

      case 'DRAWING':
        // Shuffle what's left of the deck as often as you like between draws.
        if (event.type === 'SHUFFLE') return this.shuffled(event);
        if (event.type === 'DRAW') return this.drawn(event);
        return event.type === 'TURN' ? this.turned(event) : null;

      case 'AWAITING_FLIPS':
      case 'REVEALED':
        return event.type === 'TURN' ? this.turned(event) : null;
    }
  }

  /** Shuffle the cards not yet drawn, for the spots still open. */
  private shuffled(event: ReadingEvent) {
    const s = this.snapshot;
    const drawn = new Set(s.slots.map((slot) => slot.cardId).filter((id) => id !== null));
    const open = s.slots.filter((slot) => slot.cardId === null).length;
    const remaining = drawn.size ? this.options.cardIds.filter((id) => !drawn.has(id)) : this.options.cardIds;
    const pending = this.draw(remaining, open, this.options.reversalChance);
    return {
      snapshot: { ...s, state: 'SHUFFLING' as const, shuffles: s.shuffles + 1 },
      event,
      pending,
    };
  }

  private drawn(event: Extract<ReadingEvent, { type: 'DRAW' }>) {
    const s = this.snapshot;
    // Cards go out in order: Past, then Present, then Future.
    const slot = s.slots.findIndex((candidate) => candidate.cardId === null);
    if (event.slot !== undefined && event.slot !== slot) return null;
    const target = s.slots[slot];
    const card = this.pending[0];
    if (target === undefined || card === undefined) return null;
    const slots = s.slots.map((candidate) =>
      candidate.slot === slot ? { ...candidate, cardId: card.cardId, reversed: card.reversed } : candidate,
    );
    return {
      snapshot: { ...s, slots, state: this.settledState(slots) },
      event: { type: 'DRAW' as const, slot },
      pending: this.pending.slice(1),
    };
  }

  private turned(event: Extract<ReadingEvent, { type: 'TURN' }>) {
    const s = this.snapshot;
    const target = s.slots[event.slot];
    if (target === undefined || target.cardId === null || target.faceUp === event.faceUp) return null;
    const slots = s.slots.map((slot) => (slot.slot === event.slot ? { ...slot, faceUp: event.faceUp } : slot));
    const state = s.state === 'SHUFFLING' ? s.state : this.settledState(slots);
    return { snapshot: { ...s, slots, state }, event };
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
