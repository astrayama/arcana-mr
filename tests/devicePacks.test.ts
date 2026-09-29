import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetStore, StoredPack } from '../src/storage/assetStore.ts';
import { loadDevicePacks, type DeviceBack, type DeviceDeck, type DeviceEnvironment } from '../src/storage/devicePacks.ts';

function memoryStore(packs: { pack: StoredPack; files: Record<string, string> }[]): AssetStore {
  return {
    listPacks: async () => packs.map((p) => p.pack),
    getFile: async (id, path) => {
      const entry = packs.find((p) => p.pack.id === id);
      const text = entry?.files[path];
      return text === undefined ? null : new Blob([text]);
    },
    putPack: async () => {},
    deletePack: async () => {},
  };
}

function targets() {
  const made: string[] = [];
  const revoked: string[] = [];
  const decks: DeviceDeck[] = [];
  const backs: DeviceBack[] = [];
  const envs: DeviceEnvironment[] = [];
  let n = 0;
  return {
    made,
    revoked,
    decks,
    backs,
    envs,
    t: {
      addDeck: (d: DeviceDeck) => (decks.push(d), null),
      addBack: (b: DeviceBack) => (backs.push(b), null),
      addEnvironment: (e: DeviceEnvironment) => (envs.push(e), null),
      cardIds: ['a', 'b'],
      toUrl: () => {
        const url = `blob:${++n}`;
        made.push(url);
        return url;
      },
      revokeUrl: (url: string) => void revoked.push(url),
    },
  };
}

const deckPack = (id: string): { pack: StoredPack; files: Record<string, string> } => ({
  pack: {
    id,
    kind: 'deck',
    addedAt: 0,
    files: ['back.webp', 'faces/a.webp', 'faces/b.webp'],
    manifest: {
      id,
      name: 'My deck',
      license: 'Mine',
      source: 'Drawn by me',
      aspectRatio: 0.6,
      back: 'back.webp',
      faces: { a: 'faces/a.webp', b: 'faces/b.webp' },
    },
  },
  files: { 'back.webp': 'B', 'faces/a.webp': 'A', 'faces/b.webp': 'BB' },
});

test('a stored deck becomes a deck with image URLs, freed when it is removed', async () => {
  const x = targets();
  const problems = await loadDevicePacks(memoryStore([deckPack('device:mine')]), x.t);
  assert.deepEqual(problems, []);
  const deck = x.decks[0];
  assert.equal(deck.id, 'device:mine');
  assert.ok(deck.backUrl?.startsWith('blob:'));
  assert.ok(deck.faceUrl('a')?.startsWith('blob:'));
  assert.equal(deck.faceUrl('zzz'), null);
  deck.dispose();
  assert.deepEqual([...x.revoked].sort(), [...x.made].sort());
});

test('packs without the device prefix, or that fail validation, are skipped with a reason', async () => {
  const x = targets();
  const broken = deckPack('device:broken');
  broken.pack.files = ['back.webp'];
  const problems = await loadDevicePacks(memoryStore([deckPack('mine'), broken]), x.t);
  assert.equal(x.decks.length, 0);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /device:/);
});

test('a stored card back and surroundings load too', async () => {
  const x = targets();
  const back: { pack: StoredPack; files: Record<string, string> } = {
    pack: {
      id: 'device:myback',
      kind: 'back',
      addedAt: 0,
      files: ['back.webp'],
      manifest: { id: 'device:myback', name: 'Mine', description: 'Mine', license: 'Mine', source: 'Me', aspectRatio: 0.58 },
    },
    files: { 'back.webp': 'X' },
  };
  const env: { pack: StoredPack; files: Record<string, string> } = {
    pack: {
      id: 'device:sky',
      kind: 'environment',
      addedAt: 0,
      files: ['floor.webp', 'stone.webp'],
      manifest: {
        id: 'device:sky',
        label: 'My sky',
        kind: 'night-sanctum',
        fog: { color: '#000000', density: 0.1 },
        sky: { top: '#000000', horizon: '#111111', bottom: '#000000' },
        stars: { count: 10, color: '#ffffff' },
        moon: null,
        floor: { texture: 'floor.webp', normal: null, color: '#888888', radiusM: 4 },
        stones: { texture: 'stone.webp', normal: null, color: '#777777', count: 5, ringRadiusM: 3 },
        flameColor: '#ffaa55',
        fireflies: null,
      },
    },
    files: { 'floor.webp': 'F', 'stone.webp': 'S' },
  };
  const problems = await loadDevicePacks(memoryStore([back, env]), x.t);
  assert.deepEqual(problems, []);
  assert.equal(x.backs[0].id, 'device:myback');
  assert.ok(x.envs[0].assetUrl('floor.webp')?.startsWith('blob:'));
  assert.equal(x.envs[0].assetUrl('missing.webp'), null);
});
