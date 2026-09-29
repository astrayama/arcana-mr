/**
 * Builds an environment from its settings. Adding a new kind means a new
 * generator and a case here; environment folders then pick it and tune it.
 */

import type { ResolvedTheme } from '../themes/registry.js';
import type { ResolvedEnvironment } from './catalog.js';
import { buildCloudSea } from './cloudSea.js';
import { buildNightSanctum } from './nightSanctum.js';
import type { EnvironmentInstance } from './types.js';

export function buildEnvironment(resolved: ResolvedEnvironment, theme: ResolvedTheme): EnvironmentInstance {
  const env = resolved.env;
  switch (env.kind) {
    case 'night-sanctum':
      return buildNightSanctum(env, resolved, theme);
    case 'cloud-sea':
      return buildCloudSea(env, resolved, theme);
  }
}
