import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawCards } from '../src/lib/shuffle.ts';
import { ReadingMachine } from '../src/state/readingMachine.ts';

const ids = Array.from({ length: 78 }, (_, i) => `card-${i}`);
const make = (draw = drawCards) => new ReadingMachine({ cardIds: ids, reversalChance: 0.5, draw });

/** A machine with the mat placed and a spread chosen. */
function ready(spread: 'single' | 'three' = 'three', draw = drawCards) {
  const m = make(draw);
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'CHOOSE_SPREAD', spread });
  return m;
}

/** A machine that has shuffled and is waiting for draws. */
function drawing(spread: 'single' | 'three' = 'three', draw = drawCards) {
  const m = ready(spread, draw);
  m.send({ type: 'SHUFFLE' });
  m.send({ type: 'SHUFFLE_DONE' });
  return m;
}

test('starts placing, then idles once the mat is placed', () => {
  const m = make();
  assert.equal(m.state, 'PLACING');
  assert.equal(m.send({ type: 'CHOOSE_SPREAD', spread: 'single' }), false);
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

test('the mat can only be moved between readings', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'REPLACE_MAT' });
  assert.equal(m.state, 'PLACING');
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'CHOOSE_SPREAD', spread: 'single' });
  assert.equal(m.send({ type: 'REPLACE_MAT' }), false);
});

test('each reading gets a new reading number and a fresh shuffle count', () => {
  const m = drawing('single');
  const first = m.current.readingNumber;
  m.send({ type: 'NEW_READING' });
  m.send({ type: 'CHOOSE_SPREAD', spread: 'single' });
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
