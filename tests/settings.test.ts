import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultSettings, DECK_BACK, parseSettings } from '../src/settings/settings.ts';
import { readJson, writeJson, type KeyValueStore } from '../src/storage/local.ts';

const known = { decks: ['rws-1909', 'other'], backs: ['celestial', 'minimal'], surroundings: ['night-sanctum'] };
const defaults = defaultSettings('rws-1909');

test('nothing saved gives the defaults', () => {
  assert.deepEqual(parseSettings(null, known, defaults), defaults);
  assert.deepEqual(parseSettings('nonsense', known, defaults), defaults);
  assert.deepEqual(parseSettings({ v: 2, deck: 'other' }, known, defaults), defaults, 'unknown version');
});

test('saved choices come back', () => {
  const saved = { v: 1, deck: 'other', back: 'celestial', surroundings: 'night-sanctum', seenIntro: true };
  assert.deepEqual(parseSettings(saved, known, defaults), saved);
});

test('choices that no longer exist fall back one by one', () => {
  const saved = { v: 1, deck: 'gone', back: 'gone', surroundings: 'gone', seenIntro: 'yes' };
  const parsed = parseSettings(saved, known, defaults);
  assert.equal(parsed.deck, 'rws-1909');
  assert.equal(parsed.back, DECK_BACK);
  assert.equal(parsed.surroundings, defaults.surroundings);
  assert.equal(parsed.seenIntro, false, 'only a real true counts');
});

test('the deck back and the room are always valid', () => {
  const parsed = parseSettings({ v: 1, deck: 'rws-1909', back: DECK_BACK, surroundings: 'room', seenIntro: false }, known, defaults);
  assert.equal(parsed.back, DECK_BACK);
  assert.equal(parsed.surroundings, 'room');
});

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test('stored JSON round-trips, and bad JSON reads as nothing', () => {
  const store = memoryStore();
  assert.equal(writeJson('k', { a: 1 }, store), true);
  assert.deepEqual(readJson('k', store), { a: 1 });
  store.data.set('bad', '{not json');
  assert.equal(readJson('bad', store), null);
  assert.equal(readJson('missing', store), null);
});

test('storage that throws never breaks the app', () => {
  const throwing: KeyValueStore = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };
  assert.equal(readJson('k', throwing), null);
  assert.equal(writeJson('k', 1, throwing), false);
  assert.equal(readJson('k', null), null);
  assert.equal(writeJson('k', 1, null), false);
});

test('surroundings default to what the app chooses, and your room stays a valid choice', () => {
  const sanctum = defaultSettings('rws-1909', 'night-sanctum');
  assert.equal(parseSettings(null, known, sanctum).surroundings, 'night-sanctum');
  assert.equal(parseSettings({ v: 1, surroundings: 'gone' }, known, sanctum).surroundings, 'night-sanctum');
  assert.equal(parseSettings({ v: 1, surroundings: 'room' }, known, sanctum).surroundings, 'room');
});

test('choices of things added on the headset are kept until they load', () => {
  const saved = { v: 1, deck: 'device:mine', back: 'device:myback', surroundings: 'device:sky', seenIntro: true };
  assert.deepEqual(parseSettings(saved, known, defaults), saved);
});
