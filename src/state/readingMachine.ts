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

import { drawCards, type DrawnCard } from '../lib/shuffle.js';
import { MAX_SPREAD_CARDS, type SpreadDef } from '../spreads/spread.schema.js';

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
  /** `rn` carries the host's reading number in a shared reading. */
  | { type: 'CHOOSE_SPREAD'; spread: SpreadDef; rn?: number }
  /** `passes` is how many riffles to show (one when shaken in the hand). */
  | { type: 'SHUFFLE'; passes?: 1 | 2 }
  | { type: 'SHUFFLE_DONE' }
  /**
   * Draw the top card into the next open spot. Listeners get the spot it went
   * into and the card. A shared reading's host sends `card`; `toHand` means it
   * went into someone's fingers rather than straight to its spot.
   */
  | { type: 'DRAW'; slot?: number; card?: DrawnCard; toHand?: boolean }
  /** Turn a drawn card face up or face down. */
  | { type: 'TURN'; slot: number; faceUp: boolean }
  | { type: 'NEW_READING' }
  /** The whole reading was replaced from a shared reading's host (see `restore`). Never sent. */
  | { type: 'RESTORE' };

/**
 * Where an event came from: this headset, the host of a shared reading, or a
 * guest's request that the host has accepted.
 */
export type Origin = 'local' | 'remote' | 'intent';

/** What a shared reading's rules say about a local event: go ahead, refuse, or it was passed to the host. */
export type GateDecision = 'apply' | 'reject' | 'forwarded';
export type Gate = (event: ReadingEvent, machine: ReadingMachine) => GateDecision;

/** Events about this headset's own table, never shared or gated. */
const DEVICE_EVENTS: ReadonlySet<ReadingEvent['type']> = new Set(['MAT_PLACED', 'REPLACE_MAT']);

/** A reading as shared between headsets: everything except where the mat is. */
export interface SharedReading {
  phase: Exclude<ReadingStateName, 'PLACING'>;
  spread: SpreadDef | null;
  /** Reading number. */
  rn: number;
  shuffles: number;
  /** Per spot: card id (or null), reversed, face up. */
  slots: { c: string | null; r: boolean; u: boolean }[];
}

export interface ReadingSlot {
  /** Index into the spread's positions. */
  slot: number;
  /** The position's name ("Past", "Challenge"). */
  label: string;
  /** What the position asks. */
  meaning: string;
  /** Null until a card has been drawn into this spot. */
  cardId: string | null;
  reversed: boolean;
  faceUp: boolean;
}

export interface ReadingSnapshot {
  state: ReadingStateName;
  spread: SpreadDef | null;
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

/** Listeners get DRAW with the slot it actually went into, and the card. */
export type ResolvedEvent = ReadingEvent;
type Listener = (snapshot: ReadingSnapshot, event: ResolvedEvent, origin: Origin) => void;

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
  private cardIds: readonly string[];
  private gate: Gate | null = null;

  constructor(private readonly options: ReadingMachineOptions) {
    this.draw = options.draw ?? drawCards;
    this.cardIds = options.cardIds;
  }

