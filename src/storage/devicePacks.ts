/**
 * Turns packs stored on the headset into decks, card backs, and surroundings
 * the app can use, by checking each one with the same validators as the
 * built-in ones and registering it with a "device:" id. Images become object
 * URLs, freed again if the pack is removed.
 */

import type { BackManifest } from '../backs/back.schema.js';
import { validateBackManifest } from '../backs/back.schema.js';
import { validateDeckManifest, type DeckManifest } from '../decks/deck.schema.js';
import { validateEnvironment, type EnvironmentDef } from '../environments/environment.schema.js';
import { resolveAssetKey } from '../environments/pathKeys.js';
import { DEVICE_PREFIX } from '../lib/registry.js';
import type { AssetStore, StoredPack } from './assetStore.js';

export interface DeviceDeck {
  id: string;
  origin: 'device';
  manifest: DeckManifest;
  backUrl: string | null;
  faceUrl(cardId: string): string | null;
  dispose(): void;
}

export interface DeviceBack {
  id: string;
  origin: 'device';
  manifest: BackManifest;
  url: string;
  dispose(): void;
}

export interface DeviceEnvironment {
  id: string;
  origin: 'device';
  env: EnvironmentDef;
  assetUrl(path: string | null): string | null;
  dispose(): void;
}

export interface DevicePackTargets {
  addDeck(deck: DeviceDeck): string | null;
  addBack(back: DeviceBack): string | null;
  addEnvironment(env: DeviceEnvironment): string | null;
  cardIds: readonly string[];
  /** Makes a URL for a stored file; URL.createObjectURL in the browser. */
  toUrl(blob: Blob): string;
  /** Frees a URL made by `toUrl`. */
  revokeUrl(url: string): void;
}

/** Load every stored pack. Returns a message for each pack that was skipped. */
export async function loadDevicePacks(store: AssetStore, targets: DevicePackTargets): Promise<string[]> {
  const problems: string[] = [];
  for (const pack of await store.listPacks()) {
    try {
      const problem = await loadPack(store, pack, targets);
      if (problem) problems.push(`${pack.id}: ${problem}`);
    } catch (error) {
      problems.push(`${pack.id}: ${(error as Error).message}`);
    }
  }
  return problems;
}

async function loadPack(store: AssetStore, pack: StoredPack, targets: DevicePackTargets): Promise<string | null> {
  if (!pack.id.startsWith(DEVICE_PREFIX)) return `ids must start with "${DEVICE_PREFIX}"`;
  const has = (path: string) => pack.files.includes(path.replace(/^\.\//, ''));
  const urls = new Map<string, string>();
  const urlFor = async (path: string | null): Promise<string | null> => {
    if (!path || !has(path)) return null;
    const key = path.replace(/^\.\//, '');
    if (!urls.has(key)) {
      const blob = await store.getFile(pack.id, key);
      if (!blob) return null;
      urls.set(key, targets.toUrl(blob));
    }
    return urls.get(key)!;
  };
  const dispose = () => {
    for (const url of urls.values()) targets.revokeUrl(url);
    urls.clear();
  };

  switch (pack.kind) {
    case 'deck': {
      const manifest = pack.manifest as DeckManifest;
      const result = validateDeckManifest(manifest, pack.id, has, targets.cardIds);
      if (!result.ok) return result.errors.join('; ');
      const backUrl = await urlFor(manifest.back);
      const faces = new Map<string, string>();
      for (const [cardId, path] of Object.entries(manifest.faces)) {
        const url = await urlFor(path);
        if (url) faces.set(cardId, url);
      }
      return targets.addDeck({ id: pack.id, origin: 'device', manifest, backUrl, faceUrl: (id) => faces.get(id) ?? null, dispose });
    }
    case 'back': {
      const manifest = pack.manifest as BackManifest;
      const errors = validateBackManifest(manifest, pack.id, has);
      if (errors.length) return errors.join('; ');
      const url = await urlFor('back.webp');
      if (!url) return 'back.webp is missing';
      return targets.addBack({ id: pack.id, origin: 'device', manifest, url, dispose });
    }
    case 'environment': {
      const env = pack.manifest as EnvironmentDef;
      // Device surroundings keep their files inside the pack (no ../shared).
      const result = validateEnvironment(env, pack.id, (p) => has(resolveAssetKey('', p).replace(/^\.\//, '')));
      if (!result.ok) return result.errors.join('; ');
      for (const file of pack.files) await urlFor(file);
      return targets.addEnvironment({
        id: pack.id,
        origin: 'device',
        env,
        assetUrl: (path) => (path ? (urls.get(resolveAssetKey('', path).replace(/^\.\//, '')) ?? null) : null),
        dispose,
      });
    }
  }
}
