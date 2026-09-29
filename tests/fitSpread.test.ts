import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { config } from '../src/config.ts';
import { validateSpread, type SpreadDef } from '../src/spreads/spread.schema.ts';
import { findOverlaps, fitSpread } from '../src/visuals/spreadLayout.ts';
import { layoutRules } from '../src/visuals/layout.ts';

const spreadsDir = join(import.meta.dirname, '..', 'src/spreads');
const builtins: SpreadDef[] = readdirSync(spreadsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ ...JSON.parse(readFileSync(join(spreadsDir, f), 'utf8')), origin: 'builtin' as const }));
const byId = (id: string) => builtins.find((s) => s.id === id)!;

// The 1909 deck's proportions.
const rules = layoutRules(config.card.widthM / 0.5801, 2);
const nearEdge = config.layout.matDepthM / 2;

test('every built-in spread file is valid', () => {
  assert.ok(builtins.length >= 7);
  for (const f of readdirSync(spreadsDir).filter((name) => name.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(spreadsDir, f), 'utf8'));
    const result = validateSpread(data, f.replace(/\.json$/, ''));
    assert.deepEqual(result.errors, [], f);
  }
});

test('small spreads keep the everyday mat and full-size cards', () => {
  for (const id of ['single', 'past-present-future', 'mind-body-spirit']) {
    const layout = fitSpread(byId(id), rules);
    assert.equal(layout.cardScale, 1, id);
    assert.equal(layout.mat.widthM, config.layout.matWidthM, id);
    assert.equal(layout.mat.depthM, config.layout.matDepthM, id);
  }
});

test('between readings the deck sits where a small reading puts it', () => {
  const idle = fitSpread(null, rules);
  const three = fitSpread(byId('past-present-future'), rules);
  assert.equal(idle.slots.length, 0);
  assert.ok(Math.abs(idle.deck.x - three.deck.x) < 1e-9);
  assert.ok(Math.abs(idle.deck.z - three.deck.z) < 1e-9);
  assert.ok(idle.deck.z < 0 && idle.deck.z > -0.15, 'deck on the far half of the mat');
});

test('every built-in fits cleanly: no overlaps, on the mat, near edge fixed', () => {
  for (const spread of builtins) {
    const layout = fitSpread(spread, rules);
    assert.deepEqual(findOverlaps(layout), [], spread.id);
    assert.equal(layout.clipped, false, spread.id);
    assert.equal(layout.bounds.maxZ, nearEdge, `${spread.id}: near edge stays put`);
    assert.ok(layout.mat.widthM <= config.layout.maxMatWidthM + 1e-9, spread.id);
    assert.ok(layout.mat.depthM <= config.layout.maxMatDepthM + 1e-9, spread.id);
    assert.ok(layout.cardScale >= config.layout.minCardScale, spread.id);
    assert.equal(layout.slots.length, spread.positions.length);
  }
});

test('the Celtic Cross crossing card lies sideways on the first card and shares its label', () => {
  const layout = fitSpread(byId('celtic-cross'), rules);
  const [present, challenge] = layout.slots;
  assert.equal(challenge.stackedOn, 0);
  assert.equal(challenge.yaw, Math.PI / 2);
  assert.ok(challenge.y > present.y);
  assert.equal(challenge.x, present.x);
  assert.equal(challenge.z, present.z);
  assert.equal(challenge.labelGroup, present.labelGroup);
  assert.deepEqual(layout.labelGroups[present.labelGroup].slots, [0, 1]);
});

test('Twelve Houses rings the deck', () => {
  const layout = fitSpread(byId('twelve-houses'), rules);
  const xs = layout.slots.map((s) => s.x);
  const zs = layout.slots.map((s) => s.z);
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  assert.ok(Math.abs(layout.deck.x - midX) < 1e-6);
  assert.ok(Math.abs(layout.deck.z - midZ) < 1e-6);
});

test('big spreads grow the mat before shrinking cards', () => {
  const horseshoe = fitSpread(byId('horseshoe'), rules);
  assert.ok(horseshoe.mat.widthM > config.layout.matWidthM);
  const crowded: SpreadDef = {
    id: 'crowded',
    name: 'Crowded',
    summary: 'Too wide for the mat at full size.',
    origin: 'custom',
    positions: Array.from({ length: 8 }, (_, i) => ({ label: `${i}`, meaning: 'x', x: i - 3.5, y: 0 })),
  };
  const layout = fitSpread(crowded, rules);
  assert.equal(layout.mat.widthM, config.layout.maxMatWidthM);
  assert.ok(layout.cardScale < 1 && layout.cardScale >= config.layout.minCardScale);
  assert.deepEqual(findOverlaps(layout), []);
});

test('candles stay clear of the cards and the deck', () => {
  for (const spread of builtins) {
    const layout = fitSpread(spread, rules);
    for (const c of layout.candles) {
      assert.ok(c.z < layout.bounds.maxZ && c.z > layout.bounds.minZ, spread.id);
    }
  }
});

test('layouts are deterministic', () => {
  assert.deepEqual(fitSpread(byId('celtic-cross'), rules), fitSpread(byId('celtic-cross'), rules));
});
