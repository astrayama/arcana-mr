import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawCards } from '../src/lib/shuffle.ts';
import { ReadingMachine } from '../src/state/readingMachine.ts';
import type { SpreadDef } from '../src/spreads/spread.schema.ts';

const ids = Array.from({ length: 78 }, (_, i) => `card-${i}`);

function spreadOf(id: string, labels: string[]): SpreadDef {
  return {
    id,
    name: id,
    summary: id,
    origin: 'builtin',
    positions: labels.map((label, i) => ({ label, meaning: `${label} means`, x: i, y: 0 })),
  };
}
const SPREADS = {
  single: spreadOf('single', ['Your card']),
  three: spreadOf('three', ['Past', 'Present', 'Future']),
};
const make = (draw = drawCards) => new ReadingMachine({ cardIds: ids, reversalChance: 0.5, draw });

/** A machine with the mat placed and a spread chosen. */
function ready(spread: keyof typeof SPREADS = 'three', draw = drawCards) {
  const m = make(draw);
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'CHOOSE_SPREAD', spread: SPREADS[spread] });
  return m;
}

/** A machine that has shuffled and is waiting for draws. */
function drawing(spread: keyof typeof SPREADS = 'three', draw = drawCards) {
  const m = ready(spread, draw);
  m.send({ type: 'SHUFFLE' });
  m.send({ type: 'SHUFFLE_DONE' });
  return m;
}

test('starts placing, then idles once the mat is placed', () => {
  const m = make();
  assert.equal(m.state, 'PLACING');
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: SPREADS.single }), false);
  assert.equal(m.send({ type: 'MAT_PLACED' }), true);
  assert.equal(m.state, 'IDLE');
});

test('choosing a spread lays out empty spots and waits for a shuffle', () => {
  const m = ready('three');
  assert.equal(m.state, 'READY');
  assert.deepEqual(m.current.slots.map((s) => s.label), ['Past', 'Present', 'Future']);
  assert.ok(m.current.slots.every((s) => s.cardId === null));
  assert.equal(m.send({ type: 'DRAW' }), false, 'no drawing before a shuffle');
  assert.equal(m.send({ type: 'TURN', slot: 0, faceUp: true }), false);
});

test('a shuffle picks the cards once, then drawing reveals them one by one', () => {
  let calls = 0;
  const m = ready('three', (cardIds, count, chance) => {
    calls++;
    return drawCards(cardIds, count, chance);
  });
  m.send({ type: 'SHUFFLE' });
  assert.equal(m.state, 'SHUFFLING');
  assert.equal(calls, 1);
  assert.equal(m.send({ type: 'DRAW' }), false, 'no drawing mid-shuffle');
  m.send({ type: 'SHUFFLE_DONE' });
  assert.equal(m.state, 'DRAWING');
  assert.equal(m.current.shuffles, 1);
  const upcoming = m.upcoming(3).map((c) => c.cardId);
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  assert.deepEqual(m.current.slots.map((s) => s.cardId), upcoming);
  assert.equal(new Set(upcoming).size, 3);
  assert.equal(m.state, 'AWAITING_FLIPS');
});

test('the rest of the deck can be reshuffled between draws', () => {
  const calls: { ids: readonly string[]; count: number }[] = [];
  const m = drawing('three', (cardIds, count, chance) => {
    calls.push({ ids: cardIds, count });
    return drawCards(cardIds, count, chance);
  });
  assert.equal(m.send({ type: 'SHUFFLE' }), true, 'before any draw');
  m.send({ type: 'SHUFFLE_DONE' });
  m.send({ type: 'DRAW' });
  const past = m.current.slots[0].cardId!;
  assert.equal(m.send({ type: 'SHUFFLE' }), true, 'after a draw');
  assert.equal(m.state, 'SHUFFLING');
  assert.equal(m.current.shuffles, 3);
  const last = calls[calls.length - 1];
  assert.equal(last.count, 2, 'only the open spots are drawn');
  assert.equal(last.ids.length, 77);
  assert.ok(!last.ids.includes(past), 'a drawn card is not back in the deck');
  assert.equal(m.current.slots[0].cardId, past, 'the drawn card stays put');
  assert.equal(m.send({ type: 'DRAW' }), false, 'no drawing mid-shuffle');
  m.send({ type: 'SHUFFLE_DONE' });
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  assert.equal(m.send({ type: 'SHUFFLE' }), false, 'nothing left to shuffle for');
  assert.equal(new Set(m.current.slots.map((s) => s.cardId)).size, 3);
});

