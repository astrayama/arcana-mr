/**
 * Card back designs, found automatically in this folder. The deck's own back
 * is always offered too, as "deck".
 */

import type { BackManifest } from './back.schema.js';

const manifests = import.meta.glob<BackManifest>('./*/back.json', { eager: true, import: 'default' });
const images = import.meta.glob<string>('./*/back.webp', { eager: true, query: '?url', import: 'default' });

export interface ResolvedBack {
  manifest: BackManifest;
  url: string;
}

const folderOf = (path: string) => path.split('/')[1];

const backs: ResolvedBack[] = Object.entries(manifests)
  .filter(([path, manifest]) => manifest.id === folderOf(path) && typeof images[`./${folderOf(path)}/back.webp`] === 'string')
  .map(([path, manifest]) => ({ manifest, url: images[`./${folderOf(path)}/back.webp`] }))
  .sort((a, b) => (a.manifest.order ?? 99) - (b.manifest.order ?? 99));

export function listBacks(): readonly ResolvedBack[] {
  return backs;
}

export function getBack(id: string): ResolvedBack | undefined {
  return backs.find((b) => b.manifest.id === id);
}
