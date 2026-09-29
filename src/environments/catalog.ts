/**
 * VR surroundings, found automatically: every folder here with an
 * environment.json. Surroundings added on the headset later register with a
 * "device:" id and blob URLs for their images.
 */

import { createRegistry, type RegistryItem } from '../lib/registry.js';
import type { EnvironmentDef } from './environment.schema.js';

const definitions = import.meta.glob<EnvironmentDef>('./*/environment.json', { eager: true, import: 'default' });
const files = import.meta.glob<string>('./*/**/*.{webp,png,jpg,jpeg}', { eager: true, query: '?url', import: 'default' });

export interface ResolvedEnvironment extends RegistryItem {
  env: EnvironmentDef;
  /** URL for a texture path written in environment.json, or null. */
  assetUrl(path: string | null): string | null;
}

const folderOf = (path: string) => path.split('/')[1];

/** Resolve "assets/x.webp" or "../shared/x.webp" against an environment's folder. */
export function resolveAssetKey(folder: string, path: string): string {
  const parts = [folder, ...path.split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return `./${out.join('/')}`;
}

export const environmentRegistry = createRegistry<ResolvedEnvironment>(
  Object.entries(definitions)
    .filter(([path, env]) => env.id === folderOf(path))
    .map(([path, env]) => {
      const folder = folderOf(path);
      return {
        id: env.id,
        origin: 'builtin' as const,
        env,
        assetUrl: (asset: string | null) => {
          if (!asset) return null;
          const url = files[resolveAssetKey(folder, asset)];
          return url ? new URL(url, document.baseURI).href : null;
        },
      };
    }),
);

/** Every environment, in Settings order. */
export function listEnvironments(): readonly ResolvedEnvironment[] {
  return [...environmentRegistry.list()].sort((a, b) => (a.env.order ?? 99) - (b.env.order ?? 99));
}

export function getEnvironment(id: string): ResolvedEnvironment | undefined {
  return environmentRegistry.get(id);
}