test('cards are drawn in order, and listeners get the spot each went into', () => {
  const m = drawing('three');
  const [first, second] = m.upcoming(2).map((c) => c.cardId);
  const seen: (number | undefined)[] = [];
  m.subscribe((_, event) => {
    if (event.type === 'DRAW') seen.push(event.slot);
  });
  assert.equal(m.send({ type: 'DRAW', slot: 2 }), false, 'no skipping ahead');
  m.send({ type: 'DRAW' });
  assert.equal(m.send({ type: 'DRAW', slot: 0 }), false, 'no drawing into a full spot');
  assert.equal(m.send({ type: 'DRAW', slot: 1 }), true, 'naming the next spot is fine');
  assert.equal(m.current.slots[0].cardId, first);
  assert.equal(m.current.slots[1].cardId, second);
  assert.deepEqual(seen, [0, 1]);
});

test('cards turn over in any order, and back down again', () => {
  const m = drawing('three');
  m.send({ type: 'DRAW' });
  assert.equal(m.send({ type: 'TURN', slot: 1, faceUp: true }), false, 'no turning an empty spot');
  assert.equal(m.send({ type: 'TURN', slot: 0, faceUp: true }), true);
  assert.equal(m.state, 'DRAWING');
  assert.equal(m.send({ type: 'TURN', slot: 0, faceUp: true }), false, 'already face up');
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  m.send({ type: 'TURN', slot: 2, faceUp: true });
  m.send({ type: 'TURN', slot: 1, faceUp: true });
  assert.equal(m.state, 'REVEALED');
  assert.equal(m.send({ type: 'TURN', slot: 1, faceUp: false }), true, 'turned back down');
  assert.equal(m.current.slots[1].faceUp, false);
  assert.equal(m.state, 'AWAITING_FLIPS');
  m.send({ type: 'TURN', slot: 1, faceUp: true });
  assert.equal(m.state, 'REVEALED');
});

test('a card can be turned while the rest of the deck is shuffled', () => {
  const m = drawing('three');
  m.send({ type: 'DRAW' });
  m.send({ type: 'SHUFFLE' });
  assert.equal(m.send({ type: 'TURN', slot: 0, faceUp: true }), true);
  assert.equal(m.state, 'SHUFFLING', 'turning a card does not end the shuffle');
  m.send({ type: 'SHUFFLE_DONE' });
  assert.equal(m.state, 'DRAWING');
  assert.equal(m.current.slots[0].faceUp, true);
});

test('a single-card pull is revealed once it is face up', () => {
  const m = drawing('single');
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  m.send({ type: 'TURN', slot: 0, faceUp: true });
  assert.equal(m.state, 'REVEALED');
});

test('a new reading clears the table from any settled state, but not mid-shuffle', () => {
  for (const setup of [
    () => ready(),
    () => drawing(),
    () => {
      const m = drawing('single');
      m.send({ type: 'DRAW' });
      return m;
    },
  ]) {
    const m = setup();
    assert.equal(m.send({ type: 'NEW_READING' }), true);
    assert.equal(m.state, 'IDLE');
    assert.equal(m.current.slots.length, 0);
  }
  const m = ready();
  m.send({ type: 'SHUFFLE' });
  assert.equal(m.send({ type: 'NEW_READING' }), false);
});

test('the mat can be moved between readings', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'REPLACE_MAT' });
  assert.equal(m.state, 'PLACING');
  m.send({ type: 'MAT_PLACED' });
  assert.equal(m.state, 'IDLE');
  assert.equal(m.current.spread, null);
});

