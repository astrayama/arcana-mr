import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeNextStep, nextStep } from '../src/state/nextStep.ts';
import { ReadingMachine } from '../src/state/readingMachine.ts';
import type { SpreadDef } from '../src/spreads/spread.schema.ts';

const ids = Array.from({ length: 78 }, (_, i) => `card-${i}`);
const three: SpreadDef = {
  id: 'three',
  name: 'Three',
  summary: 'Three',
  origin: 'builtin',
  positions: ['Past', 'Present', 'Future'].map((label, i) => ({ label, meaning: label, x: i, y: 0 })),
};

/** Press Next on a machine the way a host does: one step, applied. */
function press(m: ReadingMachine): string {
  const step = nextStep(m.current);
  if (!step) return 'nothing';
  if (step.type === 'SHUFFLE') {
    m.send({ type: 'SHUFFLE' });
    m.send({ type: 'SHUFFLE_DONE' });
    return 'shuffle';
  }
  if (step.type === 'DRAW') {
    m.send({ type: 'DRAW' });
    return `draw ${m.current.slots.filter((s) => s.cardId).length - 1}`;
  }
  m.send({ type: 'TURN', slot: step.slot, faceUp: true });
  return `turn ${step.slot}`;
}

test('Next walks a reading: shuffle, then each card down and then up, in order', () => {
  const m = new ReadingMachine({ cardIds: ids, reversalChance: 0.5 });
  m.send({ type: 'MAT_PLACED' });
  assert.equal(nextStep(m.current), null, 'nothing to do before a spread is chosen');
  m.send({ type: 'CHOOSE_SPREAD', spread: three });
  const steps = Array.from({ length: 8 }, () => press(m));
  assert.deepEqual(steps, ['shuffle', 'draw 0', 'turn 0', 'draw 1', 'turn 1', 'draw 2', 'turn 2', 'nothing']);
  assert.equal(m.state, 'REVEALED');
});

test("Next turns over the reader's own face-down cards in order before drawing more", () => {
  const m = new ReadingMachine({ cardIds: ids, reversalChance: 0.5 });
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'CHOOSE_SPREAD', spread: three });
  m.send({ type: 'SHUFFLE' });
  m.send({ type: 'SHUFFLE_DONE' });
  m.send({ type: 'DRAW' });
  m.send({ type: 'DRAW' });
  m.send({ type: 'TURN', slot: 1, faceUp: true });
  assert.deepEqual(nextStep(m.current), { type: 'TURN', slot: 0 });
  m.send({ type: 'TURN', slot: 0, faceUp: true });
  assert.deepEqual(nextStep(m.current), { type: 'DRAW' });
  m.send({ type: 'DRAW' });
  assert.equal(m.state, 'AWAITING_FLIPS');
  assert.deepEqual(nextStep(m.current), { type: 'TURN', slot: 2 });
});

test('the words for Next follow the spread', () => {
  const m = new ReadingMachine({ cardIds: ids, reversalChance: 0.5 });
  m.send({ type: 'MAT_PLACED' });
  m.send({ type: 'CHOOSE_SPREAD', spread: three });
  assert.equal(describeNextStep(m.current), 'Next: shuffle the deck');
  press(m);
  assert.equal(describeNextStep(m.current), 'Next: lay down the Past card');
  press(m);
  assert.equal(describeNextStep(m.current), 'Next: turn over the Past card');
  m.send({ type: 'SHUFFLE' });
  assert.equal(nextStep(m.current), null, 'not mid-shuffle');
});
