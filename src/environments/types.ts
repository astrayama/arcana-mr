import type { Material, Object3D } from '@iwsdk/core';
import type { ResolvedTheme } from '../themes/registry.js';
import type { ThemeEnvironment } from '../themes/theme.schema.js';

/** A built VR environment. Its root is centered on the reading area at floor level. */
export interface EnvironmentInstance {
  root: Object3D;
  update(delta: number, time: number): void;
  dispose(): void;
  /** Material for the pedestal that stands under the mat in this environment. */
  stoneMaterial: Material;
}

export type EnvironmentBuilder<E extends ThemeEnvironment> = (env: E, resolved: ResolvedTheme) => EnvironmentInstance;
