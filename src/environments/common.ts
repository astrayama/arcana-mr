/** Helpers shared by the environment generators. */

import { CanvasTexture, NoColorSpace, RepeatWrapping, type Texture } from '@iwsdk/core';
import type { EnvironmentAssets } from './types.js';
import { loadColorTexture } from '../visuals/tableVisuals.js';

/** Small seeded PRNG so layouts are the same every time (not for anything secret). */
export { seeded } from '../lib/random.js';

/** A soft radial gradient on a small canvas: glows, flames, motes, suns. */
export function radialTexture(stops: [number, string][], size = 128): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/**
 * An environment texture, tiled `repeat` times. Always a clone: the asset manager
 * caches one Texture per URL, and two environments tiling the same image
 * differently would otherwise overwrite each other.
 */
export async function tiled(
  assets: EnvironmentAssets,
  path: string | null,
  repeat: number,
  color: boolean,
): Promise<Texture | null> {
  const url = assets.assetUrl(path);
  if (!url) return null;
  const texture = (await loadColorTexture(url)).clone();
  if (!color) texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.needsUpdate = true;
  return texture;
}
