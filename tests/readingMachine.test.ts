import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReadingMachine } from '../src/state/readingMachine.ts';

const ids = Array.from({ length: 78 }, (_, i) => `card-${i}`);
const make = () => new ReadingMachine({ cardIds: ids, reversalChance: 0.5 });

test('starts placing, then idles once the mat is placed', () => {
  const m = make();
  assert.equal(m.state, 'PLACING');
  assert.equal(m.send({ type: 'START_READING', spread: 'single' }), false);
  assert.equal(m.send({ type: 'MAT_PLACED' }), true);
  assert.equal(m.state, 'IDLE');
});

test('a 3-card reading runs the whole flow and resets', () => {
  const m = make();
  const seen: string[] = [];
  m.subscribe((s) => seen.push(s.state));
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'START_READING', spread: 'three' });
  assert.equal(m.current.slots.length, 3);
  assert.deepEqual(
    m.current.slots.map((s) => s.label),
    ['Past', 'Present', 'Future'],
  );
  assert.equal(new Set(m.current.slots.map((s) => s.cardId)).size, 3);
  m.send({ type: 'SHUFFLE_DONE' });
  m.send({ type: 'DEAL_DONE' });
  m.send({ type: 'FLIP', slot: 1 });
  assert.equal(m.state, 'AWAITING_FLIPS');
  assert.equal(m.send({ type: 'FLIP', slot: 1 }), false, 'double flip is ignored');
  m.send({ type: 'FLIP', slot: 0 });
  m.send({ type: 'FLIP', slot: 2 });
  assert.equal(m.state, 'REVEALED');
  m.send({ type: 'NEW_READING' });
  assert.equal(m.state, 'IDLE');
  assert.equal(m.current.slots.length, 0);
  assert.deepEqual(seen, [
    'IDLE',
    'SHUFFLING',
    'DEALING',
    'AWAITING_FLIPS',
    'AWAITING_FLIPS',
    'AWAITING_FLIPS',
    'REVEALED',
    'IDLE',
  ]);
});

test('a single-card pull has one unlabeled slot', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'START_READING', spread: 'single' });
  assert.equal(m.current.slots.length, 1);
  assert.equal(m.current.slots[0].label, null);
});

test('out-of-order events are ignored', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  assert.equal(m.send({ type: 'DEAL_DONE' }), false);
  assert.equal(m.send({ type: 'FLIP', slot: 0 }), false);
  m.send({ type: 'START_READING', spread: 'single' });
  assert.equal(m.send({ type: 'START_READING', spread: 'three' }), false);
  assert.equal(m.send({ type: 'REPLACE_MAT' }), false, 'no re-placing mid-reading');
  assert.equal(m.send({ type: 'FLIP', slot: 0 }), false, 'no flips before the deal');
});

test('the mat can be re-placed from idle', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'REPLACE_MAT' });
  assert.equal(m.state, 'PLACING');
  m.send({ type: 'MAT_PLACED' });
  assert.equal(m.state, 'IDLE');
});

test('each reading gets a new reading number', () => {
  const m = make();
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'START_READING', spread: 'single' });
  const first = m.current.readingNumber;
  m.send({ type: 'SHUFFLE_DONE' });
  m.send({ type: 'DEAL_DONE' });
  m.send({ type: 'NEW_READING' });
  m.send({ type: 'START_READING', spread: 'single' });
  assert.equal(m.current.readingNumber, first + 1);
});
