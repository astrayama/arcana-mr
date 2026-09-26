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
  assert.equal(m.send({ type: 'FLIP', slot: 0 }), false);
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

test('reshuffling is allowed until the first card is drawn', () => {
  const m = drawing('three');
  assert.equal(m.send({ type: 'SHUFFLE' }), true);
  m.send({ type: 'SHUFFLE_DONE' });
  assert.equal(m.current.shuffles, 2);
  m.send({ type: 'DRAW' });
  assert.equal(m.send({ type: 'SHUFFLE' }), false);
  assert.equal(m.current.shuffles, 2);
});

test('DRAW without a slot fills spots in order; DRAW with a slot takes the next card', () => {
  const m = drawing('three');
  const [first, second] = m.upcoming(2).map((c) => c.cardId);
  const seen: (number | undefined)[] = [];
  m.subscribe((_, event) => {
    if (event.type === 'DRAW') seen.push(event.slot);
  });
  m.send({ type: 'DRAW', slot: 2 });
  m.send({ type: 'DRAW' });
  assert.equal(m.current.slots[2].cardId, first);
  assert.equal(m.current.slots[0].cardId, second);
  assert.deepEqual(seen, [2, 0], 'listeners get the slot each card went into');
});

test('drawing into a full or missing spot is rejected', () => {
  const m = drawing('three');
  m.send({ type: 'DRAW', slot: 1 });
  assert.equal(m.send({ type: 'DRAW', slot: 1 }), false);
  assert.equal(m.send({ type: 'DRAW', slot: 3 }), false);
  assert.equal(m.send({ type: 'DRAW', slot: -1 }), false);
});

test('cards can be turned over as soon as they are down', () => {
  const m = drawing('three');
  m.send({ type: 'DRAW', slot: 0 });
  assert.equal(m.send({ type: 'FLIP', slot: 1 }), false, 'no flipping an empty spot');
  assert.equal(m.send({ type: 'FLIP', slot: 0 }), true);
  assert.equal(m.state, 'DRAWING');
  assert.equal(m.send({ type: 'FLIP', slot: 0 }), false, 'double flip is ignored');
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  m.send({ type: 'FLIP', slot: 1 });
  m.send({ type: 'FLIP', slot: 2 });
  assert.equal(m.state, 'REVEALED');
});

test('a single-card pull is revealed after its one flip', () => {
  const m = drawing('single');
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  m.send({ type: 'FLIP', slot: 0 });
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
