import type { Material, Object3D } from '@iwsdk/core';
import type { ResolvedTheme } from '../themes/registry.js';
import type { EnvironmentDef } from './environment.schema.js';

/** A built VR environment. Its root is centered on the reading area at floor level. */
export interface EnvironmentInstance {
  root: Object3D;
  update(delta: number, time: number): void;
  dispose(): void;
  /** Material for the pedestal that stands under the mat in this environment. */
  stoneMaterial: Material;
}

/** Where an environment's textures come from: its own folder (or, later, the headset). */
export interface EnvironmentAssets {
  assetUrl(path: string | null): string | null;
}

export type EnvironmentBuilder<E extends EnvironmentDef> = (
  env: E,
  assets: EnvironmentAssets,
  theme: ResolvedTheme,
) => EnvironmentInstance;
