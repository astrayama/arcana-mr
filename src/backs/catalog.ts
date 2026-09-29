/**
 * Card back designs, found automatically in this folder, plus any added while
 * the app runs (backs made on the headset later register with a "device:"
 * id). The deck's own back is always offered too, as "deck".
 */

import { createRegistry, type RegistryItem } from '../lib/registry.js';
import type { BackManifest } from './back.schema.js';

const manifests = import.meta.glob<BackManifest>('./*/back.json', { eager: true, import: 'default' });
const images = import.meta.glob<string>('./*/back.webp', { eager: true, query: '?url', import: 'default' });

export interface ResolvedBack extends RegistryItem {
  manifest: BackManifest;
  url: string;
}

const folderOf = (path: string) => path.split('/')[1];

export const backRegistry = createRegistry<ResolvedBack>(
  Object.entries(manifests)
    .filter(([path, manifest]) => manifest.id === folderOf(path) && typeof images[`./${folderOf(path)}/back.webp`] === 'string')
    .map(([path, manifest]) => ({
      id: manifest.id,
      origin: 'builtin' as const,
      manifest,
      url: images[`./${folderOf(path)}/back.webp`],
    })),
);

export function listBacks(): readonly ResolvedBack[] {
  return [...backRegistry.list()].sort((a, b) => (a.manifest.order ?? 99) - (b.manifest.order ?? 99));
}

export function getBack(id: string): ResolvedBack | undefined {
  return backRegistry.get(id);
}