test('moving the mat mid-reading keeps the reading and the deck, but waits out a riffle', () => {
  const m = drawing();
  m.send({ type: 'DRAW' });
  m.send({ type: 'TURN', slot: 0, faceUp: true });
  const before = m.exportShared();
  const next = m.upcoming(2).map((c) => c.cardId);
  const events: string[] = [];
  m.subscribe((snapshot, event) => events.push(`${event.type}:${snapshot.state}`));

  assert.equal(m.send({ type: 'REPLACE_MAT' }), true);
  assert.equal(m.state, 'PLACING');
  assert.deepEqual(m.exportShared(), before, 'a guest asking mid-move still gets the reading');
  assert.equal(m.send({ type: 'DRAW' }), false, 'nothing happens to the reading while placing');
  m.send({ type: 'MAT_PLACED' });
  assert.deepEqual(events, ['REPLACE_MAT:PLACING', 'MAT_PLACED:DRAWING', 'RESTORE:DRAWING']);
  assert.deepEqual(m.exportShared(), before);
  assert.deepEqual(m.upcoming(2).map((c) => c.cardId), next, 'the deck is in the same order');
  m.send({ type: 'DRAW' });
  assert.equal(m.current.slots[1].cardId, next[0]);

  m.send({ type: 'SHUFFLE' });
  assert.equal(m.state, 'SHUFFLING');
  assert.equal(m.send({ type: 'REPLACE_MAT' }), false);
});

test('a guest who leaves while moving the mat carries on with the reading', () => {
  const host = drawing();
  host.send({ type: 'DRAW' });
  const guest = make();
  guest.send({ type: 'MAT_PLACED' });
  guest.restore(host.exportShared());
  guest.send({ type: 'REPLACE_MAT' });
  guest.adopt();
  guest.send({ type: 'MAT_PLACED' });
  assert.equal(guest.state, 'DRAWING');
  assert.equal(guest.send({ type: 'DRAW' }), true, 'the deck was refilled for the rest of the spread');
  assert.notEqual(guest.current.slots[1].cardId, guest.current.slots[0].cardId);
});

test('each reading gets a new reading number and a fresh shuffle count', () => {
  const m = drawing('single');
  const first = m.current.readingNumber;
  m.send({ type: 'NEW_READING' });
  m.send({ type: 'CHOOSE_SPREAD', spread: SPREADS.single });
  assert.equal(m.current.readingNumber, first + 1);
  assert.equal(m.current.shuffles, 0);
});

test('draws never repeat a card within a reading', () => {
  for (let i = 0; i < 200; i++) {
    const m = drawing('three');
    m.send({ type: 'DRAW' });
    m.send({ type: 'DRAW' });
    m.send({ type: 'DRAW' });
    assert.equal(new Set(m.current.slots.map((s) => s.cardId)).size, 3);
  }
});

test('spreads of up to twelve cards work, and bigger or empty ones are refused', () => {
  const twelve = spreadOf('twelve', Array.from({ length: 12 }, (_, i) => `House ${i + 1}`));
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: spreadOf('empty', []) }), false);
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: spreadOf('thirteen', Array.from({ length: 13 }, String)) }), false);
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: twelve }), true);
  assert.equal(m.current.slots[11].meaning, 'House 12 means');
  m.send({ type: 'SHUFFLE' });
  m.send({ type: 'SHUFFLE_DONE' });
  for (let i = 0; i < 12; i++) m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  assert.equal(new Set(m.current.slots.map((s) => s.cardId)).size, 12);
});

test('the drawable cards change only between readings, and a spread needs enough of them', () => {
  const m = make();
  assert.equal(m.setCardIds(['a', 'b']), true, 'while placing');
  m.send({ type: 'MAT_PLACED' });
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: SPREADS.three }), false, 'not enough cards for three');
  assert.equal(m.setCardIds(ids), true);
  m.send({ type: 'CHOOSE_SPREAD', spread: SPREADS.three });
  assert.equal(m.setCardIds(['a']), false, 'not mid-reading');
});

// Shared readings