  /**
   * Change which cards can be drawn (a different deck). Only between
   * readings, so a reading never mixes decks. Returns false if not allowed now.
   */
  setCardIds(cardIds: readonly string[]): boolean {
    if (this.snapshot.state !== 'IDLE' && this.snapshot.state !== 'PLACING') return false;
    this.cardIds = cardIds;
    return true;
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

  /** Whether `event` would be accepted in the current state (without shuffling anything). */
  can(event: ReadingEvent): boolean {
    return this.next(event, 'dry') !== null;
  }

  /**
   * In a shared reading, decide what happens to events from this headset
   * (see `Gate`). Device events are never gated. Null removes the gate.
   */
  setGate(gate: Gate | null): void {
    this.gate = gate;
  }

  /**
   * Apply an event. Returns true if it caused a transition (or was passed to a
   * shared reading's host). Events that make no sense in the current state (a
   * double tap, a late animation callback) are ignored rather than thrown, so
   * input glitches can't break the flow.
   */
  send(event: ReadingEvent, origin: Origin = 'local'): boolean {
    if (event.type === 'RESTORE') return false;
    if (origin === 'local' && this.gate && !DEVICE_EVENTS.has(event.type)) {
      const decision = this.gate(event, this);
      if (decision === 'reject') return false;
      if (decision === 'forwarded') return true;
    }
    const result = this.next(event, origin);
    if (result === null) return false;
    this.emit(result.snapshot, result.event, origin, result.pending);
    return true;
  }

  /**
   * Replace the whole reading with a shared reading's (a guest catching up).
   * Not while this headset is placing its mat. Emits RESTORE so everything
   * on the table can be rebuilt.
   */
  restore(shared: SharedReading): boolean {
    if (this.snapshot.state === 'PLACING') return false;
    const spread = shared.spread;
    if (spread && shared.slots.length !== spread.positions.length) return false;
    if (!spread && shared.slots.length > 0) return false;
    const ids = shared.slots.map((slot) => slot.c).filter((id) => id !== null);
    if (new Set(ids).size !== ids.length) return false;
    const slots: ReadingSlot[] = (spread?.positions ?? []).map((position, index) => ({
      slot: index,
      label: position.label,
      meaning: position.meaning,
      cardId: shared.slots[index].c,
      reversed: shared.slots[index].c !== null && shared.slots[index].r,
      faceUp: shared.slots[index].c !== null && shared.slots[index].u,
    }));
    let state: ReadingStateName = spread ? shared.phase : 'IDLE';
    if (state === 'IDLE' && spread) state = 'READY';
    if (state === 'DRAWING' || state === 'AWAITING_FLIPS' || state === 'REVEALED') state = this.settledState(slots);
    const snapshot: ReadingSnapshot = { state, spread, slots, readingNumber: shared.rn, shuffles: shared.shuffles };
    this.emit(snapshot, { type: 'RESTORE' }, 'remote', []);
    return true;
  }

  /** The reading as shared with a guest. */
  exportShared(): SharedReading {
    const s = this.snapshot;
    return {
      phase: s.state === 'PLACING' ? 'IDLE' : s.state,
      spread: s.spread,
      rn: s.readingNumber,
      shuffles: s.shuffles,
      slots: s.slots.map((slot) => ({ c: slot.cardId, r: slot.reversed, u: slot.faceUp })),
    };
  }

  /**
   * Take over a reading that was being followed (a guest leaving a shared
   * reading): shuffle what's left so drawing can go on, and finish a shuffle
   * that was waiting on the host. Clear the gate first.
   */
  adopt(): void {
    const s = this.snapshot;
    if (!s.spread) return;
    const drawn = new Set(s.slots.map((slot) => slot.cardId).filter((id) => id !== null));
    const open = s.slots.filter((slot) => slot.cardId === null).length;
    const remaining = this.cardIds.filter((id) => !drawn.has(id));
    this.pending = open > 0 && remaining.length >= open ? this.draw(remaining, open, this.options.reversalChance) : [];
    if (s.state === 'SHUFFLING') this.send({ type: 'SHUFFLE_DONE' });
  }

  private emit(snapshot: ReadingSnapshot, event: ResolvedEvent, origin: Origin, pending?: DrawnCard[]): void {
    this.snapshot = snapshot;
    if (pending) this.pending = pending;
    for (const listener of this.listeners) listener(snapshot, event, origin);
  }

  private next(
    event: ReadingEvent,
    origin: Origin | 'dry',
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
          const spread = event.spread;
          const count = spread.positions.length;
          if (count === 0 || count > MAX_SPREAD_CARDS) return null;
          // A shared reading's host decides whether its deck can hold the spread.
          if (origin !== 'remote' && count > this.cardIds.length) return null;
          return same({
            ...s,
            state: 'READY',
            spread: event.spread,
            readingNumber: origin === 'remote' && event.rn !== undefined ? event.rn : s.readingNumber + 1,
            shuffles: 0,
            slots: spread.positions.map((position, index) => ({
              slot: index,
              label: position.label,
              meaning: position.meaning,
              cardId: null,
              reversed: false,
              faceUp: false,
            })),
          });
        }
        return null;

      case 'READY':
        return event.type === 'SHUFFLE' ? this.shuffled(event, origin) : null;

      case 'SHUFFLING':
        if (event.type === 'SHUFFLE_DONE') return same({ ...s, state: 'DRAWING' });
        // A card already down can be turned over while the deck is being shuffled.
        return event.type === 'TURN' ? this.turned(event) : null;

      case 'DRAWING':
        // Shuffle what's left of the deck as often as you like between draws.
        if (event.type === 'SHUFFLE') return this.shuffled(event, origin);
        if (event.type === 'DRAW') return this.drawn(event, origin);
        return event.type === 'TURN' ? this.turned(event) : null;

      case 'AWAITING_FLIPS':
      case 'REVEALED':
        return event.type === 'TURN' ? this.turned(event) : null;
    }
  }

  /**
   * Shuffle the cards not yet drawn, for the spots still open. A shared
   * reading's guest (and a dry run) skips the shuffle itself: the host draws.
   */
  private shuffled(event: ReadingEvent, origin: Origin | 'dry') {
    const s = this.snapshot;
    const snapshot = { ...s, state: 'SHUFFLING' as const, shuffles: s.shuffles + 1 };
    if (origin === 'dry') return { snapshot, event };
    if (origin === 'remote') return { snapshot, event, pending: [] };
    const drawn = new Set(s.slots.map((slot) => slot.cardId).filter((id) => id !== null));
    const open = s.slots.filter((slot) => slot.cardId === null).length;
    const remaining = drawn.size ? this.cardIds.filter((id) => !drawn.has(id)) : this.cardIds;
    if (open > remaining.length) return null;
    return { snapshot, event, pending: this.draw(remaining, open, this.options.reversalChance) };
  }

  private drawn(event: Extract<ReadingEvent, { type: 'DRAW' }>, origin: Origin | 'dry') {
    const s = this.snapshot;
    // Cards go out in order: Past, then Present, then Future.
    const slot = s.slots.findIndex((candidate) => candidate.cardId === null);
    if (event.slot !== undefined && event.slot !== slot) return null;
    const target = s.slots[slot];
    // A shared reading's host says which card it was; otherwise it's the top of the deck.
    const card = origin === 'remote' ? event.card : this.pending[0];
    if (target === undefined || card === undefined) return null;
    if (s.slots.some((candidate) => candidate.cardId === card.cardId)) return null;
    const slots = s.slots.map((candidate) =>
      candidate.slot === slot ? { ...candidate, cardId: card.cardId, reversed: card.reversed } : candidate,
    );
    return {
      snapshot: { ...s, slots, state: this.settledState(slots) },
      event: { ...event, type: 'DRAW' as const, slot, card },
      pending: origin === 'remote' ? this.pending : this.pending.slice(1),
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
