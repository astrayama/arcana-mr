import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickFromUrl } from '../src/lib/urlOverrides.ts';

const themes = ['dark-gold', 'moonlit'];

test('no param uses the default', () => {
  assert.deepEqual(pickFromUrl('', 'theme', themes, 'dark-gold'), {
    id: 'dark-gold',
    requested: null,
    fellBack: false,
  });
});

test('a known value is used', () => {
  assert.equal(pickFromUrl('?theme=moonlit', 'theme', themes, 'dark-gold').id, 'moonlit');
});

test('an unknown value falls back and says so', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const pick = pickFromUrl('?theme=nope&deck=x', 'theme', themes, 'dark-gold');
    assert.equal(pick.id, 'dark-gold');
    assert.equal(pick.fellBack, true);
    assert.equal(pick.requested, 'nope');
  } finally {
    console.warn = warn;
  }
});
