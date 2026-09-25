/**
 * The reading flow as one explicit state machine, kept separate from rendering.
 * Systems send events in and subscribe to state changes; nothing in here knows
 * about Three.js, IWSDK, or the headset.
 *
 *   PLACING ──MAT_PLACED──▶ IDLE ──START_READING──▶ SHUFFLING ──SHUFFLE_DONE──▶ DEALING
 *      ▲                     │  ▲                                                  │
 *      └──────REPLACE_MAT────┘  │                                             DEAL_DONE
 *                               │                                                  ▼
 *                               └────NEW_READING──── REVEALED ◀──(last flip)── AWAITING_FLIPS
 *                                                                               ▲      │
 *                                                                               └─FLIP─┘
 */

import { spreads, type SpreadId } from '../data/spreads.js';
import { drawCards } from '../lib/shuffle.js';

export type ReadingStateName =
  | 'PLACING'
  | 'IDLE'
  | 'SHUFFLING'
  | 'DEALING'
  | 'AWAITING_FLIPS'
  | 'REVEALED';

export type ReadingEvent =
  | { type: 'MAT_PLACED' }
  | { type: 'REPLACE_MAT' }
  | { type: 'START_READING'; spread: SpreadId }
  | { type: 'SHUFFLE_DONE' }
  | { type: 'DEAL_DONE' }
  | { type: 'FLIP'; slot: number }
  | { type: 'NEW_READING' };

export interface ReadingSlot {
  /** Index into the spread's positions. */
  slot: number;
  /** Position label for the meaning panel (Past / Present / Future), or null. */
  label: string | null;
  cardId: string;
  reversed: boolean;
  faceUp: boolean;
}

export interface ReadingSnapshot {
  state: ReadingStateName;
  spread: SpreadId | null;
  slots: readonly ReadingSlot[];
  /** Increments every time a new reading starts, so systems can tell readings apart. */
  readingNumber: number;
}

export interface ReadingMachineOptions {
  cardIds: readonly string[];
  reversalChance: number;
  /** Swappable for tests. Defaults to the crypto-backed `drawCards`. */
  draw?: typeof drawCards;
}

type Listener = (snapshot: ReadingSnapshot, event: ReadingEvent) => void;

export class ReadingMachine {
  private snapshot: ReadingSnapshot = {
    state: 'PLACING',
    spread: null,
    slots: [],
    readingNumber: 0,
  };
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
    const next = this.next(event);
    if (next === null) {
      return false;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener(next, event);
    }
    return true;
  }

  private next(event: ReadingEvent): ReadingSnapshot | null {
    const s = this.snapshot;
    switch (s.state) {
      case 'PLACING':
        if (event.type === 'MAT_PLACED') {
          return { ...s, state: 'IDLE' };
        }
        return null;

      case 'IDLE':
        if (event.type === 'REPLACE_MAT') {
          return { ...s, state: 'PLACING' };
        }
        if (event.type === 'START_READING') {
          return this.startReading(event.spread);
        }
        return null;

      case 'SHUFFLING':
        return event.type === 'SHUFFLE_DONE' ? { ...s, state: 'DEALING' } : null;

      case 'DEALING':
        return event.type === 'DEAL_DONE' ? { ...s, state: 'AWAITING_FLIPS' } : null;

      case 'AWAITING_FLIPS': {
        if (event.type === 'NEW_READING') {
          return this.cleared();
        }
        if (event.type !== 'FLIP') {
          return null;
        }
        const target = s.slots[event.slot];
        if (target === undefined || target.faceUp) {
          return null;
        }
        const slots = s.slots.map((slot) =>
          slot.slot === event.slot ? { ...slot, faceUp: true } : slot,
        );
        const allUp = slots.every((slot) => slot.faceUp);
        return { ...s, slots, state: allUp ? 'REVEALED' : 'AWAITING_FLIPS' };
      }

      case 'REVEALED':
        return event.type === 'NEW_READING' ? this.cleared() : null;
    }
  }

  private startReading(spreadId: SpreadId): ReadingSnapshot {
    const spread = spreads[spreadId];
    const drawn = this.draw(
      this.options.cardIds,
      spread.positions.length,
      this.options.reversalChance,
    );
    return {
      state: 'SHUFFLING',
      spread: spreadId,
      readingNumber: this.snapshot.readingNumber + 1,
      slots: drawn.map((card, index) => ({
        slot: index,
        label: spread.positions[index].label,
        cardId: card.cardId,
        reversed: card.reversed,
        faceUp: false,
      })),
    };
  }

  private cleared(): ReadingSnapshot {
    return { ...this.snapshot, state: 'IDLE', spread: null, slots: [] };
  }
}