test('the gate decides local events, never device or remote ones', () => {
  const m = drawing('three');
  const seen: string[] = [];
  m.subscribe((_, e, origin) => seen.push(`${e.type}:${origin}`));
  m.setGate((e) => (e.type === 'DRAW' ? 'reject' : e.type === 'SHUFFLE' ? 'forwarded' : 'apply'));
  assert.equal(m.send({ type: 'DRAW' }), false, 'rejected');
  assert.equal(m.send({ type: 'SHUFFLE' }), true, 'forwarded counts as handled');
  assert.equal(m.state, 'DRAWING', 'but nothing changed');
  const card = m.upcoming(1)[0];
  assert.equal(m.send({ type: 'DRAW', slot: 0, card }, 'remote'), true, 'remote events skip the gate');
  m.setGate(null);
  assert.deepEqual(seen, ['DRAW:remote']);
});

test('can() and remote shuffles never run the shuffle itself', () => {
  let calls = 0;
  const m = ready('three', (ids, count, chance) => {
    calls++;
    return drawCards(ids, count, chance);
  });
  assert.equal(m.can({ type: 'SHUFFLE' }), true);
  assert.equal(calls, 0);
  m.send({ type: 'SHUFFLE', passes: 1 }, 'remote');
  assert.equal(calls, 0);
  assert.equal(m.current.shuffles, 1);
  assert.equal(m.upcoming(1).length, 0, 'the guest has no deck order of its own');
});

test('a remote draw places the host card, in order, and keeps its payload', () => {
  const m = ready('three');
  m.send({ type: 'SHUFFLE' }, 'remote');
  m.send({ type: 'SHUFFLE_DONE' }, 'remote');
  let resolved: unknown = null;
  m.subscribe((_, e) => (resolved = e));
  const card = { cardId: 'card-7', reversed: true };
  assert.equal(m.send({ type: 'DRAW', slot: 1, card }, 'remote'), false, 'not the next spot');
  assert.equal(m.send({ type: 'DRAW', slot: 0, card, toHand: true }, 'remote'), true);
  assert.deepEqual(resolved, { type: 'DRAW', slot: 0, card, toHand: true });
  assert.equal(m.current.slots[0].cardId, 'card-7');
  assert.equal(m.send({ type: 'DRAW', slot: 1, card }, 'remote'), false, 'the same card twice');
  assert.equal(m.send({ type: 'DRAW', slot: 1 }, 'remote'), false, 'a remote draw must name its card');
});

test('a remote spread keeps the host reading number and skips the deck-size check', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  m.setCardIds(['a']);
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: SPREADS.three, rn: 41 }, 'remote'), true);
  assert.equal(m.current.readingNumber, 41);
});

test('restore replaces the reading from any state but placing, and round-trips', () => {
  const host = drawing('three');
  host.send({ type: 'DRAW' });
  host.send({ type: 'TURN', slot: 0, faceUp: true });
  const shared = host.exportShared();

  const guest = make();
  assert.equal(guest.restore(shared), false, 'not while placing');
  guest.send({ type: 'MAT_PLACED' });
  const events: string[] = [];
  guest.subscribe((_, e, origin) => events.push(`${e.type}:${origin}`));
  assert.equal(guest.restore(shared), true);
  assert.deepEqual(events, ['RESTORE:remote']);
  assert.deepEqual(guest.exportShared(), shared);
  assert.equal(guest.state, 'DRAWING');
  assert.equal(guest.restore({ ...shared, slots: shared.slots.slice(1) }), false, 'spots must match the spread');
  assert.equal(guest.restore({ phase: 'IDLE', spread: null, rn: 3, shuffles: 0, slots: [] }), true, 'back to no reading');
  assert.equal(guest.state, 'IDLE');
  assert.equal(guest.send({ type: 'RESTORE' }), false, 'RESTORE is never sent');
});

test('a guest who leaves can carry on drawing without repeating cards', () => {
  const m = ready('three');
  m.send({ type: 'SHUFFLE' }, 'remote');
  m.send({ type: 'SHUFFLE_DONE' }, 'remote');
  m.send({ type: 'DRAW', slot: 0, card: { cardId: 'card-1', reversed: false } }, 'remote');
  m.send({ type: 'SHUFFLE' }, 'remote');
  assert.equal(m.state, 'SHUFFLING');
  m.adopt();
  assert.equal(m.state, 'DRAWING', 'the stuck shuffle finished');
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  assert.equal(new Set(m.current.slots.map((s) => s.cardId)).size, 3);
});
