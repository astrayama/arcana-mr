/**
 * Builds an environment from its theme settings. Adding a new kind means a
 * new generator and a case here; themes then pick it and tune it in theme.json.
 */

import type { ResolvedTheme } from '../themes/registry.js';
import type { ThemeEnvironment } from '../themes/theme.schema.js';
import { buildCloudSea } from './cloudSea.js';
import { buildNightSanctum } from './nightSanctum.js';
import type { EnvironmentInstance } from './types.js';

export function buildEnvironment(env: ThemeEnvironment, resolved: ResolvedTheme): EnvironmentInstance {
  switch (env.kind) {
    case 'night-sanctum':
      return buildNightSanctum(env, resolved);
    case 'cloud-sea':
      return buildCloudSea(env, resolved);
  }
}
