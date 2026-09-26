/**
 * Fetches the public-domain (CC0) stone textures for the dark-gold theme's
 * night-sky sanctum from Poly Haven, and converts them to WebP.
 *
 *   npx tsx scripts/fetch-sanctum-textures.ts
 *
 * Poly Haven publishes every asset under CC0: https://polyhaven.com/license
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const OUT = join(import.meta.dirname, '..', 'src/themes/dark-gold/assets/sanctum');
const USER_AGENT = 'arcana-mr-asset-builder/1.0 (https://github.com/astrayama/arcana-mr)';

/** Poly Haven asset id, the maps we use, and the output size. */
const TEXTURES = [
  { asset: 'monastery_stone_floor', out: 'floor', size: 1024 },
  { asset: 'rock_wall_08', out: 'stone', size: 512 },
] as const;

const MAPS = { Diffuse: 'diff', nor_gl: 'nor' } as const;

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response;
}

mkdirSync(OUT, { recursive: true });
for (const { asset, out, size } of TEXTURES) {
  const files = await (await get(`https://api.polyhaven.com/files/${asset}`)).json();
  for (const [map, suffix] of Object.entries(MAPS)) {
    const url: string | undefined = files[map]?.['1k']?.jpg?.url;
    if (!url) throw new Error(`${asset} has no 1k ${map} map`);
    const bytes = Buffer.from(await (await get(url)).arrayBuffer());
    const target = join(OUT, `${out}-${suffix}.webp`);
    await sharp(bytes).resize(size, size).webp({ quality: suffix === 'nor' ? 90 : 82 }).toFile(target);
    console.log(`${asset} ${map} -> ${target.split('/src/')[1]} (${url})`);
  }
}
